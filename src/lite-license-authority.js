'use strict';
// LITE authentication never uses the legacy in-process key cache as authority.
// This reader returns one detached, persisted key record or null. It does not
// create/activate anything or mutate the complete ZVM product.
const CODE = /^zv2l-[a-z2-7]{52}$/;
async function readLiteLicenseSnapshot(db, code) {
  if (typeof code !== 'string' || !CODE.test(code)) return null;
  if (!db || typeof db.collection !== 'function') throw new TypeError('lite_license_database_required');
  const doc = await db.collection('store').findOne(
    { _id: 'keys' },
    { projection: { ['data.' + code]: 1, _id: 0 }, timeoutMS: 7000 }
  );
  const record = doc && doc.data && Object.prototype.hasOwnProperty.call(doc.data,code)
    ? doc.data[code] : null;
  return record && typeof record === 'object' && !Array.isArray(record) ? record : null;
}
module.exports = Object.freeze({ readLiteLicenseSnapshot });
