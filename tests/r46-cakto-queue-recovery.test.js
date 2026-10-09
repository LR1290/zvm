'use strict';
// TEST DOUBLE — exercise CAS and replay semantics without MongoDB/network.
// Does not replace a real replica-set MongoDB transaction/concurrency test.
const assert = require('node:assert/strict');
const Module = require('node:module');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
process.env.RENDER = 'true';
process.env.ADMIN_USER = 'test-admin';
process.env.ADMIN_PASS = 'test-password';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test';
process.env.CAKTO_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.CAKTO_RECOVERY_SECRET = 't'.repeat(64);
const realLoad = Module._load;
Module._load = function(id, ...args) {
  if (id === 'mongodb') return { MongoClient: class NeverConnectMongoClient {} };
  return realLoad.call(this, id, ...args);
};
const {
  enqueueCaktoPurchaseEvent, claimNextCaktoQueuedEvent,
  encryptCaktoQueuePurchase, caktoEventKey, caktoQueueRef, handleCaktoWebhook, ZVM_PLANS,
} = require('../server.js').__test;
Module._load = realLoad;

function queryMatch(doc, query) {
  if (!query) return true;
  return Object.entries(query).every(([key,value]) => {
    if (key === '$and') return value.every(q => queryMatch(doc, q));
    if (key === '$or') return value.some(q => queryMatch(doc, q));
    const prop = doc[key];
    if (value !== null && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value)) {
      const ops = Object.entries(value);
      if (ops.every(([op]) => op.startsWith('$'))) return ops.every(([op, expected]) => {
        if (op === '$exists') return (prop !== undefined) === expected;
        if (op === '$type') return expected === 'object' && prop !== null && typeof prop === 'object' && !Array.isArray(prop);
        if (op === '$lte') return prop !== undefined && +prop <= +expected;
        if (op === '$lt') return prop !== undefined && +prop < +expected;
        if (op === '$in') return expected.includes(prop);
        throw Error(`Test filter operator not implemented: ${op}`);
      });
    }
    return prop instanceof Date && value instanceof Date ? +prop === +value : prop === value;
  });
}
function applyUpdate(doc, update) {
  for (const [k,v] of Object.entries(update.$set || {})) doc[k] = v;
  for (const k of Object.keys(update.$unset || {})) delete doc[k];
  for (const [k,v] of Object.entries(update.$inc || {})) doc[k] = (doc[k] || 0) + v;
}
class Collection {
  constructor() { this.docs = []; this.inserts = 0; this.updates = 0; }
  async findOne(q) { return this.docs.find(d => queryMatch(d,q)) || null; }
  async findOneAndUpdate(q,u,o={}) {
    // No external awaits inside this method: single-threaded atomic CAS model.
    const doc = this.docs.find(d => queryMatch(d,q));
    if (!doc) return null;
    applyUpdate(doc,u);
    this.updates++;
    if (o.projection) return Object.fromEntries(Object.entries(doc).filter(([k]) => o.projection[k]));
    return { ...doc };
  }
  async insertOne(d) {
    if (this.docs.some(doc => doc.eventKey === d.eventKey)) {
      const error = Error('E11000 duplicate'); error.code = 11000; throw error;
    }
    this.inserts++;
    this.docs.push(d);
    return { insertedId: this.inserts };
  }
}
function mockDb(coll) {
  const counter={ count:0,
    async findOneAndUpdate(query,update) {
      if (query.count?.$lt !== undefined && this.count >= query.count.$lt) return null;
      this.count += update.$inc?.count || 0;
      return {_id:'cakto_active',count:this.count};
    },
    async findOne() { return {_id:'cakto_active',count:this.count}; },
    async updateOne(_filter,update) { this.count += update.$inc?.count || 0;return {matchedCount:1}; },
  };
  return {collection(name) {
    if (name === 'webhook_events') return coll;
    if (name === 'queue_counters') return counter;
    throw Error('Unexpected collection: '+name);
  }};
}
const now = new Date('2026-10-08T20:00:00Z');
const older = new Date(now.getTime() - 10*60*1000);
const future = new Date(now.getTime() + 60*1000);
const purchase = (txId) => ({ source: 'cakto', txId, event:'subscription_renewed', clientEmail:'fixture@example.com', amount:59.9 });
const plan = {id:'padrao'};
function fixture(coll, status, txId, more={}) {
  const eventKey = caktoEventKey(txId), queueRef=caktoQueueRef(eventKey);
  const row = {source:'cakto',eventKey,queueRef, status, planId:plan.id, activeSlot:true, attempts:1,
    createdAt:older, updatedAt:older, purchaseEnc:encryptCaktoQueuePurchase(purchase(txId),queueRef),...more};
  coll.docs.push(row);
  return row;
}
async function replay(db,txId,maxActive=1) { return enqueueCaktoPurchaseEvent(db,purchase(txId),plan,{now,maxActive,atomic:{requireTransaction:false}}); }
async function webhook(db, orderId, opts={}) {
  const paidPlan=ZVM_PLANS.padrao;
  const raw=Buffer.from(JSON.stringify({
    secret:'test-webhook-secret',event:'purchase_approved',
    data:{ id:orderId, status:'paid', amount:paidPlan.price, baseAmount:paidPlan.price,
      offer_type:'main',checkoutUrl:paidPlan.checkoutUrl, paymentMethod:'pix',
      paidAt:'2026-10-08T20:00:00Z',
      customer:{name:'Fixture',email:'fixture@example.com'},
      product:{id:paidPlan.productId || '',short_id:'padrao',name:paidPlan.name},
      offer:{id:paidPlan.offerId || '',name:paidPlan.name,price:paidPlan.price,currency:'BRL'}
    }
  }));
  const ts=String(Math.floor(now.getTime()/1000));
  const signature=crypto.createHmac('sha256','test-webhook-secret').update(`${ts}.`).update(raw).digest('hex');
  const req=Readable.from([raw]);
  req.headers={'x-cakto-timestamp':ts, 'x-cakto-signature':`v1=${opts.invalidSignature?'0'.repeat(64):signature}`};
  const result={code:0, body:null};
  const res={req,setHeader(){},writeHead(code){result.code=code;},end(bytes){result.body=JSON.parse(String(bytes));}};
  await handleCaktoWebhook(req,res,new URL('https://zvm.local/api/cakto/webhook'), '127.0.0.1',
    {db,indexReady:true,secret:'test-webhook-secret', rateLimit:()=>true, now, nowMs:now.getTime()});
  return result;
}
async function scenario(status, config, expected) {
  const coll=new Collection(); const id = `${status}-${crypto.randomUUID()}`;
  const doc=fixture(coll,status,id,config); const db=mockDb(coll);
  const result=await replay(db,id);
  assert.equal(result.duplicate,true);
  assert.equal(result.recovered,expected,'recovery mismatch: '+status);
  assert.equal(doc.status,expected?'pending':status);
  assert.equal(coll.inserts,0,'duplicate consumed a queue slot');
  return {coll,doc,db,id};
}
(async()=>{
  let cases=0;
  // CAS: exactly one rearm among 25 simultaneous replays.
  {
    const coll=new Collection(), id='same-failed'; const doc=fixture(coll,'failed',id);
    const out=await Promise.all(Array.from({length:25},()=>replay(mockDb(coll),id)));
    assert.equal(out.filter(x=>x.recovered).length,1);
    assert.equal(out.filter(x=>x.duplicate).length,25);
    assert.equal(doc.status,'pending');assert.equal(doc.attempts,1);
    assert.equal(coll.inserts,0); assert.equal(coll.updates,1);
    cases++;
  }
  await scenario('failed',{nextAttemptAt:future},true); cases++;
  await scenario('retry', {nextAttemptAt:future},false); cases++;
  await scenario('retry',{},true); cases++;
  await scenario('pending',{nextAttemptAt:future},false); cases++;
  await scenario('processing',{leaseUntil:future,leaseOwner:'live',workerFence:7,lastAttemptAt:now},false); cases++;
  {
    const {doc}=await scenario('processing',{leaseUntil:older,leaseOwner:'expired',workerFence:6},true);
    assert.equal(doc.leaseOwner,undefined);assert.equal(doc.workerFence,undefined);cases++;
  }
  await scenario('processing',{leaseOwner:'legacy',lastAttemptAt:older},true); cases++;
  await scenario('processing',{leaseOwner:'recent',lastAttemptAt:now},false); cases++;
  await scenario('processed',{activeSlot:false},false); cases++;
  await scenario('payment_duplicate',{activeSlot:false},false); cases++;
  await scenario('dead_letter',{activeSlot:false},false); cases++;
  // An orphaned event without payload must NOT produce 202 success.
  {
    const coll=new Collection(),doc=fixture(coll,'failed','missing');delete doc.purchaseEnc;
    await assert.rejects(()=>replay(mockDb(coll),'missing'),e=>e.code==='cakto_queue_payload_unavailable');cases++;
  }
  // Worker resumes legacy failed without nextAttemptAt even without new webhook.
  {
    const coll=new Collection(),doc=fixture(coll,'failed','legacy-failed');
    const claimed=await claimNextCaktoQueuedEvent(mockDb(coll),'test-worker',{now,workerFence:4});
    assert.equal(claimed.eventKey,doc.eventKey);assert.equal(claimed.status,'processing');
    assert.equal(claimed.purchase.txId,'legacy-failed');cases++;
  }
  // Worker resumes older processing with missing lease but will not touch live ones.
  {
    const coll=new Collection(),doc=fixture(coll,'processing','legacy-processing',{lastAttemptAt:older});
    const claimed=await claimNextCaktoQueuedEvent(mockDb(coll),'test-worker',{now,workerFence:4});
    assert.equal(claimed.eventKey,doc.eventKey);cases++;
  }
  // E11000 race: preflight misses a concurrently committed event, CAS still single-winner.
  {
    const coll = new Collection(), id='race-duplicate', doc=fixture(coll,'failed',id);
    const firstRead = coll.findOne.bind(coll);
    let misses = 1;
    coll.findOne = async (...args) => misses-- > 0 ? null : firstRead(...args);
    const result = await replay(mockDb(coll),id,0);
    assert.equal(result.recovered,true);assert.equal(doc.status,'pending');
    assert.equal(coll.inserts,0);cases++;
  }
  // Simultaneous insert at capacity: return persisted duplicate, not 503.
  {
    const coll=new Collection(),id='at-capacity',doc=fixture(coll,'retry',id,{nextAttemptAt:future});
    const firstRead=coll.findOne.bind(coll);let misses=1;
    coll.findOne=async (...args)=>misses-- > 0 ? null : firstRead(...args);
    const counter={
      async findOneAndUpdate(){return null;},
      async findOne(){return {_id:'cakto_active', count:1};},
    };
    const db={collection(name){return name==='queue_counters'?counter:coll;}};
    const result=await replay(db,id,1);
    assert.equal(result.duplicate,true);assert.equal(result.recovered,false);
    assert.equal(doc.status,'retry');assert.equal(coll.inserts,0);cases++;
  }
  // Distinct paid transaction IDs from the same subscription may both enter.
  {
    const coll=new Collection(),db=mockDb(coll);
    const first=await replay(db,'subscription-cycle-1',0);
    const next=await replay(db,'subscription-cycle-2',0);
    assert.equal(first.queued,true);assert.equal(next.queued,true);
    assert.equal(coll.inserts,2);cases++;
  }
  // Simulated signed HTTP ingest: first 202, duplicate 202, failed rearm 202,
  // missing encrypted payload 503, invalid HMAC 401. No live payment sent.
  {
    const coll=new Collection(),db=mockDb(coll);
    const accepted=await webhook(db,'webhook-main');
    assert.equal(accepted.code,202); assert.equal(accepted.body.queued,true);
    assert.equal(accepted.body.duplicate,false);cases++;
    const duplicate=await webhook(db,'webhook-main');
    assert.equal(duplicate.code,202); assert.equal(duplicate.body.duplicate,true);
    assert.equal(duplicate.body.recovered,false);cases++;
    const doc=coll.docs[0]; doc.status='failed';
    const recovered=await webhook(db,'webhook-main');
    assert.equal(recovered.code,202);assert.equal(recovered.body.recovered,true);cases++;
    delete doc.purchaseEnc;doc.status='failed';
    const missing=await webhook(db,'webhook-main');
    assert.equal(missing.code,503);assert.equal(missing.body.ok,false);cases++;
    const badSignature=await webhook(db,'webhook-main',{invalidSignature:true});
    assert.equal(badSignature.code,401);assert.equal(badSignature.body.ok,false);cases++;
  }
  // Event 1 survives; 2nd identical API intake returns duplicate without extra insert.
  {
    const coll=new Collection(),db=mockDb(coll);
    const first=await replay(db,'new-order',0),second=await replay(db,'new-order',0);
    assert.equal(first.queued,true);assert.equal(first.duplicate,false);
    assert.equal(second.duplicate,true);assert.equal(coll.inserts,1);cases++;
  }
  console.log(`R46.16 Cakto queue recovery (in-memory CAS model): PASS / ${cases} scenarios`);
})().catch(e=>{console.error(e);process.exitCode=1;});
