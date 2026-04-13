const http = require('http');
const crypto = require('crypto');
// fs ainda usado para nada — mongodb substituiu persistência
// Mantido para compatibilidade caso algum trecho use path
const path = require('path');
const { MongoClient } = require('mongodb');

const PORT       = process.env.PORT       || 3000;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
if (!ADMIN_USER || !ADMIN_PASS) {
  console.error('❌ ERRO CRÍTICO: Defina as variáveis de ambiente ADMIN_USER e ADMIN_PASS antes de iniciar.');
  console.error('   No Render.com: Settings > Environment Variables');
  process.exit(1);
}

// ─────────────────────────────────────────────
// PERSISTÊNCIA — MongoDB Atlas
// MONGODB_URI: variável de ambiente com a connection string
// Formato: mongodb+srv://user:pass@cluster.mongodb.net/zapvoice
// ─────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI || '';

let _mongoClient = null;
let _mongoDb     = null;

async function getMongoDb() {
  if (_mongoDb) return _mongoDb;
  if (!MONGODB_URI) throw new Error('MONGODB_URI não configurado');
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

// loadDb: carrega keys e logs do MongoDB (chamado na inicialização)
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
    console.error('[DB] Erro ao carregar do MongoDB:', e.message);
    return { keys: {}, logs: [] };
  }
}

// saveDb: persiste keys e logs no MongoDB
// Usa upsert para não duplicar documentos
async function saveDb() {
  try {
    const db = await getMongoDb();
    await Promise.all([
      db.collection('store').updateOne(
        { _id: 'keys' },
        { $set: { _id: 'keys', data: keys, updatedAt: new Date() } },
        { upsert: true }
      ),
      db.collection('store').updateOne(
        { _id: 'logs' },
        { $set: { _id: 'logs', data: logs, updatedAt: new Date() } },
        { upsert: true }
      ),
    ]);
  } catch (e) {
    console.error('[DB] Erro ao salvar no MongoDB:', e.message);
  }
}

// Variáveis globais — preenchidas após conectar
let keys        = {};
let logs        = [];
let sessions    = {};      // sessões admin
let serverReady = false;   // true após loadDb() — evita logout por dados ainda não carregados
let extSessions = {};   // sessões de extensão: token → { keyCode, expiresAt }

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
const MAX_USES     = 3;

// Aviso de expiração antecipado: quantas horas antes mostrar banner
const EXPIRY_WARN_HOURS = parseInt(process.env.EXPIRY_WARN_HOURS || '48');

// Webhook (opcional): URL para notificar bloqueio/expiração
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';

// ─────────────────────────────────────────────
// SEGURANÇA — variáveis de ambiente opcionais
// Sem elas o servidor funciona normalmente (retrocompatível)
// ─────────────────────────────────────────────

// CAMADA 1 — HMAC request signing
// APP_SECRET: string secreta definida no Render → Environment Variables
// A extensão assina cada req com HMAC-SHA256(ts + '.' + body)
const APP_SECRET       = process.env.APP_SECRET || '';
// Se APP_SECRET for uma string hex válida, converte para Buffer de bytes
// para que o HMAC use os mesmos bytes que o patcher usa (Uint8Array decimal)
const APP_SECRET_KEY = (() => {
  if (!APP_SECRET) return '';
  if (/^[0-9a-fA-F]+$/.test(APP_SECRET) && APP_SECRET.length % 2 === 0) {
    return Buffer.from(APP_SECRET, 'hex');
  }
  return APP_SECRET; // string normal
})();
const HMAC_TOLERANCE   = 5 * 60 * 1000; // 5 min tolerância de clock

function verifyHmac(rawBody, sig, ts) {
  if (!APP_SECRET_KEY) return true;  // sem secret configurado → passa sempre
  if (!sig && !ts) return true;  // extensão sem patch → não envia headers → passa
  if (!sig || !ts) return false; // enviou um mas não o outro → suspeito → bloqueia
  const t = parseInt(ts, 10);
  if (isNaN(t) || Math.abs(Date.now() - t) > HMAC_TOLERANCE) return false; // replay attack
  const expected = crypto.createHmac('sha256', APP_SECRET_KEY)
    .update(ts + '.' + rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(sig,'hex'), Buffer.from(expected,'hex')); }
  catch { return false; }
}

// Verifica token de sessão da extensão (emitido no /auth/verify)
// Mais seguro que HMAC hardcoded: sem segredo no JS do cliente
function verifyExtToken(token, keyCode) {
  if (!token) return false;
  const s = extSessions[token];
  if (!s) return false;
  if (new Date() > new Date(s.expiresAt)) { delete extSessions[token]; return false; }
  if (keyCode && s.keyCode !== keyCode) return false;
  return true;
}

// CAMADA 2 — Criptografia em repouso
// Com MongoDB Atlas, os dados são cifrados nativamente pelo Atlas (AES-256)
// DB_SECRET não é mais necessário — pode ser removido das variáveis de ambiente

// ─────────────────────────────────────────────
// 2FA TOTP — Google Authenticator compatível
// TOTP_SECRET: variável de ambiente em Base32
// Se não definido, 2FA fica desativado
// ─────────────────────────────────────────────
const TOTP_SECRET = process.env.TOTP_SECRET || '';

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
  const code  = ((hmac.readUInt32BE(off) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
  return code;
}

function verifyTOTP(secret, token) {
  if (!secret) return true; // 2FA não configurado → passa
  if (!token || token.length !== 6) return false;
  // Verificar janela atual ± 1 (tolerância de 30s de clock skew)
  for (const w of [-1, 0, 1]) {
    if (generateTOTP(secret, w) === token) return true;
  }
  return false;
}

// CAMADA 3 — Rotas ofuscadas derivadas do APP_SECRET
// Sem APP_SECRET as rotas ficam /admin e /extension (retrocompatível)
function deriveSlug(seed) {
  if (!APP_SECRET) return null;
  return crypto.createHmac('sha256', APP_SECRET).update(seed).digest('hex').slice(0, 14); // usa string original para manter URL estável
}
const _slugAdmin = deriveSlug('admin-panel');
const R_ADMIN    = _slugAdmin ? '/' + _slugAdmin : '/admin';
const R_EXT      = '/extension'; // rotas da extensão SEMPRE fixas — patcher usa URL hardcoded

// CAMADA 4 — IP blocklist permanente (em memória, limpa ao reiniciar)
// Camada 4 removida — ban por rota causava auto-bloqueio do admin

// ─────────────────────────────────────────────
// RATE LIMITING (anti brute-force)
// ─────────────────────────────────────────────
const rateLimitMap = new Map(); // ip+type -> { count, resetAt, blockedUntil }

// Limites separados por tipo de uso:
// 'login'  — página de ativação manual (mais restrito)
// 'api'    — /v3/key e /v3/check-status (extensão chama automaticamente)
const RL_CONFIG = {
  login: { max: 5,  windowMs: 60000,      blockMs: 10 * 60000 }, // 5 tentativas/min → bloqueia 10min
  api:   { max: 30, windowMs: 60000,      blockMs:  2 * 60000 }, // 30 chamadas/min  → bloqueia 2min
};

function checkRateLimit(ip, type = 'api') {
  const now = Date.now();
  const key = ip + ':' + type;
  const cfg = RL_CONFIG[type] || RL_CONFIG.api;
  let e = rateLimitMap.get(key);

  // Entrada nova ou janela expirada — mas só resetar se não estiver no período de bloqueio
  if (!e) {
    e = { count: 0, resetAt: now + cfg.windowMs, blockedUntil: 0 };
    rateLimitMap.set(key, e);
  }

  // Ainda bloqueado?
  if (now < e.blockedUntil) return false;

  // Janela expirou e não está mais bloqueado → resetar contador
  if (now > e.resetAt) {
    e.count = 0;
    e.resetAt = now + cfg.windowMs;
    e.blockedUntil = 0;
  }

  e.count++;
  if (e.count > cfg.max) {
    e.blockedUntil = now + cfg.blockMs;
    console.warn(`[RATE-LIMIT] ${type} — IP bloqueado por ${cfg.blockMs/60000}min: ${ip}`);
    return false;
  }
  return true;
}

function getRateLimitWait(ip, type = 'login') {
  const key = ip + ':' + type;
  const e = rateLimitMap.get(key);
  if (!e || Date.now() >= e.blockedUntil) return 0;
  return Math.ceil((e.blockedUntil - Date.now()) / 60000);
}

// Limpar entradas antigas a cada 15 min
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of rateLimitMap.entries())
    if (now > e.blockedUntil && now > e.resetAt) rateLimitMap.delete(k);
}, 15 * 60000);

