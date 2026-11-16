'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createServer}=require('../server'),{createMemoryStore}=require('../store'),Media=require('../media-domain');
const LICENSE='valid-dev-license';
function fixture(){
 const store=createMemoryStore(),sessions=new Map([['a',{email:'a@example.org',id:'a'.repeat(64)}],['b',{email:'b@example.org',id:'b'.repeat(64)}]]);
 const fp=crypto.createHash('sha256').update(LICENSE).digest('hex');
 const server=createServer({store,resolvePortal:async req=>{
  const cookie=String(req.headers.cookie||'').match(/zv_portal=([ab])/),user=sessions.get(cookie?.[1]);
  return user?{email:user.email,sessionId:user.id,expiresAt:Date.now()+3600000}:null;
 },verifyDevKey:async(_email,code,hash)=>code===LICENSE?{keyHash:fp}:code===null&&hash===fp});
 return {store,server};
}
async function boot(server){await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;}
function client(root,user='a'){
 const cookie='zv_portal='+user;
 return async(path,method='GET',body)=>{
  const response=await fetch(root+path,{method,headers:{Cookie:cookie,...(method==='GET'?{}:{Origin:root,'Content-Type':'application/json'})},...(method==='GET'?{}:{body:JSON.stringify(body||{})})});
  let json={};if((response.headers.get('content-type')||'').includes('application/json'))json=await response.json();
  return {status:response.status,json,response};
 };
}
test('private media: DEV gate, SHA integrity, cross-account isolation, deletion CAS',async()=>{
 const {server}=fixture(),root=await boot(server),a=client(root),b=client(root,'b');
 const payload=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB','base64');
 const input={revision:0,name:'foto.png',mime:'image/png',base64:payload.toString('base64'),sha256:Media.sha(payload)};
 try{
  let r=await a('/api/media');assert.equal(r.status,403);
  r=await a('/api/dev/activate','POST',{key:LICENSE});assert.equal(r.status,200);
  r=await b('/api/dev/activate','POST',{key:LICENSE});assert.equal(r.status,200);
  r=await a('/api/media','POST',input);assert.equal(r.status,200);const id=r.json.mediaId;
  assert.equal(r.json.usedBytes,payload.length);assert.equal(r.json.items.length,1);
  r=await a('/api/media');assert.equal(r.json.items[0].name,'foto.png');assert.equal(r.json.items[0].bytes,undefined);
  r=await b('/api/media');assert.equal(r.json.items.length,0);
  r=await b('/api/media/'+id);assert.equal(r.status,404);
  r=await a('/api/media/'+id);assert.equal(r.status,200);
  assert.deepEqual(Buffer.from(await r.response.arrayBuffer()),payload);
  assert.match(r.response.headers.get('content-disposition'),/attachment/);
  r=await a('/api/media','POST',input);assert.equal(r.status,409); // outdated revision
  r=await a('/api/media','POST',{...input,revision:1});assert.equal(r.json.duplicate,true);
  r=await a('/api/workspace/library','PUT',{revision:0,records:[{id:'media1',name:'Image',kind:'image',mediaId:id,contentStatus:'ready'}]});
  assert.equal(r.status,200);
  r=await a('/api/media/'+id,'DELETE',{revision:1});assert.equal(r.status,409);
  assert.equal(r.json.error,'media_still_linked_to_library');
  r=await a('/api/workspace/library','PUT',{revision:1,records:[{id:'media1',name:'Image',kind:'image',contentStatus:'missing_source'}]});
  assert.equal(r.status,200);
  r=await a('/api/media/'+id,'DELETE',{revision:1});assert.equal(r.status,200);
  r=await a('/api/media/'+id);assert.equal(r.status,404);
  r=await b('/api/workspace/library');assert.equal(r.json.records.length,0);
 }finally{await new Promise(r=>server.close(r));}
});
test('no public media and no executable mime types',async()=>{
 const {server}=fixture(),root=await boot(server),a=client(root);
 try{
  let res=await fetch(root+'/api/media');assert.equal(res.status,401);
  await a('/api/dev/activate','POST',{key:LICENSE});
  const wrong=Buffer.from('<html>unsafe</html>');
  let r=await a('/api/media','POST',{revision:0,name:'x.html',mime:'text/html',sha256:Media.sha(wrong),base64:wrong.toString('base64')});
  assert.equal(r.status,422);
  r=await a('/api/media','POST',{revision:0,name:'fake.png',mime:'image/png',sha256:Media.sha(wrong),base64:wrong.toString('base64')});
  assert.equal(r.status,422);
  assert.equal(r.json.error,'media_signature_invalid');
 }finally{await new Promise(r=>server.close(r));}
});
