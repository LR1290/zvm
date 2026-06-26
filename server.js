'use strict';
const http       = require('http');
const https      = require('https');
const crypto     = require('crypto');
const zlib       = require('zlib');
const { MongoClient } = require('mongodb');

const PORT         = parseInt(process.env.PORT || '3000', 10);
const MONGODB_URI  = process.env.MONGODB_URI || '';
const APP_SECRET   = process.env.APP_SECRET || '';
const WEBHOOK_URL  = process.env.WEBHOOK_URL || '';

const ZVM_ADMIN_USER  = process.env.ZVM_ADMIN_USER  || process.env.ADMIN_USER || 'admin';
const ZVM_ADMIN_PASS  = process.env.ZVM_ADMIN_PASS  || process.env.ADMIN_PASS || '';
const ZVM_TOTP_SECRET = process.env.ZVM_TOTP_SECRET || process.env.TOTP_SECRET || '';
const ZVM_ANALYTICS_PASS = process.env.ZVM_ANALYTICS_PASS || process.env.ANALYTICS_PASS || '';
const ZVM_PAYT_SECRET    = process.env.ZVM_PAYT_SECRET    || process.env.PAYT_SECRET    || '';
const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || '30', 10);
const LOG_MAX            = parseInt(process.env.LOG_MAX || '1000', 10);
const MAX_USES           = parseInt(process.env.MAX_USES || '3', 10);

const WS_DB_NAME       = process.env.WS_DB_NAME    || 'waspeed';
const WS_CHROME_ID     = process.env.CHROME_STORE_ID || '';
const WS_BASE_URL      = process.env.BASE_URL       || `http://localhost:${PORT}`;
const WS_PUBLIC_URL    = process.env.PUBLIC_URL     || WS_BASE_URL;
const WS_ACCESS_TOKEN  = process.env.ACCESS_TOKEN   || '';
const WS_WL_ID         = process.env.WL_ID          || 'waspeed';
const WS_COOKIE_NAME   = process.env.COOKIE_NAME    || 'ws_sess';
const WS_BASE_PATH     = (process.env.WS_BASE_PATH  || '/wspeed').replace(/\/+$/, '');
const ANTI_SLEEP_MS    = 5 * 60 * 1000;
const SESSION_TTL_MS   = 8 * 60 * 60 * 1000;

const COL = { settings: 'settings', licenses: 'licenses', logs: 'logs', sessions: 'sessions' };
const LOG_LEVELS = { DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', CRITICAL: 'CRITICAL' };

const FULL_PERMISSIONS = ['create_flow','massive_dispatching','schedule_item','send_flow','send_funnel','send_trigger','zapsaver'];
const USAGE_ITEM_TYPES = ['audio','document','media','message','flow','funnel','bulkMessages','scheduleItem'];
const FREE_AUTH_KEY    = 'free';
const FREE_PLAN_ID     = 'ZV_FREE';
const FREE_OWNER_ID    = '6a6d6a86-6bc6-4359-ad49-05639915e368';
const AVAILABLE_MODULES = ['zapSaver','massiveDispatching','scheduler','funnels','flows','crm'];
const DEFAULT_MODULES   = { zapSaver: true, massiveDispatching: true, scheduler: true, funnels: true, flows: true, crm: true };

const USAGE_LIMITS = {
  free:    { audio:5, document:5, media:5, message:200, flow:3, funnel:3, bulkMessages:1, scheduleItem:10 },
  pro:     { audio:9999, document:9999, media:9999, message:9999, flow:9999, funnel:9999, bulkMessages:9999, scheduleItem:9999 },
};

function deriveSlug(seed) {
  if (!APP_SECRET) return null;
  return crypto.createHmac('sha256', APP_SECRET).update(seed).digest('hex').slice(0, 14);
}
const _slugAdmin     = deriveSlug('admin-panel');
const _slugMod       = deriveSlug('mod-panel');
const _slugAnalytics = deriveSlug('analytics-panel');
const R_ZVM_ADMIN    = _slugAdmin     ? '/' + _slugAdmin     : '/zvm-admin';
const R_ZVM_MOD      = _slugMod       ? '/' + _slugMod       : '/zvm-mod';
const R_ANALYTICS    = _slugAnalytics ? '/' + _slugAnalytics : '/analytics';
const R_EXT          = '/extension';

const _wsAdminSlug = deriveSlug('ws-admin-panel');
const _wsModSlug   = deriveSlug('ws-mod-panel');
const R_WS_ADMIN   = _wsAdminSlug ? '/' + _wsAdminSlug : '/admin';
const R_WS_MOD     = _wsModSlug   ? '/' + _wsModSlug   : '/mod';

const MODS = (function() {
  const out = [];
  for (let i = 1; i <= 10; i++) {
    const u = process.env[`MOD${i}_USER`], p = process.env[`MOD${i}_PASS`], t = process.env[`MOD${i}_TOTP`], n = process.env[`MOD${i}_NAME`];
    if (u && p) out.push({ user: u, pass: p, totp: t || '', name: n || u });
  }
  const u0 = process.env.MOD_USER, p0 = process.env.MOD_PASS;
  if (u0 && p0 && !out.length) out.push({ user: u0, pass: p0, totp: process.env.MOD_TOTP || '', name: process.env.MOD_NAME || u0 });
  return out;
})();

let _mongoClient = null;
let dbZVM        = null;
let dbWS         = null;
let mongoReady   = false;
let server       = null;

let cbFailCount  = 0;
let cbOpenUntil  = 0;
const CB_THRESHOLD = 5;
const CB_RESET_MS  = 60000;
function cbIsOpen() { return Date.now() < cbOpenUntil; }
function cbRecord(ok) {
  if (ok) { cbFailCount = 0; return; }
  cbFailCount++;
  if (cbFailCount >= CB_THRESHOLD) { cbOpenUntil = Date.now() + CB_RESET_MS; cbFailCount = 0; }
}

async function getMongoDb() {
  if (!_mongoClient) {
    _mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 10, serverSelectionTimeoutMS: 5000 });
    await _mongoClient.connect();
    dbZVM = _mongoClient.db('zapvoice');
    dbWS  = _mongoClient.db(WS_DB_NAME);
  }
  return dbZVM;
}

let keys = {};
let logs = [];

const _saveDebounce = new Map();
function saveKey(code) {
  if (_saveDebounce.has(code)) clearTimeout(_saveDebounce.get(code));
  const tid = setTimeout(async () => {
    _saveDebounce.delete(code);
    if (keys[code] === undefined) return;
    try {
      const db = await getMongoDb();
      await db.collection('store').updateOne(
        { _id: 'keys' },
        { $set: { [`data.${code}`]: keys[code], updatedAt: new Date() } },
        { upsert: true }
      );
    } catch (e) { console.error('[ZVM-DB] saveKey:', e.message); }
  }, 2000);
  _saveDebounce.set(code, tid);
  invalidateZvmKeysCache();
  return Promise.resolve();
}

async function deleteKeyFromDb(code) {
  try {
    const db = await getMongoDb();
    await db.collection('store').updateOne(
      { _id: 'keys' },
      { $unset: { [`data.${code}`]: '' }, $set: { updatedAt: new Date() } }
    );
  } catch (e) { console.error('[ZVM-DB] deleteKey:', e.message); }
}

async function saveLogs() {
  try {
    const db = await getMongoDb();
    const recent = logs.slice(-LOG_MAX);
    await db.collection('store').updateOne(
      { _id: 'logs' },
      { $set: { data: recent, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (e) { console.error('[ZVM-DB] saveLogs:', e.message); }
}

async function loadDb() {
  try {
    const db = await getMongoDb();
    const [kDoc, lDoc] = await Promise.all([
      db.collection('store').findOne({ _id: 'keys' }),
      db.collection('store').findOne({ _id: 'logs' }),
    ]);
    return {
      keys: (kDoc && kDoc.data) ? kDoc.data : {},
      logs: (lDoc && lDoc.data) ? lDoc.data : [],
    };
  } catch (e) { console.error('[ZVM-DB] loadDb:', e.message); return { keys: {}, logs: [] }; }
}

async function savePayment(rec) {
  try {
    const db = await getMongoDb();
    await db.collection('payments').updateOne({ txId: rec.txId }, { $set: rec }, { upsert: true });
  } catch (e) { console.warn('[ZVM-DB] savePayment:', e.message); }
}

async function getPayments({ limit = 500 } = {}) {
  try {
    const db = await getMongoDb();
    return await db.collection('payments').find({ approved: true }).sort({ paidAt: -1 }).limit(limit).toArray();
  } catch { return []; }
}

function base32Decode(s) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = (s || '').toUpperCase().replace(/=+$/, '');
  let bits = 0, val = 0;
  const out = [];
  for (const ch of clean) {
    const idx = alpha.indexOf(ch);
    if (idx < 0) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) { bits -= 8; out.push((val >> bits) & 0xff); }
  }
  return Buffer.from(out);
}

function generateTOTP(secret, timeStep) {
  const key   = base32Decode(secret);
  const t     = timeStep !== undefined ? timeStep : Math.floor(Date.now() / 30000);
  const msg   = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(t / 0x100000000), 0);
  msg.writeUInt32BE(t >>> 0, 4);
  const hmac  = crypto.createHmac('sha1', key).update(msg).digest();
  const off   = hmac[hmac.length - 1] & 0xf;
  const code  = ((hmac[off] & 0x7f) << 24) | (hmac[off+1] << 16) | (hmac[off+2] << 8) | hmac[off+3];
  return String(code % 1000000).padStart(6, '0');
}

function verifyTOTP(secret, token) {
  if (!secret) return true;
  if (!token) return false;
  const t = Math.floor(Date.now() / 30000);
  for (let d = -2; d <= 2; d++) {
    if (generateTOTP(secret, t + d) === String(token).trim()) return true;
  }
  return false;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(32).toString('hex');
  const dk   = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return `pbkdf2:sha512:120000:${salt}:${dk}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('pbkdf2:')) return false;
  const [, , iter, salt, dk] = stored.split(':');
  const expected = crypto.pbkdf2Sync(password, salt, parseInt(iter, 10), 64, 'sha512').toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(dk, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
}

const NOSQL_OP_RE = /(\$where|\$regex|\$ne|\$gt|\$lt|\$gte|\$lte|\$in|\$nin|\$or|\$and|\$not|\$nor|\$exists|\$type|\$expr|\$jsonSchema|\$mod|\$text|\$search|\$elemMatch|\$size|\$all|\$slice|\$addFields|\$project|\$group|\$lookup|\$unwind|\$replaceRoot|\$redact|\$bucket|\$facet)/i;

function sanitizeString(v) {
  if (typeof v !== 'string') return '';
  return v.replace(NOSQL_OP_RE, '').trim();
}

function sanitizeInput(v, maxLen) {
  if (typeof v !== 'string') return '';
  let s = v.slice(0, maxLen || 500);
  if (NOSQL_OP_RE.test(s)) return '';
  return s.trim();
}

function sanitizeObject(obj, depth) {
  if (!obj || typeof obj !== 'object' || depth > 5) return obj;
  for (const k of Object.keys(obj)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') { delete obj[k]; continue; }
    if (typeof obj[k] === 'string') {
      obj[k] = obj[k].replace(NOSQL_OP_RE, '');
    } else if (typeof obj[k] === 'object' && obj[k] !== null) {
      sanitizeObject(obj[k], (depth || 0) + 1);
    }
  }
  return obj;
}

function detectInjection(v) {
  if (typeof v !== 'string') return false;
  return NOSQL_OP_RE.test(v);
}

function sanitizeKeyRecord(k) {
  if (!k || typeof k !== 'object') return;
  for (const bad of ['__proto__', 'constructor', 'prototype']) delete k[bad];
  if (k.label && typeof k.label === 'string') k.label = sanitizeString(k.label).slice(0, 60);
  if (!Array.isArray(k.phones)) k.phones = [];
  if (typeof k.uses    !== 'number') k.uses    = 0;
  if (typeof k.active  !== 'boolean') k.active = true;
}

const _rlMap = new Map();
const RL_CONFIG = {
  login:        { max: 5,  windowMs: 60000,  blockMs: 600000 },
  api:          { max: 30, windowMs: 60000,  blockMs: 120000 },
  ext_key:      { max: 20, windowMs: 60000,  blockMs: 120000 },
  check_status: { max: 60, windowMs: 60000,  blockMs: 60000  },
};

function checkRateLimit(ip, type) {
  const cfg = RL_CONFIG[type] || RL_CONFIG.api;
  const key = ip + ':' + type;
  const now = Date.now();
  let r = _rlMap.get(key);
  if (!r) { r = { count: 0, windowStart: now, blockedUntil: 0 }; _rlMap.set(key, r); }
  if (r.blockedUntil && now < r.blockedUntil) return false;
  if (now - r.windowStart > cfg.windowMs) { r.count = 0; r.windowStart = now; }
  r.count++;
  if (r.count > cfg.max) { r.blockedUntil = now + cfg.blockMs; return false; }
  return true;
}

function getRateLimitWait(ip, type) {
  const key = ip + ':' + type;
  const r   = _rlMap.get(key);
  if (!r || !r.blockedUntil) return 1;
  return Math.ceil((r.blockedUntil - Date.now()) / 60000);
}

function checkRate(ip, action) {
  return checkRateLimit(ip, action || 'login');
}

setInterval(() => {
  const now = Date.now();
  for (const [k, r] of _rlMap) {
    if (now - r.windowStart > 3600000 && (!r.blockedUntil || now > r.blockedUntil)) _rlMap.delete(k);
  }
}, 300000);

setInterval(() => {
  const now = new Date();
  for (const t of Object.keys(ZVM_SESSIONS))    { if (new Date(ZVM_SESSIONS[t].expiresAt)    <= now) delete ZVM_SESSIONS[t]; }
  for (const t of Object.keys(ZVM_MOD_SESSIONS)){ if (new Date(ZVM_MOD_SESSIONS[t].expiresAt) <= now) delete ZVM_MOD_SESSIONS[t]; }
  for (const t of Object.keys(ZVM_AN_SESSIONS)) { if (new Date(ZVM_AN_SESSIONS[t].expiresAt)  <= now) delete ZVM_AN_SESSIONS[t]; }
}, 600000);

const ZVM_SESSIONS       = {};
const ZVM_MOD_SESSIONS   = {};
const ZVM_AN_SESSIONS    = {};

function generateToken() { return crypto.randomBytes(32).toString('hex'); }
function generateCode()  { const r = () => crypto.randomBytes(3).toString('hex').slice(0,5); return `zv-${r()}-${r()}-${r()}`; }

function isAdminSession(req) {
  const m = (req.headers.cookie || '').match(/zv_admin=([a-f0-9]+)/);
  if (!m) return false;
  const s = ZVM_SESSIONS[m[1]];
  return s && new Date(s.expiresAt) > new Date();
}
function isModSession(req) {
  const m = (req.headers.cookie || '').match(/zv_mod=([a-f0-9]+)/);
  if (!m) return false;
  const s = ZVM_MOD_SESSIONS[m[1]];
  return s && new Date(s.expiresAt) > new Date();
}
function isAnalyticsSession(req) {
  const m = (req.headers.cookie || '').match(/zv_an=([a-f0-9]+)/);
  if (!m) return false;
  const s = ZVM_AN_SESSIONS[m[1]];
  return s && new Date(s.expiresAt) > new Date();
}
function clearAnalyticsCookie(res) {
  res.setHeader('Set-Cookie', 'zv_an=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict; Secure');
}

function isKeyExpiredZvm(k) {
  if (!k.expiresAt) return false;
  return new Date(k.expiresAt) < new Date();
}

function hoursUntilExpiry(k) {
  if (!k.expiresAt) return null;
  const ms = new Date(k.expiresAt) - Date.now();
  return ms > 0 ? Math.floor(ms / 3600000) : 0;
}

function daysUntilExpiry(k) {
  if (!k.expiresAt) return null;
  const ms = new Date(k.expiresAt) - Date.now();
  return ms > 0 ? Math.floor(ms / 86400000) : 0;
}

function getKeyExpiryMeta(k) {
  if (!k.expiresAt) return { expired: false, expiringSoon: false, hoursLeft: null, daysLeft: null };
  const ms = new Date(k.expiresAt) - Date.now();
  const expired = ms <= 0;
  return {
    expired,
    expiringSoon: !expired && ms < 72 * 3600000,
    hoursLeft:    expired ? 0 : Math.floor(ms / 3600000),
    daysLeft:     expired ? 0 : Math.floor(ms / 86400000),
  };
}

function getKeyDisplayStatus(k) {
  if (!k.active) return 'bloqueado';
  if (isKeyExpiredZvm(k)) return 'expirada';
  if (k.expireDuration && !k.expiresAt) return 'pendente';
  return 'ativo';
}

function parseKeyExpiryFromBody(body, opts) {
  const days  = parseInt(body.expireDays    || body.days  || 0);
  const hours = parseInt(body.expireHours   || body.hours || 0);
  const mins  = (opts && opts.allowMinutes) ? parseInt(body.expireMinutes || body.mins || 0) : 0;
  const ms    = ((days * 1440) + (hours * 60) + mins) * 60000;
  if (!ms) return { expiresAt: null, expireDuration: null };
  if (body.ativarNoPrimeiroUso || body.firstUse) return { expiresAt: null, expireDuration: ms };
  return { expiresAt: new Date(Date.now() + ms).toISOString(), expireDuration: ms };
}

async function ensureKeyLoaded(code) {
  if (keys[code] !== undefined) return true;
  try {
    const db  = await getMongoDb();
    const doc = await db.collection('store').findOne({ _id: 'keys' });
    if (doc && doc.data && doc.data[code]) {
      keys[code] = doc.data[code];
      sanitizeKeyRecord(keys[code]);
      return true;
    }
  } catch {}
  return false;
}

async function adminGetKey(code) {
  if (keys[code]) return keys[code];
  if (await ensureKeyLoaded(code)) return keys[code];
  return null;
}

function resolvePhoneToRemove(phones, { phoneIdx, phoneTxt }) {
  if (phoneTxt) return phones.find(p => p === phoneTxt) || null;
  if (phoneIdx >= 0 && phoneIdx < phones.length) return phones[phoneIdx];
  return null;
}

function removePhoneFromKey(k, phone) {
  k.phones = (k.phones || []).filter(p => p !== phone);
  if (k.lastPhone === phone) k.lastPhone = k.phones[k.phones.length - 1] || null;
}

function clearAllPhonesFromKey(k) {
  k.phones   = [];
  k.lastPhone = null;
  k.uses      = 0;
}

function isFreeAuthKey(k) { return !k || k === FREE_AUTH_KEY; }
function isFreePlanId(pid) { return pid === FREE_PLAN_ID; }
function isPaidPlan(pid)   { return pid && pid !== FREE_PLAN_ID; }

function normalizeProUsage(usage) {
  const out = {};
  for (const t of USAGE_ITEM_TYPES) out[t] = { used: 0, limit: 9999, blocked: false, ...(usage && usage[t] ? usage[t] : {}) };
  return out;
}

function unlimitedUsagePayload() {
  const out = {};
  for (const t of USAGE_ITEM_TYPES) out[t] = { used: 0, limit: 9999, blocked: false };
  return out;
}

function usageTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function ensureKeyUsage(code, k) {
  if (!k.usage) k.usage = {};
  const today = usageTodayKey();
  if (!k.usage[today]) k.usage[today] = {};
  for (const t of USAGE_ITEM_TYPES) {
    if (!k.usage[today][t]) k.usage[today][t] = { used: 0 };
  }
  return k.usage[today];
}

async function ensureFreeUsage(ip) {
  try {
    const db  = await getMongoDb();
    const today = usageTodayKey();
    const rec   = await db.collection('free_usage').findOneAndUpdate(
      { _id: ip + ':' + today },
      { $setOnInsert: { _id: ip + ':' + today, date: today, ip } },
      { upsert: true, returnDocument: 'after' }
    );
    const doc = rec.value || rec;
    const usage = {};
    const lim   = USAGE_LIMITS.free;
    for (const t of USAGE_ITEM_TYPES) {
      const used = (doc && doc[t]) ? doc[t] : 0;
      usage[t] = { used, limit: lim[t], blocked: used >= lim[t] };
    }
    return usage;
  } catch { return unlimitedUsagePayload(); }
}

function buildUsagePayload(todayUsage, k) {
  const isPro = k && k.active && !isKeyExpiredZvm(k);
  const lim   = isPro ? USAGE_LIMITS.pro : USAGE_LIMITS.free;
  const out   = {};
  for (const t of USAGE_ITEM_TYPES) {
    const used = todayUsage && todayUsage[t] ? todayUsage[t].used : 0;
    out[t] = { used, limit: lim[t], blocked: used >= lim[t] };
  }
  return out;
}

async function incrementUsageRow(code, k, itemType, qty) {
  const day = usageTodayKey();
  if (!k.usage) k.usage = {};
  if (!k.usage[day]) k.usage[day] = {};
  if (!k.usage[day][itemType]) k.usage[day][itemType] = { used: 0 };
  k.usage[day][itemType].used += (qty || 1);
  saveKey(code);
}

function resolveUsageKey(code, k) {
  return isFreeAuthKey(code) ? null : code;
}

async function findKeyCodeByPhone(phone) {
  for (const [code, k] of Object.entries(keys)) {
    if ((k.phones || []).includes(phone)) return code;
  }
  try {
    const db  = await getMongoDb();
    const doc = await db.collection('store').findOne({ _id: 'keys' });
    if (doc && doc.data) {
      for (const [code, k] of Object.entries(doc.data)) {
        if ((k.phones || []).includes(phone)) { keys[code] = k; return code; }
      }
    }
  } catch {}
  return null;
}

async function findKeyCodeByManager(manager) {
  for (const [code, k] of Object.entries(keys)) {
    if (k.manager === manager) return code;
  }
  return null;
}

function getFreeAuthData(ip, usage) {
  return {
    ok: true, status: true,
    data: {
      keyId: FREE_AUTH_KEY,
      planId: FREE_PLAN_ID,
      ownerId: FREE_OWNER_ID,
      plan: 'free',
      active: true,
      permissions: [],
      usage: usage || unlimitedUsagePayload(),
      expiresAt: null,
      hoursLeft: null,
    },
  };
}

function getAuthData(code, k, usage) {
  const expMeta = getKeyExpiryMeta(k);
  return {
    ok: true, status: true,
    data: {
      keyId:       code,
      planId:      'ZV_PRO',
      ownerId:     k.ownerId || code,
      plan:        'pro',
      active:      k.active && !expMeta.expired,
      permissions: FULL_PERMISSIONS,
      modules:     k.modules || DEFAULT_MODULES,
      usage:       usage || buildUsagePayload(null, k),
      expiresAt:   k.expiresAt || null,
      hoursLeft:   expMeta.hoursLeft,
      daysLeft:    expMeta.daysLeft,
      expiringSoon: expMeta.expiringSoon,
    },
  };
}

async function fireWebhook(event, code, detail) {
  if (!WEBHOOK_URL) return;
  try {
    const body = JSON.stringify({ event, code, detail, ts: new Date().toISOString() });
    const u    = new URL(WEBHOOK_URL);
    const mod  = WEBHOOK_URL.startsWith('https') ? https : http;
    const r    = mod.request({ hostname: u.hostname, port: u.port || (WEBHOOK_URL.startsWith('https') ? 443 : 80), path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => { res.resume(); });
    r.on('error', () => {});
    r.setTimeout(5000, () => r.destroy());
    r.write(body); r.end();
  } catch {}
}

const DEDUP_WINDOWS = { relogin_ok: 86400000, expired: 300000, login_blocked: 300000, warn_limit: 600000 };
const _dedupMap = new Map();

async function addLogZvm({ keyCode, label, phone, ip, wppVersion, action, detail }) {
  const now   = Date.now();
  const dedupKey = action + ':' + (keyCode || '') + ':' + (phone || '');
  const win      = DEDUP_WINDOWS[action];
  if (win) {
    const last = _dedupMap.get(dedupKey);
    if (last && now - last < win) return;
    _dedupMap.set(dedupKey, now);
  }
  const entry = {
    timestamp:  new Date().toISOString(),
    keyCode:    keyCode  || '',
    label:      label    || '',
    phone:      phone    || '',
    ip:         ip       || '',
    wppVersion: wppVersion || '',
    action:     action   || '',
    detail:     detail   || '',
  };
  logs.unshift(entry);
  if (logs.length > LOG_MAX) logs = logs.slice(0, LOG_MAX);
  const cutoff = new Date(now - LOG_RETENTION_DAYS * 86400000).toISOString();
  logs = logs.filter(l => l.timestamp > cutoff);
  saveLogs().catch(() => {});
}

function buildLogsHtml(list) {
  const src = list || logs;
  if (!src.length) return '<tr><td colspan="6" style="padding:18px;text-align:center;color:#5a8a6e">Nenhum log</td></tr>';
  return src.slice(0, 400).map(l => {
    const action = l.action || '';
    const isOk   = action.includes('ok') || action.includes('renewed');
    const isWarn = action.includes('warn') || action.includes('blocked') || action.includes('expired');
    const col    = isOk ? '#39ff14' : isWarn ? '#ff8899' : '#8ab89a';
    return `<tr>
      <td class="zvm-td" style="font-size:.72rem;color:#5a8a6e">${esc(l.timestamp ? l.timestamp.slice(0,19).replace('T',' ') : '')}</td>
      <td class="zvm-td"><span style="font-family:monospace;font-size:.72rem;font-weight:700;color:${col};background:${col}15;border:1px solid ${col}28;padding:2px 8px;border-radius:4px">${esc(action.toUpperCase())}</span></td>
      <td class="zvm-td zvm-muted" style="font-size:.78rem">${esc(l.keyCode)}</td>
      <td class="zvm-td zvm-muted" style="font-size:.78rem">${esc(l.phone)}</td>
      <td class="zvm-td zvm-muted" style="font-size:.78rem">${esc(l.ip)}</td>
      <td class="zvm-td zvm-muted" style="font-size:.75rem">${esc(l.detail || l.wppVersion || '')}</td>
    </tr>`;
  }).join('');
}

let _zvmKeysHtmlCache = null;
function invalidateZvmKeysCache() { _zvmKeysHtmlCache = null; }
function getKeysHtmlCached() {
  if (_zvmKeysHtmlCache) return _zvmKeysHtmlCache;
  _zvmKeysHtmlCache = buildZvmKeysHtml();
  return _zvmKeysHtmlCache;
}

function getZvmKeyStats() {
  const all = Object.values(keys);
  return {
    totalKeys:   all.length,
    activeKeys:  all.filter(k => k.active && !isKeyExpiredZvm(k) && !(k.expireDuration && !k.expiresAt)).length,
    expiredKeys: all.filter(k => isKeyExpiredZvm(k)).length,
    pendingKeys: all.filter(k => k.expireDuration && !k.expiresAt).length,
    blockedKeys: all.filter(k => !k.active).length,
  };
}

function buildZvmKeysHtml() {
  const entries = Object.entries(keys).sort((a, b) => (b[1].createdAt || '').localeCompare(a[1].createdAt || ''));
  if (!entries.length) return '<tr><td colspan="9" style="padding:18px;text-align:center;color:#5a8a6e">Nenhuma chave</td></tr>';
  return entries.map(([code, k]) => {
    const st    = getKeyDisplayStatus(k);
    const col   = st === 'ativo' ? '#39ff14' : st === 'pendente' ? '#ffcc00' : '#ff8899';
    const exp   = k.expiresAt ? k.expiresAt.slice(0,10) : (k.expireDuration ? 'Ao 1º uso' : '∞');
    const mu    = k.maxUses === -1 ? '∞' : (k.maxUses > 0 ? k.maxUses : MAX_USES);
    const safe  = code.split('"').join('&quot;');
    const slbl  = (k.label||'').split('"').join('&quot;').split('&').join('&amp;').split('<').join('&lt;');
    const snote = (k.note||'').split('"').join('&quot;').split('&').join('&amp;').split('<').join('&lt;');
    return `<tr data-code="${safe}" data-label="${slbl}" data-phone="${(k.lastPhone||'')}" data-status="${st}">
      <td class="zvm-td"><code style="font-size:.72rem">${esc(code)}</code></td>
      <td class="zvm-td" style="font-size:.8rem">${esc(k.label||'')}</td>
      <td class="zvm-td"><span style="font-size:.7rem;font-weight:700;color:${col};background:${col}15;border:1px solid ${col}28;padding:2px 8px;border-radius:4px">${st.toUpperCase()}</span></td>
      <td class="zvm-td" style="font-size:.75rem">${esc(exp)}</td>
      <td class="zvm-td" style="font-size:.78rem">${(k.phones||[]).length}/${mu}</td>
      <td class="zvm-td zvm-muted" style="font-size:.75rem">${esc(k.lastPhone||'')}</td>
      <td class="zvm-td zvm-muted" style="font-size:.75rem">${esc(k.lastIp||'')}</td>
      <td class="zvm-td zvm-muted" style="font-size:.73rem">${esc(k.note||'')}</td>
      <td class="zvm-td">
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="zvm-btn" onclick="toggleKey('${safe}')">${k.active?'Bloquear':'Ativar'}</button>
          <button class="zvm-btn" onclick="openRenew('${safe}')">Renovar</button>
          <button class="zvm-btn" onclick="openMaxUses('${safe}',${k.maxUses != null ? k.maxUses : MAX_USES})">Usos</button>
          <button class="zvm-btn" onclick="openNote('${safe}','${snote}')">Nota</button>
          <button class="zvm-btn" onclick="openLabel('${safe}','${slbl}')">Renomear</button>
          <button class="zvm-btn zvm-btn-del" onclick="deleteKey('${safe}')">×</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}


async function getPaymentStats() {
  try {
    const db = await getMongoDb();
    const payments = await db.collection('payments').find({ approved: true }).toArray();
    const totalRev = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const byProduct = {};
    const byDay     = {};
    const byHour    = new Array(24).fill(0);
    const byMethod  = {};
    for (const p of payments) {
      const prod = p.productName || 'Outros';
      byProduct[prod] = (byProduct[prod] || 0) + (p.amount || 0);
      const day = (p.paidAt || '').slice(0, 10);
      if (day) byDay[day] = (byDay[day] || 0) + (p.amount || 0);
      const h = new Date(p.paidAt).getHours();
      if (!isNaN(h)) byHour[h] += p.amount || 0;
      const meth = p.paymentMethod || 'outros';
      byMethod[meth] = (byMethod[meth] || 0) + 1;
    }
    return { total: payments.length, revenue: totalRev, byProduct, byDay, byHour, byMethod };
  } catch (e) { return { total: 0, revenue: 0, byProduct: {}, byDay: {}, byHour: [], byMethod: {} }; }
}

async function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1048576) req.destroy(); });
    req.on('end', () => {
      try { resolve(sanitizeObject(JSON.parse(body), 0)); }
      catch { try { resolve(Object.fromEntries(new URLSearchParams(body))); } catch { resolve({}); } }
    });
    req.on('error', () => resolve({}));
  });
}