// ─────────────────────────────────────────────
// WEBHOOK
// ─────────────────────────────────────────────
async function fireWebhook(event, keyCode, reason) {
  if (!WEBHOOK_URL) return;
  const k = keys[keyCode];
  const payload = {
    event,       // 'key_blocked' | 'key_expired'
    keyCode,
    label:       k?.label || '-',
    phone:       k?.lastPhone || '-',
    reason,
    timestamp:   new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  };
  try {
    const { default: https } = await import(WEBHOOK_URL.startsWith('https') ? 'https' : 'http');
    const url = new URL(WEBHOOK_URL);
    const data = JSON.stringify(payload);
    const options = {
      hostname: url.hostname, port: url.port || (WEBHOOK_URL.startsWith('https') ? 443 : 80),
      path: url.pathname + url.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options);
    req.on('error', e => console.warn('[WEBHOOK] Erro:', e.message));
    req.write(data); req.end();
  } catch (e) { console.warn('[WEBHOOK] Falha:', e.message); }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function generateKey() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const seg = () => Array.from({length:5}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  return `zv-${seg()}-${seg()}-${seg()}`;
}
function generateToken() { return crypto.randomBytes(32).toString('hex'); }

function getAuthData(keyCode) {
  return {
    numberWarning: false, segments: [],
    isLoggedIn: true, isPremium: true, // raiz — usado pelo refreshPremium no newInterval
    data: {
      key: keyCode, keyId: `id-${keyCode}`, ownerId: 'zv-owner', managerId: 'zv-manager',
      permissions: FULL_PERMISSIONS, username: keys[keyCode]?.label || 'Cliente ZapVoice',
      paymentUrl: null, marketplace: 'premium', email: 'cliente@zapvoice.com.br',
      planName: 'Pro', plan_id: 'ZV_PRO', isLoggedIn: true, isPremium: true, isBasicPlan: false
    }
  };
}

// Ações que podem ser duplicadas por múltiplas chamadas em curto intervalo
// relogin_ok: dedup de 8h (uma sessão típica — não poluir log com polling)
// expired/login_blocked: dedup de 5min (evitar spam mas registrar se reocorrer)
// login_ok: sem dedup — sempre registrar novo número
const DEDUP_WINDOWS = {
  'relogin_ok':    8 * 60 * 60 * 1000, // 8 horas
  'expired':       5 * 60 * 1000,       // 5 minutos
  'login_blocked': 5 * 60 * 1000,       // 5 minutos
};

async function addLog(entry) {
  const dedupMs = DEDUP_WINDOWS[entry.action];
  if (dedupMs) {
    const cutoff = Date.now() - dedupMs;
    const isDup = logs.some(l =>
      l.keyCode === entry.keyCode &&
      l.action  === entry.action  &&
      new Date(l.timestamp).getTime() > cutoff
    );
    if (isDup) return;
  }
  logs.unshift({ ...entry, timestamp: new Date().toISOString() });
  if (logs.length > 500) logs = logs.slice(0, 500);
  await saveDb();
}

function isKeyExpired(k) {
  if (!k.expiresAt) return false;
  return new Date() > new Date(k.expiresAt);
}

function isKeyExpiringSoon(k) {
  if (!k.expiresAt || isKeyExpired(k)) return false;
  const msLeft = new Date(k.expiresAt) - new Date();
  return msLeft <= EXPIRY_WARN_HOURS * 3600000;
}

function hoursUntilExpiry(k) {
  if (!k.expiresAt) return null;
  return Math.max(0, Math.floor((new Date(k.expiresAt) - new Date()) / 3600000));
}

function getIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket.remoteAddress || 'N/A';
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
// PÁGINA DE LOGIN DA EXTENSÃO
// ─────────────────────────────────────────────
function renderExtensionLogin({ callback, error = '', keyVal = '' }) {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZapVoice — Ativação</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0f;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Space Mono',monospace}
.card{background:#111118;border:1px solid #1e1e2e;border-radius:18px;padding:36px 32px;width:100%;max-width:420px;text-align:center}
.logo{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:#00ff87;margin-bottom:4px}
.sub{color:#6b6b8a;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-bottom:28px}
label{display:block;text-align:left;font-size:10px;letter-spacing:2px;color:#6b6b8a;text-transform:uppercase;margin-bottom:8px}
input{width:100%;padding:13px 16px;background:#0a0a0f;border:1.5px solid #1e1e2e;border-radius:10px;color:#00ff87;font-family:'Space Mono',monospace;font-size:15px;outline:none;letter-spacing:2px;transition:border .2s}
input:focus{border-color:#00ff87}
.err{background:#ff475715;border:1px solid #ff4757;border-radius:8px;color:#ff4757;padding:11px 14px;font-size:12px;margin-bottom:18px;text-align:left}
.btn{width:100%;padding:14px;background:#00ff87;border:none;border-radius:10px;color:#000;font-family:'Syne',sans-serif;font-weight:700;font-size:15px;cursor:pointer;margin-top:20px;transition:opacity .2s}
.btn:hover{opacity:.85}
.hint{margin-top:20px;color:#6b6b8a;font-size:11px}
.hint a{color:#00ff87;text-decoration:none}
</style>
</head><body>
<div class="card">
  <div class="logo">⚡ ZapVoice</div>
  <div class="sub">Ativação da Extensão</div>
  ${error ? `<div class="err">${escHtml(error)}</div>` : ''}
  <form method="POST" action="/extension/auth/verify">
    <input type="hidden" name="callback" value="${escHtml(callback)}">
    <label>Sua Chave de Ativação</label>
    <input type="text" name="key" value="${escHtml(keyVal)}" placeholder="zv-xxxxx-xxxxx-xxxxx" autocomplete="off" spellcheck="false">
    <p style="text-align:left;font-size:11px;color:#6b6b8a;margin-top:8px">Você recebeu esta chave junto com a sua compra.</p>
    <button type="submit" class="btn">Ativar Agora</button>
  </form>
  <div class="hint">precisa de ajuda?<br>Entre em contato com o vendedor<br><a href="https://dfg.com.br/user/lr1290" target="_blank">dfg.com.br/user/lr1290</a></div>
</div>
</body></html>`;
}

// ─────────────────────────────────────────────
// ADMIN: LOGIN
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// PORTAL DO CLIENTE
// ─────────────────────────────────────────────
function renderClientPortal() {
  const BASE = `https://zapvoice-test-key-server.onrender.com`;
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZapVoice — Portal do Cliente</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0f;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Space Mono',monospace;padding:20px}
.wrap{width:100%;max-width:460px}
.card{background:#111118;border:1px solid #1e1e2e;border-radius:18px;padding:36px 32px;text-align:center}
.logo{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:#00ff87;margin-bottom:4px}
.sub{color:#6b6b8a;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-bottom:28px}
label{display:block;text-align:left;font-size:10px;letter-spacing:2px;color:#6b6b8a;text-transform:uppercase;margin-bottom:8px}
input{width:100%;padding:13px 16px;background:#0a0a0f;border:1.5px solid #1e1e2e;border-radius:10px;color:#00ff87;font-family:'Space Mono',monospace;font-size:15px;outline:none;letter-spacing:2px;transition:border .2s}
input:focus{border-color:#00ff87}
.btn{width:100%;padding:14px;background:#00ff87;border:none;border-radius:10px;color:#000;font-family:'Syne',sans-serif;font-weight:700;font-size:15px;cursor:pointer;margin-top:16px;transition:opacity .2s}
.btn:hover{opacity:.85}
.btn:disabled{opacity:.4;cursor:not-allowed}
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
.hint{margin-top:22px;color:#6b6b8a;font-size:11px;line-height:1.8}
.hint a{color:#00ff87;text-decoration:none}
.expire-bar-wrap{margin-top:6px;background:#1e1e2e;border-radius:6px;overflow:hidden;height:5px}
.expire-bar{height:5px;border-radius:6px;transition:width .6s}
.section-links{margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.link-btn{padding:12px 8px;background:#0a0a0f;border:1px solid #1e1e2e;border-radius:10px;color:#e2e2f0;font-family:'Space Mono',monospace;font-size:11px;text-align:center;text-decoration:none;transition:border-color .2s,color .2s;display:block;line-height:1.6}
.link-btn:hover{border-color:#00ff87;color:#00ff87}
.spinner{display:inline-block;width:15px;height:15px;border:2px solid #00ff8730;border-top-color:#00ff87;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:8px}
@keyframes spin{to{transform:rotate(360deg)}}
.loading-overlay{position:fixed;inset:0;background:#0a0a0f;display:flex;align-items:center;justify-content:center;z-index:99}
.loading-overlay .spinner{width:28px;height:28px;border-width:3px}
</style>
</head><body>
<div id="loading-overlay" class="loading-overlay"><span class="spinner"></span></div>
<div class="wrap">
  <div class="card">
    <div class="logo">⚡ ZapVoice</div>
    <div class="sub">Portal do Cliente</div>

    <div id="form-area">
      <div id="err-box" class="err" style="display:none"></div>
      <label>Sua Chave de Ativação</label>
      <input type="text" id="key-input" placeholder="zv-xxxxx-xxxxx-xxxxx" autocomplete="off" spellcheck="false">
      <p style="text-align:left;font-size:11px;color:#6b6b8a;margin-top:8px">Você recebeu esta chave junto com a sua compra.</p>
      <button class="btn" id="check-btn" onclick="checkKey()">Consultar Minha Chave</button>
    </div>

    <div class="panel" id="result-panel">
      <div class="panel-title" id="panel-name">Minha Conta</div>
      <div class="row">
        <span class="row-label">Status</span>
        <span class="row-val" id="r-status"></span>
      </div>
      <div class="row">
        <span class="row-label">Dispositivos</span>
        <span class="row-val" id="r-phones"></span>
      </div>
      <div class="row">
        <span class="row-label">Expira em</span>
        <span class="row-val">
          <span id="r-expires"></span>
          <div class="expire-bar-wrap" id="r-bar-wrap" style="display:none">
            <div class="expire-bar" id="r-bar"></div>
          </div>
        </span>
      </div>
      <div class="row" id="r-act-row" style="display:none">
        <span class="row-label">Ativada em</span>
        <span class="row-val" id="r-activated"></span>
      </div>
      <div class="row" id="r-last-row" style="display:none">
        <span class="row-label">Último uso</span>
        <span class="row-val" id="r-lastused"></span>
      </div>
      <div id="r-phone-section" style="display:none;margin-top:14px">
        <div style="font-size:11px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Dispositivos cadastrados</div>
        <div id="r-phone-list"></div>
        <div style="font-size:10px;color:var(--muted);margin-top:8px">Remova um número para liberar o slot e entrar em outro dispositivo.</div>
      </div>
      <div class="section-links" id="r-links"></div>
      <button class="btn" style="margin-top:16px;background:#1e1e2e;color:#6b6b8a;font-size:12px" onclick="resetPanel()">← Consultar outra chave</button>
    </div>

    <div class="hint">Precisa de ajuda?<br>Entre em contato com o vendedor<br><a href="https://dfg.com.br/user/lr1290" target="_blank">dfg.com.br/user/lr1290</a></div>
  </div>
</div>
<script>
const API_BASE = '${BASE}';

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'})+' '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}
function fmtHours(h) {
  if (h===null||h===undefined) return null;
  if (h>=48) return Math.floor(h/24)+' dias';
  if (h>=1) return h+'h';
  return 'menos de 1h';
}

async function doCheck(key) {
  const errBox = document.getElementById('err-box');
  const btn    = document.getElementById('check-btn');
  errBox.style.display = 'none';
  if (!key) { errBox.textContent='⚠️ Digite sua chave de ativação.'; errBox.style.display='block'; return; }
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Consultando...';
  try {
    const r = await fetch(API_BASE+'/client/status', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({key})
    });
    const d = await r.json();
    if (!r.ok || d.error) {
      errBox.textContent = '❌ Chave não encontrada. Verifique se digitou corretamente.';
      errBox.style.display = 'block';
      btn.disabled=false; btn.textContent='Consultar Minha Chave';
      return;
    }
    showPanel(d, key);
  } catch(e) {
    errBox.textContent = '⚠️ Erro de conexão. Tente novamente.';
    errBox.style.display = 'block';
    btn.disabled=false; btn.textContent='Consultar Minha Chave';
  }
}

function checkKey() {
  const key = document.getElementById('key-input').value.trim().toLowerCase();
  doCheck(key);
}

function showPanel(d, key) {
  document.getElementById('form-area').style.display = 'none';
  document.getElementById('result-panel').style.display = 'block';
  document.getElementById('panel-name').textContent = '👤 '+d.label;

  let badge;
  if (d.deferred)                                       badge='<span class="badge badge-def">Aguardando 1º uso</span>';
  else if (!d.active && d.expired)                      badge='<span class="badge badge-off">Expirada</span>';
  else if (!d.active)                                   badge='<span class="badge badge-off">Bloqueada</span>';
  else if (d.hoursLeft!==null && d.hoursLeft<48)        badge='<span class="badge badge-warn">Expirando em breve</span>';
  else                                                  badge='<span class="badge badge-on">Ativa</span>';
  document.getElementById('r-status').innerHTML = badge;

  const maxTxt = d.maxUses===null ? '∞' : d.maxUses;
  document.getElementById('r-phones').textContent = d.phones+' / '+maxTxt;

  const expEl=document.getElementById('r-expires'), barWrap=document.getElementById('r-bar-wrap'), bar=document.getElementById('r-bar');
  if (d.deferred) {
    expEl.textContent='Ativa ao 1º uso'; barWrap.style.display='none';
  } else if (d.expired) {
    expEl.textContent='Expirada em '+fmtDate(d.expiresAt); barWrap.style.display='none';
  } else if (d.expiresAt) {
    const tl=fmtHours(d.hoursLeft);
    expEl.textContent=fmtDate(d.expiresAt)+(tl?' ('+tl+' restantes)':'');
    if (d.hoursLeft!==null) {
      barWrap.style.display='block';
      const pct=Math.min(100,Math.max(2,(d.hoursLeft/(24*30))*100));
      bar.style.width=pct+'%';
      bar.style.background=d.hoursLeft<24?'#ff4757':d.hoursLeft<72?'#ffa500':'#00ff87';
    }
  } else { expEl.textContent='Sem expiração'; barWrap.style.display='none'; }

  if (d.activatedAt) { document.getElementById('r-act-row').style.display='flex'; document.getElementById('r-activated').textContent=fmtDate(d.activatedAt); }
  if (d.lastUsed)    { document.getElementById('r-last-row').style.display='flex'; document.getElementById('r-lastused').textContent=fmtDate(d.lastUsed); }

  document.getElementById('r-links').innerHTML=
    '<a class="link-btn" href="https://app.zapvoice.com.br/dashboard/backup-fixer" target="_blank">🔧 Corrija<br>Backups</a>'+
    '<a class="link-btn" href="https://app.zapvoice.com.br/dashboard/converter" target="_blank">🎵 Converta<br>Áudios</a>';

  // Seção de gerenciamento de números
  if (d.phoneList && d.phoneList.length > 0) {
    const phoneSec = document.getElementById('r-phone-section');
    phoneSec.style.display = 'block';
    const ul = document.getElementById('r-phone-list');
    ul.innerHTML = '';
    d.phoneList.forEach(function(ph) {
      const li = document.createElement('div');
      li.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #1c1c2e';
      li.innerHTML = '<span style="font-size:13px;font-family:monospace;color:#e2e2f0">'+ph+'</span>'
        + '<button onclick="clientRemovePhone(\\"'+key+'\\",\\"'+ph+'\\")" style="padding:4px 12px;background:#ff4757;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:12px">Remover</button>';
      ul.appendChild(li);
    });
  } else {
    document.getElementById('r-phone-section').style.display = 'none';
  }
}


function resetPanel() {
  document.getElementById('form-area').style.display='block';
  document.getElementById('result-panel').style.display='none';
  document.getElementById('r-act-row').style.display='none';
  document.getElementById('r-last-row').style.display='none';
  const btn=document.getElementById('check-btn');
  btn.disabled=false; btn.textContent='Consultar Minha Chave';
}

async function clientRemovePhone(key, phone) {
  if (!confirm('Remover o numero ' + phone + ' desta chave?')) return;
  try {
    const r = await fetch(API_BASE+'/client/remove-phone', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({key: key, phone: phone})
    });
    const d = await r.json();
    if (d.ok) {
      alert('Numero removido! Voce pode fazer login novamente no WhatsApp Web.');
      doCheck(key);
    } else {
      alert('Erro: ' + (d.error || '?'));
    }
  } catch(e) { alert('Erro de rede.'); }
}

document.getElementById('key-input').addEventListener('keydown', e=>{ if(e.key==='Enter') checkKey(); });

// ── Auto-checagem: lê ?key= da URL (passado pelo botão engrenagem da extensão) ──
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const autoKey = (params.get('key') || '').trim().toLowerCase();
  if (autoKey) {
    // Tem chave na URL: ocultar tudo e carregar direto
    document.getElementById('loading-overlay').style.display = 'flex';
    document.getElementById('form-area').style.display = 'none';
    doCheck(autoKey).finally(() => {
      document.getElementById('loading-overlay').style.display = 'none';
    });
  } else {
    // Sem chave: mostrar formulário normalmente
    document.getElementById('loading-overlay').style.display = 'none';
  }
});
</script>
</body></html>`;
}

function renderAdminLogin(error = '') {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZapVoice Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0f;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Space Mono',monospace}
.card{background:#111118;border:1px solid #1e1e2e;border-radius:18px;padding:40px 36px;width:360px}
.logo{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:#00ff87;margin-bottom:20px;text-align:center}
label{display:block;font-size:10px;letter-spacing:2px;color:#6b6b8a;text-transform:uppercase;margin-bottom:7px}
input{width:100%;padding:11px 14px;background:#0a0a0f;border:1px solid #1e1e2e;border-radius:8px;color:#e2e2f0;font-family:'Space Mono',monospace;font-size:13px;outline:none;margin-bottom:16px}
input:focus{border-color:#00ff87}
.btn{width:100%;padding:12px;background:#00ff87;border:none;border-radius:8px;color:#000;font-family:'Syne',sans-serif;font-weight:700;font-size:14px;cursor:pointer}
.err{background:#ff475715;border:1px solid #ff4757;border-radius:6px;color:#ff4757;padding:9px 12px;font-size:12px;margin-bottom:16px}
</style></head><body>
<div class="card">
  <div class="logo">⚡ ZapVoice Admin</div>
  ${error ? `<div class="err">${escHtml(error)}</div>` : ''}
  <form method="POST" action="${R_ADMIN}/login">
    <label>Usuário</label><input type="text" name="user" autocomplete="off">
    <label>Senha</label><input type="password" name="pass">
    ${TOTP_SECRET ? `<label>Código 2FA</label><input type="text" name="totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" autocomplete="one-time-code" style="letter-spacing:4px;font-size:18px;text-align:center">` : ''}
    <button type="submit" class="btn">Entrar</button>
  </form>
</div></body></html>`;
}

// ─────────────────────────────────────────────
// ADMIN: DASHBOARD — HTML builders
// ─────────────────────────────────────────────
function buildKeysHtml() {
  const entries = Object.entries(keys);
  if (!entries.length) return `<tr><td colspan="10" class="empty">Nenhuma chave cadastrada</td></tr>`;
  return entries.map(([code, k]) => {
    const expired   = isKeyExpired(k);
    const warnSoon  = isKeyExpiringSoon(k);
    const expHtml   = (!k.expiresAt && k.expireDuration) ? (() => {
      // Chave diferida — mostrar duração configurada
      const total = k.expireDuration;
      const d = Math.floor(total / 86400000);
      const h = Math.floor((total % 86400000) / 3600000);
      const m = Math.floor((total % 3600000) / 60000);
      const parts = [];
      if (d > 0) parts.push(d+'d');
      if (h > 0) parts.push(h+'h');
      if (m > 0) parts.push(m+'m');
      return `<br><span style="color:var(--blue);font-size:10px" title="Tempo começa na 1ª ativação">⏱ Ao ativar: ${parts.join(' ')}</span>`;
    })() : k.expiresAt ? (() => {
      const exp = new Date(k.expiresAt), now = new Date();
      const diffMs = exp - now;
      const diffH  = Math.floor(diffMs / 36e5);
      const diffM  = Math.floor((diffMs % 36e5) / 60000);
      const diffD  = Math.floor(diffMs / 864e5);
      let label;
      if (expired)     label = 'expirado';
      else if (diffH < 1)  label = `exp: ${diffM}min`;
      else if (diffH < 24) label = `exp: ${diffH}h ${diffM}min`;
      else label = `exp: ${diffD}d ${diffH % 24}h — ${exp.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}`;
      const color = expired ? 'var(--red)' : warnSoon ? 'var(--orange)' : 'var(--yellow)';
      return `<br><span style="font-size:10px;color:${color}">${label}</span>`;
    })() : '';

    // Linha com destaque se expirando em breve
    const rowStyle = warnSoon && !expired ? ' style="background:#ff860010"' : expired && !k.active ? '' : '';
    const noteEsc  = escHtml(k.note || '');

    return `
<tr data-label="${escHtml(k.label.toLowerCase())}" data-phone="${escHtml(k.lastPhone||'')}" data-status="${k.active?'ativo':'bloqueado'}" data-uses="${k.uses||0}" data-created="${k.createdAt}"${rowStyle}>
  <td><span class="kc">${escHtml(code)}</span></td>
  <td>${escHtml(k.label)}</td>
  <td><span class="badge ${k.active?(k.warnCount>0?'wl':'on'):'off'}">${k.active?(k.expireDuration&&!k.expiresAt?'AGUARDANDO':(k.warnCount>0?`AVISO (${k.warnCount}x)`:'ATIVO')):'BLOQUEADO'}</span></td>
  <td><span style="color:${((k.phones||[]).length>=(k.maxUses>0?k.maxUses:MAX_USES)&&(k.maxUses>0?k.maxUses:MAX_USES)>0)?'var(--orange)':'inherit'}">${(k.phones||[]).length}/${k.maxUses===-1?'&#x221E;':(k.maxUses>0?k.maxUses:MAX_USES)}</span></td>
  <td>${escHtml(k.lastPhone||'-')}</td>
  <td>${escHtml(k.lastIp||'-')}</td>
  <td>${k.lastUsed?new Date(k.lastUsed).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'-'}</td>
  <td>${new Date(k.createdAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}${expHtml}</td>
  <td class="note-cell" onclick="openNote('${escHtml(code)}','${noteEsc.replace(/'/g,"\\'")}')"><span class="note-preview">${noteEsc || '<span style=\\"color:var(--muted)\\">—</span>'}</span></td>
  <td>
    <button class="bs ${k.active?'bd':'bg'}" onclick="toggleKey('${escHtml(code)}')">${k.active?'Bloquear':'Liberar'}</button>
    <button class="bs bg" onclick="openRenew('${escHtml(code)}','${escHtml(k.label||'')}')">+ Tempo</button>
    <button class="bs bg" onclick="openEditUses('${escHtml(code)}','${escHtml(k.label||'')}',${k.maxUses!=null?k.maxUses:MAX_USES})">Usos</button>
    <button class="bs bg" onclick="openRename('${escHtml(code)}','${escHtml(k.label||'')}')">Renomear</button>
    ${(k.phones||[]).length>0?`<button class="bs bd" onclick="openPhones('${escHtml(code)}','${escHtml(k.label||'')}')">Numeros</button>`:''}
    <button class="bs bd" onclick="deleteKey('${escHtml(code)}')">Excluir</button>
    ${(k.warnCount||0)>0 ? `<button class="bs bwarn" onclick="resetWarn('${escHtml(code)}')">⚠ Avisos</button>` : ''}
  </td>
</tr>`;
  }).join('');
}

function buildLogsHtml(arr) {
  const src = arr ?? logs;
  if (!src.length) return `<tr><td colspan="7" class="empty">Nenhum log ainda</td></tr>`;
  return src.slice(0,150).map(l => `
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
// ADMIN: DASHBOARD — renderização completa
// ─────────────────────────────────────────────
function renderAdminDashboard() {
  const expiringSoon  = Object.values(keys).filter(k => k.active && isKeyExpiringSoon(k)).length;
  const warnLimitKeys = Object.values(keys).filter(k => k.active && (k.warnCount||0) > 0).length;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZapVoice Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --green:#00ff87;--dark:#080810;--card:#0f0f1a;--card2:#13131f;
  --border:#1c1c2e;--border2:#252538;--text:#e2e2f0;--muted:#5a5a7a;
  --red:#ff4757;--yellow:#ffd32a;--orange:#ff8600;--blue:#4f8ef7;--purple:#9b59b6;
  --radius:10px;--radius-sm:6px;
}
body{background:var(--dark);color:var(--text);font-family:'Space Mono',monospace;min-height:100vh}
header{display:flex;align-items:center;justify-content:space-between;padding:12px 24px;
  border-bottom:1px solid var(--border);background:var(--card);position:sticky;top:0;z-index:100;
  box-shadow:0 2px 20px #00000040}
.logo{font-family:'Syne',sans-serif;font-size:18px;font-weight:800;color:var(--green);
  display:flex;align-items:center;gap:8px;letter-spacing:-0.5px}
.hright{display:flex;align-items:center;gap:10px}
a.out{color:var(--muted);font-size:11px;text-decoration:none;padding:6px 12px;
  border:1px solid var(--border2);border-radius:var(--radius-sm);transition:all .2s}
a.out:hover{color:var(--red);border-color:var(--red)}
main{padding:22px 24px;max-width:1700px;margin:0 auto}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:20px}
.sc{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);
  padding:16px 18px;position:relative;overflow:hidden;transition:border-color .2s,transform .15s}
.sc:hover{border-color:var(--border2);transform:translateY(-1px)}
.sc.warn-card{border-color:#ff860050;background:#ff860008}
.sc-icon{position:absolute;right:14px;top:14px;font-size:22px;opacity:.15}
.sc .n{font-family:'Syne',sans-serif;font-size:30px;font-weight:800;color:var(--green);line-height:1.1}
.sc.warn-card .n{color:var(--orange)}
.sc .l{color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:1.5px;margin-top:5px}
.sec{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);
  margin-bottom:16px;overflow:hidden}
.sh{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;
  border-bottom:1px solid var(--border);background:var(--card2);flex-wrap:wrap;gap:10px}
.st{font-family:'Syne',sans-serif;font-weight:700;font-size:13px;color:var(--green);
  display:flex;align-items:center;gap:6px}
.gen-form{display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap}
.gen-form input{
  padding:7px 10px;background:var(--dark);border:1px solid var(--border);
  border-radius:var(--radius-sm);color:var(--text);font-family:'Space Mono',monospace;
  font-size:11px;outline:none;transition:border .18s;display:block;width:100%}
.gen-form input:focus{border-color:var(--green);background:#0a0a14}
.gen-form input::placeholder{color:var(--muted)}
.fi-name{flex:1;min-width:130px;max-width:170px}
.fi-name input{width:100%}
.fi-group{display:flex;gap:5px;align-items:flex-end}
.fi-col{display:flex;flex-direction:column;gap:3px}
.fi-lbl{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;padding-left:2px}
.fi-num{width:56px;text-align:center}
.fi-sep{width:1px;height:28px;background:var(--border2);margin:0 3px;flex-shrink:0;align-self:flex-end;margin-bottom:2px}
.btn{padding:7px 14px;border:none;border-radius:var(--radius-sm);cursor:pointer;
  font-family:'Syne',sans-serif;font-weight:700;font-size:11px;
  transition:all .18s;white-space:nowrap;letter-spacing:.3px}
.btn:hover{opacity:.85;transform:translateY(-1px)}
.btn:active{transform:translateY(0)}
.bp{background:var(--green);color:#000;box-shadow:0 0 12px #00ff8730}
.bw{background:#ffd32a12;color:var(--yellow);border:1px solid #ffd32a35}
.br{background:#ff475712;color:var(--red);border:1px solid #ff475735}
.bcsv{background:#4f8ef712;color:var(--blue);border:1px solid #4f8ef735}
.bs{padding:3px 8px;border:none;border-radius:4px;cursor:pointer;
  font-family:'Space Mono',monospace;font-size:10px;margin-right:2px;
  transition:all .15s;white-space:nowrap}
.bs:hover{opacity:.8}
.bg{background:#00ff8712;color:var(--green);border:1px solid #00ff8730}
.bd{background:#ff475712;color:var(--red);border:1px solid #ff475730}
.bwarn{background:#ff8c0012;color:#ff8c00;border:1px solid #ff8c0030}
.ov{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{padding:8px 11px;text-align:left;font-size:9px;text-transform:uppercase;
  letter-spacing:1.5px;color:var(--muted);border-bottom:1px solid var(--border);
  font-weight:400;white-space:nowrap;background:var(--card2)}
th.sort{cursor:pointer;user-select:none;transition:color .15s}
th.sort:hover{color:var(--text)}
th.asc .arr::after{content:' ▲';color:var(--green);font-size:8px}
th.desc .arr::after{content:' ▼';color:var(--green);font-size:8px}
th:not(.asc):not(.desc) .arr::after{content:' ⇅';opacity:.2;font-size:8px}
td{padding:10px 11px;font-size:11px;border-bottom:1px solid #14141f;vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:#ffffff02}
.kc{color:var(--green);font-size:11px;letter-spacing:.3px;font-family:'Space Mono',monospace}
.badge{padding:2px 7px;border-radius:3px;font-size:9px;font-weight:700;letter-spacing:.8px;text-transform:uppercase}
.on{background:#00ff8718;color:var(--green);border:1px solid #00ff8730}
.off{background:#ff475718;color:var(--red);border:1px solid #ff475730}
.re{background:#4f8ef718;color:var(--blue)}
.vr{background:#9b59b618;color:var(--purple)}
.warn{background:#ffd32a18;color:var(--yellow)}
.wl{background:#ff8c0018;color:#ff8c00}
.empty{text-align:center;color:var(--muted);padding:40px!important;font-size:11px;letter-spacing:1px}
.toast{position:fixed;bottom:20px;right:20px;padding:11px 18px;border-radius:var(--radius);
  font-family:'Syne',sans-serif;font-weight:700;font-size:12px;display:none;z-index:9999;
  box-shadow:0 6px 30px #00000070;max-width:380px;line-height:1.4}
.note-cell{cursor:pointer;max-width:130px}
.note-cell:hover .note-preview{color:var(--green)}
.note-preview{color:var(--muted);font-size:10px;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;display:block;max-width:120px}
.modal-bg{display:none;position:fixed;inset:0;background:#00000090;z-index:200;
  align-items:center;justify-content:center;backdrop-filter:blur(3px)}
.modal-bg.open{display:flex}
.modal{background:var(--card);border:1px solid var(--border2);border-radius:12px;
  padding:22px;width:340px;max-width:95vw;box-shadow:0 20px 60px #00000090}
.modal h3{font-family:'Syne',sans-serif;font-size:13px;margin-bottom:11px;color:var(--green)}
.modal textarea{width:100%;background:var(--dark);border:1px solid var(--border);
  border-radius:var(--radius-sm);color:var(--text);font-family:'Space Mono',monospace;
  font-size:11px;padding:9px;outline:none;resize:vertical;min-height:80px;transition:border .2s}
.modal textarea:focus{border-color:var(--green)}
.modal-actions{display:flex;gap:8px;margin-top:11px;justify-content:flex-end}
@media(max-width:1200px){.stats{grid-template-columns:repeat(3,1fr)}}
@media(max-width:750px){.stats{grid-template-columns:1fr 1fr};main{padding:14px 12px}}
@media(max-width:420px){.stats{grid-template-columns:1fr};.gen-form{flex-direction:column;align-items:stretch}}
</style>
</head>
<body>
<header>
  <div class="logo">⚡ ZapVoice</div>
  <div class="hright">
    <button class="btn bcsv" onclick="exportCSV()">⬇ CSV</button>
    <a href="${R_ADMIN}/logout" class="out">↩ Sair</a>
  </div>
</header>
<main>
  <div class="stats">
    <div class="sc"><div class="sc-icon">🔑</div><div class="n" id="s-total">${Object.keys(keys).length}</div><div class="l">Total de Chaves</div></div>
    <div class="sc"><div class="sc-icon">✅</div><div class="n" id="s-active">${Object.values(keys).filter(k=>k.active).length}</div><div class="l">Chaves Ativas</div></div>
    <div class="sc ${expiringSoon > 0 ? 'warn-card' : ''}"><div class="sc-icon">⏰</div><div class="n" id="s-warn" style="${expiringSoon>0?'color:var(--orange)':''}">${expiringSoon}</div><div class="l">Expirando em ${EXPIRY_WARN_HOURS}h</div></div>
    <div class="sc"><div class="sc-icon">⚠️</div><div class="n" id="s-warnlimit" style="${warnLimitKeys>0?'color:#ff8c00':''}">${warnLimitKeys}</div><div class="l">Aviso de Limite</div></div>
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
        <div class="fi-col"><span class="fi-lbl">Usos</span><input type="number" id="nuses" class="fi-num" placeholder="3" min="-1" title="Máx. números (vazio=3, -1=ilimitado)" style="width:60px"></div>
        <div class="fi-col" style="align-items:center;gap:4px"><label style="font-size:10px;color:var(--muted);white-space:nowrap" title="O tempo só começa a contar quando o cliente inserir a chave pela primeira vez"><input type="checkbox" id="ndeferred" style="margin-right:4px">⏱ Ativar ao 1º uso</label></div>
        <button class="btn bp" onclick="generateKey()">+ Gerar Chave</button>
      </div>
    </div>
    <div class="ov">
      <table>
        <thead><tr>
          <th>Chave</th>
          <th class="sort" onclick="sortKeys('label')"   id="th-label">Cliente<span class="arr"></span></th>
          <th class="sort" onclick="sortKeys('status')"  id="th-status">Status<span class="arr"></span></th>
          <th class="sort" onclick="sortKeys('uses')"    id="th-uses">Usos<span class="arr"></span></th>
          <th class="sort" onclick="sortKeys('phone')"   id="th-phone">Telefone<span class="arr"></span></th>
          <th>Último IP</th>
          <th>Último Acesso</th>
          <th class="sort" onclick="sortKeys('created')" id="th-created">Criada em<span class="arr"></span></th>
          <th>Notas</th>
          <th>Ações</th>
        </tr></thead>
        <tbody id="kb">${buildKeysHtml()}</tbody>
      </table>
    </div>
  </div>

  <div class="sec">
    <div class="sh">
      <div class="st">📋 Log de Acessos</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="date" id="logDate" style="padding:6px 10px;background:var(--dark);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:'Space Mono',monospace;font-size:11px;outline:none" onchange="filterLog()">
        <button class="btn bw" onclick="clearDateFilter()">✕ Filtro</button>
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

<!-- Modal de renovar tempo -->
<div class="modal-bg" id="renewModal">
  <div class="modal" style="min-width:300px">
    <h3>⏱ Adicionar Tempo — <span id="renewKeyLabel"></span></h3>
    <input type="hidden" id="renewKeyCode">
    <div style="display:flex;gap:10px;margin-bottom:12px">
      <div style="flex:1;text-align:center">
        <div style="font-size:10px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:5px">Dias</div>
        <input type="number" id="renewDays" class="fi-num" placeholder="0" min="0" style="width:100%;padding:8px;background:var(--dark);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-family:inherit;font-size:14px;text-align:center">
      </div>
      <div style="flex:1;text-align:center">
        <div style="font-size:10px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:5px">Horas</div>
        <input type="number" id="renewHours" class="fi-num" placeholder="0" min="0" style="width:100%;padding:8px;background:var(--dark);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-family:inherit;font-size:14px;text-align:center">
      </div>
      <div style="flex:1;text-align:center">
        <div style="font-size:10px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:5px">Min</div>
        <input type="number" id="renewMins" class="fi-num" placeholder="0" min="0" style="width:100%;padding:8px;background:var(--dark);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-family:inherit;font-size:14px;text-align:center">
      </div>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:12px" id="renewCurrentExpiry"></div>
    <div class="modal-actions">
      <button class="btn" style="background:#1e1e2e;color:var(--muted)" onclick="closeRenew()">Cancelar</button>
      <button class="btn bp" onclick="saveRenew()">Adicionar Tempo</button>
    </div>
  </div>
</div>

<!-- Modal de edição de usos -->
<div class="modal-bg" id="editUsesModal">
  <div class="modal" style="min-width:280px">
    <h3>👥 Limite de Dispositivos — <span id="editUsesLabel"></span></h3>
    <input type="hidden" id="editUsesCode">
    <div style="margin-bottom:14px">
      <div style="font-size:10px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Máx. números simultâneos</div>
      <input type="number" id="editUsesValue" min="-1" style="width:100%;padding:10px;background:var(--dark);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-family:inherit;font-size:16px;text-align:center">
      <div style="font-size:11px;color:var(--muted);margin-top:8px">Use <strong style="color:var(--green)">-1</strong> para ilimitado</div>
    </div>
    <div class="modal-actions">
      <button class="btn" style="background:#1e1e2e;color:var(--muted)" onclick="closeEditUses()">Cancelar</button>
      <button class="btn bp" onclick="saveEditUses()">Salvar</button>
    </div>
  </div>
</div>

<!-- Modal de notas -->
<div class="modal-bg" id="renameModal">
  <div class="modal" style="min-width:300px">
    <h3>Renomear — <span id="renameKeyLabel"></span></h3>
    <input type="hidden" id="renameKeyCode">
    <div style="margin-bottom:14px">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:8px">Novo nome</div>
      <input type="text" id="renameValue" maxlength="60" style="width:100%;padding:10px;background:var(--dark);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-family:inherit;font-size:14px">
    </div>
    <div class="modal-actions">
      <button class="btn" style="background:#1e1e2e;color:var(--muted)" onclick="closeRename()">Cancelar</button>
      <button class="btn bp" onclick="saveRename()">Salvar</button>
    </div>
  </div>
</div>

<div class="modal-bg" id="phonesModal">
  <div class="modal" style="min-width:320px">
    <h3>Numeros — <span id="phonesLabel"></span></h3>
    <div id="phonesList" style="margin-bottom:14px;max-height:220px;overflow-y:auto;min-height:40px"></div>
    <div class="modal-actions">
      <button class="btn" style="background:#1e1e2e;color:var(--muted)" onclick="closePhones()">Fechar</button>
      <button class="btn bd" id="removeAllPhonesBtn" onclick="removeAllPhones()">Remover Todos</button>
    </div>
  </div>
</div>

<div class="modal-bg" id="noteModal">
  <div class="modal">
    <h3>📝 Nota — <span id="noteKeyLabel"></span></h3>
    <input type="hidden" id="noteKeyCode">
    <textarea id="noteText" placeholder="Ex: Pagou até março, trial gratuito, cliente VIP..."></textarea>
    <div class="modal-actions">
      <button class="btn" style="background:#1e1e2e;color:var(--muted)" onclick="closeNote()">Cancelar</button>
      <button class="btn bp" onclick="saveNote()">Salvar Nota</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>
<script>
const _RA='${R_ADMIN}';
function toast(msg,ok=true){
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.style.background=ok?'var(--green)':'var(--red)';
  t.style.color=ok?'#000':'#fff';
  t.style.display='block';
  setTimeout(()=>t.style.display='none',3200);
}
let _sortCol=null,_sortDir=1;
function sortKeys(col){
  const tbody=document.getElementById('kb');
  const rows=Array.from(tbody.querySelectorAll('tr[data-label]'));
  if(!rows.length)return;
  if(_sortCol===col)_sortDir*=-1; else{_sortCol=col;_sortDir=1;}
  ['label','status','uses','phone','created'].forEach(c=>{
    const th=document.getElementById('th-'+c);
    if(!th)return;
    th.classList.remove('asc','desc');
    if(c===col)th.classList.add(_sortDir===1?'asc':'desc');
  });
  rows.sort((a,b)=>{
    let va,vb;
    if(col==='uses'){va=parseInt(a.dataset.uses||0);vb=parseInt(b.dataset.uses||0);}
    else if(col==='created'){va=a.dataset.created;vb=b.dataset.created;}
    else if(col==='phone'){va=a.dataset.phone||'';vb=b.dataset.phone||'';}
    else{va=(a.dataset[col]||'').toLowerCase();vb=(b.dataset[col]||'').toLowerCase();}
    if(va<vb)return -1*_sortDir; if(va>vb)return 1*_sortDir; return 0;
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
    if(days>0)body.expireDays=days;
    if(hours>0)body.expireHours=hours;
    if(mins>0)body.expireMinutes=mins;
    const def=document.getElementById('ndeferred');
    if(def&&def.checked)body.deferred=true;
    const r=await fetch(_RA+'/api/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(r.status===401){toast('Sessão expirada',false);setTimeout(()=>location.href='${R_ADMIN}',1500);return;}
    const d=await r.json();
    if(d.ok){
      const exp=[];
      if(days>0)exp.push(days+'d'); if(hours>0)exp.push(hours+'h'); if(mins>0)exp.push(mins+'min');
      const ul=maxUses===-1?'∞ usos':maxUses+' uso(s)';
      toast('✅ '+d.key+(exp.length?' · '+exp.join(' '):' · sem expiração')+' · '+ul);
      ['nlabel','ndays','nhours','nmins','nuses'].forEach(id=>document.getElementById(id).value='');
      await doRefresh();
    } else toast('❌ Erro: '+(d.error||'desconhecido'),false);
  }catch(e){toast('❌ Erro de rede',false);}
}
async function filterLog(){
  const date=document.getElementById('logDate').value;
  if(!date)return;
  try{
    const r=await fetch(_RA+'/api/logs?date='+date);
    if(r.status===401){toast('Sessão expirada',false);setTimeout(()=>location.href='${R_ADMIN}',1500);return;}
    const d=await r.json();
    if(d.ok)document.getElementById('lb').innerHTML=d.logsHtml||'';
  }catch(e){toast('Erro ao filtrar',false);}
}
function clearDateFilter(){document.getElementById('logDate').value='';doRefresh();}
async function clearLog(){
  const date=document.getElementById('logDate').value;
  if(!confirm(date?'Limpar logs do dia '+date+'?':'Limpar TODO o log?'))return;
  try{
    const body=date?{date}:{};
    const r=await fetch(_RA+'/api/logs',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(r.status===401){toast('Sessão expirada',false);setTimeout(()=>location.href='${R_ADMIN}',1500);return;}
    const d=await r.json();
    if(d.ok){toast(date?'Log do dia limpo!':'Log completo apagado!');document.getElementById('logDate').value='';await doRefresh();}
  }catch(e){toast('Erro ao limpar',false);}
}
async function toggleKey(code){
  try{
    const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/toggle',{method:'POST'});
    if(r.status===401){toast('Sessão expirada',false);setTimeout(()=>location.href='${R_ADMIN}',1500);return;}
    const d=await r.json();
    if(d.ok){toast(d.active?'Chave liberada!':'Chave bloqueada!');await doRefresh();}
  }catch(e){toast('Erro',false);}
}
async function deleteKey(code){
  if(!confirm('Excluir chave '+code+'?'))return;
  try{
    const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code),{method:'DELETE'});
    if(r.status===401){toast('Sessão expirada',false);setTimeout(()=>location.href='${R_ADMIN}',1500);return;}
    const d=await r.json();
    if(d.ok){toast('Chave excluída');await doRefresh();}
  }catch(e){toast('Erro',false);}
}
async function resetWarn(code){
  try{
    const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/reset-warn',{method:'POST'});
    if(r.status===401){toast('Sessão expirada',false);setTimeout(()=>location.href='${R_ADMIN}',1500);return;}
    const d=await r.json();
    if(d.ok){toast('Avisos resetados');await doRefresh();}else{toast(d.error||'Erro',false);}
  }catch(e){toast('Erro',false);}
}
async function doRefresh(){
  try{
    const r=await fetch(_RA+'/api/data');
    const d=await r.json();
    if(d.error)return;
    document.getElementById('s-total').textContent=d.totalKeys||0;
    document.getElementById('s-active').textContent=d.activeKeys||0;
    document.getElementById('s-logs').textContent=d.totalLogs||0;
    const sw=document.getElementById('s-warn');
    sw.textContent=d.warnKeys||0;
    sw.style.color=(d.warnKeys>0)?'var(--orange)':'var(--green)';
    sw.closest('.sc').classList.toggle('warn-card',d.warnKeys>0);
    const swl=document.getElementById('s-warnlimit');
    if(swl){swl.textContent=d.warnLimitKeys||0;swl.style.color=(d.warnLimitKeys>0)?'#ff8c00':'';swl.closest('.sc').style.outline=(d.warnLimitKeys>0)?'1px solid #ff8c0050':'';}
    document.getElementById('kb').innerHTML=d.keysHtml||'';
    document.getElementById('lb').innerHTML=d.logsHtml||'';
  }catch(e){console.error('Refresh error',e);}
}
setInterval(doRefresh,30000);

// ── Notas ──
function openNote(code, currentNote){
  document.getElementById('noteKeyCode').value=code;
  document.getElementById('noteKeyLabel').textContent=code;
  document.getElementById('noteText').value=currentNote||'';
  document.getElementById('noteModal').classList.add('open');
  setTimeout(()=>document.getElementById('noteText').focus(),100);
}
function closeNote(){document.getElementById('noteModal').classList.remove('open');}
document.getElementById('noteModal').addEventListener('click',function(e){if(e.target===this)closeNote();});

function openRenew(code, label) {
  document.getElementById('renewKeyCode').value = code;
  document.getElementById('renewKeyLabel').textContent = label;
  document.getElementById('renewDays').value = '';
  document.getElementById('renewHours').value = '';
  document.getElementById('renewMins').value = '';
  // Mostrar expiração atual
  const expInfo = document.getElementById('renewCurrentExpiry');
  const row = [...document.querySelectorAll('#kb tr')].find(r => r.querySelector('td')?.textContent === code);
  const expCell = row ? row.querySelectorAll('td')[7]?.textContent : '';
  expInfo.textContent = expCell ? '📅 Expiração atual: ' + expCell.trim() : '📅 Sem expiração definida';
  document.getElementById('renewModal').classList.add('open');
  document.getElementById('renewDays').focus();
}
function closeRenew() { document.getElementById('renewModal').classList.remove('open'); }
document.getElementById('renewModal').addEventListener('click', function(e) { if(e.target===this) closeRenew(); });

function openEditUses(code, label, current) {
  document.getElementById('editUsesCode').value = code;
  document.getElementById('editUsesLabel').textContent = label;
  document.getElementById('editUsesValue').value = current;
  document.getElementById('editUsesModal').classList.add('open');
  document.getElementById('editUsesValue').focus();
  document.getElementById('editUsesValue').select();
}
function closeEditUses() { document.getElementById('editUsesModal').classList.remove('open'); }
document.getElementById('editUsesModal').addEventListener('click', function(e) { if(e.target===this) closeEditUses(); });
async function saveEditUses() {
  const code  = document.getElementById('editUsesCode').value;
  const val   = document.getElementById('editUsesValue').value.trim();
  const maxUses = val === '' ? 3 : parseInt(val);
  if (isNaN(maxUses) || maxUses < -1) { toast('❌ Valor inválido. Use -1 para ilimitado ou um número >= 1.', false); return; }
  const r = await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/max-uses', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ maxUses })
  });
  const d = await r.json();
  if (d.ok) {
    const txt = maxUses === -1 ? 'ilimitado' : maxUses + ' dispositivo(s)';
    toast('✅ Limite atualizado para ' + txt);
    closeEditUses();
    await doRefresh();
  } else {
    toast('Erro ao atualizar: ' + (d.error||'?'), false);
  }
}
async function saveRenew() {
  const code  = document.getElementById('renewKeyCode').value;
  const days  = parseInt(document.getElementById('renewDays').value)  || 0;
  const hours = parseInt(document.getElementById('renewHours').value) || 0;
  const mins  = parseInt(document.getElementById('renewMins').value)  || 0;
  if (!days && !hours && !mins) { toast('Informe pelo menos um valor de tempo.', false); return; }
  const r = await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/renew', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ days, hours, mins })
  });
  const d = await r.json();
  if (d.ok) {
    toast('✅ Tempo adicionado! Nova expiração: ' + new Date(d.expiresAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}));
    closeRenew();
    await doRefresh();
  } else {
    toast('Erro ao renovar: ' + (d.error||'?'), false);
  }
}
async function saveNote(){
  const code=document.getElementById('noteKeyCode').value;
  const note=document.getElementById('noteText').value.trim();
  try{
    const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/note',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note})});
    if(r.status===401){toast('Sessão expirada',false);setTimeout(()=>location.href='${R_ADMIN}',1500);return;}
    const d=await r.json();
    if(d.ok){toast('Nota salva!');closeNote();await doRefresh();}
    else toast('Erro ao salvar nota',false);
  }catch(e){toast('Erro de rede',false);}
}

// ── Exportar CSV ──
async function exportCSV(){
  try{
    const r=await fetch(_RA+'/api/export/csv');
    if(r.status===401){toast('Sessão expirada',false);setTimeout(()=>location.href='${R_ADMIN}',1500);return;}
    const blob=await r.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download='zapvoice-chaves-'+new Date().toISOString().slice(0,10)+'.csv';
    a.click(); URL.revokeObjectURL(url);
    toast('CSV exportado!');
  }catch(e){toast('Erro ao exportar',false);}
}

// ── Renomear ──
function openRename(code, label) {
  document.getElementById('renameKeyCode').value = code;
  document.getElementById('renameKeyLabel').textContent = label;
  document.getElementById('renameValue').value = label;
  document.getElementById('renameModal').classList.add('open');
  setTimeout(function(){ var v=document.getElementById('renameValue'); v.focus(); v.select(); }, 50);
}
function closeRename() { document.getElementById('renameModal').classList.remove('open'); }
document.getElementById('renameModal').addEventListener('click', function(e){ if(e.target===this) closeRename(); });
document.getElementById('renameValue').addEventListener('keydown', function(e){ if(e.key==='Enter') saveRename(); });
async function saveRename() {
  var code  = document.getElementById('renameKeyCode').value;
  var label = document.getElementById('renameValue').value.trim();
  if (!label) { toast('Nome nao pode ser vazio.', false); return; }
  try {
    var r = await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/label', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:label})});
    if(r.status===401){toast('Sessao expirada',false);setTimeout(function(){location.href=_RA},1500);return;}
    var d = await r.json();
    if (d.ok) { toast('Renomeado: '+label); closeRename(); await doRefresh(); }
    else toast('Erro: '+(d.error||'?'), false);
  } catch(e) { toast('Erro de rede.', false); }
}

// ── Numeros ──
function openPhones(code, label) {
  var modal = document.getElementById('phonesModal');
  modal.dataset.code = code;
  document.getElementById('phonesLabel').textContent = label;
  var list = document.getElementById('phonesList');
  list.innerHTML = 'Carregando...';
  modal.classList.add('open');
  fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/phones')
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (!d.phones || d.phones.length === 0) {
        list.innerHTML = '<em style="color:var(--muted);font-size:12px">Nenhum numero cadastrado</em>';
        document.getElementById('removeAllPhonesBtn').style.display = 'none';
        modal.dataset.phones = '[]';
        return;
      }
      document.getElementById('removeAllPhonesBtn').style.display = '';
      modal.dataset.phones = JSON.stringify(d.phones);
      var html = '';
      d.phones.forEach(function(phone, i){
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">';
        html += '<span style="font-size:13px;font-family:monospace">' + phone + '</span>';
        html += '<button class="bs bd" style="padding:4px 10px;font-size:11px" data-idx="' + i + '" onclick="removePhone(this)">Remover</button>';
        html += '</div>';
      });
      list.innerHTML = html;
    })
    .catch(function(){ list.innerHTML = '<em style="color:var(--red)">Erro ao carregar</em>'; });
}
function closePhones() { document.getElementById('phonesModal').classList.remove('open'); }
document.getElementById('phonesModal').addEventListener('click', function(e){ if(e.target===this) closePhones(); });
async function removePhone(btn) {
  var modal  = document.getElementById('phonesModal');
  var code   = modal.dataset.code;
  var phones = JSON.parse(modal.dataset.phones || '[]');
  var phone  = phones[parseInt(btn.dataset.idx)];
  if (!phone) { toast('Erro: numero nao encontrado', false); return; }
  try {
    var r = await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/phones', {method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:phone})});
    var d = await r.json();
    if (d.ok) { toast('Numero removido: '+phone); closePhones(); await doRefresh(); }
    else toast('Erro: '+(d.error||'?'), false);
  } catch(e) { toast('Erro de rede.', false); }
}
async function removeAllPhones() {
  var code = document.getElementById('phonesModal').dataset.code;
  if (!confirm('Remover TODOS os numeros desta chave?')) return;
  try {
    var r = await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/phones', {method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({all:true})});
    var d = await r.json();
    if (d.ok) { toast('Todos removidos.'); closePhones(); await doRefresh(); }
    else toast('Erro: '+(d.error||'?'), false);
  } catch(e) { toast('Erro de rede.', false); }
}

</script>
</body></html>`;
}

// ─────────────────────────────────────────────
// ROTEADOR
// ─────────────────────────────────────────────
async function handleRequest(req, res) {
  // ── CORS: permite extensões Chrome e qualquer origem ──
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

  // ── Camada 4: banimento permanente ──


  // ── Camada 3: rotas /admin originais retornam 404 silencioso quando slug ativo ──
  if (APP_SECRET && (p === '/admin' || p.startsWith('/admin/'))) {
    res.writeHead(404); res.end('Not found'); return;
  }

  console.log(`[${new Date().toISOString()}] ${req.method} ${p} — ${ip}`);

  // ── EXTENSÃO: página de login ──
  // ── HEALTH CHECK — para UptimeRobot e monitoramento ──
  if (p === '/health' && req.method === 'GET') {
    sendJson(res, { ok: true, ts: Date.now() }); return;
  }

  if ((p === R_EXT+'/auth/' || p === R_EXT+'/auth') && req.method === 'GET') {
    const callback = url.searchParams.get('callback') || '';
    sendHtml(res, renderExtensionLogin({ callback }));
    return;
  }

  // ── EXTENSÃO: verifica chave e faz callback ──
  if (p === R_EXT+'/auth/verify' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'login')) {
      const _mins = getRateLimitWait(ip, 'login');
      sendHtml(res, renderExtensionLogin({ callback: '', error: `⏳ Muitas tentativas. Aguarde ${_mins} minuto(s) antes de tentar novamente.` }), 429);
      return;
    }
    const form     = await parseFormBody(req);
    const keyCode  = (form.get('key') || '').trim().toLowerCase();
    const callback = form.get('callback') || '';

    if (!keyCode || !keys[keyCode]) {
      await addLog({ keyCode: keyCode||'?', label: '-', phone: '-', ip, wppVersion: '-', action: 'key_not_found' });
      sendHtml(res, renderExtensionLogin({ callback, keyVal: keyCode, error: '❌ Chave não encontrada. Verifique se digitou corretamente ou entre em contato com o vendedor.' }));
      return;
    }
    if (isKeyExpired(keys[keyCode])) {
      keys[keyCode].active = false;
      await addLog({ keyCode, label: keys[keyCode].label, phone: '-', ip, wppVersion: '-', action: 'expired' });
      await saveDb();
      fireWebhook('key_expired', keyCode, 'Expiração detectada no login');
      sendHtml(res, renderExtensionLogin({ callback, keyVal: keyCode, error: '⏰ Chave expirada. Entre em contato com o vendedor para renovar.' }));
      return;
    }
    if (!keys[keyCode].active) {
      await addLog({ keyCode, label: keys[keyCode].label, phone: '-', ip, wppVersion: '-', action: 'login_blocked' });
      sendHtml(res, renderExtensionLogin({ callback, keyVal: keyCode, error: '🚫 Chave bloqueada. Entre em contato com o vendedor.' }));
      return;
    }
    // Limite verificado em /v3/key (onde phoneNumber está disponível)
    keys[keyCode].lastUsed = new Date().toISOString();
    keys[keyCode].lastIp   = ip;
    await saveDb();
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
    } catch (e) {
      sendHtml(res, renderExtensionLogin({ callback, keyVal: keyCode, error: 'Callback inválido. Tente novamente.' }));
    }
    return;
  }

  // ── EXTENSÃO: validação via /v3/key ──
  if (p === R_EXT+'/v3/key' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'api')) {
      sendJson(res, { authError: 'rateLimited', authErrorMessage: 'Muitas tentativas. Aguarde.' }, 429);
      return;
    }
    const rawBody = await new Promise(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>r(b));});
    let body; try { body = JSON.parse(rawBody); } catch { body = {}; }
    const keyCode    = (body.authKey || '').toLowerCase();
    // Registrar token de sessão se enviado (melhora segurança progressivamente)
    const _tok = (body._zv_et || '').trim();
    // Sem bloqueio por HMAC — o controle de acesso real é a chave em si
    const phone      = body.phoneNumber || '-';
    const wppVersion = body.wppVersion  || '-';
    const deviceId   = body.deviceId    || '';

    if (!keyCode || !keys[keyCode]) {
      sendJson(res, { authError: 'keyNotFound', authErrorMessage: 'Chave não encontrada. Contate o vendedor.' });
      addLog({ keyCode: keyCode||'?', label: '-', phone, ip, wppVersion, action: 'key_not_found' }).catch(()=>{});
      return;
    }
    if (isKeyExpired(keys[keyCode])) {
      keys[keyCode].active = false;
      sendJson(res, { authError: 'keyExpired', reason: 'expired', data: { message: 'USUÁRIO NÃO ENCONTRADO. Chave expirada.', permissions: [] } }, 403);
      addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: 'expired' }).catch(()=>{});
      saveDb().catch(()=>{});
      fireWebhook('key_expired', keyCode, 'Expiração detectada no v3/key');
      return;
    }
    if (!keys[keyCode].active) {
      sendJson(res, { authError: 'keyBlocked', reason: 'blocked', data: { message: 'USUÁRIO NÃO ENCONTRADO. Chave bloqueada.', permissions: [] } }, 403);
      addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: 'login_blocked' }).catch(()=>{});
      return;
    }

    // Migrar lastPhone legado para lista phones[]
    if (!keys[keyCode].phones) {
      keys[keyCode].phones = keys[keyCode].lastPhone ? [keys[keyCode].lastPhone] : [];
    }

    const hasPhone   = phone && phone !== '-';
    const knownPhone = hasPhone && keys[keyCode].phones.includes(phone);
    const isNewPhone = hasPhone && !knownPhone;

    const keyMaxUses = (typeof keys[keyCode].maxUses === 'number') ? keys[keyCode].maxUses : MAX_USES;
    if (isNewPhone) {
      if (keyMaxUses > 0 && keys[keyCode].phones.length >= keyMaxUses) {
        // Limite atingido — apenas incrementa aviso, sem bloqueio automático
        keys[keyCode].warnCount = (keys[keyCode].warnCount || 0) + 1;
        sendJson(res, {
          warnLimit: true,
          warnRemaining: keys[keyCode].warnCount,
          data: {
            message: `USUÁRIO NÃO ENCONTRADO. Limite de ativações atingido (${keys[keyCode].phones.length}/${keyMaxUses}). Contate o vendedor.`,
            permissions: []
          }
        }, 403);
        addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: 'warn_limit' }).catch(()=>{});
        saveDb().catch(()=>{});
        return;
      }
      keys[keyCode].phones.push(phone);
      keys[keyCode].uses = keys[keyCode].phones.length;
    }

    // Ativação diferida — iniciar timer na primeira ativação real
    if (keys[keyCode].expireDuration && !keys[keyCode].expiresAt && keys[keyCode].phones.length >= 1) {
      const exp = new Date();
      exp.setTime(exp.getTime() + keys[keyCode].expireDuration);
      keys[keyCode].expiresAt = exp.toISOString();
      keys[keyCode].activatedAt = new Date().toISOString();
      console.log(`[DEFERRED] Chave ${keyCode} ativada — expira em ${keys[keyCode].expiresAt}`);
    }

    keys[keyCode].lastUsed  = new Date().toISOString();
    keys[keyCode].lastIp    = ip;
    if (hasPhone) keys[keyCode].lastPhone = phone;
    // Gerar token e responder IMEDIATAMENTE — não esperar MongoDB
    const _et = generateToken();
    extSessions[_et] = { keyCode, expiresAt: new Date(Date.now() + 30*24*60*60*1000).toISOString() };
    const _authData = getAuthData(keyCode);
    _authData._zv_et = _et;
    sendJson(res, _authData);
    // Salvar no banco em background — não bloqueia a resposta
    const _action = isNewPhone ? 'login_ok' : 'relogin_ok';
    addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: _action })
      .catch(e => console.error('[LOG]', e.message));
    saveDb().catch(e => console.error('[SAVEDB]', e.message));
    return;
  }

  // ── EXTENSÃO: check-status (polling 30s) ──
  if (p === R_EXT+'/v3/check-status' && req.method === 'POST') {
    const rawBody = await new Promise(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>r(b));});
    let body; try { body = JSON.parse(rawBody); } catch { body = {}; }
    const keyCode = (body.authKey || '').toLowerCase();
    // Sem verificação HMAC — check-status é protegido pela chave
    // Se o servidor ainda está inicializando, não deslogar o cliente
    if (!serverReady) {
      sendJson(res, { active: true }); return;
    }
    if (!keyCode || !keys[keyCode]) {
      sendJson(res, { active: false, reason: 'not_found' }); return;
    }
    if (isKeyExpired(keys[keyCode])) {
      sendJson(res, { active: false, reason: 'expired' }); return;
    }
    if (!keys[keyCode].active) {
      sendJson(res, { active: false, reason: 'blocked' }); return;
    }
    // Aviso de expiração antecipado
    const expiring = isKeyExpiringSoon(keys[keyCode]);
    const hoursLeft = hoursUntilExpiry(keys[keyCode]);
    sendJson(res, { active: true, expiringSoon: expiring, hoursLeft });
    return;
  }

  // ── EXTENSÃO: usage ──
  if ([R_EXT+'/v3/usage',R_EXT+'/v3/get-usage',R_EXT+'/v3/sync-usage'].includes(p)) {
    sendJson(res, {
      ok: true, status: true, limits: USAGE_LIMITS,
      expires_at: new Date(Date.now() + 365*24*60*60*1000).toISOString(), isExpired: false
    });
    return;
  }

  // ── ADMIN: login ──
  if (p === R_ADMIN+'/login' && req.method === 'POST') {
    const form = await parseFormBody(req);
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

  // ── ADMIN: logout ──
  if (p === R_ADMIN+'/logout') {
    res.setHeader('Set-Cookie', 'zv_admin=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    res.writeHead(302, { Location: R_ADMIN }); res.end(); return;
  }

  // ── ADMIN: painel ──
  if (p === R_ADMIN || p === R_ADMIN+'/') {
    if (!isAdminSession(req)) { sendHtml(res, renderAdminLogin()); return; }
    sendHtml(res, renderAdminDashboard()); return;
  }

  // ── ADMIN API: dados ──
  if (p === R_ADMIN+'/api/data' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    sendJson(res, {
      totalKeys:     Object.keys(keys).length,
      activeKeys:    Object.values(keys).filter(k=>k.active).length,
      warnKeys:      Object.values(keys).filter(k => k.active && isKeyExpiringSoon(k)).length,
      warnLimitKeys: Object.values(keys).filter(k => k.active && (k.warnCount||0) > 0).length,
      totalLogs:     logs.length,
      keysHtml:      buildKeysHtml(),
      logsHtml:      buildLogsHtml()
    }); return;
  }

  // ── ADMIN API: gerar chave ──
  if (p === R_ADMIN+'/api/keys' && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const body = await parseBody(req);
    const code = generateKey();
    let expiresAt = null;
    let expireDuration = null; // ms — para chaves com ativação diferida
    if (body.expiresAt) {
      expiresAt = new Date(body.expiresAt).toISOString();
    } else {
      const days = parseInt(body.expireDays || 0), hours = parseInt(body.expireHours || 0), minutes = parseInt(body.expireMinutes || 0);
      if (days > 0 || hours > 0 || minutes > 0) {
        const durationMs = ((days * 1440) + (hours * 60) + minutes) * 60000;
        if (body.deferred) {
          // Tempo só começa a contar na primeira ativação
          expireDuration = durationMs;
          expiresAt = null;
        } else {
          const d = new Date();
          d.setTime(d.getTime() + durationMs);
          expiresAt = d.toISOString();
        }
      }
    }
    const maxUses = (body.maxUses !== undefined) ? parseInt(body.maxUses) : MAX_USES;
    keys[code] = { label: body.label || 'Cliente', active: true, createdAt: new Date().toISOString(), uses: 0, phones: [], lastUsed: null, lastIp: null, lastPhone: null, deviceId: null, note: '', expiresAt, expireDuration: expireDuration || null, maxUses: isNaN(maxUses) ? MAX_USES : maxUses };
    await saveDb();
    sendJson(res, { ok: true, key: code }); return;
  }

  // ── ADMIN API: toggle ──
  if (p.match(new RegExp('^'+R_ADMIN.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\/api\/keys\/[^/]+\/toggle$')) && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const _segs=p.split('/'); const code = decodeURIComponent(_segs[_segs.length-2]);
    if (!keys[code]) { sendJson(res, { error: 'not found' }, 404); return; }
    keys[code].active = !keys[code].active;
    await saveDb();
    if (!keys[code].active) fireWebhook('key_blocked', code, 'Bloqueio manual pelo admin');
    sendJson(res, { ok: true, active: keys[code].active }); return;
  }

  // ── ADMIN API: editar maxUses ──
  if (p.match(new RegExp('^'+R_ADMIN.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\/api\/keys\/[^/]+\/max-uses$')) && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const _segs = p.split('/'); const code = decodeURIComponent(_segs[_segs.length-2]);
    if (!keys[code]) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    const maxUses = parseInt(body.maxUses);
    if (isNaN(maxUses) || maxUses < -1) { sendJson(res, { error: 'invalid' }, 400); return; }
    keys[code].maxUses = maxUses;
    await saveDb();
    await addLog({ keyCode: code, label: keys[code].label, phone: '-', ip, wppVersion: '-', action: 'max_uses_updated' });
    sendJson(res, { ok: true, maxUses }); return;
  }

  // ── ADMIN API: renovar tempo ──
  if (p.match(new RegExp('^'+R_ADMIN.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\/api\/keys\/[^/]+\/renew$')) && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const _segs = p.split('/'); const code = decodeURIComponent(_segs[_segs.length-2]);
    if (!keys[code]) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    const days = parseInt(body.days||0), hours = parseInt(body.hours||0), mins = parseInt(body.mins||0);
    if (!days && !hours && !mins) { sendJson(res, { error: 'nenhum tempo informado' }, 400); return; }
    const addMs = ((days * 1440) + (hours * 60) + mins) * 60000;
    // Se a chave está expirada ou sem expiração, conta a partir de agora
    // Se ainda está válida, soma ao tempo restante
    const base = (keys[code].expiresAt && !isKeyExpired(keys[code]))
      ? new Date(keys[code].expiresAt).getTime()
      : Date.now();
    keys[code].expiresAt = new Date(base + addMs).toISOString();
    keys[code].active = true; // reativa se estava bloqueada por expiração
    await saveDb();
    await addLog({ keyCode: code, label: keys[code].label, phone: '-', ip, wppVersion: '-', action: 'renewed' });
    sendJson(res, { ok: true, expiresAt: keys[code].expiresAt }); return;
  }

  // ── ADMIN API: renomear ──
  if (p.match(new RegExp('^'+R_ADMIN.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\/api\/keys\/[^/]+\/label$')) && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, {error:'unauthorized'}, 401); return; }
    const _s=p.split('/'); const code=decodeURIComponent(_s[_s.length-2]);
    if (!keys[code]) { sendJson(res, {error:'not found'}, 404); return; }
    const body=await parseBody(req);
    const label=String(body.label||'').trim().slice(0,60);
    if (!label) { sendJson(res, {error:'label vazio'}, 400); return; }
    keys[code].label=label;
    saveDb().catch(()=>{});
    sendJson(res, {ok:true, label}); return;
  }

  // ── ADMIN API: listar numeros ──
  if (p.match(new RegExp('^'+R_ADMIN.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\/api\/keys\/[^/]+\/phones$')) && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, {error:'unauthorized'}, 401); return; }
    const _s=p.split('/'); const code=decodeURIComponent(_s[_s.length-2]);
    if (!keys[code]) { sendJson(res, {error:'not found'}, 404); return; }
    sendJson(res, {ok:true, phones:keys[code].phones||[]}); return;
  }

  // ── ADMIN API: remover numero(s) ──
  if (p.match(new RegExp('^'+R_ADMIN.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\/api\/keys\/[^/]+\/phones$')) && req.method === 'DELETE') {
    if (!isAdminSession(req)) { sendJson(res, {error:'unauthorized'}, 401); return; }
    const _s=p.split('/'); const code=decodeURIComponent(_s[_s.length-2]);
    if (!keys[code]) { sendJson(res, {error:'not found'}, 404); return; }
    const body=await parseBody(req);
    if (body.all) {
      keys[code].phones=[]; keys[code].uses=0; keys[code].lastPhone=null;
    } else if (body.phone) {
      keys[code].phones=(keys[code].phones||[]).filter(ph=>ph!==body.phone);
      keys[code].uses=keys[code].phones.length;
      if (keys[code].lastPhone===body.phone) keys[code].lastPhone=keys[code].phones[keys[code].phones.length-1]||null;
    } else { sendJson(res, {error:'informe phone ou all:true'}, 400); return; }
    saveDb().catch(()=>{});
    sendJson(res, {ok:true, phones:keys[code].phones}); return;
  }

  // ── ADMIN API: reset-warn ──
  if (p.match(new RegExp('^'+R_ADMIN.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\/api\/keys\/[^/]+\/reset-warn$')) && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const _segs=p.split('/'); const code = decodeURIComponent(_segs[_segs.length-2]);
    if (!keys[code]) { sendJson(res, { error: 'not found' }, 404); return; }
    keys[code].warnCount = 0;
    await saveDb();
    await addLog({ keyCode: code, label: keys[code].label, phone: '-', ip, wppVersion: '-', action: 'warn_reset' });
    sendJson(res, { ok: true }); return;
  }

  // ── ADMIN API: nota ──
  if (p.match(new RegExp('^'+R_ADMIN.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\/api\/keys\/[^/]+\/note$')) && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const _segs=p.split('/'); const code = decodeURIComponent(_segs[_segs.length-2]);
    if (!keys[code]) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    keys[code].note = String(body.note || '').slice(0, 500);
    await saveDb();
    sendJson(res, { ok: true }); return;
  }

  // ── ADMIN API: deletar chave ──
  if (p.match(new RegExp('^'+R_ADMIN.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\/api\/keys\/[^/]+$')) && req.method === 'DELETE') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const _segs=p.split('/'); const code = decodeURIComponent(_segs[_segs.length-1]);
    delete keys[code];
    await saveDb();
    sendJson(res, { ok: true }); return;
  }

  // ── ADMIN API: limpar log ──
  if (p === R_ADMIN+'/api/logs' && req.method === 'DELETE') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const body = await parseBody(req);
    if (body.date) { logs = logs.filter(l => !l.timestamp.startsWith(body.date)); }
    else { logs = []; }
    await saveDb();
    sendJson(res, { ok: true, remaining: logs.length }); return;
  }

  // ── ADMIN API: filtrar log ──
  if (p === R_ADMIN+'/api/logs' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const date = url.searchParams.get('date');
    const filtered = date ? logs.filter(l => l.timestamp.startsWith(date)) : logs;
    sendJson(res, { ok: true, logsHtml: buildLogsHtml(filtered) }); return;
  }

  // ── ADMIN API: exportar CSV ──
  if (p === R_ADMIN+'/api/export/csv' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const header = 'Chave,Cliente,Status,Usos,Telefone,Último IP,Último Acesso,Criada em,Expira em,Nota';
    const rows = Object.entries(keys).map(([code, k]) => {
      const cols = [
        code, k.label, k.active ? 'ATIVO' : 'BLOQUEADO',
        `${(k.phones||[]).length}/${k.maxUses===-1?'Ilimitado':(k.maxUses>0?k.maxUses:MAX_USES)}`, k.lastPhone||'',
        k.lastIp||'',
        k.lastUsed ? new Date(k.lastUsed).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : '',
        new Date(k.createdAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}),
        k.expiresAt ? new Date(k.expiresAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : 'Sem expiração',
        (k.note||'').replace(/,/g,';')
      ];
      return cols.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',');
    });
    const csv = [header, ...rows].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="zapvoice-${new Date().toISOString().slice(0,10)}.csv"`);
    res.writeHead(200); res.end('\uFEFF' + csv); // BOM para Excel reconhecer UTF-8
    return;
  }



  // ── /dashboard/backup-fixer e /dashboard/converter → passthrough para app.zapvoice.com.br ──
  if (req.method === 'GET' && (p === '/dashboard/backup-fixer' || p === '/dashboard/converter')) {
    res.writeHead(302, { Location: 'https://app.zapvoice.com.br' + p });
    res.end();
    return;
  }

  // ── Painel do cliente: POST /client/status (verifica chave e retorna dados JSON) ──
  if (p === '/client/status' && req.method === 'POST') {
    const body = await parseBody(req);
    const code = (body.key || '').trim().toLowerCase();
    if (!code || !keys[code]) { sendJson(res, { error: 'not_found' }, 404); return; }
    const k = keys[code];
    const expired = isKeyExpired(k);
    const hoursLeft = hoursUntilExpiry(k);
    sendJson(res, {
      label:        k.label || 'Cliente',
      active:       k.active && !expired,
      expired,
      expiresAt:    k.expiresAt || null,
      activatedAt:  k.activatedAt || null,
      lastUsed:     k.lastUsed || null,
      phones:       (k.phones || []).length,
      phoneList:    k.phones || [],
      maxUses:      k.maxUses === -1 ? null : (k.maxUses > 0 ? k.maxUses : MAX_USES),
      hoursLeft:    hoursLeft,
      deferred:     !!(k.expireDuration && !k.expiresAt),
      warnCount:    k.warnCount || 0,
    });
    return;
  }

  // ── Portal do cliente: remover proprio numero ──
  if (p === '/client/remove-phone' && req.method === 'POST') {
    const body = await parseBody(req);
    const code  = (body.key   || '').trim().toLowerCase();
    const phone = (body.phone || '').trim();
    if (!code || !keys[code]) { sendJson(res, { error: 'not_found' }, 404); return; }
    if (!phone) { sendJson(res, { error: 'phone obrigatorio' }, 400); return; }
    const phones = keys[code].phones || [];
    if (!phones.includes(phone)) { sendJson(res, { error: 'numero nao encontrado' }, 404); return; }
    keys[code].phones = phones.filter(p => p !== phone);
    keys[code].uses = keys[code].phones.length;
    if (keys[code].lastPhone === phone) keys[code].lastPhone = keys[code].phones[keys[code].phones.length-1] || null;
    saveDb().catch(()=>{});
    sendJson(res, { ok: true, phones: keys[code].phones }); return;
  }

  // ── Portal do cliente: todas as rotas públicas que a extensão abre ──
  const CLIENT_PORTAL_PATHS = ['/', '/plans/manage', '/plans/new', '/dashboard/chaves'];
  if (req.method === 'GET' && (
    CLIENT_PORTAL_PATHS.includes(p) ||
    p.startsWith('/unauthorized') ||
    p.startsWith('/funnels') ||
    p.startsWith('/labels')
  )) {
    sendHtml(res, renderClientPortal());
    return;
  }

  sendJson(res, { ok: true });
}

// ── Inicialização assíncrona: conecta ao MongoDB antes de aceitar requests ──
(async () => {
  try {
    if (!MONGODB_URI) {
      console.error('❌ ERRO CRÍTICO: Defina MONGODB_URI nas variáveis de ambiente do Render.com');
      console.error('   Formato: mongodb+srv://user:pass@cluster.mongodb.net/zapvoice');
      process.exit(1);
    }
    const loaded = await loadDb();
    keys = loaded.keys || {};
    logs = loaded.logs || [];
    serverReady = true;
    console.log(`✅ ZapVoice Server v7 — porta ${PORT}`);
    console.log(`🍃 MongoDB: conectado | Chaves: ${Object.keys(keys).length} | Logs: ${logs.length}`);
    console.log(`🔐 HMAC: ${APP_SECRET ? 'ATIVO' : '⚠ inativo — defina APP_SECRET'}`);
    console.log(`🔑 2FA:  ${TOTP_SECRET ? 'ATIVO' : '⚠ inativo — defina TOTP_SECRET'}`);
    console.log(`🔑 Admin: ${R_ADMIN} | User: ${ADMIN_USER}`);
    console.log(`🌐 Extension: ${R_EXT}/v3/key`);
    console.log(`📊 Webhook: ${WEBHOOK_URL || 'não configurado'} | Expiração: ${EXPIRY_WARN_HOURS}h`);
    const safeHandler = (req, res) => {
      handleRequest(req, res).catch(err => {
        console.error(`[ERRO] ${req.method} ${req.url}:`, err);
        if (!res.headersSent) { res.writeHead(500); res.end('Internal Server Error'); }
      });
    };
    process.on('uncaughtException', err => console.error('[uncaughtException]', err));
    process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));
    http.createServer(safeHandler).listen(PORT, () => {
      console.log(`🚀 Servidor ouvindo na porta ${PORT}`);

      // ── Auto-ping: evita que o Render duerma o serviço no plano Free ──
      // Usa http (não https) pois pinga localhost diretamente — sem TLS
      setInterval(() => {
        http.get({ hostname: 'localhost', port: PORT, path: '/health' }, res => {
          res.resume();
          console.log('[keep-alive] ping OK ' + res.statusCode);
        }).on('error', err => {
          console.warn('[keep-alive] erro: ' + err.message);
        });
      }, 4 * 60 * 1000);
    });
  } catch (e) {
    console.error('❌ Falha ao iniciar:', e.message);
    process.exit(1);
  }
})();
