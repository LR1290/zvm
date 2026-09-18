'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');

test('R34 server wires pathname-aware extension origin policy into CORS preflight', () => {
  assert.match(source, /function isAllowedExtensionOrigin\(origin, pathname\)/);
  assert.match(source, /resolveExtensionCorsOrigin\(\{[\s\S]*?pathname,[\s\S]*?legacyV3Allow:\s*ZVM_LEGACY_V3_ALLOW/);
  assert.match(source, /if \(p\.startsWith\(R_EXT\)\) return isAllowedExtensionOrigin\(o, p\) \|\| 'null';/);
  assert.match(source, /if \(req\.method === 'OPTIONS'\) \{ res\.writeHead\(204\); res\.end\(\); return; \}/);
});

test('R34 unpacked compatibility has no second environment switch', () => {
  assert.doesNotMatch(source, /process\.env\.ZVM_LEGACY_V3_UNPACKED_ORIGINS_ALLOW/);
  assert.match(source, /Legacy unpacked CORS: \${ZVM_LEGACY_V3_ALLOW \? 'ATIVO' : 'INATIVO'}/);
});

test('R34 keeps extension root exact at /extension', () => {
  assert.match(source, /const R_EXT\s*=\s*'\/extension';/);
});
