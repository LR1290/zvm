'use strict';
// R80: all V4 entry points must agree on the *persisted* LITE license contract.
// This test extracts real server functions but uses isolated, in-memory fixtures.
// No production DB, credentials, browser session, WhatsApp, or network access.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {PRODUCT_AUTOMACOES,PRODUCT_LITE,generateLicenseKey,keyBelongsTo}=require('../src/license-product-v2');
const {liteKeyUsable}=require('../src/lite-license-authority');
const {linkedPortalKeyForProduct}=require('../src/portal-license-slots');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const cut=(start,end)=>{
  const a=server.indexOf(start), b=server.indexOf(end,a+start.length);
  assert(a>=0&&b>a,'real server function range: '+start);
  return server.slice(a,b);
};
const buildSource=cut('function buildExtensionEntitlement(','\nasync function ensureExtensionSessionIndexes(');
const accountSource=cut('async function resolveExtensionAccountEntitlement(','\nasync function authenticateExtensionAccount(');
const keySource=cut('async function authorizeExtensionKeySession(','\nasync function refreshExtensionSession(');
const refreshSource=cut('async function refreshExtensionSession(','\n// Reset tokens atuais');
const lite=generateLicenseKey(PRODUCT_LITE),full=generateLicenseKey(PRODUCT_AUTOMACOES);
const phone='5538999123456',now=new Date('2026-11-19T12:00:00.000Z');
const good=(overrides={})=>({
  extensionProductId:PRODUCT_LITE,active:true,provisioningStatus:'issued',
  planId:'LITE_DEV',maxUses:2,phones:[phone],expiresAt:null,
  ...overrides
});
const fail=(errorCode,status,extra={})=>({ok:false,errorCode,status,...extra});
const usable=(r)=>r?.active===true&&(!r.expiresAt||Date.parse(r.expiresAt)>now.getTime());
test('entitlement computation never makes malformed LITE licensing paid',()=>{
  const ctx={
    PRODUCT_LITE,PRODUCT_AUTOMACOES,keyBelongsTo,liteKeyUsable,
    extensionLicenseIsUsable:usable,crypto,
    EXTENSION_LITE_CAPABILITIES:['lite_read'],EXTENSION_LICENSED_CAPABILITIES:['full_read'],
    EXTENSION_FREE_CAPABILITIES:['free_read'],EXTENSION_ENTITLEMENT_LEASE_MS:3600000,
    ZVM_PAYMENT_PLANS:{},FREE_PLAN_ID:'FREE',DEFAULT_MODULES:{}
  };
  const run=vm.runInNewContext('('+buildSource+')',ctx);
  const valid=run({keyCode:lite,keyRecord:good(),productId:PRODUCT_LITE,now});
  assert.equal(valid.tier,'paid');
  assert.equal(valid.capabilities[0],'lite_read');
  for(const bad of [good({maxUses:0}),good({maxUses:-2}),good({maxUses:'2'}),good({phones:null})]){
    const denied=run({keyCode:lite,keyRecord:bad,productId:PRODUCT_LITE,now});
    assert.equal(denied.tier,'free');
    assert.equal(denied.capabilities.length,0);
    assert.equal(denied.accessLimit,null);
  }
  const fullPaid=run({keyCode:full,keyRecord:{extensionProductId:PRODUCT_AUTOMACOES,active:true,planId:'ZV_PRO',phones:[],maxUses:3},productId:PRODUCT_AUTOMACOES,now});
  assert.equal(fullPaid.tier,'paid','full edition must retain its historical contract');
});
test('password-linked LITE entitlement rejects bad persisted seats and preserves valid linking',async()=>{
  const ctx={
    PRODUCT_LITE,PRODUCT_AUTOMACOES,keys:{},keyBelongsTo,liteKeyUsable,
    linkedPortalKeyForProduct,extensionNow:()=>now,extensionAuthFailure:fail,
    extensionLicenseIsUsable:usable,extensionDevAccessAllowed:()=>false,
    buildExtensionEntitlement:({productId,keyCode})=>({productId,keyCode,tier:'paid'})
  };
  const run=vm.runInNewContext('('+accountSource+')',ctx);
  const user={liteKeyCode:lite};
  for(const bad of [good({maxUses:0}),good({maxUses:-2}),good({maxUses:1.2}),good({phones:null})]){
    let reads=0;
    const res=await run(user,{expectedProductId:PRODUCT_LITE,db:{},readLiteLicenseSnapshot:async()=>{reads++;return bad}});
    assert.equal(res.ok,false);
    assert.equal(res.errorCode,'lite_license_required');
    assert.equal(reads,1,'must verify Mongo, never use cached full-product keys');
  }
  const valid=await run(user,{expectedProductId:PRODUCT_LITE,db:{},readLiteLicenseSnapshot:async()=>good()});
  assert.equal(valid.ok,true);
  assert.equal(valid.keyCode,lite);
  assert.equal(valid.entitlement.productId,PRODUCT_LITE);
});
test('direct LITE key login denies invalid seats before claiming any phone slot',async()=>{
  let claims=0;
  const ctx={
    PRODUCT_LITE,PRODUCT_AUTOMACOES,keys:{},keyBelongsTo,liteKeyUsable,
    sanitizeId:(v,n)=>String(v||'').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,n),
    normalizePhone:v=>String(v||'').replace(/\D/g,''),
    safeScalar:(v,n)=>String(v||'').slice(0,n),isFreeAuthKey:()=>false,
    extensionAuthFailure:fail,extensionLicenseIsUsable:usable,MAX_USES:3,
    MAX_PHONES_GLOBAL:50,extensionNow:()=>now,
    extensionSubject:()=>({}),buildExtensionEntitlement:()=>({tier:'paid'}),
    extensionDevAccessAllowed:()=>false
  };
  const run=vm.runInNewContext('('+keySource+')',ctx);
  const invalid=good({maxUses:0,phones:[]});
  const res=await run({authKey:lite,phoneNumber:phone,deviceId:'r80-test'},{
    expectedProductId:PRODUCT_LITE,db:{},
    readLiteLicenseSnapshot:async()=>invalid,
    claimLitePhoneSlot:async()=>{claims++;return{status:'claimed',record:invalid}}
  });
  assert.equal(res.ok,false);
  assert.equal(res.errorCode,'entitlement_revoked');
  assert.equal(claims,0);
  assert.equal(invalid.phones.length,0);
});
test('both LITE session refresh methods revoke corrupt persisted licensing',async()=>{
  const install='11111111-1111-4111-8111-111111111111';
  const buildId='zvm-lite-dev-0.1.80-sabcdefabcdef',hash='b'.repeat(64),id='a'.repeat(32);
  const proof={securityProtocol:2,extensionId:id,extensionVersion:'0.1.80',
    buildId,buildFingerprint:hash,signerKeyId:'r80-test',
    installationId:install};
  const baseDoc={
    _id:'hashed-token',licenseKeyCode:lite,extensionProductId:PRODUCT_LITE,
    accountEmail:'example@test.invalid',phoneNumber:phone,revokedAt:null,
    extensionId:id,extensionVersion:proof.extensionVersion,buildId,
    buildFingerprint:hash,liteSignerKeyId:proof.signerKeyId,
    installationIdHash:crypto.createHash('sha256').update(install).digest('hex'),
    securityProtocol:2,channel:'dev',profile:'dev'
  };
  for(const authMethod of ['license_key','password']){
    let revocations=0,dbWrites=0;
    const doc={...baseDoc,authMethod};
    const db={collection(name){
      if(name==='portal_users')return{findOne:async()=>({_id:'example@test.invalid',liteKeyCode:lite})};
      if(name==='extension_sessions')return{updateOne:async()=>{dbWrites++;return{modifiedCount:1}}};
      throw Error('unexpected collection '+name);
    }};
    const ctx={
      PRODUCT_LITE,PRODUCT_AUTOMACOES,crypto,keyBelongsTo,liteKeyUsable,
      extensionNow:()=>now,readExtensionSession:async()=>({ok:true,doc}),
      extensionAuthFailure:fail,getMongoDb:async()=>db,
      ZVM_LITE_V4_CONFIG:{ready:true},liteSessionAllowed:()=>true,
      revokeExtensionSession:async()=>{revocations++;return{ok:true}},
      normalizePhone:v=>String(v||'').replace(/\D/g,''),
      extensionLicenseIsUsable:usable,
      linkedPortalKeyForProduct,
      extensionDevAccessAllowed:()=>false,
      buildExtensionEntitlement:()=>({tier:'paid'}),
      keys:{},readLiteLicenseSnapshot:async()=>good({maxUses:0})
    };
    const resolve=vm.runInNewContext('('+accountSource+')',ctx);
    ctx.resolveExtensionAccountEntitlement=resolve;
    const run=vm.runInNewContext('('+refreshSource+')',ctx);
    const res=await run('a'.repeat(64),{db,expectedProductId:PRODUCT_LITE,
      liteClientSecurity:proof,readLiteLicenseSnapshot:async()=>good({maxUses:0})});
    assert.equal(res.ok,false);
    assert.equal(res.status,403);
    assert.equal(res.errorCode,authMethod==='password'?'lite_license_required':'entitlement_revoked');
    assert.equal(revocations,1,'invalid LITE session must be revoked: '+authMethod);
    assert.equal(dbWrites,0,'no session should be renewed on malformed limits');
  }
});

