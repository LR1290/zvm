'use strict';
const http   = require('http');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const PORT         = process.env.PORT         || 3000;
const ADMIN_USER   = process.env.ADMIN_USER;
const ADMIN_PASS   = process.env.ADMIN_PASS;

const MODS = [
  { user: process.env.MOD_USER  || '', pass: process.env.MOD_PASS  || '', totp: process.env.MOD_TOTP  || '', name: 'Moderador'   },
  { user: process.env.MOD2_USER || '', pass: process.env.MOD2_PASS || '', totp: process.env.MOD2_TOTP || '', name: 'Simplifique' },
  { user: process.env.MOD3_USER || '', pass: process.env.MOD3_PASS || '', totp: process.env.MOD3_TOTP || '', name: 'BS'          },
  { user: process.env.MOD4_USER || '', pass: process.env.MOD4_PASS || '', totp: process.env.MOD4_TOTP || '', name: 'Acaraí'      },
  { user: process.env.MOD5_USER || '', pass: process.env.MOD5_PASS || '', totp: process.env.MOD5_TOTP || '', name: 'Darley'      },
  { user: process.env.MOD6_USER || '', pass: process.env.MOD6_PASS || '', totp: process.env.MOD6_TOTP || '', name: 'Letícia'     },
].filter(m => m.user && m.pass);

const PAYT_SECRET  = process.env.PAYT_SECRET  || '';
const ANALYTICS_PASS = process.env.ANALYTICS_PASS || '';
const MONGODB_URI  = process.env.MONGODB_URI  || '';
const APP_SECRET   = process.env.APP_SECRET   || '';
const TOTP_SECRET  = process.env.TOTP_SECRET  || '';
const WEBHOOK_URL  = process.env.WEBHOOK_URL  || '';
const EXPIRY_WARN_HOURS = Math.max(1, Math.min(720, parseInt(process.env.EXPIRY_WARN_HOURS || '48') || 48));

const LOG_RETENTION_DAYS = Math.max(1, parseInt(process.env.LOG_RETENTION_DAYS || '90') || 90);

const LOG_MAX = Math.min(parseInt(process.env.LOG_MAX || '500'), 2000);

if (!ADMIN_USER || !ADMIN_PASS) {
  console.error('❌ ERRO CRÍTICO: Defina ADMIN_USER e ADMIN_PASS nas variáveis de ambiente.');
  process.exit(1);
}
if (!MONGODB_URI) {
  console.error('❌ ERRO CRÍTICO: Defina MONGODB_URI nas variáveis de ambiente.');
  process.exit(1);
}

const FULL_PERMISSIONS = [
  'create_flow','massive_dispatching','schedule_item',
  'send_flow','send_funnel','send_trigger','zapsaver'
];
const USAGE_LIMITS = {
  audio:        { sent:0, max:-1 }, bulkMessages: { sent:0, max:-1 },
  document:     { sent:0, max:-1 }, flow:         { sent:0, max:-1 },
  funnel:       { sent:0, max:-1 }, media:        { sent:0, max:-1 },
  message:      { sent:0, max:-1 }, scheduleItem: { sent:0, max:-1 }
};
const MAX_USES = 3;
const AVAILABLE_MODULES = ['zapSaver'];
const DEFAULT_MODULES = Object.fromEntries(AVAILABLE_MODULES.map(m => [m, false]));

let _mongoClient = null;
let _mongoDb     = null;

async function getMongoDb() {
  if (_mongoDb) return _mongoDb;
  try {
    if (!_mongoClient) {
      _mongoClient = new MongoClient(MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 5000,
        tls: true,
        tlsAllowInvalidCertificates: false,
        tlsAllowInvalidHostnames: false,
      });
      await _mongoClient.connect();
      console.log('✅ MongoDB conectado');
    }
    _mongoDb = _mongoClient.db('zapvoice');
    return _mongoDb;
  } catch(e) {

    _mongoDb = null;
    _mongoClient = null;
    throw e;
  }
}

async function loadDb() {
  try {
    const db = await getMongoDb();
    const keysDoc = await db.collection('store').findOne({ _id: 'keys' });
    const logsDoc = await db.collection('store').findOne({ _id: 'logs' });
    return {
      keys: keysDoc ? keysDoc.data : {},
      logs: logsDoc ? logsDoc.data : [],
    };
  } catch (e) {
    console.error('[DB] Erro ao carregar:', e.message);
    return { keys: {}, logs: [] };
  }
}

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
    } catch (e) {
        console.error('[DB] Erro ao salvar chave:', e.message);
    }
  }, 2000);
  _saveDebounce.set(code, tid);
}

async function deleteKeyFromDb(code) {
  try {
    const db = await getMongoDb();
    await db.collection('store').updateOne(
      { _id: 'keys' },
      { $unset: { [`data.${code}`]: '' }, $set: { updatedAt: new Date() } }
    );
  } catch (e) {
    console.error('[DB] Erro ao deletar chave:', e.message);
  }
}

async function saveLogs() {
  try {
    const db = await getMongoDb();
    const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    logs = logs.filter(l => l.timestamp >= cutoff);
    if (logs.length > LOG_MAX) logs = logs.slice(0, LOG_MAX);
    await db.collection('store').updateOne(
      { _id: 'logs' },
      { $set: { _id: 'logs', data: logs, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (e) {
    console.error('[DB] Erro ao salvar logs:', e.message);
  }
}

let keys             = {};
let logs             = [];
let sessions         = {};
let modSessions      = {};
let analyticsSessions= {};
let serverReady      = false;

const APP_SECRET_KEY = (() => {
  if (!APP_SECRET) return '';
  if (/^[0-9a-fA-F]+$/.test(APP_SECRET) && APP_SECRET.length % 2 === 0) {
    return Buffer.from(APP_SECRET, 'hex');
  }
  return APP_SECRET;
})();
const HMAC_TOLERANCE = 5 * 60 * 1000;

function verifyHmac(rawBody, sig, ts) {
  if (!APP_SECRET_KEY) return true;
  if (!sig && !ts) return true;
  if (!sig || !ts) return false;
  const t = parseInt(ts, 10);
  if (isNaN(t) || Math.abs(Date.now() - t) > HMAC_TOLERANCE) return false;
  const expected = crypto.createHmac('sha256', APP_SECRET_KEY)
    .update(ts + '.' + rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(sig,'hex'), Buffer.from(expected,'hex')); }
  catch { return false; }
}

function base32Decode(b32) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0;
  const out = [];
  for (const c of b32.toUpperCase().replace(/=+$/, '')) {
    val = (val << 5) | alpha.indexOf(c);
    bits += 5;
    if (bits >= 8) { bits -= 8; out.push((val >> bits) & 0xff); }
  }
  return Buffer.from(out);
}

function generateTOTP(secret, window = 0) {
  const key   = base32Decode(secret);
  const epoch = Math.floor(Date.now() / 1000);
  const step  = Math.floor(epoch / 30) + window;
  const buf   = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  buf.writeUInt32BE(step >>> 0, 4);
  const hmac  = crypto.createHmac('sha1', key).update(buf).digest();
  const off   = hmac[hmac.length - 1] & 0xf;
  return ((hmac.readUInt32BE(off) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}

function verifyTOTP(secret, token) {
  if (!secret) return true;
  if (!token || token.length !== 6) return false;
  for (const w of [-2, -1, 0, 1, 2]) {  // drift window ampliado
    if (generateTOTP(secret, w) === token) return true;
  }
  return false;
}

function deriveSlug(seed) {
  if (!APP_SECRET) return null;
  return crypto.createHmac('sha256', APP_SECRET).update(seed).digest('hex').slice(0, 14);
}
const _slugAdmin     = deriveSlug('admin-panel');
const _slugMod       = deriveSlug('mod-panel');
const _slugAnalytics = deriveSlug('analytics-panel');
const R_ADMIN        = _slugAdmin     ? '/' + _slugAdmin     : '/admin';
const R_MOD          = _slugMod       ? '/' + _slugMod       : '/mod';
const R_ANALYTICS    = _slugAnalytics ? '/' + _slugAnalytics : '/analytics';
const R_EXT          = '/extension';

const rateLimitMap = new Map();
const RL_CONFIG = {
  login:        { max: 5,  windowMs: 60000, blockMs: 10 * 60000 },
  api:          { max: 30, windowMs: 60000, blockMs:  2 * 60000 },
  ext_key:      { max: 20, windowMs: 60000, blockMs:  5 * 60000 },
  check_status: { max: 60, windowMs: 60000, blockMs: 60000 },
};

function checkRateLimit(ip, type = 'api', maxReq = 0, windowMs = 0) {
  const now = Date.now();
  const key = ip + ':' + type;
  const cfg = maxReq > 0 ? { max: maxReq, windowMs: windowMs || 60000, blockMs: 2*60000 } : (RL_CONFIG[type] || RL_CONFIG.api);
  let e = rateLimitMap.get(key);
  if (!e) {
    e = { count: 0, resetAt: now + cfg.windowMs, blockedUntil: 0};
    rateLimitMap.set(key, e);
  }
  if (now < e.blockedUntil) return false;
  if (now > e.resetAt) { e.count = 0; e.resetAt = now + cfg.windowMs; e.blockedUntil = 0; }
  e.count++;
  if (e.count > cfg.max) {
    e.blockedUntil = now + cfg.blockMs;
    console.warn(`[RATE-LIMIT] ${type} — IP bloqueado: ${ip}`);
    return false;
  }
  return true;
}

function getRateLimitWait(ip, type = 'login') {
  const e = rateLimitMap.get(ip + ':' + type);
  if (!e || Date.now() >= e.blockedUntil) return 0;
  return Math.ceil((e.blockedUntil - Date.now()) / 60000);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, e] of rateLimitMap.entries())
    if (now > e.blockedUntil && now > e.resetAt) rateLimitMap.delete(k);
  const dedupTTL = 60 * 60 * 1000;
  for (const [k, ts] of _dedupMap.entries())
    if (now - ts > dedupTTL) _dedupMap.delete(k);
}, 30 * 60 * 1000); // 30 min — recursos mínimos

setInterval(() => {
  const now = Date.now();
  for (const [k, s] of Object.entries(sessions))
    if (now > new Date(s.expiresAt).getTime()) delete sessions[k];
  for (const [k, s] of Object.entries(modSessions))
    if (now > new Date(s.expiresAt).getTime()) delete modSessions[k];
  for (const [k, s] of Object.entries(analyticsSessions))
    if (now > new Date(s.expiresAt).getTime()) delete analyticsSessions[k];
}, 60 * 60 * 1000); // 1h — sessões duram horas, limpeza não precisa ser frequente

async function fireWebhook(event, keyCode, reason) {
  if (!WEBHOOK_URL) return;
  const k = keys[keyCode];
  const payload = {
    event, keyCode,
    label:     k?.label || '-',
    phone:     k?.lastPhone || '-',
    reason,
    timestamp: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  };
  try {
    const { default: https } = await import(WEBHOOK_URL.startsWith('https') ? 'https' : 'http');
    const url  = new URL(WEBHOOK_URL);
    const data = JSON.stringify(payload);
    const req  = https.request({
      hostname: url.hostname, port: url.port || (WEBHOOK_URL.startsWith('https') ? 443 : 80),
      path: url.pathname + url.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    });
    req.on('error', e => console.warn('[WEBHOOK] Erro:', e.message));
    req.write(data); req.end();
  } catch (e) { console.warn('[WEBHOOK] Falha:', e.message); }
}

function generateCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const seg = () => Array.from({length:5}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  return `zv-${seg()}-${seg()}-${seg()}`;
}
function generateToken() { return crypto.randomBytes(32).toString('hex'); }

function getAuthData(keyCode, userName) {
  const k = keys[keyCode] || {};
  return {
    numberWarning: false, segments: [],
    isLoggedIn: true, isPremium: true,
    modules: { ...DEFAULT_MODULES, ...(k.modules || {}) },
    data: {
      key: keyCode, keyId: `id-${keyCode}`, ownerId: 'zv-owner', managerId: 'zv-manager',
      permissions: FULL_PERMISSIONS,
      username: userName || k.label || '',
      paymentUrl: null, marketplace: 'premium', email: 'cliente@zapvoice.com.br',
      planName: 'Pro', plan_id: 'ZV_PRO', isLoggedIn: true, isPremium: true, isBasicPlan: false,
      message: '', warnLimit: false
    }
  };
}

function isKeyExpired(k) {
  if (!k.expiresAt) return false;
  return new Date() > new Date(k.expiresAt);
}

function isKeyExpiringSoon(k) {
  if (!k.expiresAt || isKeyExpired(k)) return false;
  return (new Date(k.expiresAt) - new Date()) <= EXPIRY_WARN_HOURS * 3600000;
}

function hoursUntilExpiry(k) {
  if (!k.expiresAt) return null;
  return Math.max(0, Math.floor((new Date(k.expiresAt) - new Date()) / 3600000));
}

function getIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress || 'N/A';
}

function isAdminSession(req) {
  const cookie = req.headers.cookie || '';
  const match  = cookie.match(/zv_admin=([a-f0-9]+)/);
  if (!match) return false;
  const s = sessions[match[1]];
  if (!s) return false;
  if (new Date() > new Date(s.expiresAt)) { delete sessions[match[1]]; return false; }
  return true;
}

function isModSession(req) {
  const cookie = req.headers.cookie || '';
  const match  = cookie.match(/zv_mod=([a-f0-9]+)/);
  if (!match) return false;
  const s = modSessions[match[1]];
  if (!s) return false; // sessão perdida (restart) — cookie inválido
  if (new Date() > new Date(s.expiresAt)) { delete modSessions[match[1]]; return false; }
  return true;
}

function isAnalyticsSession(req) {
  const cookie = req.headers.cookie || '';
  const match  = cookie.match(/zv_an=([a-f0-9]+)/);
  if (!match) return false;
  const s = analyticsSessions[match[1]];
  if (!s) return false; // sessão não encontrada (servidor reiniciado) — cookie inválido
  if (new Date() > new Date(s.expiresAt)) { delete analyticsSessions[match[1]]; return false; }
  return true;
}
function clearAnalyticsCookie(res) {
  res.setHeader('Set-Cookie', 'zv_an=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict; Secure');
}

async function savePayment(payment) {
  try {
    const db = await getMongoDb();
    await db.collection('payments').insertOne({ ...payment, savedAt: new Date() });
  } catch (e) { console.error('[DB] Erro ao salvar pagamento:', e.message); }
}

async function getPayments({ startDate, endDate, limit = 500 } = {}) {
  try {
    const db     = await getMongoDb();
    const filter = {};
    if (startDate || endDate) {
      filter.paidAt = {};
      if (startDate) filter.paidAt.$gte = startDate;
      if (endDate)   filter.paidAt.$lte = endDate;
    }
    return await db.collection('payments')
      .find(filter)
      .sort({ paidAt: -1 })
      .limit(limit)
      .toArray();
  } catch (e) { console.error('[DB] Erro ao buscar pagamentos:', e.message); return []; }
}

async function getPaymentStats() {
  try {
    const db  = await getMongoDb();
    const now = new Date();
    const d7  = new Date(now - 7  * 86400000);
    const d30 = new Date(now - 30 * 86400000);

    const [total, last7, last30, byProduct, byDay, byHour, byMethod] = await Promise.all([
      db.collection('payments').countDocuments({ approved: true }),
      db.collection('payments').countDocuments({ approved: true, paidAt: { $gte: d7.toISOString() } }),
      db.collection('payments').countDocuments({ approved: true, paidAt: { $gte: d30.toISOString() } }),
      db.collection('payments').aggregate([
        { $match: { approved: true } },
        { $group: { _id: '$productName', count: { $sum: 1 }, revenue: { $sum: '$amount' } } },
        { $sort: { count: -1 } }
      ]).toArray(),
      db.collection('payments').aggregate([
        { $match: { approved: true, paidAt: { $gte: d30.toISOString() } } },
        { $group: {
          _id: { $substr: ['$paidAt', 0, 10] },
          count: { $sum: 1 }, revenue: { $sum: '$amount' }
        }},
        { $sort: { _id: 1 } }
      ]).toArray(),
      db.collection('payments').aggregate([
        { $match: { approved: true } },
        { $addFields: { hour: { $substr: ['$paidAt', 11, 2] } } },
        { $group: { _id: '$hour', count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]).toArray(),
      db.collection('payments').aggregate([
        { $match: { approved: true } },
        { $group: { _id: '$paymentMethod', count: { $sum: 1 }, revenue: { $sum: '$amount' } } },
        { $sort: { count: -1 } }
      ]).toArray(),
    ]);

    const [revTotalArr, revLast30Arr, revLast7Arr] = await Promise.all([
      db.collection('payments').aggregate([{ $match: { approved: true } },{ $group: { _id: null, total: { $sum: '$amount' } } }]).toArray(),
      db.collection('payments').aggregate([{ $match: { approved: true, paidAt: { $gte: d30.toISOString() } } },{ $group: { _id: null, total: { $sum: '$amount' } } }]).toArray(),
      db.collection('payments').aggregate([{ $match: { approved: true, paidAt: { $gte: d7.toISOString() } } },{ $group: { _id: null, total: { $sum: '$amount' } } }]).toArray(),
    ]);
    const revenueTotal   = revTotalArr[0]?.total  || 0;
    const revenueLast30  = revLast30Arr[0]?.total  || 0;
    const revenueLast7   = revLast7Arr[0]?.total   || 0;

    const retentionArr = await db.collection('payments').aggregate([
      { $match: { approved: true, clientEmail: { $exists: true, $ne: '' } } },
      { $group: { _id: '$clientEmail', count: { $sum: 1 }, total: { $sum: '$amount' } } },
      { $sort: { count: -1 } }
    ]).toArray();
    const uniqueClients  = retentionArr.length;
    const returningClients = retentionArr.filter(c => c.count > 1).length;
    const retentionRate  = uniqueClients ? Math.round((returningClients / uniqueClients) * 100) : 0;
    const topClients     = retentionArr.slice(0, 5);

    const expiredKeys = Object.values(keys).filter(k => {
      if (!k.expiresAt) return false;
      const exp = new Date(k.expiresAt);
      return exp > d30 && exp <= now;
    });
    const renewedEmails = new Set(
      (await db.collection('payments').find({ approved: true, paidAt: { $gte: d30.toISOString() } }).toArray())
        .map(p => p.clientEmail).filter(Boolean)
    );
    const churnedKeys = expiredKeys.filter(k => {
      const email = (k.note||'').match(/Email: ([^\s|]+)/)?.[1] || '';
      return email && !renewedEmails.has(email);
    }).length;
    const churnRate = expiredKeys.length ? Math.round((churnedKeys / expiredKeys.length) * 100) : 0;

    const modStats = {};
    Object.values(keys).forEach(k => {
      const match = (k.note||'').match(/\[Mod: ([^\]]+)\]/);
      if (match) {
        const name = match[1];
        if (!modStats[name]) modStats[name] = 0;
        modStats[name]++;
      }
    });
    const byMod = Object.entries(modStats).map(([name, count]) => ({ name, count })).sort((a,b) => b.count - a.count);

    return {
      total, last7, last30, revenueTotal, revenueLast30, revenueLast7,
      byProduct, byDay, byHour, byMethod,
      uniqueClients, returningClients, retentionRate, topClients,
      churnedKeys, churnRate, expiredKeys: expiredKeys.length,
      byMod,
    };
  } catch (e) { console.error('[DB] Erro nas stats:', e.message); return null; }
}

const MAX_BODY_SIZE = 64 * 1024; // 64KB — proteção contra DoS

function _safeParse(raw) {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const hop = Object.prototype.hasOwnProperty;
      if (hop.call(obj,'__proto__') || hop.call(obj,'constructor') || hop.call(obj,'prototype')) return {};
      return obj;
    }
    return obj || {};
  } catch { return {}; }
}
function parseBody(req) {
  return new Promise((resolve) => {
    let b = '', size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY_SIZE) { req.destroy(); resolve({}); return; }
      b += c;
    });
    req.on('end', () => resolve(_safeParse(b)));
  });
}

function parseFormBody(req) {
  return new Promise((resolve) => {
    let b = '', size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY_SIZE) { req.destroy(); resolve(new URLSearchParams()); return; }
      b += c;
    });
    req.on('end', () => resolve(new URLSearchParams(b)));
  });
}

function sendJson(res, data, status = 200) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Connection', 'keep-alive');
  res.writeHead(status); res.end(JSON.stringify(data));
}

function sendHtml(res, html, status = 200) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.writeHead(status); res.end(html);
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/`/g,'&#96;');
}

const DEDUP_WINDOWS = {
  'relogin_ok':   24 * 60 * 60 * 1000,
  'expired':       5 * 60 * 1000,
  'login_blocked': 5 * 60 * 1000,
  'warn_limit':   10 * 60 * 1000,
};
const _dedupMap = new Map();

async function addLog(entry) {
  const dedupMs = DEDUP_WINDOWS[entry.action];
  if (dedupMs) {
    const dedupKey = entry.action + ':' + (entry.keyCode||'') + ':' + (entry.phone||'');
    const lastTs = _dedupMap.get(dedupKey) || 0;
    if (Date.now() - lastTs < dedupMs) return;
    _dedupMap.set(dedupKey, Date.now());
  }
  logs.unshift({ ...entry, timestamp: new Date().toISOString() });

  if (logs.length > LOG_MAX) logs = logs.slice(0, LOG_MAX);
  await saveLogs();
}

const CANVAS_BG = `<canvas id="_cvs" style="position:fixed;inset:0;z-index:0;pointer-events:none"></canvas>
<script>(function(){var c=document.getElementById('_cvs'),ctx=c.getContext('2d');function resize(){c.width=window.innerWidth;c.height=window.innerHeight;}resize();window.addEventListener('resize',resize);var pts=Array.from({length:60},function(){return{x:Math.random()*c.width,y:Math.random()*c.height,vx:(Math.random()-.5)*.4,vy:(Math.random()-.5)*.4,r:Math.random()*2+.5};});function draw(){ctx.clearRect(0,0,c.width,c.height);pts.forEach(function(p){p.x+=p.vx;p.y+=p.vy;if(p.x<0||p.x>c.width)p.vx*=-1;if(p.y<0||p.y>c.height)p.vy*=-1;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle='rgba(124,58,237,0.5)';ctx.fill();});for(var i=0;i<pts.length;i++){for(var j=i+1;j<pts.length;j++){var dx=pts[i].x-pts[j].x,dy=pts[i].y-pts[j].y,d=Math.sqrt(dx*dx+dy*dy);if(d<130){ctx.beginPath();ctx.moveTo(pts[i].x,pts[i].y);ctx.lineTo(pts[j].x,pts[j].y);ctx.strokeStyle='rgba(124,58,237,'+(0.12*(1-d/130))+')';ctx.lineWidth=.7;ctx.stroke();}}}requestAnimationFrame(draw);}draw();})();</script>`;

function renderModLogin(error = '') {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Moderação</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3ELR%3C/text%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0f;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Space Mono',monospace;overflow:hidden}
.card{background:#111118;border:1px solid #1e1e2e;border-radius:18px;padding:40px 36px;width:360px;position:relative;z-index:1;box-shadow:0 0 40px rgba(79,142,247,0.12)}
.logo{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:#4f8ef7;margin-bottom:4px;text-align:center;letter-spacing:-0.5px}
.sub{color:#8a8aaa;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-bottom:24px;text-align:center;font-family:'Syne',sans-serif}
.badge{display:inline-block;background:#4f8ef712;border:1px solid #4f8ef730;color:#4f8ef7;font-size:13px;letter-spacing:1px;text-transform:uppercase;padding:4px 12px;border-radius:20px;margin-bottom:20px;font-family:'Syne',sans-serif;display:block;text-align:center}
label{display:block;font-size:12px;letter-spacing:1px;color:#8a8aaa;text-transform:uppercase;margin-bottom:7px;font-family:'Syne',sans-serif}
input{width:100%;padding:11px 14px;background:#0a0a0f;border:1px solid #1e1e2e;border-radius:8px;color:#e2e2f0;font-family:'Space Mono',monospace;font-size:13px;outline:none;margin-bottom:16px;transition:border .2s}
input:focus{border-color:#4f8ef7}
.btn{width:100%;padding:12px;background:#4f8ef7;border:none;border-radius:8px;color:#000;font-family:'Syne',sans-serif;font-weight:700;font-size:14px;cursor:pointer;transition:opacity .2s}
.btn:hover{opacity:.85}
.err{background:#ff475715;border:1px solid #ff4757;border-radius:6px;color:#ff4757;padding:11px 14px;font-size:14px;margin-bottom:16px;font-family:'Syne',sans-serif}
</style></head><body>
<div class="card">
  <div class="logo">⚡ ZVM</div>
  <div class="sub">Painel de Moderação</div>
  <div class="badge">👮 Acesso Moderador</div>
  ${error ? `<div class="err">${escHtml(error)}</div>` : ''}
  <form method="POST" action="${R_MOD}/login">
    <label>Usuário</label><input type="text" name="user" autocomplete="off">
    <label>Senha</label><input type="password" name="pass">
    ${MODS.some(m=>m.totp) ? `<label>Código 2FA (se configurado)</label><input type="text" name="totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" autocomplete="one-time-code" style="letter-spacing:4px;font-size:18px;text-align:center">` : ''}
    <button type="submit" class="btn">Entrar</button>
  </form>
</div>
${CANVAS_BG}</body></html>`;
}

