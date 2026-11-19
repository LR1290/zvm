'use strict';
// R87: production database cutover guard. NO writes or secrets in diagnostics.
// "zvm" is never implicitly trusted merely because MONGODB_DB was changed.
const TARGET = 'zvm';
const ACK = 'zapvoice-to-zvm-verified';
const REQUIRED = Object.freeze([
  'store', 'portal_users', 'payments', 'extension_sessions',
  'webhook_events', 'cakto_mail_outbox'
]);
function databaseSelected(env = {}) {
  return String(env.MONGODB_DB || '').trim().toLowerCase() === TARGET;
}
async function assertZvmCutoverReady(db, env = {}) {
  if (!databaseSelected(env)) return Object.freeze({ database: 'legacy_or_other', gated: false });
  if (String(env.ZVM_DB_CUTOVER_CONFIRMED || '').trim() !== ACK) {
    throw new Error('ZVM_DB_CUTOVER_NOT_CONFIRMED');
  }
  if (!db || typeof db.listCollections !== 'function' || typeof db.collection !== 'function') {
    throw new Error('ZVM_DB_CUTOVER_DB_UNAVAILABLE');
  }
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const available = new Set(collections.map(row => row.name));
  if (REQUIRED.some(name => !available.has(name))) {
    throw new Error('ZVM_DB_CUTOVER_MISSING_COLLECTIONS');
  }
  const [doc, accounts, payments] = await Promise.all([
    db.collection('store').findOne({ _id: 'keys' }, { projection: { data: 1 } }),
    db.collection('portal_users').countDocuments({}),
    db.collection('payments').countDocuments({})
  ]);
  const data = doc && doc.data && typeof doc.data === 'object' && !Array.isArray(doc.data) ? doc.data : null;
  const keyCount = data ? Object.keys(data).filter(code => /^zv-(?:[a-z0-9]{5}-){2}[a-z0-9]{5}$|^zv2a-[a-z2-7]{52}$/.test(code)).length : 0;
  if (keyCount < 1 || !Number.isSafeInteger(accounts) || accounts < 1 ||
      !Number.isSafeInteger(payments) || payments < 1) {
    throw new Error('ZVM_DB_CUTOVER_REQUIRED_RECORDS_MISSING');
  }
  return Object.freeze({ database: TARGET, gated: true, keys: keyCount, accounts, payments });
}
module.exports = { TARGET, ACK, REQUIRED, databaseSelected, assertZvmCutoverReady };
