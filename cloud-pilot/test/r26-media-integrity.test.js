'use strict';
// R26: run against the actual production store implementation, not copies of
// the algorithms. FakeMongo models transactions and per-account conflicts.
const test=require('node:test'),assert=require('node:assert/strict');
const {createMemoryStore,createMongoStore}=require('../store');
const Media=require('../media-domain'),Large=require('../large-media-domain');

const email='a@example.org',other='b@example.org';
function png(){
 const value=Buffer.alloc(274377,0x42);
 Buffer.from([137,80,78,71,13,10,26,10]).copy(value);
 return value;
}
const good=()=>{
 const bytes=png();
 return Media.decode({name:'picture.png',mime:'image/png',
  base64:bytes.toString('base64'),sha256:Media.sha(bytes)});
};
function library(mediaId){
 return {library:[{id:'photo',name:'Photo',kind:'image',
  mediaId,contentStatus:'ready'}]};
}
async function prepareLegacy(store,who=email){
 const item=good();
 const result=await store.writeMedia(who,0,[item]);assert.equal(result.conflict,false);
 return item.id;
}
async function prepareLarge(store,who=email){
 const bytes=png(),sha256=Large.sha(bytes);
 const start=await store.large.begin(who,{name:'picture.png',mime:'image/png',
  size:bytes.length,sha256},0,0);
 assert.ok(start.upload?.uploadId);
 for(let i=0;i<start.upload.totalChunks;i++){
  const part=bytes.subarray(i*Large.CHUNK_BYTES,Math.min((i+1)*Large.CHUNK_BYTES,bytes.length));
  await store.large.append(who,start.upload.uploadId,i,part,Large.sha(part));
 }
 const result=await store.large.finish(who,start.upload.uploadId);
 assert.equal(result.file.id,'m_'+sha256.slice(0,40));
 return result.file.id;
}
async function race(store,mediaId,legacy,deleteFirst=false){
 const revision=legacy?1:0;
 const save=()=>store.writeWorkspace(email,0,library(mediaId));
 const remove=()=>store.removeMediaIfUnlinked(email,mediaId,revision);
 const jobs=deleteFirst?[remove(),save()]:[save(),remove()];
 const settled=await Promise.allSettled(jobs);
 const states=settled.map(result=>result.status==='rejected'?
  {ok:false,error:result.reason?.code||result.reason?.message}:
  {ok:!result.value.conflict,code:result.value.code||null});
 assert.equal(states.filter(s=>s.ok).length,1,JSON.stringify(states));
 const ws=await store.readWorkspace(email);
 const linked=(ws.modules.library||[]).some(row=>row.mediaId===mediaId);
 const vault=await store.readMedia(email);
 const present=legacy?vault.items.some(row=>row.id===mediaId):!!await store.large.get(email,mediaId);
 assert.equal(linked,present,'linked asset must exist after both competing writes');
 assert.equal(states.length,2);
 return states;
}
test('R26 memory: linking before deleting a legacy file cannot orphan the Library',async()=>{
 const store=createMemoryStore(),id=await prepareLegacy(store);
 const result=await race(store,id,true,false);
 assert.equal(result[0].ok,true);
 assert.equal(result[1].code,'media_still_linked_to_library');
});
test('R26 memory: deleting before linking a legacy file rejects a stale asset',async()=>{
 const store=createMemoryStore(),id=await prepareLegacy(store);
 const result=await race(store,id,true,true);
 assert.equal(result[0].ok,true);
 assert.equal(result[1].error,'unknown_library_media');
});
test('R26 memory: large-file linking and deletion use the same per-account fence',async()=>{
 const store=createMemoryStore(),id=await prepareLarge(store);
 await race(store,id,false,false);
});
test('R26 memory: stale revisions and cross-account references fail closed',async()=>{
 const store=createMemoryStore(),id=await prepareLegacy(store);
 assert.deepEqual(await store.removeMediaIfUnlinked(email,id,999),
  {conflict:true,code:'media_revision_conflict'});
 assert.deepEqual(await store.removeMediaIfUnlinked(other,id,0),
  {conflict:true,code:'media_not_found'});
 await assert.rejects(()=>store.writeWorkspace(other,0,library(id)),/unknown_library_media/);
 const results=await Promise.all(Array.from({length:8},(_,n)=>
  store.writeWorkspace(email,0,{library:[],settings:[{id:'row'+n,name:'Settings'}]})));
 assert.equal(results.filter(x=>!x.conflict).length,1);
 assert.equal((await store.readWorkspace(email)).revision,1);
});

