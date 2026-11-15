'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createServer}=require('../server');
const {createMemoryStore,DATABASE}=require('../store');

const DEV='zv-dev-valid-2026';
const fp=crypto.createHash('sha256').update(DEV).digest('hex');
function config(){
 const store=createMemoryStore(),accounts=new Map([
  ['a@example.org',{key:DEV,dev:true,active:true}],
  ['b@example.org',{key:'zv-other-b',dev:false,active:true}]
 ]);
 let id='a-session';
 const sessions=new Map();
 sessions.set('a-session',{email:'a@example.org',expiresAt:Date.now()+3600000});
 sessions.set('b-session',{email:'b@example.org',expiresAt:Date.now()+3600000});
 function cookie(sessionName){
  return 'zv_portal='+sessionName;
 }
 const server=createServer({
  store,
  resolvePortal:async req=>{
   const match=String(req.headers.cookie||'').match(/zv_portal=(a-session|b-session|a-new-session)/);
   const account=sessions.get(match?.[1]);
   if(!account)return null;
   return {...account,sessionId:crypto.createHash('sha256').update(match[1]).digest('hex')};
  },
  verifyDevKey:async(email,raw,keyHash)=>{
   const license=accounts.get(email);
   if(!license||!license.dev||!license.active)return false;
   const hash=crypto.createHash('sha256').update(license.key).digest('hex');
   if(raw!==null&&raw!==license.key)return false;
   if(keyHash!==null&&keyHash!==hash)return false;
   return raw===null?true:{keyHash:hash};
  }
 });
 return {store,server,sessions,accounts,cookie};
}
async function boot(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+server.address().port;}
function request(url,path,{method='GET',body=null,cookie='',origin=url}={}){
 return fetch(url+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'})},...(method==='GET'?{}:{body:JSON.stringify(body||{})})});
}
test('no public login; gate requires authentic portal and current DEV license',async()=>{
 assert.equal(DATABASE,'zvm_cloud_pilot');
 const f=config(),root=await boot(f.server),a=f.cookie('a-session');
 try{
  let r=await request(root,'/api/session');assert.equal(r.status,200);
  let data=await r.json();assert.equal(data.loggedIn,false);assert.equal(data.devAuthorized,false);
  r=await request(root,'/api/overview');assert.equal(r.status,401);
  r=await request(root,'/api/session',{cookie:a});data=await r.json();
  assert.equal(data.loggedIn,true);assert.equal(data.devRequired,true);
  r=await request(root,'/api/overview',{cookie:a});assert.equal(r.status,403);
  r=await request(root,'/api/login',{method:'POST',cookie:a,body:{email:'a@example.org',password:'guess'}});assert.equal(r.status,404);
  r=await request(root,'/api/admin/guest',{method:'POST',cookie:a});assert.equal(r.status,404);
  r=await request(root,'/api/dev/activate',{method:'POST',cookie:a,origin:'https://attacker.example',body:{key:DEV}});assert.equal(r.status,403);
  r=await request(root,'/api/dev/activate',{method:'POST',cookie:a,body:{key:'wrong'}});assert.equal(r.status,403);
  r=await request(root,'/api/dev/activate',{method:'POST',cookie:a,body:{key:DEV}});assert.equal(r.status,200);
  r=await request(root,'/api/session',{cookie:a});data=await r.json();assert.equal(data.devAuthorized,true);
  r=await request(root,'/api/overview',{cookie:a});assert.equal(r.status,200);
  data=await r.json();assert.equal(data.sending,'disabled');assert.equal(data.realMessages,0);
  r=await request(root,'/api/dispatch',{method:'POST',cookie:a});assert.equal(r.status,404);
  r=await request(root,'/api/ping',{method:'POST',cookie:a});assert.equal(r.status,200);
  f.accounts.get('a@example.org').dev=false;
  r=await request(root,'/api/overview',{cookie:a});assert.equal(r.status,403);
  f.accounts.get('a@example.org').dev=true;
  f.accounts.get('a@example.org').active=false;
  r=await request(root,'/api/overview',{cookie:a});assert.equal(r.status,403);
  f.accounts.get('a@example.org').active=true;
  r=await request(root,'/api/overview',{cookie:a});assert.equal(r.status,200);
  r=await request(root,'/api/dev/leave',{method:'POST',cookie:a});assert.equal(r.status,200);
  r=await request(root,'/api/overview',{cookie:a});assert.equal(r.status,403);
 }finally{await new Promise(r=>f.server.close(r));}
});
test('separate users, separate portal sessions, per-user cloud drafts',async()=>{
 const f=config(),root=await boot(f.server);
 const a=f.cookie('a-session'),b=f.cookie('b-session');
 try{
  let r=await request(root,'/api/dev/activate',{method:'POST',cookie:a,body:{key:DEV}});assert.equal(r.status,200);
  r=await request(root,'/api/draft',{method:'PUT',cookie:a,body:{name:'A',message:'Private for A'}});assert.equal(r.status,200);
  r=await request(root,'/api/draft',{cookie:b});assert.equal(r.status,403);
  r=await request(root,'/api/dev/activate',{method:'POST',cookie:b,body:{key:DEV}});assert.equal(r.status,403);
  f.accounts.get('b@example.org').dev=true;
  r=await request(root,'/api/dev/activate',{method:'POST',cookie:b,body:{key:'zv-other-b'}});assert.equal(r.status,200);
  r=await request(root,'/api/draft',{cookie:b});assert.equal((await r.json()).message,'');
  r=await request(root,'/api/draft',{method:'PUT',cookie:b,body:{name:'B',message:'Private for B'}});assert.equal(r.status,200);
  r=await request(root,'/api/draft',{cookie:a});assert.equal((await r.json()).message,'Private for A');
  // A new login for A cannot inherit the old portal-session DEV grant.
  f.sessions.set('a-new-session',{email:'a@example.org',expiresAt:Date.now()+3600000});
  r=await request(root,'/api/draft',{cookie:f.cookie('a-new-session')});assert.equal(r.status,403);
  // The expired/invalidated original portal session fails closed.
  f.sessions.delete('a-session');
  r=await request(root,'/api/draft',{cookie:a});assert.equal(r.status,401);
  r=await request(root,'/api/draft',{cookie:b});assert.equal((await r.json()).message,'Private for B');
 }finally{await new Promise(r=>f.server.close(r));}
});
test('unprovisioned db stays sealed and no DEV grant can be issued',async()=>{
 const server=createServer({store:null});
 const root=await boot(server);
 try{
  const r=await request(root,'/api/session');
  assert.equal((await r.json()).devAuthorized,false);
  assert.equal((await request(root,'/api/dev/activate',{method:'POST',body:{key:DEV}})).status,401);
 }finally{await new Promise(r=>server.close(r));}
});

// QA harness: Render invokes only this file in its build command.
// Exercise the nested-route mount and the entire existing production regression.
require('./mount.test.js');
test('full production regression on Render',()=>{
 if(process.env.ZVM_CLOUD_QA_NESTED==='1')return;
 const {spawnSync}=require('node:child_process');
 const root=require('node:path').join(__dirname,'../..');
 const env={...process.env,ZVM_CLOUD_QA_NESTED:'1'};
 for(const args of [['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],['run','check']]){
  const result=spawnSync('npm',args,{cwd:root,env,encoding:'utf8',timeout:240000,maxBuffer:12*1024*1024});
  assert.equal(result.status,0,'npm '+args.join(' ')+' failed: '+String(result.error?.message||'')+'\n'+(result.stdout||'').slice(-8000)+'\n'+(result.stderr||'').slice(-8000));
 }
});
