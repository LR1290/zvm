'use strict';
// Regression for Cakto order IDs whose textual representations share a prefix.
// All sales and customer identities are synthetic; this test never opens Mongo.
const assert=require('node:assert/strict');
const Module=require('node:module');
process.env.RENDER='true';process.env.ADMIN_USER='test-admin';process.env.ADMIN_PASS='test-pass';process.env.MONGODB_URI='mongodb://127.0.0.1:1/fixture';
const old=Module._load;let api;
try {Module._load=function(id,...args){if(id==='mongodb')return {MongoClient:class{}};return old.call(this,id,...args)};api=require('../server.js').__test;}finally{Module._load=old}
const plan=api.ZVM_PLANS.padrao, day=86400000;
function sale(tx,email='one@example.invalid',at='2026-10-01T12:00:00.000Z',event='subscription_renewed') {
 return {source:'cakto',event,txId:tx,clientEmail:email,clientName:'Fixture',amount:plan.price,paidAt:at,paymentMethod:'pix'};
}
function fake(loaded={}) {
 const keyStore={...loaded};let portalKey=null;
 const db={collection(name){if(name==='store')return {async findOne(){return {data:loaded}}};throw Error('unexpected_collection')}};
 const deps={db,keyStore,disableCommercialLock:true,skipPaymentIdempotency:true,
  findPortalUser:async()=>portalKey?{keyCode:portalKey}:null,
  linkPortalUser:async(_email,key)=>{portalKey=key},
  persistKey:async()=>{},savePayment:async()=>{},sendKeyDeliveryEmail:async()=>true};
 return {keyStore,deps};
}
(async()=>{
 const a=fake();
 const first=await api.processCommercialSale(sale('invoice-123456','one@example.invalid','2026-10-01T12:00:00.000Z','purchase_approved'),plan,{...a.deps,now:new Date('2026-10-01T12:00:00.000Z')});
 const second=await api.processCommercialSale(sale('invoice-123','one@example.invalid','2026-10-15T12:00:00.000Z'),plan,{...a.deps,now:new Date('2026-10-15T12:00:00.000Z')});
 assert.equal(second.keyCode,first.keyCode);
 assert.equal(second.renewed,true,'shorter new order ID must not be mistaken for creation replay');
 assert.equal(new Date(second.expiresAt).getTime()-new Date(first.expiresAt).getTime(),30*day);
 const replay=await api.processCommercialSale(sale('invoice-123','one@example.invalid','2026-10-15T12:00:00.000Z'),plan,{...a.deps,now:new Date('2026-10-15T13:00:00.000Z')});
 assert.equal(replay.expiresAt,second.expiresAt,'identical order replay must not add duration');
 const b=fake();
 const initial=await api.processCommercialSale(sale('renew-789000','other@example.invalid','2026-10-01T12:00:00.000Z','purchase_approved'),plan,{...b.deps,now:new Date('2026-10-01T12:00:00.000Z')});
 const renewed=await api.processCommercialSale(sale('renew-789','other@example.invalid','2026-10-15T12:00:00.000Z'),plan,{...b.deps,now:new Date('2026-10-15T12:00:00.000Z')});
 assert.equal(renewed.keyCode,initial.keyCode);
 assert.equal(renewed.renewed,true);
 const unrelated={note:'Pedido Cakto\nEmail: unrelated@example.invalid\nrenovado_cakto_tx:order-987654',active:true,expiresAt:'2027-01-01T00:00:00.000Z',phones:[],maxUses:3};
 const c=fake({'other-license':unrelated});
 const different=await api.processCommercialSale(sale('order-987','new@example.invalid','2026-10-20T12:00:00.000Z'),plan,{...c.deps,now:new Date('2026-10-20T12:00:00.000Z')});
 assert.notEqual(different.keyCode,'other-license','must never recover another key on prefix match');
 assert.equal(c.keyStore['other-license'].expiresAt,'2027-01-01T00:00:00.000Z');
 console.log('R46.41 Cakto exact marker idempotence and cross-account recovery: PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
