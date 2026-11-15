'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {createCloudRoute,BASE}=require('../../src/web/cloud/route');
const {createHandler,passwordHash}=require('../server');
const {createMemoryStore}=require('../store');
const owner='owner@example.org',ownerPassword='Strong-Owner-Password-2026';
test('mounted Cloud serves only /dev/cloud and keeps host endpoints isolated',async()=>{
 const store=createMemoryStore();
 const cloud=createCloudRoute({factory:async()=>createHandler({
  store,adminEmail:owner,adminPassHash:passwordHash(ownerPassword)
 })});
 const srv=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  try{if(await cloud(req,res,pathname))return;}catch(e){res.writeHead(500);res.end('Internal');return;}
  res.writeHead(404,{'Content-Type':'text/plain'});res.end('not-found-from-main');
 });
 await new Promise(resolve=>srv.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+srv.address().port;
 const request=(url,method='GET',payload=null,cookie='',origin=base)=>{
  const options={method,headers:{...(cookie?{Cookie:cookie}:{})}};
  if(method!=='GET'&&method!=='HEAD'){options.headers.Origin=origin;options.headers['Content-Type']='application/json';options.body=JSON.stringify(payload||{});}
  return fetch(base+url,options);
 };
 try{
  assert.equal(BASE,'/dev/cloud');
  let r=await fetch(base+'/dev/cloud',{redirect:'manual'});
  assert.equal(r.status,308);assert.equal(r.headers.get('location'),'/dev/cloud/');
  r=await request('/dev/cloud/');
  assert.equal(r.status,200);const html=await r.text();
  assert.match(html,/href="styles\.css"/);assert.match(html,/src="app\.js"/);
  assert.doesNotMatch(html,/href="\/styles\.css"/);
  r=await request('/dev/cloud/styles.css');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/css/);
  r=await request('/dev/cloud/app.js');assert.equal(r.status,200);
  const js=await r.text();assert.match(js,/document\.currentScript\.src/);assert.match(js,/base\+url/);
  r=await request('/dev/cloud/api/session');assert.equal(r.status,200);assert.equal((await r.json()).loggedIn,false);
  r=await request('/api/session');assert.equal(r.status,404);assert.equal(await r.text(),'not-found-from-main');
  r=await request('/dev/cloud-other');assert.equal(r.status,404);
  r=await request('/dev/cloud/api/login','POST',{email:owner,password:ownerPassword},'','https://other.example');
  assert.equal(r.status,403);
  r=await request('/dev/cloud/api/login','POST',{email:owner,password:ownerPassword});
  assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];
  assert.match(cookie,/__Host-zvm_cloud_pilot=/);
  r=await request('/dev/cloud/api/admin/guest','POST',{email:'guest@example.org',password:'Strong-Guest-Password-2026'},cookie);
  assert.equal(r.status,200);
  r=await request('/dev/cloud/api/login','POST',{email:'guest@example.org',password:'Strong-Guest-Password-2026'});
  assert.equal(r.status,200);const guestCookie=r.headers.get('set-cookie').split(';')[0];
  r=await request('/dev/cloud/api/draft','PUT',{name:'Teste',message:'Apenas rascunho'},guestCookie);
  assert.equal(r.status,200);
  r=await request('/dev/cloud/api/draft','GET',null,guestCookie);
  assert.equal((await r.json()).message,'Apenas rascunho');
  r=await request('/dev/cloud/api/send','POST',{to:'123'},guestCookie);
  assert.equal(r.status,404);
  r=await request('/dev/cloud/api/overview','GET',null,guestCookie);
  const overview=await r.json();assert.equal(overview.sending,'disabled');
  assert.equal(overview.whatsapp,'not_connected');
 }finally{await new Promise(resolve=>srv.close(resolve));}
});
test('main server references isolated Cloud before the legacy route table',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../../server.js'),'utf8');
 assert.match(code,/require\('\.\/src\/web\/cloud\/route'\)/);
 const mount=code.indexOf('if (await serveZVMCloud(req, res, p)) return;');
 const first=code.indexOf('async function handleRequest(req, res)');
 assert.ok(mount>first && mount<first+1800);
 assert.match(code,/Disallow: \/dev\/cloud\//);
});
