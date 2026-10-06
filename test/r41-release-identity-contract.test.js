'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname,'..');
const verifier = fs.readFileSync(path.join(root,'release','verify-release-assets.mjs'),'utf8');
const authority = fs.readFileSync(path.join(root,'build-authority.js'),'utf8');
const registry = JSON.parse(fs.readFileSync(path.join(root,'zvm-build-registry-v2.json'),'utf8'));
const releaseManifest = JSON.parse(fs.readFileSync(path.join(root,'release','ZVM_RELEASE_MANIFEST.json'),'utf8'));

const CWS_BETA_ID = 'bdhnikgcdccjabkmbfcakgjkkgdlmgja';

test('R41 manifest contract: browser-managed key is semantically ignored only after non-empty validation', () => {
  assert.match(verifier, /const MANIFEST_MODE = 'manifest-json-v1';/);
  assert.match(verifier, /depth === 0 && key === 'key'/);
  assert.match(verifier, /typeof value\[key\] !== 'string' \|\| !value\[key\]\.trim\(\)/);
  assert.match(verifier, /continue;/);
});

test('R41 manifest contract: only trusted CWS update_url is browser-managed', () => {
  assert.match(verifier, /const TRUSTED_UPDATE_URL = 'https:\/\/clients2\.google\.com\/service\/update2\/crx';/);
  assert.match(verifier, /key === 'update_url'/);
  assert.match(verifier, /manifest:update-url-untrusted/);
});

test('R41 identity contract: active BETA Registry V2 entries are pinned to the official CWS item ID', () => {
  const activeBeta = registry.builds.filter(b => b.status === 'active' && b.channel === 'beta');
  assert.ok(activeBeta.length > 0);
  for (const entry of activeBeta) assert.deepEqual(entry.extensionIds, [CWS_BETA_ID], entry.buildId);
});

test('R41 identity contract: release manifest BETA identity uses the same CWS item ID', () => {
  assert.equal(releaseManifest.extensions.beta.extensionId, CWS_BETA_ID);
});

test('R41 identity contract: Protocol V2 still requires both global and per-build extension ID authorization', () => {
  assert.match(authority, /state\.extensionIds\.size && !state\.extensionIds\.has\(extensionId\)/);
  assert.match(authority, /!entry\.extensionIds\.includes\(extensionId\)/);
  assert.match(authority, /EXTENSION_ID_NOT_ALLOWED/);
});
