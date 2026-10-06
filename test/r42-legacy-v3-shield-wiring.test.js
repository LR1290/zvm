'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');

test('R43 server preserves the bounded legacy shield and exposes no new endpoint', () => {
  assert.match(source, /require\('\.\/legacy-v3-shield'\)/);
  assert.match(source, /new LegacyV3Shield\(/);
  assert.match(source, /const ZVM_BUILD_ID = '2026-10-06-privacy-oauth-release-r43';/);
  for (const suffix of ['/v3/key','/v3/check-status','/v3/usage','/v3/get-usage','/v3/sync-usage']) {
    assert.ok(source.includes(`R_EXT+'${suffix}'`) || source.includes(`'${suffix}'`), suffix);
  }
});

test('R42 check-status shields active and negative responses after authoritative checks', () => {
  const start = source.indexOf("if (p === R_EXT+'/v3/check-status' && req.method === 'POST')");
  const end = source.indexOf("if (p === R_EXT+'/v3/usage' && req.method === 'POST')", start);
  const route = source.slice(start,end);
  assert.match(route, /if \(isKeyExpired\(_k\)\)/);
  assert.match(route, /ZVM_LEGACY_V3_SHIELD\.getCheck\(_csCacheKey, _expiredSig\)/);
  assert.match(route, /ZVM_LEGACY_V3_SHIELD\.setCheck\(_csCacheKey, _expiredSig, _expiredPayload\)/);
  assert.match(route, /ZVM_LEGACY_V3_SHIELD\.getCheck\(_csCacheKey, _csSig\)/);
  assert.match(route, /ZVM_LEGACY_V3_SHIELD\.setCheck\(_csCacheKey, _csSig, _blockedPayload\)/);
  assert.match(route, /ZVM_LEGACY_V3_SHIELD\.setCheck\(_csCacheKey, _csSig, _removedPayload\)/);
  assert.match(route, /ZVM_LEGACY_V3_SHIELD\.setCheck\(_csCacheKey, _csSig, _activePayload\)/);
});

test('R42 relogin fast-path cannot bypass new phone, inconsistent uses or deferred activation', () => {
  const start = source.indexOf("if (p === R_EXT+'/v3/key' && req.method === 'POST')");
  const end = source.indexOf("if (p === R_EXT+'/v3/check-status' && req.method === 'POST')", start);
  const route = source.slice(start,end);
  assert.match(route, /const alreadyKnown = keys\[keyCode\]\.phones\.some/);
  assert.match(route, /const _usesConsistent = Number\(keys\[keyCode\]\.uses \|\| 0\) === keys\[keyCode\]\.phones\.length/);
  assert.match(route, /const _deferredPending = !!\(keys\[keyCode\]\.expireDuration && !keys\[keyCode\]\.expiresAt\)/);
  assert.match(route, /if \(alreadyKnown && _usesConsistent && !_deferredPending\)/);
  assert.match(route, /claimResult = await claimPhoneSlotAtomic\(keyCode, phone, keyMaxUses\)/);
  assert.match(route, /ZVM_LEGACY_V3_SHIELD\.setKey\(_seedCacheKey, _seedSignature, _legacyAuthPayload\)/);
});

test('R42 shield hits do not weaken existing rate limits or V4 Build Authority', () => {
  const keyRoute = source.slice(
    source.indexOf("if (p === R_EXT+'/v3/key' && req.method === 'POST')"),
    source.indexOf("if (p === R_EXT+'/v3/check-status' && req.method === 'POST')")
  );
  const checkRoute = source.slice(
    source.indexOf("if (p === R_EXT+'/v3/check-status' && req.method === 'POST')"),
    source.indexOf("if (p === R_EXT+'/v3/usage' && req.method === 'POST')")
  );
  assert.ok(keyRoute.indexOf("checkRateLimit(ip, 'ext_key_v3')") < keyRoute.indexOf("ZVM_LEGACY_V3_SHIELD.getKey"));
  assert.ok(checkRoute.indexOf("checkRateLimit(ip, 'check_status'") < checkRoute.indexOf("ZVM_LEGACY_V3_SHIELD.getCheck"));
  assert.doesNotMatch(source, /ZVM_LEGACY_V3_SHIELD[\s\S]{0,2000}\/v4\/session/);
});
