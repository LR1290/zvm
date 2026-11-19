'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {executeV4FreeQuota:execute,FREE_V4_QUOTA_LIMITS}=require('../src/extension-v4-free-quota');
const SUBJECT={type:'account',id:'a'.repeat(64)},NOW=new Date('2026-11-19T15:00:00Z');
class FakeCollection{
 constructor(){this.data=new Map();this.charges=0;}
 async insertOne(doc){if(this.data.has(doc._id))throw Object.assign(new Error('duplicate'),{code:11000});this.data.set(doc._id,structuredClone(doc));}
 async findOne(filter){return structuredClone(this.data.get(filter._id)||null);}
 async findOneAndUpdate(filter,update){
  const doc=this.data.get(filter._id);if(!doc||doc.operations.includes(filter.operations.$ne))return null;
  if(filter.$expr&&doc.operations.length>=128)return null;
  for(const [k,v] of Object.entries(filter))if(k.startsWith('counts.')&&doc.counts[k.slice(7)]>=v.$lt)return null;
  if(update.$inc)for(const [k,v] of Object.entries(update.$inc))doc.counts[k.slice(7)]+=v;
  if(update.$max)for(const [k,v] of Object.entries(update.$max))doc.counts[k.slice(7)]=Math.max(doc.counts[k.slice(7)],v);
  doc.operations.push(update.$addToSet.operations);this.charges++;return structuredClone(doc);
 }
}
const op=n=>n.toString(16).padStart(32,'0');
const ctx=(extra={})=>({collection:new FakeCollection(),subject:SUBJECT,tier:'free',itemType:'message',now:NOW,...extra});
async function denied(code,fn){await assert.rejects(fn,e=>e.code===code);}
test('free account checks without phone or commercial key',async()=>{const x=ctx(),r=await execute({...x,action:'check'});assert.equal(r.limits.message.max,20);assert.equal(r.limits.message.sent,0);});
test('idempotent commit ignores replay',async()=>{const x=ctx();await execute({...x,action:'commit',operationId:op(1)});const r=await execute({...x,action:'commit',operationId:op(1)});assert.equal(r.limits.message.sent,1);assert.equal(x.collection.charges,1);});
test('50 concurrent duplicated commits only count once',async()=>{const x=ctx();await Promise.all(Array.from({length:50},()=>execute({...x,action:'commit',operationId:op(2)})));assert.equal(x.collection.charges,1);});
test('40 different sends cannot exceed 20 free messages',async()=>{const x=ctx();const r=await Promise.allSettled(Array.from({length:40},(_,i)=>execute({...x,action:'commit',operationId:op(i+1)})));assert.equal(r.filter(v=>v.status==='fulfilled').length,20);assert.equal(r.filter(v=>v.reason?.code==='MAX_LIMIT_REACHED').length,20);});
test('subject not from input and paid session denied',async()=>{await denied('invalid_subject',()=>execute(ctx({subject:{type:'account',id:'wrong'}})));await denied('account_session_required',()=>execute(ctx({subject:{type:'license',id:'a'.repeat(64)}})));await denied('free_plan_required',()=>execute(ctx({tier:'paid'})));});
test('unrecognized type, action and operation id rejected',async()=>{await denied('unknown_item_type',()=>execute(ctx({itemType:'bulkMessages'})));await denied('invalid_action',()=>execute(ctx({action:'erase'})));await denied('invalid_operation_id',()=>execute(ctx({action:'commit',operationId:'xxx'})));});
test('reconciliation after an uncertain network acknowledgement',async()=>{const x=ctx();await execute({...x,action:'commit',operationId:op(1)});assert.equal((await execute({...x,action:'reconcile',operationId:op(1),period:'2026-11-19'})).operationStatus,'committed');assert.equal((await execute({...x,action:'reconcile',operationId:op(2),period:'2026-11-19'})).operationStatus,'not_found');});
test('no backdated commits and historical reconciliation',async()=>{const x=ctx();await execute({...x,action:'commit',operationId:op(1)});const tomorrow=new Date('2026-11-20T00:01:00Z');assert.equal((await execute({...x,now:tomorrow,action:'reconcile',period:'2026-11-19',operationId:op(1)})).operationStatus,'committed');await denied('period_changed_reconcile_required',()=>execute({...x,now:tomorrow,action:'commit',operationId:op(1),period:'2026-11-19'}));});
test('scheduled item count never exceeds five',async()=>{const x=ctx({itemType:'scheduleItem'});await denied('invalid_schedule_count',()=>execute({...x,action:'commit',operationId:op(1),scheduledItems:6}));const r=await execute({...x,action:'commit',operationId:op(2),scheduledItems:5});assert.equal(r.limits.scheduleItem.sent,FREE_V4_QUOTA_LIMITS.scheduleItem);});
test('storage errors are not accepted as success',async()=>{const x=ctx();x.collection.findOneAndUpdate=async()=>{throw new Error('write timeout')};await assert.rejects(()=>execute({...x,action:'commit',operationId:op(3)}));});

test('at most 128 receipts per Free account/day',async()=>{
 const x=ctx({itemType:'scheduleItem'});
 for(let i=0;i<128;i++)await execute({...x,action:'commit',operationId:op(i+1),scheduledItems:5});
 await denied('quota_operation_limit_reached',()=>execute({...x,action:'commit',operationId:op(129),scheduledItems:5}));
 assert.equal((await execute({...x,action:'check'})).limits.scheduleItem.sent,5);
});
