'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../large-media-domain');
const {createMongoLargeMediaStore}=require('../large-media-store');

class FakeCollection {
 constructor(name){this.name=name;this.rows=new Map();this.indexes=[];}
 async createIndex(field,options={}){this.indexes.push({field,options});return 'ok';}
 matches(record,filter){return Object.entries(filter).every(([key,value])=>record[key]===value);}
 async findOne(filter){return [...this.rows.values()].find(x=>this.matches(x,filter))||null;}
 async insertOne(record){
  if(this.rows.has(record._id)||
    (this.name==='cloud_large_media_uploads'&&[...this.rows.values()].some(x=>x.owner===record.owner))){
   const error=new Error('duplicate_key');error.code=11000;throw error;
  }
  this.rows.set(record._id,{...record});return {insertedId:record._id};
 }
 apply(record,update){
  for(const [key,value] of Object.entries(update.$set||{}))record[key]=value;
  for(const key of Object.keys(update.$unset||{}))delete record[key];
 }
 async updateOne(filter,update){
  const row=await this.findOne(filter);
  if(!row)return {matchedCount:0};
  this.apply(row,update);return {matchedCount:1};
 }
 async updateMany(filter,update){
  let count=0;
  for(const row of this.rows.values())if(this.matches(row,filter)){this.apply(row,update);count++;}
  return {matchedCount:count};
 }
 async deleteOne(filter){
  const row=await this.findOne(filter);if(!row)return {deletedCount:0};
  this.rows.delete(row._id);return {deletedCount:1};
 }
 async deleteMany(filter){
  let count=0;for(const row of [...this.rows.values()])if(this.matches(row,filter)){
   this.rows.delete(row._id);count++;
  }
  return {deletedCount:count};
 }
 find(filter){
  const rows=[...this.rows.values()].filter(x=>this.matches(x,filter));
  return {
   async toArray(){return rows;},
   sort({index=1}){
    rows.sort((a,b)=>(a.index-b.index)*index);
    return {async *[Symbol.asyncIterator](){for(const row of rows)yield row;}};
   }
  };
 }
}
function mockMongo(){
 const collections=new Map(),state={transactions:0,closed:0,failNext:false};
 const db={collection(name){if(!collections.has(name))collections.set(name,new FakeCollection(name));return collections.get(name);}};
 const client={startSession(){
  return {
   async withTransaction(fn){
    state.transactions++;
    const snapshot=new Map([...collections].map(([k,col])=>[k,new Map([...col.rows].map(([id,doc])=>[id,structuredClone(doc)]))]));
    try{await fn();if(state.failNext){state.failNext=false;throw Error('simulated_transaction_failure');}}
    catch(error){for(const [k,rows] of snapshot)collections.get(k).rows=rows;throw error;}
   },
   async endSession(){state.closed++;}
  };
 }};
 return {db,client,state,collections};
}
function png(){
 const bytes=Buffer.alloc(D.CHUNK_BYTES+456);
 Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
 for(let i=8;i<bytes.length;i++)bytes[i]=(i*7)%239;
 return bytes;
}
const metadata=bytes=>({name:'foto-r24.png',mime:'image/png',size:bytes.length,sha256:D.sha(bytes)});

