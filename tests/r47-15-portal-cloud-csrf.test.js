'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path');
const {
 COOKIE,FIELD,ROUTES,issuePortalCsrf,decoratePortalForms,
 isPortalFormRoute,safeSameOrigin,verifyPortalCsrf
}=require('../src/portal-form-csrf');

function issue(extraCookies=[]){
 const headers=new Map();
 if(extraCookies.length)headers.set('Set-Cookie',extraCookies.slice());
 const res={getHeader:k=>headers.get(k),setHeader:(k,v)=>headers.set(k,v)};
 const token=issuePortalCsrf(res);
 const full=headers.get('Set-Cookie');
 const cookie=full.at(-1).split(';')[0];
 const form=new URLSearchParams([[FIELD,token]]);
 return {headers,token,cookie,form};
}
function request(cookie,headers={}){
 return {headers:{host:'zvm.onrender.com',cookie,...headers}};
}
test('Portal: 256-bit CSRF token, host-only cookie, anti-replay matching',()=>{
 const a=issue(),b=issue();
 assert.match(a.token,/^[a-f0-9]{64}$/);assert.notEqual(a.token,b.token);
 assert.match(a.headers.get('Set-Cookie')[0],/; Path=\/cliente; Max-Age=1200; HttpOnly; Secure; SameSite=Strict$/);
 assert.equal(verifyPortalCsrf(request(a.cookie),a.form),true);
 assert.equal(verifyPortalCsrf(request(a.cookie,{'sec-fetch-site':'none'}),a.form),true);
 assert.equal(verifyPortalCsrf(request(a.cookie,{'sec-fetch-site':'same-site'}),a.form),true);
 assert.equal(verifyPortalCsrf(request(a.cookie,{origin:'null'}),a.form),true);
 assert.equal(verifyPortalCsrf(request(a.cookie,{origin:'https://zvm.onrender.com'}),a.form),true);
 assert.equal(verifyPortalCsrf(request(a.cookie,{referer:'https://zvm.onrender.com/dev/cloud/'}),a.form),true);
 assert.equal(verifyPortalCsrf(request(b.cookie),a.form),false);
 assert.equal(verifyPortalCsrf(request(a.cookie+'; '+a.cookie),a.form),false);
 assert.equal(verifyPortalCsrf(request(a.cookie),new URLSearchParams()),false);
 assert.equal(verifyPortalCsrf(request(a.cookie),new URLSearchParams([[FIELD,a.token],[FIELD,a.token]])),false);
 assert.equal(verifyPortalCsrf(request(a.cookie),new URLSearchParams([[FIELD,'x'.repeat(64)]])),false);
});
test('Portal: refuse injected Origin, cross-site Fetch Metadata, mismatched host/protocol',()=>{
 const a=issue();
 for(const headers of [
  {'sec-fetch-site':'cross-site'}, {'sec-fetch-site':'navigate'},
  {origin:'https://evil.example'}, {referer:'https://evil.example/login'},
  {origin:'http://zvm.onrender.com'}, {origin:'https://evil.zvm.onrender.com'},
  {origin:'https://zvm.onrender.com.evil.example'},
  {host:'evil.example',origin:'https://zvm.onrender.com'},
  {host:'zvm.onrender.com@evil.example'},
 ]) {
  assert.equal(verifyPortalCsrf(request(a.cookie,headers),a.form),false,JSON.stringify(headers));
 }
 assert.equal(safeSameOrigin(request(a.cookie,{'sec-fetch-site':'same-origin'})),true);
});
test('Portal: preserves existing Set-Cookie headers and protects ONLY local client forms',()=>{
 const hdrs=new Map([['Set-Cookie',['zv_lang=pt-BR; Path=/; Secure; SameSite=Lax']]]);
 const res={getHeader:k=>hdrs.get(k),setHeader:(k,v)=>hdrs.set(k,v)};
 const html='<form method="POST" action="/cliente/login"></form>'+
  '<form method="POST" action="/cliente/email"></form>'+
  '<form method="POST" action="https://evil.example/"></form>'+
  '<form method="GET" action="/cliente/login"></form>';
 const out=decoratePortalForms(html,res);
 assert.equal((out.match(/name="zvm_portal_csrf"/g)||[]).length,2);
 const arr=hdrs.get('Set-Cookie');
 assert.equal(arr.length,2);assert.match(arr[0],/zv_lang/);assert.match(arr[1],/zv_portal_form_csrf/);
 for(const route of ROUTES)assert.equal(isPortalFormRoute(route),true,route);
 for(const other of ['/admin','/api/secret','/extension/status','/dev/cloud/api/ping','/cliente/api/webhook','/cliente/not-a-form'])
  assert.equal(isPortalFormRoute(other),false,other);
 const unrelated={getHeader(){return undefined},setHeader(){throw Error('cookie not expected')}};
 assert.equal(decoratePortalForms('<form method="POST" action="https://evil.example/"></form>',unrelated),
 '<form method="POST" action="https://evil.example/"></form>');
});
test('Portal/Cloud: recovery on failed Origin is scoped to tokenized form only',()=>{
 const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const cloud=fs.readFileSync(path.join(__dirname,'../cloud-pilot/public/app.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'../cloud-pilot/public/index.html'),'utf8');
 assert.match(server,/if \(req\.method === 'POST' && isPortalFormRoute\(p\) && !requireSameOriginPost\(req\)\)/);
 assert.match(server,/req\.zvmCachedPortalForm = form;/);
 assert.match(server,/req\.zvmPortalCsrfVerified = true;/);
 assert.match(server,/const token = issuePortalCsrf\(res\);/);
 assert.match(server,/decoratePortalForms\(html, res\)/);
 assert.match(server,/return Promise\.resolve\(req\.zvmCachedPortalForm\)/);
 assert.match(server,/console\.warn\('\[PORTAL-CSRF\] rejected token route=/);
 assert.match(cloud,/fetch\('\/cliente\/form-token'/);
 assert.match(cloud,/form\.submit\(\)/);
 assert.match(html,/id="cloudLoginForm"/);
 assert.match(html,/name="zvm_portal_csrf"/);
 assert.match(server,/function requireSameOriginPost\(req\)/);
 assert.ok(server.includes("if (site && !['same-origin','same-site','none'].includes(site)) return false;"));
});
