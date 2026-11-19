'use strict';
// Staging-style V4 integration with REAL crypto and REAL isolated MongoDB.
// Route source is extracted unchanged from server.js; no production server,
// customer secrets, WhatsApp account or external network is involved.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {MongoClient} = require('mongodb');
const {PRODUCT_LITE,PRODUCT_AUTOMACOES,generateLicenseKey,keyBelongsTo} = require('../src/license-product-v2');
const {readLiteConfig,inspectLiteClient,liteOriginAllowed} = require('../src/lite-v4-build-authority');
const {readLiteLicenseSnapshot,claimLitePhoneSlotAtomic,liteKeyUsable} = require('../src/lite-license-authority');
const {linkedPortalKeyForProduct} = require('../src/portal-license-slots');
const uri = process.env.ZVM_LITE_TEST_MONGO_URI;
if(uri !== 'mongodb://127.0.0.1:27017/') throw new Error('R58_ONLY_LOCAL_EPHEMERAL_MONGO');
const text=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
function take(from,to){
  const start=text.indexOf(from),end=text.indexOf(to,start+from.length);
  assert.ok(start>=0 && end>start,'real server source region: '+from);
  return text.slice(start,end);
}
const route=take("  if ((p === R_EXT+'/lite/v4/session/key'","  if (p === R_EXT+'/v4/session/key'");
const authKey=take('async function authorizeExtensionKeySession(','async function refreshExtensionSession(');
const entitlement=take('async function resolveExtensionAccountEntitlement(','async function authenticateExtensionAccount(');
const account=take('async function authenticateExtensionAccount(','async function authorizeExtensionKeySession(');
const id='a'.repeat(32), fullId='b'.repeat(32),digest='c'.repeat(64);
const buildId='zvm-lite-dev-0.1.58-s'+ 'e'.repeat(12);
const pair=crypto.generateKeyPairSync('ed25519');
const pub=pair.publicKey.export({format:'der',type:'spki'}).toString('base64');
const key=generateLicenseKey(PRODUCT_LITE), fullKey=generateLicenseKey(PRODUCT_AUTOMACOES);
const env={ZVM_LITE_V4_ENABLED:'true', ZVM_LITE_DEV_EXTENSION_ID:id,
  ZVM_LITE_DEV_KEY_ID:'lite-r58-test', ZVM_LITE_DEV_BUILD_ID:buildId,
  ZVM_LITE_DEV_BUILD_SHA256:digest,ZVM_LITE_DEV_VERSION:'0.1.58',
  ZVM_LITE_DEV_PUBLIC_KEY_SPKI_B64:pub,ZVM_DEV_EXTENSION_ID:fullId,
  ZVM_DEV_SIGNING_KEY_ID:'full-issuer'};