test('R24 Mongo adapter: atomic finalize/delete, owner isolation, resume, no leftover chunks',async()=>{
 const env=mockMongo(),large=await createMongoLargeMediaStore(env.db,env.client);
 const data=png(),spec=metadata(data);
 const initial=await large.begin('a@example.org',spec,0,0);
 const id=initial.upload.uploadId;
 assert.match(id,/^[a-f0-9]{32}$/);
 assert.equal((await large.status('b@example.org')),null);
 assert.equal((await large.list('a@example.org')).length,0);
 await assert.rejects(()=>large.begin('a@example.org',{...spec,name:'outro.png'}),/upload_already_active/);
 const chunks=[data.subarray(0,D.CHUNK_BYTES),data.subarray(D.CHUNK_BYTES)];
 let state=await large.append('a@example.org',id,0,chunks[0],D.sha(chunks[0]));
 assert.equal(state.nextIndex,1);
 state=await large.append('a@example.org',id,0,chunks[0],D.sha(chunks[0]));
 assert.equal(state.nextIndex,1);
 assert.equal((await large.begin('a@example.org',spec)).resumed,true);
 await assert.rejects(()=>large.finish('a@example.org',id),/upload_incomplete/);
 state=await large.append('a@example.org',id,1,chunks[1],D.sha(chunks[1]));
 assert.equal(state.nextIndex,2);
 const complete=await large.finish('a@example.org',id);
 assert.equal(complete.file.id,'m_'+spec.sha256.slice(0,40));
 assert.equal((await large.finish('a@example.org',id)).duplicate,true);
 assert.equal(env.state.transactions,1);
 assert.equal((await large.list('a@example.org')).length,1);
 assert.equal((await large.list('b@example.org')).length,0);
 assert.equal((await large.status('a@example.org')),null);
 const returned=[];for await(const part of large.chunks('a@example.org',complete.file.id))returned.push(part);
 assert.deepEqual(Buffer.concat(returned),data);
 const chunkDocs=[...env.collections.get('cloud_large_media_chunks').rows.values()];
 assert.equal(chunkDocs.length,2);
 assert(chunkDocs.every(x=>!('expiresAt' in x)));
 assert.equal((await large.begin('a@example.org',spec)).duplicate,true);
 await assert.rejects(()=>large.remove('b@example.org',complete.file.id),/media_not_found/);
 await large.remove('a@example.org',complete.file.id);
 assert.equal((await large.list('a@example.org')).length,0);
 assert.equal(env.collections.get('cloud_large_media_chunks').rows.size,0);
 assert.equal(env.state.transactions,2);
 assert.equal(env.state.closed,2);
});
test('R24 Mongo adapter: finalize transaction rolls back and can be retried safely',async()=>{
 const env=mockMongo(),large=await createMongoLargeMediaStore(env.db,env.client);
 const bytes=png(),spec=metadata(bytes),id=(await large.begin('a@example.org',spec)).upload.uploadId;
 const chunks=[bytes.subarray(0,D.CHUNK_BYTES),bytes.subarray(D.CHUNK_BYTES)];
 for(let i=0;i<chunks.length;i++)await large.append('a@example.org',id,i,chunks[i],D.sha(chunks[i]));
 env.state.failNext=true;
 await assert.rejects(()=>large.finish('a@example.org',id),/simulated_transaction_failure/);
 assert.equal((await large.list('a@example.org')).length,0);
 assert.equal((await large.status('a@example.org')).nextIndex,2);
 const done=await large.finish('a@example.org',id);
 assert.equal(done.file.id,'m_'+spec.sha256.slice(0,40));
 assert.equal((await large.list('a@example.org')).length,1);
 assert.equal(env.state.transactions,2);
});
test('R24 Mongo adapter: cancellation transaction and finalizing conflict',async()=>{
 const env=mockMongo(),large=await createMongoLargeMediaStore(env.db,env.client);
 const bytes=png(),spec=metadata(bytes),id=(await large.begin('a@example.org',spec)).upload.uploadId;
 await large.append('a@example.org',id,0,bytes.subarray(0,D.CHUNK_BYTES),D.sha(bytes.subarray(0,D.CHUNK_BYTES)));
 await assert.rejects(()=>large.cancel('b@example.org',id),/upload_not_found/);
 await large.cancel('a@example.org',id);
 assert.equal((await large.status('a@example.org')),null);
 assert.equal(env.collections.get('cloud_large_media_chunks').rows.size,0);
 const next=(await large.begin('a@example.org',spec)).upload.uploadId;
 const uploads=env.collections.get('cloud_large_media_uploads');
 const owner=D.ownerId('a@example.org');
 await uploads.updateOne({_id:next,owner},{$set:{status:'finalizing'}});
 await assert.rejects(()=>large.cancel('a@example.org',next),/upload_finalizing/);
});
test('R24 Mongo adapter: quota accounts for legacy files and avoids plaintext email keys',async()=>{
 const env=mockMongo(),large=await createMongoLargeMediaStore(env.db,env.client);
 const bytes=png(),spec=metadata(bytes);
 await assert.rejects(()=>large.begin('a@example.org',spec,0,60),/media_item_quota/);
 await assert.rejects(()=>large.begin('a@example.org',spec,D.MAX_ACCOUNT,0),/media_storage_quota/);
 const result=await large.begin('a@example.org',spec);
 const record=env.collections.get('cloud_large_media_uploads').rows.get(result.upload.uploadId);
 assert(record);assert.match(record.owner,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(record).includes('a@example.org'),false);
});
