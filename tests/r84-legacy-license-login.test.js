'use strict';
// R84: all fixtures are synthetic. No network, Mongo writes, real licenses, or WhatsApp access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const { PRODUCT_AUTOMACOES, PRODUCT_LITE, keyBelongsTo, generateLicenseKey } = require('../src/license-product-v2');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const legacy = 'zv-abcde-12345-abcde'; // 20 characters; synthetic
const lite = generateLicenseKey(PRODUCT_LITE);
const v2 = generateLicenseKey(PRODUCT_AUTOMACOES);
function section(begin, until) {
  const start = src.indexOf(begin);
  const end = src.indexOf(until, start + begin.length);
  assert.ok(start >= 0 && end > start, 'source section: ' + begin);
  return src.slice(start, end);
}
function extractedFunction(code, name, env = {}) {
  return new Function(...Object.keys(env), code + '\nreturn ' + name + ';')(...Object.values(env));
}
const normalize = extractedFunction(
  section('function normalizeOfficialLicenseCode(value) {', '\nfunction officialV2Metadata('),
  'normalizeOfficialLicenseCode'
);
const usable = extractedFunction(
  section('function extensionLicenseIsUsable(', '\nfunction extensionDevAccessAllowed('),
  'extensionLicenseIsUsable'
);
const normalizePhone = extractedFunction(
  section('function normalizePhone(value) {', '\n// Resincroniza uses'),
  'normalizePhone'
);
const future = '2030-12-31T00:00:00.000Z';
const past = '2020-01-01T00:00:00.000Z';
function record(extra = {}) {
  return { active:true, expiresAt:future, phones:['5538999999999'], maxUses:1, planId:'PRO', ...extra };
}
function makeAuthEnv(store, claimHistory) {
  return {
    normalizeOfficialLicenseCode: normalize, normalizePhone, keyBelongsTo,
    isFreeAuthKey:key=>key==='free',
    PRODUCT_AUTOMACOES, extensionLicenseIsUsable: usable,
    extensionNow: () => new Date('2026-11-19T12:00:00.000Z'),
    extensionAuthFailure:(errorCode,status,rest={})=>({ok:false,errorCode,status,...rest}),
    buildExtensionEntitlement:({keyCode,keyRecord})=>({tier:keyCode&&usable(keyRecord)?'paid':'free'}),
    extensionSubject:(type,keyCode)=>({type,id:'synthetic:'+keyCode}),
    extensionDevAccessAllowed:()=>false,
    safeScalar:(v,n)=>String(v||'').slice(0,n),
    MAX_PHONES_GLOBAL:100, MAX_USES:3,
    keys:store, ensureKeyLoadedEx:async k=>({found:!!store[k],dbError:false}),
    claimPhoneSlotAtomic:async (k,p,maxUses)=>{claimHistory.push({k,p,maxUses});return {status:'already_member'};},
    activateDeferredKey:async ()=>true,
  };
}
const store = {[legacy]:record(),[lite]:record({extensionProductId:PRODUCT_LITE}),[v2]:record({extensionProductId:PRODUCT_AUTOMACOES})};
const claims = [];
const authEnv = makeAuthEnv(store, claims);
const auth = extractedFunction(
  section('async function authorizeExtensionKeySession(', '\nasync function '),
  'authorizeExtensionKeySession',
  authEnv
);
const account = extractedFunction(
  section('async function resolveExtensionAccountEntitlement(', '\nasync function authenticateExtensionAccount('),
  'resolveExtensionAccountEntitlement',
  authEnv
);
(async function main() {
  let passed = 0;
  async function check(what,condition){ assert.ok(await condition,what); passed++; }
  await check('old 20-char key is accepted byte-for-byte', normalize(legacy)===legacy);
  await check('old uppercase key is normalized',normalize(legacy.toUpperCase())===legacy);
  await check('legacy record without extensionProductId retains ZVM official authority',
    keyBelongsTo(store[legacy],legacy,PRODUCT_AUTOMACOES));
  await check('legacy record with explicit official product remains accepted',
    keyBelongsTo(record({extensionProductId:PRODUCT_AUTOMACOES}),legacy,PRODUCT_AUTOMACOES));
  let result=await auth({authKey:legacy,phoneNumber:'5538999999999',deviceId:'synthetic-device'});
  await check('V4 login accepts old record',result.ok===true && result.licenseKeyCode===legacy && result.entitlement.tier==='paid');
  await check('V4 old key reserves no new slot on relogin',claims.length===1 && claims[0].maxUses===1);
  result=await auth({authKey:legacy.toUpperCase(),phoneNumber:'5538999999999',deviceId:'synthetic-device'});
  await check('V4 login accepts uppercase old record',result.ok===true && result.licenseKeyCode===legacy);
  result=await account({keyCode:legacy});
  await check('V4 account-password entitlement retains old license',result.ok===true && result.keyCode===legacy && result.entitlement.tier==='paid');
  result=await auth({authKey:lite,phoneNumber:'5538999999999',deviceId:'synthetic-device'});
  await check('V4 cannot activate a LITE license in full ZVM',result.ok===false && result.errorCode==='invalid_request');
  result=await auth({authKey:v2,phoneNumber:'5538999999999',deviceId:'synthetic-device'});
  await check('V4 still accepts a correctly marked official V2 key',result.ok===true && result.licenseKeyCode===v2);
  const n=claims.length;
  store[legacy].active=false;
  result=await auth({authKey:legacy,phoneNumber:'5538999999999',deviceId:'synthetic-device'});
  await check('blocked legacy key keeps original blocked semantics',result.errorCode==='key_blocked' && claims.length===n);
  store[legacy].active=true;store[legacy].expiresAt=past;
  result=await auth({authKey:legacy,phoneNumber:'5538999999999',deviceId:'synthetic-device'});
  await check('expired legacy key denied as before',result.errorCode==='key_expired');
  store[legacy].expiresAt=future; // models renewal of SAME code, no issuance
  result=await auth({authKey:legacy,phoneNumber:'5538999999999',deviceId:'synthetic-device'});
  await check('renewed old license logs in with same old code',result.ok===true && result.licenseKeyCode===legacy);
  result=await account({keyCode:legacy});
  await check('renewed old license remains linked to account',result.ok===true && result.keyCode===legacy);
  const dbUnavailable = extractedFunction(
    section('async function authorizeExtensionKeySession(', '\nasync function '),
    'authorizeExtensionKeySession',
    {...authEnv,ensureKeyLoadedEx:async()=>({found:false,dbError:true})}
  );
  result=await dbUnavailable({authKey:legacy,phoneNumber:'5538999999999',deviceId:'synthetic-device'});
  await check('database outage returns retryable 503, not a false revoked verdict',
    result.ok===false && result.status===503 && result.retryable===true && result.errorCode==='temporarily_unavailable');

  // Actual V3 request handler with synthetic request, response and persisted-key snapshot.
  const v3 = section("if (p === R_EXT+'/v3/key' && req.method === 'POST')", "\n  if (p === R_EXT+'/v3/check-status'");
  async function invokeV3({key=legacy,dbError=false,authRecord=record()}={}) {
    const data = [];
    const keyStore = {[key]:authRecord};
    const env = {
      R_EXT:'/extension',p:'/extension/v3/key',req:{method:'POST',headers:{'content-length':'64'}},
      res:{setHeader(){}},ip:'127.0.0.1',checkRateLimit:()=>true,
      sendExtensionRateLimited:()=>{throw Error('unexpected rate limit')},MAX_BODY_SIZE:65536,
      parseBody:async()=>({authKey:key,phoneNumber:'-',deviceId:'',wppVersion:'synthetic'}),
      normalizeOfficialLicenseCode:normalize,legacyV3Allowed:()=>true,
      isFreeAuthKey:k=>k==='free',getFreeAuthData:()=>({isLoggedIn:true,isFreePlan:true}),
      ensureKeyLoadedEx:async()=>dbError?{found:false,dbError:true}:{found:true,dbError:false},
      keyBelongsTo,PRODUCT_AUTOMACOES,keys:keyStore,
      sendJson:(_res,payload,status=200)=>data.push({payload,status}),
      addLog:()=>Promise.resolve(),saveKey:()=>Promise.resolve(),
      isKeyExpired:r=>r.expiresAt&&Date.parse(r.expiresAt)<Date.now(),
      AUTH_MSG:{EXPIRED:'expired',BLOCKED:'blocked',USER_NOT_FOUND:'not found'},
      getAuthData:k=>({isLoggedIn:true,licenseKeyCode:k}),MAX_PHONES_GLOBAL:100,
      zvmSecurityDevBuildAllowed:()=>false,
      legacyKeyStateSignature:()=>'',legacyReloginCacheKey:()=>'',ZVM_LEGACY_V3_SHIELD:{noteKeyBypass(){},setKey(){},getKey(){return null;},noteDbWritesAvoided(){}},
      getFreeAuthData:()=>({isLoggedIn:true}),upsertActivation:async()=>{},activateDeferredKey:async()=>true,claimPhoneSlotAtomic:async()=>({status:'already_member'}),
      normalizePhone,addSecurityAlert:()=>{},fireWebhook:()=>{},_trackKeyFail:()=>{},
      getAuthData:k=>({isLoggedIn:true,licenseKeyCode:k}),safeScalar:(v,n)=>String(v||'').slice(0,n),
      sendExtensionRateLimited:()=>{},zvmSecurityCheckClientShared:async()=>({ok:true}),zvmSecurityClientErrorStatus:()=>403
    };
    await new AsyncFunction(...Object.keys(env),v3+'\nreturn;')(...Object.values(env));
    assert.equal(data.length,1,'exactly one V3 response');
    return data[0];
  }
  let v3Result=await invokeV3();
  await check('V3 old extension key login succeeds',v3Result.status===200 && v3Result.payload.isLoggedIn===true && v3Result.payload.licenseKeyCode===legacy);
  v3Result=await invokeV3({authRecord:record({active:false})});
  await check('V3 legacy blocked key stays blocked',v3Result.payload.authError==='keyBlocked' && v3Result.status===403);
  v3Result=await invokeV3({authRecord:record({expiresAt:past})});
  await check('V3 legacy expired key stays expired',v3Result.payload.authError==='keyExpired' && v3Result.status===403);
  v3Result=await invokeV3({dbError:true});
  await check('V3 outage remains 503 retryable, not forced logout',v3Result.status===503 && v3Result.payload.retryable===true && !('isLoggedIn' in v3Result.payload));
  v3Result=await invokeV3({key:lite,authRecord:record({extensionProductId:PRODUCT_LITE})});
  await check('V3 rejects LITE on official',v3Result.payload.authError==='keyNotFound');
  // Shape checks on portal and payments: must preserve the original code.
  const portal=section("if (p === '/cliente/vincular')","if (p === '/cliente/desvincular'");
  await check('portal keeps old code instead of issuing replacement',portal.includes('keyCode: keycode') && portal.includes('normalizeOfficialLicenseCode(enteredKeyCode)'));
  const commercial=section('async function _processCommercialSaleUnlocked(', '\nasync function processCommercialSale(');
  await check('Cakto renew branch preserves existingCode',commercial.includes('if (existingCode) {\n    keyCode = existingCode;'));
  await check('Cakto generates fresh code only in else branch',commercial.includes('} else {\n    keyCode = generateOfficialCode();'));
  console.log('R84 legacy key login PASS: '+passed+' synthetic compatibility checks');
})().catch(e=>{console.error(e);process.exitCode=1});