class FakeCollection{
 constructor(name){this.name=name;this.rows=new Map();}
 async createIndex(){return this.name+'_idx';}
 matches(row,query){return Object.entries(query).every(([k,v])=>row[k]===v);}
 async findOne(query){return [...this.rows.values()].find(row=>this.matches(row,query))||null;}
 find(query){
  const rows=[...this.rows.values()].filter(row=>this.matches(row,query));
  return {async toArray(){return rows;},
   sort({index=1}){return{async *[Symbol.asyncIterator](){
    for(const row of rows.sort((a,b)=>(a.index-b.index)*index))yield row;
   }}}
  };
 }
 async insertOne(row){
  if(this.rows.has(row._id)||
    (this.name==='cloud_large_media_uploads'&&[...this.rows.values()].some(x=>x.owner===row.owner))){
   const error=Error('duplicate_key');error.code=11000;throw error;
  }
  this.rows.set(row._id,{...row});return{insertedId:row._id};
 }
 async replaceOne(filter,row){
  const old=await this.findOne(filter);
  if(!old)return {matchedCount:0};
  this.rows.set(old._id,{...row});return {matchedCount:1};
 }
 async updateOne(query,updates,options={}){
  let row=await this.findOne(query);
  if(!row&&!options.upsert)return{matchedCount:0};
  if(!row){
   row={...query};
   if(this.rows.has(row._id)){const err=Error('duplicate_key');err.code=11000;throw err;}
   this.rows.set(row._id,row);
  }
  this.modify(row,updates);return{matchedCount:1};
 }
 modify(row,updates){
  for(const [k,v] of Object.entries(updates.$set||{}))row[k]=v;
  for(const [k,v] of Object.entries(updates.$inc||{}))row[k]=(row[k]||0)+v;
  for(const k of Object.keys(updates.$unset||{}))delete row[k];
 }
 async updateMany(query,updates){
  let count=0;for(const row of this.rows.values())if(this.matches(row,query)){this.modify(row,updates);count++;}
  return{matchedCount:count};
 }
 async deleteOne(query){
  const row=await this.findOne(query);
  if(!row)return{deletedCount:0};
  this.rows.delete(row._id);return{deletedCount:1};
 }
 async deleteMany(query){
  let count=0;
  for(const row of [...this.rows.values()])if(this.matches(row,query)){
   this.rows.delete(row._id);count++;
  }
  return{deletedCount:count};
 }
}
class FakeClient {
 static last=null;
 constructor(){this.collections=new Map();this.stats={transactions:0,closedSessions:0};this.lock=Promise.resolve();FakeClient.last=this;}
 async connect(){return this;}
 db(){return{collection:name=>{
  if(!this.collections.has(name))this.collections.set(name,new FakeCollection(name));
  return this.collections.get(name);
 }};}
 startSession(){
  return {withTransaction:async operation=>{
   const previous=this.lock;let release;
   this.lock=new Promise(resolve=>{release=resolve;});
   await previous;
   this.stats.transactions++;
   const before=new Map([...this.collections].map(([name,col])=>
    [name,new Map([...col.rows].map(([key,item])=>[key,structuredClone(item)]))]));
   try{await operation();}
   catch(error){
    for(const [name,rows] of before)this.collections.get(name).rows=rows;
    throw error;
   }finally{release();}
  },endSession:async()=>{this.stats.closedSessions++;}};
 }
 async close(){}
}
async function mongo(){
 const store=await createMongoStore('mongodb://127.0.0.1:27017',
  {driver:{MongoClient:FakeClient}});
 return {store,client:FakeClient.last};
}
test('R26 Mongo: concurrent legacy-file link vs deletion is atomic',async()=>{
 const {store,client}=await mongo();
 try{
  const id=await prepareLegacy(store);
  await race(store,id,true,false);
  assert.ok(client.stats.transactions>=2);
  assert.equal(client.stats.transactions,client.stats.closedSessions);
  assert.equal(client.collections.get('cloud_media_integrity_fences').rows.size,1);
 }finally{await store.close();}
});
test('R26 Mongo: deletion first prevents creation of a dangling link',async()=>{
 const {store}=await mongo();
 try{
  const id=await prepareLegacy(store);
  await race(store,id,true,true);
 }finally{await store.close();}
});
test('R26 Mongo: large media reference and atomic chunk cleanup',async()=>{
 const {store,client}=await mongo();
 try{
  const id=await prepareLarge(store);
  await race(store,id,false,false);
  const linked=await store.readWorkspace(email);
  assert.ok(linked.modules.library?.length);
  assert.equal(client.collections.get('cloud_large_media_files').rows.size,1);
  assert.equal(client.collections.get('cloud_large_media_chunks').rows.size,2);
 }finally{await store.close();}
});
test('R26 Mongo: unrelated accounts cannot borrow each others media IDs',async()=>{
 const {store}=await mongo();
 try{
  const id=await prepareLegacy(store);
  await assert.rejects(()=>store.writeWorkspace(other,0,library(id)),/unknown_library_media/);
  const r=await store.removeMediaIfUnlinked(other,id,0);
  assert.equal(r.code,'media_not_found');
  assert.equal((await store.readMedia(email)).items.length,1);
 }finally{await store.close();}
});
