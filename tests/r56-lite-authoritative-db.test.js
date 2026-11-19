'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  readLiteLicenseSnapshot, liteKeyUsable, claimLitePhoneSlotAtomic,
} = require('../src/lite-license-authority');
const {
  PRODUCT_LITE, PRODUCT_AUTOMACOES, generateLicenseKey, keyBelongsTo,
} = require('../src/license-product-v2');

const code = generateLicenseKey(PRODUCT_LITE);
const phone = '5538999987654';
const nowMs = Date.parse('2026-11-18T19:00:00.000Z');
const server = fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const fresh = (overrides={})=>({
  active:true,extensionProductId:PRODUCT_LITE,provisioningStatus:'issued',
  planId:'LITE_DEV',maxUses:3,phones:[],expiresAt:null,...overrides,
});

test('persistent reader uses exact key projection; malformed and absent codes cannot read',async()=>{
  let queries=0;
  const db={collection(name){
    assert.equal(name,'store');
    return {findOne:async(query,options)=>{
      queries++;
      assert.deepEqual(query,{_id:'keys'});
      assert.deepEqual(options.projection,{['data.'+code]:1,_id:0});
      assert.equal(options.timeoutMS,7000);
      return {data:{[code]:fresh()}};
    }};
  }};
  assert.equal(await readLiteLicenseSnapshot(db,code+'extra'),null);
  assert.equal(queries,0);
  const doc=await readLiteLicenseSnapshot(db,code);
  assert.equal(doc.extensionProductId,PRODUCT_LITE);
  assert.equal(queries,1);
  await assert.rejects(readLiteLicenseSnapshot(null,code),/lite_license_database_required/);
});

test('LITE freshness fails closed on product mismatch, expiry, disabled or unprovisioned keys',()=>{
  assert.equal(liteKeyUsable(fresh(),code,nowMs),true);
  for(const k of [
    fresh({active:false}),
    fresh({extensionProductId:PRODUCT_AUTOMACOES}),
    fresh({planId:'ZV_PRO'}),
    fresh({provisioningStatus:'awaiting_lite_build_authority'}),
    fresh({maxUses:'3'}),
    fresh({phones:null}),
    fresh({expiresAt:'2026-11-18T18:59:00.000Z'}),
    fresh({expiresAt:'invalid'}),
  ]) assert.equal(liteKeyUsable(k,code,nowMs),false);
  assert.equal(keyBelongsTo(fresh(),code,PRODUCT_AUTOMACOES),false);
});

function dbFixture(doc, opts={}){
  let writes=0, reads=0, filterSeen=null;
  const cloned =()=> doc ? {...doc,phones:Array.isArray(doc.phones)?[...doc.phones]:doc.phones}:null;
  const db={collection(name){
    assert.equal(name,'store');
    return {
      async findOne(){
        reads++;
        return {data:{[code]:cloned()}};
      },
      async updateOne(filter,update,options){
        writes++;
        filterSeen=filter;
        assert.equal(options.upsert,false);
        assert.equal(filter._id,'keys');
        assert.equal(filter['data.'+code+'.extensionProductId'],PRODUCT_LITE);
        assert.equal(filter['data.'+code+'.active'],true);
        assert.equal(filter['data.'+code+'.provisioningStatus'],'issued');
        assert.equal(filter['data.'+code+'.planId'],'LITE_DEV');
        assert.equal(filter['data.'+code+'.maxUses'],3);
        assert.equal(filter['data.'+code+'.phones.2'].$exists,false);
        assert.equal(filter['data.'+code+'.phones.99'].$exists,false);
        assert.equal(filter['data.'+code+'.phones'].$ne,phone);
        assert.equal(update.$push['data.'+code+'.phones'],phone);
        if(opts.revokeDuringWrite)doc.active=false;
        if(opts.mutateLimitDuringWrite)doc.maxUses=1;
        if(!doc.active || doc.maxUses!==filter['data.'+code+'.maxUses']){
          return {modifiedCount:0};
        }
        doc.phones.push(phone);
        return {modifiedCount:1};
      }
    };
  }};
  return {db,get metrics(){return{writes,reads,filterSeen}}};
}

test('new LITE phone slot is conditionally persisted and reread',async()=>{
  const q=dbFixture(fresh());
  const result=await claimLitePhoneSlotAtomic(q.db,code,phone,{maxPhonesGlobal:100,nowMs});
  assert.equal(result.status,'claimed');
  assert.deepEqual(result.record.phones,[phone]);
  assert.equal(q.metrics.writes,1);
  assert.equal(q.metrics.reads,2);
});

