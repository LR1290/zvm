'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function between(a, b) {
  const i = source.indexOf(a), j = source.indexOf(b, i + a.length);
  assert(i >= 0 && j > i, 'source region: ' + a);
  return source.slice(i, j);
}
const helper = between('async function mutateAdminKeyRecordStrict(', '\nfunction sendAdminKeyPersistFailure(');
// R46.88: comparação atômica só dos campos alterados. Casos dinâmicos em
// r46-88-admin-field-cas.test.js; manter aqui as quotas legadas e contrato.
assert.match(helper, /findOneAndUpdate\(/);
assert.match(helper, /createPatch\(current, draft\)/);
assert.match(helper, /returnDocument: 'after'/);
assert.match(helper, /field \+ '\.modules\.'/);
assert.match(helper, /if \(attempt < 4\)/);
assert.doesNotMatch(helper, /\$set: \{ \[field\]: draft/);
const rates = between('const RL_CONFIG = {', '\nfunction checkRateLimit(');
assert.match(rates, /legacy_v3_usage:\s*\{ max: 180/);
assert.match(rates, /ext_key_v3:\s*\{ max: 60/);
assert.match(rates, /ext_key_v4:\s*\{ max: 60/);
const v3 = between("  if (p === R_EXT+'/v3/usage'", "  if ([R_EXT+'/v3/usage'");
assert.equal((v3.match(/checkRateLimit\(ip, 'legacy_v3_usage'\)/g) || []).length, 3);
assert.doesNotMatch(v3, /checkRateLimit\(ip, 'api'\)/);
const v4 = between("  if (p === R_EXT+'/v4/session/key'", "  if (p === R_EXT+'/v3/key'");
assert.match(v4, /ext_key_v4/);
console.log('R46.84/R46.88 PASS: scoped admin CAS and V3/V4 quotas');
