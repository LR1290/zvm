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

const crypto=require('node:crypto');
const officialIconPath='/assets/zvm-brand.167357885820.png';
const greenImage=fs.readFileSync(path.join(root,'assets/zvm-brand.167357885820.png'));
assert.equal(crypto.createHash('sha256').update(greenImage).digest('hex'),
  '16735788582078e978a4fa802da332c90b96b9172bbcfa88bce7d407fee783ce',
  'official original ZVM green icon cannot be silently replaced');
assert.equal(greenImage.subarray(0,8).toString('hex'),'89504e470d0a1a0a','original icon must remain a real PNG');
assert(!fs.existsSync(path.join(root,'assets/zvm-icon.a6f91b5ec82b.png')),'wrong red icon was not removed');
assert(canonicalLogo.startsWith('data:image/png;base64,'),'original full ZVM AUTOMAÇÕES artwork must remain the header logo');
assert(htmlTemplate.includes('<link rel="apple-touch-icon" href="'+officialIconPath+'">'),'home touch icon missing');
assert(server.includes("const ZVM_SITE_ICON = '"+officialIconPath+"'"),'canonical favicon must be original green icon');
const footer=read('src/web/public/footer.js');
assert(footer.includes('<img src="'+officialIconPath+'"'),'footer must use official green icon');
const cloud=read('cloud-pilot/public/index.html');
const cloudCss=read('cloud-pilot/public/styles.css');
assert(cloud.includes('<link rel="icon" type="image/png" href="'+officialIconPath+'">'),'Cloud favicon must be original green icon');
assert(cloud.includes('<link rel="apple-touch-icon" href="'+officialIconPath+'">'),'Cloud touch icon must be original green icon');
assert((cloud.split(officialIconPath).length-1)>=5,'Cloud login/loading/header must use original icon');
assert(cloudCss.includes('.brand img.logo,.panel img.hero-mark'),'Cloud real icon styling must not revert to glyph-box');

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
assert(!/(^|\n)\*\{box-sizing:border-box;margin:0\}/.test(homeCss), 'home reset cannot mutate navbar');
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
  const group=rendered.match(/<div class="znav-action-links">([\s\S]*?)<\/div><\/div>\s*<\/nav>/);
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
const favicon=new Function('ZVM_SITE_ICON',server.slice(start,end)+'\nreturn applyCanonicalFavicon;')(officialIconPath);
const sample='<html><head><title>test</title></head><body></body></html>';
const once=favicon(sample);
assert(once.includes('/assets/zvm-brand.167357885820.png'));
assert.equal(favicon(once),once,'favicon injection idempotent');


const legacyIcons='<html><head><link rel="icon" type="image/svg+xml" href="data:image/svg+xml,LEGACY"><link rel="apple-touch-icon" href="/old.png"><title>ZVM</title></head><body><img src="/safe.png"></body></html>';
const fixedIcons=favicon(legacyIcons);
assert(!fixedIcons.includes('data:image/svg+xml,LEGACY'),'legacy favicon SVG must be removed');
assert(!fixedIcons.includes('href="/old.png"'),'obsolete Apple touch icon must be removed');
assert.equal((fixedIcons.match(/rel="icon"/g)||[]).length,1,'exactly one canonical favicon');
assert.equal((fixedIcons.match(/rel="apple-touch-icon"/g)||[]).length,1,'exactly one touch icon');
assert.equal(favicon(fixedIcons),fixedIcons,'favicon normalization must be idempotent');
assert(fixedIcons.includes('<img src="/safe.png">'),'favicon normalization must not alter body images');
assert(fixedIcons.includes('href="'+officialIconPath+'"'),'green original icon missing after normalization');

console.log('ZVM R49 header: all 5 routes canonical, picker inside buttons, font scope, original green favicon and mobile checks PASS');
