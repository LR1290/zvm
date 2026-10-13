'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const path=require('node:path');
process.env.RENDER='true';
process.env.ADMIN_USER='test_admin';
process.env.ADMIN_PASS='test_secret';
process.env.APP_SECRET='offline-lab-null-index-regression';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/offline';
const original=Module._load;let api;
try {
 Module._load=function(id,...args){
  if(id==='mongodb') return {MongoClient:class OfflineMongoDouble{}};
  return original.call(this,id,...args);
 };
 api=require(path.resolve(__dirname,'../server.js')).__test;
} finally {Module._load=original;}
(async()=>{
 const persisted=[];
 const insert=async doc=>{
  // Reproduce MongoDB's sparse unique index semantics:
  // an own property set to undefined is encoded as BSON null by the driver.
  assert.equal(Object.hasOwn(doc,'commercialTxKey'),false,
   'simulator must OMIT, not assign undefined to commercialTxKey');
  assert.equal(doc.testMode,true);
  assert.equal(doc.txNamespace,'simulacao');
  assert.equal(doc.source,'analytics_simulator');
  assert.equal(doc.approved,true);
  assert(doc.txId&&typeof doc.txId==='string');
  assert(!persisted.some(x=>x.txId===doc.txId),'every simulation needs a unique transaction');
  persisted.push({...doc});
 };
 const a=await api.simulateCommercialSale({planId:'solo',name:'Sandbox A',email:'test-only@example.com',method:'pix',execute:true,sendRealEmail:false,_testSavePayment:insert});
 const b=await api.simulateCommercialSale({planId:'solo',name:'Sandbox B',email:'test-only@example.com',method:'credit_card',execute:true,sendRealEmail:false,_testSavePayment:insert});
 assert.equal(a.mode,'execute'); assert.equal(b.mode,'execute');
 assert.equal(persisted.length,2);
 assert.notEqual(a.txId,b.txId);
 assert.equal(a.emailSent,false);
 assert.equal(b.emailSent,false);
 assert.equal(a.planId,'solo'); assert.equal(b.planId,'solo');
 console.log('R46.65 simulator sparse-unique-index regression PASS (2 sales, no real Mongo/email)');
})().catch(e=>{console.error(e);process.exitCode=1;});
