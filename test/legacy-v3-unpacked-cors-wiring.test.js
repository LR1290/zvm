'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');

test('R41 recovery: server wires pathname-aware extension origin policy into CORS preflight', () => {
  assert.match(source, /function isAllowedExtensionOrigin\(origin, pathname\)/);
  assert.match(source, /resolveExtensionCorsOrigin\(\{[\s\S]*?pathname,[\s\S]*?legacyV3Allow:\s*ZVM_LEGACY_V3_ALLOW/);
  assert.match(source, /if \(p\.startsWith\(R_EXT\)\) return isAllowedExtensionOrigin\(o, p\) \|\| 'null';/);
  assert.match(source, /if \(req\.method === 'OPTIONS'\) \{ res\.writeHead\(204\); res\.end\(\); return; \}/);
});

test('R41 recovery: Build 3 fallback still has no second environment switch', () => {
  assert.doesNotMatch(source, /process\.env\.ZVM_LEGACY_V3_UNPACKED_ORIGINS_ALLOW/);
  assert.match(source, /Legacy V3 endpoints: \$\{ZVM_LEGACY_V3_ALLOW \? 'ATIVOS \(Build 3 unpacked: key\/check-status\/usage\/get-usage\/sync-usage\)' : 'INATIVOS'\}/);
});

test('R41 recovery: server keeps extension root exact at /extension', () => {
  assert.match(source, /const R_EXT\s*=\s*'\/extension';/);
});

test('R41 recovery: all five Build 3 routes are present in privacy-safe traffic vocabulary', () => {
  for (const suffix of ['/v3/key','/v3/check-status','/v3/usage','/v3/get-usage','/v3/sync-usage']) {
    assert.ok(source.includes(`'${suffix}'`), `missing traffic route ${suffix}`);
  }
});
