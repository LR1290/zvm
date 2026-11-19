'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {executeV4FreeQuota:run}=require('../src/extension-v4-free-quota');
const SUBJECT={type:'account',id:'a'.repeat(64)},NOW=new Date('2026-11-19T15:00:00Z');
function get(doc,path){return path.split('.').reduce((x,k)=>x?.[k],doc)}
function set(doc,path,value){const parts=path.split('.');let p=doc;for(const k of parts.slice(0,-1))p=p[k]||(p[k]={});p[parts.at(-1)]=structuredClone(value)}
class MemoryCollection{
 constructor(){this.docs=new Map();this.mutations=0}
 async insertOne(doc){if(this.docs.has(doc._id))throw Object.assign(new Error('dup'),{code:11000});this.docs.set(doc._id,structuredClone(doc))}
 async findOne(filter){return structuredClone(this.docs.get(filter._id)||null)}
 async findOneAndUpdate(filter,update){
  const doc=this.docs.get(filter._id);if(!doc)return null;
  for(const [path,condition] of Object.entries(filter)){
   if(path==='_id')continue;
   const v=get(doc,path);
   if(condition&&typeof condition==='object'&&'$exists'in condition&&((v!==undefined)!==condition.$exists))return null;
   if(condition&&typeof condition==='object'&&'$lt'in condition&&!(v<condition.$lt))return null;
   if(!(condition&&typeof condition==='object')&&condition!==v)return null;
  }
  for(const [k,v] of Object.entries(update.$inc||{}))set(doc,k,get(doc,k)+v);
  for(const [k,v] of Object.entries(update.$set||{}))set(doc,k,v);
  this.mutations++;return structuredClone(doc);
 }
}
const id=n=>n.toString(16).padStart(32,'0');
const ctx=(more={})=>({collection:new MemoryCollection(),subject:SUBJECT,tier:'free',itemType:'message',now:NOW,...more});
const denied=async(code,fn)=>assert.rejects(fn,err=>err.code===code);
test('Free without key or phone can check quota',async()=>{const x=ctx(),r=await run({...x,action:'check'});assert.equal(r.limits.message.max,20);assert.equal(r.limits.message.sent,0)});
test('50 concurrent duplicate reservations debit only once',async()=>{const x=ctx();const r=await Promise.all(Array.from({length:50},()=>run({...x,action:'reserve',operationId:id(1)})));assert.equal(x.collection.mutations,1);assert.equal(r.at(-1).limits.message.sent,1);assert.equal(r.at(-1).operationStatus,'reserved')});
test('40 distinct requests cannot exceed 20 message sends',async()=>{const x=ctx();const r=await Promise.allSettled(Array.from({length:40},(_,i)=>run({...x,action:'reserve',operationId:id(i+1)})));assert.equal(r.filter(v=>v.status==='fulfilled').length,20);assert.equal(r.filter(v=>v.reason?.code==='MAX_LIMIT_REACHED').length,20)});
test('reported WAJS confirmation is hashed and never consumes twice',async()=>{const x=ctx();await run({...x,action:'reserve',operationId:id(1)});const r=await run({...x,action:'settle',operationId:id(1),ack:'confirmed',messageIdHash:'b'.repeat(64)});assert.equal(r.operationStatus,'confirmed');const doc=[...x.collection.docs.values()][0];assert.match(doc.receipts[id(1)].receiptHash,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(doc).includes('5511999999999'));assert.equal(r.limits.message.sent,1);assert.equal((await run({...x,action:'reconcile',operationId:id(1)})).operationStatus,'confirmed')});
test('uncertain ack remains charged and later confirmed',async()=>{const x=ctx();await run({...x,action:'reserve',operationId:id(1)});await run({...x,action:'settle',operationId:id(1),ack:'uncertain'});assert.equal((await run({...x,action:'reconcile',operationId:id(1)})).operationStatus,'uncertain');assert.equal((await run({...x,action:'settle',operationId:id(1),ack:'confirmed',messageIdHash:'c'.repeat(64)})).limits.message.sent,1)});
test('one operation id cannot change item type',async()=>{const x=ctx();await run({...x,action:'reserve',operationId:id(1)});await denied('operation_type_mismatch',()=>run({...x,itemType:'audio',action:'reserve',operationId:id(1)}))});
test('old post-send commit and client refund are forbidden',async()=>{await denied('invalid_action',()=>run({...ctx(),action:'commit',operationId:id(1)}));await denied('invalid_action',()=>run({...ctx(),action:'release',operationId:id(1)}))});
test('ack confirmation requires WA-JS message id',async()=>{const x=ctx();await run({...x,action:'reserve',operationId:id(1)});await denied('message_receipt_required',()=>run({...x,action:'settle',operationId:id(1),ack:'confirmed',messageIdHash:''}));await denied('invalid_settlement',()=>run({...x,action:'settle',operationId:id(1),ack:'sent'}))});
test('client-reported active schedule count denied',async()=>{const x=ctx({itemType:'scheduleItem'});await denied('schedule_server_authority_required',()=>run({...x,action:'reserve',operationId:id(1),scheduledItems:5}));await denied('schedule_server_authority_required',()=>run({...x,action:'reserve',operationId:id(1)}))});
test('paid/key sessions cannot use free quota',async()=>{const x=ctx();await denied('account_session_required',()=>run({...x,subject:{type:'license',id:'a'.repeat(64)}}));await denied('free_plan_required',()=>run({...x,tier:'paid'}))});
test('Mongo error never becomes success',async()=>{const x=ctx();x.collection.findOneAndUpdate=async()=>{throw Error('Mongo write timeout')};await assert.rejects(()=>run({...x,action:'reserve',operationId:id(1)}))});
test('only reconciliation may read previous day',async()=>{const x=ctx();await run({...x,action:'reserve',operationId:id(1)});const t=new Date('2026-11-20T00:01:00Z');assert.equal((await run({...x,now:t,action:'reconcile',period:'2026-11-19',operationId:id(1)})).operationStatus,'reserved');await denied('period_changed_reconcile_required',()=>run({...x,now:t,action:'reserve',period:'2026-11-19',operationId:id(2)}))});
test('daily cap is not bypassed with new operation IDs',async()=>{const x=ctx();for(let i=1;i<=20;i++)await run({...x,action:'reserve',operationId:id(i)});await denied('MAX_LIMIT_REACHED',()=>run({...x,action:'reserve',operationId:id(21)}));assert.equal(x.collection.mutations,20)});

