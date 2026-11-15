'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createServer,passwordHash,validatePass,safeEmail}=require('../server');
const {createMemoryStore,DATABASE}=require('../store');
function fixture(){
 const store=createMemoryStore();
 const server=createServer({store,adminEmail:'owner@example.org',adminPassHash:passwordHash('Strong-Owner-Pass-123')});
 return {store,server};
}
async function boot(server){await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;}
const post=(root,p,body,cookie='',origin=root,method='POST')=>fetch(root+p,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
const get=(root,p,cookie='')=>fetch(root+p,{headers:cookie?{Cookie:cookie}:{}});
test('hash, email rules and isolated storage identity',()=>{
 const hash=passwordHash('Test-Password-123456');
 assert.equal(validatePass('Test-Password-123456',hash),true);
 assert.equal(validatePass('wrong',hash),false);
 assert.equal(safeEmail(' OWNer@Example.Org '),'owner@example.org');
 assert.equal(safeEmail('not-an-email'),'');
 assert.equal(DATABASE,'zvm_cloud_pilot');
});
test('seals all private operations without DB/admin',async()=>{
 const server=createServer({store:null,adminEmail:'',adminPassHash:''});const root=await boot(server);
 try{
  const state=await(await get(root,'/api/session')).json();
  assert.equal(state.configured,false);assert.equal(state.loggedIn,false);
  let r=await get(root,'/api/overview');assert.equal(r.status,503);
  r=await post(root,'/api/login',{email:'a@example.org',password:'any'});assert.equal(r.status,503);
  r=await post(root,'/api/admin/guest',{email:'x@example.org',password:'Password-12345'});assert.equal(r.status,503);
  r=await get(root,'/healthz');assert.equal((await r.json()).sending,'disabled');
 }finally{await new Promise(r=>server.close(r));}
});
test('owner provisions one guest via email/password, cloud draft persists; revocation clears data',async()=>{
 const {store,server}=fixture();const root=await boot(server);
 const logIn=async(email,password)=>{
  const r=await post(root,'/api/login',{email,password});return [r,r.headers.get('set-cookie')?.split(';')[0]];
 };
 try{
  let r=await get(root,'/api/overview');assert.equal(r.status,401);
  r=await post(root,'/api/login',{email:'owner@example.org',password:'wrong'});assert.equal(r.status,401);
  r=await post(root,'/api/login',{email:'owner@example.org',password:'Strong-Owner-Pass-123'},'','https://evil.test');assert.equal(r.status,403);
  let [owner,oc]=await logIn('owner@example.org','Strong-Owner-Pass-123');
  assert.equal(owner.status,200);assert.match(oc,/^__Host-zvm_cloud_pilot=/);assert.equal((await owner.json()).role,'admin');
  r=await get(root,'/api/admin/guest',oc);assert.equal(r.status,200);assert.equal((await r.json()).user,null);
  r=await post(root,'/api/admin/guest',{email:'guest@example.org',password:'short'},oc);assert.equal(r.status,400);
  r=await post(root,'/api/admin/guest',{email:'guest@example.org',password:'Guest-Password-12345'},oc);
  assert.equal(r.status,200);assert.equal((await r.json()).email,'guest@example.org');
  r=await post(root,'/api/login',{email:'other@example.org',password:'Guest-Password-12345'});assert.equal(r.status,401);
  let [guest,gc]=await logIn('guest@example.org','Guest-Password-12345');
  assert.equal(guest.status,200);assert.match(gc,/^__Host-zvm_cloud_pilot=/);
  r=await get(root,'/api/session',gc);assert.equal((await r.json()).role,'guest');
  r=await get(root,'/api/admin/guest',gc);assert.equal(r.status,403);
  r=await get(root,'/api/draft',oc);assert.equal(r.status,403);
  r=await post(root,'/api/draft',{name:'Campanha',message:'Olá, teste!'},gc,root,'PUT');
  assert.equal(r.status,200);assert.equal((await r.json()).persistence,'cloud');
  r=await get(root,'/api/draft',gc);assert.equal((await r.json()).message,'Olá, teste!');
  r=await post(root,'/api/dispatch',{recipient:'anything'},gc);assert.equal(r.status,404);
  r=await get(root,'/api/overview',gc);assert.equal((await r.json()).sending,'disabled');
  const secondServer=createServer({store,adminEmail:'owner@example.org',adminPassHash:passwordHash('Strong-Owner-Pass-123')});
  const secondRoot=await boot(secondServer);
  try{
   r=await get(secondRoot,'/api/draft',gc);assert.equal(r.status,200);
   assert.equal((await r.json()).message,'Olá, teste!');
  }finally{await new Promise(r=>secondServer.close(r));}
  r=await post(root,'/api/admin/guest',{email:'new@example.org',password:'Another-Pass-987654'},oc);
  assert.equal(r.status,200);
  r=await get(root,'/api/draft',gc);assert.equal(r.status,401);
  const [newLogin,nc]=await logIn('new@example.org','Another-Pass-987654');assert.equal(newLogin.status,200);
  r=await get(root,'/api/draft',nc);assert.equal((await r.json()).message,'');
  r=await post(root,'/api/admin/guest',{},oc,root,'DELETE');assert.equal(r.status,200);
  r=await get(root,'/api/draft',nc);assert.equal(r.status,401);
  const [denied]=await logIn('new@example.org','Another-Pass-987654');assert.equal(denied.status,401);
  r=await post(root,'/api/logout',{},oc);assert.equal(r.status,200);
  r=await get(root,'/api/overview',oc);assert.equal(r.status,401);
 }finally{await new Promise(r=>server.close(r));}
});

// Shared-service contract is verified in the same Render build used by the isolated pilot.
require('./mount.test.js');
const {execFileSync}=require('node:child_process');
test('main server root syntax remains valid',()=>{
 execFileSync(process.execPath,['--check',require('node:path').join(__dirname,'../../server.js')],{timeout:15000});
});

// Full backend regression on Render: exercises the unchanged production suite before promotion.
test('Full backend regression on Render',()=>{
 const {spawnSync}=require('node:child_process');
 const root=require('node:path').join(__dirname,'../..');
 for(const args of [['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],['run','check']]){
  const run=spawnSync('npm',args,{cwd:root,encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024});
  assert.equal(run.status,0,'npm '+args.join(' ')+' failed: '+(run.error?.message||'')+'\n'+(run.stdout||'').slice(-3500)+'\n'+(run.stderr||'').slice(-3500));
 }
});