async function parseFormBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => { try { resolve(new URLSearchParams(body)); } catch { resolve(new URLSearchParams()); } });
    req.on('error', () => resolve(new URLSearchParams()));
  });
}

async function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2097152) req.destroy(); });
    req.on('end', () => resolve(body));
    req.on('error', () => resolve(''));
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  try { return sanitizeObject(JSON.parse(raw), 0); } catch { return {}; }
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none'");
}

function corsHeaders(res, origin) {
  const allowed = ['https://web.whatsapp.com', 'https://app.wascript.com.br', 'https://dev.watools.com.br'];
  if (origin && allowed.some(a => origin === a || origin.endsWith('.wascript.com.br'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Extension-ID,X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

function applyCors(req, res) {
  const origin = req.headers.origin || '';
  corsHeaders(res, origin);
}

function sendJson(res, data, status) {
  if (res.headersSent) return;
  const body = JSON.stringify(data);
  res.writeHead(status || 200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendJsonGzip(req, res, data, status) {
  sendJson(res, data, status);
}

function sendHtml(res, html, status) {
  if (res.headersSent) return;
  res.writeHead(status || 200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendText(res, text, status) {
  if (res.headersSent) return;
  res.writeHead(status || 200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function sendError(res, status, msg) {
  sendJson(res, { success: false, error: msg, msg_id: msg }, status);
}

function sendInternalError(res, err, path) {
  console.error(`[ERR] ${path}:`, err && err.message ? err.message : err);
  if (!res.headersSent) sendJson(res, { success: false, error: 'internal_error' }, 500);
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) out[k.trim()] = decodeURIComponent(v.join('='));
  });
  return out;
}

function slog(level, msg, meta) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}` + (meta ? ' ' + JSON.stringify(meta) : '');
  if (level === LOG_LEVELS.ERROR || level === LOG_LEVELS.CRITICAL || level === LOG_LEVELS.WARN) console.error(line);
  else console.log(line);
}

const DOM_DEFAULTS = {
  selectors: {
    chatContainer:   '[data-testid="conversation-panel-wrapper"]',
    msgIn:           '[data-testid="msg-container"]',
    msgOut:          '[data-testid="msg-container"]',
    contactName:     '[data-testid="conversation-title"]',
    searchInput:     '[data-testid="search-input"]',
    chatList:        '[data-testid="cell-frame-container"]',
    attachBtn:       '[data-testid="attach-btn"]',
    sendBtn:         '[data-testid="send-btn"]',
    msgInput:        '[data-testid="conversation-compose-box-input"]',
    reactionBtn:     '[data-testid="reaction-btn"]',
    emojiPicker:     '[data-testid="emoji-picker"]',
    stickerBtn:      '[data-testid="sticker-picker"]',
    audioBtn:        '[data-testid="audio-btn"]',
    footer:          '[data-testid="conversation-footer"]',
    header:          '[data-testid="conversation-header"]',
  },
  features: { zapSaver: true, scheduler: true, funnels: true, flows: true, crm: true, massiveDispatching: true },
};

function safeMerge(defaults, overrides) {
  if (!overrides || typeof overrides !== 'object') return defaults;
  const out = JSON.parse(JSON.stringify(defaults));
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== null && v !== undefined && typeof v !== 'function') {
      if (typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        out[k] = safeMerge(out[k], v);
      } else {
        out[k] = v;
      }
    }
  }
  return out;
}

let _settingsCache     = null;
let _settingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 30000;

async function getSettingsAdmin() {
  const now = Date.now();
  if (_settingsCache && now - _settingsCacheTime < SETTINGS_CACHE_TTL) return _settingsCache;
  try {
    const doc = await dbWS.collection(COL.settings).findOne({ _id: 'main' });
    _settingsCache     = doc || {};
    _settingsCacheTime = now;
    return _settingsCache;
  } catch { return _settingsCache || {}; }
}

function buildDomConfig(settings) {
  const overrides = (settings && settings.domConfig) ? settings.domConfig : {};
  return safeMerge(DOM_DEFAULTS, overrides);
}

function buildConfigJson(settings) {
  const dom = buildDomConfig(settings);
  return {
    version:    '5.0.0',
    selectors:  dom.selectors,
    features:   dom.features,
    updatedAt:  new Date().toISOString(),
  };
}

let _configJsonCache    = null;
let _configJsonCacheAt  = 0;

async function sendCachedConfigJson(res) {
  const now = Date.now();
  if (!_configJsonCache || now - _configJsonCacheAt > 300000) {
    const settings   = await getSettingsAdmin();
    _configJsonCache  = JSON.stringify(buildConfigJson(settings));
    _configJsonCacheAt = now;
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
  res.end(_configJsonCache);
}

async function connectMongo() {
  await getMongoDb();
  await ensureIndexes();
}

async function ensureIndexes() {
  try {
    try { await dbWS.collection(COL.licenses).dropIndex('bearer_1'); } catch {}
    try { await dbWS.collection(COL.licenses).dropIndex('bearer_token_1'); } catch {}
    await dbWS.collection(COL.licenses).createIndex({ code: 1 }, { unique: true });
    await dbWS.collection(COL.licenses).createIndex({ bearer_token: 1 }, { sparse: true });
    await dbWS.collection(COL.sessions).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await dbWS.collection(COL.sessions).createIndex({ token: 1 }, { unique: true });
    await dbWS.collection(COL.logs).createIndex({ createdAt: -1 });
  } catch (e) { slog(LOG_LEVELS.WARN, 'ensureIndexes', { err: e.message }); }
}

async function initSeed() {
  const settings = await getSettingsAdmin();
  const adminUser = process.env.WS_ADMIN_USER || process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.WS_ADMIN_PASS || process.env.ADMIN_PASS || '';
  if (!settings.adminUser && adminUser && adminPass) {
    const hashed = hashPassword(adminPass);
    await dbWS.collection(COL.settings).updateOne(
      { _id: 'main' },
      { $set: { adminUser, adminPassHash: hashed } },
      { upsert: true }
    );
    _settingsCache = null;
  }
}

async function verifyAdminCredentials(user, pass) {
  const settings = await getSettingsAdmin();
  if (!settings.adminUser || !settings.adminPassHash) return false;
  const uBuf = Buffer.from(user || '');
  const aBuf = Buffer.from(settings.adminUser || '');
  if (uBuf.length !== aBuf.length) return false;
  if (!crypto.timingSafeEqual(uBuf.length ? uBuf : Buffer.alloc(1), aBuf.length ? aBuf : Buffer.alloc(1))) return false;
  return verifyPassword(pass, settings.adminPassHash);
}

async function verifyModCredentials(user, pass) {
  const settings = await getSettingsAdmin();
  const mods     = settings.mods || [];
  for (const mod of mods) {
    const uBuf = Buffer.from(user || '');
    const mBuf = Buffer.from(mod.user || '');
    if (uBuf.length !== mBuf.length) continue;
    try {
      if (crypto.timingSafeEqual(uBuf.length ? uBuf : Buffer.alloc(1), mBuf.length ? mBuf : Buffer.alloc(1)) && verifyPassword(pass, mod.passHash)) {
        return mod;
      }
    } catch { continue; }
  }
  return null;
}

async function createSession(role, meta) {
  const token     = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const doc       = { token, role, expiresAt, ...meta, createdAt: new Date() };
  try {
    await dbWS.collection(COL.sessions).insertOne(doc);
    return { token, expiresAt };
  } catch { return null; }
}

async function validateSession(token) {
  if (!token) return null;
  try {
    const doc = await dbWS.collection(COL.sessions).findOne({ token, expiresAt: { $gt: new Date() } });
    return doc || null;
  } catch { return null; }
}

async function destroySession(token) {
  if (!token) return;
  try { await dbWS.collection(COL.sessions).deleteOne({ token }); } catch {}
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${WS_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${WS_COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict; Secure`);
}

function normKey(k) { return String(k || '').toLowerCase().trim(); }

function generateKeyCode() {
  const h = () => crypto.randomBytes(4).toString('hex');
  return `ws-${h()}-${h()}-${h()}`;
}

function isKeyExpiredWs(rec) {
  if (!rec.expiresAt) return false;
  return new Date(rec.expiresAt) < new Date();
}

function keyStatus(rec) {
  if (!rec.active) return 'blocked';
  if (isKeyExpiredWs(rec)) return 'expired';
  if (rec.ativarNoPrimeiroUso && !rec.primeiroUsoAt) return 'pending';
  return 'active';
}

async function findKey(code) {
  if (!dbWS) return null;
  try {
    return await dbWS.collection(COL.licenses).findOne({ code: normKey(code) });
  } catch { return null; }
}

async function findKeyByBearer(token) {
  if (!dbWS || !token) return null;
  try {
    const b = String(token).trim();
    if (!b) return null;
    return await dbWS.collection(COL.licenses).findOne({
      $or: [{ bearer_token: b }, { code: normKey(b) }, { access_token_plugin: b }],
    });
  } catch { return null; }
}

let _keysCache   = null;
let _keysCacheAt = 0;
const KEYS_CACHE_TTL = 15000;

function invalidateKeysCache() { _keysCache = null; _keysCacheAt = 0; }

async function getKeysCached() {
  const now = Date.now();
  if (_keysCache && now - _keysCacheAt < KEYS_CACHE_TTL) return _keysCache;
  _keysCache   = await listLicenses();
  _keysCacheAt = now;
  return _keysCache;
}

async function listLicenses() {
  if (!dbWS) return [];
  try {
    return await dbWS.collection(COL.licenses).find({}).sort({ createdAt: -1 }).toArray();
  } catch { return []; }
}

async function getKeyStats() {
  const licenses = await getKeysCached();
  return {
    totalKeys:   licenses.length,
    activeKeys:  licenses.filter(k => k.premium && k.active && !isKeyExpiredWs(k) && !(k.ativarNoPrimeiroUso && !k.primeiroUsoAt)).length,
    freeKeys:    licenses.filter(k => !k.premium).length,
    expiredKeys: licenses.filter(k => isKeyExpiredWs(k)).length,
    blockedKeys: licenses.filter(k => !k.active).length,
    totalLogs:   0,
  };
}

async function createKey(opts) {
  const code  = generateKeyCode();
  const exAt  = opts.expiresAt || (opts.expireDays ? new Date(Date.now() + opts.expireDays * 86400000).toISOString() : null);
  const rec   = {
    code,
    label:             sanitizeString(opts.label || 'Cliente').slice(0, 60),
    premium:           opts.premium !== false,
    active:            true,
    expiresAt:         exAt,
    maxUses:           opts.maxUses !== undefined ? opts.maxUses : -1,
    phones:            [],
    uses:              0,
    lastPhone:         null,
    lastIp:            null,
    note:              sanitizeString(opts.note || '').slice(0, 500),
    ativarNoPrimeiroUso: opts.ativarNoPrimeiroUso === true,
    primeiroUsoAt:     null,
    bearer_token:        code,
    access_token_plugin: code,
    user_id:           crypto.randomBytes(8).toString('hex'),
    createdAt:         new Date().toISOString(),
    modName:           opts.modName || null,
  };
  if (!dbWS) throw new Error('db_unavailable');
  await dbWS.collection(COL.licenses).insertOne(rec);
  invalidateKeysCache();
  await addLog('key_created', 'Chave ' + code + ' criada', { code, label: rec.label });
  return rec;
}

async function updateLicense(code, patch) {
  if (!dbWS) return;
  await dbWS.collection(COL.licenses).updateOne({ code: normKey(code) }, { $set: patch });
  invalidateKeysCache();
}

async function deleteLicense(code) {
  if (!dbWS) return;
  await dbWS.collection(COL.licenses).deleteOne({ code: normKey(code) });
  invalidateKeysCache();
}

async function addLog(event, message, meta) {
  try {
    await dbWS.collection(COL.logs).insertOne({
      event:     event || 'info',
      message:   String(message || '').slice(0, 500),
      meta:      meta || {},
      createdAt: new Date(),
    });
  } catch {}
}

async function getRecentLogs(limit) {
  try {
    return await dbWS.collection(COL.logs).find({}).sort({ createdAt: -1 }).limit(limit || 150).toArray();
  } catch { return []; }
}

async function dispatchWebhookAlert(event, meta) {
  if (!WEBHOOK_URL) return;
  try {
    const body = JSON.stringify({ event, meta, ts: new Date().toISOString(), service: 'waspeed' });
    const u    = new URL(WEBHOOK_URL);
    const mod  = WEBHOOK_URL.startsWith('https') ? https : http;
    const r    = mod.request({ hostname: u.hostname, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => res.resume());
    r.on('error', () => {});
    r.setTimeout(5000, () => r.destroy());
    r.write(body); r.end();
  } catch {}
}

function parseLicenseExpiry(body) {
  const days = parseInt(body.expireDays || body.days || 0, 10);
  const hrs  = parseInt(body.expireHours || body.hours || 0, 10);
  const ms   = (days * 1440 + hrs * 60) * 60000;
  if (!ms) return { expiresAt: null, expireDays: null };
  return { expiresAt: new Date(Date.now() + ms).toISOString(), expireDays: days };
}

function formatDateYMD(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

const EMPTY_AUTH_GOOGLE = {
  user_id: '', name: '', email: '', wl_id: '', bearer_token: '', access_token_plugin: '',
  user_premium: { plan: 'free', active: false, features: [] },
  dataCadastro: '', whatsapp_registro: '', whatsapp_plugin: '',
  path: '', afiliado: '', campanhaID: '', start_form: true,
  cookies: { _fbc: '', _fbp: '', _ga: '', _ttclid: '', _ttp: '' },
};

function buildUserPremium(code, rec) {
  const st = keyStatus(rec);
  if (!rec.premium || st !== 'active') return null;
  return {
    id_assinatura: String(rec.user_id || code),
    data_liberacao: (rec.createdAt ? new Date(rec.createdAt) : new Date()).toISOString().slice(0, 10),
    teste: '0',
    plan: 'pro',
    active: true,
    features: ['all'],
    expiresAt: rec.expiresAt || null,
    maxUses: rec.maxUses != null ? rec.maxUses : -1,
  };
}

function keyToUser(code, rec) {
  return {
    user_id:              String(rec.user_id || code),
    name:                 rec.label || 'Usuario',
    email:                rec.email || '',
    wl_id:                WS_WL_ID,
    bearer_token:         rec.bearer_token || code,
    access_token_plugin:  rec.access_token_plugin || code,
    user_premium:         buildUserPremium(code, rec),
    dataCadastro:         rec.createdAt || new Date().toISOString(),
    whatsapp_registro:    rec.lastPhone || '',
    whatsapp_plugin:      rec.lastPhone || '',
    path: '', afiliado: '', campanhaID: '', start_form: true,
    cookies: { _fbc: '', _fbp: '', _ga: '', _ttclid: '', _ttp: '' },
  };
}

async function authSuccess(code, rec, meta) {
  const st = keyStatus(rec);
  if (st === 'blocked')  return { ok: false, msg_id: 'user_blocked' };
  if (st === 'expired')  return { ok: false, msg_id: 'license_expired' };

  const phone = meta && meta.phone ? String(meta.phone).trim() : null;
  const ip    = meta && meta.ip    ? meta.ip    : '';

  if (rec.ativarNoPrimeiroUso && !rec.primeiroUsoAt) {
    await updateLicense(code, { ativarNoPrimeiroUso: false, primeiroUsoAt: new Date().toISOString(), active: true });
    await addLog('key_activated', 'Chave ativada no primeiro uso: ' + code, { code, ip });
  }

  const maxU        = rec.maxUses != null ? rec.maxUses : -1;
  const isUnlimited = maxU <= 0;
  const atomicPatch = { lastUsed: new Date().toISOString(), lastIp: ip };
  if (phone) atomicPatch.lastPhone = phone;

  const phoneAlreadyLinked = phone && (rec.phones || []).includes(phone);
  const updateOp = { $set: atomicPatch, $inc: { uses: 1 } };

  if (phone && !phoneAlreadyLinked) {
    if (!isUnlimited && (rec.phones || []).length >= maxU) {
      return { ok: false, msg_id: 'max_devices_reached' };
    }
    updateOp.$addToSet = { phones: phone };
  }

  await dbWS.collection(COL.licenses).updateOne({ code: normKey(code) }, updateOp);
  invalidateKeysCache();
  return { ok: true };
}

function requireExtensionId(req) {
  return req.headers['x-extension-id'] || req.headers['x-plugin-id'] || '';
}

function parseBearer(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return '';
}

function requireAccessToken(req) {
  const token = req.headers['x-access-token'] || req.headers['access-token'] || '';
  if (!WS_ACCESS_TOKEN) return true;
  return token === WS_ACCESS_TOKEN;
}

function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false }); }
  catch { return String(d); }
}

function statusBadgeHtml(st) {
  const map = {
    active:  ['ATIVA',    '#39ff14'],
    blocked: ['BLOQUEADA','#ff8899'],
    expired: ['EXPIRADA', '#ff8899'],
    pending: ['PENDENTE', '#ffcc00'],
    free:    ['FREE',     '#8ab89a'],
  };
  const [label, col] = map[st] || ['?', '#888'];
  return `<span style="font-size:.7rem;font-weight:700;color:${col};background:${col}15;border:1px solid ${col}28;padding:2px 8px;border-radius:4px">${label}</span>`;
}

function panelStatusKey(rec) {
  if (!rec.active)              return 'blocked';
  if (isKeyExpiredWs(rec))      return 'expired';
  if (!rec.premium)             return 'free';
  if (rec.ativarNoPrimeiroUso && !rec.primeiroUsoAt) return 'pending';
  return 'active';
}

function buildLicenseRows(licenses) {
  if (!licenses || !licenses.length) return '<tr><td colspan="11" style="padding:18px;text-align:center;color:#5a8a6e">Nenhuma chave</td></tr>';
  return licenses.map(rec => {
    const st    = panelStatusKey(rec);
    const badge = statusBadgeHtml(st);
    const exp   = rec.expiresAt ? fmtDate(rec.expiresAt) : (rec.ativarNoPrimeiroUso ? 'Ao 1º uso' : '∞');
    const uses  = (rec.phones || []).length;
    const maxU  = rec.maxUses != null ? (rec.maxUses === -1 ? '∞' : rec.maxUses) : '∞';
    const code  = rec.code || '';
    const safe  = code.split('"').join('&quot;');
    const slbl  = (rec.label||'').split('"').join('&quot;').split('&').join('&amp;').split('<').join('&lt;');
    const snote = (rec.note||'').split('"').join('&quot;').split('&').join('&amp;').split('<').join('&lt;');
    const phones = JSON.stringify(rec.phones || []).split('"').join('&quot;');
    return `<tr data-code="${safe}" data-label="${slbl}" data-phone="${esc(rec.lastPhone||'')}" data-status="${st}" data-phones="${phones}">
      <td class="zvm-td"><code style="font-size:.72rem;word-break:break-all">${esc(code)}</code></td>
      <td class="zvm-td" style="font-size:.8rem">${esc(rec.label||'')}</td>
      <td class="zvm-td">${badge}</td>
      <td class="zvm-td" style="font-size:.75rem">${esc(exp)}</td>
      <td class="zvm-td" style="font-size:.78rem">${uses}/${maxU}</td>
      <td class="zvm-td zvm-muted" style="font-size:.75rem">${esc(rec.lastPhone||'')}</td>
      <td class="zvm-td zvm-muted" style="font-size:.75rem">${esc(rec.lastIp||'')}</td>
      <td class="zvm-td zvm-muted" style="font-size:.73rem">${esc(fmtDate(rec.lastUsed))}</td>
      <td class="zvm-td zvm-muted" style="font-size:.73rem">${esc(fmtDate(rec.createdAt))}</td>
      <td class="zvm-td zvm-muted" style="font-size:.73rem">${esc(rec.note||'')}</td>
      <td class="zvm-td">
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          ${st === 'pending' ? `<button class="zvm-btn" onclick="apiActivate('${safe}')">Ativar</button>` : ''}
          <button class="zvm-btn" onclick="apiToggle('${safe}')">${rec.active ? 'Bloquear' : 'Ativar'}</button>
          <button class="zvm-btn" onclick="openRenew('${safe}')">Renovar</button>
          <button class="zvm-btn" onclick="openUses('${safe}',${rec.maxUses != null ? rec.maxUses : -1})">Usos</button>
          <button class="zvm-btn" onclick="openNote('${safe}','${snote}')">Nota</button>
          <button class="zvm-btn" onclick="openRename('${safe}','${slbl}')">Renomear</button>
          <button class="zvm-btn" onclick="openNumbers(this.closest('tr'))">Números</button>
          <button class="zvm-btn zvm-btn-del" onclick="deleteKey('${safe}')">×</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function buildLogRows(logs) {
  if (!logs || !logs.length) return '<tr><td colspan="6" style="padding:18px;text-align:center;color:#5a8a6e">Nenhum log</td></tr>';
  return logs.map(l => {
    const ev  = String(l.event || '').toUpperCase();
    const col = ev.includes('FAIL') || ev.includes('DEL') || ev.includes('BLOCK') ? '#ff8899' : ev.includes('OK') || ev.includes('CREAT') ? '#39ff14' : '#8ab89a';
    return `<tr>
      <td class="zvm-td" style="font-size:.72rem;color:#5a8a6e">${esc(fmtDate(l.createdAt))}</td>
      <td class="zvm-td"><span style="font-size:.7rem;font-weight:700;color:${col};background:${col}15;border:1px solid ${col}28;padding:2px 8px;border-radius:4px">${esc(ev)}</span></td>
      <td class="zvm-td zvm-muted" style="font-size:.75rem">${esc((l.meta && l.meta.code) || '')}</td>
      <td class="zvm-td zvm-muted" style="font-size:.75rem">${esc((l.meta && l.meta.phone) || '')}</td>
      <td class="zvm-td zvm-muted" style="font-size:.75rem">${esc((l.meta && l.meta.ip) || '')}</td>
      <td class="zvm-td zvm-muted" style="font-size:.75rem">${esc(l.message||'')}</td>
    </tr>`;
  }).join('');
}

const CANVAS_BG = `<canvas id="bg-canvas" style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none"></canvas>
<scr`+`ipt>(function(){var c=document.getElementById('bg-canvas'),ctx=c.getContext('2d'),W,H,pts=[];function resize(){W=c.width=window.innerWidth;H=c.height=window.innerHeight;}resize();window.addEventListener('resize',resize);for(var i=0;i<60;i++)pts.push({x:Math.random()*9999,y:Math.random()*9999,vx:(Math.random()-.5)*.3,vy:(Math.random()-.5)*.3,r:Math.random()*1.5+.5});function frame(){ctx.clearRect(0,0,W,H);pts.forEach(function(p){p.x+=p.vx;p.y+=p.vy;if(p.x<0)p.x=W;if(p.x>W)p.x=0;if(p.y<0)p.y=H;if(p.y>H)p.y=0;ctx.beginPath();ctx.arc(p.x%W,p.y%H,p.r,0,6.28);ctx.fillStyle='rgba(57,255,20,.18)';ctx.fill();});pts.forEach(function(a,i){pts.slice(i+1).forEach(function(b){var dx=a.x-b.x,dy=a.y-b.y,d=Math.sqrt(dx*dx+dy*dy);if(d<120){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle='rgba(57,255,20,'+(1-d/120)*.08+')';ctx.stroke();}});});requestAnimationFrame(frame);}frame();})();</scr`+`ipt>`;

const PANEL_CSS = `*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#020904;color:#e8fff3;min-height:100vh;display:flex;flex-direction:column}:root{--ac:#39ff14;--dg:#ff4466;--bg:#020904;--bg2:#070f0a;--bdr:#183326;--tx:#e8fff3;--mt:#5a8a6e;--sb-w:52px;--sb-wex:200px}.layout{display:flex;min-height:100vh}.sidebar{width:var(--sb-w);background:#040d06;border-right:1px solid var(--bdr);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;z-index:10;overflow:hidden;transition:width .22s cubic-bezier(.4,0,.2,1)}.sidebar:hover{width:var(--sb-wex)}.sb-brand{padding:14px 12px 10px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:8px;min-width:var(--sb-wex);white-space:nowrap}.bdot{width:10px;height:10px;min-width:10px;border-radius:50%;background:var(--ac);box-shadow:0 0 8px var(--ac);display:inline-block}.btxt{font-size:.85rem;font-weight:800;color:var(--ac);letter-spacing:.05em;opacity:0;transition:opacity .15s .05s}.sidebar:hover .btxt{opacity:1}.sbsec{padding:8px 14px 4px;font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#2d5c3e;min-width:var(--sb-wex);white-space:nowrap;opacity:0;transition:opacity .12s}.sidebar:hover .sbsec{opacity:1}.ni{display:flex;align-items:center;gap:8px;padding:8px 12px;color:var(--mt);text-decoration:none;font-size:.8rem;border-left:2px solid transparent;transition:all .15s;min-width:var(--sb-wex);white-space:nowrap}.ni:hover,.ni.ac{color:var(--ac);background:#0a1f0f;border-left-color:var(--ac)}.ic{font-size:1rem;width:20px;min-width:20px;text-align:center;flex-shrink:0}.nl{font-size:.8rem;opacity:0;transition:opacity .12s .04s}.sidebar:hover .nl{opacity:1}.sbft{margin-top:auto;border-top:1px solid var(--bdr)}.main{flex:1;overflow:auto;display:flex;flex-direction:column;min-width:0}.topbar{padding:12px 18px;border-bottom:1px solid var(--bdr);background:#040d06;display:flex;align-items:center;justify-content:space-between}.tb-t{font-size:.95rem;font-weight:700;color:var(--ac)}.sec{background:var(--bg2);border:1px solid var(--bdr);border-radius:10px;margin:14px;overflow:hidden}.sh{padding:12px 18px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.sh-t{font-size:.8rem;font-weight:700;color:var(--ac)}.sc-row{display:flex;flex-wrap:wrap;gap:10px;padding:14px 18px}.sc{background:#040d06;border:1px solid var(--bdr);border-radius:8px;padding:10px 16px;min-width:80px;text-align:center}.sc .n{font-size:1.5rem;font-weight:800;color:var(--ac)}.sc .l{font-size:.65rem;text-transform:uppercase;letter-spacing:.08em;color:var(--mt);margin-top:3px}.tbl-w table{width:100%;border-collapse:collapse}.zvm-td{padding:7px 10px;border-bottom:1px solid #0d1f12;vertical-align:middle}.zvm-td:last-child{padding:6px 10px}.zvm-muted{color:#5a8a6e}.zvm-btn{padding:3px 8px;border-radius:4px;border:1px solid rgba(57,255,20,.3);background:rgba(57,255,20,.07);color:#a8e8b8;font-size:.7rem;cursor:pointer;transition:all .12s;white-space:nowrap}.zvm-btn:hover{background:rgba(57,255,20,.16);color:var(--ac)}.zvm-btn-del{border-color:rgba(255,68,102,.3);background:rgba(255,68,102,.07);color:#ff8899}.zvm-btn-del:hover{background:rgba(255,68,102,.18)}.btn-p{padding:8px 16px;border-radius:6px;border:none;background:linear-gradient(135deg,#39ff14,#00ff88);color:#020604;font-weight:700;cursor:pointer;font-size:.82rem}.btn-w{padding:8px 16px;border-radius:6px;border:1px solid var(--bdr);background:transparent;color:var(--mt);cursor:pointer;font-size:.82rem}.field{margin-bottom:12px}.field label{display:block;font-size:.75rem;color:var(--mt);margin-bottom:5px}.field input,.field textarea,.field select{width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--bdr);background:#040d06;color:var(--tx);font:inherit;font-size:.82rem}.mrow{display:flex;gap:8px;margin-top:14px;justify-content:flex-end}#modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100;align-items:center;justify-content:center}#modal-bg.open{display:flex}#modal-box{background:#070f0a;border:1px solid var(--bdr);border-radius:12px;padding:20px 22px;min-width:280px;max-width:480px;width:90%;max-height:80vh;overflow-y:auto}#modal-box h3{font-size:.95rem;font-weight:700;color:var(--ac);margin-bottom:14px}#toast{position:fixed;bottom:20px;right:20px;background:#0d1f12;border:1px solid var(--ac);border-radius:8px;padding:10px 16px;font-size:.8rem;color:var(--tx);opacity:0;transform:translateY(8px);transition:all .25s;z-index:200;pointer-events:none}#toast.show{opacity:1;transform:translateY(0)}`;

function spaShell(title, sidebar, heading, body) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${PANEL_CSS}</style></head><body>
${CANVAS_BG}
<div class="layout" style="position:relative;z-index:1">
${sidebar}
<div class="main">
<div class="topbar"><span class="tb-t">${esc(heading)}</span></div>
${body}
</div>
</div>
<div id="modal-bg" onclick="if(event.target===this)closeModal()"><div id="modal-box"></div></div>
<div id="toast"></div>
</body></html>`;
}

function renderLoginShell(title, action, labelUser, extra) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#020904;color:#e8fff3;min-height:100vh;display:flex;align-items:center;justify-content:center}:root{--ac:#39ff14;--dg:#ff4466;--bg:#020904;--bg2:#070f0a;--bdr:#183326;--tx:#e8fff3;--mt:#5a8a6e}.card{background:#070f0a;border:1px solid #183326;border-radius:14px;padding:32px 28px;width:100%;max-width:360px;position:relative;z-index:1}.logo{font-size:1.5rem;font-weight:900;color:var(--ac);letter-spacing:.05em;margin-bottom:6px}.sub{font-size:.75rem;color:var(--mt);margin-bottom:22px}.field{margin-bottom:13px}.field label{display:block;font-size:.73rem;color:var(--mt);margin-bottom:5px}.field input{width:100%;padding:9px 11px;border-radius:7px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.84rem}.field input:focus{outline:none;border-color:var(--ac)}.btn{width:100%;padding:11px;border-radius:8px;border:none;background:linear-gradient(135deg,#39ff14,#00ff88);color:#020604;font-size:.88rem;font-weight:800;cursor:pointer;margin-top:6px}.err{color:#ff8899;font-size:.76rem;margin-bottom:12px;background:rgba(255,68,102,.09);border:1px solid rgba(255,68,102,.2);border-radius:6px;padding:7px 11px}</style></head><body>
${CANVAS_BG}
<div class="card">
<div class="logo">${esc(title)}</div>
<div class="sub">Acesso restrito</div>
${extra ? `<div class="err">${esc(extra)}</div>` : ''}
<form method="POST" action="${esc(action)}">
<div class="field"><label>${labelUser || 'Usuário'}</label><input name="user" autocomplete="username" required></div>
<div class="field"><label>Senha</label><input name="pass" type="password" autocomplete="current-password" required></div>
<div class="field"><label>Código 2FA</label><input name="totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000"></div>
<button class="btn" type="submit">Entrar</button>
</form>
</div></body></html>`;
}

function renderAdminLogin(path, role, extra) {
  const action = (path || R_WS_ADMIN) + '/login';
  return renderLoginShell((role || 'Admin') + ' — WSPEED', action, 'Usuário', extra);
}


const ADMIN_JS_SAFE = (function() {
  var RA = R_WS_ADMIN;
  return [
    'var _RA=' + JSON.stringify(RA) + ';',
    'var _curTab="keys";',
    'function showTab(t){["keys","logs","audit"].forEach(function(n){var el=document.getElementById("tab-"+n);if(el)el.style.display=n===t?"":"none";var li=document.querySelector("[data-tab=\'"+n+"\']");if(li)li.classList.toggle("ac",n===t);});_curTab=t;try{history.replaceState(null,"","#"+t);}catch(e){}if(t==="audit"&&typeof runAudit==="function")runAudit();}',
    '(function(){var h=(location.hash||"").replace("#","");if(["keys","logs","audit"].indexOf(h)>=0){showTab(h);}else{showTab("keys");}})();',
    'function toast(m,ok){var t=document.getElementById(\'toast\');t.textContent=m;t.style.borderColor=(ok===false)?\'var(--dg)\':\'var(--ac)\';t.classList.add(\'show\');setTimeout(function(){t.classList.remove(\'show\');},3500);}',
    'function closeModal(){document.getElementById(\'modal-bg\').classList.remove(\'open\');}',
    'function filterKeys(){var q=(document.getElementById(\'search-input\').value||\'\').toLowerCase();var st=document.getElementById(\'filter-status\').value;document.querySelectorAll(\'#kb tr\').forEach(function(r){var row=(r.dataset.code+r.dataset.label+r.dataset.phone).toLowerCase();r.style.display=((!q||row.includes(q))&&(!st||r.dataset.status===st))?\'\':\'none\';});}',
    'function filterLog(){var q=(document.getElementById(\'logSearch\').value||\'\').toLowerCase();var tp=document.getElementById(\'logTypeFilter\').value.toLowerCase();document.querySelectorAll(\'#logb tr\').forEach(function(r){var txt=r.textContent.toLowerCase();r.style.display=((!q||txt.includes(q))&&(!tp||txt.includes(tp)))?\'\':\'none\';});}',
    'function exportCsv(){window.location=_RA+\'/api/export/csv\';}',
    'function clearLogs(){if(!confirm(\'Limpar todos os logs?\'))return;fetch(_RA+\'/api/logs/clear\',{method:\'POST\'}).then(function(){toast(\'Logs limpos\');doRefresh();}).catch(function(){toast(\'Erro\',false);});}',
    'async function generateKey(){var btn=document.querySelector(\'button[onclick="generateKey()"]\');if(btn){btn.disabled=true;btn.textContent=\'Gerando...\';}var label=(document.getElementById(\'nlabel\').value||\'\').trim();if(!label){toast(\'Informe o nome do cliente\',false);if(btn){btn.disabled=false;btn.textContent=\'+ Gerar\';}return;}if(label.length>60){toast(\'Máx 60 caracteres\',false);if(btn){btn.disabled=false;btn.textContent=\'+ Gerar\';}return;}var body={label:label,premium:true};var d=+(document.getElementById(\'ndays\').value)||0,h=+(document.getElementById(\'nhours\').value)||0;if(d)body.expireDays=d;if(h)body.expireHours=h;var u=document.getElementById(\'nuses\').value.trim();if(u!==\'\')body.maxUses=parseInt(u);if(document.getElementById(\'nfirstuse\').checked)body.ativarNoPrimeiroUso=true;try{var r=await fetch(_RA+\'/api/keys\',{method:\'POST\',headers:{\'Content-Type\':\'application/json\'},body:JSON.stringify(body)});if(r.status===401){location.href=_RA+\'/login\';return;}var j=await r.json();if(j.ok){toast(\'Chave gerada: \'+j.key);[\'nlabel\',\'ndays\',\'nhours\',\'nuses\'].forEach(function(id){document.getElementById(id).value=\'\';});document.getElementById(\'nfirstuse\').checked=false;doRefresh();}else{toast(\'Erro: \'+(j.error||\'?\'),false);}}catch(e){toast(\'Erro de conexão\',false);}finally{if(btn){btn.disabled=false;btn.textContent=\'+ Gerar\';}}}',
    'async function apiActivate(code){try{var r=await fetch(_RA+\'/api/activate/\'+encodeURIComponent(code),{method:\'POST\'});var j=await r.json();if(j.ok){toast(\'Chave ativada\');doRefresh();}else{toast(\'Falha: \'+(j.error||\'?\'),false);}}catch(e){toast(\'Erro de conexão\',false);}}',
    'async function apiToggle(code){try{var r=await fetch(_RA+\'/api/toggle/\'+encodeURIComponent(code),{method:\'POST\'});var j=await r.json();if(j.ok){toast(\'Status alterado\');doRefresh();}else{toast(\'Falha: \'+(j.error||\'?\'),false);}}catch(e){toast(\'Erro de conexão\',false);}}',
    'async function deleteKey(code){if(!confirm(\'Excluir chave \'+code+\'?\'))return;try{var r=await fetch(_RA+\'/api/keys/\'+encodeURIComponent(code),{method:\'DELETE\'});var j=await r.json();if(j.ok){toast(\'Excluída\');doRefresh();}else{toast(\'Falha\',false);}}catch(e){toast(\'Erro de conexão\',false);}}',
    'function openRenew(code){var b=document.getElementById(\'modal-box\');var sc=code.split(\'"\').join(\'&quot;\');b.innerHTML=\'<h3>Renovar \'+code+\'</h3><div class="field"><label>Dias</label><input id="rd" type="number" min="0" value="30"></div><div class="field"><label>Horas</label><input id="rh" type="number" min="0" value="0"></div><div class="mrow"><button class="btn-p" id="renew-btn" onclick="submitRenew(this.dataset.code)" data-code="\'+sc+\'">Confirmar</button><button class="btn-w" onclick="closeModal()">Cancelar</button></div>\';document.getElementById(\'modal-bg\').classList.add(\'open\');}',
    'async function submitRenew(code){var btn=document.getElementById(\'renew-btn\');if(btn){btn.disabled=true;btn.textContent=\'Salvando...\';}var days=+(document.getElementById(\'rd\').value)||0,hours=+(document.getElementById(\'rh\').value)||0;try{var r=await fetch(_RA+\'/api/renew/\'+encodeURIComponent(code),{method:\'POST\',headers:{\'Content-Type\':\'application/json\'},body:JSON.stringify({days:days,hours:hours})});var j=await r.json();closeModal();if(j.ok){toast(\'Renovada\');doRefresh();}else{toast(\'Falha: \'+(j.error||\'?\'),false);}}catch(e){closeModal();toast(\'Erro de conexão\',false);}}',
    'function openUses(code,cur){var b=document.getElementById(\'modal-box\');var sc=code.split(\'"\').join(\'&quot;\');b.innerHTML=\'<h3>Limite de usos</h3><div class="field"><label>Máx (-1=∞)</label><input id="mu" type="number" value="\'+cur+\'"></div><div class="mrow"><button class="btn-p" id="uses-btn" onclick="submitUses(this.dataset.code)" data-code="\'+sc+\'">Confirmar</button><button class="btn-w" onclick="closeModal()">Cancelar</button></div>\';document.getElementById(\'modal-bg\').classList.add(\'open\');}',
    'async function submitUses(code){var btn=document.getElementById(\'uses-btn\');if(btn){btn.disabled=true;btn.textContent=\'Salvando...\';}var maxUses=parseInt(document.getElementById(\'mu\').value);try{var r=await fetch(_RA+\'/api/max-uses/\'+encodeURIComponent(code),{method:\'POST\',headers:{\'Content-Type\':\'application/json\'},body:JSON.stringify({maxUses:maxUses})});var j=await r.json();closeModal();if(j.ok){toast(\'Atualizado\');doRefresh();}else{toast(\'Falha: \'+(j.error||\'?\'),false);}}catch(e){closeModal();toast(\'Erro de conexão\',false);}}',
    'function openNote(code,cur){var b=document.getElementById(\'modal-box\');var safe=cur.split(\'&\').join(\'&amp;\').split(\'<\').join(\'&lt;\').split(\'>\').join(\'&gt;\');var sc=code.split(\'"\').join(\'&quot;\');b.innerHTML=\'<h3>Nota</h3><div class="field"><textarea id="nt" rows="4" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--bdr);background:#040d06;color:var(--tx);font:inherit;resize:vertical">\'+safe+\'</textarea></div><div class="mrow"><button class="btn-p" id="note-btn" onclick="submitNote(this.dataset.code)" data-code="\'+sc+\'">Salvar</button><button class="btn-w" onclick="closeModal()">Cancelar</button></div>\';document.getElementById(\'modal-bg\').classList.add(\'open\');setTimeout(function(){var t=document.getElementById(\'nt\');if(t)t.focus();},60);}',
    'async function submitNote(code){var btn=document.getElementById(\'note-btn\');if(btn){btn.disabled=true;btn.textContent=\'Salvando...\';}var note=document.getElementById(\'nt\').value;try{var r=await fetch(_RA+\'/api/note/\'+encodeURIComponent(code),{method:\'POST\',headers:{\'Content-Type\':\'application/json\'},body:JSON.stringify({note:note})});var j=await r.json();closeModal();if(j.ok){toast(\'Nota salva\');doRefresh();}else{toast(\'Falha: \'+(j.error||\'?\'),false);}}catch(e){closeModal();toast(\'Erro de conexão\',false);}}',
    'function openRename(code,cur){var b=document.getElementById(\'modal-box\');var sc=code.split(\'"\').join(\'&quot;\');var sv=cur.split(\'&\').join(\'&amp;\').split(\'<\').join(\'&lt;\').split(\'>\').join(\'&gt;\').split(\'"\').join(\'&quot;\');b.innerHTML=\'<h3>Renomear</h3><div class="field"><label>Novo nome</label><input id="rn" type="text" maxlength="60" value="\'+sv+\'"></div><div class="mrow"><button class="btn-p" id="rename-btn" onclick="submitRename(this.dataset.code)" data-code="\'+sc+\'">Salvar</button><button class="btn-w" onclick="closeModal()">Cancelar</button></div>\';document.getElementById(\'modal-bg\').classList.add(\'open\');setTimeout(function(){var t=document.getElementById(\'rn\');if(t){t.focus();t.select();}},60);}',
    'async function submitRename(code){var label=document.getElementById(\'rn\').value.trim();if(!label){toast(\'Informe um nome.\',false);return;}var btn=document.getElementById(\'rename-btn\');if(btn){btn.disabled=true;btn.textContent=\'Salvando...\';}try{var r=await fetch(_RA+\'/api/rename/\'+encodeURIComponent(code),{method:\'POST\',headers:{\'Content-Type\':\'application/json\'},body:JSON.stringify({label:label})});var j=await r.json();closeModal();if(j.ok){toast(\'Renomeado\');doRefresh();}else{toast(\'Falha: \'+(j.error||\'?\'),false);}}catch(e){closeModal();toast(\'Erro de conexão\',false);}}',
    'function openNumbers(tr){var code=tr.dataset.code;var phones;try{phones=JSON.parse(tr.dataset.phones||\'[]\');}catch(e){phones=[];}var sc=code.split(\'"\').join(\'&quot;\');var b=document.getElementById(\'modal-box\');var rows=phones&&phones.length?phones.map(function(p){var sp=p.split(\'"\').join(\'&quot;\');return\'<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;border-radius:6px;border:1px solid rgba(57,255,20,.12);background:#040d06;margin-bottom:5px"><span style="font-family:monospace;font-size:.82rem;color:#c8e8c8">\'+p+\'</span><button class="zvm-btn zvm-btn-del" data-code="\'+sc+\'" data-phone="\'+sp+\'" onclick="apiRemovePhone(this)">&times;</button></div>\';}).join(\'\'):\'<p style="color:#5a8a6e;font-size:.85rem;padding:8px 0">Nenhum número.</p>\';b.innerHTML=\'<h3 style="margin-bottom:12px">Números — \'+code+\'</h3><div style="max-height:260px;overflow-y:auto">\'+rows+\'</div><div class="mrow"><button class="zvm-btn zvm-btn-del" data-code="\'+sc+\'" onclick="apiRemoveAllPhones(this)">&times; Remover Todos</button><button class="btn-w" onclick="closeModal()">Fechar</button></div>\';document.getElementById(\'modal-bg\').classList.add(\'open\');}',
    'async function apiRemovePhone(btn){var code=btn.dataset.code;var phone=btn.dataset.phone;btn.disabled=true;btn.textContent=\'...\';try{var r=await fetch(_RA+\'/api/remove-phone/\'+encodeURIComponent(code),{method:\'POST\',headers:{\'Content-Type\':\'application/json\'},body:JSON.stringify({phone:phone})});var j=await r.json();if(j.ok){var row=btn.parentElement;if(row)row.remove();toast(\'Número removido\');doRefresh();}else{btn.disabled=false;btn.textContent=\'×\';toast(\'Falha\',false);}}catch(e){btn.disabled=false;btn.textContent=\'×\';toast(\'Erro de conexão\',false);}}',
    'async function apiRemoveAllPhones(btn){var code=btn.dataset.code;if(!confirm(\'Remover todos os números de \'+code+\'?\'))return;btn.disabled=true;btn.textContent=\'Removendo...\';try{var r=await fetch(_RA+\'/api/remove-all-phones/\'+encodeURIComponent(code),{method:\'POST\'});var j=await r.json();if(j.ok){closeModal();toast(\'Todos removidos\');doRefresh();}else{btn.disabled=false;btn.textContent=\'× Remover Todos\';toast(\'Falha\',false);}}catch(e){btn.disabled=false;btn.textContent=\'× Remover Todos\';toast(\'Erro de conexão\',false);}}',
    'async function doRefresh(manual){var lr=document.getElementById(\'last-r\');if(lr)lr.textContent=\'Atualizando...\';try{var r=await fetch(_RA+\'/api/data\');if(r.status===401){if(manual)location.href=_RA+\'/login\';return;}if(!r.ok){if(manual)toast(\'Erro \'+r.status,false);return;}var d=await r.json();if(!d.ok)return;if(document.getElementById(\'s-total\'))document.getElementById(\'s-total\').textContent=d.totalKeys;if(document.getElementById(\'s-active\'))document.getElementById(\'s-active\').textContent=d.activeKeys;if(document.getElementById(\'s-free\'))document.getElementById(\'s-free\').textContent=d.freeKeys;if(document.getElementById(\'s-expired\'))document.getElementById(\'s-expired\').textContent=d.expiredKeys;if(document.getElementById(\'s-logs\'))document.getElementById(\'s-logs\').textContent=d.totalLogs||0;if(document.getElementById(\'kb\'))document.getElementById(\'kb\').innerHTML=d.keysHtml;if(document.getElementById(\'logb\')&&d.logsHtml)document.getElementById(\'logb\').innerHTML=d.logsHtml;if(lr)lr.textContent=new Date().toLocaleTimeString(\'pt-BR\');filterKeys();}catch(e){if(lr)lr.textContent=\'Erro\';if(manual)toast(\'Erro ao atualizar\',false);}}',
    'setInterval(doRefresh,60000);doRefresh();'
  ].join('\n');
})();

function adminSidebar(active) {
  const item = (tab, icon, label) =>
    `<a href="#${tab}" class="ni${active===tab?' ac':''}" data-tab="${tab}" onclick="showTab('${tab}');return false"><span class="ic">${icon}</span><span class="nl">${label}</span></a>`;
  return `<aside class="sidebar"><div class="sb-brand"><span class="bdot"></span><span class="btxt">WSPEED</span></div><div class="sbsec">Painel</div>${item('keys','🔑','Licenças')}${item('logs','📋','Logs')}${item('audit','🛡️','Auditoria')}<div class="sbft"><a href="${R_WS_ADMIN}/logout" class="ni"><span class="ic">→</span><span class="nl">Sair</span></a></div></aside>`;
}

function modSidebar(active) {
  const item = (href, icon, label, key) =>
    `<a href="${href}" class="ni${active === key ? ' ac' : ''}"><span class="ic">${icon}</span><span class="nl">${label}</span></a>`;
  return `<aside class="sidebar"><div class="sb-brand"><span class="bdot"></span><span class="btxt">Moderador</span></div><div class="sbsec">Chaves</div>${item(R_WS_MOD,'🔑','Chaves','keys')}<div class="sbft">${item(R_WS_MOD+'/logout','→','Sair','out')}</div></aside>`;
}

function renderAdminDash(keysHtml, logsHtml, stats, auditBasePath) {
  const sc = (id, val, lbl, style) => `<div class="sc"><div class="n" id="${id}"${style?' style="'+style+'"':''}>${String(val)}</div><div class="l">${lbl}</div></div>`;
  const statsRow = `<div class="sc-row" style="margin-bottom:0;padding:14px 18px;border-bottom:1px solid #183326">${sc('s-total',stats.totalKeys,'Total','')}${sc('s-active',stats.activeKeys,'PRO Ativas','color:var(--ac)')}${sc('s-free',stats.freeKeys,'Free','')}${sc('s-expired',stats.expiredKeys,'Expiradas',stats.expiredKeys?'color:var(--dg)':'')}${sc('s-logs',stats.totalLogs||0,'Logs','')}</div>`;
  const genForm = `<div style="padding:16px 18px;background:#020904;border-bottom:1px solid #183326"><div style="max-width:450px;background:#070f0a;border:1px solid #183326;border-radius:12px;padding:16px 18px"><div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#5a8a6e;margin-bottom:12px">Nova Chave PRO</div><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center"><input type="text" id="nlabel" placeholder="Nome do cliente" maxlength="60" style="flex:1;min-width:140px;padding:7px 10px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><input type="number" id="ndays" placeholder="Dias" min="0" max="9999" style="width:58px;padding:7px 8px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><input type="number" id="nhours" placeholder="H" min="0" max="23" style="width:46px;padding:7px 6px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><input type="number" id="nuses" placeholder="Usos" title="-1=∞" min="-1" max="9999" style="width:58px;padding:7px 8px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><label style="display:flex;align-items:center;gap:4px;font-size:.76rem;color:var(--mt);cursor:pointer;white-space:nowrap"><input type="checkbox" id="nfirstuse" style="margin:0;width:auto;padding:0"> 1º uso</label><button onclick="generateKey()" style="padding:7px 14px;border-radius:5px;border:none;background:linear-gradient(135deg,#39ff14,#00ff88);color:#020604;font-size:.82rem;font-weight:700;cursor:pointer;white-space:nowrap">+ Gerar</button></div></div></div>`;
  const searchBar = `<div style="display:flex;flex-wrap:wrap;gap:6px;padding:10px 18px;border-bottom:1px solid #183326;align-items:center"><input type="text" id="search-input" placeholder="🔍 Buscar chave, cliente, telefone..." oninput="filterKeys()" style="flex:1;min-width:180px;padding:7px 11px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><select id="filter-status" onchange="filterKeys()" style="padding:7px 10px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><option value="">Todos</option><option value="active">PRO</option><option value="free">Free</option><option value="pending">Pendentes</option><option value="expired">Expiradas</option><option value="blocked">Bloqueadas</option></select><button onclick="doRefresh(true)" style="padding:7px 12px;border-radius:5px;border:1px solid #26543c;background:transparent;color:#39ff14;font-size:.8rem;cursor:pointer">↻ Atualizar</button><button onclick="exportCsv()" style="padding:7px 12px;border-radius:5px;border:1px solid #183326;background:transparent;color:#8ab89a;font-size:.8rem;cursor:pointer">↓ CSV</button><span id="last-r" style="font-size:.7rem;color:#5a8a6e">—</span></div>`;
  const keysSection = `<div id="tab-keys"><div class="sec"><div class="sh"><span class="sh-t">🔑 Licenças WaSpeed</span></div>${genForm}${searchBar}<div class="tbl-w" style="overflow-x:auto"><table style="min-width:920px"><thead><tr style="background:#070f0a"><th style="min-width:160px">Chave</th><th style="min-width:90px">Cliente</th><th style="min-width:80px">Status</th><th style="min-width:100px">Validade</th><th style="min-width:48px">Usos</th><th style="min-width:90px">Telefone</th><th style="min-width:86px">IP</th><th style="min-width:100px">Últ. acesso</th><th style="min-width:100px">Criada</th><th style="min-width:80px">Nota</th><th style="min-width:240px">Ações</th></tr></thead><tbody id="kb">${keysHtml}</tbody></table></div></div></div>`;
  const logTypeOpts = '<option value="">Todos os eventos</option><option value="login_ok">LOGIN</option><option value="key_created">CHAVE CRIADA</option><option value="key_delete">CHAVE EXCLUÍDA</option><option value="key_activated">CHAVE ATIVADA</option><option value="admin_login_fail">FALHA ADMIN</option>';
  const logsSection = `<div id="tab-logs" style="display:none"><div class="sec"><div class="sh"><span class="sh-t">📋 Logs do Sistema</span><button onclick="clearLogs()" style="padding:5px 12px;border-radius:5px;border:1px solid rgba(255,68,102,.3);background:transparent;color:#ff8899;font-size:.78rem;cursor:pointer">🗑 Limpar</button></div><div style="display:flex;flex-wrap:wrap;gap:6px;padding:10px 18px;border-bottom:1px solid #183326;align-items:center"><input type="text" id="logSearch" placeholder="Filtrar logs..." oninput="filterLog()" style="flex:1;min-width:180px;padding:7px 11px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><select id="logTypeFilter" onchange="filterLog()" style="padding:7px 10px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem">${logTypeOpts}</select></div><div class="tbl-w" style="max-height:52vh;overflow-y:auto;overflow-x:auto"><table style="min-width:600px"><thead><tr style="background:#070f0a"><th style="min-width:120px">Data/Hora</th><th style="min-width:110px">Evento</th><th style="min-width:90px">Chave</th><th style="min-width:90px">Telefone</th><th style="min-width:80px">IP</th><th style="min-width:180px">Mensagem</th></tr></thead><tbody id="logb">${logsHtml}</tbody></table></div></div></div>`;
  const _auditBase = JSON.stringify(auditBasePath || '');
  const auditJs = 'var _BASE='+_auditBase+';var _TESTS=[{id:"json404",label:"API /unknown retorna JSON",run:async function(){var r=await fetch(_BASE+"/api/__nonexistent_route__");var ct=r.headers.get("content-type")||"";if(!ct.includes("json")){return{pass:false,detail:"Content-Type: "+ct};}try{var j=await r.json();return{pass:true,detail:"status "+r.status};}catch(e){return{pass:false,detail:"SyntaxError: "+e.message};}}},{id:"injectLabel",label:"Injeção NoSQL em label rejeitada (400)",run:async function(){var r=await fetch(_BASE+"/api/probe/label",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({label:"{$gt:null}"})});var j=await r.json();return{pass:r.status===400&&j.error==="nosql_injection_detected",detail:"status "+r.status+" error="+j.error};}},{id:"labelLen",label:"Label > 60 chars rejeitada (400)",run:async function(){var r=await fetch(_BASE+"/api/probe/label",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({label:"A".repeat(61)})});var j=await r.json();return{pass:r.status===400&&j.error==="label_too_long",detail:"status "+r.status+" error="+j.error};}},{id:"noToken",label:"Endpoint interno sem access-token retorna 403",run:async function(){var r=await fetch(_BASE+"/api/user/update",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})});var j=await r.json();return{pass:r.status===403||j.msg_id==="invalid_access_token",detail:"status "+r.status+" msg="+j.msg_id};}},{id:"healthJson",label:"/health retorna JSON",run:async function(){var r=await fetch("/health");var ct=r.headers.get("content-type")||"";return{pass:ct.includes("json"),detail:"Content-Type: "+ct};}},{id:"xframe",label:"X-Frame-Options: DENY presente",run:async function(){var r=await fetch("/health");var h=r.headers.get("x-frame-options")||"";return{pass:h.toUpperCase()==="DENY",detail:"X-Frame-Options: "+h};}},{id:"csp",label:"Content-Security-Policy presente",run:async function(){var r=await fetch("/health");var h=r.headers.get("content-security-policy")||"";return{pass:h.length>0,detail:h.slice(0,60)||(h?"ok":"ausente")};}}];async function runAudit(){var tbody=document.getElementById("audit-body");if(!tbody)return;tbody.innerHTML=\'<tr><td colspan=3 style="padding:18px;text-align:center;color:#5a8a6e">Executando testes...</td></tr>\';var rows=[];for(var t of _TESTS){var res;try{res=await t.run();}catch(e){res={pass:false,detail:e.message};}var col=res.pass?"#39ff14":"#ff8899";var lbl=res.pass?"PASS":"FAIL";rows.push("<tr><td class=\\"zvm-td\\" style=\\"font-size:.82rem\\">"+t.label+"</td><td class=\\"zvm-td\\"><span style=\\"font-family:monospace;font-size:.72rem;font-weight:700;color:"+col+";background:"+col+"15;border:1px solid "+col+"28;padding:2px 9px;border-radius:4px\\">"+lbl+"</span></td><td class=\\"zvm-td zvm-muted\\" style=\\"font-size:.75rem\\">"+res.detail+"</td></tr>");}tbody.innerHTML=rows.join("");}';
  const auditSection = `<div id="tab-audit" style="display:none"><div class="sec"><div class="sh"><span class="sh-t">🛡️ Auditoria de Segurança</span><button onclick="runAudit()" style="padding:5px 12px;border-radius:5px;border:1px solid #26543c;background:transparent;color:#39ff14;font-size:.78rem;cursor:pointer">↻ Re-executar</button></div><div style="padding:14px 18px;font-size:.8rem;color:#5a8a6e;border-bottom:1px solid #183326">Testes automatizados contra as rotas do servidor.</div><div class="tbl-w"><table style="min-width:600px"><thead><tr style="background:#070f0a"><th style="min-width:260px">Teste</th><th style="min-width:80px">Status</th><th style="min-width:220px">Detalhe</th></tr></thead><tbody id="audit-body"><tr><td colspan="3" style="padding:18px;text-align:center;color:#5a8a6e">Clique na aba Auditoria para executar.</td></tr></tbody></table></div></div></div>`;
  return spaShell('Admin WSPEED', adminSidebar('keys'), 'WSPEED Admin', statsRow + keysSection + logsSection + auditSection + `<scr`+`ipt>${ADMIN_JS_SAFE}\n${auditJs}</scr`+`ipt>`);
}

function renderModDash(keysHtml, stats, modName) {
  const sc = (id, val, lbl, style) => `<div class="sc"><div class="n" id="${id}"${style?' style="'+style+'"':''}>${String(val)}</div><div class="l">${lbl}</div></div>`;
  const statsRow = `<div class="sc-row" style="margin-bottom:18px">${sc('s-total',stats.totalKeys,'Total','')}${sc('s-active',stats.activeKeys,'PRO Ativas','color:var(--ac)')}${sc('s-free',stats.freeKeys,'Free','')}${sc('s-expired',stats.expiredKeys,'Expiradas',stats.expiredKeys?'color:var(--dg)':'')}</div>`;
  const genForm = `<div style="padding:16px 18px;background:#020904;border-bottom:1px solid #183326"><div style="max-width:450px;background:#070f0a;border:1px solid #183326;border-radius:12px;padding:16px 18px"><div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#5a8a6e;margin-bottom:12px">Nova Chave PRO</div><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center"><input type="text" id="nlabel" placeholder="Nome do cliente" maxlength="60" style="flex:1;min-width:140px;padding:7px 10px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><input type="number" id="ndays" placeholder="Dias" min="0" max="9999" style="width:58px;padding:7px 8px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><input type="number" id="nhours" placeholder="H" min="0" max="23" style="width:46px;padding:7px 6px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><input type="number" id="nuses" placeholder="Usos" title="-1=∞" min="-1" max="9999" style="width:58px;padding:7px 8px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><label style="display:flex;align-items:center;gap:4px;font-size:.76rem;color:var(--mt);cursor:pointer;white-space:nowrap"><input type="checkbox" id="nfirstuse" style="margin:0;width:auto;padding:0"> 1º uso</label><button onclick="generateKey()" style="padding:7px 14px;border-radius:5px;border:none;background:linear-gradient(135deg,#39ff14,#00ff88);color:#020604;font-size:.82rem;font-weight:700;cursor:pointer;white-space:nowrap">+ Gerar</button></div></div></div>`;
  const searchBar = `<div style="display:flex;flex-wrap:wrap;gap:6px;padding:10px 18px;border-bottom:1px solid #183326;align-items:center"><input type="text" id="search-input" placeholder="🔍 Buscar chave, cliente, telefone..." oninput="filterKeys()" style="flex:1;min-width:180px;padding:7px 11px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><select id="filter-status" onchange="filterKeys()" style="padding:7px 10px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><option value="">Todos</option><option value="active">PRO</option><option value="pending">Pendentes</option><option value="expired">Expiradas</option></select><button onclick="doRefresh(true)" style="padding:7px 12px;border-radius:5px;border:1px solid #26543c;background:transparent;color:#39ff14;font-size:.8rem;cursor:pointer">↻ Atualizar</button><span id="last-r" style="font-size:.7rem;color:#5a8a6e">—</span></div>`;
  const MOD_JS = ADMIN_JS_SAFE.replace(/var _RA=/,'var _RA=').replace(JSON.stringify(R_WS_ADMIN), JSON.stringify(R_WS_MOD));
  const keysSection = `<div class="sec"><div class="sh"><span class="sh-t">🔑 Licenças WaSpeed</span>${modName?`<span style="font-size:.75rem;color:var(--mt)">Moderador: ${esc(modName)}</span>`:''}</div>${genForm}${searchBar}<div class="tbl-w" style="overflow-x:auto"><table style="min-width:920px"><thead><tr style="background:#070f0a"><th>Chave</th><th>Cliente</th><th>Status</th><th>Validade</th><th>Usos</th><th>Telefone</th><th>IP</th><th>Últ. acesso</th><th>Criada</th><th>Nota</th><th>Ações</th></tr></thead><tbody id="kb">${keysHtml}</tbody></table></div></div>`;
  return spaShell('Mod WaSpeed', modSidebar('keys'), 'WaSpeed Moderador', statsRow + keysSection + `<scr`+`ipt>${MOD_JS}</scr`+`ipt>`);
}

function renderSecurityAudit(basePath) {
  const auditJs = [
    'var _BASE=' + JSON.stringify(basePath) + ';',
    'var _TESTS=[',
    '{id:"json404",label:"API /unknown retorna JSON",run:async function(){var r=await fetch(_BASE+"/api/__nonexistent_route__");var ct=r.headers.get("content-type")||"";if(!ct.includes("json")){return{pass:false,detail:"Content-Type: "+ct};}try{var j=await r.json();return{pass:true,detail:"status "+r.status};}catch(e){return{pass:false,detail:"SyntaxError: "+e.message};}}},',
    '{id:"injectLabel",label:"Injeção NoSQL em label rejeitada (400)",run:async function(){var r=await fetch(_BASE+"/api/probe/label",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({label:"{$gt:null}"})});var j=await r.json();return{pass:r.status===400&&j.error==="nosql_injection_detected",detail:"status "+r.status+" error="+j.error};}},',
    '{id:"labelLen",label:"Label > 60 chars rejeitada (400)",run:async function(){var r=await fetch(_BASE+"/api/probe/label",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({label:"A".repeat(61)})});var j=await r.json();return{pass:r.status===400&&j.error==="label_too_long",detail:"status "+r.status+" error="+j.error};}},',
    '{id:"noToken",label:"Endpoint interno sem access-token retorna 403",run:async function(){var r=await fetch(_BASE+"/api/user/update",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})});var j=await r.json();return{pass:r.status===403||j.msg_id==="invalid_access_token",detail:"status "+r.status+" msg="+j.msg_id};}},',
    '{id:"healthJson",label:"/health retorna JSON",run:async function(){var r=await fetch("/health");var ct=r.headers.get("content-type")||"";return{pass:ct.includes("json"),detail:"Content-Type: "+ct};}},',
    '{id:"xframe",label:"X-Frame-Options: DENY presente",run:async function(){var r=await fetch("/health");var h=r.headers.get("x-frame-options")||"";return{pass:h.toUpperCase()==="DENY",detail:"X-Frame-Options: "+h};}},',
    '{id:"csp",label:"Content-Security-Policy presente",run:async function(){var r=await fetch("/health");var h=r.headers.get("content-security-policy")||"";return{pass:h.length>0,detail:h.slice(0,60)||(h?"ok":"ausente")};}},',
    '];',
    'async function runAudit(){var tbody=document.getElementById("audit-body");tbody.innerHTML="<tr><td colspan=3 style=\\"padding:18px;text-align:center;color:#5a8a6e\\">Executando testes...</td></tr>";var rows=[];for(var t of _TESTS){var res;try{res=await t.run();}catch(e){res={pass:false,detail:e.message};}var col=res.pass?"#39ff14":"#ff8899";var lbl=res.pass?"PASS":"FAIL";rows.push("<tr><td class=\\"zvm-td\\" style=\\"font-size:.82rem\\">"+t.label+"</td><td class=\\"zvm-td\\"><span style=\\"font-family:monospace;font-size:.72rem;font-weight:700;color:"+col+";background:"+col+"15;border:1px solid "+col+"28;padding:2px 9px;border-radius:4px\\">"+lbl+"</span></td><td class=\\"zvm-td zvm-muted\\" style=\\"font-size:.75rem\\">"+res.detail+"</td></tr>");}tbody.innerHTML=rows.join("");}',
    'runAudit();',
  ].join('\n');
  const body = `<div class="sec"><div class="sh"><span class="sh-t">🛡️ Auditoria de Segurança</span><button onclick="runAudit()" style="padding:5px 12px;border-radius:5px;border:1px solid #26543c;background:transparent;color:#39ff14;font-size:.78rem;cursor:pointer">↻ Re-executar</button></div><div style="padding:14px 18px;font-size:.8rem;color:#5a8a6e;border-bottom:1px solid #183326">Testes automatizados contra as rotas do servidor.</div><div class="tbl-w"><table style="min-width:600px"><thead><tr style="background:#070f0a"><th style="min-width:260px">Teste</th><th style="min-width:80px">Status</th><th style="min-width:220px">Detalhe</th></tr></thead><tbody id="audit-body"><tr><td colspan="3" style="padding:18px;text-align:center;color:#5a8a6e">Carregando...</td></tr></tbody></table></div></div><scr`+`ipt>${auditJs}</scr`+`ipt>`;
  return spaShell('Auditoria — WSPEED', adminSidebar('audit'), 'Auditoria de Segurança', body);
}

const PUB_CSS = `*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#020904;color:#e8fff3;min-height:100vh}:root{--ac:#39ff14;--dg:#ff4466;--bg:#020904;--bg2:#070f0a;--bdr:#183326;--tx:#e8fff3;--mt:#5a8a6e}.container{max-width:900px;margin:0 auto;padding:32px 16px}.card{background:#070f0a;border:1px solid #183326;border-radius:14px;padding:28px;margin-bottom:18px}.btn{display:inline-block;padding:10px 20px;border-radius:8px;border:none;background:linear-gradient(135deg,#39ff14,#00ff88);color:#020604;font-size:.88rem;font-weight:800;cursor:pointer;text-decoration:none}.btn-ghost{background:transparent;border:1px solid #183326;color:#8ab89a}.muted{color:#5a8a6e}nav{display:flex;align-items:center;padding:14px 20px;border-bottom:1px solid #183326;background:#040d06}.nav-logo{font-size:1rem;font-weight:900;color:#39ff14;text-decoration:none;letter-spacing:.05em}`;

function pubShell(title, body) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${PUB_CSS}</style></head><body>${CANVAS_BG}<nav><a href="${WS_BASE_PATH||'/'}" class="nav-logo">WSPEED</a></nav><div class="container" style="position:relative;z-index:1">${body}</div></body></html>`;
}

function renderPortal(chromeId) {
  const bp = WS_BASE_PATH || '';
  return pubShell('WSPEED — Extensão WhatsApp', `
<div class="card" style="text-align:center;padding:48px 28px">
<h1 style="font-size:2rem;font-weight:900;color:#39ff14;margin-bottom:10px">WSPEED</h1>
<p style="color:#5a8a6e;margin-bottom:24px">Extensão profissional para WhatsApp Web</p>
<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
${chromeId ? `<a class="btn" href="https://chromewebstore.google.com/detail/${esc(chromeId)}" target="_blank" rel="noopener">Instalar extensão</a>` : ''}
<a class="btn btn-ghost" href="${bp}/painel">Minha conta</a>
</div>
</div>`);
}

function clientShell(title, body) {
  return pubShell(title, body);
}

const CLIENT_PANEL_RE = /^\/painel(\/|$)/;

function renderClientAuthPainel(msg) {
  const bp = WS_BASE_PATH || '';
  const yr = new Date().getFullYear();
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WSPEED — Minha Conta</title>
<style>
${PUB_CSS}
.hero-nav{display:flex;align-items:center;justify-content:space-between;padding:13px 24px;background:#040d06;border-bottom:1px solid #183326;position:sticky;top:0;z-index:50}
.nav-links{display:flex;gap:6px;flex-wrap:wrap}
.nav-link{padding:5px 13px;border-radius:6px;border:1px solid #183326;background:transparent;color:#8ab89a;font-size:.77rem;cursor:pointer;text-decoration:none;transition:all .15s;display:inline-block}
.nav-link:hover{border-color:#39ff14;color:#39ff14}
.hero{text-align:center;padding:52px 16px 32px;max-width:540px;margin:0 auto}
.hero h1{font-size:2.1rem;font-weight:900;color:#39ff14;margin-bottom:10px}
.hero p{color:#5a8a6e;font-size:.92rem;line-height:1.6}
.lookup-card{max-width:480px;margin:0 auto 36px;background:#070f0a;border:1px solid #183326;border-radius:14px;padding:26px}
.lbl{font-size:.72rem;color:#5a8a6e;display:block;margin-bottom:5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
.inp{width:100%;padding:10px 13px;border-radius:7px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.86rem;transition:border-color .15s;box-sizing:border-box}
.inp:focus{outline:none;border-color:#39ff14}
.msg-ok{color:#39ff14;font-size:.78rem;background:rgba(57,255,20,.09);border:1px solid rgba(57,255,20,.2);border-radius:6px;padding:8px 12px;margin-bottom:12px}
.msg-err{color:#ff8899;font-size:.78rem;background:rgba(255,68,102,.09);border:1px solid rgba(255,68,102,.2);border-radius:6px;padding:8px 12px;margin-bottom:12px}
.badge{display:inline-block;padding:3px 11px;border-radius:20px;font-size:.72rem;font-weight:700;letter-spacing:.5px}
.badge-active{background:rgba(57,255,20,.15);color:#39ff14;border:1px solid rgba(57,255,20,.3)}
.badge-expired{background:rgba(255,68,102,.15);color:#ff8899;border:1px solid rgba(255,68,102,.3)}
.badge-blocked{background:rgba(255,150,0,.12);color:#ffaa33;border:1px solid rgba(255,150,0,.3)}
.badge-pending{background:rgba(255,204,0,.1);color:#ffcc00;border:1px solid rgba(255,204,0,.3)}
.info-row{display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-bottom:1px solid #0e1f14;font-size:.84rem}
.info-row:last-child{border-bottom:none}
.info-label{color:#5a8a6e}
.info-val{color:#e8fff3;font-weight:600}
.progress-bar{height:5px;border-radius:3px;background:#0d1f12;overflow:hidden;margin-top:5px}
.progress-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#39ff14,#00ff88)}
.device-table{width:100%;border-collapse:collapse;margin-top:6px}
.device-table td{padding:7px 8px;border-bottom:1px solid #0a1a0e;font-size:.81rem;vertical-align:middle}
.device-table td:first-child{color:#c8e8c8;font-family:monospace}
.device-table td:last-child{text-align:right}
.btn-remove{padding:3px 10px;border-radius:4px;border:1px solid rgba(255,68,102,.3);background:rgba(255,68,102,.07);color:#ff8899;font-size:.71rem;cursor:pointer;transition:all .12s}
.btn-remove:hover{background:rgba(255,68,102,.18)}
.section-wrap{max-width:640px;margin:0 auto 40px;padding:0 16px}
.section-wrap h2{font-size:1.05rem;font-weight:800;color:#e8fff3;margin-bottom:16px;text-align:center}
.faq-item{border:1px solid #183326;border-radius:8px;margin-bottom:7px;overflow:hidden}
.faq-q{padding:13px 16px;cursor:pointer;font-size:.84rem;font-weight:600;color:#e8fff3;display:flex;justify-content:space-between;align-items:center;background:#070f0a;user-select:none}
.faq-q:hover{background:#0a1a0e}
.faq-a{display:none;padding:11px 16px;font-size:.81rem;color:#8ab89a;line-height:1.65;background:#040d06}
.faq-arrow{transition:transform .18s;color:#5a8a6e;flex-shrink:0}
.faq-item.faq-open .faq-arrow{transform:rotate(180deg)}
.faq-item.faq-open .faq-a{display:block}
.plans-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
.plan-card{background:#070f0a;border:1px solid #183326;border-radius:12px;padding:20px 16px;text-align:center}
.plan-card.hl{border-color:rgba(57,255,20,.35);background:#030d06}
.plan-name{font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#5a8a6e;margin-bottom:7px}
.plan-price{font-size:1.45rem;font-weight:900;color:#39ff14;margin-bottom:3px}
.plan-sub{font-size:.69rem;color:#5a8a6e;margin-bottom:12px}
.plan-feat{font-size:.77rem;color:#8ab89a;line-height:1.85;list-style:none;padding:0;text-align:left}
.plan-feat li::before{content:"✓  ";color:#39ff14}
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:200;align-items:flex-start;justify-content:center;overflow-y:auto;padding:40px 16px}
.modal-overlay.open{display:flex}
.modal-box{background:#070f0a;border:1px solid #183326;border-radius:12px;padding:26px;max-width:520px;width:100%;position:relative;margin:auto}
.modal-close{position:absolute;top:12px;right:14px;background:transparent;border:none;color:#5a8a6e;font-size:1.15rem;cursor:pointer;padding:4px 8px;border-radius:4px;line-height:1}
.modal-close:hover{color:#e8fff3}
.site-footer{text-align:center;padding:24px 16px;border-top:1px solid #0d1f12;font-size:.71rem;color:#2d5c3e;margin-top:auto}
.site-footer a{color:#2d5c3e;text-decoration:underline}
.site-footer a:hover{color:#5a8a6e}
</style></head><body>
${CANVAS_BG}
<div style="position:relative;z-index:1;min-height:100vh;display:flex;flex-direction:column">

<nav class="hero-nav">
  <a href="${bp||'/'}" style="font-size:.92rem;font-weight:900;color:#39ff14;text-decoration:none;letter-spacing:.05em">⚡ WSPEED</a>
  <div class="nav-links">
    <a class="nav-link" href="#faq" onclick="event.preventDefault();scrollToId('ws-faq')">FAQ</a>
    <a class="nav-link" href="#planos" onclick="event.preventDefault();scrollToId('ws-plans')">Planos</a>
    <a class="nav-link" href="#" onclick="event.preventDefault();openWsModal('ws-privacy')">Privacidade</a>
    <a class="nav-link" href="mailto:suporte@wspeed.com.br">Suporte</a>
  </div>
</nav>

<div class="hero">
  <h1>⚡ WSPEED</h1>
  <p>Extensão profissional para WhatsApp Web.<br>Consulte e gerencie sua licença abaixo.</p>
</div>

<div class="lookup-card">
  ${msg ? `<div class="${msg.startsWith('✅') ? 'msg-ok' : 'msg-err'}">${esc(msg)}</div>` : ''}
  <div id="portal-content">
    <form id="ws-login-form">
      <label class="lbl">Chave de acesso</label>
      <input class="inp" id="ws-key-input" placeholder="ws-xxxxxxxx-xxxxxxxx-xxxxxxxx" autocomplete="off" spellcheck="false" style="margin-bottom:14px">
      <button class="btn" type="submit" id="ws-login-btn" style="width:100%">Consultar Licença</button>
    </form>
  </div>
</div>

<div id="ws-faq" class="section-wrap">
  <h2>Perguntas Frequentes</h2>
  <div class="faq-item" onclick="toggleWsFaq(this)"><div class="faq-q">Como funciona a licença WSPEED? <span class="faq-arrow">▼</span></div><div class="faq-a">A licença é vinculada a uma chave única usada para autenticar a extensão no WhatsApp Web. Cada chave pode ser usada em até N dispositivos, conforme o plano contratado.</div></div>
  <div class="faq-item" onclick="toggleWsFaq(this)"><div class="faq-q">Quantos dispositivos posso usar? <span class="faq-arrow">▼</span></div><div class="faq-a">Depende do plano: Individual (1 dispositivo), Padrão (3) e Team (5). Você pode visualizar e gerenciar seus dispositivos nesta página.</div></div>
  <div class="faq-item" onclick="toggleWsFaq(this)"><div class="faq-q">Como remover um dispositivo vinculado? <span class="faq-arrow">▼</span></div><div class="faq-a">Consulte sua chave abaixo e clique em "Remover" ao lado do número desejado. O slot é liberado imediatamente para uso em outro dispositivo.</div></div>
  <div class="faq-item" onclick="toggleWsFaq(this)"><div class="faq-q">Minha licença expirou, o que fazer? <span class="faq-arrow">▼</span></div><div class="faq-a">Entre em contato com o suporte para renovar. Após a renovação a chave volta a funcionar sem necessidade de reinstalar a extensão.</div></div>
  <div class="faq-item" onclick="toggleWsFaq(this)"><div class="faq-q">Como instalar a extensão? <span class="faq-arrow">▼</span></div><div class="faq-a">Acesse a Chrome Web Store e pesquise por WSPEED, ou use o link de instalação fornecido após a compra. Após instalar, abra o WhatsApp Web e insira sua chave quando solicitado.</div></div>
</div>

<div id="ws-plans" class="section-wrap">
  <h2>Planos</h2>
  <div class="plans-grid">
    <div class="plan-card"><div class="plan-name">Individual</div><div class="plan-price">R$ 29<span style="font-size:.82rem">/mês</span></div><div class="plan-sub">1 dispositivo</div><ul class="plan-feat"><li>1 slot de dispositivo</li><li>Todos os recursos</li><li>Suporte por e-mail</li></ul></div>
    <div class="plan-card hl"><div class="plan-name" style="color:#39ff14">Padrão ★</div><div class="plan-price">R$ 59<span style="font-size:.82rem">/mês</span></div><div class="plan-sub">3 dispositivos</div><ul class="plan-feat"><li>3 slots de dispositivo</li><li>Todos os recursos</li><li>Suporte prioritário</li></ul></div>
    <div class="plan-card"><div class="plan-name">Team</div><div class="plan-price">R$ 99<span style="font-size:.82rem">/mês</span></div><div class="plan-sub">5 dispositivos</div><ul class="plan-feat"><li>5 slots de dispositivo</li><li>Todos os recursos</li><li>Suporte premium</li></ul></div>
  </div>
</div>

<footer class="site-footer">
  © ${yr} WSPEED — Todos os direitos reservados &nbsp;·&nbsp;
  <a href="#" onclick="event.preventDefault();openWsModal('ws-privacy')">Política de Privacidade</a> &nbsp;·&nbsp;
  <a href="mailto:suporte@wspeed.com.br">suporte@wspeed.com.br</a>
</footer>
</div>

<div id="ws-privacy" class="modal-overlay" onclick="if(event.target===this)closeWsModal('ws-privacy')">
  <div class="modal-box">
    <button class="modal-close" onclick="closeWsModal('ws-privacy')">✕</button>
    <h2 style="font-size:.98rem;font-weight:800;color:#39ff14;margin-bottom:14px">Política de Privacidade — LGPD</h2>
    <p style="font-size:.81rem;color:#8ab89a;line-height:1.7;margin-bottom:11px">A WSPEED coleta apenas os dados estritamente necessários para o funcionamento do serviço, incluindo o número de WhatsApp vinculado à licença e o endereço IP para fins de segurança e controle de dispositivos.</p>
    <p style="font-size:.81rem;color:#8ab89a;line-height:1.7;margin-bottom:11px">Seus dados não são compartilhados com terceiros. Você pode solicitar a remoção dos seus dados a qualquer momento entrando em contato com nosso suporte.</p>
    <p style="font-size:.81rem;color:#8ab89a;line-height:1.7;margin-bottom:11px">Em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018), garantimos transparência, segurança e o direito de acesso e exclusão dos seus dados pessoais.</p>
    <p style="font-size:.71rem;color:#5a8a6e">Contato: <a href="mailto:suporte@wspeed.com.br" style="color:#39ff14">suporte@wspeed.com.br</a></p>
  </div>
</div>

<scr`+`ipt>
(function(){
var _BP='${bp}';
var _wsKey='';

function scrollToId(id){var el=document.getElementById(id);if(el)el.scrollIntoView({behavior:'smooth'});}
function openWsModal(id){document.getElementById(id).classList.add('open');}
function closeWsModal(id){document.getElementById(id).classList.remove('open');}
window.scrollToId=scrollToId;window.openWsModal=openWsModal;window.closeWsModal=closeWsModal;

function toggleWsFaq(item){var isOpen=item.classList.contains('faq-open');document.querySelectorAll('.faq-item.faq-open').forEach(function(i){i.classList.remove('faq-open');});if(!isOpen)item.classList.add('faq-open');}
window.toggleWsFaq=toggleWsFaq;

function wsEsc(s){var d=document.createElement('div');d.textContent=String(s||'');return d.innerHTML;}
function maskPhone(p){var s=String(p||'');return s.length>4?s.slice(0,s.length-4).replace(/\d/g,'•')+s.slice(-4):s;}
function fmtExpiry(iso){if(!iso)return'Sem expiração';var d=new Date(iso);var ms=d-Date.now();if(ms<0)return'Expirado';var days=Math.floor(ms/86400000);if(days>0)return days+' dia'+(days>1?'s':'')+' restante'+(days>1?'s':'');var hrs=Math.floor(ms/3600000);return hrs+' hora'+(hrs!==1?'s':'')+' restante'+(hrs!==1?'s':'');}

function updateDevCount(delta){
  var el=document.getElementById('ws-dev-used');
  var fill=document.getElementById('ws-dev-fill');
  if(!el)return;
  var cur=Math.max(0,(parseInt(el.dataset.used)||0)+delta);
  var max=parseInt(el.dataset.max)||0;
  el.dataset.used=cur;el.textContent=cur;
  if(fill&&max>0)fill.style.width=Math.min(100,(cur/max)*100)+'%';
}

window.wsRemoveDevice=function(phone,btn){
  var row=btn.closest('tr');
  btn.disabled=true;btn.textContent='...';
  fetch(_BP+'/api/remove-device',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:_wsKey,phone:phone})})
    .then(function(r){return r.json();})
    .then(function(j){
      if(j.ok){if(row)row.remove();updateDevCount(-1);}
      else{btn.disabled=false;btn.textContent='Remover';alert(j.msg||'Erro ao remover');}
    })
    .catch(function(){btn.disabled=false;btn.textContent='Remover';});
};

function buildDashboard(j){
  var statusBadge=j.status==='active'?'<span class="badge badge-active">ATIVO</span>':j.status==='expired'?'<span class="badge badge-expired">EXPIRADO</span>':j.status==='pending'?'<span class="badge badge-pending">PENDENTE</span>':'<span class="badge badge-blocked">BLOQUEADO</span>';
  var maxU=j.maxUses>0?j.maxUses:(j.maxUses===-1?0:3);
  var devUsed=j.phones||0;
  var maxLabel=maxU?maxU:'∞';
  var pct=maxU?Math.min(100,(devUsed/maxU)*100):0;
  var phoneRows=(j.phoneList||[]).map(function(p){
    var masked=maskPhone(p);
    var sp=wsEsc(p).replace(/'/g,'&#39;');
    return'<tr><td>📱 '+masked+'</td><td><button class="btn-remove" onclick="wsRemoveDevice(\''+sp+'\',this)">Remover</button></td></tr>';
  }).join('');
  if(!phoneRows)phoneRows='<tr><td colspan="2" style="color:#2a4a36;font-size:.79rem;padding:10px 0">Nenhum dispositivo vinculado</td></tr>';
  var html='<div class="msg-ok">✅ Licença encontrada</div>';
  html+='<div style="margin-top:4px">';
  html+='<div class="info-row"><span class="info-label">Identificação</span><span class="info-val">'+wsEsc(j.label||_wsKey.slice(0,16)+'...')+'</span></div>';
  html+='<div class="info-row"><span class="info-label">Status</span>'+statusBadge+'</div>';
  html+='<div class="info-row"><span class="info-label">Validade</span><span class="info-val">'+wsEsc(fmtExpiry(j.expiresAt))+'</span></div>';
  html+='<div class="info-row"><span class="info-label">Dispositivos</span><div style="text-align:right"><span class="info-val"><span id="ws-dev-used" data-used="'+devUsed+'" data-max="'+maxU+'">'+devUsed+'</span> / '+maxLabel+'</span>';
  if(maxU)html+='<div class="progress-bar"><div class="progress-fill" id="ws-dev-fill" style="width:'+pct+'%"></div></div>';
  html+='</div></div>';
  html+='<div style="padding:10px 0"><span class="info-label">Celulares vinculados</span><table class="device-table"><tbody>'+phoneRows+'</tbody></table></div>';
  html+='</div>';
  html+='<button class="btn" onclick="wsReset()" style="width:100%;margin-top:16px;background:transparent;border:1px solid #183326;color:#8ab89a">Consultar outra chave</button>';
  return html;
}

window.wsReset=function(){
  _wsKey='';
  document.getElementById('portal-content').innerHTML='<form id="ws-login-form"><label class="lbl">Chave de acesso</label><input class="inp" id="ws-key-input" placeholder="ws-xxxxxxxx-xxxxxxxx-xxxxxxxx" autocomplete="off" spellcheck="false" style="margin-bottom:14px"><button class="btn" type="submit" id="ws-login-btn" style="width:100%">Consultar Licença</button></form>';
  document.getElementById('ws-login-form').addEventListener('submit',handleWsSubmit);
};

function handleWsSubmit(e){
  e.preventDefault();
  var btn=document.getElementById('ws-login-btn');
  btn.disabled=true;btn.textContent='Verificando...';
  var key=(document.getElementById('ws-key-input').value||'').trim();
  if(!key){btn.disabled=false;btn.textContent='Consultar Licença';return;}
  _wsKey=key;
  fetch(_BP+'/api/auth/validate-portal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:key})})
    .then(function(r){return r.json();})
    .then(function(j){
      if(j.ok){document.getElementById('portal-content').innerHTML=buildDashboard(j);}
      else{document.getElementById('portal-content').innerHTML='<div class="msg-err">❌ '+wsEsc(j.msg||'Chave inválida ou não encontrada')+'</div><button class="btn" onclick="wsReset()" style="width:100%;background:transparent;border:1px solid #183326;color:#8ab89a;margin-top:12px">Tentar novamente</button>';}
    })
    .catch(function(){btn.disabled=false;btn.textContent='Consultar Licença';});
}

document.getElementById('ws-login-form').addEventListener('submit',handleWsSubmit);
})();
</scr`+`ipt></body></html>`;
}

async function handleClientPanel(req, res, pathname) {
  if (!CLIENT_PANEL_RE.test(pathname)) return false;
  const sub = pathname.replace(CLIENT_PANEL_RE, '/') || '/';
  if (sub === '/auth-painel' || sub === '/auth-painel/') {
    sendHtml(res, renderClientAuthPainel(''));
    return true;
  }
  if (sub === '/portal' && req.method === 'POST') {
    const body = await readJson(req);
    const phone = sanitizeInput(String(body.phone || ''), 20);
    if (!phone) { sendJson(res, { ok: false, msg: 'Informe o número' }); return true; }
    const code = await findKeyCodeByPhone(phone);
    if (!code) { sendJson(res, { ok: false, msg: 'Número não encontrado' }); return true; }
    const rec  = await findKey(code);
    if (!rec)  { sendJson(res, { ok: false, msg: 'Chave não encontrada' }); return true; }
    const st   = keyStatus(rec);
    sendJson(res, { ok: true, status: st, expiresAt: rec.expiresAt, code: code.replace(/.(?=.{4})/g, '*') });
    return true;
  }
  if (sub === '/remove-phone' && req.method === 'POST') {
    if (!checkRateLimit(req.socket?.remoteAddress || '', 'api')) { sendJson(res, { error: 'rate_limited' }, 429); return true; }
    const body = await readJson(req);
    const code = normKey(String(body.key || ''));
    const ph   = sanitizeInput(String(body.phone || ''), 20);
    if (!code || !ph) { sendJson(res, { ok: false }); return true; }
    const rec  = await findKey(code);
    if (!rec)  { sendJson(res, { ok: false }); return true; }
    await dbWS.collection(COL.licenses).updateOne({ code: normKey(code) }, { $pull: { phones: ph } });
    invalidateKeysCache();
    sendJson(res, { ok: true });
    return true;
  }
  sendHtml(res, renderClientAuthPainel(''));
  return true;
}

async function handleWaSpeedApi(req, res, pathname, ip) {
  if (pathname.startsWith('/api/urls/')) {
    const parts = pathname.split('/');
    const action = parts[3];
    const extId  = parts[4] || '';
    if (action === 'install') {
      sendJson(res, { url: WS_BASE_URL, extensionId: extId });
      return;
    }
    if (action === 'uninstall') {
      sendJson(res, { url: WS_BASE_URL + '/obrigado', extensionId: extId });
      return;
    }
    if (action === 'active-notes' || action === 'notes') {
      sendJson(res, { notes: [] });
      return;
    }
    sendJson(res, {}, 404);
    return;
  }

  if (pathname === '/api/services/update') {
    sendJson(res, { update: false, version: '5.0.0' });
    return;
  }

  if (pathname === '/api/probe/label' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'api')) { sendJson(res, { error: 'rate_limited' }, 429); return; }
    const rawBody = await readBody(req);
    let raw = '';
    try { const parsed = JSON.parse(rawBody); raw = String(parsed.label || ''); } catch { raw = ''; }
    if (raw.length > 60) { sendJson(res, { error: 'label_too_long' }, 400); return; }
    if (NOSQL_OP_RE.test(raw)) { sendJson(res, { error: 'nosql_injection_detected' }, 400); return; }
    sendJson(res, { ok: true });
    return;
  }

  if (pathname === '/api/auth/validate-portal' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'api')) { sendJson(res, { ok: false, msg: 'Muitas tentativas' }, 429); return; }
    const body = await readJson(req);
    const code = normKey(sanitizeInput(String(body.key || ''), 60));
    if (!code) { sendJson(res, { ok: false, msg: 'Chave inválida' }); return; }
    const rec  = await findKey(code);
    if (!rec) { sendJson(res, { ok: false, msg: 'Chave não encontrada' }); return; }
    const st   = keyStatus(rec);
    const up   = buildUserPremium(code, rec);
    sendJson(res, {
      ok:        true,
      status:    st,
      label:     rec.label || '',
      plan:      (up && up.plan) || (rec.expiresAt ? 'paid' : 'free'),
      expiresAt: rec.expiresAt || null,
      phones:    (rec.phones || []).length,
      phoneList: (rec.phones || []),
      maxUses:   rec.maxUses != null ? rec.maxUses : -1,
      dailyUses: rec.uses || 0,
      features:  (up && up.features) || [],
    });
    return;
  }

  if (pathname === '/api/remove-device' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'api')) { sendJson(res, { error: 'rate_limited' }, 429); return; }
    const body = await readJson(req);
    const code = normKey(sanitizeInput(String(body.key || ''), 60));
    const ph   = sanitizeInput(String(body.phone || ''), 20);
    if (!code || !ph) { sendJson(res, { ok: false, msg: 'Parâmetros inválidos' }, 400); return; }
    const rec = await findKey(code);
    if (!rec) { sendJson(res, { ok: false, msg: 'Chave não encontrada' }, 404); return; }
    await dbWS.collection(COL.licenses).updateOne({ code: normKey(code) }, { $pull: { phones: ph } });
    invalidateKeysCache();
    sendJson(res, { ok: true });
    return;
  }

  if (pathname.startsWith('/api/auth/login/') && req.method === 'POST') {
    const extId = pathname.slice('/api/auth/login/'.length);
    if (!extId) { sendJson(res, { success: false, msg_id: 'invalid_access_token' }, 403); return; }
    if (!checkRateLimit(ip, 'login')) { sendJson(res, { success: false, msg_id: 'rate_limited' }, 429); return; }
    const body  = await readJson(req);
    const code  = normKey(sanitizeInput(String(body.key || body.codigo || body.senha || ''), 60));
    if (!code) { sendJson(res, { success: false, msg_id: 'invalid_key' }, 400); return; }
    const rec   = await findKey(code);
    if (!rec) { sendJson(res, { success: false, msg_id: 'invalid_key' }, 401); return; }
    const phone = sanitizeInput(String(body.phone || body.whatsapp || ''), 20);
    let result;
    try { result = await authSuccess(code, rec, { phone, ip }); }
    catch { sendJson(res, { success: false, msg_id: 'server_error' }, 500); return; }
    if (!result.ok) { sendJson(res, { success: false, msg_id: result.msg_id }, 401); return; }
    try { await addLog('login_ok', 'Login: ' + code, { code, ip, phone }); } catch {}
    const recFreshLogin = await findKey(code) || rec;
    const _stLogin = keyStatus(recFreshLogin);
    sendJson(res, { success: true, user_status: _stLogin, user: keyToUser(code, recFreshLogin), auth_google: null });
    return;
  }

  if (pathname === '/api/auth/login-bearer' && req.method === 'POST') {
    const bearer = parseBearer(req);
    if (!bearer) { sendJson(res, { success: false, msg_id: 'missing_bearer' }, 401); return; }
    const rec = await findKeyByBearer(bearer);
    if (!rec)  { sendJson(res, { success: false, msg_id: 'invalid_bearer' }, 401); return; }
    let result;
    try { result = await authSuccess(rec.code, rec, { ip }); }
    catch { sendJson(res, { success: false, msg_id: 'server_error' }, 500); return; }
    if (!result.ok) { sendJson(res, { success: false, msg_id: result.msg_id }, 401); return; }
    const _stBearer = keyStatus(rec);
    sendJson(res, { success: true, user_status: _stBearer, user: keyToUser(rec.code, rec), auth_google: null });
    return;
  }

  if (pathname.startsWith('/api/auth/register-free') && req.method === 'POST') {
    const body = await readJson(req);
    const phone = sanitizeInput(String(body.phone || ''), 20);
    sendJson(res, { success: true, user_id: 'free_' + (phone || ip), plan: 'free' });
    return;
  }

  if (pathname.startsWith('/api/auth/validation') && req.method === 'POST') {
    const bearer = parseBearer(req);
    if (bearer) {
      const rec = await findKeyByBearer(bearer);
      if (rec) {
        const st = keyStatus(rec);
        sendJson(res, { success: st === 'active', user_status: st, user: keyToUser(rec.code, rec), auth_google: null });
        return;
      }
    }
    if (!checkRateLimit(ip, 'login')) { sendJson(res, { success: false, msg_id: 'rate_limited' }, 429); return; }
    const body    = await readJson(req);
    const rawCode = String(body.email || body.access_token_plugin || body.key || '').replace(/@waspeed\.local$/i, '');
    const code    = normKey(sanitizeInput(rawCode, 60));
    if (!code) { sendJson(res, { success: false, msg_id: 'invalid_key' }, 400); return; }
    const rec = await findKey(code);
    if (!rec)            { sendJson(res, { success: false, msg_id: 'invalid_key' }, 401); return; }
    if (!rec.active)     { sendJson(res, { success: false, msg_id: 'user_blocked' }, 401); return; }
    if (isKeyExpiredWs(rec)) { sendJson(res, { success: false, msg_id: 'license_expired' }, 401); return; }
    const phone  = sanitizeInput(String(body.whatsapp_plugin || body.phone || ''), 20);
    let result;
    try { result = await authSuccess(code, rec, { ip, phone }); }
    catch { sendJson(res, { success: false, msg_id: 'server_error' }, 500); return; }
    if (!result.ok) { sendJson(res, { success: false, msg_id: result.msg_id }, 401); return; }
    try { await addLog('login_ok', 'Login via chave patcher: ' + code, { code, ip }); } catch {}
    const recFresh = await findKey(code) || rec;
    const st = keyStatus(recFresh);
    sendJson(res, { success: true, user_status: st, user: keyToUser(code, recFresh), auth_google: null });
    return;
  }

  if (!requireAccessToken(req)) {
    sendJson(res, { success: false, msg_id: 'invalid_access_token' }, 403);
    return;
  }

  if (pathname === '/api/user/update' && req.method === 'POST') {
    const bearer = parseBearer(req);
    if (!bearer) { sendJson(res, { success: false }, 401); return; }
    const rec = await findKeyByBearer(bearer);
    if (!rec)  { sendJson(res, { success: false }, 401); return; }
    sendJson(res, { success: true });
    return;
  }

  if (pathname === '/api/initial-data' && req.method === 'GET') {
    const bearer = parseBearer(req);
    const rec    = bearer ? await findKeyByBearer(bearer) : null;
    sendJson(res, {
      success: true,
      user:    rec ? keyToUser(rec.code, rec) : EMPTY_AUTH_GOOGLE,
      config:  buildConfigJson(await getSettingsAdmin()),
    });
    return;
  }

  if (pathname.startsWith('/api/XLSX/') || pathname.startsWith('/api/audio/')) {
    sendJson(res, { success: false, msg_id: 'not_configured' }, 501);
    return;
  }

  sendJson(res, { success: false, msg_id: 'not_found' }, 404);
}

