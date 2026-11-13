'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const path=require('node:path');
const {displayLicensePlan}=require('../src/commercial-plan-labels');
const {readNewCatalog}=require('../src/commercial-public-catalog');
const {buildKeyDeliveryDesign}=require('../src/email-key-delivery-design');
const {buildKeyDeliveryEmail}=require('../mailer');
assert.equal(displayLicensePlan({planId:'solo',maxUses:1}).label,'SOLO');
assert.equal(displayLicensePlan({planId:'padrao',maxUses:3}).label,'START');
assert.equal(displayLicensePlan({planId:'pro',maxUses:5}).label,'PRO');
assert.equal(displayLicensePlan({planId:'empresarial',maxUses:10}).tone,'enterprise');
assert.equal(displayLicensePlan({planId:'solo',maxUses:3}).ambiguous,true);
assert.equal(displayLicensePlan({maxUses:-1}).label,'Licença sem limite');
assert.equal(displayLicensePlan({planLabel:'BUSINESS',maxUses:3}).ambiguous,true);

const inactive=readNewCatalog({});
assert.equal(inactive.start_v2.price,59.90);
assert.equal(inactive.pro_v2.price,149.90);
assert.equal(inactive.enterprise_v2.consult,true);
assert(!inactive.start_v2.enabled&&!inactive.pro_v2.enabled&&!inactive.enterprise_v2.enabled);
assert.equal(inactive.pro_v2.checkoutUrl,'');
const historicalCheckout=readNewCatalog({ZVM_START_V2_CHECKOUT_URL:'https://pay.cakto.com.br/spxbb8u_1030568',CAKTO_START_V2_OFFER_ID:'new_offer_start_123'});
assert.equal(historicalCheckout.start_v2.enabled,false,'must not relabel legacy checkout as START');
const active=readNewCatalog({ZVM_START_V2_CHECKOUT_URL:'https://pay.cakto.com.br/new-start_20261013',CAKTO_START_V2_OFFER_ID:'new_start_20261013',ZVM_PRO_V2_CHECKOUT_URL:'https://pay.cakto.com.br/new-pro_20261013',CAKTO_PRO_V2_OFFER_ID:'new_pro_20261013'});
assert(active.start_v2.enabled&&active.pro_v2.enabled);
assert.equal(active.enterprise_v2.enabled,false);
for(const row of [{id:'solo',name:'SOLO'},{id:'padrao',name:'START'},{id:'pro',name:'PRO'},{id:'empresarial',name:'ENTERPRISE'}]){
 const letter=buildKeyDeliveryDesign({planId:row.id,maxUses:row.id==='solo'?1:row.id==='padrao'?3:row.id==='pro'?5:10,code:'zv-synthetic-key-1234',expiresAt:'2026-11-14T03:00:00.000Z',baseUrl:'https://zvm.onrender.com',ctaPath:'/cliente'});
 assert.match(letter.html,new RegExp(row.name),'correct theme label');
 if(letter.artwork){
   assert.equal(letter.artwork.validity,'14/11/2026','actual expiry in Sao Paulo');
   assert.equal(letter.artwork.code,'zv-synthetic-key-1234');
   assert.equal(letter.artwork.backgroundOriginal,true,'complete approved source artwork required');
   assert.match(letter.html,/data-zvm-whole-art="1"/);
   for(const field of ['key','plan','validity'])assert(letter.html.includes('data-zvm-live="'+field+'"'),'selectable '+field);
   assert(!/<img\b|<svg\b|<script\b|cid:|data:image|__ZVM_SLICE_/i.test(letter.html),'no images as elements or email attachments');
 }else{
   assert.match(letter.html,/14\/11\/2026/,'SOLO fallback preserves stored expiry');
   assert.match(letter.html,/zv-synthetic-key-1234/);
 }
 assert.match(letter.artwork ? letter.text : letter.html,/https:\/\/zvm.onrender.com\/cliente/);
 assert(!letter.html.includes('59,90'),'email must not invent historical price');
}
const xss=buildKeyDeliveryEmail({code:'<script>alert(1)</script>',planId:'solo',maxUses:1,expiresAt:'nonsense'});
assert(!xss.html.includes('<script>'),'XSS must be escaped');
assert(xss.html.includes('&lt;script&gt;'));
assert(xss.html.includes('Consulte no Portal do Cliente'));
const oldOutbox=buildKeyDeliveryEmail({planLabel:'Padrão',maxUses:3,code:'test',renewed:true,expiresAt:'2026-11-14T03:00:00.000Z'});
assert.match(oldOutbox.html,/START/,'pre-existing encrypted mail queued before migration remains renderable');
assert.equal(oldOutbox.artwork?.tone,'start','pre-existing outbox uses approved START art');
assert.equal(oldOutbox.subject,'ZVM — Renovação confirmada');
assert(!oldOutbox.html.includes('BEM-VINDO(A)'),'renewal copy must differ from new order');
assert(!buildKeyDeliveryEmail({planId:'solo',maxUses:3,code:'test'}).html.includes('ZVM START'),'inconsistent persisted license must not be misbranded');

