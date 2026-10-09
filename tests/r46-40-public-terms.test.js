'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const {once}=require('node:events');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {TERMS,renderTermsDocument}=require('../src/web/public/terms');
process.env.RENDER='true';process.env.NODE_ENV='test';
process.env.ADMIN_USER='fixture-admin';process.env.ADMIN_PASS='fixture-only-password';
process.env.APP_SECRET='fixture-only-secret-0000000000000000000000';
process.env.MONGODB_URI='mongodb://127.0.0.1:1/no-database';
const loader=Module._load;
let app;
try{Module._load=function(id,...args){if(id==='mongodb')return {MongoClient:class NoMongo{constructor(){throw Error('database forbidden')}}};return loader.call(this,id,...args)};app=require('../server').__test;}finally{Module._load=loader;}
const ids=new Set(TERMS.sections.map(x=>x.id));
assert.equal(TERMS.sections.length,16);assert.equal(ids.size,16);
assert.ok(TERMS.sections.every(x=>x.paragraphs['pt-BR'].length===x.paragraphs.en.length && x.paragraphs.en.length===x.paragraphs['pt-PT'].length));
assert.ok(TERMS.sections.every(x=>x.paragraphs['pt-BR'].length>=2));
for(const lang of ['pt-BR','pt-PT','en']) {
 const doc=renderTermsDocument(lang,'https://wa.me/5521996771552');
 assert.equal((doc.match(/class="doc-section terms-section"/g)||[]).length,16);
 assert.equal((doc.match(/class="terms-index-num"/g)||[]).length,16);
 for(const id of ids)assert.ok(doc.includes('href="#'+id+'"') && doc.includes('id="'+id+'"'),id);
 assert.doesNotMatch(doc,/<script\b/i);
 assert.match(doc,/href="\/privacidade"/);
 assert.match(doc,/rel="noopener noreferrer"/);
 assert.doesNotMatch(doc,/client_secret|AIza[0-9a-z]/i);
}
const docs=['/', '/privacidade','/termos'];
const screenshots=[];
(async()=>{
 const server=http.createServer((req,res)=>app.handleRequest(req,res).catch(err=>{console.error('http_fixture_failed',err.message);if(!res.headersSent)res.writeHead(500);res.end()}));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const base='http://127.0.0.1:'+server.address().port;
  async function get(route,headers={}){return fetch(base+route,{headers,redirect:'manual'});}
  const common={};
  for(const route of docs){
   const r=await get(route);assert.equal(r.status,200,route);common[route]=await r.text();
   assert.match(r.headers.get('content-security-policy')||'',/script-src 'self'/);
   assert.equal(r.headers.get('referrer-policy'),'no-referrer');
   assert.match(common[route],/href="\/termos"/);
   assert.equal((common[route].match(/class="r466-footer"/g)||[]).length,1);
  }
  const gsc=await get('/googleb72a9c76039b24b4.html');
  assert.equal(gsc.status,200,'Search Console verification remains publicly available');
  assert.equal(await gsc.text(),'google-site-verification: googleb72a9c76039b24b4.html');
  const robots=await get('/robots.txt');
  assert.equal(robots.status,200);
  assert.doesNotMatch(await robots.text(),/Disallow:\s*\/termos/i);
  assert.equal((common['/termos'].match(/<h1\b/g)||[]).length,1);
  assert.equal((common['/termos'].match(/class="doc-section terms-section"/g)||[]).length,16);
  assert.match(common['/termos'],/rel="canonical" href="https:\/\/zvm\.onrender\.com\/termos"/);
  assert.match(common['/termos'],/aria-label="Neste documento"/);
  for(const [lang,marker] of [['en','Terms of Service'],['pt-PT','Termos de Serviço']]) {
   const r=await get('/termos?lang='+lang);assert.equal(r.status,200);
   const html=await r.text();assert.match(html,new RegExp('<html lang="'+lang+'"'));
   assert.ok(html.includes(marker));assert.equal(r.headers.get('content-language'),lang);
  }
  const byHeader=await get('/termos',{'Accept-Language':'en-US,en;q=0.9'});
  assert.match(await byHeader.text(),/<html lang="en">/);
  const etag=(await get('/termos')).headers.get('etag');
  assert.equal((await get('/termos',{'If-None-Match':etag})).status,304);
  assert.equal((await fetch(base+'/termos',{method:'POST'})).status,404);
  const page=app.renderStandaloneTermsPage();assert.ok(page.includes('zvm-terms-')===false || page.includes('zvm-terms.'));
  assert.doesNotMatch(page,/<script>(?![\s\S]*?\/<script>)/i);
  assert.equal((page.match(/<main\b/g)||[]).length,1);
  assert.equal((page.match(/<footer\b/g)||[]).length,1);
  const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(source,/if \(p === '\/termos' && req\.method === 'GET'\)/);
  assert.equal((source.match(/if \(p === '\/termos' && req\.method === 'GET'\)/g)||[]).length,1);
  assert.ok(!source.includes('client_secret.json'));
  assert.match(common['/privacidade'],/Google OAuth \(em homologação\)/);
  assert.match(common['/'],/ZVM - Automações|ZVM/);
  // Legacy Search Console ownership is not handled or rewritten by /termos.
  assert.ok(!source.includes('app.get('));
  console.log('R46.40 public terms: 16 sections, 3 locales, 200/304/404, nav/footer, CSP, no secrets — PASS');
 }finally{await new Promise(ok=>server.close(ok))}
})().catch(e=>{console.error(e);process.exitCode=1});