function adminApiRe(suffix) {
  suffix = suffix || '';
  const base = R_WS_ADMIN.replace(/[.*+?^${}()|[\]\\]/g, ch => '\\' + ch);
  return new RegExp('^' + base + '/api/(?:keys/)?([^/]+)' + suffix + '$');
}

async function requireAdminSession(req, res) {
  const sess = await validateSession(parseCookies(req)[WS_COOKIE_NAME]);
  if (!sess || sess.role !== 'admin') {
    res.writeHead(302, { Location: R_WS_ADMIN + '/login' });
    res.end();
    return null;
  }
  return sess;
}

async function handleAdminApi(req, res, pathname) {
  if (pathname === R_WS_ADMIN + '/api/data' && req.method === 'GET') {
    const stats    = await getKeyStats();
    const licenses = await getKeysCached();
    const logsList = await getRecentLogs(100);
    sendJsonGzip(req, res, { ok: true, ...stats, keysHtml: buildLicenseRows(licenses), logsHtml: buildLogRows(logsList) });
    return true;
  }
  if (pathname === R_WS_ADMIN + '/api/keys' && req.method === 'POST') {
    const body     = await readJson(req);
    const rawLabel = sanitizeInput(String(body.label || '').trim(), 60);
    if (!rawLabel) { sendJson(res, { error: 'label_required' }, 400); return true; }
    if (rawLabel.length > 60) { sendJson(res, { error: 'label_too_long' }, 400); return true; }
    if (detectInjection(rawLabel)) { sendJson(res, { error: 'invalid_input' }, 400); return true; }
    const { expiresAt } = parseLicenseExpiry(body);
    const maxUses = body.maxUses !== undefined ? parseInt(body.maxUses, 10) : -1;
    try {
      const rec = await createKey({ label: rawLabel, premium: true, expiresAt, maxUses: isNaN(maxUses) ? -1 : maxUses, note: sanitizeInput(String(body.note || ''), 500), ativarNoPrimeiroUso: body.ativarNoPrimeiroUso === true });
      sendJson(res, { ok: true, key: rec.code });
    } catch (e) { if (!res.headersSent) sendJson(res, { error: e.message }, 500); }
    return true;
  }
  if (pathname === R_WS_ADMIN + '/api/logs/clear' && req.method === 'POST') {
    if (dbWS) await dbWS.collection(COL.logs).deleteMany({});
    sendJson(res, { ok: true });
    return true;
  }
  if (pathname === R_WS_ADMIN + '/api/export/csv' && req.method === 'GET') {
    const licenses = await listLicenses();
    const lines = ['code,label,premium,active,expiresAt,uses,maxUses,lastPhone,lastIp,createdAt,note'];
    for (const k of licenses) lines.push([k.code,k.label,k.premium,k.active,k.expiresAt||'',(k.phones||[]).length,k.maxUses!=null?k.maxUses:-1,k.lastPhone||'',k.lastIp||'',k.createdAt||'',(k.note||'').replace(/,/g,';')].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','));
    res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="waspeed-licenses.csv"'});
    res.end('﻿' + lines.join('\n'));
    return true;
  }
  const extractCodeFrom = (re) => { const m = pathname.match(re); return m ? decodeURIComponent(m[1]) : null; };
  const codeActivate = extractCodeFrom(new RegExp('^' + R_WS_ADMIN.replace(/[.*+?^${}()|[\]\\]/g,ch=>'\\'+ch) + '/api/activate/([^/]+)$'));
  if (codeActivate && req.method === 'POST') {
    const rec = await findKey(codeActivate);
    if (!rec) { sendJson(res, { error: 'not found' }, 404); return true; }
    await updateLicense(rec.code, { ativarNoPrimeiroUso: false, primeiroUsoAt: new Date().toISOString(), active: true });
    sendJson(res, { ok: true }); return true;
  }
  const codeToggle = extractCodeFrom(new RegExp('^' + R_WS_ADMIN.replace(/[.*+?^${}()|[\]\\]/g,ch=>'\\'+ch) + '/api/toggle/([^/]+)$'));
  if (codeToggle && req.method === 'POST') {
    const rec = await findKey(codeToggle);
    if (!rec) { sendJson(res, { error: 'not found' }, 404); return true; }
    await updateLicense(rec.code, { active: !rec.active });
    sendJson(res, { ok: true, active: !rec.active }); return true;
  }
  const codeRenew = extractCodeFrom(new RegExp('^' + R_WS_ADMIN.replace(/[.*+?^${}()|[\]\\]/g,ch=>'\\'+ch) + '/api/renew/([^/]+)$'));
  if (codeRenew && req.method === 'POST') {
    const rec   = await findKey(codeRenew);
    if (!rec) { sendJson(res, { error: 'not found' }, 404); return true; }
    const rb    = await readJson(req);
    const addMs = ((parseInt(rb.days||0,10)*1440)+(parseInt(rb.hours||0,10)*60))*60000;
    if (!addMs) { sendJson(res, { error: 'informe tempo' }, 400); return true; }
    const base  = (rec.expiresAt && new Date(rec.expiresAt).getTime()>Date.now()) ? new Date(rec.expiresAt).getTime() : Date.now();
    await updateLicense(rec.code, { expiresAt: new Date(base+addMs).toISOString(), active: true });
    sendJson(res, { ok: true }); return true;
  }
  const codeMaxUses = extractCodeFrom(new RegExp('^' + R_WS_ADMIN.replace(/[.*+?^${}()|[\]\\]/g,ch=>'\\'+ch) + '/api/max-uses/([^/]+)$'));
  if (codeMaxUses && req.method === 'POST') {
    const rec  = await findKey(codeMaxUses);
    if (!rec) { sendJson(res, { error: 'not found' }, 404); return true; }
    const mb   = await readJson(req);
    const mu   = parseInt(mb.maxUses,10);
    if (isNaN(mu)||mu<-1) { sendJson(res, { error: 'invalid' }, 400); return true; }
    await updateLicense(rec.code, { maxUses: mu });
    sendJson(res, { ok: true, maxUses: mu }); return true;
  }
  const codeNote = extractCodeFrom(new RegExp('^' + R_WS_ADMIN.replace(/[.*+?^${}()|[\]\\]/g,ch=>'\\'+ch) + '/api/note/([^/]+)$'));
  if (codeNote && req.method === 'POST') {
    const rec  = await findKey(codeNote);
    if (!rec) { sendJson(res, { error: 'not found' }, 404); return true; }
    const nb   = await readJson(req);
    const note = sanitizeInput(String(nb.note!=null?nb.note:''), 500);
    await dbWS.collection(COL.licenses).updateOne({ code: normKey(codeNote) }, { $set: { note } });
    invalidateKeysCache(); sendJson(res, { ok: true, note }); return true;
  }
  const codeRename = extractCodeFrom(new RegExp('^' + R_WS_ADMIN.replace(/[.*+?^${}()|[\]\\]/g,ch=>'\\'+ch) + '/api/rename/([^/]+)$'));
  if (codeRename && req.method === 'POST') {
    const rec  = await findKey(codeRename);
    if (!rec) { sendJson(res, { error: 'not found' }, 404); return true; }
    const rb   = await readJson(req);
    const lbl  = sanitizeInput(String(rb.label||'').trim(), 60);
    if (!lbl) { sendJson(res, { error: 'label required' }, 400); return true; }
    await dbWS.collection(COL.licenses).updateOne({ code: normKey(codeRename) }, { $set: { label: lbl } });
    invalidateKeysCache(); sendJson(res, { ok: true, label: lbl }); return true;
  }
  const codeRemPhone = extractCodeFrom(new RegExp('^' + R_WS_ADMIN.replace(/[.*+?^${}()|[\]\\]/g,ch=>'\\'+ch) + '/api/remove-phone/([^/]+)$'));
  if (codeRemPhone && req.method === 'POST') {
    const rec  = await findKey(codeRemPhone);
    if (!rec) { sendJson(res, { error: 'not found' }, 404); return true; }
    const pb   = await readJson(req);
    const ph   = sanitizeInput(String(pb.phone||'').trim(), 20);
    if (!ph) { sendJson(res, { error: 'phone required' }, 400); return true; }
    await dbWS.collection(COL.licenses).updateOne({ code: normKey(codeRemPhone) }, { $pull: { phones: ph } });
    invalidateKeysCache(); sendJson(res, { ok: true }); return true;
  }
  const codeRemAll = extractCodeFrom(new RegExp('^' + R_WS_ADMIN.replace(/[.*+?^${}()|[\]\\]/g,ch=>'\\'+ch) + '/api/remove-all-phones/([^/]+)$'));
  if (codeRemAll && req.method === 'POST') {
    const rec  = await findKey(codeRemAll);
    if (!rec) { sendJson(res, { error: 'not found' }, 404); return true; }
    await dbWS.collection(COL.licenses).updateOne({ code: normKey(codeRemAll) }, { $set: { phones: [], uses: 0 } });
    invalidateKeysCache(); sendJson(res, { ok: true }); return true;
  }
  const codeDel = extractCodeFrom(new RegExp('^' + R_WS_ADMIN.replace(/[.*+?^${}()|[\]\\]/g,ch=>'\\'+ch) + '/api/keys/([^/]+)$'));
  if (codeDel && req.method === 'DELETE') {
    await deleteLicense(codeDel);
    await addLog('key_delete', 'Chave ' + codeDel + ' excluída', { code: codeDel });
    sendJson(res, { ok: true }); return true;
  }
  return false;
}

