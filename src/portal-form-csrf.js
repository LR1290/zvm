'use strict';
// Portal and Cloud login: constrained anti-CSRF fallback for privacy browsers.
// No fallback for arbitrary JSON/admin/extension/webhook routes.
const crypto=require('node:crypto');
const COOKIE='zv_portal_form_csrf';
const FIELD='zvm_portal_csrf';
const PATTERN=/^[a-f0-9]{64}$/;
const TTL=20*60;
const ROUTES=Object.freeze(new Set([
 '/cliente/login','/cliente/registro','/cliente/recuperar','/cliente/redefinir',
 '/cliente/2fa/verificar','/cliente/2fa/ativar','/cliente/2fa/desativar',
 '/cliente/vincular','/cliente/desvincular','/cliente/dispositivos/remover',
 '/cliente/senha','/cliente/email'
]));
function isPortalFormRoute(path){return ROUTES.has(path);}
function appendCookie(res,cookie){
 const before=res.getHeader('Set-Cookie');
 const previous=Array.isArray(before)?before:(before?[String(before)]:[]);
 res.setHeader('Set-Cookie',[...previous,cookie]);
}
function issuePortalCsrf(res){
 const token=crypto.randomBytes(32).toString('hex');
 appendCookie(res,`${COOKIE}=${token}; Path=/cliente; Max-Age=${TTL}; HttpOnly; Secure; SameSite=Strict`);
 return token;
}
function decoratePortalForms(html,res){
 if(typeof html!=='string'||!/<form\b/i.test(html))return html;
 const form=/<form\b[^>]*>/gi;
 const matches=[...html.matchAll(form)].filter(m=>
  /\bmethod\s*=\s*["']post["']/i.test(m[0]) &&
  /\baction\s*=\s*["']\/cliente(?:\/[^"']*)?["']/i.test(m[0]));
 if(!matches.length)return html;
 const token=issuePortalCsrf(res);
 return html.replace(form,tag=>{
  if(!/\bmethod\s*=\s*["']post["']/i.test(tag) ||
     !/\baction\s*=\s*["']\/cliente(?:\/[^"']*)?["']/i.test(tag))return tag;
  return tag+`<input type="hidden" name="${FIELD}" value="${token}">`;
 });
}
function safeSameOrigin(req){
 const h=req?.headers||{};
 const site=String(h['sec-fetch-site']||'').trim().toLowerCase();
 if(site&&!['same-origin','same-site','none'].includes(site))return false;
 const host=String(h.host||'').trim().toLowerCase();
 if(!host||/[\\/\s@]/.test(host))return false;
 const exact=value=>{
  try{
   const url=new URL(String(value));
   const local=/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
   return url.host.toLowerCase()===host &&
    (url.protocol==='https:'||(local&&url.protocol==='http:')) &&
    !url.username&&!url.password;
  }catch{return false;}
 };
 // A token is never allowed to override a known contradictory origin.
 if(h.origin&&h.origin!=='null'&&!exact(h.origin))return false;
 if(h.referer&&!exact(h.referer))return false;
 return true;
}
function verifyPortalCsrf(req,body){
 if(!safeSameOrigin(req)||!body||typeof body.getAll!=='function')return false;
 const tokens=body.getAll(FIELD);
 if(tokens.length!==1||!PATTERN.test(tokens[0]))return false;
 const fragments=String(req?.headers?.cookie||'').split(';').map(s=>s.trim());
 const matching=fragments.filter(s=>s.startsWith(COOKIE+'='));
 if(matching.length!==1)return false;
 const cookie=matching[0].slice(COOKIE.length+1);
 if(!PATTERN.test(cookie))return false;
 return crypto.timingSafeEqual(Buffer.from(tokens[0],'hex'),Buffer.from(cookie,'hex'));
}
module.exports={COOKIE,FIELD,ROUTES,isPortalFormRoute,issuePortalCsrf,decoratePortalForms,safeSameOrigin,verifyPortalCsrf};
