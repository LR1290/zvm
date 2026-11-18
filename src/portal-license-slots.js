'use strict';
// Keep the complete ZVM account binding stable while giving LITE its own slot.
// This is used only for account registration, linking and extension login.
const { PRODUCT_AUTOMACOES, PRODUCT_LITE, productOfKeyRecord } = require('./license-product-v2');

function normalizePortalLicenseKey(raw) {
  if (typeof raw !== 'string') return '';
  const code = raw.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(code)) return '';
  // Never silently truncate, strip characters or treat a malformed V2 key as legacy.
  if (/^zv2[al]-/.test(code) && !/^zv2[al]-[a-z2-7]{52}$/.test(code)) return '';
  return code;
}

function portalLicenseSlot(record, code) {
  const product = productOfKeyRecord(record, code);
  if (product === PRODUCT_LITE && /^zv2l-[a-z2-7]{52}$/.test(code)) return 'liteKeyCode';
  if (product === PRODUCT_AUTOMACOES) return 'keyCode';
  return null;
}

function linkedPortalKeyForProduct(user, productId) {
  if (!user || typeof user !== 'object') return '';
  if (productId === PRODUCT_LITE) return normalizePortalLicenseKey(user.liteKeyCode);
  if (productId === PRODUCT_AUTOMACOES) return normalizePortalLicenseKey(user.keyCode);
  return '';
}

// On account-side unlink/relink, invalidate only password sessions of ZVM LITE.
// A direct key-based session is controlled by the key owner, not the portal link.
// MongoDB is authoritative; errors propagate and are never reported as success.
async function revokePortalLitePasswordSessions(db, rawEmail, options = {}) {
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120 ||
      !db || typeof db.collection !== 'function') throw new TypeError('invalid_lite_portal_revoke');
  const collectionName = options.collectionName;
  if (typeof collectionName !== 'string' || !/^[a-zA-Z0-9_]{1,80}$/.test(collectionName)) {
    throw new TypeError('invalid_lite_session_collection');
  }
  const now = options.now === undefined ? new Date() : new Date(options.now);
  if (!Number.isFinite(now.getTime())) throw new TypeError('invalid_lite_revoke_time');
  return db.collection(collectionName).updateMany(
    { accountEmail: email, extensionProductId: PRODUCT_LITE, authMethod: 'password', revokedAt: null },
    { $set: { revokedAt: now, lastSeenAt: now } }
  );
}

function portalLicenseConflictQuery(code, exceptEmail = '') {
  const normalized = normalizePortalLicenseKey(code);
  if (!normalized) throw new TypeError('invalid_portal_license_key');
  return {
    ...(exceptEmail ? { _id: { $ne: String(exceptEmail).toLowerCase() } } : {}),
    $or: [{ keyCode: normalized }, { liteKeyCode: normalized }],
  };
}

module.exports = Object.freeze({
  normalizePortalLicenseKey,
  portalLicenseSlot,
  linkedPortalKeyForProduct,
  portalLicenseConflictQuery,
  revokePortalLitePasswordSessions,
});
