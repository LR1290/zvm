const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT       = process.env.PORT       || 3000;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
if (!ADMIN_USER || !ADMIN_PASS) {
  console.error('❌ ERRO CRÍTICO: Defina as variáveis de ambiente ADMIN_USER e ADMIN_PASS antes de iniciar.');
  console.error('   No Render.com: Settings > Environment Variables');
  process.exit(1);
}

// ─────────────────────────────────────────────
// PERSISTÊNCIA
// ─────────────────────────────────────────────
const DB_FILE = process.env.DB_PATH || '/tmp/zapvoice_db.json';

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) { console.error('Erro ao carregar DB:', e.message); }
  return { keys: {}, logs: [] };
}
function saveDb() {
  try { fs.writeFileSync(DB_FILE, JSON.stringify({ keys, logs }, null, 2), 'utf8'); }
  catch (e) { console.error('Erro ao salvar DB:', e.message); }
}

const db  = loadDb();
let keys     = db.keys || {};
let logs     = db.logs || [];
let sessions = {};

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


// Aviso de expiração antecipado: quantas horas antes mostrar banner
const EXPIRY_WARN_HOURS = parseInt(process.env.EXPIRY_WARN_HOURS || '48');

// Webhook (opcional): URL para notificar bloqueio/expiração
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';

// ─────────────────────────────────────────────
// RATE LIMITING (anti brute-force)
// ─────────────────────────────────────────────
const rateLimitMap = new Map(); // ip -> { count, resetAt }
const RATE_LIMIT_MAX      = 20;   // tentativas por janela
const RATE_LIMIT_WINDOW   = 60000; // 1 minuto
const RATE_LIMIT_BLOCK_MS = 10 * 60000; // 10 min bloqueado após exceder

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW, blocked: false, blockedUntil: 0 };
    rateLimitMap.set(ip, entry);
  }
  if (entry.blocked) {
    if (now < entry.blockedUntil) return false;
    entry.blocked = false; entry.count = 0; entry.resetAt = now + RATE_LIMIT_WINDOW;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    entry.blocked = true; entry.blockedUntil = now + RATE_LIMIT_BLOCK_MS;
    console.warn(`[RATE-LIMIT] IP bloqueado: ${ip}`);
    return false;
  }
  return true;
}
// Limpar entradas antigas a cada 15 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of rateLimitMap.entries())
    if (now > e.resetAt && !e.blocked) rateLimitMap.delete(ip);
}, 15 * 60000);

// ─────────────────────────────────────────────
// WEBHOOK
// ─────────────────────────────────────────────
async function fireWebhook(event, keyCode, reason) {
  if (!WEBHOOK_URL) return;
  const k = keys[keyCode];
  const payload = {
    event,       // 'key_blocked' | 'key_expired' | 'key_auto_blocked'
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
    data: {
      key: keyCode, keyId: `id-${keyCode}`, ownerId: 'zv-owner', managerId: 'zv-manager',
      permissions: FULL_PERMISSIONS, username: keys[keyCode]?.label || 'Cliente ZapVoice',
      paymentUrl: null, marketplace: 'premium', email: 'cliente@zapvoice.com.br',
      planName: 'Pro', plan_id: 'ZV_PRO', isLoggedIn: true, isPremium: true, isBasicPlan: false
    }
  };
}