async function requireModSession(req, res) {
  const sess = await validateSession(parseCookies(req)[WS_COOKIE_NAME]);
  if (!sess || (sess.role !== 'mod' && sess.role !== 'admin')) {
    res.writeHead(302, { Location: R_WS_MOD + '/login' });
    res.end();
    return null;
  }
  return sess;
}

function modApiRe(suffix) {
  suffix = suffix || '';
  const base = R_WS_MOD.replace(/[.*+?^${}()|[\]\\]/g, ch => '\\' + ch);
  return new RegExp('^' + base + '/api/(?:keys/)?([^/]+)' + suffix + '$');
}

async function handleModApi(req, res, pathname, sess) {
  if (pathname === R_WS_MOD + '/api/data' && req.method === 'GET') {
    const stats    = await getKeyStats();
    const licenses = await getKeysCached();
    sendJsonGzip(req, res, { ok: true, ...stats, keysHtml: buildLicenseRows(licenses) });
    return true;
  }
  if (pathname === R_WS_MOD + '/api/keys' && req.method === 'POST') {
    const body     = await readJson(req);
    const rawLabel = sanitizeInput(String(body.label||'').trim(), 60);
    if (!rawLabel)          { sendJson(res, { error: 'label_required' }, 400); return true; }
    if (rawLabel.length>60) { sendJson(res, { error: 'label_too_long' }, 400); return true; }
    if (detectInjection(rawLabel)) { sendJson(res, { error: 'invalid_input' }, 400); return true; }
    const { expiresAt } = parseLicenseExpiry(body);
    const maxUses = body.maxUses !== undefined ? parseInt(body.maxUses,10) : -1;
    try {
      const rec = await createKey({ label: rawLabel, premium: true, expiresAt, maxUses: isNaN(maxUses)?-1:maxUses, note: sanitizeInput(String(body.note||''),500), ativarNoPrimeiroUso: body.ativarNoPrimeiroUso===true, modName: sess&&sess.modName?sess.modName:null });
      sendJson(res, { ok: true, key: rec.code });
    } catch(e) { if (!res.headersSent) sendJson(res, { error: e.message }, 500); }
    return true;
  }
  const extractCode = (re) => { const m = pathname.match(re); return m ? decodeURIComponent(m[1]) : null; };
  const base = R_WS_MOD.replace(/[.*+?^${}()|[\]\\]/g,ch=>'\\'+ch);
  const codeActivate = extractCode(new RegExp('^'+base+'/api/activate/([^/]+)$'));
  if (codeActivate && req.method==='POST') {
    const rec = await findKey(codeActivate); if (!rec){sendJson(res,{error:'not found'},404);return true;}
    await updateLicense(rec.code,{ativarNoPrimeiroUso:false,primeiroUsoAt:new Date().toISOString(),active:true});
    sendJson(res,{ok:true});return true;
  }
  const codeToggle = extractCode(new RegExp('^'+base+'/api/toggle/([^/]+)$'));
  if (codeToggle && req.method==='POST') {
    const rec = await findKey(codeToggle); if (!rec){sendJson(res,{error:'not found'},404);return true;}
    await updateLicense(rec.code,{active:!rec.active});sendJson(res,{ok:true,active:!rec.active});return true;
  }
  const codeRenew = extractCode(new RegExp('^'+base+'/api/renew/([^/]+)$'));
  if (codeRenew && req.method==='POST') {
    const rec = await findKey(codeRenew); if (!rec){sendJson(res,{error:'not found'},404);return true;}
    const rb  = await readJson(req);
    const addMs = ((parseInt(rb.days||0,10)*1440)+(parseInt(rb.hours||0,10)*60))*60000;
    if (!addMs){sendJson(res,{error:'informe tempo'},400);return true;}
    const base2 = (rec.expiresAt&&new Date(rec.expiresAt).getTime()>Date.now())?new Date(rec.expiresAt).getTime():Date.now();
    await updateLicense(rec.code,{expiresAt:new Date(base2+addMs).toISOString(),active:true});
    sendJson(res,{ok:true});return true;
  }
  const codeNote = extractCode(new RegExp('^'+base+'/api/note/([^/]+)$'));
  if (codeNote && req.method==='POST') {
    const rec = await findKey(codeNote); if (!rec){sendJson(res,{error:'not found'},404);return true;}
    const nb  = await readJson(req);
    const note = sanitizeInput(String(nb.note!=null?nb.note:''),500);
    await dbWS.collection(COL.licenses).updateOne({code:normKey(codeNote)},{$set:{note}});
    invalidateKeysCache();sendJson(res,{ok:true,note});return true;
  }
  const codeRename = extractCode(new RegExp('^'+base+'/api/rename/([^/]+)$'));
  if (codeRename && req.method==='POST') {
    const rec = await findKey(codeRename); if (!rec){sendJson(res,{error:'not found'},404);return true;}
    const rb  = await readJson(req);
    const lbl = sanitizeInput(String(rb.label||'').trim(),60);
    if (!lbl){sendJson(res,{error:'label required'},400);return true;}
    await dbWS.collection(COL.licenses).updateOne({code:normKey(codeRename)},{$set:{label:lbl}});
    invalidateKeysCache();sendJson(res,{ok:true,label:lbl});return true;
  }
  const codeRemPhone = extractCode(new RegExp('^'+base+'/api/remove-phone/([^/]+)$'));
  if (codeRemPhone && req.method==='POST') {
    const rec = await findKey(codeRemPhone); if (!rec){sendJson(res,{error:'not found'},404);return true;}
    const pb  = await readJson(req);
    const ph  = sanitizeInput(String(pb.phone||'').trim(),20);
    if (!ph){sendJson(res,{error:'phone required'},400);return true;}
    await dbWS.collection(COL.licenses).updateOne({code:normKey(codeRemPhone)},{$pull:{phones:ph}});
    invalidateKeysCache();sendJson(res,{ok:true});return true;
  }
  const codeRemAll = extractCode(new RegExp('^'+base+'/api/remove-all-phones/([^/]+)$'));
  if (codeRemAll && req.method==='POST') {
    const rec = await findKey(codeRemAll); if (!rec){sendJson(res,{error:'not found'},404);return true;}
    await dbWS.collection(COL.licenses).updateOne({code:normKey(codeRemAll)},{$set:{phones:[],uses:0}});
    invalidateKeysCache();sendJson(res,{ok:true});return true;
  }
  return false;
}