test('R100: confirmed acknowledgement wins after an uncertain CAS races first',async()=>{
 const x=ctx();await run({...x,action:'reserve',operationId:id(1)});
 const base=x.collection.findOneAndUpdate.bind(x.collection), statusPath='receipts.'+id(1)+'.status';
 let collided=false;
 x.collection.findOneAndUpdate=async(filter,update,options)=>{
  if(!collided&&update.$set?.[statusPath]==='confirmed'){
   collided=true;
   assert.ok(await base(filter,{$set:{[statusPath]:'uncertain'}}));
   return null;
  }
  return base(filter,update,options);
 };
 const result=await run({...x,action:'settle',operationId:id(1),ack:'confirmed',messageIdHash:'d'.repeat(64)});
 assert.equal(collided,true);assert.equal(result.operationStatus,'confirmed');
 assert.equal((await run({...x,action:'reconcile',operationId:id(1)})).operationStatus,'confirmed');
 assert.equal(result.limits.message.sent,1);
});
test('R100: uncertain acknowledgement cannot downgrade a concurrent positive receipt',async()=>{
 const x=ctx();await run({...x,action:'reserve',operationId:id(1)});
 const base=x.collection.findOneAndUpdate.bind(x.collection),path='receipts.'+id(1);
 let collided=false;
 x.collection.findOneAndUpdate=async(filter,update,options)=>{
  if(!collided&&update.$set?.[path+'.status']==='uncertain'){
   collided=true;
   assert.ok(await base(filter,{$set:{[path+'.status']:'confirmed',[path+'.receiptHash']:'e'.repeat(64)}}));
   return null;
  }
  return base(filter,update,options);
 };
 const result=await run({...x,action:'settle',operationId:id(1),ack:'uncertain'});
 assert.equal(collided,true);assert.equal(result.operationStatus,'confirmed');assert.equal(result.duplicate,true);
 assert.equal((await run({...x,action:'reconcile',operationId:id(1)})).operationStatus,'confirmed');
});
test('R100: conflicting WA-JS receipt hashes for one operation are rejected',async()=>{
 const x=ctx();await run({...x,action:'reserve',operationId:id(1)});
 await run({...x,action:'settle',operationId:id(1),ack:'confirmed',messageIdHash:'b'.repeat(64)});
 await denied('message_receipt_mismatch',()=>run({...x,action:'settle',operationId:id(1),ack:'confirmed',messageIdHash:'c'.repeat(64)}));
 assert.equal((await run({...x,action:'reconcile',operationId:id(1)})).operationStatus,'confirmed');
});
test('R100: sustained CAS contention fails closed without claiming confirmation',async()=>{
 const x=ctx();await run({...x,action:'reserve',operationId:id(1)});
 let attempts=0;x.collection.findOneAndUpdate=async()=>{attempts++;return null};
 await denied('quota_result_uncertain',()=>run({...x,action:'settle',operationId:id(1),ack:'confirmed',messageIdHash:'d'.repeat(64)}));
 assert.equal(attempts,5);
 assert.equal((await run({...x,action:'reconcile',operationId:id(1)})).operationStatus,'reserved');
});
