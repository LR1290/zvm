'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {readLiteConfig,inspectLiteClient,liteOriginAllowed,liteSessionAllowed}=require('../src/lite-v4-build-authority');
const {PRODUCT_LITE,PRODUCT_AUTOMACOES,generateLicenseKey,keyBelongsTo}=require('../src/license-product-v2');
const fullId='bdhnikgcdccjabkmbfcakgjkkgdlmgja',liteId='a'.repeat(32);
const buildId='zvm-lite-dev-fixtureR52';
const digest='b'.repeat(64);
const time=Date.parse('2026-11-18T15:00:00.000Z');
const pair=crypto.generateKeyPairSync('ed25519');
const second=crypto.generateKeyPairSync('ed25519');
const cfgEnv={
  ZVM_LITE_V4_ENABLED:'1',ZVM_LITE_DEV_EXTENSION_ID:liteId,
  ZVM_LITE_DEV_KEY_ID:'lite-fixture',ZVM_LITE_DEV_BUILD_ID:buildId,
  ZVM_LITE_DEV_BUILD_SHA256:digest,ZVM_LITE_DEV_VERSION:'0.1.40',
  ZVM_LITE_DEV_PUBLIC_KEY_SPKI_B64:pair.publicKey.export({format:'der',type:'spki'}).toString('base64'),
  ZVM_DEV_EXTENSION_ID:fullId,ZVM_DEV_SIGNING_KEY_ID:'full-key',
};
const cfg=readLiteConfig(cfgEnv,new Set([fullId]));
const origin='chrome-extension://'+liteId;
const payload={
  schema:'zvm-lite-build-v1',audience:'zvm-lite-v4-server',productId:'zvm_lite',
  channel:'dev',extensionId:liteId,buildId,sha256:digest,keyId:'lite-fixture',
  issuedAt:'2026-11-18T14:00:00.000Z',expiresAt:'2026-11-19T14:00:00.000Z',
};
const FIELDS=['schema','audience','productId','channel','extensionId','buildId','sha256','keyId','issuedAt','expiresAt'];
function sign(p=payload,privateKey=pair.privateKey){
  const canonical=Buffer.from(JSON.stringify(Object.fromEntries(FIELDS.map(k=>[k,p[k]]))),'utf8');
  return {payload:p,signatureBase64:crypto.sign(null,canonical,privateKey).toString('base64')};
}
const client={
  protocol:2,extensionVersion:'0.1.40',extensionId:liteId,buildId,channel:'dev',profile:'dev',
  buildFingerprint:digest,installationId:'11111111-1111-4111-8111-111111111111',
  requestId:'lite-r52-request-abcdef',sentAtMs:time
};
test('LITE DEV signer is disabled unless fully configured and independent',()=>{
  assert.equal(cfg.ready,true);
  // Real source build IDs embed dotted semantic versions, unlike early R52 fixtures.
  const canonicalVersionBuild='zvm-lite-dev-0.1.41-s'+ '1'.repeat(12);
  assert.equal(readLiteConfig({...cfgEnv,ZVM_LITE_DEV_BUILD_ID:canonicalVersionBuild,ZVM_LITE_DEV_VERSION:'0.1.41'},new Set([fullId])).ready,true);
  assert.equal(readLiteConfig({},new Set()).ready,false);
  for(const change of [
    {ZVM_LITE_DEV_EXTENSION_ID:fullId},{ZVM_LITE_DEV_KEY_ID:'full-key'},
    {ZVM_LITE_DEV_PUBLIC_KEY_SPKI_B64:'invalid'},
    {ZVM_LITE_DEV_BUILD_SHA256:'a'},
    {ZVM_LITE_DEV_VERSION:'not-a-version'},
    {ZVM_LITE_DEV_PUBLIC_KEY_SPKI_B64:crypto.generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({format:'der',type:'spki'}).toString('base64')},
  ]){
    const denied=readLiteConfig({...cfgEnv,...change},new Set([fullId]));
    assert.equal(denied.ready,false);
  }
  assert.equal(liteOriginAllowed(origin,cfg),true);
  assert.equal(liteOriginAllowed('chrome-extension://'+fullId,cfg),false);
  assert.equal(liteOriginAllowed('https://web.whatsapp.com',cfg),false);
});
test('real Ed25519 signed DEV descriptor and matching extension request accepted',()=>{
  const admitted=inspectLiteClient(cfg,client,sign(),origin,time);
  assert.equal(admitted.ok,true);
  assert.equal(admitted.extensionId,liteId);
  assert.equal(admitted.buildFingerprint,digest);
  assert.equal(admitted.signerKeyId,'lite-fixture');
  assert.equal(admitted.signedExpiresAt,payload.expiresAt);
  assert.equal(Object.hasOwn(admitted,'entitlement'),false);
  assert.equal(Object.hasOwn(admitted,'liteProductVerified'),false);
});
test('product, signer and audience mismatch fail closed',()=>{
  const tamper=[
    {payload:{...payload,productId:'zvm_automacoes'}},
    {payload:{...payload,audience:'zvm-production'}},
    {payload:{...payload,sha256:'c'.repeat(64)}},
    {payload:{...payload,keyId:'full-key'}},
    {payload:{...payload,extensionId:fullId}},
    {payload:{...payload,buildId:'zvm-lite-dev-evil'}},
    {payload:{...payload, extra:true}},
  ];
  for(const change of tamper) assert.equal(inspectLiteClient(cfg,client,sign(change.payload),origin,time).ok,false);
  assert.equal(inspectLiteClient(cfg,client,sign(payload,second.privateKey),origin,time).ok,false);
  assert.equal(inspectLiteClient(cfg,{...client,extensionId:fullId},sign(),origin,time).ok,false);
  assert.equal(inspectLiteClient(cfg,{...client,buildFingerprint:'c'.repeat(64)},sign(),origin,time).ok,false);
  assert.equal(inspectLiteClient(cfg,{...client,protocol:1},sign(),origin,time).ok,false);
  assert.equal(inspectLiteClient(cfg,{...client,sentAtMs:time-600_000},sign(),origin,time).ok,false);
  assert.equal(inspectLiteClient(cfg,client,sign(), 'chrome-extension://'+fullId,time).ok,false);
  assert.equal(inspectLiteClient(cfg,client,sign(),origin,Date.parse('2026-11-20T15:00:00.000Z')).ok,false);
  assert.equal(inspectLiteClient(cfg,client,{...sign(),publicKeyPem:'fake'},origin,time).ok,false);
});
test('LITE sessions expire on signer rotation, version change or expiry',()=>{
  const session={
    extensionProductId:PRODUCT_LITE,securityProtocol:2,
    channel:'dev',profile:'dev',extensionId:liteId,extensionVersion:'0.1.40',
    buildId,buildFingerprint:digest,liteSignerKeyId:'lite-fixture',
    liteSignedExpiresAt:payload.expiresAt
  };
  assert.equal(liteSessionAllowed(cfg,session,time),true);
  assert.equal(liteSessionAllowed(cfg,{...session,extensionProductId:PRODUCT_AUTOMACOES},time),false);
  assert.equal(liteSessionAllowed(cfg,{...session,liteSignerKeyId:'full-key'},time),false);
  assert.equal(liteSessionAllowed(cfg,{...session,extensionId:fullId},time),false);
  assert.equal(liteSessionAllowed(cfg,{...session,buildFingerprint:'c'.repeat(64)},time),false);
  assert.equal(liteSessionAllowed(cfg,session,Date.parse('2026-11-20T15:00:00.000Z')),false);
});
test('live V4 auth source only allocates phone slots for the expected product',async()=>{
  const text=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  const snippet=text.match(/async function authorizeExtensionKeySession[\s\S]*?(?=\nasync function refreshExtensionSession)/)?.[0];
  assert.ok(snippet);
  let claimed=0;
  const context={
    PRODUCT_LITE,PRODUCT_AUTOMACOES,
    sanitizeId:(x,n)=>String(x||'').toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,n),
    normalizePhone:x=>String(x||'').replace(/\D/g,''),
    safeScalar:(x,n)=>String(x||'').slice(0,n),
    isFreeAuthKey:()=>false,
    extensionAuthFailure:(errorCode,status)=>({ok:false,errorCode,status}),
    extensionLicenseIsUsable:()=>true,keyBelongsTo,MAX_USES:3,MAX_PHONES_GLOBAL:100,
    keys:{},extensionNow:()=>new Date(time),extensionSubject:(type,id)=>({type,id}),
    buildExtensionEntitlement:({productId})=>({productId,entitlementRevision:'r52'}),
    extensionDevAccessAllowed:()=>false,
  };
  const authorize=vm.runInNewContext('('+snippet+')',context);
  const liteKey=generateLicenseKey(PRODUCT_LITE);
  const fullKey=generateLicenseKey(PRODUCT_AUTOMACOES);
  const auth={authKey:liteKey,phoneNumber:'5538999999999',deviceId:'r52-device'};
  const common={
    expectedProductId:PRODUCT_LITE,ensureKeyLoadedEx:async()=>({found:true,dbError:false}),
    db:{},
    claimPhoneSlot:async()=>{claimed++;return{status:'claimed'};},
    claimLitePhoneSlot:async()=>{claimed++;return{status:'claimed'};},
  };
  const full=await authorize({...auth,authKey:fullKey},{...common,keyStore:{[fullKey]:{active:true,extensionProductId:PRODUCT_AUTOMACOES,phones:[]}},readLiteLicenseSnapshot:async()=>({active:true,extensionProductId:PRODUCT_AUTOMACOES,phones:[]})});
  assert.equal(full.ok,false);assert.equal(full.errorCode,'license_product_mismatch');assert.equal(claimed,0);
  const pending=await authorize(auth,{...common,keyStore:{[liteKey]:{active:true,extensionProductId:PRODUCT_LITE,phones:[],planId:'LITE_DEV',provisioningStatus:'awaiting_lite_build_authority'}},readLiteLicenseSnapshot:async()=>({active:true,extensionProductId:PRODUCT_LITE,phones:[],planId:'LITE_DEV',provisioningStatus:'awaiting_lite_build_authority'})});
  assert.equal(pending.ok,false);assert.equal(pending.errorCode,'lite_license_not_provisioned');assert.equal(claimed,0);
  const ready=await authorize(auth,{...common,keyStore:{[liteKey]:{active:true,extensionProductId:PRODUCT_LITE,phones:[],planId:'LITE_DEV',provisioningStatus:'issued'}},readLiteLicenseSnapshot:async()=>({active:true,extensionProductId:PRODUCT_LITE,phones:[],planId:'LITE_DEV',provisioningStatus:'issued'})});
  assert.equal(ready.ok,true);assert.equal(ready.entitlement.productId,PRODUCT_LITE);assert.equal(claimed,1);
});
test('LITE V4 admission and shared replay are before license/phone mutation',()=>{
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  const section=server.split("if ((p === R_EXT+'/lite/v4/session/key'")[1]?.split("if (p === R_EXT+'/v4/session/key'")[0];
  assert.ok(section);
  const signed=section.indexOf('inspectLiteClient(');
  const replay=section.indexOf('zvmSecurityConsumeRequestIdSharedImpl(');
  const auth=section.indexOf('authorizeExtensionKeySession(');
  assert.ok(signed>=0 && replay>signed && auth>replay);
  assert.match(section,/expectedProductId:PRODUCT_LITE/);
  assert.match(section,/signedDev:false/);
  assert.match(section,/liteSignerKeyId:checked.signerKeyId/);
  assert.match(section,/liteSignedExpiresAt:checked.signedExpiresAt/);
  assert.match(server,/expectedProductId = deps.expectedProductId \|\| PRODUCT_AUTOMACOES/);
  assert.match(server,/liteSessionAllowed\(ZVM_LITE_V4_CONFIG, doc, now.getTime\(\)\)/);
  assert.match(server,/storedProductId !== expectedProductId/);
  assert.match(server,/isAllowedExtensionOrigin\(o, p\)/);
  assert.match(server,/productId: entitlement.productId \|\| PRODUCT_AUTOMACOES/);
});
test('LITE capabilities are isolated from CRM/AI and backup owner domain',()=>{
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  const liteCaps=server.match(/const EXTENSION_LITE_CAPABILITIES = Object.freeze\(\[([\s\S]*?)\]\);/)?.[1]||'';
  for(const cap of ['flows.manage','funnels.manage','disparos.execute','followup.manage','quickReply.send','items.schedule','export.contacts'])assert.ok(liteCaps.includes(cap));
  for(const denied of ['crm.use','ai.agents','integrations.manage','laboratory.realSend'])assert.ok(!liteCaps.includes(denied));
  assert.match(server,/ext:backup-owner:lite:v1:/);
  assert.match(server,/isLite \? null : crypto.createHash/);
  assert.match(server,/LITE_DEV/);
});