async function handleMod(req, res, pathname, ip) {
  if (pathname === R_WS_MOD + '/login') {
    if (req.method === 'GET') { sendHtml(res, renderAdminLogin(R_WS_MOD, 'Moderador')); return; }
    if (!checkRate(ip)) { sendHtml(res, renderAdminLogin(R_WS_MOD, 'Moderador', 'Muitas tentativas. Aguarde.'), 429); return; }
    const raw    = await readBody(req);
    const params = new URLSearchParams(raw);
    const user   = sanitizeInput(params.get('user') || '', 60);
    const pass   = params.get('pass') || '';
    const mod    = await verifyModCredentials(user, pass);
    if (mod) {
      const session = await createSession('mod', { user: user.trim(), modName: mod.name, modId: mod.modId || mod.user });
      if (!session) { sendHtml(res, renderAdminLogin(R_WS_MOD, 'Moderador', 'Erro ao criar sessao'), 500); return; }
      setSessionCookie(res, session.token);
      res.writeHead(302, { Location: R_WS_MOD }); res.end(); return;
    }
    await addLog('admin_login_fail', 'Tentativa mod invalida', { ip });
    sendHtml(res, renderAdminLogin(R_WS_MOD, 'Moderador', 'Credenciais invalidas'), 401);
    return;
  }
  if (pathname === R_WS_MOD + '/logout') {
    await destroySession(parseCookies(req)[WS_COOKIE_NAME]);
    clearSessionCookie(res);
    res.writeHead(302, { Location: R_WS_MOD + '/login' }); res.end(); return;
  }
  const sess = await requireModSession(req, res);
  if (!sess) return;
  const handled = await handleModApi(req, res, pathname, sess);
  if (handled) return;
  if (pathname === R_WS_MOD || pathname === R_WS_MOD + '/' || pathname === R_WS_MOD + '/keys') {
    const stats    = await getKeyStats();
    const licenses = await listLicenses();
    sendHtml(res, renderModDash(buildLicenseRows(licenses), stats, sess.modName || null));
    return;
  }
  sendJson(res, { success: false, error: 'not_found' }, 404);
}

