'use strict';
const assert = require('node:assert/strict');
const { createBuildAuthority } = require('../build-authority');
const storeId = 'bdhnikgcdccjabkmbfcakgjkkgdlmgja';
const otherId = 'ckbffcbmanboelbihfkhiahgafnimcho';
const fingerprint = 'a'.repeat(64);
const now = Date.now();
const security = {
  protocol: 2, extensionVersion: '0.9.7', extensionId: storeId,
  channel: 'production', profile: 'release', buildId: 'zvm-production-0.9.7-s48f5ee809339',
  buildFingerprint: fingerprint, installationId: '123e4567-e89b-42d3-a456-426614174000',
  requestId: 'r46_38_build_request', sentAtMs: now,
};
const activeCwsEntry = { status: 'active', buildId: security.buildId, channel: 'production',
  profile: 'release', securityProtocol: 2, extensionVersion: security.extensionVersion,
  buildFingerprint: 'b'.repeat(64), extensionIds: [storeId] };
const mk = extra => createBuildAuthority({ securityProtocol: 1, buildEnforce: true,
  runtimeEnv: 'production', legacyV3Allow: true, extensionIds: new Set([storeId,otherId]),
  registryV2: new Map([[security.buildId, activeCwsEntry]]), ...extra },{now:()=>now});
const original = process.env.ZVM_CWS_COMPAT;
try {
  delete process.env.ZVM_CWS_COMPAT;
  let a = mk();
  assert.equal(a.checkClient(security).code, 'BUILD_NOT_ALLOWED');
  process.env.ZVM_CWS_COMPAT = '1';
  a = mk();
  assert.equal(a.checkClient(security).ok, true, 'updated public store release is admitted');
  assert.equal(a.storedSessionAllowed({...security,securityProtocol:2}),true, 'session refresh stays admitted');
  assert.equal(a.checkClient({...security,extensionId:otherId}).code,'BUILD_NOT_ALLOWED','other extensions are not admitted');
  assert.equal(a.checkClient({...security,channel:'dev',profile:'dev',buildId:'zvm-dev-0.9.7-s123456789abc'}).code,'DEV_BUILD_NOT_AUTHORIZED','DEV remains blocked');
  const revoked = mk({registryV2:new Map([[security.buildId,{status:'revoked'}]])});
  assert.equal(revoked.checkClient(security).code,'BUILD_REVOKED','explicitly revoked build stays blocked');
  assert.equal(revoked.storedSessionAllowed({...security,securityProtocol:2}),false,'revoked session stays blocked');
  const denied = mk({deniedBuilds:new Map([['0.9.7',new Set([fingerprint])]])});
  assert.equal(denied.checkClient(security).code,'BUILD_REVOKED','denied fingerprint always blocked');
  const v1 = { protocol: 1, extensionVersion:'0.9.7', extensionId:storeId,buildFingerprint:fingerprint,requestId:'r46_38_client_v1',sentAtMs:now };
  assert.equal(a.checkClient(v1).ok,true,'v1 store build admitted');
  assert.equal(a.storedSessionAllowed({...v1,securityProtocol:1}),true,'v1 session remains usable');
  assert.equal(a.checkClient({...v1,extensionVersion:'0.8.530'}).code,'BUILD_NOT_ALLOWED','old unrelated release blocked');
  assert.equal(a.checkClient({...security,extensionVersion:'1.0.0',buildId:'zvm-production-1.0.0-s123456789abc'}).code,'BUILD_ID_NOT_ALLOWED','future major needs review');
  assert.equal(a.checkClient({...security, buildId:'zvm-production-0.9.7-s123456789abc'}).code,
    'BUILD_ID_NOT_ALLOWED','unregistered source revision must not use CWS compatibility');
  assert.equal(a.checkClient({...security, extensionVersion:'0.9.8', buildId:'zvm-production-0.9.8-s123456789abc'}).code,
    'BUILD_ID_NOT_ALLOWED','unregistered newer version must not use CWS compatibility');
  assert.equal(a.legacyV3Allowed(),true,'Build 3 unchanged');
  const staging = createBuildAuthority({ securityProtocol:1,buildEnforce:true,runtimeEnv:'staging',extensionIds:new Set([storeId]) },{now:()=>now});
  assert.equal(staging.checkClient(security).code,'BUILD_ID_NOT_ALLOWED','staging not relaxed');
  process.env.ZVM_CWS_COMPAT = '0';
  assert.equal(mk().checkClient(security).code,'BUILD_NOT_ALLOWED','hotfix can be disabled without code change');
  console.log('PASS: CWS compatibility, explicit revocations, DEV, staging and Build 3');
} finally { if(original===undefined) delete process.env.ZVM_CWS_COMPAT; else process.env.ZVM_CWS_COMPAT=original; }
