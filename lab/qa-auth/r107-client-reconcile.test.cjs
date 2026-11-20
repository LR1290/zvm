'use strict';
// Run after R99 -> R103 -> R104 -> R107 patches in an isolated extension lab.
// No network, real WhatsApp, production credentials, or WhatsApp sends.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=process.env.ZVM_LAB_SOURCE||path.join(__dirname,'../staging');
const file=path.join(root,'app/background/authority/license-authority.js');
const src=fs.readFileSync(file,'utf8');
const start=src.indexOf('var extFreeQuotaCommitTail='),end=src.indexOf('function extLicenseStableValue(',start);
assert(start>=0&&end>start,'must test actual extension source');
const fragment=src.slice(start,end);
function setup(handler){
 const subject='a'.repeat(64),publicRecord={authenticated:true,credentialPresent:true,
  authMethod:'password',serverSubjectId:subject,plan_id:'ZV_FREE'};
 const storage=new Map(),calls=[];
 const env={
  self:{extuiOpaqueV4Ensure:async()=>({authMethod:'password',subject:{id:subject},
   token:'b'.repeat(64),entitlement:{tier:'free'}})},
  _s05:'https://zvm.invalid',_s09:100000,chrome:{},crypto:webcrypto,
  AbortController,TextEncoder,Uint8Array,Date,Promise,setTimeout,clearTimeout,
  extLicenseOperationRevision:0,extPlanStateBg:async()=>({isFree:true,license:publicRecord}),
  extError:(code,message)=>Object.assign(Error(message),{code}),
  _s0q:async()=>({public:publicRecord,secret:{}}),
  extStorageGetOne:async key=>storage.get(key),
  extStorageSetOne:async(key,val)=>{storage.set(key,structuredClone(val));},
  _s0ReadText:async res=>JSON.stringify(res.payload),
  fetch:async(_url,req)=>{
   const request=JSON.parse(req.body);calls.push(request);
   const payload=await handler(request);
   return{status:payload.ok===false?payload.httpStatus||409:200,payload};
  }
 };
 vm.runInNewContext(fragment,env,{filename:'r107-real-license-authority.js'});
 return {env,storage,calls};
}
const ok=(action,period='2026-11-19')=>({ok:true,status:true,period,operationStatus:action,
 limits:{message:{sent:1,max:20}}});
async function reserve(x){return x.env.extPlanUsageBg('reserve','message');}
async function reconcile(x,operationId){return x.env.extPlanUsageBg('reconcile','message',undefined,{operationId});}
const journal=x=>Object.values([...x.storage.values()][0]||{})[0];
test('R107 patches actual worker: recovered server period replaces stale journal period',async()=>{
 const x=setup(async r=>r.action==='reserve'?ok('reserved'):ok('reserved','2026-11-18'));
 const reserved=await reserve(x);
 const recovered=await reconcile(x,reserved.operationId);
 assert.equal(recovered.period,'2026-11-18');
 assert.equal(journal(x).period,'2026-11-18');
 assert.deepEqual(x.calls.map(x=>x.action),['reserve','reconcile']);
});
test('R107 retries only read-only reconcile when stored period is in the future',async()=>{
 const x=setup(async r=>r.action==='reserve'?ok('reserved'):
  r.period?{ok:false,httpStatus:400,errorCode:'invalid_period'}:ok('reserved'));
 const reserved=await reserve(x),recovered=await reconcile(x,reserved.operationId);
 assert.equal(recovered.operationStatus,'reserved');
 assert.deepEqual(x.calls.map(x=>x.action),['reserve','reconcile','reconcile']);
 assert.equal(x.calls.at(-1).period,undefined);
});
test('R107 ambiguous operation receipt fails closed and never resends',async()=>{
 const x=setup(async r=>r.action==='reserve'?ok('reserved'):
  {ok:false,httpStatus:409,errorCode:'operation_period_conflict'});
 const reserved=await reserve(x);
 await assert.rejects(()=>reconcile(x,reserved.operationId),e=>e.code==='operation_period_conflict');
 assert.equal(journal(x).status,'reserved');
 assert.deepEqual(x.calls.map(x=>x.action),['reserve','reconcile']);
});
test('R107 not_found leaves original local period and never retries a WA-JS send',async()=>{
 const x=setup(async r=>r.action==='reserve'?ok('reserved'):ok('not_found','2026-11-20'));
 const reserved=await reserve(x),recovered=await reconcile(x,reserved.operationId);
 assert.equal(recovered.period,reserved.period);
 assert.equal(journal(x).period,reserved.period);
 assert.deepEqual(x.calls.map(x=>x.action),['reserve','reconcile']);
});
