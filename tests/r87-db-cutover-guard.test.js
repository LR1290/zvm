'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  TARGET, ACK, REQUIRED, databaseSelected, assertZvmCutoverReady
} = require('../src/db-cutover-guard');
let checks = 0;
async function yes(p,why){assert.ok(await p,why);checks++;}
async function failure(fn,matcher){await assert.rejects(fn,matcher);checks++;}
const old='zv-abcde-12345-abcde';
const v2='zv2a-'+ 'a'.repeat(52);
const base=[...REQUIRED];
function fixture({names=base, keys={[old]:{active:true}}, accounts=39, payments=33}={}) {
  const calls=[];
  const db={
    listCollections(filter,opts){calls.push('list');assert.equal(opts.nameOnly,true);return {toArray:async()=>names.map(name=>({name}))};},
    collection(name){calls.push(name);return {
      findOne:async(q)=>{assert.deepEqual(q,{_id:'keys'});return {data:keys};},
      countDocuments:async()=>name==='portal_users'?accounts:payments
    }}
  };
  return {db,calls};
}
(async()=>{
  await yes(TARGET==='zvm'&&ACK==='zapvoice-to-zvm-verified','stable target and manual ack');
  await yes(databaseSelected({MONGODB_DB:'ZVM'}),'case normalization');
  await yes(!databaseSelected({MONGODB_DB:'zapvoice'}),'legacy not gated');
  const a=fixture();
  const legacy=await assertZvmCutoverReady(a.db,{MONGODB_DB:'zapvoice'});
  await yes(!legacy.gated&&a.calls.length===0,'legacy startup performs no extra reads');
  const empty=fixture();
  await failure(()=>assertZvmCutoverReady(empty.db,{MONGODB_DB:'zvm'}),/NOT_CONFIRMED/);
  await yes(empty.calls.length===0,'missing ACK fails without touching DB');
  const result=await assertZvmCutoverReady(a.db,{MONGODB_DB:'zvm',ZVM_DB_CUTOVER_CONFIRMED:ACK});
  await yes(result.gated&&result.keys===1&&result.accounts===39&&result.payments===33,'realistic old key persists');
  await yes(a.calls.includes('store')&&a.calls.includes('portal_users')&&a.calls.includes('payments'),'separate collections checked');
  for(const missing of REQUIRED){
    const db=fixture({names:REQUIRED.filter(x=>x!==missing)}).db;
    await failure(()=>assertZvmCutoverReady(db,{MONGODB_DB:'zvm',ZVM_DB_CUTOVER_CONFIRMED:ACK}),/MISSING_COLLECTIONS/);
  }
  await failure(()=>assertZvmCutoverReady(fixture({keys:{}}).db,{MONGODB_DB:'zvm',ZVM_DB_CUTOVER_CONFIRMED:ACK}),/REQUIRED_RECORDS_MISSING/);
  await failure(()=>assertZvmCutoverReady(fixture({accounts:0}).db,{MONGODB_DB:'zvm',ZVM_DB_CUTOVER_CONFIRMED:ACK}),/REQUIRED_RECORDS_MISSING/);
  await failure(()=>assertZvmCutoverReady(fixture({payments:0}).db,{MONGODB_DB:'zvm',ZVM_DB_CUTOVER_CONFIRMED:ACK}),/REQUIRED_RECORDS_MISSING/);
  await yes((await assertZvmCutoverReady(fixture({keys:{[v2]:{active:true}}}).db,{MONGODB_DB:'zvm',ZVM_DB_CUTOVER_CONFIRMED:ACK})).gated,'official KEY V2 supported');
  await failure(()=>assertZvmCutoverReady(fixture({keys:{['zv2l-'+ 'a'.repeat(52)]:{active:true}}}).db,{MONGODB_DB:'zvm',ZVM_DB_CUTOVER_CONFIRMED:ACK}),/REQUIRED_RECORDS_MISSING/);
  await failure(()=>assertZvmCutoverReady(null,{MONGODB_DB:'zvm',ZVM_DB_CUTOVER_CONFIRMED:ACK}),/DB_UNAVAILABLE/);
  const src=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  const start=src.indexOf('async function getMongoDb() {'),end=src.indexOf('function zvmInvalidateMongoOnNetworkError(',start);
  const region=src.slice(start,end);
  await yes(region.includes('await assertZvmCutoverReady(candidateDb, process.env);'),'server wired to guard');
  await yes(region.indexOf('await assertZvmCutoverReady(candidateDb, process.env);')<region.indexOf('_mongoDb = candidateDb;'),'guard before server accepts DB');
  await yes(region.indexOf('await assertZvmCutoverReady(candidateDb, process.env);')<region.indexOf("console.log('✅ MongoDB conectado')"),'guard before connection success log');
  console.log('R87 MongoDB cutover fail-closed PASS: '+checks+' controls');
})().catch(e=>{console.error(e);process.exitCode=1});
