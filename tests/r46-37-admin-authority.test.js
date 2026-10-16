'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
process.env.RENDER = 'true';
process.env.ADMIN_USER = 'audit-test';
process.env.ADMIN_PASS = 'audit-password';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/fake';
const serverPath = path.resolve(__dirname, '..', 'server.js');
const originalLoad = Module._load;
let api;
try {
  Module._load = function(id, ...args) {
    if (id === 'mongodb') return { MongoClient: class OfflineMongoDouble {} };
    return originalLoad.call(this, id, ...args);
  };
  api = require(serverPath).__test;
} finally { Module._load = originalLoad; }

const keyCode = 'zv-test-fresh-admin';
const state = { [keyCode]: { label: 'Fictícia', active: true, maxUses: 3, phones: [], expiresAt: '2026-10-11T12:00:00.000Z' } };
let failRead = false;
let forceConflict = false;
let writes = 0;
const db = { collection(name) {
  assert.equal(name, 'store');
  return {
    async findOne(filter, options) {
      assert.equal(filter._id, 'keys');
      if (failRead) throw new Error('mongo_offline_fixture');
      const f = options?.projection && Object.keys(options.projection).find(x => x.startsWith('data.'));
      if (f) return state[f.slice(5)] ? { data: { [f.slice(5)]:structuredClone(state[f.slice(5)]) } } : { data:{} };
      return { data: structuredClone(state) };
    },
    async findOneAndUpdate(filter, update, options) {
      writes++;
      const field = `data.${keyCode}`;
      assert.equal(filter[field].$type, 'object');
      assert.equal(options.returnDocument, 'after');
      assert.equal(update.$set[field], undefined, 'no full-record replacement');
      if (forceConflict) return null;
      for (const [path, value] of Object.entries(filter)) {
        if (path === '_id' || path === field) continue;
        const sub = path.slice(field.length + 1);
        if (JSON.stringify(state[keyCode][sub]) !== JSON.stringify(value)) return null;
      }
      for (const [path, value] of Object.entries(update.$set)) {
        if (path.startsWith(field + '.')) state[keyCode][path.slice(field.length + 1)] = structuredClone(value);
      }
      return { data: { [keyCode]: structuredClone(state[keyCode]) } };
    },
  };
}};

(async()=>{
  assert.match(fs.readFileSync(serverPath,'utf8'), /keysSnapshot = await readAdminKeysSnapshot\(\)/, 'HTTP Admin endpoints must read fresh records');
  assert.match(fs.readFileSync(serverPath,'utf8'), /keysHtml: buildKeysHtml\(keysSnapshot\)/, 'API data must not reuse cached HTML');
  assert.equal(typeof api.readAdminKeysSnapshot, 'function', 'Admin needs persisted state reader');
  api.keys[keyCode] = { ...structuredClone(state[keyCode]), active:false, label:'LOCAL ANTIGO' };
  const snap = await api.readAdminKeysSnapshot({db});
  assert.equal(snap[keyCode].active,true);
  assert.equal(snap[keyCode].label,'Fictícia');
  const html = api.renderAdminDashboard({keysSnapshot:snap, portalUsers:[],portalUserCount:0});
  assert.match(html,/Fictícia/);
  assert.doesNotMatch(html,/LOCAL ANTIGO/);
  const freshStats = api.getKeyStats(snap);
  assert.equal(freshStats.totalKeys,1);
  assert.equal(freshStats.blockedKeys,0);
  // An admin change based on the old in-memory record MUST NOT overwrite current persistence.
  const newKey = await api.mutateAdminKeyRecordStrict(keyCode, draft => { draft.label='ALTERADO PELO ADMIN'; },{db});
  assert.equal(newKey.label,'ALTERADO PELO ADMIN');
  assert.equal(newKey.active,true,'current Mongo status must win over stale process memory');
  assert.equal(state[keyCode].active,true);
  assert.equal(writes,1);
  forceConflict=true;
  await assert.rejects(api.mutateAdminKeyRecordStrict(keyCode,draft=>{draft.active=false;},{db}),e=>e.code==='key_write_conflict');
  assert.equal(state[keyCode].active,true,'concurrent mutation must not be overwritten');
  const countWrites=writes;
  failRead=true;
  await assert.rejects(api.readAdminKeysSnapshot({db}),/mongo_offline_fixture/,'database outage must not display stale copy');
  assert.equal(writes,countWrites);
  console.log('R46.37 admin authority, freshness, lost-update protection PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
