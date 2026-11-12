'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const readStart = server.indexOf('async function readAdminKeySnapshot(');
const readEnd = server.indexOf('\n// R46.87', readStart);
const mutateStart = server.indexOf('async function mutateAdminKeyRecordStrict(');
const mutateEnd = server.indexOf('\nfunction sendAdminKeyPersistFailure(', mutateStart);
assert(readStart > 0 && readEnd > readStart && mutateStart > 0 && mutateEnd > mutateStart);

const makeFunctions = new Function('getMongoDb', 'cloneKeyRecordForCommit', 'zvmInvalidateMongoOnNetworkError',
  'keys', 'invalidateKeysHtmlCache',
  server.slice(readStart, readEnd) + '\n' + server.slice(mutateStart, mutateEnd) +
  '\nreturn {readAdminKeySnapshot, mutateAdminKeyRecordStrict};'
);
const clone = value => JSON.parse(JSON.stringify(value));
let checks = 0;
async function scenario(action) {
  const raw = {
    label: 'qa', phones: ['111', '222'], uses: 2, lastPhone: '222',
    activations: [{ phone: '111', firstSeenAt: new Date('2026-10-01T00:00:00Z'),
      lastSeenAt: new Date('2026-11-01T00:00:00Z') },
    { phone: '222', firstSeenAt: new Date('2026-10-02T00:00:00Z'),
      lastSeenAt: new Date('2026-11-02T00:00:00Z') }],
    expiresAt: '2027-01-01T00:00:00Z', active: true
  };
  const state = { record: raw, writes: 0, reads: 0, invalidations: 0 };
  const db = { collection(name) {
    assert.equal(name, 'store');
    return {
      async findOne(_filter, options) {
        state.reads++;
        assert.equal(options.projection['data.qa'], 1);
        return { data: { qa: structuredClone(state.record) } };
      },
      async findOneAndUpdate(filter, update, options) {
        state.writes++;
        assert.equal(options.returnDocument, 'after');
        assert.equal(filter['data.qa'].$type, 'object');
        assert(!('data.qa' in update.$set), 'never overwrite entire record');
        if (action === 'remove') {
          assert(filter['data.qa.activations'][0].firstSeenAt instanceof Date,
            'activation CAS must compare original BSON Date, never string');
          assert(filter['data.qa.activations'][0].lastSeenAt instanceof Date);
        }
        for (const [field, value] of Object.entries(filter)) {
          if (field === '_id' || field === 'data.qa') continue;
          const name = field.slice('data.qa.'.length);
          if (JSON.stringify(state.record[name]) !== JSON.stringify(value)) return null;
          if (name === 'activations' && state.record[name].length &&
              !(value[0].firstSeenAt instanceof Date)) return null;
        }
        for (const [field, value] of Object.entries(update.$set)) {
          if (field === 'updatedAt') continue;
          state.record[field.slice('data.qa.'.length)] = structuredClone(value);
        }
        return { data: { qa: structuredClone(state.record) } };
      }
    };
  }};
  const keys = {};
  const funcs = makeFunctions(async () => db, clone, () => false, keys, () => state.invalidations++);
  const jsonSnapshot = await funcs.readAdminKeySnapshot('qa', { db });
  assert.equal(typeof jsonSnapshot.activations[0].firstSeenAt, 'string');
  const bsonSnapshot = await funcs.readAdminKeySnapshot('qa', { db, preserveBson: true });
  assert(bsonSnapshot.activations[0].firstSeenAt instanceof Date);
  const saved = await funcs.mutateAdminKeyRecordStrict('qa', draft => {
    if (action === 'remove') {
      draft.phones = draft.phones.filter(p => p !== '222');
      draft.uses = draft.phones.length;
      draft.lastPhone = '111';
      draft.activations = draft.activations.filter(a => a.phone !== '222');
    } else {
      draft.phones = [];
      draft.uses = 0;
      draft.lastPhone = null;
      draft.activations = [];
    }
  }, { db });
  assert.equal(state.writes, 1, 'BSON date CAS should succeed on first attempt');
  assert.deepEqual(saved.phones, action === 'remove' ? ['111'] : []);
  assert.equal(saved.expiresAt, '2027-01-01T00:00:00Z');
  assert.equal(saved.active, true);
  assert.equal(state.invalidations, 1);
  checks++;
}
(async () => {
  await scenario('remove');
  await scenario('all');
  console.log('R46.89 PASS: ' + checks + ' BSON Date device removal regressions');
})().catch(error => { console.error(error); process.exitCode = 1; });
