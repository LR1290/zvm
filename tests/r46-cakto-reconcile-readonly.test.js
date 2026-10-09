'use strict';
const assert = require('node:assert/strict');
const {
 audit, historyURL, orderURL, parseMainOrder, currentOrderPaid,
 eventKeyFor, paymentKeyFor, getJSON,
} = require('../tools/cakto-reconcile-readonly.js');
const webhookUrl = 'https://zvm.example.test/api/cakto/webhook';
const history = 'https://api.cakto.com.br/public_api/webhook/event_history/';
function event(id, eventName='purchase_approved', status=503, opts={}) {
 return { id: 'history-'+id, app: {url: opts.url || webhookUrl}, event_id:eventName,event_status:status,
  payload: { event:eventName, data: { id, status:opts.status || 'paid', offer_type:'main', customer:{ email:'PRIVATE@TEST.INVALID' }, secret:'PRIVATE_SECRET' } } };
}
function response(json,status=200) {
 return new Response(JSON.stringify(json),{status, headers:{'content-type':'application/json'}});
}
function mock({pages, orders={}, payments=[], queue=[], failures=[]}) {
 let calls=[], writes=[];
 const db={collection(n) {return {
  async findOne(q) {
    if(n==='webhook_events') return queue.includes(q.eventKey)?{_id:1}:null;
    if(n==='payments') return payments.includes(q.$or[0].commercialTxKey)?{_id:1}:null;
    throw Error('unexpected collection');
  },
  async insertOne(){writes.push('insert');throw Error('unexpected write');},
  async updateOne(){writes.push('update');throw Error('unexpected write');},
  async deleteOne(){writes.push('delete');throw Error('unexpected write');},
 };}};
 const fetcher = async (url, init) => {
  calls.push({url, method:init.method, authorization:init.headers.Authorization});
  assert.equal(init.method,'GET'); assert.equal(init.redirect,'manual');
  assert.equal(init.headers.Authorization,'Bearer fixture-read-only');
  assert.equal(new URL(url).origin,'https://api.cakto.com.br');
  if(failures.some(part=>url.includes(part))) return response({detail:'denied',secret:'PRIVATE_SECRET'},401);
  if(url.includes('event_history')) return response(pages.shift());
  const id=decodeURIComponent(url.split('/orders/')[1]?.split('/')[0]||'');
  return response(orders[id] || {id,status:'missing'});
 };
 return {db,fetcher,calls,writes};
}
(async()=>{
 let cases=0;
 assert.equal(eventKeyFor('one'),`cakto:purchase_approved:evt_${require('crypto').createHash('sha256').update('cakto:event\0one').digest('hex')}`);cases++;
 assert.equal(paymentKeyFor('one'),`cpt_${require('crypto').createHash('sha256').update('cakto\0one').digest('hex')}`);cases++;
 assert.equal(historyURL(history+'?page=2'),`${history}?page=2`);cases++;
 for(const bad of ['https://other.invalid/public_api/webhook/event_history/','http://api.cakto.com.br/public_api/webhook/event_history/', 'https://api.cakto.com.br@evil.invalid/public_api/webhook/event_history/', '/public_api/orders/order-id/','https://api.cakto.com.br/public_api/webhook/event_history/#x']) {
  assert.throws(()=>historyURL(bad));cases++;
 }
 assert.equal(orderURL('aa-bb'),'https://api.cakto.com.br/public_api/orders/aa-bb/'); cases++;
 for(const bad of ['../../etc/passwd','..','.','a/b','', 'x'.repeat(121)]) {assert.throws(()=>orderURL(bad));cases++}
 assert.equal(parseMainOrder(event('1')).id,'1');cases++;
 assert.equal(parseMainOrder(event('1','purchase_refunded')).category,'ignored_event');cases++;
 assert.equal(parseMainOrder({event_id:'purchase_approved',payload:{data:[{id:'one',offer_type:'main'},{id:'two',offer_type:'main'}]}}).category,'ambiguous_payload');cases++;
 assert.equal(currentOrderPaid({id:'x',status:'paid'},'x'),true);cases++;
 for(const o of [{id:'x',status:'refunded'},{id:'x',status:'paid',refundedAt:'y'},{id:'x',status:'paid',canceledAt:'y'},{id:'x',status:'paid',chargedbackAt:'y'},{id:'x',status:'paid',refundedAt:null,chargedbackAt:null,canceledAt:null}, {id:'y',status:'paid'}]) {
  assert.equal(currentOrderPaid(o,'x'),o.id==='x'&&o.status==='paid'&&!o.refundedAt&&!o.chargedbackAt&&!o.canceledAt);cases++;
 }
 const rows=[event('new-paid','subscription_renewed',500),event('new-paid','purchase_approved',200),event('alreadypaid'),event('queued'), event('refund'),event('chargeback'),event('cancel'),event('notpaid'),event('providerfail'),event('other-target','purchase_approved',500,{url:'https://other.test/webhook'}),event('not-commercial','purchase_refunded'), event('not-paid-event','purchase_approved',503,{status:'pending'})];
 const m=mock({pages:[{results:rows.slice(0,5),next:`${history}?page=2`},{results:rows.slice(5),next:null}],
  payments:[paymentKeyFor('alreadypaid')], queue:[eventKeyFor('queued')], failures:['/orders/providerfail/'],
  orders:{'new-paid':{id:'new-paid',status:'paid'},refund:{id:'refund',status:'refunded'},chargeback:{id:'chargeback',status:'paid',chargedbackAt:'today'},cancel:{id:'cancel',status:'paid',canceledAt:'today'},notpaid:{id:'notpaid',status:'pending'}}});
 const result=await audit({token:'fixture-read-only',webhookUrl,mongoDb:m.db,fetcher:m.fetcher,maxPages:3,maxOrders:30});
 assert.equal(result.pagesRead,2); assert.equal(result.complete,true);
 assert.equal(result.missingVerifiedPaid,1); assert.equal(result.existingPayment,1);
 assert.equal(result.existingQueue,1); assert.equal(result.orderCurrentNotPaid,4); assert.equal(result.orderVerificationFailed,1);
 assert.equal(result.ignoredUnrelated,1);assert.equal(result.ignoredEvent,1);assert.equal(result.ambiguous,1);
 assert.equal(result.sample.length,1);assert.match(result.sample[0].ref,/^order#[a-f0-9]{12}$/);
 assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.equal(m.writes.length,0);
 assert.equal(m.calls.every(x=>x.method==='GET'),true);cases++;
 const capped=mock({pages:[{results:[event('x')],next:`${history}?page=2`}],orders:{x:{id:'x',status:'paid'}}});
 const cut=await audit({token:'fixture-read-only',webhookUrl,mongoDb:capped.db,fetcher:capped.fetcher,maxPages:1,maxOrders:10});
 assert.equal(cut.complete,false);assert.equal(cut.truncationReason,'max_pages');cases++;
 const forbidden=mock({pages:[{results:[event('x')],next:'https://attacker.invalid/steal-token'}],orders:{x:{id:'x',status:'paid'}}});
 await assert.rejects(()=>audit({token:'fixture-read-only',webhookUrl,mongoDb:forbidden.db,fetcher:forbidden.fetcher}),/pagination_url_rejected/);cases++;
 const duplicatePage=mock({pages:[{results:[],next:history+'?page=1'},{results:[],next:history+'?page=1'}]});
 await assert.rejects(()=>audit({token:'fixture-read-only',webhookUrl,mongoDb:duplicatePage.db,fetcher:duplicatePage.fetcher}),/pagination_cycle/);cases++;
 const tooMany=mock({pages:[{results:[event('1'),event('2')],next:null}],orders:{'1':{id:'1',status:'paid'},'2':{id:'2',status:'paid'}}});
 const cutOrders=await audit({token:'fixture-read-only',webhookUrl,mongoDb:tooMany.db,fetcher:tooMany.fetcher,maxOrders:1});
 assert.equal(cutOrders.complete,false);assert.equal(cutOrders.truncationReason,'max_orders');cases++;
 const badRes=mock({pages:[],failures:['event_history']});
 await assert.rejects(()=>audit({token:'fixture-read-only',webhookUrl,mongoDb:badRes.db,fetcher:badRes.fetcher}),/cakto_api_http_401/);cases++;
 const large = {ok:true,headers:{get:()=>String(2_000_000)},text:async()=>{throw Error('should not read');}};
 await assert.rejects(()=>getJSON(history,'token',{fetcher:async()=>large}),/too_large/);cases++;
 assert.equal(JSON.stringify(result).includes('fixture-read-only'),false);cases++;
 console.log(`R46.17 Cakto read-only reconciliation: PASS / ${cases} test groups, zero writes`);
})().catch(e=>{console.error(e);process.exitCode=1});
