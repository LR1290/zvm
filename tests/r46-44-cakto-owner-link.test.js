'use strict';
// Exercise the production-default Cakto Portal adapter, not an injected link stub.
// No Mongo/Render network access; synthetic emails and licenses only.
const assert=require('node:assert/strict'), Module=require('node:module');
process.env.RENDER='true';process.env.ADMIN_USER='fixture';process.env.ADMIN_PASS='fixture-password';
process.env.MONGODB_URI='mongodb://127.0.0.1:1/never';
let api;const previous=Module._load;
try{Module._load=function(id,...args){return id==='mongodb'?{MongoClient:class{}}:previous.call(this,id,...args)};api=require('../server.js').__test;}
finally{Module._load=previous}
const plan=api.ZVM_PLANS.padrao;
function model({registered=true,index=true,otherOwner=false}={}){
 const email='buyer@example.invalid',key='fictional-license-123';
 const buyer={_id:email,email,keyCode:otherOwner?null:key};
 const users={[email]:registered?buyer:null,'other@example.invalid':{_id:'other@example.invalid',email:'other@example.invalid',keyCode:otherOwner?key:null}};
 const keyStore={[key]:{active:true,maxUses:1,phones:[],uses:0,planId:'padrao',expiresAt:'2026-11-01T00:00:00.000Z',note:'Pedido Cakto\nEmail: buyer@example.invalid'}};
 let writes=0,saves=0;
 const coll={
   listIndexes:()=>({toArray:async()=>index?[{name:'fixture',unique:true,key:{keyCode:1},partialFilterExpression:{keyCode:{$type:'string',$gt:''}}}]:[{name:'keyCode_1',key:{keyCode:1}}]}),
   async findOne(q){return users[q._id]||null},
   async updateOne(q,patch){
     const user=users[q._id];if(!user||Object.hasOwn(user,'emailChangeOp'))return {matchedCount:0};
     if(Object.values(users).some(x=>x&&x!==user&&x.keyCode===patch.$set.keyCode))throw Object.assign(new Error('duplicate'),{code:11000});
     Object.assign(user,patch.$set);writes++;return {matchedCount:1};
   }
 };
 const db={collection(n){if(n==='portal_users')return coll;if(n==='store')return {async findOne(){return {data:keyStore}}};throw Error('unexpected_database_read')}};
 const deps={db,keyStore,disableCommercialLock:true,skipPaymentIdempotency:true,persistKey:async()=>{},savePayment:async()=>{saves++},sendKeyDeliveryEmail:async()=>true};
 return{deps,get writes(){return writes},get saves(){return saves}};
}
function sale(id){return {source:'cakto',event:'subscription_renewed',txId:id,clientEmail:'buyer@example.invalid',clientName:'Buyer',paidAt:'2026-10-15T12:00:00Z',amount:plan.price,paymentMethod:'pix'}}
async function run(m,id){return api.processCommercialSale(sale(id),plan,{...m.deps,now:new Date('2026-10-15T12:00:00Z')})}
(async()=>{
 const good=model(),result=await run(good,'order-good');
 assert.equal(result.renewed,true);assert.equal(good.writes,1);assert.equal(good.saves,1);
 const unavailable=model({index:false});await assert.rejects(()=>run(unavailable,'order-no-index'),{code:'ownership_index_not_ready'});
 assert.equal(unavailable.saves,0);assert.equal(unavailable.writes,0);
 const anonymous=model({registered:false});const paid=await run(anonymous,'order-no-portal');
 assert.equal(paid.renewed,true);assert.equal(anonymous.writes,0);assert.equal(anonymous.saves,1);
 const conflict=model({otherOwner:true});await assert.rejects(()=>run(conflict,'order-conflict'),{code:'license_already_linked'});
 assert.equal(conflict.writes,0);assert.equal(conflict.saves,0);
 console.log('R46.44 default Cakto portal-owner link: PASS 4 synthetic groups');
})().catch(err=>{console.error(err);process.exitCode=1});
