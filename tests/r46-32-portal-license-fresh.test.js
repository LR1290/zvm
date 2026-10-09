'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

process.env.RENDER = 'true';
process.env.ADMIN_USER = 'audit-test';
process.env.ADMIN_PASS = 'audit-password';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test';

const serverPath = path.resolve(__dirname, '..', 'server.js');
const code = fs.readFileSync(serverPath, 'utf8');
const originalLoad = Module._load;
let api;
try {
  Module._load = function(id, ...args) {
    if (id === 'mongodb') return { MongoClient: class OfflineMongoDouble {} };
    return originalLoad.call(this, id, ...args);
  };
  api = require(serverPath).__test;
} finally {
  Module._load = originalLoad;
}

const keyCode = 'zv-audit-freshness-01';
const oldExpiry = '2026-10-10T12:00:00.000Z';
const newExpiry = '2026-11-10T12:00:00.000Z';
const persisted = new Map([[keyCode, {
  label: 'Licença fictícia', active: true, maxUses: 3, phones: [],
  expiresAt: oldExpiry,
}]]);
const requestedProjections = [];
let throwOnRead = false;
const db = {
  collection(name) {
    assert.equal(name, 'store');
    return {
      async findOne(filter, options) {
        assert.deepEqual(filter, { _id: 'keys' });
        if (throwOnRead) throw new Error('mongo_offline_test');
        requestedProjections.push(options?.projection);
        const projectionPath = options?.projection && Object.keys(options.projection).find(k => k.startsWith('data.'));
        assert.equal(projectionPath, `data.${keyCode}`);
        return persisted.has(keyCode) ? { data: { [keyCode]: structuredClone(persisted.get(keyCode)) } } : {};
      },
      async updateOne(filter, update) {
        assert.equal(filter._id, 'keys');
        assert.ok(update.$set[`data.${keyCode}`]);
        persisted.set(keyCode, structuredClone(update.$set[`data.${keyCode}`]));
        return { matchedCount: 1 };
      },
    };
  },
};

(async () => {
  assert.equal(typeof api.readPortalKeySnapshot, 'function', 'fresh portal reader must be exported for regression test');
  api.keys[keyCode] = structuredClone(persisted.get(keyCode));

  // Simulate admin persistence, then a second server instance still holding the old record.
  await api.commitAdminKeyRecordStrict(keyCode, { ...persisted.get(keyCode), expiresAt: newExpiry }, { db });
  api.keys[keyCode].expiresAt = oldExpiry;
  const fresh = await api.readPortalKeySnapshot(keyCode, { db });
  assert.equal(fresh.expiresAt, newExpiry, 'portal must read persistent state, not process memory');
  assert.equal(api.keys[keyCode].expiresAt, oldExpiry, 'portal read must not silently overwrite another process cache');
  assert.equal(requestedProjections.length, 1, 'one targeted database read per portal fetch');
  const page = api.renderPortalDashboard({ name: 'Cliente Fictício', email: 'audit@example.invalid' }, fresh);
  assert.ok(page.includes(`data-expires="${newExpiry}"`), 'dashboard countdown must use the latest expiry from MongoDB');
  assert.ok(!page.includes(`data-expires="${oldExpiry}"`), 'dashboard must not render old expiry');

  persisted.get(keyCode).active = false;
  const blocked = await api.readPortalKeySnapshot(keyCode, { db });
  assert.equal(blocked.active, false, 'admin block must be visible on subsequent read');
  assert.match(api.renderPortalDashboard({ name: 'Cliente Fictício' }, blocked), /Inativa/, 'dashboard must show blocked license as inactive');

  persisted.delete(keyCode);
  assert.equal(await api.readPortalKeySnapshot(keyCode, { db }), null, 'deletion must not resurrect cached license');

  throwOnRead = true;
  await assert.rejects(api.readPortalKeySnapshot(keyCode, { db }), /mongo_offline_test/, 'DB outages must not masquerade as a deleted license');
  throwOnRead = false;

  await assert.rejects(api.readPortalKeySnapshot('bad.key', { db }), /invalid_portal_key_code/, 'projection field must reject dotted key codes');

  const overview = code.slice(code.indexOf("if (p === '/cliente' || p === '/cliente/')"), code.indexOf("if (p === '/cliente/login' && req.method === 'GET')"));
  const plans = code.slice(code.indexOf("if (p === '/cliente/planos' && req.method === 'GET')"), code.indexOf("if (p === '/cliente' || p === '/cliente/')"));
  for (const [name, route] of [['overview', overview], ['plans', plans]]) {
    assert.match(route, /readPortalKeySnapshot\(user\.keyCode,\s*\{ db \}\)/, `${name} must load persisted license`);
    assert.doesNotMatch(route, /keyData\s*=\s*keys\[user\.keyCode\]/, `${name} must not use cached license`);
    assert.match(route, /renderPortalLicenseUnavailable/, `${name} errors should preserve authenticated context`);
  }
  delete api.keys[keyCode];
  console.log('R46.32 portal license freshness: 12 contract and integration checks PASS');
})().catch(err => { delete api.keys[keyCode]; console.error(err); process.exitCode = 1; });