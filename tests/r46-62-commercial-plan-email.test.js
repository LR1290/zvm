'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const path=require('node:path');
const {displayLicensePlan}=require('../src/commercial-plan-labels');
const {readNewCatalog}=require('../src/commercial-public-catalog');
const {buildKeyDeliveryDesign}=require('../src/email-key-delivery-design');
const {buildKeyDeliveryEmail}=require('../mailer');
assert.equal(displayLicensePlan({planId:'solo',maxUses:1}).label,'START');
assert.equal(displayLicensePlan({planId:'padrao',maxUses:3}).label,'PRO');
assert.equal(displayLicensePlan({planId:'pro',maxUses:5}).label,'PRO - contrato anterior');
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
for(const row of [{id:'solo',name:'START'},{id:'padrao',name:'PRO'},{id:'empresarial',name:'ENTERPRISE'}]){
 const letter=buildKeyDeliveryDesign({planId:row.id,maxUses:row.id==='solo'?1:row.id==='padrao'?3:10,code:'zv-synthetic-key-1234',expiresAt:'2026-11-14T03:00:00.000Z',baseUrl:'https://zvm.onrender.com',ctaPath:'/cliente'});
 assert.match(letter.html,new RegExp(row.name),'correct theme label');
 assert.match(letter.html,/14\/11\/2026/,'actual expiry in Sao Paulo');
 assert.match(letter.html,/zv-synthetic-key-1234/);
 assert.match(letter.html,/https:\/\/zvm.onrender.com\/cliente/);
 assert(!letter.html.includes('59,90'),'email must not invent historical price');
}
const xss=buildKeyDeliveryEmail({code:'<script>alert(1)</script>',planId:'solo',maxUses:1,expiresAt:'nonsense'});
assert(!xss.html.includes('<script>'),'XSS must be escaped');
assert(xss.html.includes('&lt;script&gt;'));
assert(xss.html.includes('Consulte no Portal do Cliente'));
const oldOutbox=buildKeyDeliveryEmail({planLabel:'Padrão',maxUses:3,code:'test',renewed:true,expiresAt:'2026-11-14T03:00:00.000Z'});
assert.match(oldOutbox.html,/PRO/,'pre-existing encrypted mail queued before migration remains renderable');
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
assert(site.includes('START')&&site.includes('PRO')&&site.includes('ENTERPRISE'));
assert(site.includes('59<span>,90')&&site.includes('149<span>,90')&&site.includes('Sob consulta'));
assert(!site.includes('R$39,90')&&!site.includes('R$94,90'));
assert(!site.includes('data-buy-plan="enterprise_v2"'));
assert(!site.includes('data-buy-plan="start_v2"'),'unconfigured checkout must be disabled');
const portal=api.renderPortalPlans({email:'example@example.com'},{planId:'solo',maxUses:1});
assert(portal.includes('149<span>,90')&&portal.includes('Sob consulta'));
assert(!portal.includes('data-buy-plan="start_v2"'),'legacy checkout must not leak to new site');
const oldSale=api.resolveCaktoPlan({productName:'ZVM Solo'});
assert.equal(oldSale.id,'solo','legacy Cakto product mapping must remain unchanged');
assert.equal(api.resolveCaktoPlan({productName:'ZVM PRO'},{
  legacy:{id:'pro',name:'ZVM PRO',shortName:'Pro',price:94.90},
  modern:{id:'pro_v2',name:'ZVM PRO',shortName:'PRO',price:149.90}
}),null,'ambiguous PRO names require a pinned offer/checkout identity');
assert(!portal.includes('data-buy-plan="enterprise_v2"'),'Enterprise must never have a checkout');
assert(!/<a class="plan-btn[^"]*"[^>]*>Sob consulta<\/a>/.test(site),'Enterprise is a badge, not a clickable offer');

console.log('R46.62 catalogue, email, admin migration and fail-closed checkout gates PASS');
