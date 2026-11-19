'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createBuildAuthority, loadRegistryV2 } = require('../build-authority');

const commercialId = 'bdhnikgcdccjabkmbfcakgjkkgdlmgja';
const devId = 'ckbffcbmanboelbihfkhiahgafnimcho';
const expected = Object.freeze({
  buildId: 'zvm-production-0.9.289-s5e4a7ae127ec',
  buildFingerprint: 'f30db0821366e6770b1a1c09f0e171b290dd036b4aef80997a66b55966e7df33',
  sourceTreeSha256: '5e4a7ae127ec22bd4fd191dd0d6989351c8fd771decb44c74de64d901adc9011',
});
const registry = loadRegistryV2(path.resolve(__dirname, '..', 'zvm-build-registry-v2.json'));
const release = registry.get(expected.buildId);
assert.ok(release, 'R81 must be staged before Chrome Web Store submission');
for (const key of ['buildId', 'buildFingerprint', 'sourceTreeSha256']) {
  assert.equal(release[key], expected[key], 'R81 identity: ' + key);
}
assert.equal(release.status, 'active');
assert.equal(release.channel, 'production');
assert.equal(release.profile, 'release');
assert.equal(release.extensionVersion, '0.9.289');
assert.equal(release.securityProtocol, 2);
assert.deepEqual([...release.extensionIds], [commercialId]);

const oldReleases = ['0.9.287', '0.9.288'].map(version => {
  const entry = [...registry.values()].find(item => item.extensionVersion === version &&
    item.status === 'active' && item.channel === 'production' && item.extensionIds.includes(commercialId));
  assert.ok(entry, version + ' must remain registered');
  return entry;
});

const timestamp = Date.now();
const mk = (overrides = {}) => createBuildAuthority({
  securityProtocol: 2,
  buildEnforce: true,
  runtimeEnv: 'production',
  extensionIds: new Set([commercialId, devId]),
  registryV2: registry,
  ...overrides,
}, { now: () => timestamp });
const identity = entry => ({
  protocol: 2,
  extensionVersion: entry.extensionVersion,
  extensionId: commercialId,
  channel: entry.channel,
  profile: entry.profile,
  buildId: entry.buildId,
  buildFingerprint: entry.buildFingerprint,
  installationId: '123e4567-e89b-42d3-a456-426614174000',
  requestId: 'r81_release_client_validation',
  sentAtMs: timestamp,
});
const old = process.env.ZVM_CWS_COMPAT;
try {
  // Strict: do not rely on a production compatibility bypass.
  process.env.ZVM_CWS_COMPAT = '0';
  const authority = mk();
  for (const entry of [release, ...oldReleases]) {
    const client = identity(entry);
    const result = authority.checkClient(client, {consume:false});
    assert.equal(result.ok, true, entry.extensionVersion + ': ' + result.code);
    assert.equal(result.recognized, true, 'official commercial build is recognized');
    assert.equal(authority.storedSessionAllowed({ ...client, securityProtocol: 2 }), true,
      'refresh remains allowed: ' + entry.extensionVersion);
    assert.deepEqual(authority.storedSessionDecision({ ...client, securityProtocol: 2 }), {ok:true});
  }

  const client = identity(release);
  assert.equal(authority.checkClient({...client, buildId:'zvm-production-0.9.289-s123456789abc'}).code,
    'BUILD_ID_NOT_ALLOWED', 'unregistered build remains blocked');
  assert.equal(authority.checkClient({...client, buildFingerprint:'a'.repeat(64)}).code,
    'BUILD_NOT_ALLOWED', 'fingerprint substitution remains blocked');
  assert.equal(authority.checkClient({...client, extensionId:devId}).code,
    'EXTENSION_ID_NOT_ALLOWED', 'DEV extension ID cannot claim commercial build');
  assert.equal(authority.checkClient({...client, channel:'dev', profile:'dev', buildId:'zvm-dev-0.9.289-s123456789abc'}).code,
    'DEV_BUILD_NOT_AUTHORIZED', 'DEV is never automatically enabled by commercial registration');
  assert.equal(authority.checkClient({...client, extensionVersion:'0.9.290', buildId:'zvm-production-0.9.290-s123456789abc'}).code,
    'BUILD_ID_NOT_ALLOWED', 'unknown versions remain blocked');
  const revoked = mk({registryV2:new Map([...registry.entries()].map(([id, value]) =>
    [id, id === expected.buildId ? {...value, status:'revoked'} : value]))});
  assert.equal(revoked.checkClient(client).code, 'BUILD_REVOKED');
  assert.equal(revoked.storedSessionDecision({...client, securityProtocol:2}).code, 'BUILD_REVOKED');

  // A CWS compatibility flag must never accept an unregistered build ID.
  process.env.ZVM_CWS_COMPAT = '1';
  const compat = mk();
  assert.equal(compat.checkClient({...client, buildId:'zvm-production-0.9.289-s123456789abc'}).code,
    'BUILD_ID_NOT_ALLOWED');
  assert.equal(compat.checkClient({...client, extensionId:devId, buildFingerprint:'a'.repeat(64)}).ok,
    false, 'CWS compatibility must remain restricted to the official extension ID');
  assert.equal(revoked.checkClient(client).code, 'BUILD_REVOKED');
} finally {
  if (old === undefined) delete process.env.ZVM_CWS_COMPAT;
  else process.env.ZVM_CWS_COMPAT = old;
}
console.log('R81 PASS: production 0.9.289, legacy 0.9.287/0.9.288, session refresh, strict deny, DEV isolation and CWS gates');
