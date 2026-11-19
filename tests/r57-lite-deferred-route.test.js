'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {PRODUCT_LITE,PRODUCT_AUTOMACOES,generateLicenseKey,keyBelongsTo}=require('../src/license-product-v2');
const {liteKeyUsable}=require('../src/lite-license-authority');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const source=server.match(/async function authorizeExtensionKeySession\([\s\S]*?(?=\nasync function refreshExtensionSession)/)?.[0];
assert.ok(source,'must test the actual V4 login implementation');
const code=generateLicenseKey(PRODUCT_LITE);
const phone='5538999988776';
function harness(){
  const current={
    extensionProductId:PRODUCT_LITE,active:true,provisioningStatus:'issued',
    planId:'LITE_DEV',maxUses:3,phones:[phone],
    expireDuration:3600_000,expiresAt:null,
  };
  const activated={...current,expiresAt:new Date(Date.now()+3600_000).toISOString()};
  const calls={lite:0,legacy:0};
  const cache={};
  const ctx={
    keys:cache,PRODUCT_LITE,PRODUCT_AUTOMACOES,keyBelongsTo,liteKeyUsable,
    sanitizeId:(v,n)=>String(v||'').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,n),
    normalizePhone:v=>String(v||'').replace(/\D/g,''),
    safeScalar:(v,n)=>String(v||'').slice(0,n),
    isFreeAuthKey:()=>false,
    extensionAuthFailure:(errorCode,status,extra={})=>({ok:false,errorCode,status,...extra}),
    extensionLicenseIsUsable:rec=>Boolean(rec?.active),
    MAX_USES:3,MAX_PHONES_GLOBAL:100,
    extensionNow:()=>new Date(),
    extensionSubject:(type,id,productId)=>({type,id,productId}),
    buildExtensionEntitlement:({keyRecord})=>({licenseExpiresAt:keyRecord.expiresAt,entitlementRevision:'r57'}),
    extensionDevAccessAllowed:()=>false,
    activateDeferredKey:async()=>{calls.legacy++;throw new Error('LEGACY_HELPER_MUST_NOT_RUN');},
  };
  const authorize=vm.runInNewContext('('+source+')',ctx);
  const deps={
    expectedProductId:PRODUCT_LITE,db:{},keyStore:cache,
    readLiteLicenseSnapshot:async()=>current,
    claimLitePhoneSlot:async()=>({status:'already_member',record:current}),
    activateLiteDeferredKey:async()=>{calls.lite++;return{status:'activated',record:activated};},
  };
  const input={authKey:code,phoneNumber:phone,deviceId:'r57-device'};
  return {authorize,ctx,cache,calls,activated,deps,input};
}
test('LITE V4 login uses only the isolated Mongo-conditional first-use activation',async()=>{
  const h=harness();
  const result=await h.authorize(h.input,h.deps);
  assert.equal(result.ok,true);
  assert.equal(result.entitlement.licenseExpiresAt,h.activated.expiresAt);
  assert.equal(result.entitlement.entitlementRevision,'r57');
  assert.equal(h.cache[code],undefined,'LITE may not leak into the legacy full-product cache');
  assert.equal(h.calls.lite,1);
  assert.equal(h.calls.legacy,0);
  assert.equal(result.subject.productId,PRODUCT_LITE);
});
test('revoked deferred LITE keys cannot be admitted after first-use claim',async()=>{
  const h=harness();
  h.deps.activateLiteDeferredKey=async()=>{h.calls.lite++;return {status:'entitlement_revoked'};};
  const result=await h.authorize(h.input,h.deps);
  assert.equal(result.ok,false);
  assert.equal(result.errorCode,'entitlement_revoked');
  assert.equal(result.status,403);
  assert.equal(h.calls.lite,1);
  assert.equal(h.calls.legacy,0);
});
test('database failures in deferred LITE activation remain retryable, never fallback to full edition',async()=>{
  const h=harness();
  h.deps.activateLiteDeferredKey=async()=>{throw new Error('Mongo unavailable');};
  const result=await h.authorize(h.input,h.deps);
  assert.equal(result.ok,false);
  assert.equal(result.errorCode,'temporarily_unavailable');
  assert.equal(result.status,503);
  assert.equal(result.retryable,true);
  assert.equal(h.calls.legacy,0);
});
