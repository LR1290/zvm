'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const root=path.join(__dirname,'..');
const read=pathInRepo=>fs.readFileSync(path.join(root,pathInRepo),'utf8');
const server=read('server.js');
const htmlTemplate=read('src/web/public/landing/owner-template.html');
const homeCss=read('assets/zvm-sales-owner.a610cb96b94d.css');
const siteCss=read('assets/zvm-owner-site.e10ede63c1f0.css');
const localeSource=read('src/web/public/i18n.js');
const {localizePublicHtml}=require('../src/web/public/i18n');
const canonicalLogo=require('../src/web/public/landing/owner').OWNER_TOP_BRAND_SRC;

assert(htmlTemplate.includes('<link rel="icon" type="image/png" href="/assets/zvm-brand.167357885820.png">'), 'homepage must declare favicon');
assert(server.includes("if (p === '/favicon.ico'"), 'browser favicon fallback');
assert(server.includes("Location: '/assets/zvm-brand.167357885820.png'"), 'fallback uses official PNG');
assert(server.includes("const ZVM_CANONICAL_FAVICON ="), 'same official icon for auth/public/admin');
assert(!fs.existsSync(path.join(root,'assets/zvm-sales-owner.a0ba31f21435.css')), 'old sales CSS retained');
assert(!fs.existsSync(path.join(root,'assets/zvm-owner-site.42d17a62234b.css')), 'old public CSS retained');
assert(server.includes("['/', '/planos', '/faq', '/privacidade', '/termos'].includes(currentPath)"), 'homepage must receive same i18n as other public routes');
assert(localeSource.includes('html.replace(actionGroup'), 'flag should join action group, not append to navbar end');
assert(!localeSource.includes("nav+picker+'</nav>'"), 'language selector previously broken');
assert(homeCss.includes('body.zvm-owner-landing main *'), 'home reset scoped to main');
assert(!homeCss.includes('*{box-sizing:border-box;margin:0}'), 'home reset cannot mutate navbar');
assert(homeCss.includes('body.zvm-owner-landing #faq details'), 'home disclosure styles scoped to FAQ');
assert(siteCss.includes('/* Canonical public header'), 'dedicated canonical header contract');
assert(siteCss.includes('font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'));
assert(siteCss.includes('.znav .znav-action-links .zvm-language'));
assert(siteCss.includes('max-width:1150px') && siteCss.includes('.znav-links.is-open'), 'mobile nav contract');

process.env.RENDER='true';process.env.NODE_ENV='test';
process.env.MONGODB_URI='mongodb://127.0.0.1:1/test';
process.env.ADMIN_USER='fixture-admin';process.env.ADMIN_PASS='fixture-password';
process.env.ANALYTICS_PASS='fixture-analytics';
process.env.APP_SECRET='fixture-long-app-secret-123456789-123456789-123456789';
const original=Module._load;
let api;
try {
  Module._load=function(id,...args){
    if(id==='mongodb')return {MongoClient:class OfflineMongo{}};
    return original.call(this,id,...args);
  };
  api=require('../server.js').__test;
} finally {Module._load=original;}

for(const route of ['/', '/planos', '/faq', '/privacidade', '/termos']){
  const base=api._sharedNav({activePath:route});
  const rendered=localizePublicHtml('<html lang="pt-BR"><head></head><body class="zvm-public-premium">'+base+'</body></html>','pt-BR',{path:route});
  assert.equal((rendered.match(/class="zvm-language"/g)||[]).length,1,route+' must have exactly one language chooser');
  assert.equal((rendered.match(/class="znav standalone-nav"/g)||[]).length,1,route+' must have exactly one navbar');
  assert(rendered.includes(canonicalLogo),route+' must use official same logo');
  const group=rendered.match(/<div class="znav-action-links">([\s\S]*?)<\/div><\/div><\/nav>/);
  assert(group,route+' must not render picker outside navbar actions');
  assert(group[1].includes('class="zvm-language"'),route+' picker must be INSIDE action buttons');
  for(const segment of ['owner-nav-install','nav-login','nav-cta']){
    assert(group[1].includes(segment),route+' missing '+segment);
  }
  assert(!rendered.includes('</nav><details class="zvm-language"'),route+' picker cannot overlap account CTA');
  assert(rendered.includes('/assets/zvm-i18n-public.5c4469481130.css'), route+' must include picker styles');
}
const start=server.indexOf('const ZVM_CANONICAL_FAVICON =');
const end=server.indexOf('function sendHtml(',start);
assert(start>0&&end>start,'favicon helper located');
const favicon=new Function(server.slice(start,end)+'\nreturn applyCanonicalFavicon;')();
const sample='<html><head><title>test</title></head><body></body></html>';
const once=favicon(sample);
assert(once.includes('/assets/zvm-brand.167357885820.png'));
assert.equal(favicon(once),once,'favicon injection idempotent');

console.log('ZVM R49 header: all 5 routes canonical, picker inside buttons, font scope, favicon and mobile checks PASS');
