'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the actual server helper, not a rewritten approximation.
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const begin = source.indexOf('async function authorizeExtensionKeySession(input, deps = {}) {');
const end = source.indexOf('\nasync function refreshExtensionSession(', begin);
assert.ok(begin > 0 && end > begin, 'canonical key-session helper exists');
const helper = source.slice(begin, end);
const routeBegin = source.indexOf("  if (p === R_EXT+'/v4/session/key' && req.method === 'POST') {");
const routeEnd = source.indexOf("  if (p === R_EXT+'/v4/session/login' && req.method === 'POST') {", routeBegin);
assert.ok(routeBegin > 0 && routeEnd > routeBegin, 'canonical key-session route exists');
const route = source.slice(routeBegin, routeEnd);
assert.match(route, /authorizeExtensionKeySession\(body,\s*\{\s*requireDevAccess:\s*buildClient\.signedDev\s*===\s*true,?\s*\}\)/,
  'signed DEV must request server-side permission before slot claim');
assert.match(route, /buildClient\.signedDev === true && authorized\.devAccess !== true/,
  'second-layer signed DEV permission check remains in the route');

let record = { active: true, devAccess: false, expiresAt: null, lastPhone: '5511999991111', maxUses: 3 };
let found = true, dbError = false, claims = 0, activations = 0;
const keys = { TESTKEY: record };
const sandbox = {
  keys,
  Promise, Date, console,
  MAX_PHONES_GLOBAL: 3,
  MAX_USES: 3,
  sanitizeId: (value, max) => String(value || '').slice(0, max),
  normalizePhone: value => String(value || '').replace(/\D/g, ''),
  safeScalar: value => String(value || ''),
  isFreeAuthKey: () => false,
  ensureKeyLoadedEx: async () => ({ found, dbError }),
  extensionLicenseIsUsable: key => !!key && key.active === true && (!key.expiresAt || new Date(key.expiresAt).getTime() > Date.now()),
  extensionDevAccessAllowed: (_code, key) => key.devAccess === true && key.active === true,
  claimPhoneSlotAtomic: async () => { claims++; return { status: 'claimed' }; },
  activateDeferredKey: async () => { activations++; return true; },
  extensionNow: () => new Date(),
  buildExtensionEntitlement: () => ({ tier: 'paid', entitlementRevision: 'test' }),
  extensionSubject: () => ({ type: 'license', id: 'synthetic' }),
  extensionAuthFailure: (errorCode, status) => ({ ok: false, errorCode, status }),
};
vm.runInNewContext(helper + '\nglobalThis.authorizeKey = authorizeExtensionKeySession;', sandbox, {
  filename: 'server-actual-key-auth.js', timeout: 3000,
});
async function auth(requireDevAccess) {
  return sandbox.authorizeKey({
    authKey: 'TESTKEY', phoneNumber: '5511999992222', deviceId: 'synthetic-device',
  }, { requireDevAccess });
}

(async () => {
  const denied = await auth(true);
  assert.equal(denied.ok, false);
  assert.equal(denied.errorCode, 'DEV_ACCESS_REQUIRED');
  assert.equal(denied.status, 403);
  assert.equal(claims, 0, 'denied signed DEV cannot claim any device slot');
  assert.equal(activations, 0, 'denied signed DEV cannot activate deferred key');
  assert.equal('phones' in record, false, 'denied signed DEV cannot mutate phone list');

  record.devAccess = true;
  const granted = await auth(true);
  assert.equal(granted.ok, true);
  assert.equal(granted.devAccess, true);
  assert.equal(claims, 1, 'authorized DEV claims exactly one slot');

  record.devAccess = false;
  const release = await auth(false);
  assert.equal(release.ok, true, 'regular RELEASE login is unaffected by DEV permission');
  assert.equal(claims, 2);

  record.active = false;
  assert.equal((await auth(true)).errorCode, 'key_blocked');
  assert.equal(claims, 2);
  record.active = true;
  record.expiresAt = '2000-01-01T00:00:00Z';
  assert.equal((await auth(true)).errorCode, 'key_expired');
  assert.equal(claims, 2);
  record.expiresAt = null;

  dbError = true;
  assert.equal((await auth(true)).errorCode, 'temporarily_unavailable');
  dbError = false;
  found = false;
  assert.equal((await auth(true)).errorCode, 'invalid_key');
  found = true;
  record.devAccess = true;
  record.phones = ['551100000001','551100000002','551100000003'];
  assert.equal((await auth(true)).errorCode, 'phone_limit_global');
  assert.equal(claims, 2);

  console.log('R57 PASS: 8 DEV/key/RELEASE outcomes, slot protection, route binding, denied mutations');
})().catch(error => { console.error(error); process.exitCode = 1; });