process.env.RENDER='true';
process.env.ADMIN_USER='test_admin';
process.env.ADMIN_PASS='test_secret';
process.env.APP_SECRET='offline-plan-migration-test-secret-2026-10-13';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/offline';
const load=Module._load;let api;
try{
 Module._load=function(id,...args){if(id==='mongodb')return {MongoClient:class OfflineMongoDouble{}};return load.call(this,id,...args);};
 api=require(path.resolve(__dirname,'../server.js')).__test;
}finally{Module._load=load;}
const site=api.renderPlanosPage();
assert(site.includes('SOLO')&&site.includes('START')&&site.includes('PRO')&&site.includes('ENTERPRISE'));
assert(site.includes('39<span>,90')&&site.includes('59<span>,90')&&site.includes('94<span>,90')&&site.includes('Sob consulta'));
assert(!site.includes('149<span>,90'),'former unconfigured PRO v2 price is not public');
assert(site.includes('data-plan-id="solo"') && site.includes('39<span>,90'), 'SOLO public card must preserve historical R$39,90 price');
assert(site.includes('data-plan-id="padrao"') && site.includes('data-plan-id="pro"'), 'START/PRO reuse the verified original Cakto contracts');
assert(!site.includes('data-buy-plan="enterprise_v2"'));
assert(site.includes('data-buy-plan="padrao"') && site.includes('data-buy-plan="pro"'), 'guest checkout must offer original Cakto plans when open');
assert(!site.includes('data-login-plan='), 'no account may be required to reach the Cakto checkout');
assert(!site.includes('data-buy-plan="start_v2"'),'inactive v2 checkout must never be substituted for the original offer');
const portal=api.renderPortalPlans({email:'example@example.com'},{planId:'solo',maxUses:1});
assert(portal.includes('94<span>,90')&&portal.includes('Sob consulta'));
assert(portal.includes('data-plan-id="solo"')&&portal.includes('39<span>,90'), 'SOLO must be available to portal customer without changing their legacy contract');
assert(portal.includes('data-buy-plan="padrao"') && portal.includes('data-buy-plan="pro"'), 'original Cakto offers may be purchased by authenticated users');
assert(!portal.includes('data-buy-plan="start_v2"'),'inactive v2 offer must remain distinct');
assert(portal.includes('Renovar contrato anterior'),'legacy subscribers retain checkout while the new catalog has disabled checkout');
assert(portal.includes('https://pay.cakto.com.br/7kzktq2_1000035'),'legacy SOLO keeps its own price and checkout');
assert(!api.renderPortalPlans({email:'example@example.com'},{planId:'start_v2',maxUses:1}).includes('Renovar contrato anterior'),'v2 plans never silently fallback to old checkout');

const oldSale=api.resolveCaktoPlan({productName:'ZVM Solo'});
assert.equal(oldSale.id,'solo','legacy Cakto product mapping must remain unchanged');
assert.equal(api.resolveCaktoPlan({productName:'ZVM PRO'},{
  legacy:{id:'pro',name:'ZVM PRO',shortName:'Pro',price:94.90},
  modern:{id:'pro_v2',name:'ZVM PRO',shortName:'PRO',price:149.90}
}),null,'ambiguous PRO names require a pinned offer/checkout identity');
assert(!portal.includes('data-buy-plan="enterprise_v2"'),'Enterprise must never have a checkout');
assert(!/<a class="plan-btn[^"]*"[^>]*>Sob consulta<\/a>/.test(site),'Enterprise is a badge, not a clickable offer');

console.log('R46.62 catalogue, email, admin migration and guest checkout gates PASS');
