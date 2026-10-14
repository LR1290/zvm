'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {assessMissingRenewal,runMissingRenewalPass,orderDetailURL}=require('../src/cakto-auto-recovery');
const now=new Date('2026-10-14T11:00:00Z');
const paidAt='2026-10-13T13:00:00Z';
const order={id:'pay1',status:'paid',offer_type:'main',paidAt,subscription:'sub1',customer:{email:'owner@example.test'}};
const prior={keyCode:'license-one-00001',txId:'first',subscriptionId:'sub1',paidAt:'2026-09-13T13:00:00Z',source:'cakto',approved:true};
function mockDB({manual=false,hasPrior=true,hasNewer=false,owners=1,existing=false,queued=false}={}){
 const writes=[];
 return {writes,collection:name=>({
   async findOne(q){
     if(name==='payments'){
       if(q.$or)return existing?{_id:1}:null;
       if(q.subscriptionId)return hasPrior?prior:null;
       if(q.keyCode)return hasNewer?{_id:2}:null;
     }
     if(name==='webhook_events')return queued?{_id:3}:null;
     if(name==='admin_audit_logs')return manual?{_id:4}:null;
     throw Error('unexpected_find_'+name);
   },
   find(q){
     assert.equal(name,'portal_users');
     assert.equal(q.keyCode,prior.keyCode);
     return {limit:n=>{assert.equal(n,2);return {toArray:async()=>Array.from({length:owners},(_,i)=>({_id:i}))};}};
   },
   updateOne(){writes.push('update');throw Error('unexpected_write');},
   insertOne(){writes.push('insert');throw Error('unexpected_write');}
 })};
}
function args(db,extras={}){
 return {db,now,
  normalize:({event,data})=>({event,status:data.status,txId:data.id,
    subscriptionId:data.subscription,paidAt:data.paidAt,clientEmail:data.customer.email}),
  resolvePlan:()=>({id:'padrao'}),
  validateIntegrity:()=>({ok:true}),
  enqueue:async()=>{},
  ...extras};
}
const json=(data)=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
const fetcher=async(url,opts)=>{
 assert.equal(new URL(url).origin,'https://api.cakto.com.br');
 assert.equal(opts.method,'GET');assert.equal(opts.redirect,'manual');
 assert.equal(opts.headers.Authorization,'Bearer scoped-read-only');
 return url.includes('/orders/pay1/')?json(order):json({results:[order],next:null});
};
(async()=>{
 let checks=0;
 assert.throws(()=>orderDetailURL('../'),/cakto_recovery_order_invalid/);checks++;
 assert.equal(orderDetailURL('pay1'),'https://api.cakto.com.br/public_api/orders/pay1/');checks++;
 const accept=await assessMissingRenewal(order,args(mockDB()));
 assert.equal(accept.kind,'enqueued');checks++;
 for(const [scenario,config,reason] of [
  ['manual',{manual:true},'manual_renewal_after_payment'],
  ['missing',{hasPrior:false},'subscription_not_previously_bound'],
  ['newer',{hasNewer:true},'newer_payment_exists'],
  ['missing_owner',{owners:0},'no_portal_owner'],
  ['multiple_owners',{owners:2},'ambiguous_portal_ownership']
 ]){
   const result=await assessMissingRenewal(order,args(mockDB(config)));
   assert.equal(result.reason,reason,scenario);checks++;
 }
 const grace=await assessMissingRenewal({...order,paidAt:'2026-10-14T10:50:00Z'},args(mockDB()));
 assert.equal(grace.reason,'payment_grace');checks++;
 const real=mockDB();let enqueues=0;
 const result=await runMissingRenewalPass({token:'scoped-read-only',...args(real,{enqueue:async()=>{enqueues++;}}),fetcher});
 assert.equal(result.enqueued,1);assert.equal(result.complete,true);assert.equal(enqueues,1);
 assert.equal(real.writes.length,0);checks++;
 const corrected=await runMissingRenewalPass({token:'scoped-read-only',...args(mockDB({manual:true})),fetcher});
 assert.equal(corrected.enqueued,0);assert.equal(corrected.review,1);
 assert.equal(corrected.blockedReasons.manual_renewal_after_payment,1);checks++;
 const already=await runMissingRenewalPass({token:'scoped-read-only',...args(mockDB({existing:true})),fetcher});
 assert.equal(already.existing,1);assert.equal(already.enqueued,0);checks++;
 const queued=await runMissingRenewalPass({token:'scoped-read-only',...args(mockDB({queued:true})),fetcher});
 assert.equal(queued.alreadyQueued,1);assert.equal(queued.enqueued,0);checks++;
 const code=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 for(const marker of [
  'async function runCaktoRecoveryMonitorOnce()',
  'const token = await getScopedToken(CAKTO_READONLY_CLIENT_ID, CAKTO_READONLY_CLIENT_SECRET)',
  'runMissingRenewalPass({',
  'CAKTO_READONLY_CLIENT_ID && CAKTO_READONLY_CLIENT_SECRET',
  'if (written.queued) triggerCaktoWorker()',
  'clearInterval(_caktoRecoveryTimer)'
 ]) {assert(code.includes(marker),'missing safe reconciliation integration '+marker);checks++;}
 console.log('R46.77 Cakto safe autonomous reconciliation:'+checks+' regression families PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
