'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMemoryStore,createMongoStore}=require('../store');
const Large=require('../large-media-domain'),Media=require('../media-domain');
const Quota=require('../media-quota');
const {FakeClient,sharedState}=require('./helpers/fake-mongo');
const ACCOUNT='quota@example.org',OTHER='other@example.org';
function png(size=640*1024){
 const bytes=Buffer.alloc(size,0x41);
 Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
 return bytes;
}
function small(size=640*1024){
 const b=png(size);
 return Media.decode({name:'small.png',mime:'image/png',base64:b.toString('base64'),sha256:Media.sha(b)});
}
function spec(size=1024*1024,seed='f'){
 return {name:'large.png',mime:'image/png',size,sha256:seed.repeat(64)};
}
async function mongo(shared=null){
 FakeClient.shared=shared;
 const store=await createMongoStore('mongodb://127.0.0.1:27017',{driver:{MongoClient:FakeClient}});
 return {store,client:FakeClient.last};
}
async function injectReady(client,who,size,seed='a'){
 const owner=Large.ownerId(who),id='m_'+seed.repeat(40);
 await client.collections.get('cloud_large_media_files').insertOne({
  _id:owner+':'+id,owner,id,status:'ready',name:'existing.png',mime:'image/png',
  sha256:seed.repeat(64),size,uploadedAt:new Date().toISOString(),uploadId:'0'.repeat(32)});
 return id;
}
test('R27 pure: quota includes pending reservation, exact boundary and bad state',()=>{
 const used=[{size:Large.MAX_ACCOUNT-1024*1024}],reserved={size:1024*1024};
 assert.equal(Quota.enforce(used,[],reserved).availableBytes,0);
 assert.equal(Quota.budget(used,[],null).availableBytes,1024*1024);
 assert.throws(()=>Quota.enforce(used,[],{size:1024*1024+1}),/media_storage_quota/);
 assert.throws(()=>Quota.enforce(Array.from({length:60},()=>({size:1})),[],{size:1}),/media_item_quota/);
 assert.throws(()=>Quota.enforce([{size:-1}]),/media_quota_state_invalid/);
 assert.throws(()=>Quota.enforce([{size:Number.NaN}]),/media_quota_state_invalid/);
});
test('R27 Mongo: a large pending upload reserves space against legacy media',async()=>{
 const {store,client}=await mongo();
 try{
  await injectReady(client,ACCOUNT,Large.MAX_ACCOUNT-1258291); // 1.2 MiB free
  const opened=await store.beginMediaUpload(ACCOUNT,spec(1024*1024,'f'));
  assert.match(opened.upload.uploadId,/^[a-f0-9]{32}$/);
  const item=small(512*1024);
  await assert.rejects(()=>store.addLegacyMedia(ACCOUNT,item,0),/media_storage_quota/);
  assert.equal((await store.readMedia(ACCOUNT)).revision,0);
  assert.equal((await store.large.status(ACCOUNT)).uploadId,opened.upload.uploadId);
  await store.cancelMediaUpload(ACCOUNT,opened.upload.uploadId);
  assert.equal((await store.large.status(ACCOUNT)),null);
  const saved=await store.addLegacyMedia(ACCOUNT,item,0);
  assert.equal(saved.conflict,false);assert.equal(saved.revision,1);
  assert.equal((await store.readMedia(ACCOUNT)).items.length,1);
 }finally{await store.close();}
});
test('R27 Mongo: legacy media consumes space before a large reservation can begin',async()=>{
 const {store,client}=await mongo();
 try{
  await injectReady(client,ACCOUNT,Large.MAX_ACCOUNT-1258291);
  const item=small(512*1024);
  assert.equal((await store.addLegacyMedia(ACCOUNT,item,0)).conflict,false);
  await assert.rejects(()=>store.beginMediaUpload(ACCOUNT,spec(1024*1024,'f')),/media_storage_quota/);
  assert.equal(await store.large.status(ACCOUNT),null);
 }finally{await store.close();}
});
test('R27 Mongo: two service instances racing small and large files cannot overcommit',async()=>{
 const one=await mongo(),two=await mongo(one.client.state);
 try{
  await injectReady(one.client,ACCOUNT,Large.MAX_ACCOUNT-1258291);
  const result=await Promise.allSettled([
   one.store.beginMediaUpload(ACCOUNT,spec(1024*1024,'e')),
   two.store.addLegacyMedia(ACCOUNT,small(512*1024),0)
  ]);
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1,
   'only one operation fits remaining storage');
  const ready=(await one.store.large.list(ACCOUNT)).reduce((n,row)=>n+row.size,0);
  const legacy=(await one.store.readMedia(ACCOUNT)).items.reduce((n,row)=>n+row.size,0);
  const pending=await two.store.large.status(ACCOUNT);
  assert(ready+legacy+(pending?.size||0)<=Large.MAX_ACCOUNT);
  assert.equal(one.client.stats.transactions,one.client.stats.closedSessions);
 }finally{await Promise.all([one.store.close(),two.store.close()]);}
});
test('R27 Mongo: one active upload per account across service instances',async()=>{
 const one=await mongo(),two=await mongo(one.client.state);
 try{
  const results=await Promise.allSettled([
   one.store.beginMediaUpload(ACCOUNT,spec(900000,'d')),
   two.store.beginMediaUpload(ACCOUNT,spec(950000,'c'))
  ]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  const pending=await one.store.large.status(ACCOUNT);
  assert(pending&&pending.uploadId);
  assert.equal((await two.store.large.status(OTHER)),null);
  const resumed=await two.store.beginMediaUpload(ACCOUNT,{
   name:pending.name,mime:pending.mime,size:pending.size,sha256:pending.sha256
  });
  assert.equal(resumed.resumed,true);
  assert.equal(resumed.upload.uploadId,pending.uploadId);
 }finally{await Promise.all([one.store.close(),two.store.close()]);}
});
test('R27 Mongo: finalization rechecks capacity after external reconciliation',async()=>{
 const {store,client}=await mongo();
 try{
  const b=png(300123),sha=Large.sha(b),opened=await store.beginMediaUpload(ACCOUNT,{
   name:'full.png',mime:'image/png',size:b.length,sha256:sha
  }),id=opened.upload.uploadId;
  for(let i=0;i<opened.upload.totalChunks;i++){
   const part=b.subarray(i*Large.CHUNK_BYTES,Math.min((i+1)*Large.CHUNK_BYTES,b.length));
   await store.large.append(ACCOUNT,id,i,part,Large.sha(part));
  }
  // Simulates an older writer or a reconciliation job that ignored the
  // reservation; a resilient finish must never turn overquota data READY.
  await injectReady(client,ACCOUNT,Large.MAX_ACCOUNT-128000,'b');
  await assert.rejects(()=>store.completeMediaUpload(ACCOUNT,id),/media_storage_quota/);
  assert.equal((await store.large.list(ACCOUNT)).length,1);
  assert.equal((await store.large.status(ACCOUNT)).uploadId,id);
  await store.cancelMediaUpload(ACCOUNT,id);
  assert.equal((await store.large.status(ACCOUNT)),null);
  assert.equal(client.collections.get('cloud_large_media_uploads').rows.size,0);
 }finally{await store.close();}
});
test('R27 Mongo: simulated transaction abort leaves no phantom reservation',async()=>{
 const {store,client}=await mongo();
 try{
  client.state.failNext=true;
  await assert.rejects(()=>store.beginMediaUpload(ACCOUNT,spec(204800,'d')),/simulated_transaction_abort/);
  assert.equal(await store.large.status(ACCOUNT),null);
  const result=await store.beginMediaUpload(ACCOUNT,spec(204800,'d'));
  assert(result.upload.uploadId);
 }finally{await store.close();}
});
test('R27 memory: serialised reservations and legacy uploads avoid duplicate capacity',async()=>{
 const store=createMemoryStore(),item=small(4096);
 try{
  const begun=await store.beginMediaUpload(ACCOUNT,spec(1048576,'c'));
  assert(begun.upload.uploadId);
  const added=await store.addLegacyMedia(ACCOUNT,item,0);
  assert.equal(added.conflict,false);
  const again=await store.addLegacyMedia(ACCOUNT,item,1);
  assert.equal(again.duplicate,true);
  assert.equal((await store.readMedia(ACCOUNT)).revision,1);
  const second=await store.beginMediaUpload(ACCOUNT,spec(1048576,'c'));
  assert.equal(second.resumed,true);
  await store.cancelMediaUpload(ACCOUNT,begun.upload.uploadId);
  assert.equal((await store.large.status(ACCOUNT)),null);
 }finally{await store.close();}
});
test('R27 HTTP media list reports reserved capacity with no other-tenant leakage',async()=>{
 const {createServer}=require('../server');
 const store=createMemoryStore(),license='quota-test',hash=require('node:crypto').createHash('sha256').update(license).digest('hex');
 const server=createServer({store,resolvePortal:async req=>{
  const c=req.headers.cookie==='a'?'a@example.org':req.headers.cookie==='b'?'b@example.org':null;
  return c?{email:c,sessionId:'a'.repeat(64),expiresAt:Date.now()+60000}:null;
 },verifyDevKey:async (email,key,fp)=>key===license?{keyHash:hash}:key===null&&fp===hash});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const call=async(path,who='a',method='GET',data=null)=>{
  const response=await fetch(base+path,{method,headers:{Cookie:who,...(method!=='GET'?{Origin:base,'Content-Type':'application/json'}:{})},
   ...(method!=='GET'?{body:JSON.stringify(data||{})}:{})});
  return {status:response.status,json:await response.json()};
 };
 try{
  await call('/api/dev/activate','a','POST',{key:license});
  await call('/api/dev/activate','b','POST',{key:license});
  const opened=await call('/api/media/uploads','a','POST',spec(1048576,'e'));
  assert.equal(opened.status,200);
  const r=await call('/api/media');
  assert.equal(r.status,200);assert.equal(r.json.reservedBytes,1048576);
  assert.equal(r.json.availableBytes,Large.MAX_ACCOUNT-1048576);
  const other=await call('/api/media','b');
  assert.equal(other.json.reservedBytes,0);assert.equal(other.json.availableBytes,Large.MAX_ACCOUNT);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
