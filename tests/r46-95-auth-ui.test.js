'use strict';
// R46.95 - Standalone authentication visual and contract regressions, offline only.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Module=require('node:module');
const root=path.resolve(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const assetMatch=server.match(/<link rel="stylesheet" href="\/assets\/(zvm-auth-premium\.([a-f0-9]{12})\.css)">/);
assert(assetMatch,'versioned auth CSS must be linked');
const css=fs.readFileSync(path.join(root,'assets',assetMatch[1]),'utf8');
const digest=crypto.createHash('sha256').update(css).digest('hex');
assert.equal(digest.slice(0,12),assetMatch[2],'auth CSS asset fingerprint');
assert(server.includes("sha256: '"+digest+"'"),'auth CSS full digest must be allowlisted');
assert(css.includes('body.zvm-auth-premium'),'auth styles must be scoped');
assert(css.includes('@media(max-width:640px)'),'mobile layout must be present');
assert(css.includes('@media(max-width:360px)'),'320px layout must be present');
assert(css.includes('prefers-reduced-motion:reduce'));
assert(css.includes('focus-visible'));
assert(!css.includes('!important'),'new auth design must avoid new specificity debt');

process.env.RENDER='true';
process.env.ADMIN_USER='zvm-auth-qa';
process.env.ADMIN_PASS='zvm-auth-qa-only';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/zvm_auth_offline_qa';
const original=Module._load;
let api;
try{
 Module._load=function(id,...args){
  if(id==='mongodb')return{MongoClient:class OfflineMongoFixture{}};
  return original.call(this,id,...args);
 };
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=original}
const screens=[
 ['login',api.renderStandalonePortalLogin()],
 ['register',api.renderStandalonePortalRegister()],
 ['verify-2fa',api.renderStandalone2FAVerify()],
 ['recovery-request',api.renderStandalonePortalResetRequest()],
 ['recovery-form',api.renderStandalonePortalResetForm('','','fixture-token')],
 ['admin-login',api.renderAdminLogin()],
 ['analytics-login',api.renderAnalyticsLogin()]
];
for(const [label,html] of screens){
 assert(html.includes('zvm-auth-premium'),'Missing auth theme for '+label);
 assert(html.includes('/assets/'+assetMatch[1]),'Missing auth asset for '+label);
 assert(html.includes('class="auth-form-card"'),'Missing form surface for '+label);
 assert(html.includes('method="POST"'),'Missing POST form for '+label);
 assert(html.includes('class="auth-submit'),'Missing submit control for '+label);
}
assert(screens[0][1].includes('action="/cliente/login"'));
assert(screens[0][1].includes('name="redir"'));
assert(screens[1][1].includes('action="/cliente/registro"'));
for(const field of ['name','phone','email','keycode','pass','pass2']){
 assert(screens[1][1].includes('name="'+field+'"'),'Registration contract lost: '+field);
}
assert(screens[2][1].includes('action="/cliente/2fa/verificar"'));
assert(screens[3][1].includes('action="/cliente/recuperar"'));
assert(screens[4][1].includes('action="/cliente/redefinir"'));
assert(screens[4][1].includes('name="token"'));
for(const id of ['admin-user','admin-pass']){
 assert(screens[5][1].includes('for="'+id+'"'),'Admin field must have an explicit label: '+id);
 assert(screens[5][1].includes('id="'+id+'"'));
}
assert.match(api.renderAdminLogin('Erro ficticio'),/class="auth-alert err" role="alert"/);
assert(screens[6][1].includes('name="pass"'));
assert(!api.renderPortalDashboard({name:'QA',email:'qa@example.invalid'},null,'','').includes('zvm-auth-premium'),'Authenticated client must keep R46.94, not inherit standalone auth changes');
console.log('R46.95 PASS: SHA-256, CSS scope, 7 auth screens, labels and original endpoint/field contracts');