function addLog(entry) {
  logs.unshift({ ...entry, timestamp: new Date().toISOString() });
  if (logs.length > 500) logs = logs.slice(0, 500);
  saveDb();
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
  <form method="POST" action="/admin/login">
    <label>Usuário</label><input type="text" name="user" autocomplete="off">
    <label>Senha</label><input type="password" name="pass">
    <button type="submit" class="btn">Entrar</button>
  </form>

<!-- Modal Definir Limite -->
<div id="modal-limit" style="display:none;position:fixed;inset:0;background:#000b;z-index:999;align-items:center;justify-content:center;" onclick="if(event.target===this)closeModal('modal-limit')">
  <div style="background:#16162a;border:1px solid #333;border-radius:14px;padding:28px 32px;min-width:320px;max-width:92vw;box-shadow:0 8px 40px #0009">
    <h3 style="margin:0 0 4px;color:#e0e0e0;font-size:.95rem;font-weight:600;">Definir Limite de Usos</h3>
    <p style="margin:0 0 18px;color:#555;font-size:.76rem;word-break:break-all" id="ml-label"></p>
    <input type="hidden" id="ml-code">
    <label style="font-size:.78rem;color:#888;display:block;margin-bottom:6px;">
      Máx. de números únicos &nbsp;<span style="color:#555">( deixe vazio ou 0 = ilimitado )</span>
    </label>
    <input id="ml-val" type="number" min="1" step="1" placeholder="Ex: 3"
      style="width:100%;box-sizing:border-box;padding:9px 12px;background:#111;border:1px solid #333;border-radius:8px;color:#e0e0e0;font-size:.9rem;margin-bottom:20px;outline:none;"
      onkeydown="if(event.key==='Enter')saveLimit();if(event.key==='Escape')closeModal('modal-limit')">
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="bs" style="background:#1a1a1a;color:#777;border:1px solid #2a2a2a" onclick="closeModal('modal-limit')">Cancelar</button>
      <button class="bs" style="background:#00ff8818;color:#00ff88;border:1px solid #00ff8830" onclick="saveLimit()">Salvar</button>
    </div>
  </div>
</div>
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
    const expHtml   = k.expiresAt ? (() => {
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
  <td><span class="badge ${k.active?'on':'off'}">${k.active?'ATIVO':'BLOQUEADO'}</span></td>
  <td><span style="color:${(typeof k.maxUses==='number')&&(k.phones||[]).length>=k.maxUses?'var(--orange)':'inherit'}">${(k.phones||[]).length}/${typeof k.maxUses==='number'?k.maxUses:'∞'}</span></td>
  <td>${escHtml(k.lastPhone||'-')}</td>
  <td>${escHtml(k.lastIp||'-')}</td>
  <td>${k.lastUsed?new Date(k.lastUsed).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'-'}</td>
  <td>${new Date(k.createdAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}${expHtml}</td>
  <td class="note-cell" onclick="openNote('${escHtml(code)}','${noteEsc.replace(/'/g,"\\'")}')"><span class="note-preview">${noteEsc || '<span style=\\"color:var(--muted)\\">—</span>'}</span></td>
  <td>
    <button class="bs ${k.active?'bd':'bg'}" onclick="toggleKey('${escHtml(code)}')">${k.active?'Bloquear':'Liberar'}</button>
    <button class="bs bd" onclick="deleteKey('${escHtml(code)}')">Excluir</button>
    <button class="bs" style="background:#3a3aff15;color:#9090ff;border:1px solid #7b7bff40" onclick="setLimit('${escHtml(code)}')">${typeof k.maxUses==='number'?'Usos: '+k.maxUses:'∞ Ilimitado'}</button>
    <button class="bs" style="background:#ff550015;color:#ff8844;border:1px solid #ff550040" onclick="resetPhones('${escHtml(code)}')" title="Limpar números registrados">Limpar Nºs</button>
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
  <td><span class="badge ${l.action==='login_ok'?'on':l.action==='relogin_ok'?'re':l.action==='verify_ok'?'vr':l.action==='login_blocked'||l.action==='auto_blocked'?'off':l.action==='limit_reached'?'wl':'warn'}">${escHtml(l.action)}</span></td>
</tr>`).join('');
}

// ─────────────────────────────────────────────
// ADMIN: DASHBOARD — renderização completa
// ─────────────────────────────────────────────
function renderAdminDashboard() {
  const expiringSoon = Object.values(keys).filter(k => k.active && isKeyExpiringSoon(k)).length;
  const limitedKeys  = Object.values(keys).filter(k => k.active && typeof k.maxUses==='number').length;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZapVoice Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--green:#00ff87;--dark:#0a0a0f;--card:#111118;--border:#1e1e2e;--text:#e2e2f0;--muted:#6b6b8a;--red:#ff4757;--yellow:#ffd32a;--orange:#ff8600}
body{background:var(--dark);color:var(--text);font-family:'Space Mono',monospace;min-height:100vh}
header{display:flex;align-items:center;justify-content:space-between;padding:18px 32px;border-bottom:1px solid var(--border);background:var(--card);position:sticky;top:0;z-index:100}
.logo{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:var(--green)}
.hright{display:flex;align-items:center;gap:16px}
a.out{color:var(--muted);font-size:12px;text-decoration:none}
a.out:hover{color:var(--red)}
main{padding:28px 32px;max-width:1600px;margin:0 auto}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:28px}
.sc{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px;position:relative}
.sc.warn-card{border-color:var(--orange)}
.sc .n{font-family:'Syne',sans-serif;font-size:38px;font-weight:800;color:var(--green)}
.sc.warn-card .n{color:var(--orange)}
.sc .l{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-top:4px}
.sec{background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:22px;overflow:hidden}
.sh{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:12px}
.st{font-family:'Syne',sans-serif;font-weight:700;font-size:15px}
.gf{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.gf input{padding:9px 13px;background:var(--dark);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'Space Mono',monospace;font-size:13px;outline:none}
.gf input:focus{border-color:var(--green)}
.btn{padding:10px 18px;border:none;border-radius:8px;cursor:pointer;font-family:'Syne',sans-serif;font-weight:700;font-size:13px;transition:opacity .2s}
.btn:hover{opacity:.8}
.bp{background:var(--green);color:#000}
.bw{background:#ffd32a20;color:var(--yellow);border:1px solid var(--yellow)}
.bs{padding:5px 11px;border:none;border-radius:6px;cursor:pointer;font-family:'Space Mono',monospace;font-size:11px;margin-right:3px;transition:opacity .2s}
.bs:hover{opacity:.8}
.bg{background:#00ff8720;color:var(--green);border:1px solid var(--green)}
.bd{background:#ff475720;color:var(--red);border:1px solid var(--red)}
.ov{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{padding:11px 15px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);border-bottom:1px solid var(--border);font-weight:400;cursor:default}
th.sort{cursor:pointer;user-select:none}
th.sort:hover{color:var(--text)}
th.asc .arr::after{content:' ▲'}
th.desc .arr::after{content:' ▼'}
th:not(.asc):not(.desc) .arr::after{content:' ⇅';opacity:.3}
td{padding:13px 15px;font-size:12px;border-bottom:1px solid var(--border);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover{background:#ffffff04}
.kc{color:var(--green);font-size:12px;letter-spacing:1px}
.badge{padding:3px 8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:1px}
.on{background:#00ff8720;color:var(--green)}
.off{background:#ff475720;color:var(--red)}
.re{background:#4287f520;color:#4287f5}
.vr{background:#9b59b620;color:#9b59b6}
.warn{background:#ffd32a20;color:var(--yellow)}
.wl{background:#ff8c0020;color:#ff8c00}
.empty{text-align:center;color:var(--muted);padding:32px!important}
.toast{position:fixed;bottom:28px;right:28px;padding:13px 22px;border-radius:10px;font-family:'Syne',sans-serif;font-weight:700;font-size:14px;display:none;z-index:999}
/* Notas */
.note-cell{cursor:pointer;max-width:160px}
.note-cell:hover .note-preview{color:var(--green)}
.note-preview{color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;max-width:150px}
/* Modal */
.modal-bg{display:none;position:fixed;inset:0;background:#00000088;z-index:200;align-items:center;justify-content:center}
.modal-bg.open{display:flex}
.modal{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:28px;width:380px;max-width:95vw}
.modal h3{font-family:'Syne',sans-serif;font-size:15px;margin-bottom:14px;color:var(--green)}
.modal textarea{width:100%;background:var(--dark);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'Space Mono',monospace;font-size:12px;padding:10px;outline:none;resize:vertical;min-height:90px}
.modal textarea:focus{border-color:var(--green)}
.modal-actions{display:flex;gap:8px;margin-top:14px;justify-content:flex-end}
@media(max-width:900px){.stats{grid-template-columns:1fr 1fr};main{padding:16px}}
@media(max-width:500px){.stats{grid-template-columns:1fr}}
</style>
</head>
<body>
<header>
  <div class="logo">⚡ ZapVoice Admin</div>
  <div class="hright">
    <button class="btn" style="background:#00ff8720;color:var(--green);border:1px solid var(--green);font-size:12px;padding:7px 14px" onclick="exportCSV()">⬇ CSV</button>
    <a href="/admin/logout" class="out">[ sair ]</a>
  </div>
</header>
<main>
  <div class="stats">
    <div class="sc"><div class="n" id="s-total">${Object.keys(keys).length}</div><div class="l">Total de Chaves</div></div>
    <div class="sc"><div class="n" id="s-active">${Object.values(keys).filter(k=>k.active).length}</div><div class="l">Chaves Ativas</div></div>
    <div class="sc ${expiringSoon > 0 ? 'warn-card' : ''}"><div class="n" id="s-warn" style="${expiringSoon>0?'color:var(--orange)':''}">${expiringSoon}</div><div class="l">Expirando em ${EXPIRY_WARN_HOURS}h</div></div>
    <div class="sc"><div class="n" id="s-limited">${limitedKeys}</div><div class="l">Com Limite Definido</div></div>
    <div class="sc"><div class="n" id="s-logs">${logs.length}</div><div class="l">Acessos Registrados</div></div>
  </div>

  <div class="sec">
    <div class="sh">
      <div class="st">Chaves de Acesso</div>
      <div class="gf">
        <input type="text" id="nlabel" placeholder="Nome do cliente" style="width:170px">
        <input type="number" id="ndays"  placeholder="Dias"  min="0" style="width:68px">
        <input type="number" id="nhours" placeholder="Horas" min="0" style="width:72px">
        <input type="number" id="nmins"  placeholder="Min"   min="0" style="width:65px">
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
      <div class="st">Log de Acessos</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="date" id="logDate" style="padding:8px 12px;background:var(--dark);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'Space Mono',monospace;font-size:12px;outline:none" onchange="filterLog()">
        <button class="btn bw" onclick="clearDateFilter()">✕ Filtro</button>
        <button class="btn bw" onclick="doRefresh()">↻ Atualizar</button>
        <button class="btn" style="background:#ff475720;color:var(--red);border:1px solid var(--red)" onclick="clearLog()">🗑 Limpar Log</button>
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

<!-- Modal de notas -->
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
  if(!label){toast('Informe o nome do cliente',false);return;}
  try{
    const body={label};
    if(days>0)body.expireDays=days;
    if(hours>0)body.expireHours=hours;
    if(mins>0)body.expireMinutes=mins;
    const r=await fetch('/admin/api/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(r.status===401){toast('Sessão expirada',false);setTimeout(()=>location.href='/admin',1500);return;}
    const d=await r.json();
    if(d.ok){
      const parts=[];
      if(days>0)parts.push(days+'d'); if(hours>0)parts.push(hours+'h'); if(mins>0)parts.push(mins+'min');
      toast('Gerada: '+d.key+(parts.length?' (expira em '+parts.join(' ')+')':''));
      ['nlabel','ndays','nhours','nmins'].forEach(id=>document.getElementById(id).value='');
      await doRefresh();
    } else toast('Erro: '+(d.error||'desconhecido'),false);
  }catch(e){toast('Erro de rede',false);}
}
async function filterLog(){
  const date=document.getElementById('logDate').value;
  if(!date)return;
  try{
    const r=await fetch('/admin/api/logs?date='+date);
    if(r.status===401){toast('Sessão expirada',false);setTimeout(()=>location.href='/admin',1500);return;}
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
    const r=await fetch('/admin/api/logs',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(r.status===401){toast('Sessão expirada',false);setTimeout(()=>location.href='/admin',1500);return;}
    const d=await r.json();
    if(d.ok){toast(date?'Log do dia limpo!':'Log completo apagado!');document.getElementById('logDate').value='';await doRefresh();}
  }catch(e){toast('Erro ao limpar',false);}
}
async function toggleKey(code){
  try{
    const r=await fetch('/admin/api/keys/'+encodeURIComponent(code)+'/toggle',{method:'POST'});
    if(r.status===401){toast('Sessão expirada',false);setTimeout(()=>location.href='/admin',1500);return;}
    const d=await r.json();
    if(d.ok){toast(d.active?'Chave liberada!':'Chave bloqueada!');await doRefresh();}
  }catch(e){toast('Erro',false);}
}
async function deleteKey(code){
  if(!confirm('Excluir chave '+code+'?'))return;
  try{
    const r=await fetch('/admin/api/keys/'+encodeURIComponent(code),{method:'DELETE'});
    if(r.status===401){toast('Sessão expirada',false);setTimeout(()=>location.href='/admin',1500);return;}
    const d=await r.json();
    if(d.ok){toast('Chave excluída');await doRefresh();}
  }catch(e){toast('Erro',false);}
}
// ── Modal definir limite ──
function setLimit(code){
  document.getElementById('ml-code').value = code;
  document.getElementById('ml-val').value = '';
  document.getElementById('ml-label').textContent = code;
  document.getElementById('modal-limit').style.display = 'flex';
  setTimeout(()=>document.getElementById('ml-val').focus(),50);
}
function closeModal(id){ document.getElementById(id).style.display='none'; }

async function saveLimit(){
  const code = document.getElementById('ml-code').value;
  const val  = document.getElementById('ml-val').value.trim();
  let body;
  if(val===''||val==='0'){
    body = {unlimited:true};
  } else {
    const n = parseInt(val,10);
    if(isNaN(n)||n<1){ toast('Digite um número maior que 0, ou deixe vazio para ilimitado.',false); return; }
    body = {maxUses:n};
  }
  try{
    const r=await fetch('/admin/api/keys/'+encodeURIComponent(code)+'/set-limit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(d.ok){ toast(body.unlimited?'Chave definida como ilimitada':'Limite definido: '+body.maxUses+' números'); closeModal('modal-limit'); await doRefresh(); }
    else toast(d.error||'Erro',false);
  }catch(e){toast('Erro de rede',false);}
}

async function resetPhones(code){
  if(!confirm('Limpar todos os números registrados desta chave?
O próximo número que logar será registrado como o 1º.')) return;
  try{
    const r=await fetch('/admin/api/keys/'+encodeURIComponent(code)+'/reset-phones',{method:'POST'});
    const d=await r.json();
    if(d.ok){ toast('Números limpos'); await doRefresh(); }
    else toast(d.error||'Erro',false);
  }catch(e){toast('Erro de rede',false);}
}

async function doRefresh(){
  try{
    const r=await fetch('/admin/api/data');
    const d=await r.json();
    if(d.error)return;
    document.getElementById('s-total').textContent=d.totalKeys||0;
    document.getElementById('s-active').textContent=d.activeKeys||0;
    document.getElementById('s-logs').textContent=d.totalLogs||0;
    const sw=document.getElementById('s-warn');
    sw.textContent=d.warnKeys||0;
    sw.style.color=(d.warnKeys>0)?'var(--orange)':'var(--green)';
    sw.closest('.sc').classList.toggle('warn-card',d.warnKeys>0);
    const sl=document.getElementById('s-limited');if(sl){sl.textContent=d.limitedKeys||0;}
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
async function saveNote(){
  const code=document.getElementById('noteKeyCode').value;
  const note=document.getElementById('noteText').value.trim();
  try{
    const r=await fetch('/admin/api/keys/'+encodeURIComponent(code)+'/note',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note})});
    if(r.status===401){toast('Sessão expirada',false);setTimeout(()=>location.href='/admin',1500);return;}
    const d=await r.json();
    if(d.ok){toast('Nota salva!');closeNote();await doRefresh();}
    else toast('Erro ao salvar nota',false);
  }catch(e){toast('Erro de rede',false);}
}

// ── Exportar CSV ──
async function exportCSV(){
  try{
    const r=await fetch('/admin/api/export/csv');
    if(r.status===401){toast('Sessão expirada',false);setTimeout(()=>location.href='/admin',1500);return;}
    const blob=await r.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download='zapvoice-chaves-'+new Date().toISOString().slice(0,10)+'.csv';
    a.click(); URL.revokeObjectURL(url);
    toast('CSV exportado!');
  }catch(e){toast('Erro ao exportar',false);}
}

</script>
</body></html>`;
}

// ─────────────────────────────────────────────
// ROTEADOR
// ─────────────────────────────────────────────
async function handleRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-app-date');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p   = url.pathname;
  const ip  = getIp(req);
  console.log(`[${new Date().toISOString()}] ${req.method} ${p} — ${ip}`);

  // ── EXTENSÃO: página de login ──
  if ((p === '/extension/auth/' || p === '/extension/auth') && req.method === 'GET') {
    const callback = url.searchParams.get('callback') || '';
    sendHtml(res, renderExtensionLogin({ callback }));
    return;
  }

  // ── EXTENSÃO: verifica chave e faz callback ──
  if (p === '/extension/auth/verify' && req.method === 'POST') {
    if (!checkRateLimit(ip)) {
      sendHtml(res, renderExtensionLogin({ callback: '', error: '⏳ Muitas tentativas. Aguarde alguns minutos.' }), 429);
      return;
    }
    const form     = await parseFormBody(req);
    const keyCode  = (form.get('key') || '').trim().toLowerCase();
    const callback = form.get('callback') || '';

    if (!keyCode || !keys[keyCode]) {
      addLog({ keyCode: keyCode||'?', label: '-', phone: '-', ip, wppVersion: '-', action: 'key_not_found' });
      sendHtml(res, renderExtensionLogin({ callback, keyVal: keyCode, error: '❌ Chave não encontrada. Verifique se digitou corretamente ou entre em contato com o vendedor.' }));
      return;
    }
    if (isKeyExpired(keys[keyCode])) {
      keys[keyCode].active = false;
      addLog({ keyCode, label: keys[keyCode].label, phone: '-', ip, wppVersion: '-', action: 'expired' });
      saveDb();
      fireWebhook('key_expired', keyCode, 'Expiração detectada no login');
      sendHtml(res, renderExtensionLogin({ callback, keyVal: keyCode, error: '⏰ Chave expirada. Entre em contato com o vendedor para renovar.' }));
      return;
    }
    if (!keys[keyCode].active) {
      addLog({ keyCode, label: keys[keyCode].label, phone: '-', ip, wppVersion: '-', action: 'login_blocked' });
      sendHtml(res, renderExtensionLogin({ callback, keyVal: keyCode, error: '🚫 Chave bloqueada. Entre em contato com o vendedor.' }));
      return;
    }
    // Sem verificação de limite aqui — controlado por maxUses no /v3/key
    keys[keyCode].lastUsed = new Date().toISOString();
    keys[keyCode].lastIp   = ip;
    saveDb();
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
  if (p === '/extension/v3/key' && req.method === 'POST') {
    if (!checkRateLimit(ip)) {
      sendJson(res, { authError: 'rateLimited', authErrorMessage: 'Muitas tentativas. Aguarde.' }, 429);
      return;
    }
    const body       = await parseBody(req);
    const keyCode    = (body.authKey || '').toLowerCase();
    const phone      = body.phoneNumber || '-';
    const wppVersion = body.wppVersion  || '-';
    const deviceId   = body.deviceId    || '';

    if (!keyCode || !keys[keyCode]) {
      addLog({ keyCode: keyCode||'?', label: '-', phone, ip, wppVersion, action: 'key_not_found' });
      sendJson(res, { authError: 'keyNotFound', authErrorMessage: 'Chave não encontrada. Contate o vendedor.' });
      return;
    }
    if (isKeyExpired(keys[keyCode])) {
      keys[keyCode].active = false;
      addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: 'expired' });
      saveDb();
      fireWebhook('key_expired', keyCode, 'Expiração detectada no v3/key');
      sendJson(res, { data: { message: 'USUÁRIO NÃO ENCONTRADO. Chave expirada.', permissions: [] } }, 403);
      return;
    }
    if (!keys[keyCode].active) {
      addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: 'login_blocked' });
      sendJson(res, { data: { message: 'USUÁRIO NÃO ENCONTRADO. Chave bloqueada.', permissions: [] } }, 403);
      return;
    }

    // Migrar lastPhone legado para lista phones[]
    if (!keys[keyCode].phones) {
      keys[keyCode].phones = keys[keyCode].lastPhone ? [keys[keyCode].lastPhone] : [];
    }

    const hasPhone   = phone && phone !== '-';
    const knownPhone = hasPhone && keys[keyCode].phones.includes(phone);
    const isNewPhone = hasPhone && !knownPhone;
    const maxUses    = keys[keyCode].maxUses; // undefined = ilimitado, número = limite

    if (isNewPhone) {
      const atLimit = (typeof maxUses === 'number') && keys[keyCode].phones.length >= maxUses;
      if (atLimit) {
        // Limite atingido: apenas registra no log, NÃO bloqueia automaticamente
        addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: 'limit_reached' });
        keys[keyCode].lastUsed = new Date().toISOString();
        keys[keyCode].lastIp   = ip;
        saveDb();
        // Retorna 403 para não permitir este número novo, mas chave continua ativa
        sendJson(res, {
          data: {
            message: `UUSUÁRIO NÃO ENCONTRADO. Número não autorizado. Limite de ${maxUses} ativações atingido.`,
            permissions: []
          }
        }, 403);
        return;
      }
      keys[keyCode].phones.push(phone);
      keys[keyCode].uses = keys[keyCode].phones.length;
    }

    keys[keyCode].lastUsed  = new Date().toISOString();
    keys[keyCode].lastIp    = ip;
    if (hasPhone) keys[keyCode].lastPhone = phone;
    addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: isNewPhone ? 'login_ok' : 'relogin_ok' });
    saveDb();
    sendJson(res, getAuthData(keyCode));
    return;
  }

  // ── EXTENSÃO: check-status (polling 30s) ──
  if (p === '/extension/v3/check-status' && req.method === 'POST') {
    const body    = await parseBody(req);
    const keyCode = (body.authKey || '').toLowerCase();
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
  if (['/extension/v3/usage','/extension/v3/get-usage','/extension/v3/sync-usage'].includes(p)) {
    sendJson(res, {
      ok: true, status: true, limits: USAGE_LIMITS,
      expires_at: new Date(Date.now() + 365*24*60*60*1000).toISOString(), isExpired: false
    });
    return;
  }

  // ── ADMIN: login ──
  if (p === '/admin/login' && req.method === 'POST') {
    const form = await parseFormBody(req);
    if (form.get('user') === ADMIN_USER && form.get('pass') === ADMIN_PASS) {
      const token = generateToken();
      sessions[token] = { expiresAt: new Date(Date.now() + 8*60*60*1000).toISOString() };
      res.setHeader('Set-Cookie', `zv_admin=${token}; Path=/; HttpOnly; SameSite=Strict`);
      res.writeHead(302, { Location: '/admin' }); res.end();
    } else { sendHtml(res, renderAdminLogin('Usuário ou senha incorretos')); }
    return;
  }

  // ── ADMIN: logout ──
  if (p === '/admin/logout') {
    res.setHeader('Set-Cookie', 'zv_admin=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    res.writeHead(302, { Location: '/admin' }); res.end(); return;
  }

  // ── ADMIN: painel ──
  if (p === '/admin' || p === '/admin/') {
    if (!isAdminSession(req)) { sendHtml(res, renderAdminLogin()); return; }
    sendHtml(res, renderAdminDashboard()); return;
  }

  // ── ADMIN API: dados ──
  if (p === '/admin/api/data' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    sendJson(res, {
      totalKeys:    Object.keys(keys).length,
      activeKeys:   Object.values(keys).filter(k=>k.active).length,
      warnKeys:     Object.values(keys).filter(k => k.active && isKeyExpiringSoon(k)).length,
      limitedKeys:  Object.values(keys).filter(k => k.active && typeof k.maxUses==='number').length,
      totalLogs:    logs.length,
      keysHtml:     buildKeysHtml(),
      logsHtml:     buildLogsHtml()
    }); return;
  }

  // ── ADMIN API: gerar chave ──
  if (p === '/admin/api/keys' && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const body = await parseBody(req);
    const code = generateKey();
    let expiresAt = null;
    if (body.expiresAt) {
      expiresAt = new Date(body.expiresAt).toISOString();
    } else {
      const days = parseInt(body.expireDays || 0), hours = parseInt(body.expireHours || 0), minutes = parseInt(body.expireMinutes || 0);
      if (days > 0 || hours > 0 || minutes > 0) {
        const d = new Date();
        d.setTime(d.getTime() + ((days * 1440) + (hours * 60) + minutes) * 60000);
        expiresAt = d.toISOString();
      }
    }
    keys[code] = { label: body.label || 'Cliente', active: true, createdAt: new Date().toISOString(), uses: 0, lastUsed: null, lastIp: null, lastPhone: null, deviceId: null, note: '', expiresAt };
    saveDb();
    sendJson(res, { ok: true, key: code }); return;
  }

  // ── ADMIN API: set-limit ──
  // maxUses: undefined = ilimitado | número = limite de números únicos
  if (p.match(/^\/admin\/api\/keys\/[^/]+\/set-limit$/) && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const code = decodeURIComponent(p.split('/')[4]);
    if (!keys[code]) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    if (body.unlimited) {
      delete keys[code].maxUses;
    } else {
      const n = parseInt(body.maxUses, 10);
      if (isNaN(n) || n < 1) { sendJson(res, { error: 'invalid' }, 400); return; }
      keys[code].maxUses = n;
    }
    saveDb();
    addLog({ keyCode: code, label: keys[code].label, phone: '-', ip, wppVersion: '-', action: 'limit_changed' });
    sendJson(res, { ok: true }); return;
  }

  // ── ADMIN API: reset-phones (limpar lista de números registrados) ──
  if (p.match(/^\/admin\/api\/keys\/[^/]+\/reset-phones$/) && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const code = decodeURIComponent(p.split('/')[4]);
    if (!keys[code]) { sendJson(res, { error: 'not found' }, 404); return; }
    keys[code].phones    = [];
    keys[code].uses      = 0;
    keys[code].lastPhone = '-';
    saveDb();
    addLog({ keyCode: code, label: keys[code].label, phone: '-', ip, wppVersion: '-', action: 'phones_reset' });
    sendJson(res, { ok: true }); return;
  }

  // ── ADMIN API: toggle ──
  if (p.match(/^\/admin\/api\/keys\/[^/]+\/toggle$/) && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const code = decodeURIComponent(p.split('/')[4]);
    if (!keys[code]) { sendJson(res, { error: 'not found' }, 404); return; }
    keys[code].active = !keys[code].active;
    saveDb();
    if (!keys[code].active) fireWebhook('key_blocked', code, 'Bloqueio manual pelo admin');
    sendJson(res, { ok: true, active: keys[code].active }); return;
  }

  // ── ADMIN API: nota ──
  if (p.match(/^\/admin\/api\/keys\/[^/]+\/note$/) && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const code = decodeURIComponent(p.split('/')[4]);
    if (!keys[code]) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    keys[code].note = String(body.note || '').slice(0, 500);
    saveDb();
    sendJson(res, { ok: true }); return;
  }

  // ── ADMIN API: deletar chave ──
  if (p.match(/^\/admin\/api\/keys\/[^/]+$/) && req.method === 'DELETE') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const code = decodeURIComponent(p.split('/')[4]);
    delete keys[code];
    saveDb();
    sendJson(res, { ok: true }); return;
  }

  // ── ADMIN API: limpar log ──
  if (p === '/admin/api/logs' && req.method === 'DELETE') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const body = await parseBody(req);
    if (body.date) { logs = logs.filter(l => !l.timestamp.startsWith(body.date)); }
    else { logs = []; }
    saveDb();
    sendJson(res, { ok: true, remaining: logs.length }); return;
  }

  // ── ADMIN API: filtrar log ──
  if (p === '/admin/api/logs' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const date = url.searchParams.get('date');
    const filtered = date ? logs.filter(l => l.timestamp.startsWith(date)) : logs;
    sendJson(res, { ok: true, logsHtml: buildLogsHtml(filtered) }); return;
  }

  // ── ADMIN API: exportar CSV ──
  if (p === '/admin/api/export/csv' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const header = 'Chave,Cliente,Status,Usos,Telefone,Último IP,Último Acesso,Criada em,Expira em,Nota';
    const rows = Object.entries(keys).map(([code, k]) => {
      const cols = [
        code, k.label, k.active ? 'ATIVO' : 'BLOQUEADO',
        `${k.uses||0}/${MAX_USES}`, k.lastPhone||'',
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


  sendJson(res, { ok: true });
}

http.createServer(handleRequest).listen(PORT, () => {
  console.log(`✅ ZapVoice Server v5 — porta ${PORT}`);
  console.log(`💾 DB: ${DB_FILE}`);
  console.log(`🔑 Admin: /admin | User: ${ADMIN_USER}`);
  console.log(`📊 Chaves: ${Object.keys(keys).length} | Webhook: ${WEBHOOK_URL || 'não configurado'}`);
  console.log(`⚠  Aviso expiração: ${EXPIRY_WARN_HOURS}h antes`);
});
