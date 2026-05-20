'use strict';
const http   = require('http');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

// ─────────────────────────────────────────────
// VARIÁVEIS DE AMBIENTE
// ─────────────────────────────────────────────
const PORT         = process.env.PORT         || 3000;
const ADMIN_USER   = process.env.ADMIN_USER;
const ADMIN_PASS   = process.env.ADMIN_PASS;
// ── Moderadores (5 slots independentes) ──
const MODS = [
  { user: process.env.MOD_USER  || '', pass: process.env.MOD_PASS  || '', totp: process.env.MOD_TOTP  || '', name: 'Moderador'   },
  { user: process.env.MOD2_USER || '', pass: process.env.MOD2_PASS || '', totp: process.env.MOD2_TOTP || '', name: 'Simplifique' },
  { user: process.env.MOD3_USER || '', pass: process.env.MOD3_PASS || '', totp: process.env.MOD3_TOTP || '', name: 'BS'          },
  { user: process.env.MOD4_USER || '', pass: process.env.MOD4_PASS || '', totp: process.env.MOD4_TOTP || '', name: 'Acaraí'      },
  { user: process.env.MOD5_USER || '', pass: process.env.MOD5_PASS || '', totp: process.env.MOD5_TOTP || '', name: 'Darley'      },
  { user: process.env.MOD6_USER || '', pass: process.env.MOD6_PASS || '', totp: process.env.MOD6_TOTP || '', name: 'Letícia'     },
].filter(m => m.user && m.pass);
// Compatibilidade retroativa — MOD_USER/PASS ainda funciona como slot 1
const MOD_USER = process.env.MOD_USER || '';
const MOD_PASS = process.env.MOD_PASS || '';
const MOD_TOTP = process.env.MOD_TOTP || '';
const PAYT_SECRET  = process.env.PAYT_SECRET  || '';   // renomeado de CAKTO_SECRET
const MONGODB_URI  = process.env.MONGODB_URI  || '';
const APP_SECRET   = process.env.APP_SECRET   || '';
const TOTP_SECRET  = process.env.TOTP_SECRET  || '';
const WEBHOOK_URL  = process.env.WEBHOOK_URL  || '';
const EXPIRY_WARN_HOURS = parseInt(process.env.EXPIRY_WARN_HOURS || '48');
// LGPD: retenção de logs em dias (padrão 90)
const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || '90');
// Máximo de logs em memória
const LOG_MAX = Math.min(parseInt(process.env.LOG_MAX || '500'), 2000);

if (!ADMIN_USER || !ADMIN_PASS) {
  console.error('❌ ERRO CRÍTICO: Defina ADMIN_USER e ADMIN_PASS nas variáveis de ambiente.');
  process.exit(1);
}
if (!MONGODB_URI) {
  console.error('❌ ERRO CRÍTICO: Defina MONGODB_URI nas variáveis de ambiente.');
  process.exit(1);
}

// ─────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────
const FULL_PERMISSIONS = [
  'create_flow','massive_dispatching','schedule_item',
  'send_flow','send_funnel','send_trigger'
];
const USAGE_LIMITS = {
  audio:        { sent:0, max:-1 }, bulkMessages: { sent:0, max:-1 },
  document:     { sent:0, max:-1 }, flow:         { sent:0, max:-1 },
  funnel:       { sent:0, max:-1 }, media:        { sent:0, max:-1 },
  message:      { sent:0, max:-1 }, scheduleItem: { sent:0, max:-1 }
};
const MAX_USES = 3;

// ─────────────────────────────────────────────
// MONGODB
// ─────────────────────────────────────────────
let _mongoClient = null;
let _mongoDb     = null;

async function getMongoDb() {
  if (_mongoDb) return _mongoDb;
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

// Salva UMA chave específica — granular, não reescreve tudo
async function saveKey(code) {
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
}

// Remove uma chave do banco
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

// Salva apenas os logs — com LGPD (remove entradas mais antigas que LOG_RETENTION_DAYS)
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

// ─────────────────────────────────────────────
// ESTADO GLOBAL
// ─────────────────────────────────────────────
let keys        = {};
let logs        = [];
let sessions    = {};
let modSessions = {};   // sessões de moderação separadas do admin
let extSessions = {};
let serverReady = false;

// ─────────────────────────────────────────────
// SEGURANÇA — HMAC
// ─────────────────────────────────────────────
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

function verifyExtToken(token, keyCode) {
  if (!token) return false;
  const s = extSessions[token];
  if (!s) return false;
  if (new Date() > new Date(s.expiresAt)) { delete extSessions[token]; return false; }
  if (keyCode && s.keyCode !== keyCode) return false;
  return true;
}

// ─────────────────────────────────────────────
// 2FA TOTP
// ─────────────────────────────────────────────
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
  for (const w of [-1, 0, 1]) {
    if (generateTOTP(secret, w) === token) return true;
  }
  return false;
}

// ─────────────────────────────────────────────
// ROTAS DERIVADAS DO APP_SECRET
// ─────────────────────────────────────────────
function deriveSlug(seed) {
  if (!APP_SECRET) return null;
  return crypto.createHmac('sha256', APP_SECRET).update(seed).digest('hex').slice(0, 14);
}
const _slugAdmin = deriveSlug('admin-panel');
const _slugMod   = deriveSlug('mod-panel');
const R_ADMIN    = _slugAdmin ? '/' + _slugAdmin : '/admin';
const R_MOD      = _slugMod  ? '/' + _slugMod   : '/mod';
const R_EXT      = '/extension';

// ─────────────────────────────────────────────
// RATE LIMITING
// ─────────────────────────────────────────────
const rateLimitMap = new Map();
const RL_CONFIG = {
  login: { max: 5,  windowMs: 60000,     blockMs: 10 * 60000 },
  api:   { max: 30, windowMs: 60000,     blockMs:  2 * 60000 },
};

function checkRateLimit(ip, type = 'api') {
  const now = Date.now();
  const key = ip + ':' + type;
  const cfg = RL_CONFIG[type] || RL_CONFIG.api;
  let e = rateLimitMap.get(key);
  if (!e) {
    e = { count: 0, resetAt: now + cfg.windowMs, blockedUntil: 0 };
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

// Limpeza periódica do rate limit map
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of rateLimitMap.entries())
    if (now > e.blockedUntil && now > e.resetAt) rateLimitMap.delete(k);
}, 15 * 60000);

// Limpeza periódica de sessões admin, mod e ext expiradas
setInterval(() => {
  const now = new Date();
  for (const [k, s] of Object.entries(sessions))
    if (now > new Date(s.expiresAt)) delete sessions[k];
  for (const [k, s] of Object.entries(modSessions))
    if (now > new Date(s.expiresAt)) delete modSessions[k];
  for (const [k, s] of Object.entries(extSessions))
    if (now > new Date(s.expiresAt)) delete extSessions[k];
}, 30 * 60000);

// ─────────────────────────────────────────────
// WEBHOOK
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function generateCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const seg = () => Array.from({length:5}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  return `zv-${seg()}-${seg()}-${seg()}`;
}
function generateToken() { return crypto.randomBytes(32).toString('hex'); }

function getAuthData(keyCode, userName) {
  return {
    numberWarning: false, segments: [],
    isLoggedIn: true, isPremium: true,
    data: {
      key: keyCode, keyId: `id-${keyCode}`, ownerId: 'zv-owner', managerId: 'zv-manager',
      permissions: FULL_PERMISSIONS,
      username: userName || keys[keyCode]?.label || '',
      paymentUrl: null, marketplace: 'premium', email: 'cliente@zapvoice.com.br',
      planName: 'Pro', plan_id: 'ZV_PRO', isLoggedIn: true, isPremium: true, isBasicPlan: false
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
  if (!s) return false;
  if (new Date() > new Date(s.expiresAt)) { delete modSessions[match[1]]; return false; }
  return true;
}

function parseBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({}); } });
  });
}

function parseFormBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => resolve(new URLSearchParams(b)));
  });
}

function sendJson(res, data, status = 200) {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(status); res.end(JSON.stringify(data));
}

function sendHtml(res, html, status = 200) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.writeHead(status); res.end(html);
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─────────────────────────────────────────────
// LOG COM DEDUP + LGPD
// ─────────────────────────────────────────────
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
  // Limite em memória + LGPD
  if (logs.length > LOG_MAX) logs = logs.slice(0, LOG_MAX);
  await saveLogs();
}

// ─────────────────────────────────────────────
// CANVAS BACKGROUND (shared)
// ─────────────────────────────────────────────
const CANVAS_BG = `<canvas id="_cvs" style="position:fixed;inset:0;z-index:0;pointer-events:none"></canvas>
<script>(function(){var c=document.getElementById('_cvs'),ctx=c.getContext('2d');function resize(){c.width=window.innerWidth;c.height=window.innerHeight;}resize();window.addEventListener('resize',resize);var pts=Array.from({length:60},function(){return{x:Math.random()*c.width,y:Math.random()*c.height,vx:(Math.random()-.5)*.4,vy:(Math.random()-.5)*.4,r:Math.random()*2+.5};});function draw(){ctx.clearRect(0,0,c.width,c.height);pts.forEach(function(p){p.x+=p.vx;p.y+=p.vy;if(p.x<0||p.x>c.width)p.vx*=-1;if(p.y<0||p.y>c.height)p.vy*=-1;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle='rgba(124,58,237,0.5)';ctx.fill();});for(var i=0;i<pts.length;i++){for(var j=i+1;j<pts.length;j++){var dx=pts[i].x-pts[j].x,dy=pts[i].y-pts[j].y,d=Math.sqrt(dx*dx+dy*dy);if(d<130){ctx.beginPath();ctx.moveTo(pts[i].x,pts[i].y);ctx.lineTo(pts[j].x,pts[j].y);ctx.strokeStyle='rgba(124,58,237,'+(0.12*(1-d/130))+')';ctx.lineWidth=.7;ctx.stroke();}}}requestAnimationFrame(draw);}draw();})();</script>`;

