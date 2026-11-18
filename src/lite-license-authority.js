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

// The claim is atomically conditioned on product, status, expiry, usage ceiling
// and the LITE key's own stored limit. A stale cache cannot create a phone slot
// for a revoked/expired/malformed licence, nor cause another product to claim it.
const { PRODUCT_LITE, keyBelongsTo } = require('./license-product-v2');
function liteKeyUsable(record, code, nowMs = Date.now()) {
  if (!keyBelongsTo(record,code,PRODUCT_LITE) || record.active !== true ||
      record.provisioningStatus !== 'issued' ||
      !/^LITE_[A-Z0-9_]+$/.test(String(record.planId || '')) ||
      !Number.isSafeInteger(record.maxUses) || record.maxUses < -1 ||
      !Array.isArray(record.phones)) return false;
  if (record.expiresAt != null) {
    const expires = new Date(record.expiresAt).getTime();
    if (!Number.isFinite(expires) || expires <= nowMs) return false;
  }
  return true;
}
async function claimLitePhoneSlotAtomic(db, code, phone, options = {}) {
  const nowMs = options.nowMs === undefined ? Date.now() : Number(options.nowMs);
  const globalLimit = Number(options.maxPhonesGlobal);
  if (!db || typeof db.collection !== 'function' ||
      typeof code !== 'string' || !CODE.test(code) ||
      typeof phone !== 'string' || !/^\d{10,16}$/.test(phone) ||
      !Number.isFinite(nowMs) ||
      !Number.isSafeInteger(globalLimit) || globalLimit < 1 || globalLimit > 10000) {
    throw new TypeError('invalid_lite_phone_claim');
  }
  const read = options.readLiteLicenseSnapshot || readLiteLicenseSnapshot;
  const snapshot = await read(db,code);
  if (!liteKeyUsable(snapshot,code,nowMs)) return {status:'entitlement_revoked',record:snapshot};
  if (snapshot.phones.includes(phone)) return {status:'already_member',record:snapshot};
  if (snapshot.phones.length >= globalLimit ||
      (snapshot.maxUses > 0 && snapshot.phones.length >= snapshot.maxUses)) {
    return {status:'limit_reached',record:snapshot};
  }
  const prefix = 'data.' + code;
  const filter = {
    _id: 'keys',
    [prefix+'.extensionProductId']: PRODUCT_LITE,
    [prefix+'.active']: true,
    [prefix+'.provisioningStatus']: 'issued',
    [prefix+'.planId']: snapshot.planId,
    [prefix+'.maxUses']: snapshot.maxUses,
    [prefix+'.expiresAt']: snapshot.expiresAt == null ? null : snapshot.expiresAt,
    [prefix+'.phones']: {$ne:phone},
    [prefix+'.phones.'+(globalLimit-1)]: {$exists:false},
  };
  if (snapshot.maxUses > 0) filter[prefix+'.phones.'+(snapshot.maxUses-1)] = {$exists:false};
  // Expires-at is locked to the fresh snapshot, so concurrent renewal/expiry
  // changes cannot silently pass this conditional update.
  const updated = await db.collection('store').updateOne(
    filter,
    {$push:{[prefix+'.phones']:phone},$set:{[prefix+'.updatedAt']:new Date(nowMs)}},
    {upsert:false,timeoutMS:7000}
  );
  const latest = await read(db,code);
  if (!liteKeyUsable(latest,code,Date.now())) return {status:'entitlement_revoked',record:latest};
  const confirmed = latest.phones.includes(phone);
  if (updated?.modifiedCount === 1 && confirmed) return {status:'claimed',record:latest};
  if (confirmed) return {status:'already_member',record:latest};
  return {status:'limit_reached',record:latest};
}
// LITE deferred expiry starts only after a real phone claim. The activation
// update requires an active, correctly issued LITE key and that claimed phone.
// A legacy full-product key cannot be activated via this path.
async function activateLiteDeferredKeyAtomic(db, code, phone, options = {}) {
  const nowMs = options.nowMs === undefined ? Date.now() : Number(options.nowMs);
  if (!db || typeof db.collection !== 'function' || !CODE.test(String(code || '')) ||
      typeof phone !== 'string' || !/^\d{10,16}$/.test(phone) ||
      !Number.isSafeInteger(nowMs)) throw new TypeError('invalid_lite_deferred_activation');
  const read = options.readLiteLicenseSnapshot || readLiteLicenseSnapshot;
  const original = await read(db,code);
  if (!liteKeyUsable(original,code,nowMs) || !original.phones.includes(phone)) {
    return {status:'entitlement_revoked',record:original};
  }
  if (original.expiresAt != null) return {status:'already_active',record:original};
  if (!Number.isSafeInteger(original.expireDuration) || original.expireDuration<=0) {
    return {status:'invalid_deferred_duration',record:original};
  }
  const expiresMs = nowMs+original.expireDuration;
  if (!Number.isSafeInteger(expiresMs) || expiresMs>new Date('2100-01-01T00:00:00.000Z').getTime()) {
    return {status:'invalid_deferred_duration',record:original};
  }
  const prefix = 'data.' + code;
  const changed=await db.collection('store').updateOne(
    {_id:'keys',
      [prefix+'.extensionProductId']:PRODUCT_LITE,
      [prefix+'.active']:true,
      [prefix+'.provisioningStatus']:'issued',
      [prefix+'.planId']:original.planId,
      [prefix+'.maxUses']:original.maxUses,
      [prefix+'.phones']:phone,
      [prefix+'.expireDuration']:original.expireDuration,
      [prefix+'.expiresAt']:null},
    {$set:{
      [prefix+'.expiresAt']:new Date(expiresMs).toISOString(),
      [prefix+'.activatedAt']:new Date(nowMs).toISOString(),
      updatedAt:new Date(nowMs),
    }},
    {upsert:false,timeoutMS:7000}
  );
  const latest=await read(db,code);
  if (!liteKeyUsable(latest,code,Date.now()) || !latest.phones.includes(phone)) {
    return {status:'entitlement_revoked',record:latest};
  }
  if (latest.expiresAt==null) return {status:'activation_conflict',record:latest};
  return {status:changed?.modifiedCount===1?'activated':'already_active',record:latest};
}
module.exports = Object.freeze({ readLiteLicenseSnapshot, liteKeyUsable, claimLitePhoneSlotAtomic, activateLiteDeferredKeyAtomic });
