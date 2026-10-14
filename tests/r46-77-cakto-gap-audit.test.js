'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {auditPaidOrders,createWindowUrl,validatePageUrl,isVerifiedPaidMain,getScopedToken,txMarkers}=require('../src/cakto-paid-order-audit');
const helper=require('../src/cakto-checkout-binding');
const from='2026-10-10',to='2026-10-15',base='https://api.cakto.com.br/public_api/orders/';
function order(id,paidAt='2026-10-13T07:40:00Z',opts={}) {
 return {id,paidAt,status:'paid',offer_type:'main',customer:{email:'PRIVATE@EXAMPLE.TEST',docNumber:'PRIVATE'},...opts};
}
function response(doc,code=200){return new Response(JSON.stringify(doc),{status:code,headers:{'content-type':'application/json'}});}
function fixture({pages,payments=[],queued=[]}){
 const writes=[],reads=[];
 const db={collection:name=>({
  findOne:async query=>{
   reads.push(name);
   if(name==='payments')return payments.includes(query.$or[0].commercialTxKey)?{_id:1}:null;
   if(name==='webhook_events')return queued.includes(query.eventKey)?{_id:1,status:'retry'}:null;
   throw Error('unexpected_collection');
  },
  insertOne(){writes.push('insert');throw Error('write_forbidden')},
  updateOne(){writes.push('update');throw Error('write_forbidden')},
  deleteOne(){writes.push('delete');throw Error('write_forbidden')}
 })};
 const fetcher=async(url,opt)=>{
  assert.equal(opt.method,'GET');assert.equal(opt.redirect,'manual');
  assert.equal(opt.headers.Authorization,'Bearer readonly-fixture');
  assert.equal(new URL(url).origin,'https://api.cakto.com.br');
  return response(pages.shift());
 };
 return {db,fetcher,writes,reads};
}
(async()=>{
 assert.match(createWindowUrl(from,to),/paidAt__gte=2026-10-10/);
 for(const u of ['https://evil.invalid/public_api/orders/','http://api.cakto.com.br/public_api/orders/',
  'https://api.cakto.com.br@evil.invalid/public_api/orders/','https://api.cakto.com.br/public_api/products/'])assert.throws(()=>validatePageUrl(u));
 assert(!isVerifiedPaidMain(order('x','2026-10-13T07:40:00Z',{offer_type:'orderbump'})));
 assert(!isVerifiedPaidMain(order('x','2026-10-13T07:40:00Z',{refundedAt:'now'})));
 const known=txMarkers('paid-existing'),queued=txMarkers('queue-existing');
 const mock=fixture({
  payments:[known.paymentKey],queued:[queued.eventKey],
  pages:[{results:[order('paid-existing'),order('queue-existing'),order('missing'),order('missing'),order('refund','2026-10-13T07:40:00Z',{status:'refunded'}),order('outside','2026-09-01T07:40:00Z')],next:null}]
 });
 const result=await auditPaidOrders({token:'readonly-fixture',db:mock.db,from,to,fetcher:mock.fetcher});
 assert.deepEqual({total:result.paidMain,payment:result.foundPayment,queue:result.queued,review:result.needsReview,skipped:result.skipped},
  {total:3,payment:1,queue:1,review:1,skipped:2});
 assert.equal(result.complete,true);assert.equal(mock.writes.length,0);
 assert(!JSON.stringify(result).includes('PRIVATE'));assert.match(result.sample[0],/^order#[a-f0-9]{12}$/);
 assert(!JSON.stringify(result).includes('missing'));
 const secret='test-only-long-strong-secret-for-checkout-xxxxxxxxxxxxxxxx';
 const token=helper.createCheckoutBinding({keyCode:'zv-target-00001',ownerEmail:'owner@example.test',secret,nowMs:Date.parse('2026-01-01')});
 assert(token.startsWith('zvm1_'));
 assert.equal(helper.readCheckoutBinding(token,secret,Date.parse('2026-03-01')),null);
 assert.equal(helper.inspectCheckoutBinding(token,secret,Date.parse('2026-03-01')).status,'expired');
 assert.equal(helper.inspectCheckoutBinding(token.slice(0,-2)+'xx',secret,Date.parse('2026-03-01')).status,'invalid');
 const auth=await getScopedToken('client-test','secret-test',{fetcher:async(url,opt)=>{
  assert.equal(url,'https://api.cakto.com.br/public_api/token/');
  assert.equal(opt.method,'POST');return response({access_token:'test_token',scope:'read orders',expires_in:36000});
 }});
 assert.equal(auth,'test_token');
 await assert.rejects(()=>getScopedToken('a','b',{fetcher:async()=>response({access_token:'wrong',scope:'read orders write'})}),/cakto_readonly_scope_required/);
 console.log('R46.77 provider-read-only gap auditor / claim-expiry boundaries PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