function renderModDashboard(modName = 'Moderador') {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Moderação</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3ELR%3C/text%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --blue:#4f8ef7;--dark:#080810;--card:#0f0f1a;--card2:#13131f;
  --border:#1c1c2e;--border2:#252538;--text:#e2e2f0;--muted:#5a5a7a;
  --red:#ff4757;--green:#00ff87;--radius:10px;--radius-sm:6px;
}
body{background:var(--dark);color:var(--text);font-family:'Space Mono',monospace;min-height:100vh;overflow-x:hidden}
header{display:flex;align-items:center;justify-content:space-between;padding:12px 24px;border-bottom:1px solid var(--border);background:var(--card);position:sticky;top:0;z-index:50;box-shadow:0 2px 20px #00000040}
.logo{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:var(--blue);display:flex;align-items:center;gap:8px;letter-spacing:-0.5px}
main{position:relative;z-index:1}
.badge-mod{background:#4f8ef712;border:1px solid #4f8ef730;color:var(--blue);font-size:12px;letter-spacing:0;text-transform:uppercase;padding:4px 12px;border-radius:20px;font-family:'Syne',sans-serif;font-weight:700}
.hright{display:flex;align-items:center;gap:10px}
a.out{color:var(--muted);font-size:13px;text-decoration:none;padding:6px 14px;border:1px solid var(--border2);border-radius:var(--radius-sm);transition:all .2s;font-family:'Syne',sans-serif;font-weight:700}
a.out:hover{color:var(--red);border-color:var(--red)}
main{padding:28px 32px;max-width:1200px;margin:0 auto}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px}
.sc{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:24px 26px;position:relative;overflow:hidden;transition:border-color .2s}
.sc:hover{border-color:var(--border2)}
.sc-icon{position:absolute;right:14px;top:14px;font-size:22px;opacity:.12}
.sc .n{font-family:'Syne',sans-serif;font-size:40px;font-weight:800;color:var(--blue);line-height:1}
.sc .l{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.5px;margin-top:6px;font-family:'Syne',sans-serif}
.notice{background:#4f8ef708;border:1px solid #4f8ef720;border-radius:var(--radius);padding:16px 20px;margin-bottom:20px;display:flex;align-items:flex-start;gap:14px;font-size:15px;color:#a0a0c0;line-height:1.7;font-family:'Syne',sans-serif}
.notice strong{color:var(--blue)}
.alert-card{background:#ff860008;border:1px solid #ff860040;border-radius:var(--radius);padding:12px 18px;margin-bottom:20px;display:none;align-items:center;gap:12px;font-size:13px;color:#ff8600;font-family:'Syne',sans-serif}
.badge-exp{background:#ff860018;color:#ff8600;border:1px solid #ff860040;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:700;font-family:'Syne',sans-serif}
.badge-expired{background:#ff475718;color:#ff4757;border:1px solid #ff475740;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:700;font-family:'Syne',sans-serif}
.sec{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:20px}
.sh{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);background:var(--card2);flex-wrap:wrap;gap:10px}
.st{font-family:'Syne',sans-serif;font-weight:700;font-size:13px;color:var(--blue);display:flex;align-items:center;gap:6px}
.form-body{padding:20px 18px}
.form-grid{display:grid;grid-template-columns:2fr auto auto auto auto auto;gap:12px;align-items:end}
.fi{display:flex;flex-direction:column;gap:4px}
.fi label{font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;font-family:'Syne',sans-serif;font-weight:600}
.fi input{padding:10px 13px;background:var(--dark);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:'Syne',sans-serif;font-size:14px;outline:none;transition:border .18s}
.fi input:focus{border-color:var(--blue)}
.fi input::placeholder{color:var(--muted)}
.fi-wide{grid-column:1}
.fi-num input{width:70px;text-align:center}
.btn{padding:9px 18px;background:var(--blue);color:#000;border:none;border-radius:var(--radius-sm);font-family:'Syne',sans-serif;font-weight:700;font-size:12px;cursor:pointer;transition:all .18s;white-space:nowrap;align-self:end}
.btn:hover{opacity:.85;transform:translateY(-1px)}
.result-box{display:none;margin-top:18px;background:var(--dark);border:1px solid #4f8ef730;border-radius:var(--radius);padding:18px 20px}
.result-box.show{display:block}
.result-label{font-size:12px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;font-family:'Syne',sans-serif}
.result-key{font-family:'Space Mono',monospace;font-size:22px;color:var(--blue);letter-spacing:2px;word-break:break-all;margin-bottom:16px}
.result-meta{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
.result-tag{background:#4f8ef712;border:1px solid #4f8ef720;color:var(--blue);font-size:12px;padding:3px 10px;border-radius:20px}
.copy-btn{padding:8px 16px;background:#4f8ef718;color:var(--blue);border:1px solid #4f8ef730;border-radius:var(--radius-sm);font-family:'Syne',sans-serif;font-weight:700;font-size:13px;cursor:pointer;transition:all .2s}
.hist-table{width:100%;border-collapse:collapse;font-size:14px;font-family:'Syne',sans-serif}
.hist-table th{padding:9px 12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.3px;color:var(--muted);border-bottom:1px solid var(--border);background:var(--card2);font-weight:600;font-family:'Syne',sans-serif}
.hist-table td{padding:10px 12px;border-bottom:1px solid #14141f;vertical-align:middle}
.hist-table tr:last-child td{border-bottom:none}
.hist-table tr:hover td{background:#ffffff02}
.kc{color:var(--blue);font-size:13px;letter-spacing:.2px;font-family:'Space Mono',monospace}
.badge{padding:2px 7px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;font-family:'Syne',sans-serif}
.bon{background:#00ff8718;color:var(--green);border:1px solid #00ff8730}
.empty{text-align:center;color:var(--muted);padding:30px;font-size:13px;font-family:'Syne',sans-serif}
.note-btn{padding:3px 8px;background:#4f8ef710;color:var(--blue);border:1px solid #4f8ef730;border-radius:4px;cursor:pointer;font-family:'Syne',sans-serif;font-size:11px;font-weight:700;transition:all .15s}
.note-btn:hover{background:#4f8ef722;border-color:var(--blue)}

.ach-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;padding:18px}
.ach{background:var(--dark);border:1px solid var(--border);border-radius:10px;padding:14px 16px;display:flex;align-items:center;gap:12px;transition:all .2s;position:relative;overflow:hidden}
.ach.unlocked{border-color:#4f8ef740;background:#4f8ef708}
.ach.locked{opacity:.45;filter:grayscale(.8)}
.ach-icon{font-size:28px;flex-shrink:0}
.ach-info{flex:1;min-width:0}
.ach-name{font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:var(--text);margin-bottom:2px}
.ach-desc{font-size:11px;color:var(--muted);line-height:1.4}
.ach-badge{position:absolute;top:8px;right:8px;font-size:9px;font-weight:700;font-family:'Syne',sans-serif;padding:2px 6px;border-radius:10px;text-transform:uppercase;letter-spacing:.5px}
.ach.unlocked .ach-badge{background:#4f8ef720;color:var(--blue);border:1px solid #4f8ef740}
.ach.locked .ach-badge{background:#ffffff08;color:var(--muted);border:1px solid var(--border)}

.rank-grid{padding:18px;display:flex;flex-direction:column;gap:8px}
.rank-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:8px;background:var(--dark);border:1px solid var(--border);transition:all .2s}
.rank-row.me{border-color:#4f8ef760;background:#4f8ef710}
.rank-pos{font-family:'Syne',sans-serif;font-size:16px;font-weight:800;color:var(--muted);width:28px;flex-shrink:0;text-align:center}
.rank-row:nth-child(1) .rank-pos{color:#ffd32a}
.rank-row:nth-child(2) .rank-pos{color:#a0a0b0}
.rank-row:nth-child(3) .rank-pos{color:#cd7f32}
.rank-name{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;flex:1;color:var(--text)}
.rank-count{font-family:'Space Mono',monospace;font-size:13px;color:var(--blue);font-weight:700}
.rank-me-badge{font-size:10px;background:#4f8ef718;color:var(--blue);border:1px solid #4f8ef730;padding:2px 8px;border-radius:10px;font-family:'Syne',sans-serif;font-weight:700}
.toast{position:fixed;bottom:20px;right:20px;padding:11px 18px;border-radius:var(--radius);font-family:'Syne',sans-serif;font-weight:700;font-size:12px;display:none;z-index:999999;box-shadow:0 6px 30px #00000070}

.modal-bg{display:none;position:fixed;inset:0;background:#00000090;z-index:99999;align-items:center;justify-content:center;backdrop-filter:blur(3px)}
.modal-bg.open{display:flex}
.modal{background:var(--card);border:1px solid var(--border2);border-radius:12px;padding:22px;width:380px;max-width:95vw;box-shadow:0 20px 60px #00000090}
.modal h3{font-family:'Syne',sans-serif;font-size:14px;margin-bottom:12px;color:var(--blue)}
.modal textarea{width:100%;background:var(--dark);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:'Syne',sans-serif;font-size:13px;padding:10px;outline:none;resize:vertical;min-height:90px;transition:border .2s}
.modal textarea:focus{border-color:var(--blue)}
.modal-actions{display:flex;gap:8px;margin-top:12px;justify-content:flex-end}

#trophy-notif{position:fixed;bottom:28px;right:-420px;z-index:9999999;width:360px;background:linear-gradient(135deg,#0d0d1a,#141428);border:1px solid #4f8ef750;border-radius:14px;overflow:hidden;box-shadow:0 8px 40px #00000080;transition:right .5s cubic-bezier(.34,1.56,.64,1)}
#trophy-notif.show{right:28px}
#trophy-notif.hide{right:-420px;transition:right .4s ease-in}
.tn-top{display:flex;align-items:center;padding:10px 14px 8px;border-bottom:1px solid #ffffff08}
.tn-trophy-icon{font-size:11px;color:#ffd32a;font-family:'Syne',sans-serif;font-weight:700;letter-spacing:1px;text-transform:uppercase;display:flex;align-items:center;gap:5px}
.tn-trophy-icon::before{content:'🏆';font-size:13px}
.tn-body{display:flex;align-items:center;gap:14px;padding:14px}
.tn-icon{font-size:42px;flex-shrink:0;line-height:1}
.tn-text{flex:1;min-width:0}
.tn-label{font-size:10px;color:#4f8ef7;font-family:'Syne',sans-serif;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:3px}
.tn-name{font-size:16px;font-weight:800;color:#fff;font-family:'Syne',sans-serif;margin-bottom:3px}
.tn-desc{font-size:12px;color:#8a8aaa;font-family:'Syne',sans-serif}
.tn-bar-wrap{height:3px;background:#ffffff10;margin:0 14px 14px;border-radius:2px;overflow:hidden}
.tn-bar{height:3px;background:linear-gradient(90deg,#4f8ef7,#00ff87);border-radius:2px;width:0;transition:width 3s linear}
@media(max-width:1100px){.main-grid{grid-template-columns:1fr}}
@media(max-width:900px){.stats{grid-template-columns:repeat(2,1fr)}}
@media(max-width:700px){.form-grid{grid-template-columns:1fr 1fr};.stats{grid-template-columns:1fr 1fr};.ach-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<!-- PS5 Trophy Notification -->
<div id="trophy-notif">
  <div class="tn-top"><div class="tn-trophy-icon">Conquista Desbloqueada</div></div>
  <div class="tn-body">
    <div class="tn-icon" id="tn-icon">🏆</div>
    <div class="tn-text">
      <div class="tn-label">ZVM — Moderação</div>
      <div class="tn-name" id="tn-name">—</div>
      <div class="tn-desc" id="tn-desc">—</div>
    </div>
  </div>
  <div class="tn-bar-wrap"><div class="tn-bar" id="tn-bar"></div></div>
</div>

<header>
  <div class="logo">⚡ ZVM <span class="badge-mod">${modName}</span></div>
  <div class="hright"><a href="${R_MOD}/logout" class="out">↩ Sair</a></div>
</header>

<main>
  <div class="notice">
    <span style="font-size:16px;flex-shrink:0">🔒</span>
    <span><strong>Acesso restrito.</strong> Este painel permite apenas a criação de novas chaves. Dados de clientes, telefones, IPs e logs de acesso não estão disponíveis para moderadores.</span>
  </div>

  <!-- Stats -->
  <div class="stats">
    <div class="sc"><div class="sc-icon">🔑</div><div class="n" id="stat-total">—</div><div class="l">Total de Chaves</div></div>
    <div class="sc"><div class="sc-icon">✅</div><div class="n" id="stat-active">—</div><div class="l">Chaves Ativas</div></div>
    <div class="sc"><div class="sc-icon">📅</div><div class="n" id="stat-today">—</div><div class="l">Criadas Hoje</div></div>
    <div class="sc"><div class="sc-icon">⚠️</div><div class="n" id="stat-expiring" style="color:#ff8600">—</div><div class="l">Expirando em 48h</div></div>
  </div>

  <!-- Conquistas + Ranking — movidos para sidebar direita junto com tabela -->

  <div class="alert-card" id="alert-expiring">
    <span style="font-size:18px;flex-shrink:0">⚠️</span>
    <span id="alert-expiring-text"></span>
  </div>

  <div style="display:grid;grid-template-columns:1fr 340px;gap:20px;align-items:start">
  <div><!-- coluna esquerda: formulário + tabela -->
  <div class="sec">
    <div class="sh"><div class="st">🔑 Criar Nova Chave</div></div>
    <div class="form-body">
      <div class="form-grid">
        <div class="fi fi-wide">
          <label>Nome do Cliente</label>
          <input type="text" id="nlabel" placeholder="Ex: João Silva" autocomplete="off">
        </div>
        <div class="fi fi-num"><label>Dias</label><input type="number" id="ndays" placeholder="0" min="0"></div>
        <div class="fi fi-num"><label>Horas</label><input type="number" id="nhours" placeholder="0" min="0"></div>
        <div class="fi fi-num"><label>Usos</label><input type="number" id="nuses" placeholder="3" min="1"></div>
        <input type="hidden" id="ndeferred" value="1">
        <button class="btn" onclick="createKey()">+ Gerar</button>
      </div>
      <div class="result-box" id="result-box">
        <div class="result-label">Chave criada com sucesso</div>
        <div class="result-key" id="result-key"></div>
        <div class="result-meta" id="result-meta"></div>
        <button class="copy-btn" onclick="copyKey()">📋 Copiar Chave</button>
      </div>
    </div>
  </div>

  <div class="sec">
    <div class="sh">
      <div class="st">📋 Chaves Criadas por Mim</div>
      <button class="btn" style="background:#4f8ef718;color:var(--blue);border:1px solid #4f8ef730;font-size:13px;padding:6px 12px" onclick="loadHistory()">↻ Atualizar</button>
    </div>
    <div style="overflow-x:auto">
      <table class="hist-table">
        <thead><tr>
          <th>Chave</th><th>Cliente</th><th>Usos</th><th>Validade</th><th>Criada em</th><th>Nota</th><th>Status</th>
        </tr></thead>
        <tbody id="hist-body"><tr><td colspan="7" class="empty">Clique em Atualizar para carregar</td></tr></tbody>
      </table>
    </div>
  </div>
  </div><!-- fim coluna esquerda -->
  <div><!-- coluna direita: conquistas + ranking -->
    <div class="sec" style="margin-bottom:20px">
      <div class="sh"><div class="st">🏆 Conquistas</div><span id="ach-count" style="font-size:11px;color:var(--muted);font-family:'Syne',sans-serif"></span></div>
      <div class="ach-grid" id="ach-grid"><div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">Clique em Atualizar para carregar</div></div>
    </div>
    <div class="sec">
      <div class="sh"><div class="st">📊 Ranking</div></div>
      <div class="rank-grid" id="rank-grid"><div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">Clique em Atualizar para carregar</div></div>
    </div>
  </div><!-- fim coluna direita -->
  </div><!-- fim grid principal -->
</main>

<div class="modal-bg" id="modNoteModal"><div class="modal">
  <h3>📝 Nota — <span id="modNoteLabel"></span></h3>
  <input type="hidden" id="modNoteCode">
  <textarea id="modNoteText" placeholder="Ex: Cliente preferencial, renovação pendente..."></textarea>
  <div class="modal-actions">
    <button style="padding:7px 14px;background:#1e1e2e;color:var(--muted);border:1px solid var(--border);border-radius:6px;font-family:'Syne',sans-serif;font-weight:700;font-size:12px;cursor:pointer" onclick="closeModNote()">Cancelar</button>
    <button style="padding:7px 14px;background:var(--blue);color:#fff;border:none;border-radius:6px;font-family:'Syne',sans-serif;font-weight:700;font-size:12px;cursor:pointer" onclick="saveModNote()">Salvar</button>
  </div>
</div></div>

<div class="toast" id="toast"></div>

<script>
const _RM = '${R_MOD}';
const _MODS = ${JSON.stringify(MODS.map(m => m.name))};

function toast(msg,ok=true){const t=document.getElementById('toast');t.textContent=msg;t.style.background=ok?'var(--blue)':'var(--red)';t.style.color='#fff';t.style.display='block';setTimeout(()=>t.style.display='none',3200);}

async function createKey(){
  const label=document.getElementById('nlabel').value.trim();
  const days=parseInt(document.getElementById('ndays').value||0);
  const hours=parseInt(document.getElementById('nhours').value||0);
  const _u=document.getElementById('nuses').value.trim();
  const maxUses=_u===''?3:parseInt(_u);
  if(!label){toast('Informe o nome do cliente.',false);return;}
  if(isNaN(maxUses)||maxUses<1){toast('Número de usos inválido.',false);return;}
  try{
    const body={label,maxUses,deferred:true};
    if(days>0)body.expireDays=days;
    if(hours>0)body.expireHours=hours;
    const r=await fetch(_RM+'/api/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(r.status===401){toast('Sessão expirada.',false);setTimeout(()=>location.href=_RM+'/logout',1500);return;}
    const d=await r.json();
    if(!d.ok){toast('Erro: '+(d.error||'desconhecido'),false);return;}
    document.getElementById('result-key').textContent=d.key;
    const meta=[];const exp=[];if(days>0)exp.push(days+'d');if(hours>0)exp.push(hours+'h');
    meta.push(exp.length?exp.join(' ')+' de validade':'Sem expiração');
    meta.push(maxUses+' dispositivo(s)');meta.push('Ativa ao 1º uso');
    document.getElementById('result-meta').innerHTML=meta.map(m=>'<span class="result-tag">'+m+'</span>').join('');
    document.getElementById('result-box').classList.add('show');
    ['nlabel','ndays','nhours','nuses'].forEach(id=>document.getElementById(id).value='');
    toast('✅ Chave criada: '+d.key);
    await loadHistory();
  }catch(e){toast('Erro de rede.',false);}
}

function copyKey(){const key=document.getElementById('result-key').textContent;navigator.clipboard.writeText(key).then(()=>toast('Chave copiada!')).catch(()=>{const ta=document.createElement('textarea');ta.value=key;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);toast('Chave copiada!');});}

function fmtDate(iso){if(!iso)return'—';const d=new Date(iso);return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'})+' '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});}
function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

const ACHIEVEMENTS=[
  {id:'first_key',icon:'🔑',name:'Primeira Chave',desc:'Crie sua primeira chave',req:k=>k.total>=1},
  {id:'keys_5',icon:'🎯',name:'5 Chaves',desc:'Crie 5 chaves no total',req:k=>k.total>=5},
  {id:'keys_10',icon:'💪',name:'10 Chaves',desc:'Crie 10 chaves no total',req:k=>k.total>=10},
  {id:'keys_25',icon:'🚀',name:'25 Chaves',desc:'Crie 25 chaves no total',req:k=>k.total>=25},
  {id:'keys_50',icon:'⭐',name:'50 Chaves',desc:'Crie 50 chaves no total',req:k=>k.total>=50},
  {id:'keys_100',icon:'💎',name:'100 Chaves',desc:'Crie 100 chaves no total',req:k=>k.total>=100},
  {id:'today_3',icon:'⚡',name:'Sprint do Dia',desc:'Crie 3 chaves em um único dia',req:k=>k.today>=3},
  {id:'today_5',icon:'🔥',name:'Em Chamas',desc:'Crie 5 chaves em um único dia',req:k=>k.today>=5},
  {id:'today_10',icon:'🌋',name:'Imparável',desc:'Crie 10 chaves em um único dia',req:k=>k.today>=10},
  {id:'active_10',icon:'✅',name:'10 Ativas',desc:'Tenha 10 chaves ativas ao mesmo tempo',req:k=>k.active>=10},
  {id:'active_25',icon:'🏅',name:'25 Ativas',desc:'Tenha 25 chaves ativas ao mesmo tempo',req:k=>k.active>=25},
  {id:'rank_1',icon:'🥇',name:'Número 1',desc:'Seja o moderador com mais chaves',req:k=>k.rank===1},
  {id:'no_expired',icon:'🛡️',name:'Zero Expiradas',desc:'Nenhuma chave expirada (min. 5 ativas)',req:k=>k.expired===0&&k.active>=5},
];
let _prevUnlocked=null,_trophyQueue=[],_trophyBusy=false;
function showTrophy(a){
  document.getElementById('tn-icon').textContent=a.icon;
  document.getElementById('tn-name').textContent=a.name;
  document.getElementById('tn-desc').textContent=a.desc;
  const bar=document.getElementById('tn-bar'),notif=document.getElementById('trophy-notif');
  bar.style.transition='none';bar.style.width='0%';notif.classList.remove('hide');
  requestAnimationFrame(()=>{
    notif.classList.add('show');
    setTimeout(()=>{bar.style.transition='width 3s linear';bar.style.width='100%';},150);
    setTimeout(()=>{notif.classList.remove('show');notif.classList.add('hide');setTimeout(()=>{notif.classList.remove('hide');_trophyBusy=false;if(_trophyQueue.length>0)setTimeout(()=>showTrophy(_trophyQueue.shift()),400);},450);},3600);
  });
}
function queueTrophy(a){if(_trophyBusy){_trophyQueue.push(a);return;}_trophyBusy=true;showTrophy(a);}
function checkNewAchievements(stats){
  const now=new Set(ACHIEVEMENTS.filter(a=>a.req(stats)).map(a=>a.id));
  if(_prevUnlocked===null){_prevUnlocked=now;return;}
  for(const a of ACHIEVEMENTS){if(!_prevUnlocked.has(a.id)&&now.has(a.id))queueTrophy(a);}
  _prevUnlocked=now;
}
function renderAchievements(stats){
  checkNewAchievements(stats);
  const grid=document.getElementById('ach-grid');
  const cel=document.getElementById('ach-count');
  if(!grid)return;
  const unlocked=ACHIEVEMENTS.filter(a=>a.req(stats));
  cel.textContent=unlocked.length+'/'+ACHIEVEMENTS.length+' conquistadas';
  grid.innerHTML=ACHIEVEMENTS.map(a=>{const ok=a.req(stats);return'<div class="ach '+(ok?'unlocked':'locked')+'"><div class="ach-icon">'+a.icon+'</div><div class="ach-info"><div class="ach-name">'+a.name+'</div><div class="ach-desc">'+a.desc+'</div></div><div class="ach-badge">'+(ok?'✓ Conquistada':'Bloqueada')+'</div></div>';}).join('');
}
function renderRanking(ranking,myName){
  const grid=document.getElementById('rank-grid');
  if(!grid)return;
  if(!ranking.length){grid.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">Sem dados</div>';return;}
  const medals=['🥇','🥈','🥉'];
  grid.innerHTML=ranking.map((r,i)=>'<div class="rank-row'+(r.name===myName?' me':'')+'"><div class="rank-pos">'+(medals[i]||('#'+(i+1)))+'</div><div class="rank-name">'+escHtml(r.name)+(r.name===myName?' <span class="rank-me-badge">Você</span>':'')+'</div><div class="rank-count">'+r.count+' chaves</div></div>').join('');
}
function updateStats(keys,myName){
  const now=new Date(),todayStr=now.toISOString().slice(0,10);
  const total=keys.length,active=keys.filter(k=>k.active).length;
  const expired=keys.filter(k=>!k.active&&k.expiresAt&&new Date(k.expiresAt)<now).length;
  const today=keys.filter(k=>(k.createdAt||'').startsWith(todayStr)).length;
  const expiring=keys.filter(k=>{if(!k.expiresAt||!k.active)return false;const h=(new Date(k.expiresAt)-now)/3600000;return h>0&&h<48;}).length;
  document.getElementById('stat-total').textContent=total;
  document.getElementById('stat-active').textContent=active;
  document.getElementById('stat-today').textContent=today;
  document.getElementById('stat-expiring').textContent=expiring;
  const rankMap={};
  _MODS.forEach(m=>rankMap[m]=0);
  if(myName&&!(myName in rankMap))rankMap[myName]=0;
  if(myName)rankMap[myName]=total;
  const ranking=Object.entries(rankMap).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count);
  const myRank=ranking.findIndex(r=>r.name===myName)+1;
  renderRanking(ranking,myName);
  renderAchievements({total,active,expired,today,rank:myRank});
}

async function loadHistory(){
  try{
    const r=await fetch(_RM+'/api/my-keys');
    if(r.status===401){toast('Sessão expirada. Redirecionando...',false);setTimeout(()=>location.href=_RM+'/logout',1500);return;}
    const d=await r.json();
    if(d.error==='db_error'){toast('Erro de conexão. Tente novamente.',false);return;}
    const tbody=document.getElementById('hist-body');
    if(!d.keys||d.keys.length===0){
      const msg=d.modName?'Nenhuma chave atribuída a <strong>'+escHtml(d.modName)+'</strong> ainda.':'Nenhuma chave encontrada.';
      tbody.innerHTML='<tr><td colspan="7" class="empty">'+msg+'</td></tr>';
      updateStats([],d.modName);return;
    }
    const now=Date.now();let expiringSoon=0,expired=0;
    tbody.innerHTML=d.keys.map(k=>{
      let expHtml='',expClass='';
      if(k.deferred){expHtml='<span style="color:var(--muted);font-size:12px">Ativa ao 1º uso</span>';}
      else if(k.expiresAt){
        const expTs=new Date(k.expiresAt).getTime(),diffH=Math.floor((expTs-now)/3600000),diffD=Math.floor(diffH/24),expDate=fmtDate(k.expiresAt);
        if(expTs<now){expired++;expHtml=expDate+'<br><span class="badge-expired">EXPIRADA</span>';expClass=' style="background:#ff000008"';}
        else if(diffH<48){expiringSoon++;const lbl=diffH<1?'menos de 1h':diffH<24?diffH+'h restantes':diffD+'d restantes';expHtml=expDate+'<br><span class="badge-exp" style="font-size:13px">⚠ '+lbl+'</span>';expClass=' style="background:#ff860008"';}
        else{const lbl=diffD>0?diffD+'d '+(diffH%24>0?(diffH%24)+'h':''):diffH+'h';expHtml=expDate+'<br><span style="color:var(--green);font-size:13px;font-family:Syne,sans-serif;font-weight:600">'+lbl.trim()+' restantes</span>';}
      }else{expHtml='<span style="color:var(--muted)">Sem expiração</span>';}
      const st=k.active?'<span class="badge bon">ATIVA</span>':'<span class="badge-expired">INATIVA</span>';
      const noteClean=(k.note||'').replace(/\[Mod:[^\]]+\]\s*/g,'').trim();
      const noteBtn='<button class="note-btn" data-code="'+escHtml(k.code)+'" data-label="'+escHtml(k.label)+'" data-note="'+escHtml(noteClean)+'" onclick="openModNoteEl(this)" style="float:right;margin-left:6px">✏️</button>';
      const noteHtml=noteClean?'<span style="font-size:12px;color:var(--muted);font-family:Syne,sans-serif;display:block;clear:both">'+escHtml(noteClean)+'</span>':'';
      return '<tr'+expClass+'><td><span class="kc">'+k.code+'</span></td><td>'+escHtml(k.label)+'</td><td>'+k.maxUses+'</td><td>'+expHtml+'</td><td>'+fmtDate(k.createdAt)+'</td><td>'+noteBtn+noteHtml+'</td><td>'+st+'</td></tr>';
    }).join('');
    const alertCard=document.getElementById('alert-expiring');
    if(expired>0||expiringSoon>0){
      alertCard.style.display='flex';
      const parts=[];
      if(expired>0)parts.push('<strong>'+expired+' chave(s) expirada(s)</strong>');
      if(expiringSoon>0)parts.push('<strong>'+expiringSoon+' expirando em 48h</strong>');
      document.getElementById('alert-expiring-text').innerHTML='⚠️ '+parts.join(' e ')+'. Contate o administrador.';
    }else{alertCard.style.display='none';}
    updateStats(d.keys,d.modName);
  }catch(e){toast('Erro ao carregar.',false);}
}

function openModNoteEl(el){openModNote(el.dataset.code,el.dataset.label,el.dataset.note);}
function openModNote(code,label,currentNote){
  document.getElementById('modNoteCode').value=code;
  document.getElementById('modNoteLabel').textContent=label;
  document.getElementById('modNoteText').value=currentNote||'';
  document.getElementById('modNoteModal').classList.add('open');
  setTimeout(()=>document.getElementById('modNoteText').focus(),100);
}
function closeModNote(){document.getElementById('modNoteModal').classList.remove('open');}
document.getElementById('modNoteModal').addEventListener('click',function(e){if(e.target===this)closeModNote();});
async function saveModNote(){
  const code=document.getElementById('modNoteCode').value;
  const note=document.getElementById('modNoteText').value.trim();
  try{
    const r=await fetch(_RM+'/api/keys/'+encodeURIComponent(code)+'/note',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note})});
    if(r.status===401){toast('Sessão expirada.',false);return;}
    const d=await r.json();
    if(d.ok){toast('✅ Nota salva!');closeModNote();await loadHistory();}
    else toast('Erro: '+(d.error||'?'),false);
  }catch(e){toast('Erro de rede.',false);}
}

setTimeout(loadHistory,300);
</script>
${CANVAS_BG}</body></html>`;
}

function renderExtensionLogin({ callback, error = '', keyVal = '' }) {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Ativação</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3ELR%3C/text%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0f;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Space Mono',monospace;overflow:hidden}
.card{background:#111118;border:1px solid #1e1e2e;border-radius:18px;padding:36px 32px;width:100%;max-width:420px;text-align:center;position:relative;z-index:1;box-shadow:0 0 40px rgba(124,58,237,0.15)}
.logo{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:#00ff87;margin-bottom:4px;letter-spacing:-0.5px}
.sub{color:#8a8aaa;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:28px;font-family:'Syne',sans-serif}
label{display:block;text-align:left;font-size:14px;letter-spacing:.5px;color:#8a8aaa;text-transform:uppercase;margin-bottom:10px;font-family:'Syne',sans-serif;font-weight:600}
input{width:100%;padding:13px 16px;background:#0a0a0f;border:1.5px solid #1e1e2e;border-radius:10px;color:#00ff87;font-family:'Space Mono',monospace;font-size:15px;outline:none;letter-spacing:2px;transition:border .2s}
input:focus{border-color:#00ff87}
.err{background:#ff475715;border:1px solid #ff4757;border-radius:8px;color:#ff4757;padding:13px 16px;font-size:14px;margin-bottom:18px;text-align:left;font-family:'Syne',sans-serif}
.btn{width:100%;padding:14px;background:#00ff87;border:none;border-radius:10px;color:#000;font-family:'Syne',sans-serif;font-weight:700;font-size:15px;cursor:pointer;margin-top:20px;transition:opacity .2s}
.btn:hover{opacity:.85}
.hint{margin-top:20px;color:#8a8aaa;font-size:13px;font-family:'Syne',sans-serif}.hint a{color:#00ff87;text-decoration:none}
</style>
</head><body>
<div class="card">
  <div class="logo">⚡ ZVM</div>
  <div class="sub">Ativação da Extensão</div>
  ${error ? `<div class="err">${escHtml(error)}</div>` : ''}
  <form method="POST" action="/extension/auth/verify">
    <input type="hidden" name="callback" value="${escHtml(callback)}">
    <label>Sua Chave de Ativação</label>
    <input type="text" name="key" value="${escHtml(keyVal)}" placeholder="zv-xxxxx-xxxxx-xxxxx" autocomplete="off" spellcheck="false" maxlength="20">
    <p style="text-align:left;font-size:13px;color:#8a8aaa;margin-top:8px;font-family:'Syne',sans-serif">Você recebeu esta chave junto com a sua compra.</p>
    <button type="submit" class="btn">Ativar Agora</button>
  </form>
  <div class="hint">Precisa de ajuda ou quer renovar?<br><a href="/planos">💳 Ver Planos</a> · <a href="https://wa.me/5521996771552?text=LR!%20Preciso%20de%20ajuda%20referente%20a%20minha%20renova%C3%A7%C3%A3o." target="_blank">💬 Suporte no WhatsApp</a></div>
</div>
${CANVAS_BG}</body></html>`;
}

function renderAdminLogin(error = '') {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM Admin</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='56%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='900' font-size='15' fill='%2300ff00'%3EZV%3C/text%3E%3C/svg%3E">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--g:#00ff00;--bg:#080810;--card:#0d0d18;--border:#1a1a2e;--t:#e2e2f0;--m:#5a5a8a}
body{background:var(--bg);min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;position:relative}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 80% 60% at 50% -10%,#00ff0010 0%,transparent 65%);pointer-events:none}
.grid{position:fixed;inset:0;background-image:linear-gradient(rgba(0,255,0,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,0,.03) 1px,transparent 1px);background-size:44px 44px;pointer-events:none}
.card{background:var(--card);border:1px solid #1e1e30;border-radius:16px;padding:40px 36px;width:100%;max-width:400px;position:relative;z-index:1;box-shadow:0 0 0 1px #00ff0008,0 20px 60px #00000090,inset 0 1px 0 #ffffff06}
.logo{display:flex;align-items:center;gap:10px;justify-content:center;margin-bottom:6px}
.logo-badge{width:38px;height:38px;background:linear-gradient(135deg,#00ff00,#00cc00);border-radius:9px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;color:#080810;flex-shrink:0}
.logo-name{font-size:20px;font-weight:800;color:var(--t);letter-spacing:-.5px}
.logo-sub{text-align:center;font-size:11px;color:var(--m);letter-spacing:2.5px;text-transform:uppercase;margin-bottom:28px}
.field{margin-bottom:15px}
.field label{display:block;font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:var(--m);margin-bottom:6px}
.field input{width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--t);font-size:13px;outline:none;transition:border-color .18s,box-shadow .18s;font-family:inherit}
.field input:focus{border-color:var(--g);box-shadow:0 0 0 3px #00ff0012}
.field .totp-input{font-size:20px;text-align:center;font-family:'Courier New',monospace;letter-spacing:7px}
.btn{width:100%;padding:12px;background:linear-gradient(135deg,#00ff00,#00cc00);border:none;border-radius:8px;color:#080810;font-weight:800;font-size:14px;cursor:pointer;transition:opacity .18s,transform .12s;margin-top:6px;letter-spacing:.2px;font-family:inherit}
.btn:hover{opacity:.88;transform:translateY(-1px)}
.btn:active{transform:none}
.err{background:#ff475712;border:1px solid #ff475740;border-radius:8px;color:#ff6b7a;padding:11px 14px;font-size:13px;margin-bottom:18px;display:flex;align-items:center;gap:7px}
</style></head><body>
<div class="grid"></div>
<div class="card">
  <div class="logo"><div class="logo-badge">ZV</div><div class="logo-name">ZVM Admin</div></div>
  <div class="logo-sub">Painel Administrativo</div>
  ${error ? `<div class="err"><span>⚠</span>${escHtml(error)}</div>` : ''}
  <form method="POST" action="${R_ADMIN}/login">
    <div class="field"><label>Usuário</label><input type="text" name="user" autocomplete="off" autofocus></div>
    <div class="field"><label>Senha</label><input type="password" name="pass"></div>
    ${TOTP_SECRET ? `<div class="field"><label>Código 2FA</label><input class="totp-input" type="text" name="totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000 000" autocomplete="one-time-code"></div>` : ''}
    <button type="submit" class="btn">Entrar no Painel</button>
  </form>
</div>
${CANVAS_BG}</body></html>`;
}


function renderClientPortal() {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Portal do Cliente</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3ELR%3C/text%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--green:#00ff87;--dark:#080810;--card:#0f0f1a;--border:#1c1c2e;--text:#e2e2f0;--muted:#8a8aaa;--radius:14px}
body{background:var(--dark);min-height:100vh;display:flex;flex-direction:column;font-family:'Inter',sans-serif;overflow-x:hidden;color:var(--text)}
nav{display:flex;align-items:center;justify-content:space-between;padding:14px 32px;border-bottom:1px solid var(--border);background:var(--card);position:sticky;top:0;z-index:50;box-shadow:0 2px 20px #00000040;flex-shrink:0}
.nav-logo{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:var(--green);text-decoration:none;display:flex;align-items:center;gap:6px;letter-spacing:-0.5px}
.nav-links{display:flex;gap:10px}
.nav-links a{font-size:14px;color:var(--muted);text-decoration:none;padding:8px 16px;border:1px solid var(--border);border-radius:8px;transition:all .2s;font-family:'Syne',sans-serif;font-weight:700}
.nav-links a:hover{color:var(--green);border-color:var(--green)}
.page-body{flex:1;display:flex;align-items:center;justify-content:center;padding:20px;min-height:calc(100vh - 57px);flex-direction:column}
.form-wrap{width:100%;max-width:480px;position:relative;z-index:1;display:flex;flex-direction:column;align-items:stretch}
.logo{font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:var(--green);margin-bottom:4px;letter-spacing:-0.5px}
.sub{color:var(--muted);font-size:13px;letter-spacing:2px;text-transform:uppercase;margin-bottom:32px;font-family:'Syne',sans-serif}
label{display:block;text-align:left;font-size:13px;letter-spacing:.5px;color:var(--muted);text-transform:uppercase;margin-bottom:10px;font-family:'Syne',sans-serif;font-weight:600}
input{width:100%;padding:15px 18px;background:var(--dark);border:1.5px solid var(--border);border-radius:10px;color:var(--green);font-family:'Space Mono',monospace;font-size:16px;outline:none;letter-spacing:2px;transition:border .2s}
input:focus{border-color:var(--green)}
.btn{width:100%;padding:16px;background:var(--green);border:none;border-radius:10px;color:#000;font-family:'Syne',sans-serif;font-weight:800;font-size:16px;cursor:pointer;margin-top:18px;transition:all .25s}
.btn:hover{opacity:.9;transform:translateY(-2px);box-shadow:0 8px 24px #00ff8750}
.btn:disabled{opacity:.4;cursor:not-allowed;transform:none;box-shadow:none}
.err{background:#ff475715;border:1px solid #ff4757;border-radius:8px;color:#ff4757;padding:13px 16px;font-size:14px;margin-bottom:18px;text-align:left;font-family:'Inter',sans-serif}
.result-wrap{width:100%;max-width:1100px;margin:0 auto;padding:24px 32px;position:relative;z-index:1;display:none}
.panel{display:none}
.panel.active{display:block}
.panel-title{font-family:'Syne',sans-serif;font-size:18px;font-weight:800;color:var(--text);margin-bottom:16px;display:flex;align-items:center;gap:8px}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px}
.info-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 18px}
.info-card .lbl{font-size:12px;letter-spacing:.3px;text-transform:uppercase;color:var(--muted);margin-bottom:6px;font-family:'Syne',sans-serif;font-weight:600}
.info-card .val{font-size:16px;color:var(--text);font-family:'Syne',sans-serif;font-weight:700}
.badge{display:inline-block;padding:5px 14px;border-radius:20px;font-size:14px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;font-family:'Syne',sans-serif}
.row{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #1e1e2e30}
.row:last-child{border-bottom:none}
.row-label{font-size:14px;letter-spacing:.3px;text-transform:uppercase;color:var(--muted);font-family:'Syne',sans-serif}
.row-val{font-size:14px;color:var(--text);text-align:right;font-family:'Syne',sans-serif;font-weight:600}
.badge-on{background:#00ff8720;color:#00ff87;border:1px solid #00ff8740}
.badge-off{background:#ff475720;color:#ff4757;border:1px solid #ff475740}
.badge-warn{background:#ffa50020;color:#ffa500;border:1px solid #ffa50040}
.badge-def{background:#6b6b8a20;color:#6b6b8a;border:1px solid #6b6b8a40}
.hint{margin-top:22px;color:#8a8aaa;font-size:13px;line-height:1.8;font-family:'Syne',sans-serif}.hint a{color:#00ff87;text-decoration:none}
.expire-bar-wrap{margin-top:6px;background:#1e1e2e;border-radius:6px;overflow:hidden;height:6px}
.expire-bar{height:6px;border-radius:6px;transition:width .6s}
.section-links{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.link-btn{padding:14px 12px;background:#0f0f1a;border:1px solid #1c1c2e;border-radius:10px;color:#e2e2f0;font-family:'Syne',sans-serif;font-size:14px;font-weight:700;text-align:center;text-decoration:none;transition:all .2s;display:block}
.link-btn:hover{border-color:#00ff87;color:#00ff87;transform:translateY(-2px)}
@media(max-width:900px){.page-body{grid-template-columns:1fr}.col-left{border-right:none;border-bottom:1px solid var(--border)}.section-links{grid-template-columns:1fr 1fr}}
.spinner{display:inline-block;width:15px;height:15px;border:2px solid #00ff8730;border-top-color:#00ff87;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:8px}
@keyframes spin{to{transform:rotate(360deg)}}
.loading-overlay{position:fixed;inset:0;background:#0a0a0f;display:flex;align-items:center;justify-content:center;z-index:99}
.privacy-note{margin-top:16px;padding:12px 16px;background:#1e1e2e30;border-radius:8px;font-size:14px;color:#a0a0c0;text-align:left;line-height:1.7;font-family:'Syne',sans-serif}
.privacy-note a{color:#4f8ef7;text-decoration:none}
</style>
</head><body>
<nav>
  <a href="/" class="nav-logo">⚡ ZVM</a>
  <div class="nav-links">
    <a href="/faq">FAQ</a>
    <a href="https://wa.me/5521996771552?text=LR!%20Preciso%20de%20ajuda." target="_blank">💬 Suporte</a>
  </div>
</nav>
<div id="loading-overlay" class="loading-overlay"><span class="spinner"></span></div>
<div class="page-body">
  <div class="form-wrap" id="main-form-wrap">
    <div style="background:#111118;border:1px solid #1e1e2e;border-radius:18px;padding:36px 32px;text-align:center">
    <div class="logo">⚡ ZVM</div>
    <div class="sub">Portal do Cliente</div>
    <div id="form-area">
      <div id="err-box" class="err" style="display:none"></div>
      <label>Sua Chave de Ativação</label>
      <input type="text" id="key-input" placeholder="zv-xxxxx-xxxxx-xxxxx" autocomplete="off" spellcheck="false" maxlength="20">
      <p style="text-align:left;font-size:13px;color:#8a8aaa;margin-top:8px;font-family:'Syne',sans-serif">Você recebeu esta chave junto com a sua compra.</p>
      <button class="btn" id="check-btn" onclick="checkKey()">Consultar Minha Chave</button>
      <a class="btn" href="/faq" style="display:block;margin-top:10px;background:#1e1e2e;color:#8a8aaa;font-size:14px;text-decoration:none;text-align:center;padding:13px;border-radius:10px;border:1px solid #2a2a3e;transition:border-color .2s,color .2s;font-family:'Syne',sans-serif;font-weight:700" onmouseover="this.style.borderColor='#00ff87';this.style.color='#00ff87'" onmouseout="this.style.borderColor='#2a2a3e';this.style.color='#6b6b8a'">❓ FAQ — Dúvidas Frequentes</a>
      <a class="btn" href="/planos" style="display:block;margin-top:8px;background:#00ff8710;color:#00ff87;font-size:14px;text-decoration:none;text-align:center;padding:13px;border-radius:10px;border:1px solid #00ff8730;transition:all .2s;font-family:'Syne',sans-serif;font-weight:700" onmouseover="this.style.background='#00ff8720';this.style.borderColor='#00ff87'" onmouseout="this.style.background='#00ff8710';this.style.borderColor='#00ff8730'">💳 Ver Planos e Preços</a>
      <div class="privacy-note">🔒 Ao usar este serviço, você concorda com nossa <a href="/privacidade">Política de Privacidade</a> e com a coleta de dados de uso para fins de licenciamento (LGPD).</div>
    </div>
    <div class="hint" style="margin-top:20px;color:#a0a0c0;font-size:14px;font-family:'Syne',sans-serif;text-align:center">
      Precisa de ajuda? <a href="/planos" style="color:var(--green)">💳 Planos</a> · <a href="https://wa.me/5521996771552?text=LR!%20Preciso%20de%20ajuda." target="_blank" style="color:var(--green)">💬 Suporte</a>
    </div>
    </div><!-- fecha card -->
  </div><!-- fecha form-wrap -->
  <div class="result-wrap" id="result-wrap">
    <div id="result-panel" style="display:block">
      <div class="panel-title" id="panel-name">Minha Conta</div>
      <div class="info-grid">
        <div class="info-card"><div class="lbl">Status</div><div class="val" id="r-status">—</div></div>
        <div class="info-card"><div class="lbl">Dispositivos</div><div class="val" id="r-phones">—</div></div>
        <div class="info-card" style="grid-column:span 2"><div class="lbl">Expira em</div><div class="val"><span id="r-expires">—</span><div class="expire-bar-wrap" id="r-bar-wrap" style="display:none;margin-top:10px"><div class="expire-bar" id="r-bar"></div></div></div></div>
        <div class="info-card" id="r-act-card" style="display:none"><div class="lbl">Ativada em</div><div class="val" id="r-activated">—</div></div>
        <div class="info-card" id="r-last-card" style="display:none"><div class="lbl">Último uso</div><div class="val" id="r-lastused">—</div></div>
      </div>
      <div id="r-phone-section" style="display:none;margin-bottom:16px">
        <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:10px;font-family:'Syne',sans-serif;font-weight:700">Dispositivos cadastrados</div>
        <div id="r-phone-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px"></div>
        <div style="font-size:13px;color:var(--muted);margin-top:12px;font-family:'Syne',sans-serif">Remova um número para liberar o slot.</div>
      </div>
      <div id="r-renew-banner" style="display:none;margin-bottom:20px;background:#00ff8710;border:1px solid #00ff8730;border-radius:12px;padding:18px 22px;display:flex;align-items:center;justify-content:space-between;gap:16px">
        <div>
          <div style="font-size:16px;color:#00ff87;font-family:'Syne',sans-serif;font-weight:800;margin-bottom:4px">🔄 Hora de renovar!</div>
          <div style="font-size:13px;color:var(--muted)">Renove agora e o tempo é somado ao restante.</div>
        </div>
        <a href="/planos" style="flex-shrink:0;padding:12px 24px;background:#00ff87;color:#000;font-family:'Syne',sans-serif;font-weight:800;font-size:14px;border-radius:8px;text-decoration:none;white-space:nowrap">💳 Ver Planos</a>
      </div>
      <div class="section-links" id="r-links" style="margin-bottom:20px"></div>
      <button onclick="resetPanel()" style="padding:12px 24px;background:#1e1e2e;color:var(--muted);border:1px solid var(--border);border-radius:8px;font-family:'Syne',sans-serif;font-weight:700;font-size:14px;cursor:pointer;transition:all .2s" onmouseover="this.style.borderColor='#00ff87';this.style.color='#00ff87'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--muted)'">← Consultar outra chave</button>
    </div>
</div>
<script>
function fmtDate(iso){if(!iso)return'—';const d=new Date(iso);return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'})+' '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});}

function fmtHours(h){if(h===null||h===undefined)return null;if(h>=48)return Math.floor(h/24)+' dias';if(h>=1)return h+'h';return'menos de 1h';}
async function doCheck(key){
  const errBox=document.getElementById('err-box'),btn=document.getElementById('check-btn');
  errBox.style.display='none';
  if(!key){errBox.textContent='⚠️ Digite sua chave de ativação.';errBox.style.display='block';return;}
  btn.disabled=true;btn.innerHTML='<span class="spinner"></span>Consultando...';
  try{
    const r=await fetch('/client/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});
    const d=await r.json();
    if(!r.ok||d.error){errBox.textContent='❌ Chave não encontrada. Verifique se digitou corretamente.';errBox.style.display='block';btn.disabled=false;btn.textContent='Consultar Minha Chave';return;}
    showPanel(d,key);
  }catch(e){errBox.textContent='⚠️ Erro de conexão. Tente novamente.';errBox.style.display='block';btn.disabled=false;btn.textContent='Consultar Minha Chave';}
}
function checkKey(){doCheck(document.getElementById('key-input').value.trim().toLowerCase());}
function showPanel(d,key){
  document.getElementById('main-form-wrap').style.display='none';
  document.getElementById('result-wrap').style.display='block';
  document.getElementById('panel-name').textContent='👤 '+d.label;
  let badge;
  if(d.deferred)badge='<span class="badge badge-def">Aguardando 1º uso</span>';
  else if(!d.active&&d.expired)badge='<span class="badge badge-off">Expirada</span>';
  else if(!d.active)badge='<span class="badge badge-off">Bloqueada</span>';
  else if(d.hoursLeft!==null&&d.hoursLeft<48)badge='<span class="badge badge-warn">Expirando em breve</span>';
  else badge='<span class="badge badge-on">Ativa</span>';
  document.getElementById('r-status').innerHTML=badge;
  const maxTxt=d.maxUses===null?'∞':d.maxUses;
  document.getElementById('r-phones').textContent=d.phones+' / '+maxTxt;
  const expEl=document.getElementById('r-expires'),barWrap=document.getElementById('r-bar-wrap'),bar=document.getElementById('r-bar');
  if(d.deferred){expEl.textContent='Ativa ao 1º uso';barWrap.style.display='none';}
  else if(d.expired){expEl.textContent='Expirada em '+fmtDate(d.expiresAt);barWrap.style.display='none';}
  else if(d.expiresAt){const tl=fmtHours(d.hoursLeft);expEl.textContent=fmtDate(d.expiresAt)+(tl?' ('+tl+' restantes)':'');if(d.hoursLeft!==null){barWrap.style.display='block';const pct=Math.min(100,Math.max(2,(d.hoursLeft/(24*30))*100));bar.style.width=pct+'%';bar.style.background=d.hoursLeft<24?'#ff4757':d.hoursLeft<72?'#ffa500':'#00ff87';}}
  else{expEl.textContent='Sem expiração';barWrap.style.display='none';}
  const actCard=document.getElementById('r-act-card'),lastCard=document.getElementById('r-last-card');
  if(d.activatedAt&&actCard){actCard.style.display='block';document.getElementById('r-activated').textContent=fmtDate(d.activatedAt);}
  if(d.lastUsed&&lastCard){lastCard.style.display='block';document.getElementById('r-lastused').textContent=fmtDate(d.lastUsed);}
  document.getElementById('r-links').innerHTML='<a class="link-btn" href="https://app.zapvoice.com.br/dashboard/backup-fixer" target="_blank">🔧 Corrija Backups</a><a class="link-btn" href="https://app.zapvoice.com.br/dashboard/converter" target="_blank">🎵 Converta Áudios</a><a class="link-btn" href="https://wa.me/5521996771552?text=LR!%20Preciso%20de%20ajuda." target="_blank" style="border-color:#25d366;color:#25d366">💬 Suporte WhatsApp</a>';
  const renewBanner=document.getElementById('r-renew-banner');
  if(renewBanner){const showRenew=d.expired||(d.hoursLeft!==null&&d.hoursLeft<168);renewBanner.style.display=showRenew?'flex':'none';if(d.expired)renewBanner.querySelector('div div').textContent='⏰ Chave expirada!';}
  var phoneSec=document.getElementById('r-phone-section'),phoneList=document.getElementById('r-phone-list');
  if(d.phoneList&&d.phoneList.length>0){
    phoneSec.style.display='block';phoneList.innerHTML='';
    d.phoneList.forEach(function(item){
      var ph=item.display||item,pidx=item.idx!=null?item.idx:-1;
      var card=document.createElement('div');
      card.style.cssText='background:#0f0f1a;border:1px solid #1c1c2e;border-radius:8px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:8px';
      var sp=document.createElement('span');sp.style.cssText='font-size:13px;font-family:monospace;color:#e2e2f0;font-weight:700';sp.textContent=ph;
      var btn=document.createElement('button');btn.textContent='Remover';btn.style.cssText='padding:4px 10px;background:#ff4757;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-family:Syne,sans-serif;font-weight:700;flex-shrink:0';
      btn.addEventListener('click',function(){clientRemovePhone(key,pidx);});
      card.appendChild(sp);card.appendChild(btn);phoneList.appendChild(card);
    });
  } else phoneSec.style.display='none';
}
function resetPanel(){
  document.getElementById('main-form-wrap').style.display='flex';
  document.getElementById('result-wrap').style.display='none';
  const actCard=document.getElementById('r-act-card'),lastCard=document.getElementById('r-last-card');
  if(actCard)actCard.style.display='none';if(lastCard)lastCard.style.display='none';
  const btn=document.getElementById('check-btn');btn.disabled=false;btn.textContent='Consultar Minha Chave';
  document.getElementById('form-area').style.display='block';
}
async function clientRemovePhone(key,phoneIdx){
  if(!confirm('Remover este número desta chave?'))return;
  try{var r=await fetch('/client/remove-phone',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,phoneIdx})});var d=await r.json();if(d.ok){alert('Número removido! Você pode fazer login novamente.');doCheck(key);}else alert('Erro: '+(d.error||'?'));}catch(e){alert('Erro de rede.');}
}
document.getElementById('key-input').addEventListener('keydown',e=>{if(e.key==='Enter')checkKey();});
window.addEventListener('DOMContentLoaded',()=>{
  const params=new URLSearchParams(window.location.search);
  const autoKey=(params.get('key')||'').trim().toLowerCase();
  if(autoKey){document.getElementById('loading-overlay').style.display='flex';document.getElementById('form-area').style.display='none';doCheck(autoKey).finally(()=>{document.getElementById('loading-overlay').style.display='none';});}
  else document.getElementById('loading-overlay').style.display='none';
});
</script>
${CANVAS_BG}</body></html>`;
}

function buildKeysHtml() {
  const entries = Object.entries(keys);
  if (!entries.length) return `<tr><td colspan="11" class="empty">Nenhuma chave cadastrada ainda</td></tr>`;
  return entries.map(([code, k]) => {
    const expired  = isKeyExpired(k);
    const warnSoon = isKeyExpiringSoon(k);
    const uniqueIps = new Set(logs.filter(l => l.keyCode === code && l.ip).map(l => l.ip)).size;
    const recentLogs = logs.filter(l => l.keyCode === code && l.timestamp > new Date(Date.now()-86400000).toISOString());
    const recentIps  = new Set(recentLogs.filter(l => l.ip).map(l => l.ip));
    const clearedAt  = k.suspectClearedAt ? new Date(k.suspectClearedAt) : null;
    const isSuspect  = recentIps.size > 3 && !(clearedAt && (Date.now()-clearedAt.getTime()) < 172800000);

    const expHtml = (!k.expiresAt && k.expireDuration) ? (() => {
      const d=Math.floor(k.expireDuration/86400000),h=Math.floor((k.expireDuration%86400000)/3600000),m=Math.floor((k.expireDuration%3600000)/60000);
      const parts=[];if(d>0)parts.push(d+'d');if(h>0)parts.push(h+'h');if(m>0)parts.push(m+'m');
      return `<br><span style="color:var(--green);font-size:11px">⏱ Ao ativar: ${parts.join(' ')}</span>`;
    })() : k.expiresAt ? (() => {
      const exp=new Date(k.expiresAt),diffMs=exp-new Date(),diffH=Math.floor(diffMs/36e5),diffD=Math.floor(diffMs/864e5);
      let label=expired?'expirado':diffH<1?`exp: ${Math.floor((diffMs%36e5)/60000)}min`:diffH<24?`exp: ${diffH}h`:` exp: ${diffD}d — ${exp.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}`;
      return `<br><span style="font-size:11px;color:${expired?'var(--red)':warnSoon?'var(--orange)':'var(--yellow)'};">${label}</span>`;
    })() : '';

    const rowStyle = isSuspect ? ' style="background:#ff000008;outline:1px solid #ff475718"' : warnSoon && !expired ? ' style="background:#ff860008"' : '';
    const suspectBadge = isSuspect ? `<span title="${recentIps.size} IPs nas últimas 24h" style="color:#ff4757;font-size:11px;margin-left:4px">⚠</span>` : '';

    return `
<tr data-label="${escHtml(k.label.toLowerCase())}" data-phone="${escHtml(k.lastPhone||'')}" data-status="${k.active?'ativo':'bloqueado'}" data-uses="${k.uses||0}" data-created="${k.createdAt||''}" data-suspect="${isSuspect?'1':''}"${rowStyle}>
  <td><span class="kc">${escHtml(code)}</span></td>
  <td class="td-name">${escHtml(k.label)}${suspectBadge}</td>
  <td><span class="st-badge ${k.active?(k.expireDuration&&!k.expiresAt?'st-wait':'st-on'):'st-off'}">${k.active?(k.expireDuration&&!k.expiresAt?'AGUARDANDO':'ATIVO'):'BLOQUEADO'}</span></td>
  <td><span style="color:${((k.phones||[]).length>=(k.maxUses>0?k.maxUses:MAX_USES)&&(k.maxUses>0?k.maxUses:MAX_USES)>0)?'var(--orange)':'var(--muted)'}">${(k.phones||[]).length}/${k.maxUses===-1?'&#x221E;':(k.maxUses>0?k.maxUses:MAX_USES)}</span></td>
  <td style="color:var(--muted)">${escHtml(k.lastPhone||'—')}</td>
  <td style="color:var(--muted)" title="${uniqueIps} IPs únicos">${escHtml(k.lastIp||'—')}${uniqueIps>1?` <span style="color:#3a3a5a;font-size:11px">(+${uniqueIps-1})</span>`:''}</td>
  <td style="color:var(--muted)">${k.lastUsed?new Date(k.lastUsed).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'-'}</td>
  <td style="color:var(--muted)">${new Date(k.createdAt||Date.now()).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}${expHtml}</td>
  <td style="color:var(--muted)">${escHtml(k.wppVersion||'—')}</td>
  <td class="note-cell" data-code="${escHtml(code)}" data-note="${escHtml(k.note||'')}"><span class="note-preview">${k.note&&k.note.startsWith('[Mod:')?'<span style="color:#4f8ef7;font-size:12px">'+escHtml(k.note)+'</span>':escHtml(k.note||'')||'<span style="color:#2a2a4a">—</span>'}</span></td>
  <td class="td-actions">
    <button class="ab ${k.active?'ab-r':'ab-g'}" onclick="toggleKey('${escHtml(code)}')">${k.active?'Bloquear':'Liberar'}</button>
    <button class="ab ab-g" onclick="openRenew('${escHtml(code)}','${escHtml(k.label||'')}')">+Tempo</button>
    <button class="ab ab-g" onclick="openEditUses('${escHtml(code)}','${escHtml(k.label||'')}',${Number.isFinite(k.maxUses)?k.maxUses:MAX_USES})">Usos</button>
    <button class="ab ab-g" onclick="openRename('${escHtml(code)}','${escHtml(k.label||'')}')">Renomear</button>
    ${(k.phones||[]).length>0?`<button class="ab ab-r" onclick="openPhones('${escHtml(code)}','${escHtml(k.label||'')}')">Números</button>`:''}
    <button class="ab ab-r" onclick="deleteKey('${escHtml(code)}')">Excluir</button>
    ${isSuspect?`<button class="ab ab-y" onclick="clearSuspect('${escHtml(code)}')">🕵️</button>`:''}
    <button class="ab ab-p" data-code="${escHtml(code)}" data-label="${escHtml(k.label||'')}" data-modnote="${escHtml((k.note||'').match(/\[Mod: ([^\]]+)\]/)?.[1]||'')}" onclick="openAssignModFromEl(this)">👮 Mod</button>
  </td>
</tr>`;
  }).join('');
}


function buildLogsHtml(arr) {
  const src = arr ?? logs;
  if (!src.length) return `<tr><td colspan="7" class="empty">Nenhum log ainda</td></tr>`;
  const ac = a => a==='login_ok'?'st-on':a==='relogin_ok'?'st-re':a==='verify_ok'?'st-vr':a==='login_blocked'?'st-off':a==='warn_limit'?'st-wl':'st-warn';
  return src.slice(0,200).map(l => `
<tr>
  <td style="color:var(--muted);font-family:'Courier New',monospace;font-size:11px;white-space:nowrap">${new Date(l.timestamp).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</td>
  <td><span class="kc" style="font-size:12px">${escHtml(l.keyCode||'—')}</span></td>
  <td style="color:var(--muted)">${escHtml(l.label||'—')}</td>
  <td style="color:var(--muted)">${escHtml(l.phone||'—')}</td>
  <td style="color:var(--muted)">${escHtml(l.ip||'—')}</td>
  <td style="color:var(--muted)">${escHtml(l.wppVersion||'—')}</td>
  <td><span class="st-badge ${ac(l.action)}">${escHtml(l.action)}</span></td>
</tr>`).join('');
}


function renderAdminDashboard() {
  const expiringSoon = Object.values(keys).filter(k => k.active && isKeyExpiringSoon(k)).length;
  const suspectKeys  = Object.entries(keys).filter(([code, k]) => {
    const cl = k.suspectClearedAt ? new Date(k.suspectClearedAt) : null;
    if (cl && (Date.now()-cl.getTime()) < 172800000) return false;
    const rl = logs.filter(l => l.keyCode === code && l.timestamp > new Date(Date.now()-86400000).toISOString());
    return new Set(rl.filter(l=>l.ip).map(l=>l.ip)).size > 3;
  }).length;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM Admin</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='56%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='900' font-size='15' fill='%2300ff00'%3EZV%3C/text%3E%3C/svg%3E">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --green:#00ff00;--dark:#080810;--card:#0d0d18;--card2:#111120;
  --border:#1a1a2e;--border2:#222238;--text:#e2e2f0;--muted:#5a5a8a;
  --red:#ff4757;--yellow:#ffd32a;--orange:#ff8600;--blue:#4f8ef7;--purple:#9b59b6;
  --radius:9px;--radius-sm:5px;
}
html{scroll-behavior:smooth}
body{background:var(--dark);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;overflow-x:hidden;font-size:13px}

/* ── Ambient ── */
.amb{position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden}
.amb::before{content:'';position:absolute;width:600px;height:600px;background:radial-gradient(circle,#00ff0008 0%,transparent 70%);top:-150px;left:-150px;animation:da 24s ease-in-out infinite}
.amb::after{content:'';position:absolute;width:500px;height:500px;background:radial-gradient(circle,#4f8ef705 0%,transparent 70%);bottom:-100px;right:-100px;animation:db 30s ease-in-out infinite}
@keyframes da{0%,100%{transform:translate(0,0)}50%{transform:translate(55px,35px)}}
@keyframes db{0%,100%{transform:translate(0,0)}50%{transform:translate(-45px,-25px)}}
.gridlines{position:fixed;inset:0;background-image:linear-gradient(rgba(0,255,0,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,0,.018) 1px,transparent 1px);background-size:48px 48px;pointer-events:none;z-index:0}

/* ── Layout ── */
#app{position:relative;z-index:1;min-height:100vh;display:flex;flex-direction:column}
header{display:flex;align-items:center;justify-content:space-between;padding:0 24px;height:54px;background:rgba(13,13,24,.92);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100;gap:12px;flex-shrink:0}
.hlogo{display:flex;align-items:center;gap:9px}
.hmark{width:28px;height:28px;background:linear-gradient(135deg,#00ff00,#00cc00);border-radius:7px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;color:#080810;flex-shrink:0}
.hname{font-size:14px;font-weight:800;color:var(--green);letter-spacing:.3px}
.hver{font-size:11px;color:var(--muted);margin-left:4px;font-weight:400}
.hright{display:flex;align-items:center;gap:7px}
.hbtn{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:var(--radius-sm);border:1px solid var(--border2);background:transparent;color:var(--muted);font-size:12px;font-weight:600;cursor:pointer;transition:all .17s;text-decoration:none;font-family:inherit}
.hbtn:hover{border-color:#00ff0035;color:var(--green);background:#00ff0008}
.hbtn-out:hover{border-color:#ff475740;color:var(--red);background:#ff475708}
main{flex:1;padding:20px 24px;max-width:1920px;margin:0 auto;width:100%}

/* ── Stat cards ── */
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px}
.sc{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;position:relative;overflow:hidden;cursor:default;transition:border-color .2s,transform .14s}
.sc:hover{transform:translateY(-2px);border-color:var(--border2)}
.sc.sc-warn{border-color:#ff860035;background:linear-gradient(135deg,#ff860008,var(--card))}
.sc.sc-danger{border-color:#ff475735;background:linear-gradient(135deg,#ff475708,var(--card))}
.sc.sc-green{border-color:#00ff0030;background:linear-gradient(135deg,#00ff0008,var(--card))}
.sc-icon{position:absolute;right:14px;top:14px;font-size:18px;opacity:.15}
.sc-n{font-size:28px;font-weight:800;color:var(--green);line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-1px}
.sc.sc-warn .sc-n{color:var(--orange)}
.sc.sc-danger .sc-n{color:var(--red)}
.sc-l{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-top:5px}

/* ── Section ── */
.sec{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:16px;overflow:hidden}
.sh{display:flex;align-items:center;justify-content:space-between;padding:11px 15px;background:var(--card2);border-bottom:1px solid var(--border);gap:10px;flex-wrap:wrap}
.st{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--green);display:flex;align-items:center;gap:6px}

/* ── Gen form ── */
.gen-form{display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap}
.fi{display:flex;flex-direction:column;gap:3px}
.fi-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)}
.fi input[type=text],.fi input[type=number]{padding:6px 10px;background:var(--dark);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:12px;font-family:inherit;outline:none;transition:border-color .17s}
.fi input:focus{border-color:var(--green)}
.fi-name{min-width:130px;flex:1}
.fi-num input{width:54px;text-align:center}
.fi-sep{width:1px;height:28px;background:var(--border2);align-self:flex-end;flex-shrink:0;margin-bottom:2px}
.fi-chk{align-self:flex-end}
.fi-chk label{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);cursor:pointer;padding:7px 0}
.fi-chk input[type=checkbox]{accent-color:var(--green);width:13px;height:13px;cursor:pointer}
.btn-gen{padding:7px 14px;background:linear-gradient(135deg,#00ff00,#00cc00);border:none;border-radius:var(--radius-sm);color:#080810;font-size:12px;font-weight:800;cursor:pointer;transition:opacity .17s,transform .12s;white-space:nowrap;font-family:inherit}
.btn-gen:hover{opacity:.87;transform:translateY(-1px)}
.btn-gen:active{transform:none}

/* ── Search bar ── */
.sbar{display:flex;gap:7px;align-items:center;padding:9px 15px;background:var(--card2);border-bottom:1px solid var(--border);flex-wrap:wrap}
.sbar input[type=text]{flex:1;min-width:200px;padding:6px 12px;background:var(--dark);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:12px;outline:none;transition:border-color .17s;font-family:inherit}
.sbar input:focus{border-color:var(--green)}
.sbar select{padding:6px 8px;background:var(--dark);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--muted);font-size:12px;outline:none;cursor:pointer;font-family:inherit}

/* ── Generic buttons ── */
.btn{display:inline-flex;align-items:center;gap:5px;padding:7px 13px;border:none;border-radius:var(--radius-sm);cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;transition:all .17s;white-space:nowrap}
.btn:hover{opacity:.87;transform:translateY(-1px)}
.btn:active{transform:none}
.btn-g{background:#00ff0012;border:1px solid #00ff0030;color:var(--green)}
.btn-g:hover{background:#00ff001e;border-color:#00ff0050}
.btn-r{background:#ff475712;border:1px solid #ff475730;color:var(--red)}
.btn-r:hover{background:#ff47571e;border-color:#ff475750}
.btn-y{background:#ffd32a12;border:1px solid #ffd32a30;color:var(--yellow)}
.btn-y:hover{background:#ffd32a1e;border-color:#ffd32a50}
.btn-b{background:#4f8ef712;border:1px solid #4f8ef730;color:var(--blue)}
.btn-b:hover{background:#4f8ef71e;border-color:#4f8ef750}

/* ── Action buttons (table) ── */
.ab{padding:3px 8px;border-radius:4px;border:none;cursor:pointer;font-size:11px;font-weight:700;font-family:inherit;transition:all .14s;white-space:nowrap}
.ab:hover{opacity:1;transform:translateY(-1px)}
.ab-g{background:#00ff0012;color:var(--green);border:1px solid #00ff0028}
.ab-g:hover{background:#00ff001e;border-color:#00ff0045}
.ab-r{background:#ff475712;color:var(--red);border:1px solid #ff475728}
.ab-r:hover{background:#ff47571e;border-color:#ff475745}
.ab-y{background:#ffd32a12;color:var(--yellow);border:1px solid #ffd32a28}
.ab-p{background:#9b59b612;color:var(--purple);border:1px solid #9b59b628}
.ab-p:hover{background:#9b59b61e;border-color:#9b59b645}

/* ── Table ── */
.tov{overflow-x:auto}
table{width:100%;border-collapse:collapse}
thead th{padding:8px 11px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);border-bottom:1px solid var(--border);background:var(--card2);white-space:nowrap;cursor:pointer;user-select:none;transition:color .14s}
thead th:hover{color:var(--text)}
thead th.asc::after{content:' ▲';color:var(--green);font-size:9px}
thead th.desc::after{content:' ▼';color:var(--green);font-size:9px}
td{padding:7px 11px;border-bottom:1px solid #0e0e1c;vertical-align:middle;font-size:12px}
tr:last-child td{border-bottom:none}
tr:hover td{background:#00ff0003}
.kc{font-family:'Courier New',monospace;color:var(--green);font-size:12px;letter-spacing:.2px}
.td-name{font-weight:600;color:var(--text);max-width:150px;word-break:break-word}
.td-actions{display:flex;flex-wrap:wrap;gap:3px;min-width:280px;padding:5px 11px!important}
.empty{text-align:center;color:var(--muted);padding:40px!important;font-size:13px}
.note-cell{cursor:pointer;max-width:120px}
.note-cell:hover .note-preview{color:var(--green)}
.note-preview{color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;max-width:110px;transition:color .14s}

/* ── Status badges ── */
.st-badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.3px;text-transform:uppercase}
.st-on  {background:#00ff0015;color:var(--green);border:1px solid #00ff0030}
.st-off {background:#ff475715;color:var(--red);border:1px solid #ff475730}
.st-wait{background:#ffd32a15;color:var(--yellow);border:1px solid #ffd32a30}
.st-re  {background:#4f8ef715;color:var(--blue);border:1px solid #4f8ef730}
.st-vr  {background:#9b59b615;color:var(--purple);border:1px solid #9b59b630}
.st-wl  {background:#ff860015;color:var(--orange);border:1px solid #ff860030}
.st-warn{background:#1a1a2e;color:var(--muted);border:1px solid var(--border)}

/* ── Toast ── */
.toast{position:fixed;bottom:20px;right:20px;padding:11px 16px;border-radius:var(--radius);font-weight:700;font-size:12px;display:none;z-index:99999;max-width:380px;line-height:1.4;border:1px solid transparent}
.tok {background:#00ff0015;border-color:#00ff0030;color:var(--green)}
.terr{background:#ff475715;border-color:#ff475730;color:var(--red)}

/* ── Modals ── */
.modal-bg{display:none;position:fixed;inset:0;background:#00000088;z-index:99999;align-items:center;justify-content:center;backdrop-filter:blur(4px)}
.modal-bg.open{display:flex}
.modal{background:var(--card);border:1px solid var(--border2);border-radius:12px;padding:20px;width:340px;max-width:95vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px #00000099,0 0 0 1px #ffffff04}
.modal.modal-w{width:400px}
.modal h3{font-size:13px;font-weight:700;color:var(--green);margin-bottom:11px;display:flex;align-items:center;gap:6px}
.modal-row{margin-bottom:12px}
.modal-row label{display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:5px}
.modal-row input[type=text],.modal-row input[type=number],.modal-row textarea{width:100%;padding:8px 10px;background:var(--dark);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:13px;font-family:inherit;outline:none;transition:border-color .17s}
.modal-row input:focus,.modal-row textarea:focus{border-color:var(--green)}
.modal-row textarea{resize:vertical;min-height:76px}
.modal-hint{font-size:11px;color:var(--muted);margin-top:5px}
.mactions{display:flex;gap:7px;justify-content:flex-end;margin-top:13px}
.trow{display:flex;gap:8px}
.trow .modal-row{flex:1;text-align:center}
.trow input{text-align:center;font-size:16px!important}
.ph-item{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)}
.ph-item:last-child{border-bottom:none}
.ph-num{font-family:'Courier New',monospace;font-size:12px;color:var(--text)}
.mod-btn-row{display:flex;flex-direction:column;gap:7px;margin-bottom:12px}
.mod-btn{display:flex;align-items:center;gap:8px;padding:9px 13px;background:var(--dark);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;color:var(--text);font-size:12px;font-weight:600;font-family:inherit;transition:all .14s}
.mod-btn:hover{border-color:#00ff0030;color:var(--green)}
.mod-btn.active{background:#9b59b612;border-color:#9b59b630;color:#c4b5fd}
.log-filters{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.log-filters input[type=date],.log-filters input[type=text]{padding:6px 10px;background:var(--dark);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:12px;font-family:inherit;outline:none;transition:border-color .14s}
.log-filters input:focus{border-color:var(--green)}

@media(max-width:1400px){.stats{grid-template-columns:repeat(3,1fr)}}
@media(max-width:900px){.stats{grid-template-columns:1fr 1fr};main{padding:14px};.td-actions{min-width:auto}}
@media(max-width:580px){.stats{grid-template-columns:1fr};.gen-form{flex-direction:column}}
</style>
</head>
<body>
<div class="amb"></div>
<div class="gridlines"></div>
<div id="app">

<header>
  <div class="hlogo">
    <div class="hmark">ZV</div>
    <div class="hname">Painel Administrativo<span class="hver">v8</span></div>
  </div>
  <div class="hright">
    <button class="hbtn" onclick="exportCSV()">⬇ CSV</button>
    <a href="${R_ADMIN}/logout" class="hbtn hbtn-out">↩ Sair</a>
  </div>
</header>

<main>
  <div class="stats">
    <div class="sc sc-green"><div class="sc-icon">🔑</div><div class="sc-n" id="s-total">${Object.keys(keys).length}</div><div class="sc-l">Total de Chaves</div></div>
    <div class="sc"><div class="sc-icon">✅</div><div class="sc-n" id="s-active">${Object.values(keys).filter(k=>k.active).length}</div><div class="sc-l">Chaves Ativas</div></div>
    <div class="sc ${expiringSoon>0?'sc-warn':''}"><div class="sc-icon">⏰</div><div class="sc-n" id="s-warn">${expiringSoon}</div><div class="sc-l">Expirando em ${EXPIRY_WARN_HOURS}h</div></div>
    <div class="sc ${suspectKeys>0?'sc-danger':''}"><div class="sc-icon">🕵️</div><div class="sc-n" id="s-suspect">${suspectKeys}</div><div class="sc-l">Suspeitas (24h)</div></div>
    <div class="sc"><div class="sc-icon">📋</div><div class="sc-n" id="s-logs">${logs.length}</div><div class="sc-l">Acessos no Log</div></div>
  </div>

  <div class="sec">
    <div class="sh">
      <div class="st">🔑 Chaves de Acesso</div>
      <div class="gen-form">
        <div class="fi fi-name"><div class="fi-lbl">Cliente</div><input type="text" id="nlabel" placeholder="Nome do cliente"></div>
        <div class="fi-sep"></div>
        <div class="fi"><div class="fi-lbl">Dias</div><div class="fi-num"><input type="number" id="ndays" placeholder="0" min="0"></div></div>
        <div class="fi"><div class="fi-lbl">Horas</div><div class="fi-num"><input type="number" id="nhours" placeholder="0" min="0"></div></div>
        <div class="fi"><div class="fi-lbl">Min</div><div class="fi-num"><input type="number" id="nmins" placeholder="0" min="0"></div></div>
        <div class="fi-sep"></div>
        <div class="fi"><div class="fi-lbl">Usos</div><div class="fi-num"><input type="number" id="nuses" placeholder="3" min="-1" style="width:54px"></div></div>
        <div class="fi-chk"><label><input type="checkbox" id="ndeferred"> ⏱ 1º uso</label></div>
        <button class="btn-gen" onclick="generateKey()">+ Gerar Chave</button>
      </div>
    </div>
    <div class="sbar">
      <input type="text" id="search-input" placeholder="🔍 Buscar por nome, chave, telefone ou IP..." oninput="filterKeys()">
      <select id="filter-status" onchange="filterKeys()">
        <option value="">Todos os status</option>
        <option value="ativo">Ativas</option>
        <option value="bloqueado">Bloqueadas</option>
        <option value="suspeita">🕵️ Suspeitas</option>
      </select>
    </div>
    <div class="tov">
      <table>
        <thead><tr>
          <th onclick="sortKeys('code')">Chave</th>
          <th onclick="sortKeys('label')" id="th-label">Cliente</th>
          <th onclick="sortKeys('status')" id="th-status">Status</th>
          <th onclick="sortKeys('uses')" id="th-uses">Usos</th>
          <th onclick="sortKeys('phone')" id="th-phone">Telefone</th>
          <th>Último IP</th>
          <th onclick="sortKeys('lastused')" id="th-lastused">Último Acesso</th>
          <th onclick="sortKeys('created')" id="th-created">Criada em</th>
          <th>WPP Ver.</th>
          <th>Notas</th>
          <th>Ações</th>
        </tr></thead>
        <tbody id="kb">${buildKeysHtml()}</tbody>
      </table>
    </div>
  </div>

  <div class="sec">
    <div class="sh">
      <div class="st">📋 Log de Acessos <span style="font-size:10px;color:var(--muted);font-weight:400;text-transform:none;letter-spacing:0">LGPD · ${LOG_RETENTION_DAYS} dias</span></div>
      <div class="log-filters">
        <input type="date" id="logDate" onchange="filterLog()">
        <input type="text" id="logSearch" placeholder="Chave ou IP..." style="width:150px" oninput="filterLog()">
        <button class="btn btn-y" onclick="clearFilters()">✕</button>
        <button class="btn btn-y" onclick="doRefresh()">↻</button>
        <button class="btn btn-r" onclick="clearLog()">🗑 Limpar Log</button>
      </div>
    </div>
    <div class="tov">
      <table>
        <thead><tr><th>Horário</th><th>Chave</th><th>Cliente</th><th>Telefone</th><th>IP</th><th>WPP Ver.</th><th>Ação</th></tr></thead>
        <tbody id="lb">${buildLogsHtml()}</tbody>
      </table>
    </div>
  </div>
</main>
</div>

<!-- Modals -->
<div class="modal-bg" id="renewModal"><div class="modal">
  <h3>⏱ Adicionar Tempo — <span id="renewKeyLabel"></span></h3>
  <input type="hidden" id="renewKeyCode">
  <div class="trow">
    <div class="modal-row"><label>Dias</label><input type="number" id="renewDays" placeholder="0" min="0"></div>
    <div class="modal-row"><label>Horas</label><input type="number" id="renewHours" placeholder="0" min="0"></div>
    <div class="modal-row"><label>Min</label><input type="number" id="renewMins" placeholder="0" min="0"></div>
  </div>
  <div style="font-size:12px;color:var(--muted);margin-bottom:12px" id="renewCurrentExpiry"></div>
  <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);cursor:pointer;margin-bottom:12px;padding:9px 11px;background:#00ff0008;border:1px solid #00ff0020;border-radius:var(--radius-sm)">
    <input type="checkbox" id="renewDeferred" style="accent-color:var(--green);width:14px;height:14px;cursor:pointer">
    <span>⏱ <strong style="color:var(--green)">Ativar ao 1º uso</strong> — o prazo começa a contar somente no primeiro acesso</span>
  </label>
  <div class="mactions">
    <button class="btn btn-y" onclick="closeRenew()">Cancelar</button>
    <button class="btn btn-g" onclick="saveRenew()">Adicionar Tempo</button>
  </div>
</div></div>

<div class="modal-bg" id="editUsesModal"><div class="modal">
  <h3>👥 Limite de Dispositivos — <span id="editUsesLabel"></span></h3>
  <input type="hidden" id="editUsesCode">
  <div class="modal-row"><label>Máx. números simultâneos</label><input type="number" id="editUsesValue" min="-1" style="font-size:18px;text-align:center"><div class="modal-hint">Use <strong style="color:var(--green)">-1</strong> para ilimitado</div></div>
  <div class="mactions">
    <button class="btn btn-y" onclick="closeEditUses()">Cancelar</button>
    <button class="btn btn-g" onclick="saveEditUses()">Salvar</button>
  </div>
</div></div>

<div class="modal-bg" id="renameModal"><div class="modal">
  <h3>✏️ Renomear Chave</h3>
  <input type="hidden" id="renameCode">
  <div class="modal-row"><label>Novo nome</label><input type="text" id="renameValue" maxlength="60"></div>
  <div class="mactions">
    <button class="btn btn-y" onclick="closeRename()">Cancelar</button>
    <button class="btn btn-g" onclick="saveRename()">Salvar</button>
  </div>
</div></div>

<div class="modal-bg" id="phonesModal"><div class="modal">
  <h3>📱 Números — <span id="phonesLabel"></span></h3>
  <div id="phonesList" style="max-height:220px;overflow-y:auto;margin-bottom:12px;min-height:36px"></div>
  <div class="mactions">
    <button class="btn btn-y" onclick="closePhones()">Fechar</button>
    <button class="btn btn-r" id="removeAllBtn" onclick="removeAllPhones()">Remover Todos</button>
  </div>
</div></div>

<div class="modal-bg" id="noteModal"><div class="modal">
  <h3>📝 Nota — <span id="noteKeyLabel"></span></h3>
  <input type="hidden" id="noteKeyCode">
  <div class="modal-row"><label>Anotação</label><textarea id="noteText" placeholder="Pagou até março, trial, VIP..."></textarea></div>
  <div class="mactions">
    <button class="btn btn-y" onclick="closeNote()">Cancelar</button>
    <button class="btn btn-g" onclick="saveNote()">Salvar</button>
  </div>
</div></div>

<div class="modal-bg" id="assignModModal"><div class="modal modal-w">
  <h3>👮 Atribuir ao Moderador</h3>
  <p style="font-size:11px;color:var(--muted);margin-bottom:14px">Chave: <span id="assignModLabel" style="color:var(--text);font-weight:700"></span></p>
  <input type="hidden" id="assignModCode">
  <div class="mod-btn-row" id="modListBtns"></div>
  <div class="mactions">
    <button class="btn btn-r" onclick="assignMod(document.getElementById('assignModCode').value,'')">🗑 Remover</button>
    <button class="btn btn-y" onclick="closeAssignMod()">Cancelar</button>
  </div>
</div></div>

<div class="toast" id="toast"></div>

<script>
const _RA='${R_ADMIN}';
const _MODS=${JSON.stringify(MODS.map(m => m.name))};

function toast(msg,ok=true){
  const t=document.getElementById('toast');
  t.textContent=msg;t.className='toast '+(ok?'tok':'terr');
  t.style.display='block';
  setTimeout(()=>t.style.display='none',3200);
}

function openAssignModFromEl(el){
  openAssignMod(el.dataset.code||'', el.dataset.label||'', el.dataset.modnote||'');
}
function openAssignMod(code,label,currentMod){
  document.getElementById('assignModCode').value=code;
  document.getElementById('assignModLabel').textContent=label;
  const container=document.getElementById('modListBtns');
  container.innerHTML='';
  _MODS.forEach(name=>{
    const btn=document.createElement('button');
    const isActive=currentMod===name;
    btn.className='mod-btn'+(isActive?' active':'');
    btn.innerHTML=(isActive?'✅ ':'👤 ')+name+(isActive?' <span style="font-size:10px;margin-left:auto;opacity:.7">Atual</span>':'');
    btn.onclick=()=>assignMod(code,name);
    container.appendChild(btn);
  });
  if(_MODS.length===0){container.innerHTML='<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center">Nenhum moderador configurado.</div>';}
  document.getElementById('assignModModal').classList.add('open');
}
function closeAssignMod(){document.getElementById('assignModModal').classList.remove('open');}
document.getElementById('assignModModal').addEventListener('click',function(e){if(e.target===this)closeAssignMod();});
async function assignMod(code,modName){
  try{
    const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/assign-mod',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modName})});
    const d=await r.json();
    if(d.ok){
      toast(modName?'✅ Atribuída a: '+modName:'Atribuição removida');
      closeAssignMod();
      await doRefresh();
    }else toast('Erro: '+(d.error||'?'),false);
  }catch(e){toast('Erro de rede',false);}
}

function filterKeys(){
  const q=(document.getElementById('search-input').value||'').toLowerCase();
  const st=document.getElementById('filter-status').value;
  document.querySelectorAll('#kb tr[data-label]').forEach(row=>{
    const label=(row.dataset.label||'').toLowerCase();
    const phone=(row.dataset.phone||'').toLowerCase();
    const status=(row.dataset.status||'').toLowerCase();
    const suspect=(row.dataset.suspect||'');
    const code=(row.querySelector('.kc')||{}).textContent||'';
    const ip=(row.cells[5]||{}).textContent||'';
    const matchQ=!q||label.includes(q)||phone.includes(q)||code.toLowerCase().includes(q)||ip.toLowerCase().includes(q);
    const matchSt=!st||(st==='suspeita'?suspect==='1':status===st);
    row.style.display=(matchQ&&matchSt)?'':'none';
  });
}

let _sortCol=null,_sortDir=1;
function sortKeys(col){
  const tbody=document.getElementById('kb');
  const rows=Array.from(tbody.querySelectorAll('tr[data-label]'));
  if(!rows.length)return;
  if(_sortCol===col)_sortDir*=-1;else{_sortCol=col;_sortDir=1;}
  document.querySelectorAll('th').forEach(th=>th.classList.remove('asc','desc'));
  const th=document.getElementById('th-'+col);if(th)th.classList.add(_sortDir===1?'asc':'desc');
  rows.sort((a,b)=>{
    let va,vb;
    if(col==='uses'){va=parseInt(a.dataset.uses||0);vb=parseInt(b.dataset.uses||0);}
    else if(col==='created'||col==='lastused'){va=a.dataset[col==='lastused'?'lastused':'created']||'';vb=b.dataset[col==='lastused'?'lastused':'created']||'';}
    else if(col==='phone'){va=a.dataset.phone||'';vb=b.dataset.phone||'';}
    else{va=(a.dataset[col]||'').toLowerCase();vb=(b.dataset[col]||'').toLowerCase();}
    if(va<vb)return -1*_sortDir;if(va>vb)return 1*_sortDir;return 0;
  });
  rows.forEach(r=>tbody.appendChild(r));
}

async function generateKey(){
  const label=document.getElementById('nlabel').value.trim();
  const days=parseInt(document.getElementById('ndays').value||0);
  const hours=parseInt(document.getElementById('nhours').value||0);
  const mins=parseInt(document.getElementById('nmins').value||0);
  const _u=document.getElementById('nuses').value.trim();
  const maxUses=_u===''?3:parseInt(_u);
  if(!label){toast('Informe o nome do cliente',false);return;}
  if(isNaN(maxUses)){toast('❌ Usos inválido',false);return;}
  try{
    const body={label,maxUses};
    if(days>0)body.expireDays=days;if(hours>0)body.expireHours=hours;if(mins>0)body.expireMinutes=mins;
    const def=document.getElementById('ndeferred');if(def&&def.checked)body.deferred=true;
    const r=await fetch(_RA+'/api/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(r.status===401){toast('Sessão expirada',false);setTimeout(()=>location.href=_RA,1500);return;}
    const d=await r.json();
    if(d.ok){
      const exp=[];if(days>0)exp.push(days+'d');if(hours>0)exp.push(hours+'h');if(mins>0)exp.push(mins+'min');
      toast('✅ '+d.key+(exp.length?' · '+exp.join(' '):' · sem expiração')+' · '+(maxUses===-1?'∞ usos':maxUses+' uso(s)'));
      ['nlabel','ndays','nhours','nmins','nuses'].forEach(id=>document.getElementById(id).value='');
      if(document.getElementById('ndeferred'))document.getElementById('ndeferred').checked=false;
      await doRefresh();
    }else toast('❌ Erro: '+(d.error||'desconhecido'),false);
  }catch(e){toast('❌ Erro de rede',false);}
}

async function doRefresh(){
  try{
    const r=await fetch(_RA+'/api/data');
    if(r.status===401){return;}
    const d=await r.json();if(d.error)return;
    document.getElementById('s-total').textContent=d.totalKeys||0;
    document.getElementById('s-active').textContent=d.activeKeys||0;
    document.getElementById('s-logs').textContent=d.totalLogs||0;
    const sw=document.getElementById('s-warn');sw.textContent=d.warnKeys||0;sw.style.color=d.warnKeys>0?'var(--orange)':'var(--green)';const swsc=sw.closest('.sc');swsc.classList.toggle('sc-warn',d.warnKeys>0);
    const ssu=document.getElementById('s-suspect');if(ssu){ssu.textContent=d.suspectKeys||0;ssu.style.color=d.suspectKeys>0?'var(--red)':'';ssu.closest('.sc').classList.toggle('sc-danger',d.suspectKeys>0);}
    document.getElementById('kb').innerHTML=d.keysHtml||'';
    document.getElementById('lb').innerHTML=d.logsHtml||'';
    filterKeys();
  }catch(e){console.error('Refresh error',e);}
}
setInterval(doRefresh,120000); // 2 min — reduz requisições ao servidor

async function toggleKey(code){
  try{const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/toggle',{method:'POST'});if(r.status===401){toast('Sessão expirada',false);return;}const d=await r.json();if(d.ok){toast(d.active?'Chave liberada!':'Chave bloqueada!');await doRefresh();}}catch(e){toast('Erro',false);}
}
async function deleteKey(code){
  if(!confirm('Excluir chave '+code+'?'))return;
  try{const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code),{method:'DELETE'});if(r.status===401){toast('Sessão expirada',false);return;}const d=await r.json();if(d.ok){toast('Chave excluída');await doRefresh();}}catch(e){toast('Erro',false);}
}
async function clearSuspect(code){
  if(!confirm('Marcar chave '+code+' como verificada e remover alerta de suspeita?'))return;
  try{
    const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/clear-suspect',{method:'POST'});
    const d=await r.json();
    if(d.ok){toast('✅ Alerta removido — chave marcada como verificada');await doRefresh();}
    else toast('Erro: '+(d.error||'?'),false);
  }catch(e){toast('Erro de rede',false);}
}

async function filterLog(){
  const date=document.getElementById('logDate').value;
  const q=(document.getElementById('logSearch').value||'').toLowerCase();
  if(!date&&!q)return doRefresh();
  try{
    const params=new URLSearchParams();
    if(date)params.set('date',date);if(q)params.set('q',q);
    const r=await fetch(_RA+'/api/logs?'+params.toString());
    if(r.status===401){return;}
    const d=await r.json();if(d.ok)document.getElementById('lb').innerHTML=d.logsHtml||'';
  }catch(e){toast('Erro ao filtrar',false);}
}
function clearFilters(){document.getElementById('logDate').value='';document.getElementById('logSearch').value='';doRefresh();}
async function clearLog(){
  const date=document.getElementById('logDate').value;
  if(!confirm(date?'Limpar logs do dia '+date+'?':'Limpar TODO o log?'))return;
  try{const body=date?{date}:{};const r=await fetch(_RA+'/api/logs',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(d.ok){toast(date?'Log do dia limpo!':'Log completo apagado!');clearFilters();}}catch(e){toast('Erro ao limpar',false);}
}

function openRenew(code,label){document.getElementById('renewKeyCode').value=code;document.getElementById('renewKeyLabel').textContent=label;['renewDays','renewHours','renewMins'].forEach(id=>document.getElementById(id).value='');const dc=document.getElementById('renewDeferred');if(dc)dc.checked=false;document.getElementById('renewModal').classList.add('open');document.getElementById('renewDays').focus();}
function closeRenew(){document.getElementById('renewModal').classList.remove('open');}
document.getElementById('renewModal').addEventListener('click',function(e){if(e.target===this)closeRenew();});
async function saveRenew(){
  const code=document.getElementById('renewKeyCode').value;
  const days=parseInt(document.getElementById('renewDays').value)||0;
  const hours=parseInt(document.getElementById('renewHours').value)||0;
  const mins=parseInt(document.getElementById('renewMins').value)||0;
  if(!days&&!hours&&!mins){toast('Informe pelo menos um valor.',false);return;}
  const deferredEl=document.getElementById('renewDeferred');
  const deferred=deferredEl&&deferredEl.checked;
  const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/renew',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({days,hours,mins,deferred})});
  const d=await r.json();
  if(d.ok){
    if(d.deferred)toast('✅ Renovada! Ativará ao 1º uso ('+days+'d '+hours+'h '+mins+'min)');
    else toast('✅ Tempo adicionado! Expira: '+new Date(d.expiresAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}));
    closeRenew();await doRefresh();
  }else toast('Erro: '+(d.error||'?'),false);
}

function openEditUses(code,label,current){document.getElementById('editUsesCode').value=code;document.getElementById('editUsesLabel').textContent=label;document.getElementById('editUsesValue').value=current;document.getElementById('editUsesModal').classList.add('open');setTimeout(()=>{document.getElementById('editUsesValue').focus();document.getElementById('editUsesValue').select();},50);}
function closeEditUses(){document.getElementById('editUsesModal').classList.remove('open');}
document.getElementById('editUsesModal').addEventListener('click',function(e){if(e.target===this)closeEditUses();});
async function saveEditUses(){
  const code=document.getElementById('editUsesCode').value;
  const val=document.getElementById('editUsesValue').value.trim();
  const maxUses=val===''?3:parseInt(val);
  if(isNaN(maxUses)||maxUses<-1){toast('❌ Valor inválido.',false);return;}
  const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/max-uses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({maxUses})});
  const d=await r.json();if(d.ok){toast('✅ Limite: '+(maxUses===-1?'ilimitado':maxUses+' dispositivo(s)'));closeEditUses();await doRefresh();}else toast('Erro: '+(d.error||'?'),false);
}

function openRename(code,label){document.getElementById('renameCode').value=code;document.getElementById('renameValue').value=label;document.getElementById('renameModal').classList.add('open');setTimeout(()=>{const v=document.getElementById('renameValue');v.focus();v.select();},50);}
function closeRename(){document.getElementById('renameModal').classList.remove('open');}
document.getElementById('renameModal').addEventListener('click',function(e){if(e.target===this)closeRename();});
document.getElementById('renameValue').addEventListener('keydown',function(e){if(e.key==='Enter')saveRename();});
async function saveRename(){
  const code=document.getElementById('renameCode').value;
  const label=document.getElementById('renameValue').value.trim();
  if(!label){toast('Nome não pode ser vazio.',false);return;}
  const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/label',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label})});
  const d=await r.json();if(d.ok){toast('Renomeado: '+label);closeRename();await doRefresh();}else toast('Erro: '+(d.error||'?'),false);
}

function openPhones(code,label){
  const modal=document.getElementById('phonesModal');modal.dataset.code=code;
  document.getElementById('phonesLabel').textContent=label;
  const list=document.getElementById('phonesList');list.innerHTML='Carregando...';modal.classList.add('open');
  fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/phones').then(r=>r.json()).then(d=>{
    if(!d.phones||d.phones.length===0){list.innerHTML='<em style="color:var(--muted);font-size:12px">Nenhum número cadastrado</em>';document.getElementById('removeAllBtn').style.display='none';modal.dataset.phones='[]';return;}
    document.getElementById('removeAllBtn').style.display='';modal.dataset.phones=JSON.stringify(d.phones);
    list.innerHTML=d.phones.map((ph,i)=>'<div class="ph-item"><span class="ph-num">'+ph.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]))+'</span><button class="ab ab-r" data-idx="'+i+'" onclick="removePhone(this)">Remover</button></div>').join('');
  }).catch(()=>{list.innerHTML='<em style="color:var(--red)">Erro ao carregar</em>';});
}
function closePhones(){document.getElementById('phonesModal').classList.remove('open');}
document.getElementById('phonesModal').addEventListener('click',function(e){if(e.target===this)closePhones();});
async function removePhone(btn){
  const modal=document.getElementById('phonesModal'),code=modal.dataset.code,phones=JSON.parse(modal.dataset.phones||'[]'),phone=phones[parseInt(btn.dataset.idx)];
  if(!phone){toast('Erro: número não encontrado.',false);return;}
  const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/phones',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone})});
  const d=await r.json();if(d.ok){toast('Número removido: '+phone);closePhones();await doRefresh();}else toast('Erro: '+(d.error||'?'),false);
}
async function removeAllPhones(){
  const code=document.getElementById('phonesModal').dataset.code;
  if(!confirm('Remover TODOS os números desta chave?'))return;
  const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/phones',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({all:true})});
  const d=await r.json();if(d.ok){toast('Todos removidos.');closePhones();await doRefresh();}else toast('Erro: '+(d.error||'?'),false);
}

function openNote(code,currentNote){document.getElementById('noteKeyCode').value=code;document.getElementById('noteKeyLabel').textContent=code;document.getElementById('noteText').value=currentNote||'';document.getElementById('noteModal').classList.add('open');setTimeout(()=>document.getElementById('noteText').focus(),100);}
function closeNote(){document.getElementById('noteModal').classList.remove('open');}
document.getElementById('noteModal').addEventListener('click',function(e){if(e.target===this)closeNote();});
document.getElementById('kb').addEventListener('click',function(e){const td=e.target.closest('.note-cell');if(!td)return;openNote(td.dataset.code||'',td.dataset.note||'');});
async function saveNote(){
  const code=document.getElementById('noteKeyCode').value,note=document.getElementById('noteText').value.trim();
  const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/note',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note})});
  const d=await r.json();if(d.ok){toast('Nota salva!');closeNote();await doRefresh();}else toast('Erro ao salvar nota',false);
}

async function exportCSV(){
  try{const r=await fetch(_RA+'/api/export/csv');if(r.status===401){toast('Sessão expirada',false);return;}const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='zvm-chaves-'+new Date().toISOString().slice(0,10)+'.csv';a.click();URL.revokeObjectURL(url);toast('CSV exportado!');}catch(e){toast('Erro ao exportar',false);}
}

</script>
${CANVAS_BG}</body></html>`;
}


function renderPlanosPage() {
  const PLANOS = [
    { devices:1,  label:'Solo',        price:'24,99', oldPrice:null,    desc:'Para uso pessoal',    icon:'👤', perDevice:'24,99', link:'#', highlight:false },
    { devices:3,  label:'Padrão',      price:'29,99', oldPrice:'44,99', desc:'O mais escolhido',    icon:'⚡', perDevice:'10,00', link:'#', highlight:true  },
    { devices:5,  label:'Pro',         price:'39,99', oldPrice:'79,99', desc:'Para equipes',        icon:'🚀', perDevice:'8,00',  link:'#', highlight:false },
    { devices:10, label:'Empresarial', price:'59,99', oldPrice:'149,99',desc:'Escala total',        icon:'🏢', perDevice:'6,00',  link:'#', highlight:false },
  ];

  const cards = PLANOS.map(p => {
    const comingSoon = p.link === '#';
    return `<div class="plan-card${p.highlight?' hl':''}">
  ${p.highlight?'<div class="pop-badge">⚡ Mais popular</div>':''}
  <div class="plan-top">
    <div class="plan-icon">${p.icon}</div>
    <div class="plan-name">${p.label}</div>
    <div class="plan-sub">${p.devices} número${p.devices>1?'s':''} de WhatsApp</div>
  </div>
  <div class="plan-pricing">
    ${p.oldPrice?`<div class="old-price">R$ ${p.oldPrice}</div>`:''}
    <div class="plan-price"><span class="cur">R$</span><span class="val">${p.price}</span><span class="per">/mês</span></div>
    <div class="per-device">R$ ${p.perDevice} por número</div>
  </div>
  <div class="plan-divider"></div>
  <ul class="plan-features">
    <li>✅ Até ${p.devices} número(s) de WhatsApp</li>
    <li>✅ 30 dias de acesso</li>
    <li>✅ Todos os recursos inclusos</li>
    <li>✅ Renovação automática pelo portal</li>
  </ul>
  <a href="${p.link}" class="plan-btn${p.highlight?' btn-hl':''}" ${comingSoon?'onclick="return false;"':'target="_blank"'}>
    ${comingSoon?'🔒 Em breve':'💳 Assinar agora'}
  </a>
</div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Planos e Preços</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3ELR%3C/text%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--green:#00ff87;--dark:#080810;--card:#0f0f1a;--card2:#13131f;--border:#1c1c2e;--text:#e2e2f0;--muted:#5a5a7a;--radius:14px}
body{background:var(--dark);color:var(--text);font-family:'Space Mono',monospace;min-height:100vh;overflow-x:hidden}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 28px;border-bottom:1px solid var(--border);background:var(--card);position:sticky;top:0;z-index:50;box-shadow:0 2px 20px #00000060}
.logo{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:var(--green);text-decoration:none;display:flex;align-items:center;gap:8px;letter-spacing:-0.5px}
.hlinks{display:flex;gap:10px}
.hlinks a{font-size:13px;color:var(--muted);text-decoration:none;padding:6px 14px;border:1px solid var(--border);border-radius:6px;transition:all .2s;font-family:'Syne',sans-serif;font-weight:700}
.hlinks a:hover{color:var(--green);border-color:var(--green)}
main{max-width:1060px;margin:0 auto;padding:56px 24px 80px}

/* Hero */
.hero{text-align:center;margin-bottom:48px}
.hero-badge{display:inline-flex;align-items:center;gap:6px;background:#00ff8712;border:1px solid #00ff8730;color:var(--green);font-size:12px;letter-spacing:2px;text-transform:uppercase;padding:5px 16px;border-radius:20px;margin-bottom:20px;font-family:'Syne',sans-serif}
.hero h1{font-family:'Syne',sans-serif;font-size:clamp(28px,4vw,46px);font-weight:800;line-height:1.1;margin-bottom:14px}
.hero h1 em{color:var(--green);font-style:normal}
.hero-sub{color:#8a8aaa;font-size:13px;line-height:1.8;max-width:460px;margin:0 auto 28px;font-family:'Syne',sans-serif;letter-spacing:0}
.guarantee{display:inline-flex;align-items:center;gap:20px;background:var(--card);border:1px solid var(--border);border-radius:30px;padding:10px 24px;font-size:14px;color:#8a8aaa;font-family:'Syne',sans-serif;letter-spacing:0}
.guarantee span{display:flex;align-items:center;gap:6px}

/* WIP banner */
.wip-banner{background:#ffd32a08;border:1px solid #ffd32a25;border-radius:10px;padding:13px 20px;margin-bottom:36px;display:flex;align-items:center;gap:12px;font-size:13px;color:#c9a800;line-height:1.7;font-family:'Syne',sans-serif}

/* Plans */
.plans{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:48px;justify-items:center}
.plan-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:28px 20px 22px;text-align:center;position:relative;transition:border-color .25s,transform .2s,box-shadow .2s;display:flex;flex-direction:column;width:100%}
.plan-card:hover{border-color:#00ff8740;transform:translateY(-4px);box-shadow:0 16px 40px #00000050}
.plan-card.hl{border-color:#00ff8760;background:linear-gradient(165deg,#0d1a12,#0f0f1a);box-shadow:0 0 30px #00ff8715}
.plan-card.hl:hover{box-shadow:0 16px 50px #00ff8725}
.pop-badge{position:absolute;top:-13px;left:50%;transform:translateX(-50%);background:var(--green);color:#000;font-family:'Syne',sans-serif;font-weight:800;font-size:14px;padding:5px 18px;border-radius:20px;white-space:nowrap;letter-spacing:.3px}
.plan-top{margin-bottom:20px}
.plan-icon{font-size:36px;margin-bottom:10px}
.plan-name{font-family:'Syne',sans-serif;font-size:17px;font-weight:800;color:var(--text);margin-bottom:4px}
.plan-sub{font-size:13px;color:#8a8aaa;font-family:'Syne',sans-serif;letter-spacing:0}
.plan-pricing{margin-bottom:18px}
.old-price{font-size:13px;color:var(--muted);text-decoration:line-through;margin-bottom:4px}
.plan-price{display:flex;align-items:baseline;justify-content:center;gap:3px;margin-bottom:4px}
.cur{font-size:14px;color:var(--green);font-weight:700}
.val{font-family:'Syne',sans-serif;font-size:34px;font-weight:800;color:var(--green);line-height:1}
.per{font-size:14px;color:var(--muted);font-family:'Syne',sans-serif}
.per-device{font-size:13px;color:#a0a0c0;font-family:'Syne',sans-serif;font-weight:600;margin-top:2px}
.plan-divider{height:1px;background:var(--border);margin:16px 0}
.plan-features{list-style:none;text-align:left;font-size:13px;color:#a0a0c0;line-height:1.5;display:flex;flex-direction:column;gap:10px;margin-bottom:20px;flex:1;font-family:'Syne',sans-serif;letter-spacing:0}
.plan-features li{display:flex;align-items:center;gap:6px}
.plan-btn{display:block;padding:12px;border-radius:8px;font-family:'Syne',sans-serif;font-weight:700;font-size:12px;text-decoration:none;text-align:center;transition:all .2s;background:#1c1c2e;color:var(--muted);border:1px solid var(--border);cursor:not-allowed;opacity:.65;margin-top:auto}
.plan-btn.btn-hl{background:var(--green);color:#000;border:none;cursor:not-allowed;opacity:.7}

/* Compare */
.compare{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:32px}
.compare-title{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.5px;padding:16px 22px;border-bottom:1px solid var(--border);background:var(--card2)}
.compare table{width:100%;border-collapse:collapse;font-size:13px;font-family:'Syne',sans-serif}
.compare th{padding:11px 16px;text-align:center;color:#a0a0c0;border-bottom:1px solid var(--border);font-weight:600;font-size:13px;background:var(--card2);font-family:'Syne',sans-serif}
.compare th:first-child{text-align:left}
.compare td{padding:11px 16px;text-align:center;border-bottom:1px solid #14141f;color:var(--text)}
.compare td:first-child{text-align:left;color:#a0a0c0;font-size:13px;font-family:'Syne',sans-serif;letter-spacing:0}
.compare tr:last-child td{border-bottom:none}
.compare tr:hover td{background:#ffffff02}
.ck{color:var(--green)}
.cx{color:#ff475760}

/* Incluso */
.includes{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:22px 26px;margin-bottom:32px}
.inc-title{font-family:'Syne',sans-serif;font-size:14px;font-weight:800;color:var(--green);text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px}
.inc-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.inc-item{display:flex;align-items:center;gap:12px;font-size:14px;color:#c4c4d8;line-height:1.5;font-family:'Syne',sans-serif;letter-spacing:0;font-weight:500}
.inc-item .ic{flex-shrink:0;font-size:20px}

/* FAQ */
.faq{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:26px 28px;margin-bottom:32px}
.faq-title{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.5px;margin-bottom:18px}
.faq-item{border-bottom:1px solid var(--border);padding:13px 0}
.faq-item:last-child{border-bottom:none;padding-bottom:0}
.faq-q{font-size:15px;color:#e2e2f0;font-weight:700;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;user-select:none;font-family:'Syne',sans-serif;letter-spacing:-0.2px}
.faq-q .arr{color:var(--muted);transition:transform .2s;flex-shrink:0}
.faq-a{font-size:14px;color:#a0a0c0;line-height:1.9;padding-top:10px;display:none;font-family:'Syne',sans-serif;letter-spacing:0;font-weight:400}
.faq-item.open .faq-a{display:block}
.faq-item.open .arr{transform:rotate(90deg)}

/* CTA */
.cta{background:linear-gradient(135deg,#0a1a10,#0f0f1a);border:1px solid #00ff8740;border-radius:var(--radius);padding:36px 28px;text-align:center}
.cta h3{font-family:'Syne',sans-serif;font-size:18px;font-weight:800;color:var(--text);margin-bottom:8px}
.cta p{color:#8a8aaa;font-size:13px;margin-bottom:22px;line-height:1.8;font-family:'Syne',sans-serif;letter-spacing:0}
.btn-wpp{display:inline-flex;align-items:center;gap:8px;background:#25d36620;border:1px solid #25d36640;color:#25d366;font-family:'Syne',sans-serif;font-weight:700;font-size:12px;padding:12px 24px;border-radius:8px;text-decoration:none;transition:all .2s}
.btn-wpp:hover{background:#25d36630;border-color:#25d366;transform:translateY(-2px)}
footer{text-align:center;padding:28px;font-size:13px;color:#8a8aaa;border-top:1px solid var(--border);font-family:'Syne',sans-serif}
footer a{color:#8a8aaa;text-decoration:none}footer a:hover{color:var(--green)}
@media(max-width:800px){.plans{grid-template-columns:1fr 1fr}.inc-grid{grid-template-columns:1fr}}
@media(max-width:480px){.plans{grid-template-columns:1fr}.guarantee{flex-direction:column;gap:10px}}
</style></head><body>
<header>
  <a href="/" class="logo">⚡ ZVM</a>
  <div class="hlinks">
    <a href="/">Portal</a>
    <a href="/faq">FAQ</a>
    <a href="https://wa.me/5521996771552?text=LR!%20Preciso%20de%20ajuda." target="_blank">💬 Suporte</a>
  </div>
</header>
<main>

  <div class="hero">
    <div class="hero-badge">💳 Planos e Preços</div>
    <h1>Simples, <em>transparente</em><br>e sem surpresas</h1>
    <p class="hero-sub">Escolha o plano ideal para o seu uso. Todos incluem acesso completo à extensão ZVM por 30 dias.</p>
    <div class="guarantee">
      <span>✅ Sem fidelidade</span>
      <span>⚡ Ativação imediata</span>
      <span>💬 Suporte incluso</span>
    </div>
  </div>

  <div class="wip-banner">
    <span style="font-size:18px;flex-shrink:0">🚧</span>
    <span><strong>Links de pagamento em breve!</strong> Os planos já estão configurados — assim que os links da Payt forem adicionados você poderá assinar direto por aqui.</span>
  </div>

  <div class="plans">${cards}</div>

  <div class="compare">
    <div class="compare-title">📊 Comparativo dos planos</div>
    <table>
      <thead><tr>
        <th style="text-align:left">Recurso</th>
        <th>Solo</th><th>Padrão</th><th>Pro</th><th>Empresarial</th>
      </tr></thead>
      <tbody>
        <tr><td>Números de WhatsApp</td><td>1</td><td>3</td><td>5</td><td>10</td></tr>
        <tr><td>Preço mensal</td><td>R$ 24,99</td><td>R$ 29,99</td><td>R$ 39,99</td><td>R$ 59,99</td></tr>
        <tr><td>Preço por número</td><td>R$ 24,99</td><td style="color:var(--green)">R$ 10,00</td><td style="color:var(--green)">R$ 8,00</td><td style="color:var(--green)">R$ 6,00</td></tr>
        <tr><td>Todos os recursos</td><td class="ck">✓</td><td class="ck">✓</td><td class="ck">✓</td><td class="ck">✓</td></tr>
        <tr><td>Portal do cliente</td><td class="ck">✓</td><td class="ck">✓</td><td class="ck">✓</td><td class="ck">✓</td></tr>
        <tr><td>Suporte WhatsApp</td><td class="ck">✓</td><td class="ck">✓</td><td class="ck">✓</td><td class="ck">✓</td></tr>
        <tr><td>Renovação automática</td><td class="ck">✓</td><td class="ck">✓</td><td class="ck">✓</td><td class="ck">✓</td></tr>
      </tbody>
    </table>
  </div>

  <div class="includes">
    <div class="inc-title">✅ Incluso em todos os planos</div>
    <div class="inc-grid">
      <div class="inc-item"><span class="ic">⚡</span><span>Acesso completo à extensão ZVM para WhatsApp Web</span></div>
      <div class="inc-item"><span class="ic">🔄</span><span>Atualizações automáticas durante a vigência</span></div>
      <div class="inc-item"><span class="ic">📱</span><span>Portal do cliente para gerenciar sua chave</span></div>
      <div class="inc-item"><span class="ic">⏰</span><span>30 dias a partir da primeira ativação</span></div>
      <div class="inc-item"><span class="ic">💬</span><span>Suporte via WhatsApp com a equipe</span></div>
      <div class="inc-item"><span class="ic">🎯</span><span>Fluxos, funis, agendamentos e disparos</span></div>
      <div class="inc-item"><span class="ic">🔁</span><span>Renovação soma ao tempo restante</span></div>
      <div class="inc-item"><span class="ic">🔒</span><span>Chave exclusiva e intransferível</span></div>
    </div>
  </div>

  <div class="faq">
    <div class="faq-title">💬 Dúvidas frequentes</div>
    <div class="faq-item">
      <div class="faq-q">O que é um "número de WhatsApp" no plano? <span class="arr">▶</span></div>
      <div class="faq-a">Cada número corresponde a um WhatsApp diferente que pode usar a extensão simultaneamente. No plano Padrão (3 números), por exemplo, três números distintos podem usar ao mesmo tempo. Você gerencia quais números estão ativos pelo portal do cliente.</div>
    </div>
    <div class="faq-item">
      <div class="faq-q">Quando minha chave é ativada após o pagamento? <span class="arr">▶</span></div>
      <div class="faq-a">Imediatamente após a confirmação do pagamento pela Payt. Para PIX é instantâneo. A chave já estará disponível no portal do cliente antes mesmo de você fechar a janela de confirmação.</div>
    </div>
    <div class="faq-item">
      <div class="faq-q">Se eu já tenho uma chave e compro de novo, o que acontece? <span class="arr">▶</span></div>
      <div class="faq-a">Sua chave existente é renovada automaticamente — os 30 dias são somados ao tempo que ainda resta. Você não perde nenhum dia e não precisa de uma chave nova.</div>
    </div>
    <div class="faq-item">
      <div class="faq-q">Posso mudar de plano (upgrade ou downgrade)? <span class="arr">▶</span></div>
      <div class="faq-a">Sim. Entre em contato com o suporte via WhatsApp e ajustamos o seu plano sem complicações.</div>
    </div>
    <div class="faq-item">
      <div class="faq-q">O que acontece quando minha chave expira? <span class="arr">▶</span></div>
      <div class="faq-a">A extensão para de funcionar até que você renove. Seu histórico e configurações são mantidos — basta renovar e tudo volta exatamente como estava.</div>
    </div>
  </div>

  <div class="cta">
    <h3>Ainda tem dúvidas?</h3>
    <p>Nossa equipe está disponível para te ajudar a escolher o melhor plano<br>ou esclarecer qualquer questão antes de assinar.</p>
    <a class="btn-wpp" href="https://wa.me/5521996771552?text=LR!%20Quero%20saber%20mais%20sobre%20os%20planos%20do%20ZVM." target="_blank">💬 Falar com o Suporte no WhatsApp</a>
  </div>

</main>
<footer>
  <p>© ${new Date().getFullYear()} ZVM — <a href="/">Portal</a> · <a href="/faq">FAQ</a> · <a href="/privacidade">Privacidade</a></p>
  <p style="margin-top:6px;font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.5">Todos os direitos reservados</p>
</footer>
<script>
document.querySelectorAll('.faq-item').forEach(item=>{
  item.querySelector('.faq-q').addEventListener('click',()=>item.classList.toggle('open'));
});
</script>
${CANVAS_BG}
</body></html>`;
}

function renderFaqPage() {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — FAQ</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3ELR%3C/text%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--green:#00ff87;--dark:#080810;--card:#0f0f1a;--border:#1c1c2e;--text:#e2e2f0;--muted:#5a5a7a;--radius:14px}
body{background:var(--dark);color:var(--text);font-family:'Space Mono',monospace;min-height:100vh;overflow-x:hidden}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 28px;border-bottom:1px solid var(--border);background:var(--card);position:sticky;top:0;z-index:50;box-shadow:0 2px 20px #00000060}
.logo{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:var(--green);text-decoration:none;display:flex;align-items:center;gap:8px;letter-spacing:-0.5px}
.header-links{display:flex;gap:10px}
.header-links a{font-size:13px;color:var(--muted);text-decoration:none;padding:6px 14px;border:1px solid var(--border);border-radius:6px;transition:all .2s;font-family:'Syne',sans-serif;font-weight:700}
.header-links a:hover{color:var(--green);border-color:var(--green)}
main{max-width:920px;margin:0 auto;padding:60px 32px 80px}
.hero{text-align:center;margin-bottom:64px}
.hero-badge{display:inline-block;background:#00ff8712;border:1px solid #00ff8730;color:var(--green);font-size:12px;letter-spacing:2px;text-transform:uppercase;padding:5px 14px;border-radius:20px;margin-bottom:22px;font-family:'Syne',sans-serif}
.hero h1{font-family:'Syne',sans-serif;font-size:clamp(28px,5vw,48px);font-weight:800;line-height:1.1;margin-bottom:18px}
.hero h1 span{color:var(--green)}
.hero-sub{color:#a0a0c0;font-size:16px;line-height:1.8;max-width:600px;margin:0 auto 36px;font-family:'Syne',sans-serif}
.wip-card{background:linear-gradient(135deg,#0f0f1a,#13101f);border:1px solid #7c3aed40;border-radius:var(--radius);padding:40px 36px;text-align:center;margin-bottom:56px;position:relative;overflow:hidden}
.wip-card::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 0%,#7c3aed18,transparent 70%);pointer-events:none}
.wip-icon{font-size:52px;margin-bottom:18px;display:block;animation:float 3s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.wip-title{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:var(--text);margin-bottom:12px}
.wip-title span{color:var(--green)}
.wip-desc{color:#a0a0c0;font-size:15px;line-height:1.9;max-width:560px;margin:0 auto 28px;font-family:'Syne',sans-serif}
.progress-wrap{background:#1e1e2e;border-radius:8px;height:6px;overflow:hidden;max-width:320px;margin:0 auto 10px}
.progress-bar{height:6px;background:linear-gradient(90deg,#7c3aed,var(--green));border-radius:8px;animation:progress 2.5s ease-in-out infinite alternate}
@keyframes progress{from{width:30%}to{width:45%}}
.progress-label{font-size:12px;color:var(--muted);letter-spacing:1px;text-transform:uppercase}
.coming-title{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:var(--muted);letter-spacing:2px;text-transform:uppercase;text-align:center;margin-bottom:20px}
.coming-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:52px}
.coming-item{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px 22px;display:flex;align-items:flex-start;gap:14px;transition:border-color .2s}
.coming-item:hover{border-color:#7c3aed40}
.coming-item .ic{font-size:20px;flex-shrink:0;margin-top:1px}
.coming-item h3{font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px}
.coming-item p{font-size:14px;color:#a0a0c0;line-height:1.6;font-family:'Syne',sans-serif}
.support-section{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:32px;text-align:center}
.support-section h2{font-family:'Syne',sans-serif;font-size:16px;font-weight:800;color:var(--text);margin-bottom:8px}
.support-section p{color:#a0a0c0;font-size:15px;line-height:1.8;margin-bottom:24px;font-family:'Syne',sans-serif}
.support-btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.btn-wpp{display:inline-flex;align-items:center;gap:8px;background:#25d36620;border:1px solid #25d36640;color:#25d366;font-family:'Syne',sans-serif;font-weight:700;font-size:12px;padding:11px 22px;border-radius:8px;text-decoration:none;transition:all .2s}
.btn-wpp:hover{background:#25d36630;border-color:#25d366;transform:translateY(-2px)}
.btn-portal{display:inline-flex;align-items:center;gap:8px;background:#00ff8712;border:1px solid #00ff8730;color:var(--green);font-family:'Syne',sans-serif;font-weight:700;font-size:12px;padding:11px 22px;border-radius:8px;text-decoration:none;transition:all .2s}
.btn-portal:hover{background:#00ff8722;border-color:var(--green);transform:translateY(-2px)}
footer{text-align:center;padding:28px;font-size:13px;color:#8a8aaa;border-top:1px solid var(--border);font-family:'Syne',sans-serif}
footer a{color:#8a8aaa;text-decoration:none}footer a:hover{color:var(--green)}
@media(max-width:520px){.coming-grid{grid-template-columns:1fr}.wip-card{padding:28px 20px}.header-links a{padding:5px 9px;font-size:12px}main{padding:40px 16px 60px}}
</style>
</head>
<body>
<header>
  <a href="/" class="logo">⚡ ZVM</a>
  <div class="header-links">
    <a href="/">Portal</a>
    <a href="/privacidade">Privacidade</a>
    <a href="https://wa.me/5521996771552?text=LR!%20Preciso%20de%20ajuda%20com%20o%20ZVM%20LR1290." target="_blank">💬 Suporte</a>
  </div>
</header>
<main>
  <div class="hero">
    <div class="hero-badge">Central de Ajuda</div>
    <h1>Perguntas <span>Frequentes</span></h1>
    <p class="hero-sub">Estamos construindo uma base de conhecimento completa para você. Em breve tudo estará aqui.</p>
  </div>
  <div class="wip-card">
    <span class="wip-icon">🚧</span>
    <div class="wip-title">Estamos <span>trabalhando nisso!</span></div>
    <p class="wip-desc">Nossa central de FAQ está sendo desenvolvida com muito cuidado. Em breve você encontrará aqui respostas para todas as suas dúvidas sobre ativação, dispositivos, renovação, pagamentos e muito mais.</p>
    <div class="progress-wrap"><div class="progress-bar"></div></div>
    <p class="progress-label">Em desenvolvimento</p>
  </div>
  <p class="coming-title">O que vem por aí</p>
  <div class="coming-grid">
    <div class="coming-item"><span class="ic">🔑</span><div><h3>Ativação da Chave</h3><p>Como inserir e ativar sua chave no WhatsApp Web.</p></div></div>
    <div class="coming-item"><span class="ic">📱</span><div><h3>Gerenciar Dispositivos</h3><p>Como adicionar, remover e trocar números vinculados.</p></div></div>
    <div class="coming-item"><span class="ic">⏱</span><div><h3>Renovação e Validade</h3><p>Entenda como funciona a expiração e como renovar.</p></div></div>
    <div class="coming-item"><span class="ic">💳</span><div><h3>Pagamentos</h3><p>Dúvidas sobre cobrança, planos e confirmação de compra.</p></div></div>
    <div class="coming-item"><span class="ic">⚡</span><div><h3>Recursos da Extensão</h3><p>Como usar fluxos, funis, agendamentos e disparos.</p></div></div>
    <div class="coming-item"><span class="ic">🔒</span><div><h3>Privacidade e LGPD</h3><p>Quais dados coletamos e como protegemos suas informações.</p></div></div>
  </div>
  <div class="support-section">
    <h2>Ainda tem dúvidas?</h2>
    <p>Enquanto o FAQ não está pronto, nossa equipe está disponível no WhatsApp para te ajudar com qualquer dúvida.</p>
    <div class="support-btns">
      <a class="btn-wpp" href="https://wa.me/5521996771552?text=LR!%20Preciso%20de%20ajuda%20com%20o%20ZVM%20LR1290." target="_blank">💬 Falar com o Suporte</a>
      <a class="btn-portal" href="/">🔑 Portal do Cliente</a>
    </div>
  </div>
  </div>
</main>
<footer>
  <p>© ${new Date().getFullYear()} ZVM — <a href="/">Portal</a> · <a href="/faq">FAQ</a> · <a href="/privacidade">Privacidade</a></p>
  <p style="margin-top:6px;font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.5">Todos os direitos reservados</p>
</footer>
${CANVAS_BG}
</body></html>`;
}

function renderPrivacyPage() {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Política de Privacidade</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3ELR%3C/text%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--green:#00ff87;--dark:#080810;--card:#0f0f1a;--border:#1c1c2e;--text:#e2e2f0;--muted:#5a5a7a;--radius:12px}
body{background:var(--dark);color:var(--text);font-family:'Space Mono',monospace;min-height:100vh}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 28px;border-bottom:1px solid var(--border);background:var(--card);position:sticky;top:0;z-index:50;box-shadow:0 2px 20px #00000060}
.logo{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:var(--green);text-decoration:none;display:flex;align-items:center;gap:8px;letter-spacing:-0.5px}
.header-links{display:flex;gap:10px}
.header-links a{font-size:13px;color:var(--muted);text-decoration:none;padding:6px 14px;border:1px solid var(--border);border-radius:6px;transition:all .2s;font-family:'Syne',sans-serif;font-weight:700}
.header-links a:hover{color:var(--green);border-color:var(--green)}
main{max-width:720px;margin:0 auto;padding:56px 24px 80px}
.hero{margin-bottom:48px}
.hero-badge{display:inline-block;background:#00ff8712;border:1px solid #00ff8730;color:var(--green);font-size:12px;letter-spacing:2px;text-transform:uppercase;padding:5px 14px;border-radius:20px;margin-bottom:18px;font-family:'Syne',sans-serif}
.hero h1{font-family:'Syne',sans-serif;font-size:clamp(24px,4vw,36px);font-weight:800;margin-bottom:12px}
.hero-meta{font-size:13px;color:var(--muted);font-family:'Syne',sans-serif}
.section{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:28px 32px;margin-bottom:14px}
.section h2{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:var(--green);margin-bottom:14px;display:flex;align-items:center;gap:8px}
.section p,.section li{font-size:12px;color:#b0b0c8;line-height:1.9;margin-bottom:10px}
.section ul{padding-left:18px}
.section li{margin-bottom:6px}
.section li::marker{color:var(--green)}
.section p:last-child,.section li:last-child{margin-bottom:0}
.highlight{background:#00ff8708;border:1px solid #00ff8720;border-radius:8px;padding:14px 18px;margin-top:14px}
.highlight p{color:var(--text);font-size:13px;margin:0;font-family:'Syne',sans-serif;line-height:1.7}
.tag{display:inline-block;background:#1e1e2e;border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:12px;color:var(--muted);margin:2px;vertical-align:middle}
.contact-btn{display:inline-flex;align-items:center;gap:8px;background:#25d36618;border:1px solid #25d36630;color:#25d366;font-family:'Syne',sans-serif;font-weight:700;font-size:12px;padding:11px 22px;border-radius:8px;text-decoration:none;transition:all .2s;margin-top:14px}
.contact-btn:hover{background:#25d36628;transform:translateY(-2px);box-shadow:0 6px 20px #25d36625}
footer{text-align:center;padding:28px;font-size:13px;color:#8a8aaa;border-top:1px solid var(--border);font-family:'Syne',sans-serif}
footer a{color:#8a8aaa;text-decoration:none}footer a:hover{color:var(--green)}
@media(max-width:520px){main{padding:32px 16px 60px}.section{padding:20px 18px}.header-links a{padding:5px 9px;font-size:12px}}
</style>
</head>
<body>
<header>
  <a href="/" class="logo">⚡ ZVM</a>
  <div class="header-links">
    <a href="/">Portal</a>
    <a href="/faq">FAQ</a>
    <a href="https://wa.me/5521996771552?text=LR!%20Preciso%20de%20ajuda." target="_blank">💬 Suporte</a>
  </div>
</header>
<main>
  <div class="hero">
    <div class="hero-badge">Legal</div>
    <h1>Política de Privacidade</h1>
    <p class="hero-meta">Última atualização: ${new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})}</p>
  </div>
  <div class="section">
    <h2>📋 Visão Geral</h2>
    <p>Esta Política descreve como o <strong style="color:var(--text)">ZVM</strong> coleta, utiliza e protege seus dados ao usar o serviço de licenciamento da extensão ZVM.</p>
    <p>Ao ativar ou consultar sua chave de acesso, você concorda com estes termos, em conformidade com a <strong style="color:var(--text)">Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018)</strong>.</p>
  </div>
  <div class="section">
    <h2>🗂 Dados que Coletamos</h2>
    <p>Para fins exclusivos de licenciamento e controle de acesso, coletamos:</p>
    <ul>
      <li><strong style="color:var(--text)">Chave de ativação</strong> — identificador único do seu acesso</li>
      <li><strong style="color:var(--text)">Número de telefone</strong> — vinculado à chave para controle de dispositivos</li>
      <li><strong style="color:var(--text)">Endereço IP</strong> — para detecção de uso indevido e segurança</li>
      <li><strong style="color:var(--text)">Versão do WhatsApp Web</strong> — para compatibilidade técnica</li>
      <li><strong style="color:var(--text)">Timestamps de acesso</strong> — data e hora de cada uso registrado</li>
    </ul>
    <div class="highlight">
      <p>⚠️ <strong>Não coletamos</strong> mensagens, contatos, conversas ou qualquer conteúdo do WhatsApp. Nosso serviço não tem acesso ao conteúdo das suas comunicações.</p>
    </div>
  </div>
  <div class="section">
    <h2>🎯 Finalidade</h2>
    <p>Os dados são usados exclusivamente para:</p>
    <ul>
      <li>Validar e controlar o acesso à extensão ZVM</li>
      <li>Detectar uso indevido ou compartilhamento não autorizado de chaves</li>
      <li>Suporte técnico quando solicitado pelo usuário</li>
      <li>Controle do número de dispositivos vinculados por chave</li>
    </ul>
    <p>Base legal: <strong style="color:var(--text)">execução de contrato</strong> (Art. 7º, V, LGPD).</p>
  </div>
  <div class="section">
    <h2>⏱ Retenção</h2>
    <p>Registros de acesso são removidos automaticamente após <strong style="color:var(--text)">90 dias</strong>. Dados da chave são mantidos enquanto ela estiver ativa. Ao excluir a chave, todos os dados associados são apagados permanentemente.</p>
  </div>
  <div class="section">
    <h2>🔒 Segurança</h2>
    <p>Dados armazenados no <strong style="color:var(--text)">MongoDB Atlas</strong> com criptografia AES-256 em repouso e TLS em trânsito. O painel administrativo é protegido por senha e autenticação de dois fatores (2FA).</p>
  </div>
  <div class="section">
    <h2>🤝 Compartilhamento</h2>
    <p>Seus dados <strong style="color:var(--text)">não são vendidos ou compartilhados</strong> com terceiros para fins comerciais. Apenas os provedores de infraestrutura têm acesso técnico:</p>
    <ul>
      <li><span class="tag">MongoDB Atlas</span> armazenamento dos dados</li>
      <li><span class="tag">Render.com</span> hospedagem do servidor</li>
    </ul>
  </div>
  </div>
</main>
<footer>
  <p>© ${new Date().getFullYear()} ZVM — <a href="/">Portal</a> · <a href="/faq">FAQ</a> · <a href="/privacidade">Privacidade</a></p>
  <p style="margin-top:6px;font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.5">Todos os direitos reservados</p>
</footer>
${CANVAS_BG}
</body></html>`;
}

function renderAnalyticsLogin(error = '') {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Analytics</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3ELR%3C/text%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#080810;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Space Mono',monospace;overflow:hidden}
.card{background:#0f0f1a;border:1px solid #1c1c2e;border-radius:18px;padding:40px 36px;width:360px;position:relative;z-index:1;box-shadow:0 0 40px rgba(0,255,135,0.08)}
.logo{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:#00ff87;margin-bottom:4px;text-align:center;letter-spacing:-0.5px}
.sub{color:#5a5a7a;font-size:12px;letter-spacing:3px;text-transform:uppercase;margin-bottom:24px;text-align:center}
.badge{display:block;background:#00ff8712;border:1px solid #00ff8730;color:#00ff87;font-size:13px;letter-spacing:1px;text-transform:uppercase;padding:4px 14px;border-radius:20px;margin-bottom:20px;text-align:center;font-family:'Syne',sans-serif;font-weight:700}
label{display:block;font-size:12px;letter-spacing:2px;color:#5a5a7a;text-transform:uppercase;margin-bottom:7px}
input{width:100%;padding:11px 14px;background:#080810;border:1px solid #1c1c2e;border-radius:8px;color:#e2e2f0;font-family:'Space Mono',monospace;font-size:13px;outline:none;margin-bottom:16px;transition:border .2s}
input:focus{border-color:#00ff87}
.btn{width:100%;padding:12px;background:#00ff87;border:none;border-radius:8px;color:#000;font-family:'Syne',sans-serif;font-weight:700;font-size:14px;cursor:pointer;transition:opacity .2s}
.btn:hover{opacity:.85}
.err{background:#ff475715;border:1px solid #ff4757;border-radius:6px;color:#ff4757;padding:11px 14px;font-size:14px;margin-bottom:16px;font-family:'Syne',sans-serif}
</style></head><body>
<div class="card">
  <div class="logo">⚡ ZVM</div>
  <div class="sub">Painel de Analytics</div>
  <div class="badge">📊 Acesso Privado</div>
  ${error ? `<div class="err">${escHtml(error)}</div>` : ''}
  <form method="POST" action="${R_ANALYTICS}/login">
    <label>Senha de Acesso</label>
    <input type="password" name="pass" autofocus>
    <button type="submit" class="btn">Entrar</button>
  </form>
</div>
${CANVAS_BG}</body></html>`;
}

async function renderAnalyticsDashboard() {
  const stats    = await getPaymentStats();
  const payments = await getPayments({ limit: 200 });
  const fmtBRL   = v => 'R$\u00a0' + (v||0).toFixed(2).replace('.',',');
  const fmtDate  = iso => iso ? new Date(iso).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
  const escH     = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const byDayJson    = JSON.stringify(stats?.byDay     || []);
  const byProdJson   = JSON.stringify(stats?.byProduct || []);
  const byHourJson   = JSON.stringify(stats?.byHour    || []);
  const byMethodJson = JSON.stringify(stats?.byMethod  || []);

  const paymentsRows = payments.length ? payments.map(p => {
    const rowSearch = [p.clientName,p.clientEmail,p.productName,p.keyCode,p.paymentMethod].join('|').toLowerCase();
    return `<tr data-row="${escH(rowSearch)}" data-paid="${escH(p.paidAt||'')}">
  <td>${fmtDate(p.paidAt)}</td>
  <td>${escH(p.clientName)}</td>
  <td style="color:#6b6b8a;font-size:12px">${escH(p.clientEmail)}</td>
  <td>${escH(p.productName)}</td>
  <td style="color:${p.approved?'#00ff87':'#ff4757'};font-weight:700">${fmtBRL(p.amount)}</td>
  <td><span class="badge ${p.approved?'bon':'boff'}">${p.approved?'APROVADO':'REJEITADO'}</span></td>
  <td style="color:#4f8ef7;font-size:12px">${escH(p.keyCode||'-')}</td>
</tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">Nenhum pagamento registrado ainda.<br>Configure o webhook da Payt apontando para /payt/webhook</td></tr>';

  const topClientsRows = (stats?.topClients||[]).map(c =>
    `<tr><td>${escH(c._id)}</td><td style="text-align:center;color:#00ff87;font-weight:700">${c.count}</td><td style="text-align:right;color:#00ff87">${fmtBRL(c.total)}</td></tr>`
  ).join('') || '<tr><td colspan="3" class="empty">Sem dados</td></tr>';

  const modRows = (stats?.byMod||[]).map((m,i) =>
    `<tr><td>${i===0?'🥇':i===1?'🥈':i===2?'🥉':'  '} ${escH(m.name)}</td><td style="text-align:right;color:#4f8ef7;font-weight:700">${m.count} chaves</td></tr>`
  ).join('') || '<tr><td colspan="2" class="empty">Sem dados</td></tr>';

  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Analytics</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3ELR%3C/text%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--gold:#00ff87;--dark:#080810;--card:#0f0f1a;--card2:#13131f;--border:#1c1c2e;--text:#e2e2f0;--muted:#5a5a7a;--green:#00ff87;--red:#ff4757;--blue:#4f8ef7;--radius:10px}
body{background:var(--dark);color:var(--text);font-family:'Space Mono',monospace;min-height:100vh}
header{display:flex;align-items:center;justify-content:space-between;padding:12px 24px;border-bottom:1px solid var(--border);background:var(--card);position:sticky;top:0;z-index:50;box-shadow:0 2px 20px #00000040}
.logo{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:var(--green);display:flex;align-items:center;gap:8px;letter-spacing:-0.5px}
.badge-an{background:#00ff8712;border:1px solid #00ff8730;color:var(--green);font-size:12px;text-transform:uppercase;padding:4px 12px;border-radius:20px;font-family:'Syne',sans-serif;font-weight:700}
a.out{color:var(--muted);font-size:13px;text-decoration:none;padding:6px 14px;border:1px solid var(--border);border-radius:6px;transition:all .2s;font-family:'Syne',sans-serif;font-weight:700}
a.out:hover{color:var(--red);border-color:var(--red)}
main{padding:22px 24px;max-width:1600px;margin:0 auto;position:relative;z-index:1}
/* Stats grid */
.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:16px}
.stats2{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}
.sc{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;position:relative;overflow:hidden;transition:border-color .2s}
.sc:hover{border-color:#00ff8730}
.sc-icon{position:absolute;right:12px;top:12px;font-size:20px;opacity:.12}
.sc .n{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:var(--green);line-height:1.1}
.sc .n.green{color:var(--green)}
.sc .n.red{color:var(--red)}
.sc .n.blue{color:var(--blue)}
.sc .l{color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.3px;margin-top:6px;font-family:'Syne',sans-serif}
.sc .sub-n{font-size:13px;color:var(--muted);margin-top:4px;font-family:'Syne',sans-serif}
/* Charts */
.charts{display:grid;grid-template-columns:2fr 1fr;gap:14px;margin-bottom:16px}
.charts3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:16px}
.chart-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:18px}
.chart-title{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:var(--green);margin-bottom:14px;display:flex;align-items:center;gap:6px}
/* Sections */
.sec{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:14px}
.sh{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--card2);flex-wrap:wrap;gap:8px}
.st{font-family:'Syne',sans-serif;font-weight:700;font-size:14px;color:var(--green)}
.sh input{padding:6px 10px;background:var(--dark);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:'Syne',sans-serif;font-size:13px;outline:none;width:200px}
.sh input:focus{border-color:var(--green)}
.btn{padding:8px 14px;border:none;border-radius:6px;cursor:pointer;font-family:'Syne',sans-serif;font-weight:700;font-size:13px;transition:all .18s}
.bcsv{background:#00ff8712;color:var(--green);border:1px solid #00ff8730}
.bcsv:hover{background:#00ff8722;border-color:var(--green)}
.pb{padding:5px 12px;background:var(--card2);border:1px solid var(--border);border-radius:6px;color:var(--muted);font-family:'Syne',sans-serif;font-weight:700;font-size:12px;cursor:pointer;transition:all .18s}
.pb.active,.pb:hover{background:#00ff8718;border-color:#00ff8740;color:var(--green)}
.period-btns{display:flex;gap:6px}
.ov{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{padding:11px 14px;text-align:left;font-size:13px;text-transform:uppercase;letter-spacing:.3px;color:var(--muted);border-bottom:1px solid var(--border);background:var(--card2);white-space:nowrap;font-family:'Syne',sans-serif}
td{padding:12px 14px;font-size:14px;border-bottom:1px solid #14141f;vertical-align:middle;font-family:'Syne',sans-serif}
tr:last-child td{border-bottom:none}
tr:hover td{background:#ffffff02}
.badge{padding:2px 7px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;font-family:'Syne',sans-serif}
.bon{background:#00ff8718;color:var(--green);border:1px solid #00ff8730}
.boff{background:#ff475718;color:var(--red);border:1px solid #ff475730}
.empty{text-align:center;color:var(--muted);padding:30px;font-size:13px;line-height:2;font-family:'Syne',sans-serif}
/* Retention bar */
.ret-bar-wrap{background:#1c1c2e;border-radius:6px;height:8px;overflow:hidden;margin-top:8px}
.ret-bar{height:8px;border-radius:6px;background:linear-gradient(90deg,#00cc6a,var(--green));transition:width .8s}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
@media(max-width:1200px){.stats{grid-template-columns:repeat(3,1fr)}.stats2{grid-template-columns:repeat(2,1fr)}.charts{grid-template-columns:1fr}.charts3{grid-template-columns:1fr 1fr}}
@media(max-width:700px){.stats{grid-template-columns:1fr 1fr}.stats2{grid-template-columns:1fr 1fr}.two-col{grid-template-columns:1fr}.charts3{grid-template-columns:1fr};main{padding:14px 12px}}
</style></head><body>
<header>
  <div class="logo">⚡ ZVM <span class="badge-an">Analytics</span></div>
  <div style="display:flex;gap:10px;align-items:center">
    <a href="${R_ANALYTICS}/export/csv" class="btn bcsv">⬇ CSV</a>
    <a href="${R_ANALYTICS}/logout" class="out">↩ Sair</a>
  </div>
</header>
<main>

  <!-- KPIs principais -->
  <div class="stats">
    <div class="sc"><div class="sc-icon">💰</div><div class="n">${fmtBRL(stats?.revenueTotal||0)}</div><div class="l">Receita Total</div><div class="sub-n">${fmtBRL(stats?.revenueLast30||0)} últimos 30d</div></div>
    <div class="sc"><div class="sc-icon">🛒</div><div class="n">${stats?.total||0}</div><div class="l">Total de Vendas</div><div class="sub-n">${stats?.last30||0} últimos 30d</div></div>
    <div class="sc"><div class="sc-icon">📈</div><div class="n">${stats?.last7||0}</div><div class="l">Vendas 7 dias</div><div class="sub-n">${fmtBRL(stats?.revenueLast7||0)}</div></div>
    <div class="sc"><div class="sc-icon">🎯</div><div class="n">${stats?.total ? fmtBRL((stats.revenueTotal||0)/stats.total) : 'R$\u00a00,00'}</div><div class="l">Ticket Médio</div></div>
    <div class="sc"><div class="sc-icon">👥</div><div class="n blue">${stats?.uniqueClients||0}</div><div class="l">Clientes Únicos</div><div class="sub-n">${stats?.returningClients||0} recorrentes</div></div>
    <div class="sc"><div class="sc-icon">🔄</div><div class="n ${(stats?.retentionRate||0)>=30?'green':'red'}">${stats?.retentionRate||0}%</div><div class="l">Taxa Retenção</div><div class="sub-n">${stats?.returningClients||0} de ${stats?.uniqueClients||0} clientes</div></div>
  </div>

  <!-- KPIs secundários -->
  <div class="stats2">
    <div class="sc"><div class="sc-icon">📦</div><div class="n blue">${stats?.byProduct?.length||0}</div><div class="l">Produtos Ativos</div><div class="sub-n">${(stats?.byProduct||[]).slice(0,2).map(p=>escH(p._id||'?')+'('+p.count+')').join(', ')||'—'}</div></div>
    <div class="sc"><div class="sc-icon">💳</div><div class="n blue">${(stats?.byMethod||[])[0]?._id||'—'}</div><div class="l">Método + Usado</div><div class="sub-n">${(stats?.byMethod||[])[0]?.count||0} transações</div></div>
    <div class="sc"><div class="sc-icon">📉</div><div class="n ${(stats?.churnRate||0)>50?'red':(stats?.churnRate||0)>25?'gold':''}">${stats?.churnRate||0}%</div><div class="l">Taxa de Churn (30d)</div><div class="sub-n">${stats?.churnedKeys||0} de ${stats?.expiredKeys||0} expiradas</div></div>
    <div class="sc"><div class="sc-icon">⏰</div><div class="n blue">${(stats?.byHour||[]).sort((a,b)=>b.count-a.count)[0]?._id||'—'}h</div><div class="l">Horário de Pico</div><div class="sub-n">${(stats?.byHour||[]).sort((a,b)=>b.count-a.count)[0]?.count||0} vendas neste horário</div></div>
  </div>

  <!-- Gráficos principais -->
  <div class="charts">
    <div class="chart-card">
      <div class="chart-title">📊 Vendas e Receita — últimos 30 dias</div>
      <canvas id="chartVendas" height="180"></canvas>
    </div>
    <div class="chart-card">
      <div class="chart-title">🥧 Receita por Produto</div>
      <canvas id="chartProdutos" height="180"></canvas>
    </div>
  </div>

  <!-- Gráficos secundários -->
  <div class="charts3">
    <div class="chart-card">
      <div class="chart-title">⏰ Horários de Pico</div>
      <canvas id="chartHoras" height="160"></canvas>
    </div>
    <div class="chart-card">
      <div class="chart-title">💳 Métodos de Pagamento</div>
      <canvas id="chartMetodos" height="160"></canvas>
    </div>
    <div class="chart-card">
      <div class="chart-title">🔄 Retenção de Clientes</div>
      <div style="padding-top:20px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;font-family:'Syne',sans-serif"><span style="color:var(--muted)">Novos clientes</span><span style="color:var(--text)">${(stats?.uniqueClients||0)-(stats?.returningClients||0)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;font-family:'Syne',sans-serif"><span style="color:var(--muted)">Clientes recorrentes</span><span style="color:var(--green)">${stats?.returningClients||0}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:10px;font-family:'Syne',sans-serif"><span style="color:var(--muted)">Taxa de retenção</span><span style="color:${(stats?.retentionRate||0)>=30?'var(--green)':'var(--red)'};font-weight:700">${stats?.retentionRate||0}%</span></div>
        <div class="ret-bar-wrap"><div class="ret-bar" style="width:${stats?.retentionRate||0}%"></div></div>
        <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:14px">
          <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Churn (30 dias)</div>
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;font-family:'Syne',sans-serif"><span style="color:var(--muted)">Expiradas no período</span><span>${stats?.expiredKeys||0}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:13px;font-family:'Syne',sans-serif"><span style="color:var(--muted)">Não renovaram</span><span style="color:var(--red)">${stats?.churnedKeys||0} (${stats?.churnRate||0}%)</span></div>
        </div>
      </div>
    </div>
  </div>

  <!-- Tabelas lado a lado -->
  <div class="two-col">
    <div class="sec">
      <div class="sh"><div class="st">🏆 Top Clientes</div></div>
      <div class="ov"><table>
        <thead><tr><th>Email</th><th style="text-align:center">Compras</th><th style="text-align:right">Total Gasto</th></tr></thead>
        <tbody>${topClientsRows}</tbody>
      </table></div>
    </div>
    <div class="sec">
      <div class="sh"><div class="st">👮 Moderadores</div></div>
      <div class="ov"><table>
        <thead><tr><th>Moderador</th><th style="text-align:right">Chaves Criadas</th></tr></thead>
        <tbody>${modRows}</tbody>
      </table></div>
    </div>
  </div>

  <!-- Histórico de pagamentos -->
  <div class="sec">
    <div class="sh">
      <div class="st">💳 Histórico de Pagamentos</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="text" id="search" placeholder="🔍 Cliente, email, produto..." oninput="filterTable()">
        <div class="period-btns">
          <button class="pb active" onclick="setPeriod(7,this)">7d</button>
          <button class="pb" onclick="setPeriod(30,this)">30d</button>
          <button class="pb" onclick="setPeriod(90,this)">90d</button>
          <button class="pb" onclick="setPeriod(0,this)">Todos</button>
        </div>
      </div>
    </div>
    <div class="ov">
      <table>
        <thead><tr><th>Data</th><th>Cliente</th><th>Email</th><th>Produto</th><th>Valor</th><th>Status</th><th>Chave</th></tr></thead>
        <tbody id="payments-body">${paymentsRows}</tbody>
      </table>
    </div>
  </div>
  </div>
</main>

<script>
const _byDay=${byDayJson},_byProduct=${byProdJson},_byHour=${byHourJson},_byMethod=${byMethodJson};
const _days=[];
for(let i=29;i>=0;i--){const d=new Date(Date.now()-i*86400000),k=d.toISOString().slice(0,10),f=_byDay.find(x=>x._id===k);_days.push({date:k,count:f?.count||0,revenue:f?.revenue||0});}

const _hours=Array.from({length:24},(_,i)=>{const h=String(i).padStart(2,'0'),f=_byHour.find(x=>x._id===h);return{h:h+'h',count:f?.count||0};});

function loadChart(cb){if(window.Chart){cb();return;}const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js';s.onload=cb;document.head.appendChild(s);}

loadChart(()=>{
  Chart.defaults.color='#5a5a7a';Chart.defaults.borderColor='#1c1c2e';

  new Chart(document.getElementById('chartVendas'),{type:'bar',data:{
    labels:_days.map(d=>d.date.slice(5)),
    datasets:[
      {label:'Vendas',data:_days.map(d=>d.count),backgroundColor:'#00ff8722',borderColor:'#00ff87',borderWidth:1.5,borderRadius:4,yAxisID:'y'},
      {label:'Receita (R$)',data:_days.map(d=>d.revenue),type:'line',borderColor:'#00ff87',backgroundColor:'#00ff8715',borderWidth:2,pointRadius:2,tension:0.4,yAxisID:'y2'}
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{font:{family:'Space Mono',size:10},boxWidth:12}}},scales:{y:{position:'left',grid:{color:'#1c1c2e'},ticks:{precision:0}},y2:{position:'right',grid:{drawOnChartArea:false},ticks:{callback:v=>'R$'+v.toFixed(0)}},x:{grid:{color:'#1c1c2e'},ticks:{font:{size:9},maxRotation:45}}}}});

  if(_byProduct.length){const colors=['#ffd32a','#00ff87','#4f8ef7','#ff4757','#9b59b6','#ff8600'];
  new Chart(document.getElementById('chartProdutos'),{type:'doughnut',data:{labels:_byProduct.map(p=>p._id||'?'),datasets:[{data:_byProduct.map(p=>p.revenue||p.count),backgroundColor:colors,borderColor:'#0f0f1a',borderWidth:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{family:'Space Mono',size:10},boxWidth:10,padding:8}},tooltip:{callbacks:{label:ctx=>' R$ '+ctx.parsed.toFixed(2).replace('.',',')}}}}}});}

  new Chart(document.getElementById('chartHoras'),{type:'bar',data:{
    labels:_hours.map(h=>h.h),
    datasets:[{label:'Vendas',data:_hours.map(h=>h.count),backgroundColor:_hours.map(h=>{const max=Math.max(..._hours.map(x=>x.count));return h.count===max?'#00ff87':'#00ff8722';}),borderColor:'#00ff8760',borderWidth:1,borderRadius:3}]
  },options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{grid:{color:'#1c1c2e'},ticks:{precision:0,font:{size:8}}},x:{grid:{color:'#1c1c2e'},ticks:{font:{size:8}}}}}});

  if(_byMethod.length){const mc=['#4f8ef7','#ffd32a','#00ff87','#ff4757','#9b59b6'];
  new Chart(document.getElementById('chartMetodos'),{type:'pie',data:{labels:_byMethod.map(m=>m._id||'?'),datasets:[{data:_byMethod.map(m=>m.count),backgroundColor:mc,borderColor:'#0f0f1a',borderWidth:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{family:'Space Mono',size:10},boxWidth:10,padding:8}}}}});}
});

function filterTable(){const q=(document.getElementById('search').value||'').toLowerCase();document.querySelectorAll('#payments-body tr[data-row]').forEach(r=>{r.style.display=!q||r.dataset.row.includes(q)?'':'none';});}
function setPeriod(days,btn){document.querySelectorAll('.pb').forEach(b=>b.classList.remove('active'));btn.classList.add('active');const cutoff=days?new Date(Date.now()-days*86400000).toISOString():null;document.querySelectorAll('#payments-body tr[data-paid]').forEach(r=>{r.style.display=(!cutoff||r.dataset.paid>=cutoff)?'':'none';});}
</script>
${CANVAS_BG}</body></html>`;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p   = url.pathname;
  const ip  = getIp(req);

  const _corsH = {
    'Access-Control-Allow-Origin':  (()=>{
      const o=req.headers.origin||'';
      if(p.startsWith(R_ADMIN)||p.startsWith(R_MOD)||(R_ANALYTICS&&p.startsWith(R_ANALYTICS))){return 'null';}
      return o||'*';
    })(),
    'Access-Control-Allow-Methods': 'POST,GET,OPTIONS,DELETE',
    'Access-Control-Allow-Headers': 'Content-Type,x-app-date,x-app-sig,x-app-ts',
    'Access-Control-Max-Age':       '86400',
    'Vary':                         'Origin',
    'X-Content-Type-Options':       'nosniff',
    'X-Frame-Options':              'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Referrer-Policy':              'no-referrer',
    'Permissions-Policy':           'geolocation=(), microphone=(), camera=()',
    'Content-Security-Policy':      "default-src 'self'; script-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    'X-Powered-By':                 'PHP/7.4.3',
  };
  Object.entries(_corsH).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (APP_SECRET) {
    if (p === '/admin' || p.startsWith('/admin/')) { res.writeHead(404); res.end('Not found'); return; }
    if (p === '/mod'  || p.startsWith('/mod/'))   { res.writeHead(404); res.end('Not found'); return; }
    if (p === '/analytics' || p.startsWith('/analytics/')) { res.writeHead(404); res.end('Not found'); return; }
  }

  console.log(`[${new Date().toISOString()}] ${req.method} ${p} — ${ip}`);

  if (p === '/health' && req.method === 'GET') {
    res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});
    res.end('ok'); return;
  }

  if ((p === R_EXT+'/auth/' || p === R_EXT+'/auth') && req.method === 'GET') {
    const callback = url.searchParams.get('callback') || '';
    sendHtml(res, renderExtensionLogin({ callback })); return;
  }

  if (p === R_EXT+'/auth/verify' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'login')) {
      const mins = getRateLimitWait(ip, 'login');
      sendHtml(res, renderExtensionLogin({ callback: '', error: `⏳ Muitas tentativas. Aguarde ${mins} minuto(s).` }), 429);
      return;
    }
    const form    = await parseFormBody(req);
    const keyCode = (form.get('key') || '').trim().toLowerCase();
    const callback= form.get('callback') || '';
    if (!keyCode || !keys[keyCode]) {
      await addLog({ keyCode: keyCode||'?', label: '-', phone: '-', ip, wppVersion: '-', action: 'key_not_found' });
      sendHtml(res, renderExtensionLogin({ callback, keyVal: keyCode, error: '❌ Chave não encontrada. Verifique ou entre em contato com o vendedor.' }));
      return;
    }
    if (isKeyExpired(keys[keyCode])) {
      keys[keyCode].active = false;
      await addLog({ keyCode, label: keys[keyCode].label, phone: '-', ip, wppVersion: '-', action: 'expired' });
      saveKey(keyCode);
      fireWebhook('key_expired', keyCode, 'Expiração detectada no login');
      sendHtml(res, renderExtensionLogin({ callback, keyVal: keyCode, error: '⏰ Chave expirada. Entre em contato com o vendedor para renovar.' }));
      return;
    }
    if (!keys[keyCode].active) {
      await addLog({ keyCode, label: keys[keyCode].label, phone: '-', ip, wppVersion: '-', action: 'login_blocked' });
      sendHtml(res, renderExtensionLogin({ callback, keyVal: keyCode, error: '🚫 Chave bloqueada. Entre em contato com o vendedor.' }));
      return;
    }
    keys[keyCode].lastUsed = new Date().toISOString();
    keys[keyCode].lastIp   = ip;
    saveKey(keyCode);
    const _cbOk = ['chrome-extension:','https:','http:'];
    let _cbUrl = null;
    if (callback) { try { _cbUrl = new URL(callback); if (!_cbOk.includes(_cbUrl.protocol)) _cbUrl = null; } catch {} }
    if (_cbUrl) {
      _cbUrl.searchParams.set('key',         keyCode);
      _cbUrl.searchParams.set('keyId',       `id-${keyCode}`);
      _cbUrl.searchParams.set('ownerId',     'zv-owner');
      _cbUrl.searchParams.set('managerId',   'zv-manager');
      _cbUrl.searchParams.set('isPremium',   'true');
      _cbUrl.searchParams.set('isLoggedIn',  'true');
      _cbUrl.searchParams.set('planName',    'Pro');
      _cbUrl.searchParams.set('marketplace', 'premium');
      _cbUrl.searchParams.set('username',    keys[keyCode].label);
      _cbUrl.searchParams.set('email',       'cliente@zapvoice.com.br');
      _cbUrl.searchParams.set('plan_id',     'ZV_PRO');
      _cbUrl.searchParams.set('permissions', FULL_PERMISSIONS.join(','));
      res.writeHead(302, { Location: _cbUrl.toString() }); res.end();
    } else {
      const _noCallbackPage = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>ZVM - Ativado</title><style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0a0a0f;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:monospace}.card{background:#111118;border:1px solid #00ff8740;border-radius:18px;padding:40px 36px;width:100%;max-width:420px;text-align:center}.icon{font-size:48px;margin-bottom:8px}.title{font-size:22px;font-weight:800;color:#00ff87;margin-bottom:8px}.sub{color:#8a8aaa;font-size:13px;line-height:1.6;margin-bottom:20px}.key{background:#0a0a0f;border:1px solid #00ff8730;border-radius:8px;padding:10px 16px;color:#00ff87;font-size:14px;letter-spacing:2px;margin-bottom:20px}.bar{width:100%;height:3px;background:#1a1a2e;border-radius:2px}.fill{height:100%;background:#00ff87;animation:drain 3s linear forwards;border-radius:2px}@keyframes drain{from{width:100%}to{width:0%}}</style></head><body><div class="card"><div class="icon">&#x26A1;</div><div class="title">Chave Ativada!</div><div class="sub">Volte ao WhatsApp Web e atualize a p&aacute;gina.</div><div class="key">${keyCode}</div><div class="bar"><div class="fill"></div></div></div><script>setTimeout(function(){window.close();},3100);</script></body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(_noCallbackPage);
    }
    return;
  }

  if (p === R_EXT+'/v3/key' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'ext_key')) {
      sendJson(res, { authError: 'rateLimited', authErrorMessage: 'Muitas tentativas. Aguarde.', isLoggedIn: false }, 429);
      return;
    }
    const rawBody = await new Promise(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>r(b));});
    let body; try { body = _safeParse(rawBody); } catch { body = {}; }
    const keyCode    = (body.authKey || '').toLowerCase().slice(0, 20);
    const phone      = body.phoneNumber || '-';
    const wppVersion = body.wppVersion  || '-';
    const deviceId   = body.deviceId    || '';

    if (!keyCode) {
      sendJson(res, { authError: 'keyNotFound', authErrorMessage: 'Chave não encontrada.', isLoggedIn: false });
      return;
    }
    if (!keys[keyCode]) {
      try {
        const db = await getMongoDb();
        const doc = await db.collection('store').findOne({ _id: 'keys' });
        if (doc && doc.data && doc.data[keyCode]) keys[keyCode] = doc.data[keyCode];
      } catch(e) { /* continua */ }
    }
    if (!keys[keyCode]) {
      sendJson(res, { authError: 'keyNotFound', authErrorMessage: 'Chave não encontrada. Contate o vendedor.', isLoggedIn: false });
      addLog({ keyCode, label: '-', phone, ip, wppVersion, action: 'key_not_found' }).catch(()=>{});
      return;
    }
    if (isKeyExpired(keys[keyCode])) {
      keys[keyCode].active = false;
      sendJson(res, { authError: 'keyExpired', reason: 'expired', isLoggedIn: false, data: { message: 'USUÁRIO NÃO ENCONTRADO. Chave expirada.', permissions: [] } }, 403);
      addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: 'expired' }).catch(()=>{});
      saveKey(keyCode).catch(()=>{});
      fireWebhook('key_expired', keyCode, 'Expiração detectada no v3/key');
      return;
    }
    if (!keys[keyCode].active) {
      sendJson(res, { authError: 'keyBlocked', reason: 'blocked', isLoggedIn: false, data: { message: 'USUÁRIO NÃO ENCONTRADO. Chave bloqueada.', permissions: [] } }, 403);
      addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: 'login_blocked' }).catch(()=>{});
      return;
    }

    if (!keys[keyCode].phones) {
      keys[keyCode].phones = keys[keyCode].lastPhone ? [keys[keyCode].lastPhone] : [];
    }

    const hasPhone   = phone && phone !== '-';
    const knownPhone = hasPhone && keys[keyCode].phones.includes(phone);
    const isNewPhone = hasPhone && !knownPhone;
    const keyMaxUses = (typeof keys[keyCode].maxUses === 'number') ? keys[keyCode].maxUses : MAX_USES;

    if (isNewPhone) {
      if (keyMaxUses > 0 && keys[keyCode].phones.length >= keyMaxUses) {
        keys[keyCode].warnCount = (keys[keyCode].warnCount || 0) + 1;
        const warnTs = keys[keyCode].warnCountTs;
        if (warnTs && (Date.now() - new Date(warnTs).getTime()) > 24*3600*1000) {
          keys[keyCode].warnCount = 1;
        }
        keys[keyCode].warnCountTs = new Date().toISOString();
        sendJson(res, {
          warnLimit: true, isLoggedIn: false, warnRemaining: keys[keyCode].warnCount,
          data: { message: `USUÁRIO NÃO ENCONTRADO. Limite de ativações atingido (${keys[keyCode].phones.length}/${keyMaxUses}).`, permissions: [] }
        }, 403);
        addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: 'warn_limit' }).catch(()=>{});
        saveKey(keyCode).catch(()=>{});
        return;
      }
      keys[keyCode].phones.push(phone);
      keys[keyCode].uses = keys[keyCode].phones.length;
    }

    if (keys[keyCode].expireDuration && !keys[keyCode].expiresAt && keys[keyCode].phones.length >= 1) {
      const exp = new Date(Date.now() + keys[keyCode].expireDuration);
      keys[keyCode].expiresAt   = exp.toISOString();
      keys[keyCode].activatedAt = new Date().toISOString();
    }

    keys[keyCode].lastUsed   = new Date().toISOString();
    keys[keyCode].lastIp     = ip;
    keys[keyCode].wppVersion = wppVersion;
    if (hasPhone) keys[keyCode].lastPhone = phone;
    if (deviceId) keys[keyCode].deviceId  = deviceId;

    sendJson(res, getAuthData(keyCode, body.userName || ''));

    const _action = isNewPhone ? 'login_ok' : 'relogin_ok';
    addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: _action }).catch(()=>{});
    saveKey(keyCode).catch(()=>{});
    return;
  }

  if (p === R_EXT+'/v3/check-status' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'check_status', 60, 60000)) {
      sendJson(res, { active: true }); return; // silencioso — não deslogar por rate limit
    }
    if (parseInt(req.headers['content-length'] || 0) > MAX_BODY_SIZE) {
      sendJson(res, { active: true }); return;
    }
    const rawBody = await new Promise(r=>{let b='';req.on('data',c=>{b+=c;});req.on('end',()=>r(b));});
    let body; try { body = JSON.parse(rawBody); } catch { body = {}; }
    const keyCode = (body.authKey || '').toLowerCase().slice(0, 20);
    if (!serverReady) { sendJson(res, { active: true }); return; }
    if (!keyCode)     { sendJson(res, { active: true }); return; }
    if (!keys[keyCode]) {
      try {
        const db  = await getMongoDb();
        const doc = await db.collection('store').findOne({ _id: 'keys' });
        if (doc && doc.data && doc.data[keyCode]) keys[keyCode] = doc.data[keyCode];
      } catch(e) {
        sendJson(res, { active: true }); return;
      }
    }
    if (!keys[keyCode]) { sendJson(res, { active: false, reason: 'not_found' }); return; }
    if (isKeyExpired(keys[keyCode]))   {
      keys[keyCode].active = false;
      saveKey(keyCode).catch(()=>{});
      sendJson(res, { active: false, reason: 'expired' }); return;
    }
    if (!keys[keyCode].active)         {
      addLog({ keyCode, label: keys[keyCode].label||'-', phone: '-', ip, wppVersion: '-', action: 'check_blocked' }).catch(()=>{});
      sendJson(res, { active: false, reason: 'blocked' }); return;
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    sendJson(res, {
      active:       true,
      expiringSoon: isKeyExpiringSoon(keys[keyCode]),
      hoursLeft:    hoursUntilExpiry(keys[keyCode]),
      deferred:     !!(keys[keyCode].expireDuration && !keys[keyCode].expiresAt),
      modules:      { ...DEFAULT_MODULES, ...(keys[keyCode].modules || {}) },
      ts:           Date.now()
    });
    return;
  }

  if ([R_EXT+'/v3/usage', R_EXT+'/v3/get-usage', R_EXT+'/v3/sync-usage'].includes(p)) {
    sendJson(res, { ok: true, status: true, limits: USAGE_LIMITS, expires_at: new Date(Date.now()+365*24*60*60*1000).toISOString(), isExpired: false });
    return;
  }

  if (p === R_ADMIN+'/login' && req.method === 'POST') {
    const form   = await parseFormBody(req);
    const _u=Buffer.from(form.get('user')||''), _p=Buffer.from(form.get('pass')||'');
    const _au=Buffer.from(ADMIN_USER||''), _ap=Buffer.from(ADMIN_PASS||'');
    const credOk = _u.length===_au.length && _p.length===_ap.length &&
      crypto.timingSafeEqual(_u.length?_u:Buffer.alloc(1),_au.length?_au:Buffer.alloc(1)) &&
      crypto.timingSafeEqual(_p.length?_p:Buffer.alloc(1),_ap.length?_ap:Buffer.alloc(1));
    const totpOk = verifyTOTP(TOTP_SECRET, (form.get('totp') || '').trim());
    if (credOk && totpOk) {
      const token = generateToken();
      sessions[token] = { expiresAt: new Date(Date.now() + 8*60*60*1000).toISOString() };
      res.setHeader('Set-Cookie', `zv_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Secure`);
      res.writeHead(302, { Location: R_ADMIN }); res.end();
    } else {
      const msg = credOk && !totpOk ? 'Código 2FA inválido ou expirado' : 'Usuário ou senha incorretos';
      sendHtml(res, renderAdminLogin(msg));
    }
    return;
  }

  if (p === R_ADMIN+'/logout') {
    res.setHeader('Set-Cookie', 'zv_admin=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict; Secure');
    res.writeHead(302, { Location: R_ADMIN }); res.end(); return;
  }

  if (p === R_ADMIN || p === R_ADMIN+'/') {
    if (!isAdminSession(req)) { sendHtml(res, renderAdminLogin()); return; }
    sendHtml(res, renderAdminDashboard()); return;
  }

  if (p === R_MOD+'/login' && req.method === 'POST') {
    if (MODS.length === 0) { res.writeHead(404); res.end('Not found'); return; }
    if (!checkRateLimit(ip, 'login')) {
      const mins = getRateLimitWait(ip, 'login');
      sendHtml(res, renderModLogin(`⏳ Muitas tentativas. Aguarde ${mins} minuto(s).`), 429); return;
    }
    const form        = await parseFormBody(req);
    const inputUser   = form.get('user') || '';
    const inputPass   = form.get('pass') || '';
    const inputTotp   = (form.get('totp') || '').trim();
    const matchedMod = MODS.find(m => {
      try {
        const bu = Buffer.from(m.user), bi = Buffer.from(inputUser);
        const bp = Buffer.from(m.pass), bip = Buffer.from(inputPass);
        return bu.length === bi.length && bp.length === bip.length &&
          crypto.timingSafeEqual(bu, bi) && crypto.timingSafeEqual(bp, bip);
      } catch { return false; }
    });
    const totpOk = matchedMod ? verifyTOTP(matchedMod.totp, inputTotp) : false;
    if (matchedMod && totpOk) {
      const token = generateToken();
      modSessions[token] = { expiresAt: new Date(Date.now() + 8*60*60*1000).toISOString(), modName: matchedMod.name };
      res.setHeader('Set-Cookie', `zv_mod=${token}; Path=/; HttpOnly; SameSite=Strict; Secure`);
      res.writeHead(302, { Location: R_MOD }); res.end();
    } else {
      const msg = matchedMod && !totpOk ? 'Código 2FA inválido ou expirado' : 'Usuário ou senha incorretos';
      sendHtml(res, renderModLogin(msg));
    }
    return;
  }

  if (p === R_MOD+'/logout') {
    res.setHeader('Set-Cookie', 'zv_mod=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict; Secure');
    res.writeHead(302, { Location: R_MOD }); res.end(); return;
  }

  if (p === R_MOD || p === R_MOD+'/') {
    if (MODS.length === 0) { res.writeHead(404); res.end('Not found'); return; }
    if (!isModSession(req)) { sendHtml(res, renderModLogin()); return; }
    const _mc2 = (req.headers.cookie || '').match(/zv_mod=([a-f0-9]+)/);
    const _ms2 = _mc2 ? modSessions[_mc2[1]] : null;
    sendHtml(res, renderModDashboard(_ms2 ? _ms2.modName : 'Moderador')); return;
  }

  if (p === R_MOD+'/api/keys' && req.method === 'POST') {
    if (!isModSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const _modCookie = (req.headers.cookie || '').match(/zv_mod=([a-f0-9]+)/);
    const _modSess   = _modCookie ? modSessions[_modCookie[1]] : null;
    const modName    = _modSess ? _modSess.modName : 'Moderador';
    const body = await parseBody(req);
    if (!body.label || !String(body.label).trim()) { sendJson(res, { error: 'label obrigatório' }, 400); return; }
    const code = generateCode();
    let expiresAt = null, expireDuration = null;
    const days    = parseInt(body.expireDays  || 0);
    const hours   = parseInt(body.expireHours || 0);
    if (days > 0 || hours > 0) {
      const durationMs = ((days * 1440) + (hours * 60)) * 60000;
      if (body.deferred) { expireDuration = durationMs; }
      else { expiresAt = new Date(Date.now() + durationMs).toISOString(); }
    }
    const maxUses = Math.max(1, parseInt(body.maxUses) || MAX_USES);
    keys[code] = {
      label: String(body.label).trim().slice(0, 60),
      active: true, createdAt: new Date().toISOString(),
      uses: 0, phones: [], lastUsed: null, lastIp: null, lastPhone: null,
      deviceId: null, wppVersion: null, note: '[Mod: '+modName+']',
      expiresAt, expireDuration: expireDuration || null,
      maxUses, warnCount: 0,
    };
    saveKey(code);
    sendJson(res, { ok: true, key: code }); return;
  }

  if (p === R_MOD+'/api/my-keys' && req.method === 'GET') {
    if (!isModSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const _mc = (req.headers.cookie || '').match(/zv_mod=([a-f0-9]+)/);
    const myModName = (_mc && modSessions[_mc[1]]) ? modSessions[_mc[1]].modName : null;
    if (!myModName) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    try {
      const db  = await getMongoDb();
      const doc = await db.collection('store').findOne({ _id: 'keys' });
      const dbKeys = (doc && doc.data) ? doc.data : {};
      const search = '[Mod: ' + myModName + ']';
      const myKeys = Object.entries(dbKeys)
        .filter(([, k]) => k.note && k.note.includes(search))
        .map(([code, k]) => ({
          code, label: k.label, maxUses: k.maxUses,
          active: k.active && !isKeyExpired(k),
          expiresAt: k.expiresAt || null,
          deferred: !!(k.expireDuration && !k.expiresAt),
          createdAt: k.createdAt || '', note: k.note || '',
        }))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      sendJson(res, { ok: true, keys: myKeys, modName: myModName }); return;
    } catch(e) {
      console.error('[DB] my-keys:', e.message);
      sendJson(res, { error: 'db_error' }, 500); return;
    }
  }

  if (p.startsWith(R_MOD+'/api/keys/') && p.endsWith('/note') && req.method === 'POST') {
    if (!isModSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const codeFromUrl = decodeURIComponent(p.slice((R_MOD+'/api/keys/').length, -'/note'.length));
    if (!codeFromUrl) { sendJson(res, { error: 'not found' }, 404); return; }
    if (!keys[codeFromUrl]) {
      try {
        const _db2 = await getMongoDb();
        const _doc2 = await _db2.collection('store').findOne({ _id: 'keys' });
        if (_doc2 && _doc2.data && _doc2.data[codeFromUrl]) keys[codeFromUrl] = _doc2.data[codeFromUrl];
      } catch(e) { /* continua */ }
    }
    if (!keys[codeFromUrl]) { sendJson(res, { error: 'not found' }, 404); return; }
    const _mc3 = (req.headers.cookie || '').match(/zv_mod=([a-f0-9]+)/);
    const _ms3 = _mc3 ? modSessions[_mc3[1]] : null;
    const _myName3 = _ms3 ? _ms3.modName : null;
    if (_myName3 && !((keys[codeFromUrl].note||'').includes('[Mod: '+_myName3+']'))) {
      sendJson(res, { error: 'acesso negado' }, 403); return;
    }
    const body = await parseBody(req);
    const newNote = String(body.note||'').slice(0, 400);
    const modPrefix = ((keys[codeFromUrl].note||'').match(/^\[Mod: [^\]]+\]/) || [''])[0];
    keys[codeFromUrl].note = (modPrefix + (newNote ? ' ' + newNote : '')).trim().slice(0, 500);
    saveKey(codeFromUrl);
    sendJson(res, { ok: true }); return;
  }

  function extractCode(pattern) {
    const match = p.match(pattern);
    if (!match) return null;
    const code = decodeURIComponent(match[1]);
    if (!/^[a-z0-9_\-]{1,30}$/.test(code)) return null;
    return code;
  }
  const RA = R_ADMIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  if (p === R_ADMIN+'/api/data' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const suspectKeys = Object.keys(keys).filter(code => {
      const k2 = keys[code];
      const cl2 = k2.suspectClearedAt ? new Date(k2.suspectClearedAt) : null;
      if (cl2 && (Date.now() - cl2.getTime()) < 172800000) return false;
      const recentLogs = logs.filter(l => l.keyCode === code && l.timestamp > new Date(Date.now()-86400000).toISOString());
      return new Set(recentLogs.filter(l=>l.ip).map(l=>l.ip)).size > 3;
    }).length;
    sendJson(res, {
      totalKeys:     Object.keys(keys).length,
      activeKeys:    Object.values(keys).filter(k=>k.active).length,
      warnKeys:      Object.values(keys).filter(k=>k.active && isKeyExpiringSoon(k)).length,
      suspectKeys,
      totalLogs:     logs.length,
      keysHtml:      buildKeysHtml(),
      logsHtml:      buildLogsHtml()
    }); return;
  }

  if (p === R_ADMIN+'/api/keys' && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const body = await parseBody(req);
    const code = generateCode();
    let expiresAt = null, expireDuration = null;
    if (body.expiresAt) {
      expiresAt = new Date(body.expiresAt).toISOString();
    } else {
      const days=parseInt(body.expireDays||0), hours=parseInt(body.expireHours||0), minutes=parseInt(body.expireMinutes||0);
      if (days>0 || hours>0 || minutes>0) {
        const durationMs = ((days*1440)+(hours*60)+minutes)*60000;
        if (body.deferred) { expireDuration = durationMs; }
        else { expiresAt = new Date(Date.now()+durationMs).toISOString(); }
      }
    }
    const maxUses = (body.maxUses !== undefined) ? parseInt(body.maxUses) : MAX_USES;
    keys[code] = {
      label: body.label || 'Cliente', active: true, createdAt: new Date().toISOString(),
      uses: 0, phones: [], lastUsed: null, lastIp: null, lastPhone: null,
      deviceId: null, wppVersion: null, note: '',
      expiresAt, expireDuration: expireDuration || null,
      maxUses: isNaN(maxUses) ? MAX_USES : maxUses, warnCount: 0,
      modules: { ...DEFAULT_MODULES },
    };
    saveKey(code);
    sendJson(res, { ok: true, key: code }); return;
  }

  const codeToggle = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/toggle$`));
  if (codeToggle && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!keys[codeToggle]) { sendJson(res, { error: 'not found' }, 404); return; }
    keys[codeToggle].active = !keys[codeToggle].active;
    saveKey(codeToggle);
    if (!keys[codeToggle].active) fireWebhook('key_blocked', codeToggle, 'Bloqueio manual pelo admin');
    sendJson(res, { ok: true, active: keys[codeToggle].active }); return;
  }

  const codeRenew = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/renew$`));
  if (codeRenew && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!keys[codeRenew]) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    const days=parseInt(body.days||0), hours=parseInt(body.hours||0), mins=parseInt(body.mins||0);
    if (!days && !hours && !mins) { sendJson(res, { error: 'nenhum tempo informado' }, 400); return; }
    const addMs = ((days*1440)+(hours*60)+mins)*60000;
    if (body.deferred) {
      keys[codeRenew].expiresAt      = null;
      keys[codeRenew].expireDuration = addMs;
      keys[codeRenew].activatedAt    = null;
      keys[codeRenew].active         = true;
      saveKey(codeRenew);
      await addLog({ keyCode: codeRenew, label: keys[codeRenew].label, phone: '-', ip, wppVersion: '-', action: 'renewed_deferred' });
      sendJson(res, { ok: true, deferred: true }); return;
    }
    const base  = (keys[codeRenew].expiresAt && !isKeyExpired(keys[codeRenew]))
      ? new Date(keys[codeRenew].expiresAt).getTime() : Date.now();
    keys[codeRenew].expiresAt      = new Date(base+addMs).toISOString();
    keys[codeRenew].expireDuration = null;
    keys[codeRenew].active         = true;
    saveKey(codeRenew);
    await addLog({ keyCode: codeRenew, label: keys[codeRenew].label, phone: '-', ip, wppVersion: '-', action: 'renewed' });
    sendJson(res, { ok: true, expiresAt: keys[codeRenew].expiresAt }); return;
  }

  const codeMaxUses = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/max-uses$`));
  if (codeMaxUses && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!keys[codeMaxUses]) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    const maxUses = parseInt(body.maxUses);
    if (isNaN(maxUses) || maxUses < -1) { sendJson(res, { error: 'invalid' }, 400); return; }
    keys[codeMaxUses].maxUses = maxUses;
    saveKey(codeMaxUses);
    sendJson(res, { ok: true, maxUses }); return;
  }

  const codeLabel = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/label$`));
  if (codeLabel && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!keys[codeLabel]) { sendJson(res, { error: 'not found' }, 404); return; }
    const body  = await parseBody(req);
    const label = String(body.label||'').trim().slice(0, 60);
    if (!label) { sendJson(res, { error: 'label vazio' }, 400); return; }
    keys[codeLabel].label = label;
    saveKey(codeLabel).catch(()=>{});
    sendJson(res, { ok: true, label }); return;
  }

  const codePhonesGet = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/phones$`));
  if (codePhonesGet && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!keys[codePhonesGet]) { sendJson(res, { error: 'not found' }, 404); return; }
    sendJson(res, { ok: true, phones: keys[codePhonesGet].phones || [] }); return;
  }

  const codePhonesDelete = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/phones$`));
  if (codePhonesDelete && req.method === 'DELETE') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!keys[codePhonesDelete]) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    if (body.all) {
      keys[codePhonesDelete].phones=[]; keys[codePhonesDelete].uses=0; keys[codePhonesDelete].lastPhone=null;
    } else if (body.phone) {
      keys[codePhonesDelete].phones=(keys[codePhonesDelete].phones||[]).filter(ph=>ph!==body.phone);
      keys[codePhonesDelete].uses=keys[codePhonesDelete].phones.length;
      if (keys[codePhonesDelete].lastPhone===body.phone) keys[codePhonesDelete].lastPhone=keys[codePhonesDelete].phones.at(-1)||null;
    } else { sendJson(res, { error: 'informe phone ou all:true' }, 400); return; }
    saveKey(codePhonesDelete).catch(()=>{});
    sendJson(res, { ok: true, phones: keys[codePhonesDelete].phones }); return;
  }

  const codeResetWarn = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/reset-warn$`));
  if (codeResetWarn && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!keys[codeResetWarn]) { sendJson(res, { error: 'not found' }, 404); return; }
    keys[codeResetWarn].warnCount = 0;
    saveKey(codeResetWarn);
    sendJson(res, { ok: true }); return;
  }

  const codeClearSuspect = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/clear-suspect$`));
  if (codeClearSuspect && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!keys[codeClearSuspect]) { sendJson(res, { error: 'not found' }, 404); return; }
    keys[codeClearSuspect].suspectClearedAt = new Date().toISOString();
    saveKey(codeClearSuspect);
    sendJson(res, { ok: true }); return;
  }

  const codeNote = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/note$`));
  if (codeNote && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!keys[codeNote]) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    keys[codeNote].note = String(body.note||'').slice(0, 500);
    saveKey(codeNote);
    sendJson(res, { ok: true }); return;
  }

  const codeModules = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/modules$`));
  if (codeModules && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!keys[codeModules]) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    const moduleName = String(body.module || '').trim();
    const enabled    = !!body.enabled;
    if (!AVAILABLE_MODULES.includes(moduleName)) { sendJson(res, { error: 'modulo: '+moduleName }, 400); return; }
    if (!keys[codeModules].modules) keys[codeModules].modules = { ...DEFAULT_MODULES };
    keys[codeModules].modules[moduleName] = enabled;
    saveKey(codeModules);
    sendJson(res, { ok: true, module: moduleName, enabled, modules: keys[codeModules].modules }); return;
  }

  const codeAssignMod = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/assign-mod$`));
  if (codeAssignMod && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!keys[codeAssignMod]) {
      try {
        const _dbA = await getMongoDb();
        const _docA = await _dbA.collection('store').findOne({ _id: 'keys' });
        if (_docA && _docA.data && _docA.data[codeAssignMod]) {
          keys[codeAssignMod] = _docA.data[codeAssignMod];
        }
      } catch(e) { console.error('[DB] assign-mod lookup:', e.message); }
    }
    if (!keys[codeAssignMod]) { sendJson(res, { error: 'not found' }, 404); return; }
    const body    = await parseBody(req);
    const modName = String(body.modName || '').trim().slice(0, 60);
    const k       = keys[codeAssignMod];
    let note = (k.note || '').replace(/\[Mod: [^\]]+\]\s*/g, '').trim();
    if (modName) note = '[Mod: ' + modName + ']' + (note ? ' ' + note : '');
    k.note = note.slice(0, 500);
    saveKey(codeAssignMod);
    sendJson(res, { ok: true, modName, note: k.note }); return;
  }

  const codeDelete = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)$`));
  if (codeDelete && req.method === 'DELETE') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    delete keys[codeDelete];
    await deleteKeyFromDb(codeDelete);
    sendJson(res, { ok: true }); return;
  }

  if (p === R_ADMIN+'/api/logs' && req.method === 'DELETE') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const body = await parseBody(req);
    if (body.date) { logs = logs.filter(l => !l.timestamp.startsWith(body.date)); }
    else { logs = []; }
    await saveLogs();
    sendJson(res, { ok: true, remaining: logs.length }); return;
  }

  if (p === R_ADMIN+'/api/logs' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const date = url.searchParams.get('date');
    const q    = (url.searchParams.get('q') || '').toLowerCase();
    let filtered = date ? logs.filter(l => l.timestamp.startsWith(date)) : logs;
    if (q) filtered = filtered.filter(l =>
      (l.keyCode||'').toLowerCase().includes(q) ||
      (l.ip||'').toLowerCase().includes(q) ||
      (l.phone||'').toLowerCase().includes(q) ||
      (l.label||'').toLowerCase().includes(q)
    );
    sendJson(res, { ok: true, logsHtml: buildLogsHtml(filtered) }); return;
  }

  if (p === R_ADMIN+'/api/export/csv' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const header = 'Chave,Cliente,Status,Usos,Telefone,Último IP,WPP Version,Último Acesso,Criada em,Expira em,Nota';
    const rows = Object.entries(keys).map(([code, k]) => {
      const cols = [
        code, k.label, k.active?'ATIVO':'BLOQUEADO',
        `${(k.phones||[]).length}/${k.maxUses===-1?'Ilimitado':(k.maxUses>0?k.maxUses:MAX_USES)}`,
        k.lastPhone||'', k.lastIp||'', k.wppVersion||'',
        k.lastUsed ? new Date(k.lastUsed).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : '',
        new Date(k.createdAt||Date.now()).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}),
        k.expiresAt ? new Date(k.expiresAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : 'Sem expiração',
        (k.note||'').replace(/,/g,';')
      ];
      return cols.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',');
    });
    const csv = [header, ...rows].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="zvm-chaves-${new Date().toISOString().slice(0,10)}.csv"`);
    res.writeHead(200); res.end('\uFEFF' + csv); return;
  }

  if (p === R_ANALYTICS+'/login' && req.method === 'POST') {
    if (!ANALYTICS_PASS) { res.writeHead(404); res.end('Not found'); return; }
    if (!checkRateLimit(ip, 'login')) {
      const mins = getRateLimitWait(ip, 'login');
      sendHtml(res, renderAnalyticsLogin(`⏳ Muitas tentativas. Aguarde ${mins} minuto(s).`), 429); return;
    }
    const form = await parseFormBody(req);
    const _anp=Buffer.from(form.get('pass')||''), _anap=Buffer.from(ANALYTICS_PASS||'');
    if (_anp.length===_anap.length && crypto.timingSafeEqual(_anp.length?_anp:Buffer.alloc(1),_anap.length?_anap:Buffer.alloc(1)) && ANALYTICS_PASS) {
      const token = generateToken();
      analyticsSessions[token] = { expiresAt: new Date(Date.now() + 8*60*60*1000).toISOString() };
      res.setHeader('Set-Cookie', `zv_an=${token}; Path=/; HttpOnly; SameSite=Strict; Secure`);
      res.writeHead(302, { Location: R_ANALYTICS }); res.end();
    } else {
      sendHtml(res, renderAnalyticsLogin('Senha incorreta.'));
    }
    return;
  }

  if (p === R_ANALYTICS+'/logout') {
    res.setHeader('Set-Cookie', 'zv_an=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict; Secure');
    res.writeHead(302, { Location: R_ANALYTICS }); res.end(); return;
  }

  if ((p === R_ANALYTICS || p === R_ANALYTICS+'/') && req.method === 'GET') {
    if (!ANALYTICS_PASS) { res.writeHead(404); res.end('Not found'); return; }
    if (!isAnalyticsSession(req)) {
      clearAnalyticsCookie(res); // limpa cookie inválido (ex: após reinício do servidor)
      sendHtml(res, renderAnalyticsLogin()); return;
    }
    sendHtml(res, await renderAnalyticsDashboard()); return;
  }

  if (p === R_ANALYTICS+'/export/csv' && req.method === 'GET') {
    if (!isAnalyticsSession(req)) { res.writeHead(302, { Location: R_ANALYTICS }); res.end(); return; }
    const payments = await getPayments({ limit: 10000 });
    const header = 'Data,Cliente,Email,Telefone,Produto,Valor,Status,Chave,Método';
    const rows = payments.map(p => {
      const fmtDate = iso => iso ? new Date(iso).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : '';
      return [
        fmtDate(p.paidAt), p.clientName, p.clientEmail, p.clientPhone,
        p.productName, (p.amount||0).toFixed(2).replace('.',','),
        p.approved ? 'APROVADO' : 'REJEITADO',
        p.keyCode || '', p.paymentMethod || ''
      ].map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',');
    });
    const csv = [header, ...rows].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="zvm-pagamentos-${new Date().toISOString().slice(0,10)}.csv"`);
    res.writeHead(200); res.end('\uFEFF' + csv); return;
  }

  if (p === R_ANALYTICS+'/api/stats' && req.method === 'GET') {
    if (!isAnalyticsSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const stats = await getPaymentStats();
    sendJson(res, stats || {}); return;
  }

  if (p === '/payt/webhook' && req.method === 'POST') {
    const rawBody = await new Promise(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>r(b));});

    let payload;
    try { payload = JSON.parse(rawBody); }
    catch { try { payload = Object.fromEntries(new URLSearchParams(rawBody).entries()); } catch { res.writeHead(400); res.end('Bad Request'); return; } }

    if (PAYT_SECRET) {
      const headerToken = req.headers['x-payt-token'] || req.headers['x-webhook-token'] || '';
      const bodyKey     = payload.integration_key || '';
      const validHeader = !headerToken || headerToken === PAYT_SECRET;
      const validBody   = !bodyKey     || bodyKey   === PAYT_SECRET;
      if (!validHeader || !validBody) {
        console.warn('[PAYT] Token/integration_key inválido — ignorado');
        res.writeHead(401); res.end('Unauthorized'); return;
      }
    }

    if (payload.test === true) {
      console.log('[PAYT] Postback de teste — ignorado');
      res.writeHead(200); res.end('test_ignored'); return;
    }

    const status   = String(payload.status || payload.payment_status || payload.sale_status || '').toLowerCase();
    const APPROVED = ['venda_paga','approved','paid','completed','finished','aprovada','finalizada','active','confirmed'];
    const approved = APPROVED.some(s => status === s || status.includes(s));

    const txId = String(payload.transaction_id || payload.sale_id || payload.cart_id || payload.id || '').trim();

    const customer    = payload.customer || payload.buyer || payload.client || {};
    const clientName  = customer.name        || customer.full_name     || payload.customer_name  || payload.buyer_name || 'Cliente';
    const clientEmail = customer.email       || payload.customer_email || payload.buyer_email    || payload.email      || '';
    const clientPhone = customer.phone       || customer.cellphone     || customer.phone_number  || payload.customer_phone || '';

    let productNameRaw = '-';
    let amount = 0;
    if (Array.isArray(payload.products) && payload.products.length > 0) {
      productNameRaw = payload.products.map(pr => pr.name || pr.title || '').filter(Boolean).join(' + ') || '-';
      amount = payload.products.reduce((s, pr) => s + (parseFloat(String(pr.price||pr.value||0).replace(',','.')) || 0), 0);
    }
    if (productNameRaw === '-') {
      const offer = payload.offer || payload.product || {};
      productNameRaw = offer.name || offer.title || payload.product_name || payload.offer_name || payload.plan_name || '-';
    }
    if (!amount) {
      const raw = payload.amount || payload.value || payload.price || payload.sale_amount || payload.total || 0;
      amount = parseFloat(String(raw).replace(',','.')) || 0;
    }
    const paymentMethod  = payload.payment_method || payload.charge_type || payload.method || payload.payment_type || '-';
    const productNameLow = productNameRaw.toLowerCase();

    if (!approved) {
      console.log('[PAYT] Status nao aprovado:', status, '| TX:', txId);
      if (txId) savePayment({ txId, status: status||'unknown', approved: false, clientName, clientEmail, clientPhone, productName: productNameRaw, amount, paymentMethod, keyCode: null, paidAt: new Date().toISOString(), rawStatus: status }).catch(()=>{});
      res.writeHead(200); res.end('ignored'); return;
    }

    if (txId) {
      if (Object.values(keys).some(k => k.note && (k.note.includes('payt_tx:'+txId) || k.note.includes('renovado_payt_tx:'+txId)))) {
        console.log('[PAYT] Transacao ja processada (memoria):', txId);
        res.writeHead(200); res.end('ok'); return;
      }
      try {
        const _db = await getMongoDb();
        const _ex = await _db.collection('payments').findOne({ txId, approved: true });
        if (_ex) { console.log('[PAYT] Transacao ja no banco:', txId); res.writeHead(200); res.end('ok'); return; }
      } catch(e) { console.warn('[PAYT] Erro idempotencia:', e.message); }
    }

    let maxUses = 3;
    if      (productNameLow.match(/\b1\b|individual|solo|basico|starter/)) maxUses = 1;
    else if (productNameLow.match(/\b5\b|multi|team|equipe|avancado/))     maxUses = 5;
    else if (productNameLow.match(/\b3\b|trio|standard|padrao/))           maxUses = 3;

    let existingCode = null;
    if (clientEmail) {
      existingCode = Object.keys(keys).find(c => {
        const emailMatch = (keys[c].note||'').match(/Email: ([^\s|]+)/);
        return emailMatch && emailMatch[1].toLowerCase() === clientEmail.toLowerCase() && keys[c].active;
      });
    }

    const now        = new Date();
    const durationMs = 31 * 24 * 60 * 60 * 1000;

    if (existingCode) {
      const k    = keys[existingCode];
      const base = (k.expiresAt && new Date(k.expiresAt) > now) ? new Date(k.expiresAt) : now;
      k.expiresAt = new Date(base.getTime() + durationMs).toISOString();
      k.active    = true;
      k.note      = k.note + (txId ? ' | renovado_payt_tx:'+txId : ' | renovado');
      saveKey(existingCode);
      await savePayment({ txId: txId||existingCode, status:'approved', approved:true, clientName, clientEmail, clientPhone, productName:productNameRaw, amount, paymentMethod, keyCode:existingCode, maxUses, renewed:true, paidAt:now.toISOString(), rawStatus:status });
      console.log('[PAYT] Chave renovada:', existingCode, '| Nova exp:', k.expiresAt);
      res.writeHead(200); res.end('ok'); return;
    }

    const code    = generateCode();
    const expires = new Date(now.getTime() + durationMs);
    keys[code] = { label:'PAYT - '+clientName, active:true, phones:[], uses:0, maxUses, expiresAt:expires.toISOString(), expireDuration:durationMs, createdAt:now.toISOString(), lastUsed:null, lastIp:null, lastPhone:null, deviceId:null, wppVersion:null, warnCount:0, note:'Pedido automatico Payt | Email: '+clientEmail+(txId?' | payt_tx:'+txId:'') };
    saveKey(code);
    await savePayment({ txId:txId||code, status:'approved', approved:true, clientName, clientEmail, clientPhone, productName:productNameRaw, amount, paymentMethod, keyCode:code, maxUses, renewed:false, paidAt:now.toISOString(), rawStatus:status });
    console.log('[PAYT] Chave criada:', code, '| Cliente:', clientName, '| Usos:', maxUses, '| Valor: R$', amount.toFixed(2));
    res.writeHead(200); res.end('ok'); return;
  }

  if (p === '/client/status' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'api')) { sendJson(res, { error: 'rate_limited' }, 429); return; }
    const body = await parseBody(req);
    const code = (body.key || '').trim().toLowerCase().slice(0, 20);
    if (!code) { sendJson(res, { error: 'not_found' }, 404); return; }

    let k = keys[code];
    if (!k) {
      try {
        const db = await getMongoDb();
        const doc = await db.collection('store').findOne({ _id: 'keys' });
        if (doc && doc.data && doc.data[code]) {
          k = doc.data[code];
          keys[code] = k; // atualizar memória local
        }
      } catch(e) { console.error('[DB] Erro ao buscar chave:', e.message); }
    }
    if (!k) { sendJson(res, { error: 'not_found' }, 404); return; }

    sendJson(res, {
      label:       k.label || 'Cliente',
      active:      k.active && !isKeyExpired(k),
      expired:     isKeyExpired(k),
      expiresAt:   k.expiresAt || null,
      activatedAt: k.activatedAt || null,
      lastUsed:    k.lastUsed || null,
      phones:      (k.phones || []).length,
      phoneList:   (k.phones || []).map((ph, i) => ({ idx: i, display: ph.replace(/(\d+)(\d{4})$/, '••••$2') })),
      maxUses:     k.maxUses === -1 ? null : (k.maxUses > 0 ? k.maxUses : MAX_USES),
      hoursLeft:   hoursUntilExpiry(k),
      deferred:    !!(k.expireDuration && !k.expiresAt),
      warnCount:   k.warnCount || 0,
    }); return;
  }

  if (p === '/client/remove-phone' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'api')) { sendJson(res, { error: 'rate_limited' }, 429); return; }
    const body    = await parseBody(req);
    const keyCode = (body.key||'').trim().toLowerCase().slice(0, 20);
    const phoneIdx = body.phoneIdx != null ? parseInt(body.phoneIdx) : -1;
    const phoneTxt = (body.phone||'').trim();
    if (!keyCode) { sendJson(res, { error: 'not_found' }, 404); return; }
    if (phoneIdx < 0 && !phoneTxt) { sendJson(res, { error: 'phone obrigatorio' }, 400); return; }
    if (!keys[keyCode]) {
      try {
        const db  = await getMongoDb();
        const doc = await db.collection('store').findOne({ _id: 'keys' });
        if (doc && doc.data && doc.data[keyCode]) {
          keys[keyCode] = doc.data[keyCode];
        }
      } catch(e) {
        sendJson(res, { error: 'db_error' }, 503); return;
      }
    }
    if (!keys[keyCode]) { sendJson(res, { error: 'not_found' }, 404); return; }
    const phones = keys[keyCode].phones || [];
    let phone;
    if (phoneIdx >= 0 && phoneIdx < phones.length) {
      phone = phones[phoneIdx];
    } else if (phoneTxt) {
      phone = phones.find(p => p === phoneTxt || p.endsWith(phoneTxt.replace(/[^0-9]/g,'')));
    }
    if (!phone) { sendJson(res, { error: 'numero nao encontrado' }, 404); return; }
    keys[keyCode].phones  = phones.filter(p => p !== phone);
    keys[keyCode].uses    = keys[keyCode].phones.length;
    if (keys[keyCode].lastPhone === phone) keys[keyCode].lastPhone = keys[keyCode].phones.at(-1) || null;
    saveKey(keyCode).catch(()=>{});
    sendJson(res, { ok: true, phones: keys[keyCode].phones }); return;
  }

  if (req.method === 'GET' && (p === '/dashboard/backup-fixer' || p === '/dashboard/converter')) {
    res.writeHead(302, { Location: 'https://app.zapvoice.com.br' + p }); res.end(); return;
  }

  if (p === '/faq' && req.method === 'GET') {
    sendHtml(res, renderFaqPage()); return;
  }

  if (p === '/planos' && req.method === 'GET') {
    sendHtml(res, renderPlanosPage()); return;
  }

  if (p === '/privacidade' && req.method === 'GET') {
    sendHtml(res, renderPrivacyPage()); return;
  }

  const CLIENT_PATHS = ['/', '/plans/manage', '/plans/new', '/dashboard/chaves'];
  if (req.method === 'GET' && (CLIENT_PATHS.includes(p) || p.startsWith('/unauthorized') || p.startsWith('/funnels') || p.startsWith('/labels'))) {
    sendHtml(res, renderClientPortal()); return;
  }

  sendJson(res, { ok: true });
}

async function gracefulShutdown(signal) {
  console.log(`[${signal}] Encerrando servidor graciosamente...`);
  try {
    if (_mongoClient) { await _mongoClient.close(); console.log('[SHUTDOWN] MongoDB desconectado'); }
  } catch(e) { console.error('[SHUTDOWN] Erro ao fechar MongoDB:', e.message); }
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
(async () => {
  try {
    const loaded = await loadDb();
    keys = loaded.keys || {};
    logs = loaded.logs || [];
    serverReady = true;

    console.log(`✅ zvm-lr1290 v8 — porta ${PORT}`);
    console.log(`🍃 MongoDB: conectado | Chaves: ${Object.keys(keys).length} | Logs: ${logs.length}`);
    console.log(`🔐 HMAC: ${APP_SECRET ? 'ATIVO' : '⚠ INATIVO'}`);
    console.log(`🔑 2FA:  ${TOTP_SECRET ? 'ATIVO' : '⚠ INATIVO'}`);
    console.log(`💳 Payt: ${PAYT_SECRET ? 'ATIVO' : '⚠ INATIVO'}`);
    console.log(`🔑 Admin: ${R_ADMIN} | User: ${ADMIN_USER}`);
    console.log(`👮 Mod:   ${MODS.length > 0 ? R_MOD+' | '+MODS.length+' mod(s): '+MODS.map(m=>m.name).join(', ') : '⚠ inativo — defina MOD_USER e MOD_PASS'}`);
    console.log(`📊 Analytics: ${ANALYTICS_PASS ? 'ATIVO' : '⚠ INATIVO'}`);
    console.log(`🌐 Extension: ${R_EXT}/v3/key`);
    console.log(`📊 Webhook: ${WEBHOOK_URL || 'não configurado'}`);
    console.log(`🗂  Retenção de logs: ${LOG_RETENTION_DAYS} dias (LGPD) | Máx em memória: ${LOG_MAX}`);

    const safeHandler = (req, res) => {
      handleRequest(req, res).catch(err => {
        console.error(`[ERRO] ${req.method} ${req.url.split('?')[0]}:`, err.message||err);
        if (!res.headersSent) { res.writeHead(500); res.end('Internal Server Error'); }
      });
    };

    process.on('uncaughtException',  err => console.error('[uncaughtException]', err));
    process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));

    const server = http.createServer(safeHandler);
    server.keepAliveTimeout = 65000; // acima dos 60s do LB do Render
    server.headersTimeout   = 66000;
    server.listen(PORT, () => {
      console.log(`🚀 Servidor ouvindo na porta ${PORT}`);
      setInterval(() => {
        const req = http.request(
          { hostname: 'localhost', port: PORT, path: '/health', method: 'GET' },
          res => { res.resume(); }
        );
        req.on('error', () => {});
        req.end();
      }, 10 * 60 * 1000); // 600 000 ms = 10 min
    });
  } catch (e) {
    console.error('❌ Falha ao iniciar:', e.message);
    process.exit(1);
  }
})();