test('LITE refresh CAS rejects a token revoked by another concurrent request',async()=>{
  const installation='22222222-2222-4222-8222-222222222222';
  const buildId='zvm-lite-dev-0.1.80-sabcdefabcdef';
  const id='c'.repeat(32),fingerprint='d'.repeat(64);
  const proof={securityProtocol:2,extensionId:id,extensionVersion:'0.1.80',
    buildId,buildFingerprint:fingerprint,signerKeyId:'lite-r80-fixture',
    installationId:installation};
  for(const authMethod of ['password','license_key']){
    for(const matchedCount of [0,1]){
      let updates=0;
      const doc={
        _id:'synthetic-sha',licenseKeyCode:lite,
        extensionProductId:PRODUCT_LITE,authMethod,
        accountEmail:'fake@example.invalid',phoneNumber:phone,revokedAt:null,
        extensionId:id,extensionVersion:'0.1.80',buildId,
        buildFingerprint:fingerprint,liteSignerKeyId:'lite-r80-fixture',
        installationIdHash:crypto.createHash('sha256').update(installation).digest('hex'),
        securityProtocol:2,channel:'dev',profile:'dev'
      };
      const db={collection(name){
        if(name==='portal_users')return{findOne:async()=>({_id:'fake@example.invalid',liteKeyCode:lite})};
        if(name==='extension_sessions')return{
          updateOne:async()=>{updates++;return{acknowledged:true,matchedCount,modifiedCount:matchedCount}}
        };
        throw Error('unexpected collection: '+name);
      }};
      const ctx={
        PRODUCT_LITE,PRODUCT_AUTOMACOES,crypto,keys:{},
        keyBelongsTo,liteKeyUsable,linkedPortalKeyForProduct,
        extensionNow:()=>now,readExtensionSession:async()=>({ok:true,doc}),
        extensionAuthFailure:fail,getMongoDb:async()=>db,
        ZVM_LITE_V4_CONFIG:{ready:true},liteSessionAllowed:()=>true,
        revokeExtensionSession:async()=>({ok:true}),
        normalizePhone:v=>String(v||'').replace(/\D/g,''),
        extensionLicenseIsUsable:usable,
        extensionDevAccessAllowed:()=>false,
        buildExtensionEntitlement:()=>({tier:'paid',entitlementRevision:'r80-cas'}),
        readLiteLicenseSnapshot:async()=>good()
      };
      ctx.resolveExtensionAccountEntitlement=vm.runInNewContext('('+accountSource+')',ctx);
      const run=vm.runInNewContext('('+refreshSource+')',ctx);
      const result=await run('a'.repeat(64),{db,expectedProductId:PRODUCT_LITE,
        liteClientSecurity:proof,readLiteLicenseSnapshot:async()=>good()});
      assert.equal(updates,1);
      if(matchedCount===0){
        assert.equal(result.ok,false);
        assert.equal(result.errorCode,'session_revoked');
        assert.equal(result.status,403);
        assert.equal(result.entitlement,undefined);
      } else {
        assert.equal(result.ok,true);
        assert.equal(result.entitlement.tier,'paid');
      }
    }
  }
});