const config=readLiteConfig(env,new Set([fullId]));
assert.equal(config.ready,true);
const origin='chrome-extension://'+id;
function buildProof(idReq,at=Date.now()){
  const payload={schema:'zvm-lite-build-v1',audience:'zvm-lite-v4-server',
    productId:'zvm_lite',channel:'dev',extensionId:id,buildId,
    sha256:digest,keyId:'lite-r58-test',
    issuedAt:new Date(at-60_000).toISOString(),expiresAt:new Date(at+24*60*60_000).toISOString()};
  const fields=['schema','audience','productId','channel','extensionId','buildId','sha256','keyId','issuedAt','expiresAt'];
  const signatureBase64=crypto.sign(null,Buffer.from(JSON.stringify(Object.fromEntries(fields.map(x=>[x,payload[x]]))), 'utf8'),pair.privateKey).toString('base64');
  return {clientSecurity:{
    protocol:2,channel:'dev',profile:'dev',extensionId:id,
    extensionVersion:'0.1.58',buildId,buildFingerprint:digest,
    installationId:'11111111-1111-4111-8111-111111111111',
    requestId:idReq,sentAtMs:at
  },signedBuild:{payload,signatureBase64}};
}
function fail(errorCode,status,extra={}){return {ok:false,errorCode,status,...extra};}
function sessionHash(value){return crypto.createHash('sha256').update(value).digest('hex');}
test('R58 real signed V4 route: issue, replay, product/origin denial, refresh, logout',{timeout:60_000},async t=>{
  const client=new MongoClient(uri,{serverSelectionTimeoutMS:5000});await client.connect();
  const db=client.db('zvm_lite_v4_ci_'+crypto.randomBytes(8).toString('hex'));
  t.after(async()=>{try{await db.dropDatabase();}finally{await client.close();}});
  await db.collection('store').insertOne({_id:'keys',data:{
    [key]:{active:true,extensionProductId:PRODUCT_LITE,provisioningStatus:'issued',planId:'LITE_DEV',planName:'ZVM LITE',
      maxUses:2,phones:[],expiresAt:null,expireDuration:null},
    [fullKey]:{active:true,extensionProductId:PRODUCT_AUTOMACOES,planId:'ZV_PRO',maxUses:2,phones:[]}
  }});
  await db.collection('portal_users').insertOne({_id:'lite@example.com',liteKeyCode:key,keyCode:fullKey,passwordHash:'synthetic'});
  const memory={};
  const base={
    keys:memory,PRODUCT_LITE,PRODUCT_AUTOMACOES,keyBelongsTo,linkedPortalKeyForProduct,
    getMongoDb:async()=>db,readLiteLicenseSnapshot,claimLitePhoneSlotAtomic,liteKeyUsable,
    sanitizeId:(v,n)=>String(v||'').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,n),
    normalizePhone:v=>String(v||'').replace(/\D/g,''),
    safeScalar:(v,n)=>String(v||'').slice(0,n),isFreeAuthKey:()=>false,
    extensionAuthFailure:fail,
    extensionLicenseIsUsable:rec=>rec?.active===true&&(!rec.expiresAt||Date.parse(rec.expiresAt)>Date.now()),
    extensionNow:()=>new Date(),
    MAX_USES:3,MAX_PHONES_GLOBAL:100,
    extensionSubject:(type,value,productId)=>({type,value,productId}),
    buildExtensionEntitlement:({keyCode,productId})=>({productId,licenseKeyCode:keyCode,entitlementRevision:'r58'}),
    extensionDevAccessAllowed:()=>false,
    verifyPortalPassword:async pass=>pass==='correct-test-password',
    portalTotpHasSecret:()=>false,
    maybeRehashPortalPassword:async()=>{},
    ZVM_EXTENSION_AUTH_DB_TIMEOUT_MS:3000,
  };
  const runtime=vm.createContext(base);
  vm.runInContext(entitlement+'\n'+account+'\n'+authKey+'\n',runtime);
  const messages={};
  let nonceCount=0,sessionCount=0;
  const services={
    ...runtime,R_EXT:'/extension',ZVM_LITE_V4_CONFIG:config,
    inspectLiteClient,liteOriginAllowed,checkRateLimit:()=>true,
    zvmSecurityConsumeRequestIdSharedImpl:async requestId=>{
      try {
        await db.collection('extension_security_replay').insertOne({_id:requestId,createdAt:new Date()});
        nonceCount++;
        return {ok:true};
      } catch(e) {if(e.code===11000)return{ok:false,code:'SECURITY_REPLAY_REJECTED'};throw e;}
    },
    parseBody:async req=>({...req.body}),
    getExtensionBearerToken:req=>/^Bearer ([a-f0-9]{64})$/.exec(String(req.headers.authorization||''))?.[1]||null,
    readExtensionSession:async raw=>{
      const doc=await db.collection('extension_sessions').findOne({_id:sessionHash(raw),revokedAt:null});
      return doc?{ok:true,doc}:{ok:false,errorCode:'invalid_session'};
    },
    revokeExtensionSession:async raw=>{
      const r=await db.collection('extension_sessions').updateOne({_id:sessionHash(raw),revokedAt:null},{$set:{revokedAt:new Date()}});
      return {revoked:r.modifiedCount===1};
    },
    extensionSessionSecurityFields:checked=>({securityProtocol:2,extensionId:checked.extensionId,
      extensionVersion:checked.extensionVersion,buildId:checked.buildId,
      buildFingerprint:checked.buildFingerprint,installationId:checked.installationId,
      channel:'dev',profile:'dev'}),
    createExtensionSession:async descriptor=>{
      const token=crypto.randomBytes(32).toString('hex');
      const doc={_id:sessionHash(token),sessionId:crypto.randomUUID(),
        extensionProductId:descriptor.extensionProductId,
        authMethod:descriptor.authMethod,accountEmail:descriptor.accountEmail,
        licenseKeyCode:descriptor.licenseKeyCode,
        revokedAt:null,createdAt:new Date(),...descriptor};
      await db.collection('extension_sessions').insertOne(doc);sessionCount++;
      return {token,doc};
    },
    extensionSessionSuccess:(token,doc,rights)=>({ok:true,session:{token,extensionProductId:doc.extensionProductId},entitlement:rights}),
    refreshExtensionSession:async(raw)=>{
      const doc=await db.collection('extension_sessions').findOne({_id:sessionHash(raw),revokedAt:null});
      if(!doc)return fail('invalid_session',401);
      const persisted=await readLiteLicenseSnapshot(db,doc.licenseKeyCode);
      if(!persisted?.active)return fail('entitlement_revoked',403);
      return {ok:true,sessionDoc:doc,entitlement:{productId:PRODUCT_LITE,entitlementRevision:'r58'}};
    },
    authenticateExtensionAccount:(...args)=>runtime.authenticateExtensionAccount(...args),
    authorizeExtensionKeySession:(...args)=>runtime.authorizeExtensionKeySession(...args),
    zvmInvalidateMongoOnNetworkError:()=>false,
    console:{error(){}},
    sendJson:(res,body,status=200)=>{res.reply={status,body};},
  };
  const run=new Function('req','res','ip','deps','with(deps){return (async()=>{'+route+'})()}');
  async function post(kind,idReq,extraBody={},extra={}) {
    const p='/extension/lite/v4/session/'+kind;
    const proof=buildProof(idReq);
    const req={method:'POST',headers:{origin:extra.origin||origin,
      authorization:extra.token?'Bearer '+extra.token:''},body:{
        ...proof,...extraBody,
      }};
    if(extra.invalidSignature)req.body.signedBuild.signatureBase64='A'.repeat(86)+'==';
    const res={setHeader(name,value){messages[name]=value;}};
    await run(req,res,'127.0.0.1',{...services,p});
    assert.ok(res.reply,p+' must reply');
    return res.reply;
  }
  const validBody={authKey:key,phoneNumber:'5538999991111',deviceId:'test-r58-device'};
  await t.test('forged origin and signer cannot issue',async()=>{
    assert.equal((await post('key','r58-bad-origin',validBody,{origin:'chrome-extension://'+fullId})).body.errorCode,'LITE_EXTENSION_ORIGIN_REQUIRED');
    assert.equal((await post('key','r58-bad-sig',validBody,{invalidSignature:true})).body.errorCode,'LITE_SIGNATURE_INVALID');
    assert.equal(sessionCount,0);
  });
  await t.test('full-edition key cannot be used for Lite',async()=>{
    const r=await post('key','r58-cross-product',{...validBody,authKey:fullKey});
    assert.equal(r.body.errorCode,'invalid_key');
    assert.equal(sessionCount,0);
  });
  await t.test('signed password login rejects invalid LITE seat ceiling before session creation',async()=>{
    await db.collection('store').updateOne({_id:'keys'},{$set:{['data.'+key+'.maxUses']:0}});
    try {
      const denied=await post('login','r58-corrupt-seat-count',{
        email:'lite@example.com',password:'correct-test-password'
      });
      assert.equal(denied.status,403);
      assert.equal(denied.body.errorCode,'lite_license_required');
      assert.equal(sessionCount,0);
      const persisted=await readLiteLicenseSnapshot(db,key);
      assert.deepEqual(persisted.phones,[]);
    } finally {
      await db.collection('store').updateOne({_id:'keys'},{$set:{['data.'+key+'.maxUses']:2}});
    }
  });
  let token;
  await t.test('valid signed Lite request issues persisted session and claims phone',async()=>{
    const r=await post('key','r58-key-issue',validBody);
    assert.equal(r.status,200);
    assert.equal(r.body.ok,true);
    assert.equal(r.body.entitlement.productId,PRODUCT_LITE);
    token=r.body.session.token;
    assert.match(token,/^[a-f0-9]{64}$/);
    assert.equal(sessionCount,1);
    assert.deepEqual((await readLiteLicenseSnapshot(db,key)).phones,[validBody.phoneNumber]);
    assert.equal(Object.hasOwn(memory,key),false,'Lite must not pollute full-product cache');
  });
  await t.test('replayed request is rejected without extra session',async()=>{
    const r=await post('key','r58-key-issue',validBody);
    assert.equal(r.body.errorCode,'SECURITY_REPLAY_REJECTED');
    assert.equal(sessionCount,1);
  });
  await t.test('refresh validates signed request and existing bearer token',async()=>{
    const r=await post('refresh','r58-refresh',{}, {token});
    assert.equal(r.status,200);assert.equal(r.body.ok,true);
    assert.equal(r.body.entitlement.productId,PRODUCT_LITE);
  });
  await t.test('real account credentials can use only linked Lite entitlement',async()=>{
    const r=await post('login','r58-account-login',{email:'lite@example.com',password:'correct-test-password'});
    assert.equal(r.status,200);assert.equal(r.body.entitlement.productId,PRODUCT_LITE);
    assert.equal(sessionCount,2);
    const bad=await post('login','r58-account-bad',{email:'lite@example.com',password:'bad'});
    assert.equal(bad.body.errorCode,'invalid_credentials');
    assert.equal(sessionCount,2);
  });
  await t.test('logout revokes bearer and subsequent refresh rejects',async()=>{
    const out=await post('logout','r58-logout',{}, {token});
    assert.equal(out.body.ok,true);assert.equal(out.body.revoked,true);
    const again=await post('refresh','r58-refresh-after-logout',{}, {token});
    assert.equal(again.body.errorCode,'invalid_session');
    assert.equal(sessionCount,2);
  });
  assert.ok(nonceCount>=6);
});