async function handleAdmin(req, res, pathname, ip) {
  if (pathname === R_WS_ADMIN + '/login') {
    if (req.method === 'GET') { sendHtml(res, renderAdminLogin(R_WS_ADMIN, 'Admin')); return; }
    if (!checkRate(ip)) { sendHtml(res, renderAdminLogin(R_WS_ADMIN, 'Admin', 'Muitas tentativas. Aguarde.'), 429); return; }
    const raw    = await readBody(req);
    const params = new URLSearchParams(raw);
    const user   = sanitizeInput(params.get('user') || '', 60);
    const pass   = params.get('pass') || '';
    if (await verifyAdminCredentials(user, pass)) {
      const session = await createSession('admin', { user: user.trim() });
      if (!session) { sendHtml(res, renderAdminLogin(R_WS_ADMIN, 'Admin', 'Erro ao criar sessao'), 500); return; }
      setSessionCookie(res, session.token);
      res.writeHead(302, { Location: R_WS_ADMIN }); res.end(); return;
    }
    await addLog('admin_login_fail', 'Tentativa invalida', { ip });
    sendHtml(res, renderAdminLogin(R_WS_ADMIN, 'Admin', 'Credenciais invalidas'), 401);
    return;
  }
  if (pathname === R_WS_ADMIN + '/logout') {
    await destroySession(parseCookies(req)[WS_COOKIE_NAME]);
    clearSessionCookie(res);
    res.writeHead(302, { Location: R_WS_ADMIN + '/login' }); res.end(); return;
  }
  const sess = await requireAdminSession(req, res);
  if (!sess) return;
  const handled = await handleAdminApi(req, res, pathname);
  if (handled) return;
  if (pathname === R_WS_ADMIN || pathname === R_WS_ADMIN + '/' || pathname.startsWith(R_WS_ADMIN + '/keys') || pathname === R_WS_ADMIN + '/logs' || pathname === R_WS_ADMIN + '/audit') {
    const stats    = await getKeyStats();
    const licenses = await listLicenses();
    const logsList = await getRecentLogs(300);
    sendHtml(res, renderAdminDash(buildLicenseRows(licenses), buildLogRows(logsList), stats, WS_BASE_PATH || ''));
    return;
  }
  sendJson(res, { success: false, error: 'not_found' }, 404);
}

function renderZvmAdminLogin(msg) {
  return renderLoginShell('ZVM Admin', R_ZVM_ADMIN + '/login', 'Usuário', msg);
}

function renderZvmModLogin(msg) {
  return renderLoginShell('ZVM Mod', R_ZVM_MOD + '/login', 'Usuário', msg);
}

function renderZvmAnalyticsLogin(msg) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Analytics — ZVM</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#020904;color:#e8fff3;min-height:100vh;display:flex;align-items:center;justify-content:center}:root{--ac:#39ff14;--bdr:#183326}.card{background:#070f0a;border:1px solid var(--bdr);border-radius:14px;padding:32px 28px;width:100%;max-width:340px;position:relative;z-index:1}.logo{font-size:1.3rem;font-weight:900;color:var(--ac);margin-bottom:18px}.field{margin-bottom:13px}.field label{display:block;font-size:.73rem;color:#5a8a6e;margin-bottom:5px}.field input{width:100%;padding:9px 11px;border-radius:7px;border:1px solid var(--bdr);background:#040d06;color:#e8fff3;font:inherit;font-size:.84rem}.btn{width:100%;padding:11px;border-radius:8px;border:none;background:linear-gradient(135deg,#39ff14,#00ff88);color:#020604;font-size:.88rem;font-weight:800;cursor:pointer;margin-top:6px}.err{color:#ff8899;font-size:.76rem;margin-bottom:12px;background:rgba(255,68,102,.09);border:1px solid rgba(255,68,102,.2);border-radius:6px;padding:7px 11px}</style></head><body>
${CANVAS_BG}
<div class="card"><div class="logo">📊 Analytics</div>
${msg ? `<div class="err">${esc(msg)}</div>` : ''}
<form method="POST" action="${esc(R_ANALYTICS)}/login">
<div class="field"><label>Senha</label><input name="pass" type="password" required></div>
<button class="btn" type="submit">Entrar</button>
</form></div></body></html>`;
}

function zvmAdminSidebar(active) {
  const item = (tab, icon, label) => `<a href="#${tab}" class="ni${active===tab?' ac':''}" data-tab="${tab}" onclick="showZvmTab('${tab}');return false"><span class="ic">${icon}</span><span class="nl">${label}</span></a>`;
  return `<aside class="sidebar"><div class="sb-brand"><span class="bdot"></span><span class="btxt">ZVM</span></div><div class="sbsec">Painel</div>${item('keys','🔑','Chaves')}${item('logs','📋','Logs')}${item('audit','🛡️','Auditoria')}<div class="sbft"><a href="${R_ZVM_ADMIN}/logout" class="ni"><span class="ic">→</span><span class="nl">Sair</span></a></div></aside>`;
}

function zvmModSidebar(active) {
  const item = (href, icon, label, key) => `<a href="${href}" class="ni${active===key?' ac':''}"><span class="ic">${icon}</span><span class="nl">${label}</span></a>`;
  return `<aside class="sidebar"><div class="sb-brand"><span class="bdot"></span><span class="btxt">ZVM Mod</span></div><div class="sbsec">Painel</div>${item(R_ZVM_MOD,'🔑','Chaves','keys')}<div class="sbft">${item(R_ZVM_MOD+'/logout','→','Sair','out')}</div></aside>`;
}

const ZVM_ADMIN_JS = (function() {
  var RA = R_ZVM_ADMIN;
  return [
    'var _RA=' + JSON.stringify(RA) + ';',
    'function toast(m,ok){var t=document.getElementById("toast");t.textContent=m;t.style.borderColor=ok===false?"var(--dg)":"var(--ac)";t.classList.add("show");setTimeout(function(){t.classList.remove("show");},3500);}',
    'function closeModal(){document.getElementById("modal-bg").classList.remove("open");}',
    'function filterKeys(){var q=(document.getElementById("search-input").value||"").toLowerCase();var st=document.getElementById("filter-status").value;document.querySelectorAll("#kb tr").forEach(function(r){var row=(r.dataset.code+r.dataset.label+r.dataset.phone).toLowerCase();r.style.display=((!q||row.includes(q))&&(!st||r.dataset.status===st))?"":"none";});}',
    'async function generateKey(){var btn=document.querySelector(\'button[onclick="generateKey()"]\');if(btn){btn.disabled=true;btn.textContent="Gerando...";}var label=(document.getElementById("nlabel").value||"").trim();if(!label){toast("Informe o nome do cliente",false);if(btn){btn.disabled=false;btn.textContent="+ Gerar";}return;}if(label.length>60){toast("Máx 60 caracteres",false);if(btn){btn.disabled=false;btn.textContent="+ Gerar";}return;}var body={label:label};var d=+(document.getElementById("ndays").value)||0,h=+(document.getElementById("nhours").value)||0,m=+(document.getElementById("nmins").value)||0;if(d)body.expireDays=d;if(h)body.expireHours=h;if(m)body.expireMinutes=m;var u=document.getElementById("nuses").value.trim();if(u!=="")body.maxUses=parseInt(u);if(document.getElementById("nfirstuse").checked)body.ativarNoPrimeiroUso=true;try{var r=await fetch(_RA+"/api/keys",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});if(r.status===401){location.href=_RA+"/login";return;}var j=await r.json();if(j.ok){toast("Chave gerada: "+j.key);["nlabel","ndays","nhours","nmins","nuses"].forEach(function(id){document.getElementById(id).value="";});document.getElementById("nfirstuse").checked=false;doRefresh();}else{toast("Erro: "+(j.error||"?"),false);}}catch(e){toast("Erro de conexão",false);}finally{if(btn){btn.disabled=false;btn.textContent="+ Gerar";}}}',
    'async function toggleKey(code){try{var r=await fetch(_RA+"/api/keys/"+encodeURIComponent(code)+"/toggle",{method:"POST"});var j=await r.json();if(j.ok){toast("Status alterado");doRefresh();}else toast("Falha",false);}catch(e){toast("Erro",false);}}',
    'async function deleteKey(code){if(!confirm("Excluir "+code+"?"))return;try{var r=await fetch(_RA+"/api/keys/"+encodeURIComponent(code),{method:"DELETE"});var j=await r.json();if(j.ok){toast("Excluída");doRefresh();}else toast("Falha",false);}catch(e){toast("Erro",false);}}',
    'function openRenew(code){var b=document.getElementById("modal-box");var sc=code.split(\'"\').join("&quot;");b.innerHTML=\'<h3>Renovar \'+code+\'</h3><div class="field"><label>Dias</label><input id="rd" type="number" min="0" value="30"></div><div class="field"><label>Horas</label><input id="rh" type="number" min="0" value="0"></div><div class="mrow"><button class="btn-p" id="ren-btn" onclick="submitRenew(this.dataset.code)" data-code="\'+sc+\'">Confirmar</button><button class="btn-w" onclick="closeModal()">Cancelar</button></div>\';document.getElementById("modal-bg").classList.add("open");}',
    'async function submitRenew(code){var btn=document.getElementById("ren-btn");if(btn){btn.disabled=true;btn.textContent="Salvando...";}var days=+(document.getElementById("rd").value)||0,hours=+(document.getElementById("rh").value)||0;try{var r=await fetch(_RA+"/api/keys/"+encodeURIComponent(code)+"/renew",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({days:days,hours:hours})});var j=await r.json();closeModal();if(j.ok){toast("Renovada");doRefresh();}else toast("Falha: "+(j.error||"?"),false);}catch(e){closeModal();toast("Erro",false);}}',
    'function openMaxUses(code,cur){var b=document.getElementById("modal-box");var sc=code.split(\'"\').join("&quot;");b.innerHTML=\'<h3>Limite de usos</h3><div class="field"><label>Máx (-1=∞)</label><input id="mu" type="number" value="\'+cur+\'"></div><div class="mrow"><button class="btn-p" id="mu-btn" onclick="submitMaxUses(this.dataset.code)" data-code="\'+sc+\'">Confirmar</button><button class="btn-w" onclick="closeModal()">Cancelar</button></div>\';document.getElementById("modal-bg").classList.add("open");}',
    'async function submitMaxUses(code){var btn=document.getElementById("mu-btn");if(btn){btn.disabled=true;btn.textContent="Salvando...";}var mu=parseInt(document.getElementById("mu").value);try{var r=await fetch(_RA+"/api/keys/"+encodeURIComponent(code)+"/max-uses",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({maxUses:mu})});var j=await r.json();closeModal();if(j.ok){toast("Atualizado");doRefresh();}else toast("Falha",false);}catch(e){closeModal();toast("Erro",false);}}',
    'function openNote(code,cur){var b=document.getElementById("modal-box");var safe=cur.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;");var sc=code.split(\'"\').join("&quot;");b.innerHTML=\'<h3>Nota</h3><div class="field"><textarea id="nt" rows="4" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--bdr);background:#040d06;color:var(--tx);font:inherit;resize:vertical">\'+safe+\'</textarea></div><div class="mrow"><button class="btn-p" id="note-btn" onclick="submitNote(this.dataset.code)" data-code="\'+sc+\'">Salvar</button><button class="btn-w" onclick="closeModal()">Cancelar</button></div>\';document.getElementById("modal-bg").classList.add("open");}',
    'async function submitNote(code){var btn=document.getElementById("note-btn");if(btn){btn.disabled=true;btn.textContent="Salvando...";}var note=document.getElementById("nt").value;try{var r=await fetch(_RA+"/api/keys/"+encodeURIComponent(code)+"/note",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({note:note})});var j=await r.json();closeModal();if(j.ok){toast("Nota salva");doRefresh();}else toast("Falha",false);}catch(e){closeModal();toast("Erro",false);}}',
    'function openLabel(code,cur){var b=document.getElementById("modal-box");var sc=code.split(\'"\').join("&quot;");var sv=cur.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;").split(\'"\').join("&quot;");b.innerHTML=\'<h3>Renomear</h3><div class="field"><label>Novo nome</label><input id="rn" type="text" maxlength="60" value="\'+sv+\'"></div><div class="mrow"><button class="btn-p" id="lbl-btn" onclick="submitLabel(this.dataset.code)" data-code="\'+sc+\'">Salvar</button><button class="btn-w" onclick="closeModal()">Cancelar</button></div>\';document.getElementById("modal-bg").classList.add("open");setTimeout(function(){var t=document.getElementById("rn");if(t){t.focus();t.select();}},60);}',
    'async function submitLabel(code){var label=document.getElementById("rn").value.trim();if(!label){toast("Informe um nome",false);return;}var btn=document.getElementById("lbl-btn");if(btn){btn.disabled=true;btn.textContent="Salvando...";}try{var r=await fetch(_RA+"/api/keys/"+encodeURIComponent(code)+"/label",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({label:label})});var j=await r.json();closeModal();if(j.ok){toast("Renomeado");doRefresh();}else toast("Falha",false);}catch(e){closeModal();toast("Erro",false);}}',
    'async function doRefresh(manual){var lr=document.getElementById("last-r");if(lr)lr.textContent="Atualizando...";try{var r=await fetch(_RA+"/api/data");if(r.status===401){if(manual)location.href=_RA+"/login";return;}if(!r.ok){if(manual)toast("Erro "+r.status,false);return;}var d=await r.json();if(!d.keysHtml)return;document.getElementById("kb").innerHTML=d.keysHtml;if(document.getElementById("logb")&&d.logsHtml)document.getElementById("logb").innerHTML=d.logsHtml;["totalKeys","activeKeys","expiredKeys","pendingKeys","blockedKeys"].forEach(function(k){var el=document.getElementById("s-"+k.replace("Keys","").toLowerCase());if(el)el.textContent=d[k]||0;});if(lr)lr.textContent=new Date().toLocaleTimeString("pt-BR");filterKeys();}catch(e){if(lr)lr.textContent="Erro";if(manual)toast("Erro ao atualizar",false);}}',
    'async function exportCsv(){window.location=_RA+"/api/export/csv";}',
    'setInterval(doRefresh,60000);doRefresh();'
  ].join('\n');
})();

function renderAdminDashboard() {
  const stats   = getZvmKeyStats();
  const keysHtml = getKeysHtmlCached();
  const logsHtml = buildLogsHtml();
  const sc = (id, val, lbl, style) => `<div class="sc"><div class="n" id="s-${id}"${style?' style="'+style+'"':''}>${val}</div><div class="l">${lbl}</div></div>`;
  const statsRow = `<div class="sc-row" style="margin-bottom:0;padding:14px 18px;border-bottom:1px solid #183326">${sc('total',stats.totalKeys,'Total','')}${sc('active',stats.activeKeys,'Ativas','color:var(--ac)')}${sc('expired',stats.expiredKeys,'Expiradas',stats.expiredKeys?'color:var(--dg)':'')}${sc('pending',stats.pendingKeys||0,'Pendentes','')}${sc('blocked',stats.blockedKeys||0,'Bloqueadas','')}</div>`;
  const genForm = `<div style="padding:16px 18px;background:#020904;border-bottom:1px solid #183326"><div style="max-width:450px;background:#070f0a;border:1px solid #183326;border-radius:12px;padding:16px 18px"><div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#5a8a6e;margin-bottom:12px">Nova Chave ZVM</div><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center"><input type="text" id="nlabel" placeholder="Nome do cliente" maxlength="60" style="flex:1;min-width:140px;padding:7px 10px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><input type="number" id="ndays" placeholder="Dias" min="0" max="9999" style="width:58px;padding:7px 8px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><input type="number" id="nhours" placeholder="H" min="0" max="23" style="width:46px;padding:7px 6px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><input type="number" id="nmins" placeholder="Min" min="0" max="59" style="width:50px;padding:7px 6px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><input type="number" id="nuses" placeholder="Usos" title="-1=∞" min="-1" max="9999" style="width:58px;padding:7px 8px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><label style="display:flex;align-items:center;gap:4px;font-size:.76rem;color:var(--mt);cursor:pointer;white-space:nowrap"><input type="checkbox" id="nfirstuse" style="margin:0;width:auto;padding:0"> 1º uso</label><button onclick="generateKey()" style="padding:7px 14px;border-radius:5px;border:none;background:linear-gradient(135deg,#39ff14,#00ff88);color:#020604;font-size:.82rem;font-weight:700;cursor:pointer;white-space:nowrap">+ Gerar</button></div></div></div>`;
  const searchBar = `<div style="display:flex;flex-wrap:wrap;gap:6px;padding:10px 18px;border-bottom:1px solid #183326;align-items:center"><input type="text" id="search-input" placeholder="🔍 Buscar..." oninput="filterKeys()" style="flex:1;min-width:180px;padding:7px 11px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><select id="filter-status" onchange="filterKeys()" style="padding:7px 10px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><option value="">Todos</option><option value="ativo">Ativas</option><option value="pendente">Pendentes</option><option value="expirada">Expiradas</option><option value="bloqueado">Bloqueadas</option></select><button onclick="doRefresh(true)" style="padding:7px 12px;border-radius:5px;border:1px solid #26543c;background:transparent;color:#39ff14;font-size:.8rem;cursor:pointer">↻</button><button onclick="exportCsv()" style="padding:7px 12px;border-radius:5px;border:1px solid #183326;background:transparent;color:#8ab89a;font-size:.8rem;cursor:pointer">↓ CSV</button><span id="last-r" style="font-size:.7rem;color:#5a8a6e">—</span></div>`;
  const keysSection = `<div id="tab-keys"><div class="sec"><div class="sh"><span class="sh-t">🔑 Chaves ZVM</span></div>${genForm}${searchBar}<div class="tbl-w" style="overflow-x:auto"><table style="min-width:820px"><thead><tr style="background:#070f0a"><th>Chave</th><th>Cliente</th><th>Status</th><th>Validade</th><th>Usos</th><th>Telefone</th><th>IP</th><th>Nota</th><th>Ações</th></tr></thead><tbody id="kb">${keysHtml}</tbody></table></div></div></div>`;
  const logsSection = `<div id="tab-logs" style="display:none"><div class="sec"><div class="sh"><span class="sh-t">📋 Logs ZVM</span></div><div class="tbl-w" style="max-height:52vh;overflow-y:auto;overflow-x:auto"><table style="min-width:600px"><thead><tr style="background:#070f0a"><th>Data/Hora</th><th>Ação</th><th>Chave</th><th>Telefone</th><th>IP</th><th>Detalhe</th></tr></thead><tbody id="logb">${logsHtml}</tbody></table></div></div></div>`;
  const zvmAuditJs = 'var _BASE="";var _TESTS=[{id:"json404",label:"API /unknown retorna JSON",run:async function(){var r=await fetch("/api/__nonexistent_route__");var ct=r.headers.get("content-type")||"";if(!ct.includes("json")){return{pass:false,detail:"Content-Type: "+ct};}try{var j=await r.json();return{pass:true,detail:"status "+r.status};}catch(e){return{pass:false,detail:"SyntaxError: "+e.message};}}},{id:"healthJson",label:"/health retorna JSON",run:async function(){var r=await fetch("/health");var ct=r.headers.get("content-type")||"";return{pass:ct.includes("json"),detail:"Content-Type: "+ct};}},{id:"xframe",label:"X-Frame-Options: DENY presente",run:async function(){var r=await fetch("/health");var h=r.headers.get("x-frame-options")||"";return{pass:h.toUpperCase()==="DENY",detail:"X-Frame-Options: "+h};}},{id:"csp",label:"Content-Security-Policy presente",run:async function(){var r=await fetch("/health");var h=r.headers.get("content-security-policy")||"";return{pass:h.length>0,detail:h.slice(0,60)||(h?"ok":"ausente")};}}];async function runZvmAudit(){var tbody=document.getElementById("zvm-audit-body");if(!tbody)return;tbody.innerHTML=\'<tr><td colspan=3 style="padding:18px;text-align:center;color:#5a8a6e">Executando testes...</td></tr>\';var rows=[];for(var t of _TESTS){var res;try{res=await t.run();}catch(e){res={pass:false,detail:e.message};}var col=res.pass?"#39ff14":"#ff8899";var lbl=res.pass?"PASS":"FAIL";rows.push("<tr><td class=\\"zvm-td\\" style=\\"font-size:.82rem\\">"+t.label+"</td><td class=\\"zvm-td\\"><span style=\\"font-family:monospace;font-size:.72rem;font-weight:700;color:"+col+";background:"+col+"15;border:1px solid "+col+"28;padding:2px 9px;border-radius:4px\\">"+lbl+"</span></td><td class=\\"zvm-td zvm-muted\\" style=\\"font-size:.75rem\\">"+res.detail+"</td></tr>");}tbody.innerHTML=rows.join("");}';
  const zvmTabJs = 'var _curZvmTab="keys";function showZvmTab(t){["keys","logs","audit"].forEach(function(n){var el=document.getElementById("tab-"+n);if(el)el.style.display=n===t?"":"none";var li=document.querySelector("[data-tab=\'"+n+"\']");if(li)li.classList.toggle("ac",n===t);});_curZvmTab=t;try{history.replaceState(null,"","#"+t);}catch(e){}if(t==="audit"&&typeof runZvmAudit==="function")runZvmAudit();}(function(){var h=(location.hash||"").replace("#","");if(["keys","logs","audit"].indexOf(h)>=0){showZvmTab(h);}else{showZvmTab("keys");}})();';
  const auditSection = `<div id="tab-audit" style="display:none"><div class="sec"><div class="sh"><span class="sh-t">🛡️ Auditoria de Segurança ZVM</span><button onclick="runZvmAudit()" style="padding:5px 12px;border-radius:5px;border:1px solid #26543c;background:transparent;color:#39ff14;font-size:.78rem;cursor:pointer">↻ Re-executar</button></div><div style="padding:14px 18px;font-size:.8rem;color:#5a8a6e;border-bottom:1px solid #183326">Testes automatizados contra as rotas do servidor ZVM.</div><div class="tbl-w"><table style="min-width:600px"><thead><tr style="background:#070f0a"><th style="min-width:260px">Teste</th><th style="min-width:80px">Status</th><th style="min-width:220px">Detalhe</th></tr></thead><tbody id="zvm-audit-body"><tr><td colspan="3" style="padding:18px;text-align:center;color:#5a8a6e">Clique na aba Auditoria para executar.</td></tr></tbody></table></div></div></div>`;
  return spaShell('Admin ZVM', zvmAdminSidebar('keys'), 'ZVM Admin', statsRow + keysSection + logsSection + auditSection + `<scr`+`ipt>${ZVM_ADMIN_JS}\n${zvmAuditJs}\n${zvmTabJs}</scr`+`ipt>`);
}