// ─────────────────────────────────────────────
// PÁGINA: LOGIN DO MODERADOR
// ─────────────────────────────────────────────
function renderModLogin(error = '') {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM - LR1290 — Moderação</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3ELR%3C/text%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0f;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Space Mono',monospace;overflow:hidden}
.card{background:#111118;border:1px solid #1e1e2e;border-radius:18px;padding:40px 36px;width:360px;position:relative;z-index:1;box-shadow:0 0 40px rgba(79,142,247,0.12)}
.logo{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:#4f8ef7;margin-bottom:4px;text-align:center}
.sub{color:#6b6b8a;font-size:10px;letter-spacing:3px;text-transform:uppercase;margin-bottom:24px;text-align:center}
.badge{display:inline-block;background:#4f8ef712;border:1px solid #4f8ef730;color:#4f8ef7;font-size:9px;letter-spacing:2px;text-transform:uppercase;padding:3px 10px;border-radius:20px;margin-bottom:20px;font-family:'Syne',sans-serif;display:block;text-align:center}
label{display:block;font-size:10px;letter-spacing:2px;color:#6b6b8a;text-transform:uppercase;margin-bottom:7px}
input{width:100%;padding:11px 14px;background:#0a0a0f;border:1px solid #1e1e2e;border-radius:8px;color:#e2e2f0;font-family:'Space Mono',monospace;font-size:13px;outline:none;margin-bottom:16px;transition:border .2s}
input:focus{border-color:#4f8ef7}
.btn{width:100%;padding:12px;background:#4f8ef7;border:none;border-radius:8px;color:#000;font-family:'Syne',sans-serif;font-weight:700;font-size:14px;cursor:pointer;transition:opacity .2s}
.btn:hover{opacity:.85}
.err{background:#ff475715;border:1px solid #ff4757;border-radius:6px;color:#ff4757;padding:9px 12px;font-size:12px;margin-bottom:16px}
</style></head><body>
<div class="card">
  <div class="logo">⚡ ZVM - LR1290</div>
  <div class="sub">Painel de Moderação</div>
  <div class="badge">👮 Acesso Moderador</div>
  ${error ? `<div class="err">${escHtml(error)}</div>` : ''}
  <form method="POST" action="${R_MOD}/login">
    <label>Usuário</label><input type="text" name="user" autocomplete="off">
    <label>Senha</label><input type="password" name="pass">
    ${MOD_TOTP ? `<label>Código 2FA</label><input type="text" name="totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" autocomplete="one-time-code" style="letter-spacing:4px;font-size:18px;text-align:center">` : ''}
    <button type="submit" class="btn">Entrar</button>
  </form>
</div>
${CANVAS_BG}</body></html>`;
}

// ─────────────────────────────────────────────
// PAINEL: MODERADOR
// ─────────────────────────────────────────────
function renderModDashboard(modName = 'Moderador') {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM - LR1290 — Moderação</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3ELR%3C/text%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --blue:#4f8ef7;--dark:#080810;--card:#0f0f1a;--card2:#13131f;
  --border:#1c1c2e;--border2:#252538;--text:#e2e2f0;--muted:#5a5a7a;
  --red:#ff4757;--green:#00ff87;--radius:10px;--radius-sm:6px;
}
body{background:var(--dark);color:var(--text);font-family:'Space Mono',monospace;min-height:100vh;overflow-x:hidden}
header{display:flex;align-items:center;justify-content:space-between;padding:12px 24px;border-bottom:1px solid var(--border);background:var(--card);position:sticky;top:0;z-index:50;box-shadow:0 2px 20px #00000040}
.logo{font-family:'Syne',sans-serif;font-size:18px;font-weight:800;color:var(--blue);display:flex;align-items:center;gap:8px}
.badge-mod{background:#4f8ef712;border:1px solid #4f8ef730;color:var(--blue);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;padding:3px 10px;border-radius:20px;font-family:'Syne',sans-serif}
.hright{display:flex;align-items:center;gap:10px}
a.out{color:var(--muted);font-size:11px;text-decoration:none;padding:6px 12px;border:1px solid var(--border2);border-radius:var(--radius-sm);transition:all .2s}
a.out:hover{color:var(--red);border-color:var(--red)}
main{padding:28px 24px;max-width:900px;margin:0 auto}

/* Stats */
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:32px}
.sc{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px 22px;position:relative;overflow:hidden;transition:border-color .2s}
.sc:hover{border-color:var(--border2)}
.sc-icon{position:absolute;right:14px;top:14px;font-size:22px;opacity:.12}
.sc .n{font-family:'Syne',sans-serif;font-size:34px;font-weight:800;color:var(--blue);line-height:1}
.sc .l{color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:1.5px;margin-top:6px}

/* Notice */
.notice{background:#4f8ef708;border:1px solid #4f8ef720;border-radius:var(--radius);padding:14px 18px;margin-bottom:28px;display:flex;align-items:flex-start;gap:12px;font-size:11px;color:var(--muted);line-height:1.7}
.notice strong{color:var(--blue)}

/* Form */
.sec{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:20px}
.sh{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);background:var(--card2);flex-wrap:wrap;gap:10px}
.st{font-family:'Syne',sans-serif;font-weight:700;font-size:13px;color:var(--blue);display:flex;align-items:center;gap:6px}
.form-body{padding:20px 18px}
.form-grid{display:grid;grid-template-columns:1fr auto auto auto auto auto;gap:8px;align-items:end;flex-wrap:wrap}
.fi{display:flex;flex-direction:column;gap:4px}
.fi label{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1px}
.fi input{padding:8px 11px;background:var(--dark);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:'Space Mono',monospace;font-size:12px;outline:none;transition:border .18s}
.fi input:focus{border-color:var(--blue)}
.fi input::placeholder{color:var(--muted)}
.fi-wide{grid-column:1}
.fi-num input{width:70px;text-align:center}
.btn{padding:9px 18px;background:var(--blue);color:#000;border:none;border-radius:var(--radius-sm);font-family:'Syne',sans-serif;font-weight:700;font-size:12px;cursor:pointer;transition:all .18s;white-space:nowrap;align-self:end}
.btn:hover{opacity:.85;transform:translateY(-1px)}
.btn:active{transform:translateY(0)}

/* Resultado */
.result-box{display:none;margin-top:18px;background:var(--dark);border:1px solid #4f8ef730;border-radius:var(--radius);padding:18px 20px}
.result-box.show{display:block}
.result-label{font-size:10px;color:var(--muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px}
.result-key{font-family:'Space Mono',monospace;font-size:18px;color:var(--blue);letter-spacing:2px;word-break:break-all;margin-bottom:14px}
.result-meta{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
.result-tag{background:#4f8ef712;border:1px solid #4f8ef720;color:var(--blue);font-size:10px;padding:3px 10px;border-radius:20px}
.copy-btn{padding:8px 16px;background:#4f8ef718;color:var(--blue);border:1px solid #4f8ef730;border-radius:var(--radius-sm);font-family:'Syne',sans-serif;font-weight:700;font-size:11px;cursor:pointer;transition:all .2s}
.copy-btn:hover{background:#4f8ef728;border-color:var(--blue)}

/* Histórico */
.hist-table{width:100%;border-collapse:collapse;font-size:11px}
.hist-table th{padding:8px 12px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);border-bottom:1px solid var(--border);background:var(--card2);font-weight:400}
.hist-table td{padding:10px 12px;border-bottom:1px solid #14141f;vertical-align:middle}
.hist-table tr:last-child td{border-bottom:none}
.hist-table tr:hover td{background:#ffffff02}
.kc{color:var(--blue);font-size:11px;letter-spacing:.3px}
.badge{padding:2px 7px;border-radius:3px;font-size:9px;font-weight:700;letter-spacing:.8px;text-transform:uppercase}
.bon{background:#00ff8718;color:var(--green);border:1px solid #00ff8730}
.bdef{background:#4f8ef718;color:var(--blue);border:1px solid #4f8ef730}
.empty{text-align:center;color:var(--muted);padding:30px;font-size:11px}

.toast{position:fixed;bottom:20px;right:20px;padding:11px 18px;border-radius:var(--radius);font-family:'Syne',sans-serif;font-weight:700;font-size:12px;display:none;z-index:999999;box-shadow:0 6px 30px #00000070}

@media(max-width:700px){.form-grid{grid-template-columns:1fr 1fr};.stats{grid-template-columns:1fr}}
</style>
</head>
<body>
<header>
  <div class="logo">⚡ ZVM - LR1290 <span class="badge-mod">${modName}</span></div>
  <div class="hright">
    <a href="${R_MOD}/logout" class="out">↩ Sair</a>
  </div>
</header>

<main>
  <div class="notice">
    <span style="font-size:16px;flex-shrink:0">🔒</span>
    <span><strong>Acesso restrito.</strong> Este painel permite apenas a criação de novas chaves. Dados de clientes, telefones, IPs e logs de acesso não estão disponíveis para moderadores.</span>
  </div>

  <div class="sec">
    <div class="sh">
      <div class="st">🔑 Criar Nova Chave</div>
    </div>
    <div class="form-body">
      <div class="form-grid">
        <div class="fi fi-wide">
          <label>Nome do Cliente</label>
          <input type="text" id="nlabel" placeholder="Ex: João Silva" autocomplete="off">
        </div>
        <div class="fi fi-num">
          <label>Dias</label>
          <input type="number" id="ndays" placeholder="0" min="0">
        </div>
        <div class="fi fi-num">
          <label>Horas</label>
          <input type="number" id="nhours" placeholder="0" min="0">
        </div>
        <div class="fi fi-num">
          <label>Usos</label>
          <input type="number" id="nuses" placeholder="3" min="1" title="Máx. de dispositivos simultâneos">
        </div>
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
      <button class="btn" style="background:#4f8ef718;color:var(--blue);border:1px solid #4f8ef730;font-size:11px;padding:6px 12px" onclick="loadHistory()">↻ Atualizar</button>
    </div>
    <div style="overflow-x:auto">
      <table class="hist-table">
        <thead><tr>
          <th>Chave</th>
          <th>Cliente</th>
          <th>Usos</th>
          <th>Validade</th>
          <th>Criada em</th>
          <th>Status</th>
        </tr></thead>
        <tbody id="hist-body"><tr><td colspan="6" class="empty">Clique em Atualizar para carregar</td></tr></tbody>
      </table>
    </div>
  </div>
</main>

<div class="toast" id="toast"></div>

<script>
const _RM = '${R_MOD}';

function toast(msg, ok=true){
  const t=document.getElementById('toast');
  t.textContent=msg;t.style.background=ok?'var(--blue)':'var(--red)';
  t.style.color='#fff';t.style.display='block';
  setTimeout(()=>t.style.display='none',3200);
}

async function createKey(){
  const label=document.getElementById('nlabel').value.trim();
  const days=parseInt(document.getElementById('ndays').value||0);
  const hours=parseInt(document.getElementById('nhours').value||0);
  const _u=document.getElementById('nuses').value.trim();
  const maxUses=_u===''?3:parseInt(_u);
  const deferred=document.getElementById('ndeferred').value==='1';

  if(!label){toast('Informe o nome do cliente.',false);return;}
  if(isNaN(maxUses)||maxUses<1){toast('Informe um número de usos válido (mínimo 1).',false);return;}

  try{
    const body={label,maxUses};
    if(days>0)body.expireDays=days;
    if(hours>0)body.expireHours=hours;
    if(deferred)body.deferred=true;

    const r=await fetch(_RM+'/api/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(r.status===401){toast('Sessão expirada.',false);setTimeout(()=>location.href=_RM,1500);return;}
    const d=await r.json();
    if(!d.ok){toast('Erro: '+(d.error||'desconhecido'),false);return;}

    // Exibir resultado
    document.getElementById('result-key').textContent=d.key;
    const meta=[];
    const exp=[];if(days>0)exp.push(days+'d');if(hours>0)exp.push(hours+'h');
    meta.push(exp.length?exp.join(' ')+' de validade':'Sem expiração');
    meta.push(maxUses+' dispositivo(s)');
    if(deferred)meta.push('Ativa ao 1º uso');
    document.getElementById('result-meta').innerHTML=meta.map(m=>'<span class="result-tag">'+m+'</span>').join('');
    document.getElementById('result-box').classList.add('show');

    // Limpar campos
    ['nlabel','ndays','nhours','nuses'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('ndeferred').checked=false;

    toast('✅ Chave criada: '+d.key);
    await loadHistory();
  }catch(e){toast('Erro de rede.',false);}
}

function copyKey(){
  const key=document.getElementById('result-key').textContent;
  navigator.clipboard.writeText(key).then(()=>toast('Chave copiada!')).catch(()=>{
    const ta=document.createElement('textarea');ta.value=key;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);toast('Chave copiada!');
  });
}

function fmtDate(iso){if(!iso)return'—';const d=new Date(iso);return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'})+' '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});}

async function loadHistory(){
  try{
    const r=await fetch(_RM+'/api/my-keys');
    if(r.status===401){toast('Sessão expirada.',false);setTimeout(()=>location.href=_RM,1500);return;}
    const d=await r.json();
    const tbody=document.getElementById('hist-body');
    if(!d.keys||d.keys.length===0){tbody.innerHTML='<tr><td colspan="6" class="empty">Nenhuma chave criada ainda</td></tr>';return;}
    tbody.innerHTML=d.keys.map(k=>{
      const exp=k.expiresAt?fmtDate(k.expiresAt):(k.deferred?'Ativa ao 1º uso':'Sem expiração');
      const st=k.active?'<span class="badge bon">ATIVA</span>':'<span class="badge" style="background:#ff475718;color:#ff4757;border:1px solid #ff475730">INATIVA</span>';
      return '<tr><td><span class="kc">'+k.code+'</span></td><td>'+escHtml(k.label)+'</td><td>'+k.maxUses+'</td><td>'+exp+'</td><td>'+fmtDate(k.createdAt)+'</td><td>'+st+'</td></tr>';
    }).join('');
  }catch(e){toast('Erro ao carregar histórico.',false);}
}

function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// Carregar histórico ao entrar
loadHistory();
</script>
</body></html>`;
}

// ─────────────────────────────────────────────
// PÁGINA: LOGIN DA EXTENSÃO
// ─────────────────────────────────────────────
function renderExtensionLogin({ callback, error = '', keyVal = '' }) {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM - LR1290 — Ativação</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3ELR%3C/text%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0f;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Space Mono',monospace;overflow:hidden}
.card{background:#111118;border:1px solid #1e1e2e;border-radius:18px;padding:36px 32px;width:100%;max-width:420px;text-align:center;position:relative;z-index:1;box-shadow:0 0 40px rgba(124,58,237,0.15)}
.logo{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:#00ff87;margin-bottom:4px}
.sub{color:#6b6b8a;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-bottom:28px}
label{display:block;text-align:left;font-size:10px;letter-spacing:2px;color:#6b6b8a;text-transform:uppercase;margin-bottom:8px}
input{width:100%;padding:13px 16px;background:#0a0a0f;border:1.5px solid #1e1e2e;border-radius:10px;color:#00ff87;font-family:'Space Mono',monospace;font-size:15px;outline:none;letter-spacing:2px;transition:border .2s}
input:focus{border-color:#00ff87}
.err{background:#ff475715;border:1px solid #ff4757;border-radius:8px;color:#ff4757;padding:11px 14px;font-size:12px;margin-bottom:18px;text-align:left}
.btn{width:100%;padding:14px;background:#00ff87;border:none;border-radius:10px;color:#000;font-family:'Syne',sans-serif;font-weight:700;font-size:15px;cursor:pointer;margin-top:20px;transition:opacity .2s}
.btn:hover{opacity:.85}
.hint{margin-top:20px;color:#6b6b8a;font-size:11px}.hint a{color:#00ff87;text-decoration:none}
</style>
</head><body>
<div class="card">
  <div class="logo">⚡ ZVM - LR1290</div>
  <div class="sub">Ativação da Extensão</div>
  ${error ? `<div class="err">${escHtml(error)}</div>` : ''}
  <form method="POST" action="/extension/auth/verify">
    <input type="hidden" name="callback" value="${escHtml(callback)}">
    <label>Sua Chave de Ativação</label>
    <input type="text" name="key" value="${escHtml(keyVal)}" placeholder="zv-xxxxx-xxxxx-xxxxx" autocomplete="off" spellcheck="false">
    <p style="text-align:left;font-size:11px;color:#6b6b8a;margin-top:8px">Você recebeu esta chave junto com a sua compra.</p>
    <button type="submit" class="btn">Ativar Agora</button>
  </form>
  <div class="hint">Precisa de ajuda?<br><a href="https://wa.me/5521996771552?text=LR!%20Preciso%20de%20ajuda%20referente%20a%20minha%20renova%C3%A7%C3%A3o." target="_blank">💬 Falar com o suporte no WhatsApp</a></div>
</div>
${CANVAS_BG}</body></html>`;
}

// ─────────────────────────────────────────────
// PÁGINA: LOGIN DO ADMIN
// ─────────────────────────────────────────────
function renderAdminLogin(error = '') {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM - LR1290 Admin</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3ELR%3C/text%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0f;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Space Mono',monospace;overflow:hidden}
.card{background:#111118;border:1px solid #1e1e2e;border-radius:18px;padding:40px 36px;width:360px;position:relative;z-index:1;box-shadow:0 0 40px rgba(124,58,237,0.15)}
.logo{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:#00ff87;margin-bottom:20px;text-align:center}
label{display:block;font-size:10px;letter-spacing:2px;color:#6b6b8a;text-transform:uppercase;margin-bottom:7px}
input{width:100%;padding:11px 14px;background:#0a0a0f;border:1px solid #1e1e2e;border-radius:8px;color:#e2e2f0;font-family:'Space Mono',monospace;font-size:13px;outline:none;margin-bottom:16px}
input:focus{border-color:#00ff87}
.btn{width:100%;padding:12px;background:#00ff87;border:none;border-radius:8px;color:#000;font-family:'Syne',sans-serif;font-weight:700;font-size:14px;cursor:pointer}
.err{background:#ff475715;border:1px solid #ff4757;border-radius:6px;color:#ff4757;padding:9px 12px;font-size:12px;margin-bottom:16px}
</style></head><body>
<div class="card">
  <div class="logo">⚡ ZVM - LR1290 Admin</div>
  ${error ? `<div class="err">${escHtml(error)}</div>` : ''}
  <form method="POST" action="${R_ADMIN}/login">
    <label>Usuário</label><input type="text" name="user" autocomplete="off">
    <label>Senha</label><input type="password" name="pass">
    ${TOTP_SECRET ? `<label>Código 2FA</label><input type="text" name="totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" autocomplete="one-time-code" style="letter-spacing:4px;font-size:18px;text-align:center">` : ''}
    <button type="submit" class="btn">Entrar</button>
  </form>
</div>
${CANVAS_BG}</body></html>`;
}

// ─────────────────────────────────────────────
// PORTAL DO CLIENTE
// ─────────────────────────────────────────────
function renderClientPortal() {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM - LR1290 — Portal do Cliente</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3ELR%3C/text%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0f;min-height:100vh;display:flex;flex-direction:column;font-family:'Space Mono',monospace;overflow:hidden}
nav{display:flex;align-items:center;justify-content:space-between;padding:12px 24px;border-bottom:1px solid #1c1c2e;background:#0f0f1a;position:sticky;top:0;z-index:50;box-shadow:0 2px 20px #00000040;flex-shrink:0}
.nav-logo{font-family:'Syne',sans-serif;font-size:18px;font-weight:800;color:#00ff87;text-decoration:none;display:flex;align-items:center;gap:6px}
.nav-links{display:flex;gap:8px}
.nav-links a{font-size:11px;color:#5a5a7a;text-decoration:none;padding:6px 12px;border:1px solid #1c1c2e;border-radius:6px;transition:all .2s;font-family:'Syne',sans-serif;font-weight:700}
.nav-links a:hover{color:#00ff87;border-color:#00ff87}
.page-body{flex:1;display:flex;align-items:center;justify-content:center;padding:20px}
.wrap{width:100%;max-width:460px;position:relative;z-index:1}
.card{background:#111118;border:1px solid #1e1e2e;border-radius:18px;padding:36px 32px;text-align:center}
.logo{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:#00ff87;margin-bottom:4px}
.sub{color:#6b6b8a;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-bottom:28px}
label{display:block;text-align:left;font-size:10px;letter-spacing:2px;color:#6b6b8a;text-transform:uppercase;margin-bottom:8px}
input{width:100%;padding:13px 16px;background:#0a0a0f;border:1.5px solid #1e1e2e;border-radius:10px;color:#00ff87;font-family:'Space Mono',monospace;font-size:15px;outline:none;letter-spacing:2px;transition:border .2s}
input:focus{border-color:#00ff87}
.btn{width:100%;padding:14px;background:#00ff87;border:none;border-radius:10px;color:#000;font-family:'Syne',sans-serif;font-weight:700;font-size:15px;cursor:pointer;margin-top:16px;transition:all .25s}
.btn:hover{opacity:.9;transform:translateY(-2px);box-shadow:0 6px 20px #00ff8750}
.btn:disabled{opacity:.4;cursor:not-allowed;transform:none;box-shadow:none}
.err{background:#ff475715;border:1px solid #ff4757;border-radius:8px;color:#ff4757;padding:11px 14px;font-size:12px;margin-bottom:16px;text-align:left}
.panel{margin-top:20px;text-align:left;display:none}
.panel-title{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#e2e2f0;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid #1e1e2e}
.row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #1e1e2e30}
.row:last-child{border-bottom:none}
.row-label{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#6b6b8a}
.row-val{font-size:12px;color:#e2e2f0;text-align:right;max-width:62%}
.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
.badge-on{background:#00ff8720;color:#00ff87;border:1px solid #00ff8740}
.badge-off{background:#ff475720;color:#ff4757;border:1px solid #ff475740}
.badge-warn{background:#ffa50020;color:#ffa500;border:1px solid #ffa50040}
.badge-def{background:#6b6b8a20;color:#6b6b8a;border:1px solid #6b6b8a40}
.hint{margin-top:22px;color:#6b6b8a;font-size:11px;line-height:1.8}.hint a{color:#00ff87;text-decoration:none}
.expire-bar-wrap{margin-top:6px;background:#1e1e2e;border-radius:6px;overflow:hidden;height:5px}
.expire-bar{height:5px;border-radius:6px;transition:width .6s}
.section-links{margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.link-btn{padding:12px 8px;background:#0a0a0f;border:1px solid #1e1e2e;border-radius:10px;color:#e2e2f0;font-family:'Space Mono',monospace;font-size:11px;text-align:center;text-decoration:none;transition:border-color .2s,color .2s;display:block;line-height:1.6}
.link-btn:hover{border-color:#00ff87;color:#00ff87}
.spinner{display:inline-block;width:15px;height:15px;border:2px solid #00ff8730;border-top-color:#00ff87;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:8px}
@keyframes spin{to{transform:rotate(360deg)}}
.loading-overlay{position:fixed;inset:0;background:#0a0a0f;display:flex;align-items:center;justify-content:center;z-index:99}
.privacy-note{margin-top:16px;padding:10px 14px;background:#1e1e2e30;border-radius:8px;font-size:10px;color:#6b6b8a;text-align:left;line-height:1.6}
.privacy-note a{color:#4f8ef7;text-decoration:none}
</style>
</head><body>
<nav>
  <a href="/" class="nav-logo">⚡ ZVM - LR1290</a>
  <div class="nav-links">
    <a href="/faq">FAQ</a>
    <a href="https://wa.me/5521996771552?text=LR!%20Preciso%20de%20ajuda." target="_blank">💬 Suporte</a>
  </div>
</nav>
<div id="loading-overlay" class="loading-overlay"><span class="spinner"></span></div>
<div class="page-body">
<div class="wrap">
  <div class="card">
    <div class="logo">⚡ ZVM - LR1290</div>
    <div class="sub">Portal do Cliente</div>
    <div id="form-area">
      <div id="err-box" class="err" style="display:none"></div>
      <label>Sua Chave de Ativação</label>
      <input type="text" id="key-input" placeholder="zv-xxxxx-xxxxx-xxxxx" autocomplete="off" spellcheck="false">
      <p style="text-align:left;font-size:11px;color:#6b6b8a;margin-top:8px">Você recebeu esta chave junto com a sua compra.</p>
      <button class="btn" id="check-btn" onclick="checkKey()">Consultar Minha Chave</button>
      <a class="btn" href="/faq" style="display:block;margin-top:10px;background:#1e1e2e;color:#6b6b8a;font-size:12px;text-decoration:none;text-align:center;padding:12px;border-radius:10px;border:1px solid #2a2a3e;transition:border-color .2s,color .2s" onmouseover="this.style.borderColor='#00ff87';this.style.color='#00ff87'" onmouseout="this.style.borderColor='#2a2a3e';this.style.color='#6b6b8a'">❓ FAQ — Dúvidas Frequentes</a>
      <div class="privacy-note">🔒 Ao usar este serviço, você concorda com nossa <a href="/privacidade">Política de Privacidade</a> e com a coleta de dados de uso para fins de licenciamento (LGPD).</div>
    </div>
    <div class="panel" id="result-panel">
      <div class="panel-title" id="panel-name">Minha Conta</div>
      <div class="row"><span class="row-label">Status</span><span class="row-val" id="r-status"></span></div>
      <div class="row"><span class="row-label">Dispositivos</span><span class="row-val" id="r-phones"></span></div>
      <div class="row">
        <span class="row-label">Expira em</span>
        <span class="row-val">
          <span id="r-expires"></span>
          <div class="expire-bar-wrap" id="r-bar-wrap" style="display:none"><div class="expire-bar" id="r-bar"></div></div>
        </span>
      </div>
      <div class="row" id="r-act-row" style="display:none"><span class="row-label">Ativada em</span><span class="row-val" id="r-activated"></span></div>
      <div class="row" id="r-last-row" style="display:none"><span class="row-label">Último uso</span><span class="row-val" id="r-lastused"></span></div>
      <div id="r-phone-section" style="display:none;margin-top:16px;border-top:1px solid #1e1e2e;padding-top:14px">
        <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#6b6b8a;margin-bottom:10px">Dispositivos cadastrados</div>
        <div id="r-phone-list"></div>
        <div style="font-size:10px;color:#6b6b8a;margin-top:8px">Remova um número para liberar o slot e entrar em outro dispositivo.</div>
      </div>
      <div class="section-links" id="r-links"></div>
      <button class="btn" style="margin-top:16px;background:#1e1e2e;color:#6b6b8a;font-size:12px" onclick="resetPanel()">← Consultar outra chave</button>
    </div>
    <div class="hint">Precisa de ajuda?<br><a href="https://wa.me/5521996771552?text=LR!%20Preciso%20de%20ajuda%20referente%20a%20minha%20renova%C3%A7%C3%A3o." target="_blank">💬 Falar com o suporte no WhatsApp</a></div>
  </div>
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
  document.getElementById('form-area').style.display='none';
  document.getElementById('result-panel').style.display='block';
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
  if(d.activatedAt){document.getElementById('r-act-row').style.display='flex';document.getElementById('r-activated').textContent=fmtDate(d.activatedAt);}
  if(d.lastUsed){document.getElementById('r-last-row').style.display='flex';document.getElementById('r-lastused').textContent=fmtDate(d.lastUsed);}
  document.getElementById('r-links').innerHTML='<a class="link-btn" href="https://app.zapvoice.com.br/dashboard/backup-fixer" target="_blank">🔧 Corrija<br>Backups</a><a class="link-btn" href="https://app.zapvoice.com.br/dashboard/converter" target="_blank">🎵 Converta<br>Áudios</a><a class="link-btn" href="https://wa.me/5521996771552?text=LR!%20Preciso%20de%20ajuda%20referente%20a%20minha%20renova%C3%A7%C3%A3o." target="_blank" style="grid-column:span 2;border-color:#25d366;color:#25d366">💬 Suporte no WhatsApp</a>';
  var phoneSec=document.getElementById('r-phone-section'),phoneList=document.getElementById('r-phone-list');
  if(d.phoneList&&d.phoneList.length>0){phoneSec.style.display='block';phoneList.innerHTML='';d.phoneList.forEach(function(ph){var row=document.createElement('div');row.style.cssText='display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #1e1e2e';var sp=document.createElement('span');sp.style.cssText='font-size:13px;font-family:monospace;color:#e2e2f0';sp.textContent=ph;var btn=document.createElement('button');btn.textContent='Remover';btn.style.cssText='padding:4px 12px;background:#ff4757;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:12px';btn.addEventListener('click',function(){clientRemovePhone(key,ph);});row.appendChild(sp);row.appendChild(btn);phoneList.appendChild(row);});}
  else phoneSec.style.display='none';
}
function resetPanel(){document.getElementById('form-area').style.display='block';document.getElementById('result-panel').style.display='none';document.getElementById('r-act-row').style.display='none';document.getElementById('r-last-row').style.display='none';const btn=document.getElementById('check-btn');btn.disabled=false;btn.textContent='Consultar Minha Chave';}
async function clientRemovePhone(key,phone){
  if(!confirm('Remover o número '+phone+' desta chave?'))return;
  try{var r=await fetch('/client/remove-phone',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,phone})});var d=await r.json();if(d.ok){alert('Número removido! Você pode fazer login novamente.');doCheck(key);}else alert('Erro: '+(d.error||'?'));}catch(e){alert('Erro de rede.');}
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

// ─────────────────────────────────────────────
// ADMIN: BUILDERS HTML
// ─────────────────────────────────────────────
function buildKeysHtml() {
  const entries = Object.entries(keys);
  if (!entries.length) return `<tr><td colspan="11" class="empty">Nenhuma chave cadastrada</td></tr>`;
  return entries.map(([code, k]) => {
    const expired  = isKeyExpired(k);
    const warnSoon = isKeyExpiringSoon(k);
    // Calcula acessos únicos (IPs distintos nos logs dessa chave)
    const uniqueIps = new Set(logs.filter(l => l.keyCode === code && l.ip).map(l => l.ip)).size;
    // Detecta chave suspeita: mais de 3 IPs distintos nas últimas 24h
    const recentLogs = logs.filter(l => l.keyCode === code && l.timestamp > new Date(Date.now() - 86400000).toISOString());
    const recentIps  = new Set(recentLogs.filter(l => l.ip).map(l => l.ip));
    const isSuspect  = recentIps.size > 3;

    const expHtml = (!k.expiresAt && k.expireDuration) ? (() => {
      const d=Math.floor(k.expireDuration/86400000),h=Math.floor((k.expireDuration%86400000)/3600000),m=Math.floor((k.expireDuration%3600000)/60000);
      const parts=[];if(d>0)parts.push(d+'d');if(h>0)parts.push(h+'h');if(m>0)parts.push(m+'m');
      return `<br><span style="color:var(--blue);font-size:10px">⏱ Ao ativar: ${parts.join(' ')}</span>`;
    })() : k.expiresAt ? (() => {
      const exp=new Date(k.expiresAt),diffMs=exp-new Date(),diffH=Math.floor(diffMs/36e5),diffD=Math.floor(diffMs/864e5);
      let label=expired?'expirado':diffH<1?`exp: ${Math.floor((diffMs%36e5)/60000)}min`:diffH<24?`exp: ${diffH}h`:` exp: ${diffD}d — ${exp.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}`;
      return `<br><span style="font-size:10px;color:${expired?'var(--red)':warnSoon?'var(--orange)':'var(--yellow)'}">${label}</span>`;
    })() : '';

    const rowStyle = isSuspect ? ' style="background:#ff000008;outline:1px solid #ff475720"' : warnSoon && !expired ? ' style="background:#ff860010"' : '';
    const suspectBadge = isSuspect ? `<span title="${recentIps.size} IPs nas últimas 24h" style="color:#ff4757;font-size:9px;margin-left:4px">⚠ SUSPEITA</span>` : '';

    return `
<tr data-label="${escHtml(k.label.toLowerCase())}" data-phone="${escHtml(k.lastPhone||'')}" data-status="${k.active?'ativo':'bloqueado'}" data-uses="${k.uses||0}" data-created="${k.createdAt||''}" data-suspect="${isSuspect?'1':''}"`+rowStyle+`>
  <td><span class="kc">${escHtml(code)}</span></td>
  <td>${escHtml(k.label)}${suspectBadge}</td>
  <td><span class="badge ${k.active?'on':'off'}">${k.active?(k.expireDuration&&!k.expiresAt?'AGUARDANDO':'ATIVO'):'BLOQUEADO'}</span></td>
  <td><span style="color:${((k.phones||[]).length>=(k.maxUses>0?k.maxUses:MAX_USES)&&(k.maxUses>0?k.maxUses:MAX_USES)>0)?'var(--orange)':'inherit'}">${(k.phones||[]).length}/${k.maxUses===-1?'&#x221E;':(k.maxUses>0?k.maxUses:MAX_USES)}</span></td>
  <td>${escHtml(k.lastPhone||'-')}</td>
  <td title="${uniqueIps} IPs únicos registrados">${escHtml(k.lastIp||'-')} ${uniqueIps>1?`<span style="color:var(--muted);font-size:9px">(+${uniqueIps-1})</span>`:''}</td>
  <td>${k.lastUsed?new Date(k.lastUsed).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'-'}</td>
  <td>${new Date(k.createdAt||Date.now()).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}${expHtml}</td>
  <td>${escHtml(k.wppVersion||'-')}</td>
  <td class="note-cell" data-code="${escHtml(code)}" data-note="${escHtml(k.note||'')}"><span class="note-preview">${k.note&&k.note.startsWith('[Mod:')?'<span style=\"color:#4f8ef7;font-size:9px\">'+escHtml(k.note)+'</span>':escHtml(k.note||'') || '<span style=\\"color:var(--muted)\\">—</span>'}</span></td>
  <td>
    <button class="bs ${k.active?'bd':'bg'}" onclick="toggleKey('${escHtml(code)}')}">${k.active?'Bloquear':'Liberar'}</button>
    <button class="bs bg" onclick="openRenew('${escHtml(code)}','${escHtml(k.label||'')}')">+ Tempo</button>
    <button class="bs bg" onclick="openEditUses('${escHtml(code)}','${escHtml(k.label||'')}',${k.maxUses!=null?k.maxUses:MAX_USES})">Usos</button>
    <button class="bs bg" onclick="openRename('${escHtml(code)}','${escHtml(k.label||'')}')">Renomear</button>
    ${(k.phones||[]).length>0?`<button class="bs bd" onclick="openPhones('${escHtml(code)}','${escHtml(k.label||'')}')">Números</button>`:''}
    <button class="bs bd" onclick="deleteKey('${escHtml(code)}')">Excluir</button>
    ${isSuspect?`<button class="bs bsusp" onclick="clearSuspect('${escHtml(code)}')">🕵️ Suspeita</button>`:''}
  </td>
</tr>`;
  }).join('');
}

function buildLogsHtml(arr) {
  const src = arr ?? logs;
  if (!src.length) return `<tr><td colspan="7" class="empty">Nenhum log ainda</td></tr>`;
  return src.slice(0, 200).map(l => `
<tr>
  <td>${new Date(l.timestamp).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</td>
  <td><span class="kc" style="font-size:11px">${escHtml(l.keyCode||'-')}</span></td>
  <td>${escHtml(l.label||'-')}</td>
  <td>${escHtml(l.phone||'-')}</td>
  <td>${escHtml(l.ip||'-')}</td>
  <td>${escHtml(l.wppVersion||'-')}</td>
  <td><span class="badge ${l.action==='login_ok'?'on':l.action==='relogin_ok'?'re':l.action==='verify_ok'?'vr':l.action==='login_blocked'?'off':l.action==='warn_limit'?'wl':'warn'}">${escHtml(l.action)}</span></td>
</tr>`).join('');
}

// ─────────────────────────────────────────────
// ADMIN: DASHBOARD COMPLETO
// ─────────────────────────────────────────────
function renderAdminDashboard() {
  const expiringSoon  = Object.values(keys).filter(k => k.active && isKeyExpiringSoon(k)).length;
  const suspectKeys   = Object.values(keys).filter(k => {
    const recentLogs = logs.filter(l => l.keyCode === Object.keys(keys).find(c => keys[c] === k) && l.timestamp > new Date(Date.now()-86400000).toISOString());
    return new Set(recentLogs.filter(l=>l.ip).map(l=>l.ip)).size > 3;
  }).length;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM - LR1290 Admin v8</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3ELR%3C/text%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --green:#00ff87;--dark:#080810;--card:#0f0f1a;--card2:#13131f;
  --border:#1c1c2e;--border2:#252538;--text:#e2e2f0;--muted:#5a5a7a;
  --red:#ff4757;--yellow:#ffd32a;--orange:#ff8600;--blue:#4f8ef7;--purple:#9b59b6;
  --radius:10px;--radius-sm:6px;
}
body{background:var(--dark);color:var(--text);font-family:'Space Mono',monospace;min-height:100vh;overflow-x:hidden}
header{display:flex;align-items:center;justify-content:space-between;padding:12px 24px;border-bottom:1px solid var(--border);background:var(--card);position:sticky;top:0;z-index:50;box-shadow:0 2px 20px #00000040}
.logo{font-family:'Syne',sans-serif;font-size:18px;font-weight:800;color:var(--green);display:flex;align-items:center;gap:8px}
.hright{display:flex;align-items:center;gap:10px}
a.out{color:var(--muted);font-size:11px;text-decoration:none;padding:6px 12px;border:1px solid var(--border2);border-radius:var(--radius-sm);transition:all .2s}
a.out:hover{color:var(--red);border-color:var(--red)}
main{padding:22px 24px;max-width:1800px;margin:0 auto}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:20px}
.sc{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;position:relative;overflow:hidden;transition:border-color .2s,transform .15s;cursor:default}
.sc:hover{border-color:var(--border2);transform:translateY(-1px)}
.sc.warn-card{border-color:#ff860050;background:#ff860008}
.sc.danger-card{border-color:#ff475750;background:#ff475708}
.sc-icon{position:absolute;right:14px;top:14px;font-size:22px;opacity:.15}
.sc .n{font-family:'Syne',sans-serif;font-size:30px;font-weight:800;color:var(--green);line-height:1.1}
.sc.warn-card .n{color:var(--orange)}
.sc.danger-card .n{color:var(--red)}
.sc .l{color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:1.5px;margin-top:5px}
/* Search */
.search-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 16px;background:var(--card2);border-bottom:1px solid var(--border)}
.search-bar input{padding:7px 12px;background:var(--dark);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:'Space Mono',monospace;font-size:12px;outline:none;flex:1;min-width:160px;transition:border .18s}
.search-bar input:focus{border-color:var(--green)}
.search-bar select{padding:7px 10px;background:var(--dark);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:'Space Mono',monospace;font-size:11px;outline:none;cursor:pointer}
.sec{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:16px;overflow:hidden}
.sh{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--card2);flex-wrap:wrap;gap:10px}
.st{font-family:'Syne',sans-serif;font-weight:700;font-size:13px;color:var(--green);display:flex;align-items:center;gap:6px}
.gen-form{display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap}
.gen-form input{padding:7px 10px;background:var(--dark);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:'Space Mono',monospace;font-size:11px;outline:none;transition:border .18s}
.gen-form input:focus{border-color:var(--green);background:#0a0a14}
.gen-form input::placeholder{color:var(--muted)}
.fi-name{flex:1;min-width:130px;max-width:170px}
.fi-group{display:flex;gap:5px;align-items:flex-end}
.fi-col{display:flex;flex-direction:column;gap:3px}
.fi-lbl{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;padding-left:2px}
.fi-num{width:56px;text-align:center}
.fi-sep{width:1px;height:28px;background:var(--border2);margin:0 3px;flex-shrink:0;align-self:flex-end;margin-bottom:2px}
.btn{padding:7px 14px;border:none;border-radius:var(--radius-sm);cursor:pointer;font-family:'Syne',sans-serif;font-weight:700;font-size:11px;transition:all .18s;white-space:nowrap;letter-spacing:.3px}
.bp{background:var(--green);color:#000;box-shadow:0 0 12px #00ff8740}
.bp:hover{box-shadow:0 4px 20px #00ff8760;opacity:.9}
.bw{background:#ffd32a12;color:var(--yellow);border:1px solid #ffd32a35}
.br{background:#ff475712;color:var(--red);border:1px solid #ff475735}
.bcsv{background:#4f8ef712;color:var(--blue);border:1px solid #4f8ef735}
.bs{padding:3px 8px;border:none;border-radius:4px;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;margin-right:2px;transition:all .15s;white-space:nowrap}
.bs:hover{opacity:1;transform:translateY(-1px)}
.bg{background:#00ff8712;color:var(--green);border:1px solid #00ff8730}
.bg:hover{background:#00ff8722;border-color:#00ff8760}
.bd{background:#ff475712;color:var(--red);border:1px solid #ff475730}
.bd:hover{background:#ff475722;border-color:#ff475760}
.bsusp{background:#ff475712;color:var(--red);border:1px solid #ff475730}
.ov{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{padding:8px 11px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);border-bottom:1px solid var(--border);white-space:nowrap;background:var(--card2);cursor:pointer;user-select:none}
th:hover{color:var(--text)}
th.asc::after{content:' ▲';color:var(--green);font-size:8px}
th.desc::after{content:' ▼';color:var(--green);font-size:8px}
td{padding:10px 11px;font-size:11px;border-bottom:1px solid #14141f;vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:#ffffff02}
.kc{color:var(--green);font-size:11px;letter-spacing:.3px}
.badge{padding:2px 7px;border-radius:3px;font-size:9px;font-weight:700;letter-spacing:.8px;text-transform:uppercase}
.on{background:#00ff8718;color:var(--green);border:1px solid #00ff8730}
.off{background:#ff475718;color:var(--red);border:1px solid #ff475730}
.re{background:#4f8ef718;color:var(--blue)}
.vr{background:#9b59b618;color:var(--purple)}
.warn{background:#ffd32a18;color:var(--yellow)}
.wl{background:#ff8c0018;color:#ff8c00}
.empty{text-align:center;color:var(--muted);padding:40px!important;font-size:11px}
.toast{position:fixed;bottom:20px;right:20px;padding:11px 18px;border-radius:var(--radius);font-family:'Syne',sans-serif;font-weight:700;font-size:12px;display:none;z-index:999999;box-shadow:0 6px 30px #00000070;max-width:380px;line-height:1.4}
.note-cell{cursor:pointer;max-width:130px}
.note-cell:hover .note-preview{color:var(--green)}
.note-preview{color:var(--muted);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;max-width:120px}
.modal-bg{display:none;position:fixed;inset:0;background:#00000090;z-index:99999;align-items:center;justify-content:center;backdrop-filter:blur(3px)}
.modal-bg.open{display:flex}
.modal{background:var(--card);border:1px solid var(--border2);border-radius:12px;padding:22px;width:340px;max-width:95vw;box-shadow:0 20px 60px #00000090;max-height:90vh;overflow-y:auto}
.modal h3{font-family:'Syne',sans-serif;font-size:13px;margin-bottom:11px;color:var(--green)}
.modal textarea,.modal input[type=text],.modal input[type=number]{width:100%;background:var(--dark);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:'Space Mono',monospace;font-size:11px;padding:9px;outline:none;transition:border .2s}
.modal textarea{resize:vertical;min-height:80px}
.modal textarea:focus,.modal input:focus{border-color:var(--green)}
.modal-actions{display:flex;gap:8px;margin-top:11px;justify-content:flex-end}
@media(max-width:1300px){.stats{grid-template-columns:repeat(3,1fr)}}
@media(max-width:750px){.stats{grid-template-columns:1fr 1fr};main{padding:14px 12px}}
</style>
</head>
<body>
<header>
  <div class="logo">⚡ ZVM - LR1290 <span style="font-size:11px;color:var(--muted);font-weight:400">v8</span></div>
  <div class="hright">
    <button class="btn bcsv" onclick="exportCSV()">⬇ CSV</button>
    <a href="${R_ADMIN}/logout" class="out">↩ Sair</a>
  </div>
</header>
<main>
  <div class="stats">
    <div class="sc"><div class="sc-icon">🔑</div><div class="n" id="s-total">${Object.keys(keys).length}</div><div class="l">Total de Chaves</div></div>
    <div class="sc"><div class="sc-icon">✅</div><div class="n" id="s-active">${Object.values(keys).filter(k=>k.active).length}</div><div class="l">Chaves Ativas</div></div>
    <div class="sc ${expiringSoon>0?'warn-card':''}"><div class="sc-icon">⏰</div><div class="n" id="s-warn" style="${expiringSoon>0?'color:var(--orange)':''}">${expiringSoon}</div><div class="l">Expirando em ${EXPIRY_WARN_HOURS}h</div></div>

    <div class="sc ${suspectKeys>0?'danger-card':''}"><div class="sc-icon">🕵️</div><div class="n" id="s-suspect" style="${suspectKeys>0?'color:var(--red)':''}">${suspectKeys}</div><div class="l">Suspeitas (24h)</div></div>
    <div class="sc"><div class="sc-icon">📋</div><div class="n" id="s-logs">${logs.length}</div><div class="l">Acessos Registrados</div></div>
  </div>

  <div class="sec">
    <div class="sh">
      <div class="st">🔑 Chaves de Acesso</div>
      <div class="gen-form">
        <div class="fi-name"><input type="text" id="nlabel" placeholder="Nome do cliente"></div>
        <div class="fi-sep"></div>
        <div class="fi-group">
          <div class="fi-col"><span class="fi-lbl">Dias</span><input type="number" id="ndays" class="fi-num" placeholder="0" min="0"></div>
          <div class="fi-col"><span class="fi-lbl">Horas</span><input type="number" id="nhours" class="fi-num" placeholder="0" min="0"></div>
          <div class="fi-col"><span class="fi-lbl">Min</span><input type="number" id="nmins" class="fi-num" placeholder="0" min="0"></div>
        </div>
        <div class="fi-sep"></div>
        <div class="fi-col"><span class="fi-lbl">Usos</span><input type="number" id="nuses" class="fi-num" placeholder="3" min="-1" style="width:60px"></div>
        <div class="fi-col" style="align-items:center;gap:4px"><label style="font-size:10px;color:var(--muted);white-space:nowrap"><input type="checkbox" id="ndeferred" style="margin-right:4px">⏱ Ativar ao 1º uso</label></div>
        <button class="btn bp" onclick="generateKey()">+ Gerar Chave</button>
      </div>
    </div>
    <div class="search-bar">
      <input type="text" id="search-input" placeholder="🔍 Buscar por nome, chave, telefone ou IP..." oninput="filterKeys()">
      <select id="filter-status" onchange="filterKeys()">
        <option value="">Todos os status</option>
        <option value="ativo">Ativos</option>
        <option value="bloqueado">Bloqueados</option>
        <option value="suspeita">🕵️ Suspeitas</option>
      </select>
    </div>
    <div class="ov">
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
      <div class="st">📋 Log de Acessos <span style="font-size:9px;color:var(--muted);font-weight:400">retidos por ${LOG_RETENTION_DAYS} dias (LGPD)</span></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="date" id="logDate" style="padding:6px 10px;background:var(--dark);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:'Space Mono',monospace;font-size:11px;outline:none" onchange="filterLog()">
        <input type="text" id="logSearch" placeholder="Filtrar por chave/IP..." style="padding:6px 10px;background:var(--dark);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:'Space Mono',monospace;font-size:11px;outline:none;width:180px" oninput="filterLog()">
        <button class="btn bw" onclick="clearFilters()">✕ Limpar</button>
        <button class="btn bw" onclick="doRefresh()">↻ Atualizar</button>
        <button class="btn br" onclick="clearLog()">🗑 Limpar Log</button>
      </div>
    </div>
    <div class="ov">
      <table>
        <thead><tr><th>Horário</th><th>Chave</th><th>Cliente</th><th>Telefone</th><th>IP</th><th>WPP Version</th><th>Ação</th></tr></thead>
        <tbody id="lb">${buildLogsHtml()}</tbody>
      </table>
    </div>
  </div>
</main>

<!-- Modals -->
<div class="modal-bg" id="renewModal"><div class="modal">
  <h3>⏱ Adicionar Tempo — <span id="renewKeyLabel"></span></h3>
  <input type="hidden" id="renewKeyCode">
  <div style="display:flex;gap:10px;margin-bottom:12px">
    <div style="flex:1;text-align:center"><div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:5px">Dias</div><input type="number" id="renewDays" placeholder="0" min="0" style="width:100%;padding:8px;text-align:center"></div>
    <div style="flex:1;text-align:center"><div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:5px">Horas</div><input type="number" id="renewHours" placeholder="0" min="0" style="width:100%;padding:8px;text-align:center"></div>
    <div style="flex:1;text-align:center"><div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:5px">Min</div><input type="number" id="renewMins" placeholder="0" min="0" style="width:100%;padding:8px;text-align:center"></div>
  </div>
  <div style="font-size:11px;color:var(--muted);margin-bottom:12px" id="renewCurrentExpiry"></div>
  <div class="modal-actions">
    <button class="btn" style="background:#1e1e2e;color:var(--muted)" onclick="closeRenew()">Cancelar</button>
    <button class="btn bp" onclick="saveRenew()">Adicionar Tempo</button>
  </div>
</div></div>

<div class="modal-bg" id="editUsesModal"><div class="modal">
  <h3>👥 Limite de Dispositivos — <span id="editUsesLabel"></span></h3>
  <input type="hidden" id="editUsesCode">
  <div style="margin-bottom:14px">
    <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:8px">Máx. números simultâneos</div>
    <input type="number" id="editUsesValue" min="-1" style="width:100%;padding:10px;font-size:16px;text-align:center">
    <div style="font-size:11px;color:var(--muted);margin-top:8px">Use <strong style="color:var(--green)">-1</strong> para ilimitado</div>
  </div>
  <div class="modal-actions">
    <button class="btn" style="background:#1e1e2e;color:var(--muted)" onclick="closeEditUses()">Cancelar</button>
    <button class="btn bp" onclick="saveEditUses()">Salvar</button>
  </div>
</div></div>

<div class="modal-bg" id="renameModal"><div class="modal">
  <h3>Renomear Chave</h3>
  <input type="hidden" id="renameCode">
  <div style="margin-bottom:14px">
    <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:8px">Novo nome</div>
    <input type="text" id="renameValue" maxlength="60" style="width:100%;padding:10px;font-size:14px">
  </div>
  <div class="modal-actions">
    <button class="btn" style="background:#1e1e2e;color:var(--muted)" onclick="closeRename()">Cancelar</button>
    <button class="btn bp" onclick="saveRename()">Salvar</button>
  </div>
</div></div>

<div class="modal-bg" id="phonesModal"><div class="modal">
  <h3>Números — <span id="phonesLabel"></span></h3>
  <div id="phonesList" style="margin-bottom:14px;max-height:220px;overflow-y:auto;min-height:40px"></div>
  <div class="modal-actions">
    <button class="btn" style="background:#1e1e2e;color:var(--muted)" onclick="closePhones()">Fechar</button>
    <button class="btn bd" id="removeAllBtn" onclick="removeAllPhones()">Remover Todos</button>
  </div>
</div></div>

<div class="modal-bg" id="noteModal"><div class="modal">
  <h3>📝 Nota — <span id="noteKeyLabel"></span></h3>
  <input type="hidden" id="noteKeyCode">
  <textarea id="noteText" placeholder="Ex: Pagou até março, trial gratuito, cliente VIP..."></textarea>
  <div class="modal-actions">
    <button class="btn" style="background:#1e1e2e;color:var(--muted)" onclick="closeNote()">Cancelar</button>
    <button class="btn bp" onclick="saveNote()">Salvar Nota</button>
  </div>
</div></div>

<div class="toast" id="toast"></div>

<script>
const _RA='${R_ADMIN}';

function toast(msg,ok=true){
  const t=document.getElementById('toast');
  t.textContent=msg;t.style.background=ok?'var(--green)':'var(--red)';
  t.style.color=ok?'#000':'#fff';t.style.display='block';
  setTimeout(()=>t.style.display='none',3200);
}

// ── Busca e filtro de chaves ──
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

// ── Ordenação ──
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

// ── Gerar chave ──
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

// ── Refresh ──
async function doRefresh(){
  try{
    const r=await fetch(_RA+'/api/data');
    if(r.status===401){return;}
    const d=await r.json();if(d.error)return;
    document.getElementById('s-total').textContent=d.totalKeys||0;
    document.getElementById('s-active').textContent=d.activeKeys||0;
    document.getElementById('s-logs').textContent=d.totalLogs||0;
    const sw=document.getElementById('s-warn');sw.textContent=d.warnKeys||0;sw.style.color=d.warnKeys>0?'var(--orange)':'var(--green)';sw.closest('.sc').classList.toggle('warn-card',d.warnKeys>0);
    const ssu=document.getElementById('s-suspect');if(ssu){ssu.textContent=d.suspectKeys||0;ssu.style.color=d.suspectKeys>0?'var(--red)':'';ssu.closest('.sc').classList.toggle('danger-card',d.suspectKeys>0);}
    document.getElementById('kb').innerHTML=d.keysHtml||'';
    document.getElementById('lb').innerHTML=d.logsHtml||'';
    filterKeys();
  }catch(e){console.error('Refresh error',e);}
}
setInterval(doRefresh,30000);

// ── Ações de chave ──
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

// ── Log ──
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

// ── Modais ──
function openRenew(code,label){document.getElementById('renewKeyCode').value=code;document.getElementById('renewKeyLabel').textContent=label;['renewDays','renewHours','renewMins'].forEach(id=>document.getElementById(id).value='');document.getElementById('renewModal').classList.add('open');document.getElementById('renewDays').focus();}
function closeRenew(){document.getElementById('renewModal').classList.remove('open');}
document.getElementById('renewModal').addEventListener('click',function(e){if(e.target===this)closeRenew();});
async function saveRenew(){
  const code=document.getElementById('renewKeyCode').value;
  const days=parseInt(document.getElementById('renewDays').value)||0;
  const hours=parseInt(document.getElementById('renewHours').value)||0;
  const mins=parseInt(document.getElementById('renewMins').value)||0;
  if(!days&&!hours&&!mins){toast('Informe pelo menos um valor.',false);return;}
  const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/renew',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({days,hours,mins})});
  const d=await r.json();if(d.ok){toast('✅ Tempo adicionado! Expira: '+new Date(d.expiresAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}));closeRenew();await doRefresh();}else toast('Erro: '+(d.error||'?'),false);
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
    list.innerHTML=d.phones.map((ph,i)=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-size:13px;font-family:monospace;color:var(--text)">'+ph+'</span><button class="bs bd" data-idx="'+i+'" onclick="removePhone(this)">Remover</button></div>').join('');
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

// ── Exportar CSV ──
async function exportCSV(){
  try{const r=await fetch(_RA+'/api/export/csv');if(r.status===401){toast('Sessão expirada',false);return;}const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='zapvoice-chaves-'+new Date().toISOString().slice(0,10)+'.csv';a.click();URL.revokeObjectURL(url);toast('CSV exportado!');}catch(e){toast('Erro ao exportar',false);}
}
</script>
</body></html>`;
}

// ─────────────────────────────────────────────
// PÁGINA: FAQ
// ─────────────────────────────────────────────
function renderFaqPage() {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM - LR1290 — FAQ</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3ELR%3C/text%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--green:#00ff87;--dark:#080810;--card:#0f0f1a;--border:#1c1c2e;--text:#e2e2f0;--muted:#5a5a7a;--radius:14px}
body{background:var(--dark);color:var(--text);font-family:'Space Mono',monospace;min-height:100vh;overflow-x:hidden}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 28px;border-bottom:1px solid var(--border);background:var(--card);position:sticky;top:0;z-index:50;box-shadow:0 2px 20px #00000060}
.logo{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:var(--green);text-decoration:none;display:flex;align-items:center;gap:8px}
.header-links{display:flex;gap:10px}
.header-links a{font-size:11px;color:var(--muted);text-decoration:none;padding:6px 13px;border:1px solid var(--border);border-radius:6px;transition:all .2s;font-family:'Syne',sans-serif;font-weight:700}
.header-links a:hover{color:var(--green);border-color:var(--green)}
main{max-width:760px;margin:0 auto;padding:60px 24px 80px}
.hero{text-align:center;margin-bottom:64px}
.hero-badge{display:inline-block;background:#00ff8712;border:1px solid #00ff8730;color:var(--green);font-size:10px;letter-spacing:2px;text-transform:uppercase;padding:5px 14px;border-radius:20px;margin-bottom:22px;font-family:'Syne',sans-serif}
.hero h1{font-family:'Syne',sans-serif;font-size:clamp(28px,5vw,48px);font-weight:800;line-height:1.1;margin-bottom:18px}
.hero h1 span{color:var(--green)}
.hero-sub{color:var(--muted);font-size:13px;line-height:1.8;max-width:500px;margin:0 auto 36px}
.wip-card{background:linear-gradient(135deg,#0f0f1a,#13101f);border:1px solid #7c3aed40;border-radius:var(--radius);padding:40px 36px;text-align:center;margin-bottom:56px;position:relative;overflow:hidden}
.wip-card::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 0%,#7c3aed18,transparent 70%);pointer-events:none}
.wip-icon{font-size:52px;margin-bottom:18px;display:block;animation:float 3s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.wip-title{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:var(--text);margin-bottom:12px}
.wip-title span{color:var(--green)}
.wip-desc{color:var(--muted);font-size:13px;line-height:1.9;max-width:480px;margin:0 auto 28px}
.progress-wrap{background:#1e1e2e;border-radius:8px;height:6px;overflow:hidden;max-width:320px;margin:0 auto 10px}
.progress-bar{height:6px;background:linear-gradient(90deg,#7c3aed,var(--green));border-radius:8px;animation:progress 2.5s ease-in-out infinite alternate}
@keyframes progress{from{width:30%}to{width:45%}}
.progress-label{font-size:10px;color:var(--muted);letter-spacing:1px;text-transform:uppercase}
.coming-title{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:var(--muted);letter-spacing:2px;text-transform:uppercase;text-align:center;margin-bottom:20px}
.coming-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:52px}
.coming-item{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px 18px;display:flex;align-items:flex-start;gap:12px;transition:border-color .2s}
.coming-item:hover{border-color:#7c3aed40}
.coming-item .ic{font-size:20px;flex-shrink:0;margin-top:1px}
.coming-item h3{font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:var(--text);margin-bottom:4px}
.coming-item p{font-size:10px;color:var(--muted);line-height:1.6}
.support-section{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:32px;text-align:center}
.support-section h2{font-family:'Syne',sans-serif;font-size:16px;font-weight:800;color:var(--text);margin-bottom:8px}
.support-section p{color:var(--muted);font-size:12px;line-height:1.8;margin-bottom:24px}
.support-btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.btn-wpp{display:inline-flex;align-items:center;gap:8px;background:#25d36620;border:1px solid #25d36640;color:#25d366;font-family:'Syne',sans-serif;font-weight:700;font-size:12px;padding:11px 22px;border-radius:8px;text-decoration:none;transition:all .2s}
.btn-wpp:hover{background:#25d36630;border-color:#25d366;transform:translateY(-2px)}
.btn-portal{display:inline-flex;align-items:center;gap:8px;background:#00ff8712;border:1px solid #00ff8730;color:var(--green);font-family:'Syne',sans-serif;font-weight:700;font-size:12px;padding:11px 22px;border-radius:8px;text-decoration:none;transition:all .2s}
.btn-portal:hover{background:#00ff8722;border-color:var(--green);transform:translateY(-2px)}
footer{text-align:center;padding:28px;font-size:10px;color:var(--muted);border-top:1px solid var(--border)}
footer a{color:var(--muted);text-decoration:none}footer a:hover{color:var(--green)}
@media(max-width:520px){.coming-grid{grid-template-columns:1fr}.wip-card{padding:28px 20px}.header-links a{padding:5px 9px;font-size:10px}main{padding:40px 16px 60px}}
</style>
</head>
<body>
<header>
  <a href="/" class="logo">⚡ ZVM - LR1290</a>
  <div class="header-links">
    <a href="/">Portal</a>
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
</main>
<footer>
  <p>© ${new Date().getFullYear()} ZVM - LR1290 — <a href="/">Portal</a> · <a href="/faq">FAQ</a> · <a href="/privacidade">Privacidade</a></p>
</footer>
${CANVAS_BG}
</body></html>`;
}

// ─────────────────────────────────────────────
// PÁGINA: POLÍTICA DE PRIVACIDADE
// ─────────────────────────────────────────────
function renderPrivacyPage() {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM - LR1290 — Política de Privacidade</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3ELR%3C/text%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--green:#00ff87;--dark:#080810;--card:#0f0f1a;--border:#1c1c2e;--text:#e2e2f0;--muted:#5a5a7a;--radius:12px}
body{background:var(--dark);color:var(--text);font-family:'Space Mono',monospace;min-height:100vh}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 28px;border-bottom:1px solid var(--border);background:var(--card);position:sticky;top:0;z-index:50;box-shadow:0 2px 20px #00000060}
.logo{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:var(--green);text-decoration:none;display:flex;align-items:center;gap:8px}
.header-links{display:flex;gap:10px}
.header-links a{font-size:11px;color:var(--muted);text-decoration:none;padding:6px 13px;border:1px solid var(--border);border-radius:6px;transition:all .2s;font-family:'Syne',sans-serif;font-weight:700}
.header-links a:hover{color:var(--green);border-color:var(--green)}
main{max-width:720px;margin:0 auto;padding:56px 24px 80px}
.hero{margin-bottom:48px}
.hero-badge{display:inline-block;background:#00ff8712;border:1px solid #00ff8730;color:var(--green);font-size:10px;letter-spacing:2px;text-transform:uppercase;padding:5px 14px;border-radius:20px;margin-bottom:18px;font-family:'Syne',sans-serif}
.hero h1{font-family:'Syne',sans-serif;font-size:clamp(24px,4vw,36px);font-weight:800;margin-bottom:12px}
.hero-meta{font-size:11px;color:var(--muted);letter-spacing:1px}
.section{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:28px 32px;margin-bottom:14px}
.section h2{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:var(--green);margin-bottom:14px;display:flex;align-items:center;gap:8px}
.section p,.section li{font-size:12px;color:#b0b0c8;line-height:1.9;margin-bottom:10px}
.section ul{padding-left:18px}
.section li{margin-bottom:6px}
.section li::marker{color:var(--green)}
.section p:last-child,.section li:last-child{margin-bottom:0}
.highlight{background:#00ff8708;border:1px solid #00ff8720;border-radius:8px;padding:14px 18px;margin-top:14px}
.highlight p{color:var(--text);font-size:11px;margin:0}
.tag{display:inline-block;background:#1e1e2e;border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:10px;color:var(--muted);margin:2px;vertical-align:middle}
.contact-btn{display:inline-flex;align-items:center;gap:8px;background:#25d36618;border:1px solid #25d36630;color:#25d366;font-family:'Syne',sans-serif;font-weight:700;font-size:12px;padding:11px 22px;border-radius:8px;text-decoration:none;transition:all .2s;margin-top:14px}
.contact-btn:hover{background:#25d36628;transform:translateY(-2px);box-shadow:0 6px 20px #25d36625}
footer{text-align:center;padding:28px;font-size:10px;color:var(--muted);border-top:1px solid var(--border)}
footer a{color:var(--muted);text-decoration:none}footer a:hover{color:var(--green)}
@media(max-width:520px){main{padding:32px 16px 60px}.section{padding:20px 18px}.header-links a{padding:5px 9px;font-size:10px}}
</style>
</head>
<body>
<header>
  <a href="/" class="logo">⚡ ZVM - LR1290</a>
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
    <p>Esta Política descreve como o <strong style="color:var(--text)">ZVM - LR1290</strong> coleta, utiliza e protege seus dados ao usar o serviço de licenciamento da extensão ZapVoice.</p>
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
      <li><strong style="color:var(--text)">Identificador de dispositivo</strong> — gerado pela extensão para controle de sessão</li>
    </ul>
    <div class="highlight">
      <p>⚠️ <strong>Não coletamos</strong> mensagens, contatos, conversas ou qualquer conteúdo do WhatsApp. Nosso serviço não tem acesso ao conteúdo das suas comunicações.</p>
    </div>
  </div>
  <div class="section">
    <h2>🎯 Finalidade</h2>
    <p>Os dados são usados exclusivamente para:</p>
    <ul>
      <li>Validar e controlar o acesso à extensão ZapVoice</li>
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
  <div class="section">
    <h2>✅ Seus Direitos (LGPD)</h2>
    <p>Você tem direito a confirmar, acessar, corrigir, excluir seus dados e revogar o consentimento a qualquer momento. Para exercer qualquer direito, entre em contato:</p>
    <a class="contact-btn" href="https://wa.me/5521996771552?text=LR!%20Quero%20exercer%20meus%20direitos%20LGPD." target="_blank">💬 Solicitar via WhatsApp</a>
  </div>
</main>
<footer>
  <p>© ${new Date().getFullYear()} ZVM - LR1290 — <a href="/">Portal</a> · <a href="/faq">FAQ</a> · <a href="/privacidade">Privacidade</a></p>
</footer>
${CANVAS_BG}
</body></html>`;
}

// ─────────────────────────────────────────────
async function handleRequest(req, res) {
  const _corsH = {
    'Access-Control-Allow-Origin':  req.headers.origin || '*',
    'Access-Control-Allow-Methods': 'POST,GET,OPTIONS,DELETE',
    'Access-Control-Allow-Headers': 'Content-Type,x-app-date,x-app-sig,x-app-ts',
    'Access-Control-Max-Age':       '86400',
    'Vary':                         'Origin',
    'X-Content-Type-Options':       'nosniff',
    'X-Frame-Options':              'DENY',
    'X-Powered-By':                 'PHP/7.4.3',
  };
  Object.entries(_corsH).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p   = url.pathname;
  const ip  = getIp(req);

  // Ocultar /admin quando slug está ativo
  if (APP_SECRET && (p === '/admin' || p.startsWith('/admin/'))) {
    res.writeHead(404); res.end('Not found'); return;
  }

  console.log(`[${new Date().toISOString()}] ${req.method} ${p} — ${ip}`);

  // ── Health ──
  if (p === '/health' && req.method === 'GET') {
    sendJson(res, { ok: true, ts: Date.now(), keys: Object.keys(keys).length }); return;
  }

  // ── Extensão: login page ──
  if ((p === R_EXT+'/auth/' || p === R_EXT+'/auth') && req.method === 'GET') {
    const callback = url.searchParams.get('callback') || '';
    sendHtml(res, renderExtensionLogin({ callback })); return;
  }

  // ── Extensão: verifica chave e faz callback ──
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
      await saveKey(keyCode);
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
    await saveKey(keyCode);
    try {
      const cb = new URL(callback);
      cb.searchParams.set('key',         keyCode);
      cb.searchParams.set('keyId',       `id-${keyCode}`);
      cb.searchParams.set('ownerId',     'zv-owner');
      cb.searchParams.set('managerId',   'zv-manager');
      cb.searchParams.set('isPremium',   'true');
      cb.searchParams.set('isLoggedIn',  'true');
      cb.searchParams.set('planName',    'Pro');
      cb.searchParams.set('marketplace', 'premium');
      cb.searchParams.set('username',    keys[keyCode].label);
      cb.searchParams.set('email',       'cliente@zapvoice.com.br');
      cb.searchParams.set('plan_id',     'ZV_PRO');
      cb.searchParams.set('permissions', FULL_PERMISSIONS.join(','));
      res.writeHead(302, { Location: cb.toString() }); res.end();
    } catch {
      sendHtml(res, renderExtensionLogin({ callback, keyVal: keyCode, error: 'Callback inválido. Tente novamente.' }));
    }
    return;
  }

  // ── Extensão: /v3/key ──
  if (p === R_EXT+'/v3/key' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'api')) {
      sendJson(res, { authError: 'rateLimited', authErrorMessage: 'Muitas tentativas. Aguarde.', isLoggedIn: false }, 429);
      return;
    }
    const rawBody = await new Promise(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>r(b));});
    let body; try { body = JSON.parse(rawBody); } catch { body = {}; }
    const keyCode    = (body.authKey || '').toLowerCase();
    const phone      = body.phoneNumber || '-';
    const wppVersion = body.wppVersion  || '-';
    const deviceId   = body.deviceId    || '';

    if (!keyCode || !keys[keyCode]) {
      sendJson(res, { authError: 'keyNotFound', authErrorMessage: 'Chave não encontrada. Contate o vendedor.', isLoggedIn: false });
      addLog({ keyCode: keyCode||'?', label: '-', phone, ip, wppVersion, action: 'key_not_found' }).catch(()=>{});
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

    // Ativação diferida
    if (keys[keyCode].expireDuration && !keys[keyCode].expiresAt && keys[keyCode].phones.length >= 1) {
      const exp = new Date(Date.now() + keys[keyCode].expireDuration);
      keys[keyCode].expiresAt   = exp.toISOString();
      keys[keyCode].activatedAt = new Date().toISOString();
      console.log(`[DEFERRED] ${keyCode} ativada — expira: ${keys[keyCode].expiresAt}`);
    }

    keys[keyCode].lastUsed   = new Date().toISOString();
    keys[keyCode].lastIp     = ip;
    keys[keyCode].wppVersion = wppVersion;
    if (hasPhone) keys[keyCode].lastPhone = phone;
    if (deviceId) keys[keyCode].deviceId  = deviceId;

    const _et = generateToken();
    extSessions[_et] = { keyCode, expiresAt: new Date(Date.now() + 30*24*60*60*1000).toISOString() };
    const _authData  = getAuthData(keyCode, body.userName || '');
    _authData._zv_et = _et;
    sendJson(res, _authData);

    const _action = isNewPhone ? 'login_ok' : 'relogin_ok';
    addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: _action }).catch(()=>{});
    saveKey(keyCode).catch(()=>{});
    return;
  }

  // ── Extensão: check-status ──
  if (p === R_EXT+'/v3/check-status' && req.method === 'POST') {
    const rawBody = await new Promise(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>r(b));});
    let body; try { body = JSON.parse(rawBody); } catch { body = {}; }
    const keyCode = (body.authKey || '').toLowerCase();
    if (!serverReady) { sendJson(res, { active: true }); return; }
    if (!keyCode || !keys[keyCode]) { sendJson(res, { active: false, reason: 'not_found' }); return; }
    if (isKeyExpired(keys[keyCode]))   { sendJson(res, { active: false, reason: 'expired' }); return; }
    if (!keys[keyCode].active)         { sendJson(res, { active: false, reason: 'blocked' }); return; }
    sendJson(res, { active: true, expiringSoon: isKeyExpiringSoon(keys[keyCode]), hoursLeft: hoursUntilExpiry(keys[keyCode]) });
    return;
  }

  // ── Extensão: usage ──
  if ([R_EXT+'/v3/usage', R_EXT+'/v3/get-usage', R_EXT+'/v3/sync-usage'].includes(p)) {
    sendJson(res, { ok: true, status: true, limits: USAGE_LIMITS, expires_at: new Date(Date.now()+365*24*60*60*1000).toISOString(), isExpired: false });
    return;
  }

  // ── Admin: login ──
  if (p === R_ADMIN+'/login' && req.method === 'POST') {
    const form   = await parseFormBody(req);
    const credOk = form.get('user') === ADMIN_USER && form.get('pass') === ADMIN_PASS;
    const totpOk = verifyTOTP(TOTP_SECRET, (form.get('totp') || '').trim());
    if (credOk && totpOk) {
      const token = generateToken();
      sessions[token] = { expiresAt: new Date(Date.now() + 8*60*60*1000).toISOString() };
      res.setHeader('Set-Cookie', `zv_admin=${token}; Path=/; HttpOnly; SameSite=Strict`);
      res.writeHead(302, { Location: R_ADMIN }); res.end();
    } else {
      const msg = credOk && !totpOk ? 'Código 2FA inválido ou expirado' : 'Usuário ou senha incorretos';
      sendHtml(res, renderAdminLogin(msg));
    }
    return;
  }

  // ── Admin: logout ──
  if (p === R_ADMIN+'/logout') {
    res.setHeader('Set-Cookie', 'zv_admin=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    res.writeHead(302, { Location: R_ADMIN }); res.end(); return;
  }

  // ── Admin: painel ──
  if (p === R_ADMIN || p === R_ADMIN+'/') {
    if (!isAdminSession(req)) { sendHtml(res, renderAdminLogin()); return; }
    sendHtml(res, renderAdminDashboard()); return;
  }

  // ─────────────────────────────────────────────
  // MOD: login / logout / painel
  // ─────────────────────────────────────────────
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
    const matchedMod  = MODS.find(m => m.user === inputUser && m.pass === inputPass);
    const totpOk      = matchedMod ? verifyTOTP(matchedMod.totp, inputTotp) : false;
    if (matchedMod && totpOk) {
      const token = generateToken();
      modSessions[token] = { expiresAt: new Date(Date.now() + 8*60*60*1000).toISOString(), modName: matchedMod.name };
      res.setHeader('Set-Cookie', `zv_mod=${token}; Path=/; HttpOnly; SameSite=Strict`);
      res.writeHead(302, { Location: R_MOD }); res.end();
    } else {
      const msg = matchedMod && !totpOk ? 'Código 2FA inválido ou expirado' : 'Usuário ou senha incorretos';
      sendHtml(res, renderModLogin(msg));
    }
    return;
  }

  if (p === R_MOD+'/logout') {
    res.setHeader('Set-Cookie', 'zv_mod=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    res.writeHead(302, { Location: R_MOD }); res.end(); return;
  }

  if (p === R_MOD || p === R_MOD+'/') {
    if (MODS.length === 0) { res.writeHead(404); res.end('Not found'); return; }
    if (!isModSession(req)) { sendHtml(res, renderModLogin()); return; }
    const _mc2 = (req.headers.cookie || '').match(/zv_mod=([a-f0-9]+)/);
    const _ms2 = _mc2 ? modSessions[_mc2[1]] : null;
    sendHtml(res, renderModDashboard(_ms2 ? _ms2.modName : 'Moderador')); return;
  }

  // ── Mod API: criar chave ──
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
    await saveKey(code);
    sendJson(res, { ok: true, key: code }); return;
  }

  // ── Mod API: listar apenas as chaves criadas pelo moderador ──
  if (p === R_MOD+'/api/my-keys' && req.method === 'GET') {
    if (!isModSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    // Retorna apenas chaves com nota de moderador — sem dados sensíveis
    const myKeys = Object.entries(keys)
      .filter(([, k]) => {
        const _modCookie2 = (req.headers.cookie || '').match(/zv_mod=([a-f0-9]+)/);
        const _modSess2   = _modCookie2 ? modSessions[_modCookie2[1]] : null;
        const _myName     = _modSess2 ? _modSess2.modName : null;
        if (!_myName) return k.note && k.note.startsWith('[Mod:');
        return k.note && k.note.includes('[Mod: '+_myName+']');
      })
      .map(([code, k]) => ({
        code,
        label:     k.label,
        maxUses:   k.maxUses,
        active:    k.active && !isKeyExpired(k),
        expiresAt: k.expiresAt || null,
        deferred:  !!(k.expireDuration && !k.expiresAt),
        createdAt: k.createdAt,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    sendJson(res, { ok: true, keys: myKeys }); return;
  }

  // Helper para extrair código das rotas /api/keys/:code/...
  function extractCode(pattern) {
    const match = p.match(pattern);
    return match ? decodeURIComponent(match[1]) : null;
  }
  const RA = R_ADMIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ── Admin API: dados ──
  if (p === R_ADMIN+'/api/data' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const suspectKeys = Object.keys(keys).filter(code => {
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

  // ── Admin API: gerar chave ──
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
      maxUses: isNaN(maxUses) ? MAX_USES : maxUses, warnCount: 0
    };
    await saveKey(code);
    sendJson(res, { ok: true, key: code }); return;
  }

  // ── Admin API: toggle ──
  const codeToggle = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/toggle$`));
  if (codeToggle && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!keys[codeToggle]) { sendJson(res, { error: 'not found' }, 404); return; }
    keys[codeToggle].active = !keys[codeToggle].active;
    await saveKey(codeToggle);
    if (!keys[codeToggle].active) fireWebhook('key_blocked', codeToggle, 'Bloqueio manual pelo admin');
    sendJson(res, { ok: true, active: keys[codeToggle].active }); return;
  }

  // ── Admin API: renew ──
  const codeRenew = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/renew$`));
  if (codeRenew && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!keys[codeRenew]) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    const days=parseInt(body.days||0), hours=parseInt(body.hours||0), mins=parseInt(body.mins||0);
    if (!days && !hours && !mins) { sendJson(res, { error: 'nenhum tempo informado' }, 400); return; }
    const addMs = ((days*1440)+(hours*60)+mins)*60000;
    const base  = (keys[codeRenew].expiresAt && !isKeyExpired(keys[codeRenew]))
      ? new Date(keys[codeRenew].expiresAt).getTime() : Date.now();
    keys[codeRenew].expiresAt = new Date(base+addMs).toISOString();
    keys[codeRenew].active    = true;
    await saveKey(codeRenew);
    await addLog({ keyCode: codeRenew, label: keys[codeRenew].label, phone: '-', ip, wppVersion: '-', action: 'renewed' });
    sendJson(res, { ok: true, expiresAt: keys[codeRenew].expiresAt }); return;
  }

  // ── Admin API: max-uses ──
  const codeMaxUses = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/max-uses$`));
  if (codeMaxUses && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!keys[codeMaxUses]) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    const maxUses = parseInt(body.maxUses);
    if (isNaN(maxUses) || maxUses < -1) { sendJson(res, { error: 'invalid' }, 400); return; }
    keys[codeMaxUses].maxUses = maxUses;
    await saveKey(codeMaxUses);
    sendJson(res, { ok: true, maxUses }); return;
  }

  // ── Admin API: label ──
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

  // ── Admin API: phones GET ──
  const codePhonesGet = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/phones$`));
  if (codePhonesGet && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!keys[codePhonesGet]) { sendJson(res, { error: 'not found' }, 404); return; }
    sendJson(res, { ok: true, phones: keys[codePhonesGet].phones || [] }); return;
  }

  // ── Admin API: phones DELETE ──
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

  // ── Admin API: reset-warn ──
  const codeResetWarn = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/reset-warn$`));
  if (codeResetWarn && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!keys[codeResetWarn]) { sendJson(res, { error: 'not found' }, 404); return; }
    keys[codeResetWarn].warnCount = 0;
    await saveKey(codeResetWarn);
    sendJson(res, { ok: true }); return;
  }

  // ── Admin API: clear-suspect (marca IP histórico como verificado zerando logs suspeitos) ──
  const codeClearSuspect = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/clear-suspect$`));
  if (codeClearSuspect && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!keys[codeClearSuspect]) { sendJson(res, { error: 'not found' }, 404); return; }
    // Remove logs de IP das últimas 24h desta chave para zerar a contagem de suspeita
    const cutoff = new Date(Date.now() - 86400000).toISOString();
    logs = logs.filter(l => !(l.keyCode === codeClearSuspect && l.timestamp > cutoff));
    await saveLogs();
    await addLog({ keyCode: codeClearSuspect, label: keys[codeClearSuspect].label, phone: '-', ip, wppVersion: '-', action: 'suspect_cleared' });
    sendJson(res, { ok: true }); return;
  }

  // ── Admin API: nota ──
  const codeNote = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/note$`));
  if (codeNote && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!keys[codeNote]) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    keys[codeNote].note = String(body.note||'').slice(0, 500);
    await saveKey(codeNote);
    sendJson(res, { ok: true }); return;
  }

  // ── Admin API: deletar chave ──
  const codeDelete = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)$`));
  if (codeDelete && req.method === 'DELETE') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    delete keys[codeDelete];
    await deleteKeyFromDb(codeDelete);
    sendJson(res, { ok: true }); return;
  }

  // ── Admin API: logs DELETE ──
  if (p === R_ADMIN+'/api/logs' && req.method === 'DELETE') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const body = await parseBody(req);
    if (body.date) { logs = logs.filter(l => !l.timestamp.startsWith(body.date)); }
    else { logs = []; }
    await saveLogs();
    sendJson(res, { ok: true, remaining: logs.length }); return;
  }

  // ── Admin API: logs GET (com filtro de texto) ──
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

  // ── Admin API: exportar CSV ──
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
    res.setHeader('Content-Disposition', `attachment; filename="zapvoice-${new Date().toISOString().slice(0,10)}.csv"`);
    res.writeHead(200); res.end('\uFEFF' + csv); return;
  }

  // ── Payt webhook ──
  if (p === '/payt/webhook' && req.method === 'POST') {
    const rawBody = await new Promise(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>r(b));});
    if (PAYT_SECRET) {
      const token = req.headers['x-payt-token'] || req.headers['x-webhook-token'] || '';
      if (token !== PAYT_SECRET) {
        console.warn('[PAYT] Token inválido — ignorado');
        res.writeHead(401); res.end('Unauthorized'); return;
      }
    }
    let payload;
    try { payload = JSON.parse(rawBody); }
    catch { try { payload = Object.fromEntries(new URLSearchParams(rawBody).entries()); } catch { res.writeHead(400); res.end('Bad Request'); return; } }

    const status   = String(payload.status || payload.transaction_status || '').toLowerCase();
    const approved = ['approved','finished','paid','completed','finalizada','aprovada','venda_paga'].some(s => status.includes(s));
    if (!approved) { console.log('[PAYT] Status ignorado:', status); res.writeHead(200); res.end('ignored'); return; }

    const txId = String(payload.transaction_id || payload.id || '').trim();
    if (txId && Object.values(keys).some(k => k.note && k.note.includes('payt_tx:'+txId))) {
      console.log('[PAYT] Transação já processada:', txId);
      res.writeHead(200); res.end('ok'); return;
    }

    const customer    = payload.customer || payload.buyer || payload.client || {};
    const clientName  = customer.name || customer.full_name || payload.customer_name || 'Cliente';
    const clientEmail = customer.email || payload.customer_email || payload.email || '';
    const offer       = payload.offer || payload.product || {};
    const productName = (offer.name || offer.title || payload.product_name || payload.offer_name || '').toLowerCase();
    let maxUses = 3;
    if      (productName.includes('1') || productName.includes('individual') || productName.includes('solo')) maxUses = 1;
    else if (productName.includes('5') || productName.includes('multi')      || productName.includes('team')) maxUses = 5;
    else if (productName.includes('3') || productName.includes('trio'))                                       maxUses = 3;

    const code    = generateCode();
    const now     = new Date();
    const expires = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
    keys[code] = {
      label: 'PAYT - '+clientName, active: true, phones: [], uses: 0, maxUses,
      expiresAt: expires.toISOString(), expireDuration: 31*1440*60000,
      createdAt: now.toISOString(), lastUsed: null, lastIp: null, lastPhone: null,
      deviceId: null, wppVersion: null, warnCount: 0,
      note: 'Pedido automatico Payt | Email: '+clientEmail+(txId?' | payt_tx:'+txId:'')
    };
    await saveKey(code);
    console.log('[PAYT] Chave criada:', code, '| Cliente:', clientName, '| Email:', clientEmail, '| Usos:', maxUses);
    res.writeHead(200); res.end('ok'); return;
  }

  // ── Portal cliente: status ──
  if (p === '/client/status' && req.method === 'POST') {
    const body = await parseBody(req);
    const code = (body.key || '').trim().toLowerCase();
    if (!code || !keys[code]) { sendJson(res, { error: 'not_found' }, 404); return; }
    const k = keys[code];
    sendJson(res, {
      label:       k.label || 'Cliente',
      active:      k.active && !isKeyExpired(k),
      expired:     isKeyExpired(k),
      expiresAt:   k.expiresAt || null,
      activatedAt: k.activatedAt || null,
      lastUsed:    k.lastUsed || null,
      phones:      (k.phones || []).length,
      phoneList:   k.phones || [],
      maxUses:     k.maxUses === -1 ? null : (k.maxUses > 0 ? k.maxUses : MAX_USES),
      hoursLeft:   hoursUntilExpiry(k),
      deferred:    !!(k.expireDuration && !k.expiresAt),
      warnCount:   k.warnCount || 0,
    }); return;
  }

  // ── Portal cliente: remover número ──
  if (p === '/client/remove-phone' && req.method === 'POST') {
    const body    = await parseBody(req);
    const keyCode = (body.key||'').trim().toLowerCase();
    const phone   = (body.phone||'').trim();
    if (!keyCode || !keys[keyCode]) { sendJson(res, { error: 'not_found' }, 404); return; }
    if (!phone) { sendJson(res, { error: 'phone obrigatorio' }, 400); return; }
    const phones = keys[keyCode].phones || [];
    if (!phones.includes(phone)) { sendJson(res, { error: 'numero nao encontrado' }, 404); return; }
    keys[keyCode].phones  = phones.filter(p => p !== phone);
    keys[keyCode].uses    = keys[keyCode].phones.length;
    if (keys[keyCode].lastPhone === phone) keys[keyCode].lastPhone = keys[keyCode].phones.at(-1) || null;
    saveKey(keyCode).catch(()=>{});
    sendJson(res, { ok: true, phones: keys[keyCode].phones }); return;
  }

  // ── Redirects ──
  if (req.method === 'GET' && (p === '/dashboard/backup-fixer' || p === '/dashboard/converter')) {
    res.writeHead(302, { Location: 'https://app.zapvoice.com.br' + p }); res.end(); return;
  }

  // ── FAQ ──
  if (p === '/faq' && req.method === 'GET') {
    sendHtml(res, renderFaqPage()); return;
  }

  // ── Privacidade ──
  if (p === '/privacidade' && req.method === 'GET') {
    sendHtml(res, renderPrivacyPage()); return;
  }

  // ── Privacidade ──
  if (p === '/privacidade' && req.method === 'GET') {
    sendHtml(res, renderPrivacyPage()); return;
  }

  // ── Portal cliente: rotas públicas ──
  const CLIENT_PATHS = ['/', '/plans/manage', '/plans/new', '/dashboard/chaves'];
  if (req.method === 'GET' && (CLIENT_PATHS.includes(p) || p.startsWith('/unauthorized') || p.startsWith('/funnels') || p.startsWith('/labels'))) {
    sendHtml(res, renderClientPortal()); return;
  }

  sendJson(res, { ok: true });
}

// ─────────────────────────────────────────────
// INICIALIZAÇÃO
// ─────────────────────────────────────────────
(async () => {
  try {
    const loaded = await loadDb();
    keys = loaded.keys || {};
    logs = loaded.logs || [];
    serverReady = true;

    console.log(`✅ zvm-lr1290 v8 — porta ${PORT}`);
    console.log(`🍃 MongoDB: conectado | Chaves: ${Object.keys(keys).length} | Logs: ${logs.length}`);
    console.log(`🔐 HMAC: ${APP_SECRET ? 'ATIVO' : '⚠ inativo — defina APP_SECRET'}`);
    console.log(`🔑 2FA:  ${TOTP_SECRET ? 'ATIVO' : '⚠ inativo — defina TOTP_SECRET'}`);
    console.log(`💳 Payt: ${PAYT_SECRET ? 'ATIVO' : '⚠ inativo — defina PAYT_SECRET'}`);
    console.log(`🔑 Admin: ${R_ADMIN} | User: ${ADMIN_USER}`);
    console.log(`👮 Mod:   ${MODS.length > 0 ? R_MOD+' | '+MODS.length+' moderador(es): '+MODS.map(m=>m.name).join(', ') : '⚠ inativo — defina MOD_USER e MOD_PASS'}`);
    console.log(`🌐 Extension: ${R_EXT}/v3/key`);
    console.log(`📊 Webhook: ${WEBHOOK_URL || 'não configurado'}`);
    console.log(`🗂  Retenção de logs: ${LOG_RETENTION_DAYS} dias (LGPD) | Máx em memória: ${LOG_MAX}`);

    const safeHandler = (req, res) => {
      handleRequest(req, res).catch(err => {
        console.error(`[ERRO] ${req.method} ${req.url}:`, err);
        if (!res.headersSent) { res.writeHead(500); res.end('Internal Server Error'); }
      });
    };

    process.on('uncaughtException',  err => console.error('[uncaughtException]', err));
    process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));

    http.createServer(safeHandler).listen(PORT, () => {
      console.log(`🚀 Servidor ouvindo na porta ${PORT}`);
      // Keep-alive para Render free tier
      setInterval(() => {
        http.get({ hostname: 'localhost', port: PORT, path: '/health' }, res => {
          res.resume();
          console.log('[keep-alive] ping OK ' + res.statusCode);
        }).on('error', err => console.warn('[keep-alive] erro: ' + err.message));
      }, 4 * 60 * 1000);
    });
  } catch (e) {
    console.error('❌ Falha ao iniciar:', e.message);
    process.exit(1);
  }
})();
