'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');const {createServer,validatePass}=require('../server');
test('one authorized account; no messages',async()=>{
 const salt=crypto.randomBytes(16),pwd='123456789-safepilot';
 const hash=salt.toString('hex')+':'+crypto.scryptSync(pwd,salt,32).toString('hex');
 assert.equal(validatePass(pwd,hash),true);assert.equal(validatePass('invalid',hash),false);
 const server=createServer({email:'only@example.org',passHash:hash});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const root='http://127.0.0.1:'+server.address().port;
 const post=(p,d,origin=root,cookie='')=>fetch(root+p,{method:'POST',headers:{'Origin':origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(d)});
 try{
  let r=await fetch(root+'/healthz');assert.equal(r.status,200);assert.equal((await r.json()).sending,'disabled');
  r=await fetch(root+'/api/overview');assert.equal(r.status,401);
  r=await post('/api/login',{email:'other@example.org',password:pwd});assert.equal(r.status,401);
  r=await post('/api/login',{email:'only@example.org',password:pwd},'https://evil.example');assert.equal(r.status,403);
  r=await post('/api/login',{email:'only@example.org',password:pwd});assert.equal(r.status,200);
  const cookie=r.headers.get('set-cookie').split(';')[0];assert.match(cookie,/^__Host-zvm_cloud_pilot=/);
  r=await fetch(root+'/api/overview',{headers:{Cookie:cookie}});assert.equal(r.status,200);assert.equal((await r.json()).sending,'disabled');
  r=await post('/api/ping',{},root,cookie);assert.equal(r.status,200);
  r=await post('/api/dispatch',{},root,cookie);assert.equal(r.status,404);
  r=await post('/api/logout',{},root,cookie);assert.equal(r.status,200);
  r=await fetch(root+'/api/overview',{headers:{Cookie:cookie}});assert.equal(r.status,401);
 }finally{await new Promise(r=>server.close(r));}
});
test('sealed by default',async()=>{
 const server=createServer({email:'',passHash:''});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const s=await (await fetch('http://127.0.0.1:'+server.address().port+'/api/session')).json();assert.equal(s.configured,false);assert.equal(s.loggedIn,false);}
 finally{await new Promise(r=>server.close(r));}
});