test('a concurrent LITE revocation prevents an unauthorized phone claim',async()=>{
  const q=dbFixture(fresh(),{revokeDuringWrite:true});
  const result=await claimLitePhoneSlotAtomic(q.db,code,phone,{maxPhonesGlobal:100,nowMs});
  assert.equal(result.status,'entitlement_revoked');
  assert.equal(q.metrics.writes,1);
});

test('a changed maxUses prevents a stale limit from being applied',async()=>{
  const q=dbFixture(fresh(),{mutateLimitDuringWrite:true});
  const result=await claimLitePhoneSlotAtomic(q.db,code,phone,{maxPhonesGlobal:100,nowMs});
  assert.equal(result.status,'limit_reached');
});

test('no database write is attempted for a disabled, invalid, duplicate or exhausted LITE key',async()=>{
  for(const [record,expected] of [
    [fresh({active:false}),'entitlement_revoked'],
    [fresh({extensionProductId:PRODUCT_AUTOMACOES}),'entitlement_revoked'],
    [fresh({phones:[phone]}),'already_member'],
    [fresh({phones:['5538999999999','5538999999998','5538999999997']}),'limit_reached'],
  ]){
    const q=dbFixture(record);
    const result=await claimLitePhoneSlotAtomic(q.db,code,phone,{maxPhonesGlobal:100,nowMs});
    assert.equal(result.status,expected);
    assert.equal(q.metrics.writes,0);
  }
});

test('LITE admission refuses cache-only key even if the old memory says active',async()=>{
  const source=server.match(/async function authorizeExtensionKeySession\([\s\S]*?(?=\nasync function refreshExtensionSession)/)?.[0];
  assert.ok(source);
  let claims=0;
  const cache={ [code]:fresh() };
  const ctx={
    PRODUCT_LITE,PRODUCT_AUTOMACOES,keys:cache,keyBelongsTo,
    sanitizeId:(v,n)=>String(v||'').toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,n),
    normalizePhone:v=>String(v||'').replace(/\D/g,''),
    safeScalar:(v,n)=>String(v||'').slice(0,n),
    isFreeAuthKey:()=>false,
    extensionAuthFailure:(errorCode,status,extra={})=>({ok:false,errorCode,status,...extra}),
    extensionLicenseIsUsable:r=>Boolean(r?.active),
    MAX_USES:3,MAX_PHONES_GLOBAL:100,
    extensionNow:()=>new Date(nowMs),
    extensionSubject:(kind,id)=>({kind,id}),
    buildExtensionEntitlement:()=>({entitlementRevision:'test'}),
    extensionDevAccessAllowed:()=>false,
  };
  const fn=vm.runInNewContext('('+source+')',ctx);
  const deps={expectedProductId:PRODUCT_LITE,keyStore:cache,db:{},
    readLiteLicenseSnapshot:async()=>null,
    claimLitePhoneSlot:async()=>{claims++;return{status:'claimed'}}};
  const result=await fn({authKey:code,phoneNumber:phone,deviceId:'test-device'},deps);
  assert.equal(result.ok,false);
  assert.equal(result.errorCode,'invalid_key');
  assert.equal(claims,0);
  assert.equal(cache[code].active,true);
});

test('LITE database outage does not fall back to cached authorizations',async()=>{
  const source=server.match(/async function authorizeExtensionKeySession\([\s\S]*?(?=\nasync function refreshExtensionSession)/)?.[0];
  const cache={ [code]:fresh() };
  const ctx={
    PRODUCT_LITE,PRODUCT_AUTOMACOES,keys:cache,keyBelongsTo,
    sanitizeId:(v,n)=>String(v||'').toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,n),
    normalizePhone:v=>String(v||'').replace(/\D/g,''),
    safeScalar:(v,n)=>String(v||'').slice(0,n),
    isFreeAuthKey:()=>false,
    extensionAuthFailure:(errorCode,status,extra={})=>({ok:false,errorCode,status,...extra}),
  };
  const fn=vm.runInNewContext('('+source+')',ctx);
  const result=await fn({authKey:code,phoneNumber:phone,deviceId:'test-device'},{
    expectedProductId:PRODUCT_LITE,keyStore:cache,db:{},
    readLiteLicenseSnapshot:async()=>{throw new Error('Mongo unavailable');},
  });
  assert.equal(result.errorCode,'temporarily_unavailable');
  assert.equal(result.status,503);
  assert.equal(result.retryable,true);
});
