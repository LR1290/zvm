'use strict';
// R47.06: Admin root login canonicalization, without bypassing security or altering stored credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert(source.includes('<form method="POST" action="${R_ADMIN}">'), 'Admin form must submit to canonical panel root');
const begin = "  // The canonical Admin login lives on the panel root.";
const end = "  if (p === R_ADMIN+'/logout')";
const start = source.indexOf(begin), finish = source.indexOf(end, start);
assert(start >= 0 && finish > start, 'Expected Admin login handler must exist');
const handler = new Function('req', 'res', 'ip', 'deps',
  'with(deps){ return (async function(){'+source.slice(start,finish)+'})(); }');
const ip = '192.0.2.8', panel = '/synthetic-admin';
const ADMIN_USER='admin.qa@example.invalid', password='test-password-not-live', goodTotp='654321';
const salt = crypto.randomBytes(16);
const passHash = crypto.scryptSync(password,salt,64,{N:16384,r:8,p:1});
const sessions = {}, alerts=[], rateLimitMap=new Map();
let issued=0;
const deps = {
  p:'', R_ADMIN:panel, crypto, Buffer, ADMIN_USER, _adminPassSalt:salt, _adminPassHash:passHash,
  TOTP_SECRET:'synthetic-totp-secret', SESSION_ABSOLUTE_LIMIT_MS:86400000,
  sessions, rateLimitMap,
  checkRateLimit:(_ip,_type)=>true, getRateLimitWait:()=>1,
  requireSameOriginPost:req=>req.sameOrigin!==false,
  parseFormBody:async req=>new URLSearchParams(req.body||''),
  verifyTOTP:(_secret,token)=>token===goodTotp,
  generateToken:()=> 'synthetic-token-'+(++issued),
  setSessionCookie:(res,name,value)=>{res.sessionCookie={name,value};},
  renderAdminLogin:message=>'ADMIN_LOGIN:'+message,
  sendAuthHtml:(res,html,status=200)=>{res.result={status,html};},
  sendHtml:(res,html,status=200)=>{res.result={status,html};},
  addSecurityAlert:(type,detail)=>alerts.push({type,detail}),
};
async function request(pathname, method='POST', values={}, safeOrigin=true) {
  deps.p=pathname;
  const req={method, sameOrigin:safeOrigin, headers:{cookie:''},
    body:new URLSearchParams(values).toString()};
  const res={writeHead(status,headers){this.result={status,headers}},end(){this.ended=true}};
  await handler(req,res,ip,deps);
  return res;
}
(async()=>{
  const valid={user:ADMIN_USER,pass:password,totp:goodTotp};
  const oldGet=await request(panel+'/login','GET');
  assert.equal(oldGet.result.status,302);
  assert.equal(oldGet.result.headers.Location,panel);
  assert.equal(oldGet.result.headers['Cache-Control'],'no-store');
  const oldHead=await request(panel+'/login','HEAD');
  assert.equal(oldHead.result.status,302);
  const mainOk=await request(panel,'POST',valid);
  assert.equal(mainOk.result.status,302);
  assert.equal(mainOk.result.headers.Location,panel);
  assert.equal(mainOk.sessionCookie.name,'zv_admin');
  const legacyOk=await request(panel+'/login','POST',valid);
  assert.equal(legacyOk.result.status,302,'existing open tabs must continue working');
  assert.equal(legacyOk.sessionCookie.name,'zv_admin');
  const wrongPassword=await request(panel,'POST',{...valid,pass:'wrong'});
  assert.equal(wrongPassword.result.status,200);
  assert.match(wrongPassword.result.html,/Usuário ou senha incorretos/);
  assert.equal(wrongPassword.sessionCookie,undefined);
  const wrongTotp=await request(panel,'POST',{...valid,totp:'000000'});
  assert.equal(wrongTotp.result.status,200);
  assert.match(wrongTotp.result.html,/2FA inválido ou expirado/);
  assert.equal(wrongTotp.sessionCookie,undefined);
  const crossSite=await request(panel,'POST',valid,false);
  assert.equal(crossSite.result.status,403,'CSRF rejection unchanged');
  assert.equal(crossSite.sessionCookie,undefined);
  assert.equal(Object.keys(sessions).length,2,'only successful login attempts issue a session');
  assert.equal(alerts.length,2,'only failed credentials / TOTP generate alerts');
  console.log('R47.06 PASS: canonical Admin root + legacy GET redirect + legacy POST compatibility + credential, 2FA and CSRF gates');
})().catch(err=>{console.error(err);process.exitCode=1;});
