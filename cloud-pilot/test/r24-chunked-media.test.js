'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createServer}=require('../server'),{createMemoryStore}=require('../store');
const D=require('../large-media-domain');
const LICENSE='qa-r24-dev-key',FP=crypto.createHash('sha256').update(LICENSE).digest('hex');
async function fixture(){
 const store=createMemoryStore();
 const server=createServer({store,resolvePortal:async req=>{
  const who=String(req.headers.cookie||'').match(/zv_portal=([ab])/i)?.[1];
  return who?{email:who.toLowerCase()+'@example.org',sessionId:who.toLowerCase().repeat(64),expiresAt:Date.now()+600000}:null;
 },verifyDevKey:async(email,raw,hash)=>{
  if(!['a@example.org','b@example.org'].includes(email))return false;
  if(raw===LICENSE)return {keyHash:FP};
  return raw===null&&hash===FP;
 }});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const root='http://127.0.0.1:'+server.address().port;
 async function call(route,options={}){
  const {method='GET',who='a',json,bytes,sha,origin=root}=options;
  const headers={Cookie:'zv_portal='+who};
  if(method!=='GET'&&method!=='HEAD'){
   headers.Origin=origin;
   headers['Content-Type']=bytes?'application/octet-stream':'application/json';
   if(sha)headers['X-Chunk-Sha256']=sha;
  }
  const response=await fetch(root+route,{method,headers,...(method==='GET'||method==='HEAD'?{}:{body:bytes||JSON.stringify(json||{})})});
  let data={};
  if((response.headers.get('content-type')||'').includes('application/json'))data=await response.json();
  return {status:response.status,data,response};
 }
 const close=()=>new Promise(resolve=>server.close(resolve));
 return {server,store,call,close};
}
const png=()=>{
 const data=Buffer.alloc(D.CHUNK_BYTES+11315);
 Buffer.from([137,80,78,71,13,10,26,10]).copy(data);
 for(let i=8;i<data.length;i++)data[i]=(i*17)%251;
 return data;
};
const metadata=bytes=>({name:'r24-test.png',mime:'image/png',size:bytes.length,sha256:D.sha(bytes)});
test('R24: authenticated upload, resume, per-chunk SHA, finalize, download and Library link',async()=>{
 const {call,close}=await fixture();
 const data=png(),meta=metadata(data);
 try{
  assert.equal((await call('/api/media')).status,403);
  assert.equal((await call('/api/dev/activate',{method:'POST',json:{key:LICENSE}})).status,200);
  assert.equal((await call('/api/dev/activate',{method:'POST',who:'b',json:{key:LICENSE}})).status,200);
  assert.equal((await call('/api/media/uploads',{method:'POST',json:meta,origin:'https://evil.example'})).status,403);
  let r=await call('/api/media/uploads',{method:'POST',json:meta});
  assert.equal(r.status,200);assert.equal(r.data.upload.totalChunks,2);
  const id=r.data.upload.uploadId;
  assert.match(id,/^[a-f0-9]{32}$/);
  assert.equal((await call('/api/media/uploads',{who:'b'})).data.upload,null);
  r=await call('/api/media');assert.equal(r.data.items.length,0);
  const first=data.subarray(0,D.CHUNK_BYTES);
  r=await call('/api/media/uploads/'+id+'/0',{method:'PUT',bytes:first,sha:'f'.repeat(64)});
  assert.equal(r.status,422);assert.equal(r.data.error,'chunk_integrity_failed');
  r=await call('/api/media/uploads/'+id+'/0',{method:'PUT',bytes:first,sha:D.sha(first)});
  assert.equal(r.status,200);assert.equal(r.data.upload.nextIndex,1);
  r=await call('/api/media/uploads/'+id+'/0',{method:'PUT',bytes:first,sha:D.sha(first)});
  assert.equal(r.status,200);assert.equal(r.data.upload.nextIndex,1);
  r=await call('/api/media/uploads/'+id+'/complete',{method:'POST'});
  assert.equal(r.status,409);assert.equal(r.data.error,'upload_incomplete');
  const next=data.subarray(D.CHUNK_BYTES);
  r=await call('/api/media/uploads/'+id+'/1',{method:'PUT',bytes:next,sha:D.sha(next)});
  assert.equal(r.status,200);assert.equal(r.data.upload.receivedBytes,data.length);
  r=await call('/api/media/uploads/'+id+'/complete',{method:'POST'});
  assert.equal(r.status,200);const mediaId=r.data.mediaId;
  assert.equal(mediaId,'m_'+meta.sha256.slice(0,40));
  assert.equal(r.data.items[0].storage,'chunked');
  assert.equal((await call('/api/media/uploads')).data.upload,null);
  r=await call('/api/media/'+mediaId);
  assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.response.arrayBuffer()),data);
  assert.match(r.response.headers.get('content-disposition'),/inline/);
  assert.equal((await call('/api/media/'+mediaId,{who:'b'})).status,404);
  r=await call('/api/workspace/library',{method:'PUT',json:{revision:0,
   records:[{id:'cloud_photo',name:'Foto',kind:'image',mediaId,contentStatus:'ready'}]}});
  assert.equal(r.status,200);
  r=await call('/api/media/'+mediaId,{method:'DELETE',json:{revision:0}});
  assert.equal(r.status,409);assert.equal(r.data.error,'media_still_linked_to_library');
  assert.equal((await call('/api/workspace/library',{who:'b'})).data.records.length,0);
  r=await call('/api/workspace/library',{method:'PUT',json:{revision:1,records:[]}});
  assert.equal(r.status,200);
  r=await call('/api/media/'+mediaId,{method:'DELETE',json:{revision:0}});
  assert.equal(r.status,200);assert.equal(r.data.items.length,0);
  assert.equal((await call('/api/media/'+mediaId)).status,404);
  assert.equal((await call('/api/send',{method:'POST'})).status,404);
 }finally{await close();}
});
test('R24: interrupted upload remains resumable and cancel clears temporary parts',async()=>{
 const {call,close}=await fixture();
 try{
  await call('/api/dev/activate',{method:'POST',json:{key:LICENSE}});
  const data=png(),meta=metadata(data);
  let r=await call('/api/media/uploads',{method:'POST',json:meta});
  const uploadId=r.data.upload.uploadId;
  const part=data.subarray(0,D.CHUNK_BYTES);
  r=await call('/api/media/uploads/'+uploadId+'/0',{method:'PUT',bytes:part,sha:D.sha(part)});
  assert.equal(r.status,200);
  r=await call('/api/media/uploads',{method:'POST',json:meta});
  assert.equal(r.status,200);assert.equal(r.data.resumed,true);assert.equal(r.data.upload.nextIndex,1);
  r=await call('/api/media/uploads',{method:'POST',json:{...meta,name:'different.png'}});
  assert.equal(r.status,409);assert.equal(r.data.error,'upload_already_active');
  assert.equal((await call('/api/media/uploads/'+uploadId,{method:'DELETE',who:'b'})).status,401 /* B not activated */);
  r=await call('/api/media/uploads/'+uploadId,{method:'DELETE'});
  assert.equal(r.status,200);
  assert.equal((await call('/api/media/uploads')).data.upload,null);
  assert.equal((await call('/api/media')).data.items.length,0);
 }finally{await close();}
});
test('R24: file quotas, magic bytes and invalid data fail closed',async()=>{
 const {call,close}=await fixture();
 try{
  await call('/api/dev/activate',{method:'POST',json:{key:LICENSE}});
  let r=await call('/api/media/uploads',{method:'POST',json:{name:'huge.png',mime:'image/png',
   size:D.MAX_FILE+1,sha256:'f'.repeat(64)}});
  assert.equal(r.status,413);assert.equal(r.data.error,'large_media_limit');
  const data=Buffer.alloc(18000,0x41),meta={name:'fake.png',mime:'image/png',size:data.length,sha256:D.sha(data)};
  r=await call('/api/media/uploads',{method:'POST',json:meta});const id=r.data.upload.uploadId;
  r=await call('/api/media/uploads/'+id+'/0',{method:'PUT',bytes:data,sha:D.sha(data)});
  assert.equal(r.status,200);
  r=await call('/api/media/uploads/'+id+'/complete',{method:'POST'});
  assert.equal(r.status,422);assert.equal(r.data.error,'media_signature_invalid');
  assert.equal((await call('/api/media')).data.items.length,0);
  await call('/api/media/uploads/'+id,{method:'DELETE'});
 }finally{await close();}
});
test('R24: pure protocol enforces limits, chunk count and duplicate identification',()=>{
 const bytes=png(),spec=D.specOf(metadata(bytes));
 assert.equal(spec.chunks,2);
 assert.equal(D.expectedSize(spec,0),D.CHUNK_BYTES);
 assert.equal(D.expectedSize(spec,1),11315);
 assert.throws(()=>D.expectedSize(spec,2),/invalid_chunk_index/);
 assert.throws(()=>D.validateChunk(spec,0,bytes.subarray(0,100),D.sha(bytes.subarray(0,100))),/invalid_chunk_size/);
 assert.throws(()=>D.specOf({...metadata(bytes),mime:'text/html'}),/media_type_denied/);
 assert.throws(()=>D.specOf({...metadata(bytes),name:'../unsafe.png'}),/invalid_media_name/);
 const fake={revision:0,items:[]};
 assert.equal(D.combined(fake,[]).maxFileBytes,D.MAX_FILE);
 assert.equal(D.combined(fake,[]).quotaBytes,D.MAX_ACCOUNT);
});
