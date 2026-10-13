'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const Module=require('node:module');
process.env.RENDER='true';
process.env.ADMIN_USER='synthetic-admin';
process.env.ADMIN_PASS='synthetic-password';
process.env.APP_SECRET='offline-cakto-binding-test-secret-never-production-64chars';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/offline';
// Public checkout v2 must be explicitly bound to a synthetic verified offer.
process.env.ZVM_START_V2_CHECKOUT_URL='https://pay.cakto.com.br/synthetic-start-2026';
process.env.CAKTO_START_V2_OFFER_ID='synthetic_start_offer_v2';
const helper=require('../src/cakto-checkout-binding');
const realLoad=Module._load;let api;
try{
 Module._load=function(id,...args){if(id==='mongodb')return {MongoClient:class OfflineMongoDouble{}};return realLoad.call(this,id,...args);};
 api=require(path.resolve(__dirname,'../server.js')).__test;
}finally{Module._load=realLoad;}
const fixed=Date.parse('2026-10-13T12:00:00Z');
const owner='owner@example.com',payer='payer@example.com';
const target='zv-target-00001',other='zv-payer-00001';
const url=helper.checkoutUrlForPortal(api.ZVM_PLANS.padrao.checkoutUrl,target,owner,process.env.APP_SECRET,fixed);
const claim=new URL(url).searchParams.get('sck');
assert(claim&&claim.startsWith('zvm1_'));
assert(!claim.includes(target)&&!claim.includes(owner));
assert.deepEqual(helper.readCheckoutBinding(claim,process.env.APP_SECRET,fixed+1000),{keyCode:target,ownerEmail:owner});
assert.equal(helper.readCheckoutBinding(claim,process.env.APP_SECRET,fixed+46*86400000),null);
assert.equal(helper.readCheckoutBinding(claim.slice(0,-1)+'A',process.env.APP_SECRET,fixed+10),null);
assert.equal(helper.checkoutUrlForPortal('https://evil.example',target,owner,process.env.APP_SECRET,fixed),'https://evil.example');

for (const html of [
 api.renderPlanosPage({email:owner,keyCode:target}),
 api.renderPortalPlans({email:owner,keyCode:target},{maxUses:3}),
]) {
 assert.match(html,/sck=zvm1_[A-Za-z0-9_-]+/,'authenticated plan view must bind checkout to actual portal key');
 assert(!html.includes(target),'checkout must not expose raw license key in HTML');
}
assert(!api.renderPlanosPage().includes('sck=zvm1_'),'anonymous checkout must not contain license binding');

const payload={event:'purchase_approved',data:{
 id:'synthetic-paid-tx-001',status:'paid',customer:{name:'Test',email:payer,phone:''},
 product:{id:api.ZVM_PLANS.padrao.productId||'',name:api.ZVM_PLANS.padrao.name},
 offer:{id:api.ZVM_PLANS.padrao.offerId||'',name:api.ZVM_PLANS.padrao.name,price:api.ZVM_PLANS.padrao.price,currency:'BRL'},
 baseAmount:api.ZVM_PLANS.padrao.price,amount:api.ZVM_PLANS.padrao.price,
 offer_type:'main',sck:claim,subscription:{id:'synthetic-subs-001'},
 paidAt:'2026-10-13T12:00:00.000Z'
}};
const normalized=api.normalizeCaktoPurchases(payload)[0];
assert.equal(normalized.checkoutBinding,claim,'checkout proof must survive normalization');
const withMetadata={...payload,data:{...payload.data,sck:'',metadata:{sck:claim}}};
assert.equal(api.normalizeCaktoPurchases(withMetadata)[0].checkoutBinding,claim,'Cakto metadata.sck survives normalization');

assert.equal(normalized.subscriptionId,'synthetic-subs-001','renewal identity must survive normalization');
const compact=api.compactCaktoPurchaseForQueue(normalized);
assert.equal(compact.checkoutBinding,claim,'checkout proof must survive encrypted queue serialization');
assert.equal(compact.subscriptionId,'synthetic-subs-001');
const keyStore={
 [target]:{active:true,note:'',maxUses:1,expiresAt:'2026-10-30T12:00:00.000Z',phones:[]},
 [other]:{active:true,note:'Email: '+payer,maxUses:3,expiresAt:'2026-10-31T12:00:00.000Z',phones:[]}
};
const payments=[],links=[];
const deps={
 db:{},keyStore,disableCommercialLock:true,skipPaymentIdempotency:true,
 findPortalUser:async email=>email===owner?{keyCode:target}:email===payer?{keyCode:other}:null,
 findPaymentBySubscription:async sub=>payments.filter(p=>p.subscriptionId===sub).at(-1)||null,
 linkPortalUser:async (...args)=>links.push(args),
 persistKey:async()=>{},savePayment:async p=>payments.push(p),sendKeyDeliveryEmail:async()=>true,
 now:new Date(fixed)
};
(async()=>{
 const first=await api.processCommercialSale(normalized,api.ZVM_PLANS.padrao,deps);
 assert.equal(first.renewed,true);
 assert.equal(first.keyCode,target,'owner selected from signed claim, not payer email');
 assert.equal(keyStore[target].expiresAt,'2026-11-29T12:00:00.000Z');
 assert.equal(keyStore[other].expiresAt,'2026-10-31T12:00:00.000Z','unrelated payer key not extended');
 assert.equal(links.length,0,'third-party payment must not hijack payer portal');
 assert.equal(payments[0].subscriptionId,'synthetic-subs-001');

 const replay=await api.processCommercialSale(normalized,api.ZVM_PLANS.padrao,deps);
 assert.equal(replay.expiresAt,first.expiresAt,'same transaction cannot credit twice');

 const second={...normalized,txId:'synthetic-paid-tx-002',event:'subscription_renewed',checkoutBinding:'',
  clientEmail:'changed-payer@example.com',paidAt:'2026-11-13T12:00:00.000Z'};
 const next=await api.processCommercialSale(second,api.ZVM_PLANS.padrao,{...deps,now:new Date('2026-11-13T12:00:00Z')});
 assert.equal(next.keyCode,target,'renewal follows paid subscription id even if payer email changes');
 assert.equal(next.expiresAt,'2026-12-29T12:00:00.000Z');
 assert.equal(keyStore[other].expiresAt,'2026-10-31T12:00:00.000Z');
 const tampered={...normalized,txId:'synthetic-paid-tx-003',checkoutBinding:'zvm1_bad'};
 await assert.rejects(api.processCommercialSale(tampered,api.ZVM_PLANS.padrao,deps),/checkout_binding_invalid/);
 assert.equal(keyStore[target].expiresAt,'2026-12-29T12:00:00.000Z','rejected token has no side-effects');
 console.log('R46.61 entitlement checkout/renewal identity/idempotency regression PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
