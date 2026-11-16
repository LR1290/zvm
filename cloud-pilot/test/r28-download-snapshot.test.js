'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createServer}=require('../server'),{createMemoryStore}=require('../store');
const Large=require('../large-media-domain');
const {verifiedSnapshot,createDownloadGate}=require('../verified-media-download');
const TOKEN='r28-qa-key',KEY_HASH=crypto.createHash('sha256').update(TOKEN).digest('hex');
const OWNER='a@example.org';
function image(size=Large.CHUNK_BYTES+19017){
 const data=Buffer.alloc(size,0x59);
 Buffer.from([137,80,78,71,13,10,26,10]).copy(data);
 return data;
}
function chunks(bytes){
 const parts=[];
 for(let at=0;at<bytes.length;at+=Large.CHUNK_BYTES)
  parts.push(Buffer.from(bytes.subarray(at,Math.min(at+Large.CHUNK_BYTES,bytes.length))));
 return parts;
}
function fixture(bytes=image()){
 const parts=chunks(bytes),file={id:'m_'+Large.sha(bytes).slice(0,40),
  name:'foto.png',mime:'image/png',size:bytes.length,sha256:Large.sha(bytes)};
 const store={large:{async *chunks(email,id){
  if(email!==OWNER||id!==file.id)return;
  for(const part of parts)yield Buffer.from(part);
 }}};
 return {parts,file,store,bytes};
}
test('R28: GET uses exactly the verified immutable snapshot, not a second DB read',async()=>{
 const f=fixture();
 let reads=0;
 const original=f.store.large.chunks;
 f.store.large.chunks=async function* (...args){reads++;yield* original(...args);};
 const bytes=await verifiedSnapshot(f.store,OWNER,f.file);
 assert.deepEqual(bytes,f.bytes);
 assert.equal(reads,1);
 f.parts[0].fill(0); // simulate a deleted/reused Mongo chunk after snapshot.
 assert.deepEqual(bytes,f.bytes);
});
test('R28: corruption, truncated chunks, extra chunks and wrong MIME fail before headers',async()=>{
 const f=fixture();
 f.parts[1].fill(0);
 await assert.rejects(()=>verifiedSnapshot(f.store,OWNER,f.file),/large_media_integrity_failed/);
 const g=fixture();
 g.parts.pop();
 await assert.rejects(()=>verifiedSnapshot(g.store,OWNER,g.file),/large_media_integrity_failed/);
 const h=fixture();
 h.parts.push(Buffer.from('extra'));
 await assert.rejects(()=>verifiedSnapshot(h.store,OWNER,h.file),/large_media_corrupt_chunk/);
 const m=fixture();
 m.file.mime='image/jpeg';
 await assert.rejects(()=>verifiedSnapshot(m.store,OWNER,m.file),/large_media_integrity_failed/);
 const over=fixture();
 over.file.size=Large.MAX_FILE+1;
 await assert.rejects(()=>verifiedSnapshot(over.store,OWNER,over.file),/large_media_metadata_invalid/);
 const abort=fixture();
 await assert.rejects(()=>verifiedSnapshot(abort.store,OWNER,abort.file,{cancelled:()=>true}),/download_aborted/);
});
test('R28: download quota is per worker, per tenant and released once',()=>{
 const gate=createDownloadGate({maxConcurrent:2,maxPerAccount:1});
 const a=gate.acquire(OWNER);
 assert.throws(()=>gate.acquire(OWNER),/download_busy/);
 const b=gate.acquire('b@example.org');
 assert.equal(gate.stats().active,2);
 assert.throws(()=>gate.acquire('c@example.org'),/download_busy/);
 a();a();assert.equal(gate.stats().active,1);
 const c=gate.acquire('c@example.org');
 c();b();
 assert.deepEqual(gate.stats(),{active:0,maxConcurrent:2,activeAccounts:0});
});
async function serverFixture(){
 const store=createMemoryStore(),data=image(),meta={
  name:'foto.png',mime:'image/png',size:data.length,sha256:Large.sha(data)
 };
 const begun=await store.beginMediaUpload(OWNER,meta);
 for(let i=0;i<begun.upload.totalChunks;i++){
  const bytes=data.subarray(i*Large.CHUNK_BYTES,Math.min((i+1)*Large.CHUNK_BYTES,data.length));
  await store.large.append(OWNER,begun.upload.uploadId,i,bytes,Large.sha(bytes));
 }
 const ready=await store.completeMediaUpload(OWNER,begun.upload.uploadId);
 const server=createServer({store,resolvePortal:async req=>{
  const email=req.headers.cookie==='a'?OWNER:req.headers.cookie==='b'?'b@example.org':null;
  return email?{email,sessionId:'a'.repeat(64),expiresAt:Date.now()+60000}:null;
 },verifyDevKey:async(email,key,hash)=>key===TOKEN?{keyHash:KEY_HASH}:key===null&&hash===KEY_HASH});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const request=(path,who='a',method='GET',body)=>{
  const headers={Cookie:who};
  if(method!=='GET'&&method!=='HEAD'){
   headers.Origin=base;headers['Content-Type']='application/json';
  }
  return fetch(base+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
 };
 for(const who of ['a','b']){
  const response=await request('/api/dev/activate',who,'POST',{key:TOKEN});
  assert.equal(response.status,200);
 }
 const close=()=>new Promise(resolve=>server.close(resolve));
 return {store,data,mediaId:ready.file.id,request,close};
}
test('R28: real Node HTTP HEAD/GET, tenant isolation and no truncated 200 after concurrent delete',async()=>{
 const f=await serverFixture();
 try{
  const path='/api/media/'+f.mediaId;
  let response=await f.request(path,'a','HEAD');
  assert.equal(response.status,200);
  assert.equal(Number(response.headers.get('content-length')),f.data.length);
  assert.equal((await response.arrayBuffer()).byteLength,0);
  response=await f.request(path,'b');
  assert.equal(response.status,404);
  let triggered=false;
  const original=f.store.large.chunks.bind(f.store.large);
  f.store.large.chunks=async function* (email,id){
   for await(const part of original(email,id)){
    if(!triggered){
     triggered=true;
     yield part;
     const deleted=await f.store.removeMediaIfUnlinked(OWNER,id,0);
     assert.equal(deleted.conflict,false);
     return; // Mongo might stop yielding once deleted.
    }
    yield part;
   }
  };
  response=await f.request(path);
  assert.equal(response.status,503,'reject before announcing a successful download');
  const body=await response.json();
  assert.equal(body.error,'large_media_integrity_failed');
  assert.equal((await f.request(path)).status,404);
 }finally{await f.close();}
});
test('R28: HTTP concurrency gives retryable 429 and releases lease after full response',async()=>{
 const f=await serverFixture();
 try{
  const path='/api/media/'+f.mediaId;
  const original=f.store.large.chunks.bind(f.store.large);
  let unblock;const hold=new Promise(resolve=>{unblock=resolve;});
  let entered;const ready=new Promise(resolve=>{entered=resolve;});
  let first=true;
  f.store.large.chunks=async function* (email,id){
   if(first){first=false;entered();await hold;}
   yield* original(email,id);
  };
  const firstGet=f.request(path);
  await ready;
  const busy=await f.request(path);
  assert.equal(busy.status,429);
  assert.equal(busy.headers.get('retry-after'),'2');
  assert.equal((await busy.json()).error,'download_busy');
  unblock();
  const response=await firstGet;
  assert.equal(response.status,200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.data);
  const another=await f.request(path);
  assert.equal(another.status,200);
  assert.deepEqual(Buffer.from(await another.arrayBuffer()),f.data);
 }finally{await f.close();}
});

test('R28: Mongo cursor is actively closed when the browser aborts',async()=>{
 const {createMongoLargeMediaStore}=require('../large-media-store');
 const {FakeClient}=require('./helpers/fake-mongo');
 FakeClient.shared=null;
 const client=new FakeClient();
 const db=client.db('zvm_cloud_pilot');
 const owner=Large.ownerId(OWNER);
 const data=image(),sha=Large.sha(data),id='m_'+sha.slice(0,40);
 await db.collection('cloud_large_media_files').insertOne({
  _id:owner+':'+id,owner,id,status:'ready',uploadId:'f'.repeat(32),
  name:'foto.png',mime:'image/png',size:data.length,sha256:sha
 });
 const parts=chunks(data);
 let release,closed=0;
 const waiting=new Promise(resolve=>{release=resolve;});
 const collection=db.collection('cloud_large_media_chunks');
 collection.find=()=>({sort:()=>({
  async *[Symbol.asyncIterator](){
   yield {index:0,bytes:parts[0]};
   await waiting;
   yield {index:1,bytes:parts[1]};
  },
  async close(){closed++;release();}
 })});
 const large=await createMongoLargeMediaStore(db,client);
 const aborter=new AbortController();
 const cursor=large.chunks(OWNER,id,{signal:aborter.signal});
 const first=await cursor.next();
 assert.equal(first.done,false);
 const next=cursor.next();
 aborter.abort();
 await assert.rejects(next,/download_aborted/);
 assert(closed>=1,'Mongo cursor must be closed on abort');
});
