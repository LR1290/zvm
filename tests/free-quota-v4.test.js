'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFreeQuotaService,FREE_LIMITS}=require('../security/free-quota-v4');
class MemoryCollection{
 constructor(){this.rows=new Map();}
 async createIndex(index,opts){return opts.name;}
 async findOne({_id}){const row=this.rows.get(_id);return row?structuredClone(row):null;}
 async insertOne(row,opts){assert.equal(opts.writeConcern.w,'majority');if(this.rows.has(row._id)){const e=Error('E11000');e.code=11000;throw e;}this.rows.set(row._id,structuredClone(row));return {acknowledged:true};}
 async findOneAndUpdate(filter,update,opts){assert.equal(opts.writeConcern.w,'majority');const row=this.rows.get(filter._id);if(!row)return null;if(row.applied.includes(filter.applied.$ne))return null;for(const [k,v] of Object.entries(filter)){if(k.startsWith('sent.')&&row.sent[k.slice(5)]>=v.$lt)return null;}if(update.$inc)for(const [k,v] of Object.entries(update.$inc))row.sent[k.slice(5)]+=v;if(update.$max)for(const [k,v] of Object.entries(update.$max))row.sent[k.slice(5)]=Math.max(row.sent[k.slice(5)],v);row.applied.push(update.$addToSet.applied);Object.assign(row,update.$set);return structuredClone(row);}
}
function service(col,date='2026-10-11T23:20:00Z'){return createFreeQuotaService({db:{collection(name){assert.equal(name,'extension_free_quota_v4');return col;}},now:()=>new Date(date)});}
const a='a'.repeat(64),b='b'.repeat(64);
const commit=(subjectId,id,itemType='message')=>({subjectId,action:'commit',operationId:'op_quota_'+id.padStart(12,'0'),itemType});
test('Build 3 numerical caps preserved',()=>assert.deepEqual(FREE_LIMITS,{message:20,audio:10,media:10,document:10,scheduleItem:5}));
test('one account never borrows another account usage',async()=>{const q=service(new MemoryCollection());await q.execute(commit(a,'1'));assert.equal((await q.execute({subjectId:a})).limits.message.sent,1);assert.equal((await q.execute({subjectId:b})).limits.message.sent,0);});
test('20 of 30 concurrent actions succeed, 10 denied',async()=>{const q=service(new MemoryCollection());const result=await Promise.allSettled(Array.from({length:30},(_,i)=>q.execute(commit(a,String(i)))));assert.equal(result.filter(x=>x.status==='fulfilled').length,20);assert.equal(result.filter(x=>x.status==='rejected'&&x.reason.code==='QUOTA_LIMIT_REACHED').length,10);});
test('repeated operation does not use quota twice',async()=>{const q=service(new MemoryCollection());await q.execute(commit(a,'1'));const rep=await q.execute(commit(a,'1'));assert.equal(rep.duplicate,true);assert.equal(rep.limits.message.sent,1);});
test('new UTC day is a fresh quota',async()=>{const col=new MemoryCollection();await service(col,'2026-10-11T23:59:59Z').execute(commit(a,'1'));assert.equal((await service(col,'2026-10-12T00:00:00Z').execute({subjectId:a})).limits.message.sent,0);assert.equal(col.rows.size,1);});
test('unauthenticated subject never receives a free quota',async()=>{const col=new MemoryCollection();await assert.rejects(service(col).execute(commit('_anon_','1')),e=>e.code==='QUOTA_IDENTITY_REQUIRED');assert.equal(col.rows.size,0);});
test('flow is not a free quota item',async()=>await assert.rejects(service(new MemoryCollection()).execute(commit(a,'1','flow')),e=>e.code==='QUOTA_TYPE_INVALID'));
