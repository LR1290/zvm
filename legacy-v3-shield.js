'use strict';

function normalizeLegacyPhone(value) {
  if (!value) return '';
  return String(value).replace(/\D/g, '').slice(0, 20);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = canonicalValue(value[key]);
  return out;
}

function legacyKeyStateSignature(record) {
  const k = record && typeof record === 'object' ? record : {};
  const phones = Array.isArray(k.phones)
    ? k.phones.map(normalizeLegacyPhone).filter(Boolean).sort()
    : [];
  return JSON.stringify(canonicalValue({
    active: k.active !== false,
    expiresAt: k.expiresAt || null,
    expireDuration: k.expireDuration || null,
    activatedAt: k.activatedAt || null,
    isBasicPlan: !!k.isBasicPlan,
    planId: k.plan_id || k.planId || null,
    planName: k.planName || null,
    maxUses: Number.isFinite(k.maxUses) ? k.maxUses : null,
    uses: Number.isFinite(k.uses) ? k.uses : null,
    phones,
    modules: k.modules || null,
    permissions: Array.isArray(k.permissions) ? k.permissions : null,
    segments: Array.isArray(k.segments) ? k.segments : null,
    keyId: k.keyId || null,
    ownerId: k.ownerId || null,
    managerId: k.managerId || null,
    paymentUrl: k.paymentUrl || null,
    marketplace: k.marketplace || null,
    email: k.email || null,
    label: k.label || null,
  }));
}

function legacyReloginCacheKey(input) {
  const row = input || {};
  return [
    String(row.keyCode || '').slice(0, 32),
    normalizeLegacyPhone(row.phone),
    String(row.deviceId || '').slice(0, 80),
    String(row.ip || '').slice(0, 64),
    String(row.wppVersion || '').slice(0, 64),
    String(row.userName || '').slice(0, 120),
  ].join('|');
}

class LegacyV3Shield {
  constructor(options = {}) {
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.checkTtlMs = Math.max(1000, Number(options.checkTtlMs) || 120000);
    this.keyTtlMs = Math.max(1000, Number(options.keyTtlMs) || 1800000);
    this.maxEntries = Math.max(64, Number(options.maxEntries) || 2048);
    this.check = new Map();
    this.key = new Map();
    this.stats = {
      checkHits: 0, checkMisses: 0,
      keyHits: 0, keyMisses: 0, keyBypasses: 0,
      estimatedDbWritesAvoided: 0,
      evictions: 0,
    };
  }

  _get(map, cacheKey, signature, ttlMs, hitField, missField) {
    const now = Number(this.now());
    const row = map.get(cacheKey);
    if (!row || row.signature !== signature || now - row.createdAt >= ttlMs) {
      if (row) map.delete(cacheKey);
      this.stats[missField] += 1;
      return null;
    }
    map.delete(cacheKey);
    map.set(cacheKey, row);
    this.stats[hitField] += 1;
    return row.payload;
  }

  _set(map, cacheKey, signature, payload) {
    const now = Number(this.now());
    map.delete(cacheKey);
    map.set(cacheKey, { signature, payload, createdAt: now });
    while (map.size > this.maxEntries) {
      const first = map.keys().next().value;
      if (first === undefined) break;
      map.delete(first);
      this.stats.evictions += 1;
    }
    return payload;
  }

  getCheck(keyCode, signature) {
    return this._get(this.check, String(keyCode || ''), signature, this.checkTtlMs, 'checkHits', 'checkMisses');
  }

  setCheck(keyCode, signature, payload) {
    return this._set(this.check, String(keyCode || ''), signature, payload);
  }

  getKey(cacheKey, signature) {
    return this._get(this.key, String(cacheKey || ''), signature, this.keyTtlMs, 'keyHits', 'keyMisses');
  }

  setKey(cacheKey, signature, payload) {
    return this._set(this.key, String(cacheKey || ''), signature, payload);
  }

  noteKeyBypass() {
    this.stats.keyBypasses += 1;
  }

  noteDbWritesAvoided(count) {
    this.stats.estimatedDbWritesAvoided += Math.max(0, Number(count) || 0);
  }

  snapshot() {
    return Object.freeze({
      ...this.stats,
      checkEntries: this.check.size,
      keyEntries: this.key.size,
      checkTtlMs: this.checkTtlMs,
      keyTtlMs: this.keyTtlMs,
      maxEntries: this.maxEntries,
    });
  }
}

module.exports = {
  LegacyV3Shield,
  legacyKeyStateSignature,
  legacyReloginCacheKey,
  normalizeLegacyPhone,
};