function renderModDashboard(modName) {
  const ZVM_MOD_JS = ZVM_ADMIN_JS.replace(JSON.stringify(R_ZVM_ADMIN), JSON.stringify(R_ZVM_MOD));
  const sc = (id, val, lbl, style) => `<div class="sc"><div class="n" id="s-${id}"${style?' style="'+style+'"':''}>${val}</div><div class="l">${lbl}</div></div>`;
  const stats = getZvmKeyStats();
  const statsRow = `<div class="sc-row" style="margin-bottom:18px">${sc('total',stats.totalKeys,'Total','')}${sc('active',stats.activeKeys,'Ativas','color:var(--ac)')}${sc('expired',stats.expiredKeys,'Expiradas','')}</div>`;
  const genForm = `<div style="padding:16px 18px;background:#020904;border-bottom:1px solid #183326"><div style="max-width:450px;background:#070f0a;border:1px solid #183326;border-radius:12px;padding:16px 18px"><div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#5a8a6e;margin-bottom:12px">Nova Chave ZVM</div><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center"><input type="text" id="nlabel" placeholder="Nome do cliente" maxlength="60" style="flex:1;min-width:140px;padding:7px 10px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><input type="number" id="ndays" placeholder="Dias" min="0" max="9999" style="width:58px;padding:7px 8px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><input type="number" id="nhours" placeholder="H" min="0" max="23" style="width:46px;padding:7px 6px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><input type="number" id="nmins" placeholder="Min" min="0" max="59" style="width:50px;padding:7px 6px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><input type="number" id="nuses" placeholder="Usos" title="-1=∞" min="-1" max="9999" style="width:58px;padding:7px 8px;border-radius:5px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.82rem"><label style="display:flex;align-items:center;gap:4px;font-size:.76rem;color:var(--mt);cursor:pointer;white-space:nowrap"><input type="checkbox" id="nfirstuse" style="margin:0;width:auto;padding:0"> 1º uso</label><button onclick="generateKey()" style="padding:7px 14px;border-radius:5px;border:none;background:linear-gradient(135deg,#39ff14,#00ff88);color:#020604;font-size:.82rem;font-weight:700;cursor:pointer;white-space:nowrap">+ Gerar</button></div></div></div>`;
  const keysHtml = getKeysHtmlCached();
  const keysSection = `<div class="sec"><div class="sh"><span class="sh-t">🔑 Chaves ZVM${modName?' — '+esc(modName):''}</span></div>${genForm}<div class="tbl-w" style="overflow-x:auto"><table style="min-width:820px"><thead><tr style="background:#070f0a"><th>Chave</th><th>Cliente</th><th>Status</th><th>Validade</th><th>Usos</th><th>Telefone</th><th>IP</th><th>Nota</th><th>Ações</th></tr></thead><tbody id="kb">${keysHtml}</tbody></table></div></div>`;
  return spaShell('Mod ZVM', zvmModSidebar('keys'), 'ZVM Moderador', statsRow + keysSection + `<scr`+`ipt>${ZVM_MOD_JS}</scr`+`ipt>`);
}

async function renderAnalyticsDashboard() {
  const stats = await getPaymentStats();
  const byDayJson    = JSON.stringify(stats.byDay    || {});
  const byProdJson   = JSON.stringify(stats.byProduct || {});
  const byMethodJson = JSON.stringify(stats.byMethod  || {});
  const byHourJson   = JSON.stringify(stats.byHour    || []);
  const body = `<div class="sec"><div class="sh"><span class="sh-t">📊 Analytics — Pagamentos</span><a href="${esc(R_ANALYTICS)}/export/csv" style="padding:5px 12px;border-radius:5px;border:1px solid #26543c;background:transparent;color:#39ff14;font-size:.78rem;text-decoration:none">↓ CSV</a></div>
<div class="sc-row">
<div class="sc"><div class="n" style="color:var(--ac)">${stats.total||0}</div><div class="l">Total Vendas</div></div>
<div class="sc"><div class="n" style="color:var(--ac)">R$ ${(stats.revenue||0).toFixed(2).replace('.',',')}</div><div class="l">Receita Total</div></div>
</div>
<div style="padding:14px 18px;display:grid;grid-template-columns:1fr 1fr;gap:14px;flex-wrap:wrap">
<div><h4 style="font-size:.75rem;color:#5a8a6e;margin-bottom:8px">Por Produto</h4><table style="width:100%;border-collapse:collapse">${Object.entries(stats.byProduct||{}).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td style="font-size:.75rem;padding:3px 0;color:#c8e8c8">${esc(k)}</td><td style="font-size:.75rem;padding:3px 0;color:var(--ac);text-align:right">R$ ${v.toFixed(2).replace('.',',')}</td></tr>`).join('')}</table></div>
<div><h4 style="font-size:.75rem;color:#5a8a6e;margin-bottom:8px">Por Método</h4><table style="width:100%;border-collapse:collapse">${Object.entries(stats.byMethod||{}).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td style="font-size:.75rem;padding:3px 0;color:#c8e8c8">${esc(k)}</td><td style="font-size:.75rem;padding:3px 0;color:var(--ac);text-align:right">${v}</td></tr>`).join('')}</table></div>
</div>
</div>
<scr`+`ipt>var _byDay=${byDayJson};var _byProd=${byProdJson};var _byMethod=${byMethodJson};var _byHour=${byHourJson};</scr`+`ipt>`;
  return spaShell('Analytics ZVM', `<aside class="sidebar"><div class="sb-brand"><span class="bdot"></span><span class="btxt">Analytics</span></div><div class="sbft"><a href="${esc(R_ANALYTICS)}/logout" class="ni"><span class="ic">→</span><span class="nl">Sair</span></a></div></aside>`, 'ZVM Analytics', body);
}

async function handleZvmExtension(req, res, pathname, ip) {
  const p = pathname;

  if (p === R_EXT + '/auth' && req.method === 'GET') {
    sendHtml(res, `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>ZVM Auth</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#020904;color:#e8fff3;min-height:100vh;display:flex;align-items:center;justify-content:center}:root{--ac:#39ff14}.card{background:#070f0a;border:1px solid #183326;border-radius:14px;padding:32px 28px;width:100%;max-width:360px}.logo{font-size:1.3rem;font-weight:900;color:var(--ac);margin-bottom:18px}.field{margin-bottom:13px}.field label{display:block;font-size:.73rem;color:#5a8a6e;margin-bottom:5px}.field input{width:100%;padding:9px 11px;border-radius:7px;border:1px solid #183326;background:#040d06;color:#e8fff3;font:inherit;font-size:.84rem}.btn{width:100%;padding:11px;border-radius:8px;border:none;background:linear-gradient(135deg,#39ff14,#00ff88);color:#020604;font-size:.88rem;font-weight:800;cursor:pointer}</style></head><body>
${CANVAS_BG}
<div class="card"><div class="logo">ZVM</div>
<form id="f" method="POST" action="${R_EXT}/auth/verify">
<div class="field"><label>Chave de acesso</label><input name="key" placeholder="zv-xxxxx-xxxxx-xxxxx" required></div>
<div class="field"><label>Número WhatsApp</label><input name="phone" placeholder="5511999999999" required></div>
<button class="btn" type="submit">Entrar</button>
</form></div></body></html>`);
    return;
  }

  if (p === R_EXT + '/auth/verify' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'login')) { sendHtml(res, '<h2>Muitas tentativas</h2>', 429); return; }
    const form  = await parseFormBody(req);
    const code  = (form.get('key') || '').trim().toLowerCase().slice(0, 30);
    const phone = (form.get('phone') || '').trim().slice(0, 20);
    if (!code || !keys[code]) {
      if (code && !keys[code]) await ensureKeyLoaded(code);
    }
    const k = keys[code];
    if (!k || !k.active || isKeyExpiredZvm(k)) {
      sendHtml(res, `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="background:#020904;color:#ff8899;font-family:sans-serif;padding:40px;text-align:center"><h2>Chave inválida ou expirada</h2><br><a href="${R_EXT}/auth" style="color:#39ff14">Tentar novamente</a></body></html>`, 401);
      return;
    }
    const cbUrl = `${R_EXT}/v3/callback?key=${encodeURIComponent(code)}&phone=${encodeURIComponent(phone)}&status=ok`;
    res.writeHead(302, { Location: cbUrl }); res.end();
    return;
  }

  if (p === R_EXT + '/v3/key' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'ext_key')) { sendJson(res, { ok: false, status: false, data: { errorType: 'RATE_LIMITED' } }, 429); return; }
    const body  = await parseBody(req);
    const code  = sanitizeInput(String(body.key || body.keyId || ''), 30).toLowerCase();
    const phone = sanitizeInput(String(body.phone || body.whatsapp || ''), 20);
    if (!code) { sendJson(res, { ok: false, status: false, data: { errorType: 'MISSING_KEY' } }, 400); return; }

    if (isFreeAuthKey(code)) {
      const usage = await ensureFreeUsage(ip);
      sendJson(res, getFreeAuthData(ip, usage));
      return;
    }

    if (!keys[code] && !await ensureKeyLoaded(code)) {
      sendJson(res, { ok: false, status: false, data: { errorType: 'KEY_NOT_FOUND' } }, 404);
      return;
    }
    const k = keys[code];
    if (!k.active) { sendJson(res, { ok: false, status: false, data: { errorType: 'KEY_BLOCKED' } }, 403); return; }
    if (isKeyExpiredZvm(k)) { sendJson(res, { ok: false, status: false, data: { errorType: 'KEY_EXPIRED' } }, 403); return; }

    if (k.expireDuration && !k.expiresAt) {
      k.expiresAt    = new Date(Date.now() + k.expireDuration).toISOString();
      k.activatedAt  = new Date().toISOString();
      saveKey(code);
    }

    const maxU = k.maxUses != null ? k.maxUses : MAX_USES;
    const isUnlimited = maxU <= 0 || maxU === -1;
    if (phone && !isUnlimited) {
      if (!(k.phones || []).includes(phone) && (k.phones || []).length >= maxU) {
        await addLogZvm({ keyCode: code, label: k.label, phone, ip, action: 'max_devices_reached', detail: `maxUses=${maxU}` });
        sendJson(res, { ok: false, status: false, data: { errorType: 'MAX_DEVICES_REACHED', maxUses: maxU } }, 403);
        return;
      }
    }

    if (phone) {
      if (!Array.isArray(k.phones)) k.phones = [];
      if (!k.phones.includes(phone)) k.phones.push(phone);
      k.lastPhone = phone;
    }
    k.lastUsed = new Date().toISOString();
    k.lastIp   = ip;
    k.uses     = (k.uses || 0) + 1;
    saveKey(code);

    const today = await ensureKeyUsage(code, k);
    const usage = buildUsagePayload(today, k);

    await addLogZvm({ keyCode: code, label: k.label, phone, ip, action: 'login_ok', detail: `uses=${k.uses}` });
    sendJson(res, getAuthData(code, k, usage));
    return;
  }

  if (p === R_EXT + '/v3/check-status' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'check_status')) { sendJson(res, { ok: false, status: false, data: { errorType: 'RATE_LIMITED' } }, 429); return; }
    const body = await parseBody(req);
    const code = sanitizeInput(String(body.key || body.keyId || ''), 30).toLowerCase();
    if (isFreeAuthKey(code)) { sendJson(res, getFreeAuthData(ip, unlimitedUsagePayload())); return; }
    if (!keys[code] && !await ensureKeyLoaded(code)) { sendJson(res, { ok: false, status: false, data: { errorType: 'KEY_NOT_FOUND' } }, 404); return; }
    const k = keys[code];
    if (!k.active || isKeyExpiredZvm(k)) { sendJson(res, { ok: false, status: false, data: { errorType: k.active ? 'KEY_EXPIRED' : 'KEY_BLOCKED' } }, 403); return; }
    const today = await ensureKeyUsage(code, k);
    sendJson(res, getAuthData(code, k, buildUsagePayload(today, k)));
    return;
  }

  if (p === R_EXT + '/v3/usage' && req.method === 'POST') {
    const body = await parseBody(req);
    const code = sanitizeInput(String(body.key || body.keyId || ''), 30).toLowerCase();
    const type = sanitizeInput(String(body.itemType || body.type || ''), 30);
    const qty  = Math.max(1, parseInt(body.qty || body.quantity || 1));
    if (isFreeAuthKey(code) || !USAGE_ITEM_TYPES.includes(type)) { sendJson(res, { ok: true }); return; }
    if (!keys[code]) await ensureKeyLoaded(code);
    if (keys[code]) await incrementUsageRow(code, keys[code], type, qty);
    sendJson(res, { ok: true });
    return;
  }

  if (p === R_EXT + '/v3/get-usage' && req.method === 'POST') {
    const body = await parseBody(req);
    const code = sanitizeInput(String(body.key || body.keyId || ''), 30).toLowerCase();
    if (isFreeAuthKey(code)) { sendJson(res, { ok: true, usage: unlimitedUsagePayload() }); return; }
    if (!keys[code]) await ensureKeyLoaded(code);
    const k = keys[code];
    if (!k) { sendJson(res, { ok: false }, 404); return; }
    const today = await ensureKeyUsage(code, k);
    sendJson(res, { ok: true, usage: buildUsagePayload(today, k) });
    return;
  }

  if (p === R_EXT + '/v3/sync-usage' && req.method === 'POST') {
    const body = await parseBody(req);
    const code = sanitizeInput(String(body.key || body.keyId || ''), 30).toLowerCase();
    if (!isFreeAuthKey(code) && keys[code]) {
      const k = keys[code];
      const today = usageTodayKey();
      if (!k.usage) k.usage = {};
      if (!k.usage[today]) k.usage[today] = {};
      const incoming = body.usage || {};
      for (const t of USAGE_ITEM_TYPES) {
        if (incoming[t] && typeof incoming[t].used === 'number') {
          if (!k.usage[today][t]) k.usage[today][t] = { used: 0 };
          k.usage[today][t].used = Math.max(k.usage[today][t].used, incoming[t].used);
        }
      }
      saveKey(code);
    }
    sendJson(res, { ok: true });
    return;
  }

  if (p === R_EXT + '/v3/create-user-event' && req.method === 'POST') {
    const body = await parseBody(req);
    const eventType = sanitizeInput(String(body.event_type || ''), 64);
    if (eventType) {
      try {
        const db = await getMongoDb();
        await db.collection('user_events').insertOne({
          event_type: eventType,
          keyId:      sanitizeInput(String(body.keyId || ''), 64),
          userId:     sanitizeInput(String(body.userId || ''), 64),
          metadata:   body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
          createdAt:  new Date(),
          ip,
        });
      } catch {}
    }
    sendJson(res, { status: 'success' });
    return;
  }

  sendJson(res, { ok: false, status: false, data: { errorType: 'NOT_FOUND' } }, 404);
}

