'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createCloudRoute,BASE}=require('../../src/web/cloud/route');
const {createHandler}=require('../server');
const {createMemoryStore}=require('../store');
test('same Node listener mounts only /dev/cloud and preserves portal redirect and DEV challenge',async()=>{
 const store=createMemoryStore(),account='person@example.org',license='dev-enabled-license';
 const session=crypto.createHash('sha256').update('session-token').digest('hex'),keyHash=crypto.createHash('sha256').update(license).digest('hex');
 const cloud=createCloudRoute({factory:async()=>createHandler({
  store,
  resolvePortal:async req=>req.headers.cookie==='zv_portal=test_session'?{email:account,sessionId:session,expiresAt:Date.now()+3600000}:null,
  verifyDevKey:async(email,code,fingerprint)=>email!==account?false:code===license?{keyHash}:code===null&&fingerprint===keyHash?true:false
 })});
 const main=http.createServer(async(req,res)=>{
  if(await cloud(req,res,new URL(req.url,'http://localhost').pathname))return;
  res.writeHead(404,{'Content-Type':'text/plain'});res.end('other_main_route');
 });
 await new Promise(done=>main.listen(0,'127.0.0.1',done));
 const root='http://127.0.0.1:'+main.address().port;
 const req=(pathname,{method='GET',body=null,cookie='',origin=root}={})=>fetch(root+pathname,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(method!=='GET'?{Origin:origin,'Content-Type':'application/json'}:{})},...(method==='GET'?{}:{body:JSON.stringify(body||{})}),redirect:'manual'});
 try{
  assert.equal(BASE,'/dev/cloud');
  let response=await req('/dev/cloud');assert.equal(response.status,308);assert.equal(response.headers.get('location'),'/dev/cloud/');
  response=await req('/dev/cloud/');assert.equal(response.status,200);const html=await response.text();
  assert.match(html,/action="\/cliente\/login"/);
  assert.match(html,/name="redir" value="\/dev\/cloud\/"/);
  assert.match(html,/id="devGate"/);
  response=await req('/dev/cloud/styles.css');assert.equal(response.status,200);
  response=await req('/dev/cloud/app.js');assert.equal(response.status,200);
  assert.match(await response.text(),/api\/dev\/activate/);
  response=await req('/dev/cloud/api/session');assert.equal(response.status,200);
  assert.equal((await response.json()).loggedIn,false);
  response=await req('/dev/cloud/api/overview');assert.equal(response.status,401);
  response=await req('/dev/cloud/api/session',{cookie:'zv_portal=test_session'});assert.equal((await response.json()).devRequired,true);
  response=await req('/dev/cloud/api/dev/activate',{method:'POST',cookie:'zv_portal=test_session',body:{key:license}});assert.equal(response.status,200);
  response=await req('/dev/cloud/api/draft',{method:'PUT',cookie:'zv_portal=test_session',body:{name:'Test',message:'Demo'}});assert.equal(response.status,200);
  response=await req('/dev/cloud/api/draft',{cookie:'zv_portal=test_session'});assert.equal((await response.json()).message,'Demo');
  response=await req('/dev/cloud-other');assert.equal(response.status,404);assert.equal(await response.text(),'other_main_route');
  response=await req('/api/session');assert.equal(response.status,404);
  response=await req('/dev/cloud/api/send',{method:'POST',cookie:'zv_portal=test_session'});assert.equal(response.status,404);
 }finally{await new Promise(done=>main.close(done));}
});
test('production server uses validated portal callbacks, not secondary passwords',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../../server.js'),'utf8');
 assert.match(code,/const \{ createCloudRoute \} = require\('\.\/src\/web\/cloud\/route'\)/);
 assert.match(code,/const serveZVMCloud = createCloudRoute\(/);
 assert.match(code,/if \(!isPortalSession\(req\)\) return null/);
 assert.match(code,/extensionDevAccessAllowed\(keyCode, record\)/);
 assert.match(code,/readPortalKeySnapshot\(keyCode, \{ db \}\)/);
 assert.match(code,/if \(await serveZVMCloud\(req, res, p\)\) return;/);
 assert.match(code,/Disallow: \/dev\/cloud\//);
});
