'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LEGACY_V3_UNPACKED_COMPAT_SUFFIXES,
  parseChromeExtensionOrigin,
  isLegacyV3UnpackedCompatPath,
  resolveExtensionCorsOrigin,
} = require('../extension-origin-policy');

const OFFICIAL_ID = 'bdhnikgcdccjabkmbfcakgjkkgdlmgja';
const OFFICIAL = new Set([OFFICIAL_ID]);
const UNPACKED = 'abcdefghijklmnopabcdefghijklmnop';
const UNPACKED_ORIGIN = `chrome-extension://${UNPACKED}`;
const BUILD3_SUFFIXES = Object.freeze([
  '/v3/key',
  '/v3/check-status',
  '/v3/usage',
  '/v3/get-usage',
  '/v3/sync-usage',
]);

test('R41 contract: official CWS ID remains accepted outside the legacy fallback', () => {
  for (const pathname of ['/extension/v4/session/key','/extension/v3/meta/connection/validate']) {
    assert.equal(resolveExtensionCorsOrigin({
      origin:`chrome-extension://${OFFICIAL_ID}`, pathname,
      extensionIds:OFFICIAL, legacyV3Allow:false,
    }), `chrome-extension://${OFFICIAL_ID}`);
  }
});

test('R41 contract: Build 3 unpacked fallback is exactly the five historical V3 endpoints', () => {
  assert.deepEqual([...LEGACY_V3_UNPACKED_COMPAT_SUFFIXES], BUILD3_SUFFIXES);
  for (const suffix of BUILD3_SUFFIXES) {
    const pathname = `/extension${suffix}`;
    assert.equal(isLegacyV3UnpackedCompatPath(pathname), true);
    assert.equal(resolveExtensionCorsOrigin({
      origin:UNPACKED_ORIGIN, pathname, extensionIds:OFFICIAL, legacyV3Allow:true,
    }), UNPACKED_ORIGIN);
  }
});

test('R41 contract: unpacked fallback remains rejected everywhere else', () => {
  for (const pathname of [
    '/extension/v4/session/key',
    '/extension/v4/session/login',
    '/extension/v3/meta/connection/validate',
    '/extension/v3/unknown',
    '/extension/v3/key/',
    '/extension/v3/check-status/',
    '/extension/v3/usage/extra',
  ]) {
    assert.equal(resolveExtensionCorsOrigin({
      origin:UNPACKED_ORIGIN, pathname, extensionIds:OFFICIAL, legacyV3Allow:true,
    }), null);
  }
});

test('R41 contract: Legacy V3 master switch is the only fallback switch', () => {
  for (const suffix of BUILD3_SUFFIXES) {
    const pathname = `/extension${suffix}`;
    assert.equal(resolveExtensionCorsOrigin({
      origin:UNPACKED_ORIGIN, pathname, extensionIds:OFFICIAL, legacyV3Allow:false,
    }), null);
  }
});

test('R41 contract: malformed or non-extension origins remain rejected', () => {
  for (const origin of [
    'https://evil.example',
    'chrome-extension://abcdefghijklmnop',
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop:443',
    'chrome-extension://user@abcdefghijklmnopabcdefghijklmnop',
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop/path',
  ]) {
    assert.equal(parseChromeExtensionOrigin(origin), null);
  }
});

test('R41 contract: path matcher is exact for every Build 3 endpoint', () => {
  for (const suffix of BUILD3_SUFFIXES) {
    const exact = `/extension${suffix}`;
    assert.equal(isLegacyV3UnpackedCompatPath(exact), true);
    assert.equal(isLegacyV3UnpackedCompatPath(exact + '/'), false);
    assert.equal(isLegacyV3UnpackedCompatPath(exact + 'evil'), false);
  }
});
