'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseChromeExtensionOrigin,
  isLegacyV3UnpackedCompatPath,
  resolveExtensionCorsOrigin,
} = require('../extension-origin-policy');

const OFFICIAL = new Set(['bdhnikgcdccjabkmbfcakgjkkgdlmgja']);
const UNPACKED = 'abcdefghijklmnopabcdefghijklmnop';
const UNPACKED_ORIGIN = `chrome-extension://${UNPACKED}`;

test('official ID remains accepted on V4', () => {
  assert.equal(resolveExtensionCorsOrigin({
    origin:'chrome-extension://bdhnikgcdccjabkmbfcakgjkkgdlmgja', pathname:'/extension/v4/session/key',
    extensionIds:OFFICIAL, legacyV3Allow:true,
  }), 'chrome-extension://bdhnikgcdccjabkmbfcakgjkkgdlmgja');
});

test('unlisted unpacked ID is accepted only on Build 3 V3 key/check-status', () => {
  for (const pathname of ['/extension/v3/key','/extension/v3/check-status']) {
    assert.equal(resolveExtensionCorsOrigin({ origin:UNPACKED_ORIGIN, pathname, extensionIds:OFFICIAL,
      legacyV3Allow:true }), UNPACKED_ORIGIN);
  }
});

test('unlisted unpacked ID remains rejected on V4 and other V3 routes', () => {
  for (const pathname of ['/extension/v4/session/key','/extension/v3/meta/connection','/extension/v3/unknown']) {
    assert.equal(resolveExtensionCorsOrigin({ origin:UNPACKED_ORIGIN, pathname, extensionIds:OFFICIAL,
      legacyV3Allow:true }), null);
  }
});

test('legacy compatibility is controlled by the existing master Legacy V3 flag', () => {
  assert.equal(resolveExtensionCorsOrigin({ origin:UNPACKED_ORIGIN, pathname:'/extension/v3/key', extensionIds:OFFICIAL, legacyV3Allow:false }), null);
  assert.equal(resolveExtensionCorsOrigin({ origin:UNPACKED_ORIGIN, pathname:'/extension/v3/key', extensionIds:OFFICIAL, legacyV3Allow:true }), UNPACKED_ORIGIN);
});

test('web origins, malformed extension ids, credentials and ports remain rejected', () => {
  for (const origin of [
    'https://evil.example',
    'chrome-extension://abcdefghijklmnop',
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop:443',
    'chrome-extension://user@abcdefghijklmnopabcdefghijklmnop',
  ]) {
    assert.equal(parseChromeExtensionOrigin(origin), null);
  }
});

test('compatibility path matcher is exact', () => {
  assert.equal(isLegacyV3UnpackedCompatPath('/extension/v3/key'), true);
  assert.equal(isLegacyV3UnpackedCompatPath('/extension/v3/check-status'), true);
  assert.equal(isLegacyV3UnpackedCompatPath('/extension/v3/key/'), false);
  assert.equal(isLegacyV3UnpackedCompatPath('/extension/v3/keyevil'), false);
});