async function handleZvmAdmin(req, res, p, ip, url) {
  if (p === R_ZVM_ADMIN + '/login' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'login')) { sendHtml(res, renderZvmAdminLogin(`⏳ Aguarde ${getRateLimitWait(ip,'login')} min`), 429); return; }
    const form  = await parseFormBody(req);
    const uBuf  = Buffer.from(form.get('user') || '');
    const pBuf  = Buffer.from(form.get('pass') || '');
    const auBuf = Buffer.from(ZVM_ADMIN_USER || '');
    const apBuf = Buffer.from(ZVM_ADMIN_PASS || '');
    const credOk = uBuf.length === auBuf.length && pBuf.length === apBuf.length &&
      crypto.timingSafeEqual(uBuf.length ? uBuf : Buffer.alloc(1), auBuf.length ? auBuf : Buffer.alloc(1)) &&
      crypto.timingSafeEqual(pBuf.length ? pBuf : Buffer.alloc(1), apBuf.length ? apBuf : Buffer.alloc(1));
    const totpOk = verifyTOTP(ZVM_TOTP_SECRET, (form.get('totp') || '').trim());
    if (credOk && totpOk) {
      const token = generateToken();
      ZVM_SESSIONS[token] = { expiresAt: new Date(Date.now() + 8*3600000).toISOString() };
      res.setHeader('Set-Cookie', `zv_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Secure`);
      res.writeHead(302, { Location: R_ZVM_ADMIN }); res.end();
    } else {
      sendHtml(res, renderZvmAdminLogin(credOk && !totpOk ? 'Código 2FA inválido' : 'Usuário ou senha incorretos'));
    }
    return;
  }
  if (p === R_ZVM_ADMIN + '/logout') {
    res.setHeader('Set-Cookie', 'zv_admin=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict; Secure');
    res.writeHead(302, { Location: R_ZVM_ADMIN }); res.end(); return;
  }
  if (p === R_ZVM_ADMIN || p === R_ZVM_ADMIN + '/') {
    if (!isAdminSession(req)) { sendHtml(res, renderZvmAdminLogin()); return; }
    sendHtml(res, renderAdminDashboard()); return;
  }
  if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }

  if (p === R_ZVM_ADMIN + '/api/data' && req.method === 'GET') {
    sendJson(res, { ...getZvmKeyStats(), keysHtml: getKeysHtmlCached(), logsHtml: buildLogsHtml() }); return;
  }
  if (p === R_ZVM_ADMIN + '/api/keys' && req.method === 'POST') {
    const body = await parseBody(req);
    const rawLabel = sanitizeInput(String(body.label || ''), 60);
    if (!rawLabel) { sendJson(res, { error: 'label obrigatório' }, 400); return; }
    if (rawLabel.length > 60) { sendJson(res, { error: 'label_too_long' }, 400); return; }
    if (detectInjection(rawLabel)) { sendJson(res, { error: 'invalid_input' }, 400); return; }
    const code = generateCode();
    const { expiresAt, expireDuration } = parseKeyExpiryFromBody(body, { allowMinutes: true });
    const maxUses = body.maxUses !== undefined ? parseInt(body.maxUses) : MAX_USES;
    keys[code] = { label: rawLabel, active: true, createdAt: new Date().toISOString(), uses: 0, phones: [], lastUsed: null, lastIp: null, lastPhone: null, deviceId: null, wppVersion: null, note: '', expiresAt, expireDuration: expireDuration || null, maxUses: isNaN(maxUses) ? MAX_USES : maxUses, warnCount: 0, modules: { ...DEFAULT_MODULES } };
    saveKey(code);
    sendJson(res, { ok: true, key: code }); return;
  }
  const RA = R_ZVM_ADMIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const extractCode = (pattern) => { const m = p.match(pattern); if (!m) return null; const c = decodeURIComponent(m[1]); return /^[a-z0-9_\-]{1,30}$/.test(c) ? c : null; };

  const codeToggle = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/toggle$`));
  if (codeToggle && req.method === 'POST') {
    const k = await adminGetKey(codeToggle); if (!k) { sendJson(res, { error: 'not found' }, 404); return; }
    k.active = !k.active; saveKey(codeToggle);
    if (!k.active) fireWebhook('key_blocked', codeToggle, 'Bloqueio manual');
    sendJson(res, { ok: true, active: k.active }); return;
  }
  const codeRenew = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/renew$`));
  if (codeRenew && req.method === 'POST') {
    const k = await adminGetKey(codeRenew); if (!k) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    const addMs = ((parseInt(body.days||0)*1440)+(parseInt(body.hours||0)*60)+parseInt(body.mins||0))*60000;
    if (!addMs) { sendJson(res, { error: 'nenhum tempo' }, 400); return; }
    const base = (k.expiresAt && !isKeyExpiredZvm(k)) ? new Date(k.expiresAt).getTime() : Date.now();
    k.expiresAt = new Date(base+addMs).toISOString(); k.expireDuration = null; k.active = true;
    saveKey(codeRenew); sendJson(res, { ok: true, expiresAt: k.expiresAt }); return;
  }
  const codeMaxUses = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/max-uses$`));
  if (codeMaxUses && req.method === 'POST') {
    const k = await adminGetKey(codeMaxUses); if (!k) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req); const mu = parseInt(body.maxUses);
    if (isNaN(mu) || mu < -1) { sendJson(res, { error: 'invalid' }, 400); return; }
    k.maxUses = mu; saveKey(codeMaxUses); sendJson(res, { ok: true, maxUses: mu }); return;
  }
  const codeLabel = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/label$`));
  if (codeLabel && req.method === 'POST') {
    const k = await adminGetKey(codeLabel); if (!k) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    const label = sanitizeInput(String(body.label||'').trim(), 60);
    if (!label) { sendJson(res, { error: 'label vazio' }, 400); return; }
    k.label = label; saveKey(codeLabel); sendJson(res, { ok: true, label }); return;
  }
  const codeNote = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/note$`));
  if (codeNote && req.method === 'POST') {
    const k = await adminGetKey(codeNote); if (!k) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    k.note = sanitizeInput(String(body.note||''), 500); saveKey(codeNote); sendJson(res, { ok: true }); return;
  }
  const codeDel = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)$`));
  if (codeDel && req.method === 'DELETE') {
    delete keys[codeDel]; await deleteKeyFromDb(codeDel); sendJson(res, { ok: true }); return;
  }
  if (p === R_ZVM_ADMIN + '/api/logs' && req.method === 'DELETE') {
    const body = await parseBody(req);
    if (body.date) logs = logs.filter(l => !l.timestamp.startsWith(body.date));
    else logs = [];
    await saveLogs(); sendJson(res, { ok: true, remaining: logs.length }); return;
  }
  if (p === R_ZVM_ADMIN + '/api/export/csv' && req.method === 'GET') {
    const header = 'Chave,Cliente,Status,Validade,Usos,Telefone,IP,Criada em,Nota';
    const rows = Object.entries(keys).map(([code, k]) => {
      const st = getKeyDisplayStatus(k).toUpperCase();
      const mu = k.maxUses===-1?'Ilimitado':(k.maxUses>0?k.maxUses:MAX_USES);
      return [code,k.label,st,k.expiresAt?k.expiresAt.slice(0,10):(k.expireDuration?'Ao 1º uso':'∞'),`${(k.phones||[]).length}/${mu}`,k.lastPhone||'',k.lastIp||'',k.createdAt?k.createdAt.slice(0,10):'',(k.note||'').replace(/,/g,';')].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',');
    });
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="zvm-chaves-${new Date().toISOString().slice(0,10)}.csv"`);
    res.writeHead(200); res.end('﻿' + [header,...rows].join('\r\n')); return;
  }
  sendJson(res, { error: 'not_found' }, 404);
}

async function handleZvmMod(req, res, p, ip) {
  if (MODS.length === 0) { res.writeHead(404); res.end('Not found'); return; }
  if (p === R_ZVM_MOD + '/login' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'login')) { sendHtml(res, renderZvmModLogin(`⏳ Aguarde ${getRateLimitWait(ip,'login')} min`), 429); return; }
    const form = await parseFormBody(req);
    const inputUser = form.get('user') || '';
    const inputPass = form.get('pass') || '';
    const inputTotp = (form.get('totp') || '').trim();
    const matchedMod = MODS.find(m => {
      try {
        const bu = Buffer.from(m.user), bi = Buffer.from(inputUser);
        const bp = Buffer.from(m.pass), bip = Buffer.from(inputPass);
        return bu.length===bi.length && bp.length===bip.length && crypto.timingSafeEqual(bu,bi) && crypto.timingSafeEqual(bp,bip);
      } catch { return false; }
    });
    const totpOk = matchedMod ? verifyTOTP(matchedMod.totp, inputTotp) : false;
    if (matchedMod && totpOk) {
      const token = generateToken();
      ZVM_MOD_SESSIONS[token] = { expiresAt: new Date(Date.now()+8*3600000).toISOString(), modName: matchedMod.name };
      res.setHeader('Set-Cookie', `zv_mod=${token}; Path=/; HttpOnly; SameSite=Strict; Secure`);
      res.writeHead(302, { Location: R_ZVM_MOD }); res.end();
    } else {
      sendHtml(res, renderZvmModLogin(matchedMod && !totpOk ? 'Código 2FA inválido' : 'Usuário ou senha incorretos'));
    }
    return;
  }
  if (p === R_ZVM_MOD + '/logout') {
    res.setHeader('Set-Cookie','zv_mod=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict; Secure');
    res.writeHead(302, { Location: R_ZVM_MOD }); res.end(); return;
  }
  if (p === R_ZVM_MOD || p === R_ZVM_MOD + '/') {
    if (!isModSession(req)) { sendHtml(res, renderZvmModLogin()); return; }
    const mc = (req.headers.cookie||'').match(/zv_mod=([a-f0-9]+)/);
    const ms = mc ? ZVM_MOD_SESSIONS[mc[1]] : null;
    sendHtml(res, renderModDashboard(ms ? ms.modName : 'Moderador')); return;
  }
  if (!isModSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
  const mc2 = (req.headers.cookie||'').match(/zv_mod=([a-f0-9]+)/);
  const ms2 = mc2 ? ZVM_MOD_SESSIONS[mc2[1]] : null;
  const modName = ms2 ? ms2.modName : 'Moderador';

  if (p === R_ZVM_MOD + '/api/keys' && req.method === 'POST') {
    const body = await parseBody(req);
    const rawLabel = sanitizeInput(String(body.label||'').trim(), 60);
    if (!rawLabel) { sendJson(res, { error: 'label obrigatório' }, 400); return; }
    if (rawLabel.length > 60) { sendJson(res, { error: 'label_too_long' }, 400); return; }
    const code = generateCode();
    const { expiresAt, expireDuration } = parseKeyExpiryFromBody(body);
    const maxUses = Math.max(1, parseInt(body.maxUses) || MAX_USES);
    keys[code] = { label: rawLabel, active: true, createdAt: new Date().toISOString(), uses: 0, phones: [], lastUsed: null, lastIp: null, lastPhone: null, deviceId: null, wppVersion: null, note: '[Mod: '+modName+']', expiresAt, expireDuration: expireDuration||null, maxUses, warnCount: 0 };
    saveKey(code); sendJson(res, { ok: true, key: code }); return;
  }
  if (p === R_ZVM_MOD + '/api/data' && req.method === 'GET') {
    sendJson(res, { ...getZvmKeyStats(), keysHtml: getKeysHtmlCached(), logsHtml: buildLogsHtml() }); return;
  }
  sendJson(res, { error: 'not_found' }, 404);
}

async function handleZvmAnalytics(req, res, p, ip) {
  if (!ZVM_ANALYTICS_PASS) { res.writeHead(404); res.end('Not found'); return; }
  if (p === R_ANALYTICS + '/login' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'login')) { sendHtml(res, renderZvmAnalyticsLogin(`⏳ Aguarde ${getRateLimitWait(ip,'login')} min`), 429); return; }
    const form = await parseFormBody(req);
    const pBuf = Buffer.from(form.get('pass')||''), apBuf = Buffer.from(ZVM_ANALYTICS_PASS||'');
    if (pBuf.length===apBuf.length && crypto.timingSafeEqual(pBuf.length?pBuf:Buffer.alloc(1), apBuf.length?apBuf:Buffer.alloc(1))) {
      const token = generateToken();
      ZVM_AN_SESSIONS[token] = { expiresAt: new Date(Date.now()+8*3600000).toISOString() };
      res.setHeader('Set-Cookie', `zv_an=${token}; Path=/; HttpOnly; SameSite=Strict; Secure`);
      res.writeHead(302, { Location: R_ANALYTICS }); res.end();
    } else {
      sendHtml(res, renderZvmAnalyticsLogin('Senha incorreta.'));
    }
    return;
  }
  if (p === R_ANALYTICS + '/logout') {
    clearAnalyticsCookie(res); res.writeHead(302, { Location: R_ANALYTICS }); res.end(); return;
  }
  if ((p === R_ANALYTICS || p === R_ANALYTICS + '/') && req.method === 'GET') {
    if (!isAnalyticsSession(req)) { clearAnalyticsCookie(res); sendHtml(res, renderZvmAnalyticsLogin()); return; }
    sendHtml(res, await renderAnalyticsDashboard()); return;
  }
  if (p === R_ANALYTICS + '/export/csv' && req.method === 'GET') {
    if (!isAnalyticsSession(req)) { res.writeHead(302, { Location: R_ANALYTICS }); res.end(); return; }
    const payments = await getPayments({ limit: 10000 });
    const header = 'Data,Cliente,Email,Telefone,Produto,Valor,Chave,Método';
    const rows = payments.map(pay => [
      pay.paidAt?new Date(pay.paidAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'',
      pay.clientName||'',pay.clientEmail||'',pay.clientPhone||'',pay.productName||'',
      (pay.amount||0).toFixed(2).replace('.',','),pay.keyCode||'',pay.paymentMethod||''
    ].map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(','));
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="zvm-pagamentos-${new Date().toISOString().slice(0,10)}.csv"`);
    res.writeHead(200); res.end('﻿' + [header,...rows].join('\r\n')); return;
  }
  if (p === R_ANALYTICS + '/api/stats' && req.method === 'GET') {
    if (!isAnalyticsSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    sendJson(res, await getPaymentStats() || {}); return;
  }
  sendJson(res, { error: 'not_found' }, 404);
}

async function handlePaytWebhook(req, res, ip) {
  const rawBody = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { try { payload = Object.fromEntries(new URLSearchParams(rawBody)); } catch { res.writeHead(400); res.end('Bad Request'); return; } }

  if (ZVM_PAYT_SECRET) {
    const ht  = req.headers['x-payt-token'] || req.headers['x-webhook-token'] || '';
    const bk  = payload.integration_key || '';
    if ((ht && ht !== ZVM_PAYT_SECRET) || (bk && bk !== ZVM_PAYT_SECRET)) {
      res.writeHead(401); res.end('Unauthorized'); return;
    }
  }
  if (payload.test === true) { res.writeHead(200); res.end('test_ignored'); return; }

  const status   = String(payload.status||payload.payment_status||payload.sale_status||'').toLowerCase();
  const APPROVED = ['venda_paga','approved','paid','completed','finished','aprovada','finalizada','active','confirmed'];
  const approved = APPROVED.some(s => status===s || status.includes(s));
  const txId     = String(payload.transaction_id||payload.sale_id||payload.cart_id||payload.id||'').trim();

  const customer    = payload.customer||payload.buyer||payload.client||{};
  const clientName  = customer.name||customer.full_name||payload.customer_name||payload.buyer_name||'Cliente';
  const clientEmail = customer.email||payload.customer_email||payload.buyer_email||payload.email||'';
  const clientPhone = customer.phone||customer.cellphone||customer.phone_number||payload.customer_phone||'';

  let productNameRaw = '-', amount = 0;
  if (Array.isArray(payload.products) && payload.products.length) {
    productNameRaw = payload.products.map(pr=>pr.name||pr.title||'').filter(Boolean).join(' + ') || '-';
    amount = payload.products.reduce((s,pr)=>s+(parseFloat(String(pr.price||pr.value||0).replace(',','.'))||0),0);
  }
  if (productNameRaw==='-') {
    const offer = payload.offer||payload.product||{};
    productNameRaw = offer.name||offer.title||payload.product_name||payload.offer_name||payload.plan_name||'-';
  }
  if (!amount) {
    const raw = payload.amount||payload.value||payload.price||payload.sale_amount||payload.total||0;
    amount = parseFloat(String(raw).replace(',','.'))||0;
  }
  const paymentMethod = payload.payment_method||payload.charge_type||payload.method||payload.payment_type||'-';
  const productNameLow = productNameRaw.toLowerCase();

  if (!approved) {
    if (txId) savePayment({ txId, status:status||'unknown', approved:false, clientName, clientEmail, clientPhone, productName:productNameRaw, amount, paymentMethod, keyCode:null, paidAt:new Date().toISOString(), rawStatus:status }).catch(()=>{});
    res.writeHead(200); res.end('ignored'); return;
  }

  if (txId) {
    if (Object.values(keys).some(k=>k.note&&(k.note.includes('payt_tx:'+txId)||k.note.includes('renovado_payt_tx:'+txId)))) { res.writeHead(200); res.end('ok'); return; }
    try {
      const db = await getMongoDb();
      const ex = await db.collection('payments').findOne({ txId, approved:true });
      if (ex) { res.writeHead(200); res.end('ok'); return; }
    } catch {}
  }

  let maxUses = 3;
  if      (productNameLow.match(/\b1\b|individual|solo|basico|starter/)) maxUses = 1;
  else if (productNameLow.match(/\b5\b|multi|team|equipe|avancado/))     maxUses = 5;
  else if (productNameLow.match(/\b3\b|trio|standard|padrao/))           maxUses = 3;

  let existingCode = null;
  if (clientEmail) {
    existingCode = Object.keys(keys).find(c => {
      const em = (keys[c].note||'').match(/Email: ([^\s|]+)/);
      return em && em[1].toLowerCase()===clientEmail.toLowerCase() && keys[c].active;
    });
  }

  const now = new Date(), durationMs = 31*24*3600000;
  if (existingCode) {
    const k = keys[existingCode];
    const base = (k.expiresAt && new Date(k.expiresAt)>now) ? new Date(k.expiresAt) : now;
    k.expiresAt = new Date(base.getTime()+durationMs).toISOString(); k.active = true;
    k.note = k.note + (txId?' | renovado_payt_tx:'+txId:' | renovado');
    saveKey(existingCode);
    await savePayment({ txId:txId||existingCode, status:'approved', approved:true, clientName, clientEmail, clientPhone, productName:productNameRaw, amount, paymentMethod, keyCode:existingCode, maxUses, renewed:true, paidAt:now.toISOString(), rawStatus:status });
    res.writeHead(200); res.end('ok'); return;
  }

  const code = generateCode();
  keys[code] = { label:'PAYT - '+clientName, active:true, phones:[], uses:0, maxUses, expiresAt:new Date(now.getTime()+durationMs).toISOString(), expireDuration:durationMs, createdAt:now.toISOString(), lastUsed:null, lastIp:null, lastPhone:null, deviceId:null, wppVersion:null, warnCount:0, note:'Pedido automatico Payt | Email: '+clientEmail+(txId?' | payt_tx:'+txId:''), modules:{ ...DEFAULT_MODULES } };
  saveKey(code);
  await savePayment({ txId:txId||code, status:'approved', approved:true, clientName, clientEmail, clientPhone, productName:productNameRaw, amount, paymentMethod, keyCode:code, maxUses, renewed:false, paidAt:now.toISOString(), rawStatus:status });
  res.writeHead(200); res.end('ok');
}

async function handleRequest(req, res) {
  applySecurityHeaders(res);
  const url      = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;
  const ip       = (req.headers['x-forwarded-for']||'').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
  const method   = req.method;

  applyCors(req, res);

  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (pathname === '/ping') { sendText(res, 'OK'); return; }

  if (pathname === '/health') {
    const mem    = process.memoryUsage();
    const wsOk   = mongoReady && dbWS !== null && !cbIsOpen();
    let zvmKeys  = Object.keys(keys).length;
    let wsKeys   = 0;
    const t0     = Date.now();
    await new Promise(r => setImmediate(r));
    if (wsOk) { try { wsKeys = await dbWS.collection(COL.licenses).countDocuments(); } catch {} }
    sendJson(res, {
      ok:              wsOk,
      service:         'wspeed-zvm-unified',
      version:         '1.0.0',
      mongo:           wsOk,
      circuitBreaker:  cbIsOpen() ? 'OPEN' : 'CLOSED',
      zvmKeys,
      wsKeys,
      heapUsedMB:      (mem.heapUsed/1048576).toFixed(1),
      rssMB:           (mem.rss/1048576).toFixed(1),
      eventLoopMs:     Date.now() - t0,
      uptime:          Math.floor(process.uptime()),
    }, wsOk ? 200 : 503);
    return;
  }

  if (pathname === '/config.json') { await sendCachedConfigJson(res); return; }
  if (pathname === '/api/code') { res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=86400'}); res.end(''); return; }

  if (cbIsOpen() && pathname.startsWith('/api/')) { sendJson(res, { success:false, msg_id:'service_unavailable' }, 503); return; }
  if ((!mongoReady || !dbWS) && pathname.startsWith('/api/')) { sendError(res, 503, 'db_unavailable'); return; }

  try {
    if (pathname === '/payt/webhook' && method === 'POST') { await handlePaytWebhook(req, res, ip); return; }

    if (pathname.startsWith(R_EXT)) { await handleZvmExtension(req, res, pathname, ip); return; }
    if (pathname.startsWith(R_ZVM_ADMIN)) { await handleZvmAdmin(req, res, pathname, ip, url); return; }
    if (MODS.length > 0 && pathname.startsWith(R_ZVM_MOD)) { await handleZvmMod(req, res, pathname, ip); return; }
    if (ZVM_ANALYTICS_PASS && pathname.startsWith(R_ANALYTICS)) { await handleZvmAnalytics(req, res, pathname, ip); return; }

    if (pathname === '/client/status' && method === 'POST') {
      if (!checkRateLimit(ip, 'api')) { sendJson(res, { error:'rate_limited' }, 429); return; }
      const body = await parseBody(req);
      const code = sanitizeInput(String(body.key||'').trim().toLowerCase(), 20);
      if (!code) { sendJson(res, { error:'not_found' }, 404); return; }
      if (!await ensureKeyLoaded(code)) { sendJson(res, { error:'not_found' }, 404); return; }
      const k = keys[code];
      sendJson(res, {
        label:      k.label||'Cliente',
        active:     k.active && !isKeyExpiredZvm(k),
        expired:    isKeyExpiredZvm(k),
        expiresAt:  k.expiresAt||null,
        lastUsed:   k.lastUsed||null,
        phones:     (k.phones||[]).length,
        phoneList:  (k.phones||[]).map((ph,i)=>({idx:i,display:ph.replace(/(\d+)(\d{4})$/,'••••$2')})),
        maxUses:    k.maxUses===-1?null:(k.maxUses>0?k.maxUses:MAX_USES),
        hoursLeft:  hoursUntilExpiry(k),
        daysLeft:   daysUntilExpiry(k),
        deferred:   !!(k.expireDuration && !k.expiresAt),
      });
      return;
    }
    if (pathname === '/client/remove-phone' && method === 'POST') {
      if (!checkRateLimit(ip, 'api')) { sendJson(res, { error:'rate_limited' }, 429); return; }
      const body     = await parseBody(req);
      const keyCode  = sanitizeInput(String(body.key||'').trim().toLowerCase(), 20);
      const phoneIdx = body.phoneIdx != null ? parseInt(body.phoneIdx) : -1;
      const phoneTxt = sanitizeInput(String(body.phone||'').trim(), 20);
      if (!keyCode || (phoneIdx<0 && !phoneTxt)) { sendJson(res, { error:'bad_request' }, 400); return; }
      if (!await ensureKeyLoaded(keyCode)) { sendJson(res, { error:'not_found' }, 404); return; }
      const phone = resolvePhoneToRemove(keys[keyCode].phones||[], { phoneIdx, phoneTxt });
      if (!phone) { sendJson(res, { error:'numero_nao_encontrado' }, 404); return; }
      removePhoneFromKey(keys[keyCode], phone);
      saveKey(keyCode).catch(()=>{});
      sendJson(res, { ok:true, phones:keys[keyCode].phones }); return;
    }

    if (pathname.startsWith(R_WS_MOD))   { await handleMod(req, res, pathname, ip); return; }
    if (pathname.startsWith(R_WS_ADMIN)) { await handleAdmin(req, res, pathname, ip); return; }

    const _wsSubPath = WS_BASE_PATH && pathname.startsWith(WS_BASE_PATH)
      ? (pathname.slice(WS_BASE_PATH.length) || '/')
      : (WS_BASE_PATH ? null : pathname);

    if (_wsSubPath !== null) {
      if (_wsSubPath === '/' || _wsSubPath === '') { sendHtml(res, renderClientAuthPainel('')); return; }
      if (_wsSubPath === '/instalar' && method==='GET') { sendHtml(res, renderPortal(WS_CHROME_ID)); return; }
      if (_wsSubPath === '/faq' && method==='GET') { sendHtml(res, pubShell('FAQ — WSPEED','<div class="card"><h2 style="color:#39ff14;margin-bottom:16px">FAQ</h2><p style="color:#5a8a6e">Perguntas frequentes em breve.</p></div>')); return; }
      if (_wsSubPath === '/planos' && method==='GET') { sendHtml(res, pubShell('Planos — WSPEED','<div class="card"><h2 style="color:#39ff14;margin-bottom:16px">Planos</h2><p style="color:#5a8a6e">Consulte nossos planos.</p></div>')); return; }
      if (_wsSubPath === '/privacidade' && method==='GET') { sendHtml(res, pubShell('Privacidade — WSPEED','<div class="card"><h2 style="color:#39ff14;margin-bottom:16px">Política de Privacidade</h2><p style="color:#5a8a6e">Seus dados são protegidos.</p></div>')); return; }
      if (_wsSubPath === '/obrigado') { sendHtml(res, clientShell('Até logo!','<div class="card" style="text-align:center;padding:48px 28px"><div style="font-size:3rem;margin-bottom:16px">👋</div><h2 style="font-size:1.5rem;font-weight:800;margin-bottom:10px">Até logo!</h2><p style="color:#5a8a6e">O WSPEED foi desinstalado.</p></div>')); return; }
      if (await handleClientPanel(req, res, _wsSubPath)) return;
      if (_wsSubPath.startsWith('/api/')) { await handleWaSpeedApi(req, res, _wsSubPath, ip); return; }
    }

    if (WS_BASE_PATH && pathname.startsWith('/api/')) {
      await handleWaSpeedApi(req, res, pathname, ip);
      return;
    }

    if (!res.headersSent) sendJson(res, { success:false, error:'not_found' }, 404);
  } catch (err) {
    sendInternalError(res, err, pathname);
  }
}

function startAntiSleepCron() {
  const _rawBase = WS_PUBLIC_URL || WS_BASE_URL || `http://localhost:${PORT}`;
  const _origin  = (() => { try { return new URL(_rawBase).origin; } catch { return _rawBase.replace(/\/+$/, ''); } })();
  const pingUrl  = _origin + '/ping';
  slog(LOG_LEVELS.INFO, `Anti-sleep: GET ${pingUrl} a cada 5min`);
  setInterval(() => {
    try {
      const u   = new URL(pingUrl);
      const mod = pingUrl.startsWith('https') ? https : http;
      const r   = mod.request({ hostname: u.hostname, path: u.pathname, method: 'GET' }, res => res.resume());
      r.on('error', () => {}); r.setTimeout(8000, () => r.destroy()); r.end();
    } catch {}
  }, ANTI_SLEEP_MS).unref();
}

async function shutdown(sig) {
  slog(LOG_LEVELS.INFO, `${sig} — encerrando servidor unificado`);
  mongoReady = false;
  try {
    for (const [, tid] of _saveDebounce) clearTimeout(tid);
    if (_mongoClient) await _mongoClient.close();
  } catch (e) { slog(LOG_LEVELS.WARN, 'mongo close', { err: e.message }); }
  if (server) server.close(() => process.exit(0));
  else process.exit(0);
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException',  err => { slog(LOG_LEVELS.CRITICAL, 'uncaughtException',  { err: err.message }); dispatchWebhookAlert('uncaught_exception',  { err: err.message }); process.exit(1); });
process.on('unhandledRejection', err => { slog(LOG_LEVELS.CRITICAL, 'unhandledRejection', { err: String(err) }); dispatchWebhookAlert('unhandled_rejection', { err: String(err) }); });

async function bootstrap() {
  slog(LOG_LEVELS.INFO, `Servidor Unificado WSPEED+ZVM v1.1 — iniciando | WSPEED em ${WS_BASE_PATH || '/'} | ZVM em /extension`);
  if (!MONGODB_URI) { slog(LOG_LEVELS.CRITICAL, 'MONGODB_URI não definida'); process.exit(1); }

  try {
    await connectMongo();
    slog(LOG_LEVELS.INFO, 'MongoDB conectado', { zvmDb: 'zapvoice', wsDb: WS_DB_NAME });
    await initSeed();
    mongoReady = true;
  } catch (err) {
    slog(LOG_LEVELS.CRITICAL, 'Falha no connect MongoDB', { err: err.message });
    process.exit(1);
  }

  try {
    const loaded = await loadDb();
    keys = loaded.keys || {};
    logs = loaded.logs || [];
    for (const code of Object.keys(keys)) sanitizeKeyRecord(keys[code]);
    slog(LOG_LEVELS.INFO, `ZVM: ${Object.keys(keys).length} chaves | ${logs.length} logs`);
  } catch (err) {
    slog(LOG_LEVELS.WARN, 'loadDb falhou — iniciando vazio', { err: err.message });
  }

  server = http.createServer((req, res) => {
    handleRequest(req, res).catch(err => {
      slog(LOG_LEVELS.CRITICAL, 'Unhandled request error', { err: err && err.message, url: req.url });
      if (!res.headersSent) {
        const eid = crypto.randomBytes(8).toString('hex');
        sendJson(res, { success: false, msg_id: 'server_error', error_id: eid }, 500);
      }
    });
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout   = 66000;
  server.on('clientError', (err, socket) => {
    slog(LOG_LEVELS.WARN, 'clientError', { err: err.message });
    if (!socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  server.listen(PORT, '0.0.0.0', () => {
    slog(LOG_LEVELS.INFO, `Servidor ouvindo na porta ${PORT}`);
    slog(LOG_LEVELS.INFO, `ZVM Admin:     ${R_ZVM_ADMIN}`);
    slog(LOG_LEVELS.INFO, `ZVM Mod:       ${MODS.length>0 ? R_ZVM_MOD+' ('+MODS.length+' mods)' : 'inativo'}`);
    slog(LOG_LEVELS.INFO, `ZVM Analytics: ${ZVM_ANALYTICS_PASS ? R_ANALYTICS : 'inativo'}`);
    slog(LOG_LEVELS.INFO, `ZVM Extension: ${R_EXT}/v3/key`);
    slog(LOG_LEVELS.INFO, `WS Admin:      ${R_WS_ADMIN}`);
    slog(LOG_LEVELS.INFO, `WS Mod:        ${R_WS_MOD}`);
    slog(LOG_LEVELS.INFO, `PAYT Webhook:  /payt/webhook${ZVM_PAYT_SECRET?' (auth)':' (aberto)'}`);
    slog(LOG_LEVELS.INFO, `TOTP ZVM:      ${ZVM_TOTP_SECRET ? 'ATIVO' : '⚠ INATIVO'}`);
    slog(LOG_LEVELS.INFO, `HMAC slugs:    ${APP_SECRET ? 'ATIVO' : '⚠ INATIVO — rotas em modo padrão'}`);
    startAntiSleepCron();
  });
}

bootstrap().catch(err => {
  slog(LOG_LEVELS.CRITICAL, 'bootstrap fatal', { err: err.message });
  process.exit(1);
});
