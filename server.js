const http = require('http');
const crypto = require('crypto');
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// CONFIG ADMIN (defina no .env do Render)
// ─────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || 'lr1290';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

// ─────────────────────────────────────────────
// BANCO EM MEMÓRIA
// ─────────────────────────────────────────────
let keys = {};
let logs = [];
let sessions = {};

const FULL_PERMISSIONS = [
  "create_flow","massive_dispatching","schedule_item",
  "send_flow","send_funnel","send_trigger"
];

const USAGE_LIMITS = {
  audio:        { sent: 0, max: 99999 },
  bulkMessages: { sent: 0, max: 99999 },
  document:     { sent: 0, max: 99999 },
  flow:         { sent: 0, max: 99999 },
  funnel:       { sent: 0, max: 99999 },
  media:        { sent: 0, max: 99999 },
  message:      { sent: 0, max: 99999 },
  scheduleItem: { sent: 0, max: 99999 }
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function generateKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const seg = () => Array.from({length:5}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  return `ZV-${seg()}-${seg()}-${seg()}`;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getAuthData(keyCode) {
  return {
    numberWarning: false,
    segments: [],
    data: {
      key: keyCode,
      keyId: `id-${keyCode}`,
      ownerId: "lr1290-owner",
      managerId: "lr1290-manager",
      permissions: FULL_PERMISSIONS,
      username: keys[keyCode]?.label || "Cliente ZapVoice",
      paymentUrl: null,
      marketplace: "premium",
      email: "cliente@zapvoice.com.br",
      planName: "Pro",
      plan_id: "ZV_PRO",
      isLoggedIn: true,
      isPremium: true,
      isBasicPlan: false
    }
  };
}

function addLog(entry) {
  logs.unshift({ ...entry, timestamp: new Date().toISOString() });
  if (logs.length > 500) logs = logs.slice(0, 500);
}

function getIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'N/A';
}

function isAdminSession(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/zv_admin=([a-f0-9]+)/);
  if (!match) return false;
  const session = sessions[match[1]];
  if (!session) return false;
  if (new Date() > new Date(session.expiresAt)) { delete sessions[match[1]]; return false; }
  return true;
}

function parseBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

function sendJson(res, data, status = 200) {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(status);
  res.end(JSON.stringify(data));
}

function sendHtml(res, html) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.writeHead(200);
  res.end(html);
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─────────────────────────────────────────────
// HTML
// ─────────────────────────────────────────────
function renderLogin(error = '') {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZapVoice Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--green:#00ff87;--dark:#0a0a0f;--card:#111118;--border:#1e1e2e;--text:#e2e2f0;--muted:#6b6b8a}
body{background:var(--dark);color:var(--text);font-family:'Space Mono',monospace;min-height:100vh;display:flex;align-items:center;justify-content:center;background-image:radial-gradient(ellipse at 50% 0%,#00ff8715 0%,transparent 70%)}
.box{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:48px;width:100%;max-width:400px;box-shadow:0 0 60px #00ff8710}
.logo{font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:var(--green);text-align:center;letter-spacing:-1px}
.logo span{color:var(--muted);font-weight:400;font-size:13px;display:block;margin-top:4px}
form{margin-top:32px;display:flex;flex-direction:column;gap:16px}
label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px}
input{width:100%;padding:12px 16px;background:var(--dark);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'Space Mono',monospace;font-size:14px;margin-top:6px;outline:none;transition:border-color .2s}
input:focus{border-color:var(--green)}
button{padding:14px;background:var(--green);color:#000;border:none;border-radius:8px;font-family:'Syne',sans-serif;font-weight:700;font-size:15px;cursor:pointer;margin-top:8px;transition:opacity .2s}
button:hover{opacity:.85}
.err{background:#ff003315;border:1px solid #ff003340;color:#ff6b6b;padding:12px 16px;border-radius:8px;font-size:13px;text-align:center;margin-top:16px}
</style>
</head>
<body>
<div class="box">
  <div class="logo">⚡ ZapVoice<span>Painel Admin — LR1290</span></div>
  ${error ? `<div class="err">${error}</div>` : ''}
  <form method="POST" action="/admin/login">
    <div><label>Usuário</label><input type="text" name="user" required autofocus></div>
    <div><label>Senha</label><input type="password" name="pass" required></div>
    <button type="submit">Entrar</button>
  </form>
</div>
</body></html>`;
}

function buildKeysHtml() {
  const rows = Object.entries(keys).map(([code, k]) => `
<tr>
  <td><span class="kc">${code}</span></td>
  <td>${escHtml(k.label)}</td>
  <td><span class="badge ${k.active?'on':'off'}">${k.active?'ATIVO':'BLOQUEADO'}</span></td>
  <td>${k.uses||0}</td>
  <td>${escHtml(k.lastPhone||'-')}</td>
  <td>${escHtml(k.lastIp||'-')}</td>
  <td>${k.lastUsed?new Date(k.lastUsed).toLocaleString('pt-BR'):'-'}</td>
  <td>${new Date(k.createdAt).toLocaleString('pt-BR')}</td>
  <td>
    <button class="bs ${k.active?'bd':'bg'}" onclick="toggleKey('${code}')">${k.active?'Bloquear':'Liberar'}</button>
    <button class="bs bd" onclick="deleteKey('${code}')">Excluir</button>
  </td>
</tr>`).join('');
  return rows || `<tr><td colspan="9" class="empty">Nenhuma chave cadastrada</td></tr>`;
}

function buildLogsHtml() {
  const rows = logs.slice(0,150).map(l => `
<tr>
  <td>${new Date(l.timestamp).toLocaleString('pt-BR')}</td>
  <td><span class="kc" style="font-size:11px">${escHtml(l.keyCode||'-')}</span></td>
  <td>${escHtml(l.label||'-')}</td>
  <td>${escHtml(l.phone||'-')}</td>
  <td>${escHtml(l.ip||'-')}</td>
  <td>${escHtml(l.wppVersion||'-')}</td>
  <td><span class="badge ${l.action==='login_ok'?'on':l.action==='login_blocked'?'off':'warn'}">${l.action}</span></td>
</tr>`).join('');
  return rows || `<tr><td colspan="7" class="empty">Nenhum log ainda</td></tr>`;
}

function renderDashboard() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZapVoice Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--green:#00ff87;--dark:#0a0a0f;--card:#111118;--border:#1e1e2e;--text:#e2e2f0;--muted:#6b6b8a;--red:#ff4757;--yellow:#ffd32a}
body{background:var(--dark);color:var(--text);font-family:'Space Mono',monospace;min-height:100vh}
header{display:flex;align-items:center;justify-content:space-between;padding:18px 32px;border-bottom:1px solid var(--border);background:var(--card);position:sticky;top:0;z-index:100}
.logo{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:var(--green)}
a.out{color:var(--muted);font-size:12px;text-decoration:none}
a.out:hover{color:var(--red)}
main{padding:28px 32px;max-width:1500px;margin:0 auto}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:28px}
.sc{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px}
.sc .n{font-family:'Syne',sans-serif;font-size:38px;font-weight:800;color:var(--green)}
.sc .l{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-top:4px}
.sec{background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:22px;overflow:hidden}
.sh{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--border)}
.st{font-family:'Syne',sans-serif;font-weight:700;font-size:15px}
.gf{display:flex;gap:10px;align-items:center}
.gf input{padding:9px 13px;background:var(--dark);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'Space Mono',monospace;font-size:13px;outline:none;width:210px}
.gf input:focus{border-color:var(--green)}
.btn{padding:10px 18px;border:none;border-radius:8px;cursor:pointer;font-family:'Syne',sans-serif;font-weight:700;font-size:13px;transition:opacity .2s}
.btn:hover{opacity:.8}
.bp{background:var(--green);color:#000}
.bw{background:#ffd32a20;color:var(--yellow);border:1px solid var(--yellow)}
.bs{padding:5px 11px;border:none;border-radius:6px;cursor:pointer;font-family:'Space Mono',monospace;font-size:11px;transition:opacity .2s;margin-right:3px}
.bs:hover{opacity:.8}
.bg{background:#00ff8720;color:var(--green);border:1px solid var(--green)}
.bd{background:#ff475720;color:var(--red);border:1px solid var(--red)}
.ov{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{padding:11px 15px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);border-bottom:1px solid var(--border);font-weight:400}
td{padding:13px 15px;font-size:12px;border-bottom:1px solid var(--border);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover{background:#ffffff04}
.kc{font-family:'Space Mono',monospace;color:var(--green);font-size:12px;letter-spacing:1px}
.badge{padding:3px 8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:1px}
.on{background:#00ff8720;color:var(--green)}
.off{background:#ff475720;color:var(--red)}
.warn{background:#ffd32a20;color:var(--yellow)}
.empty{text-align:center;color:var(--muted);padding:32px!important}
.toast{position:fixed;bottom:28px;right:28px;padding:13px 22px;border-radius:10px;font-family:'Syne',sans-serif;font-weight:700;font-size:14px;display:none;z-index:999}
@media(max-width:768px){.stats{grid-template-columns:1fr};main{padding:16px}}
</style>
</head>
<body>
<header>
  <div class="logo">⚡ ZapVoice Admin</div>
  <a href="/admin/logout" class="out">[ sair ]</a>
</header>
<main>
  <div class="stats">
    <div class="sc"><div class="n" id="s-total">${Object.keys(keys).length}</div><div class="l">Total de Chaves</div></div>
    <div class="sc"><div class="n" id="s-active">${Object.values(keys).filter(k=>k.active).length}</div><div class="l">Chaves Ativas</div></div>
    <div class="sc"><div class="n" id="s-logs">${logs.length}</div><div class="l">Acessos Registrados</div></div>
  </div>

  <div class="sec">
    <div class="sh">
      <div class="st">Chaves de Acesso</div>
      <div class="gf">
        <input type="text" id="nlabel" placeholder="Nome do cliente">
        <button class="btn bp" onclick="generateKey()">+ Gerar Chave</button>
      </div>
    </div>
    <div class="ov">
      <table>
        <thead><tr><th>Chave</th><th>Cliente</th><th>Status</th><th>Usos</th><th>Telefone</th><th>Último IP</th><th>Último Acesso</th><th>Criada em</th><th>Ações</th></tr></thead>
        <tbody id="kb">${buildKeysHtml()}</tbody>
      </table>
    </div>
  </div>

  <div class="sec">
    <div class="sh">
      <div class="st">Log de Acessos</div>
      <button class="btn bw" onclick="refreshLogs()">↻ Atualizar</button>
    </div>
    <div class="ov">
      <table>
        <thead><tr><th>Horário</th><th>Chave</th><th>Cliente</th><th>Telefone</th><th>IP</th><th>WPP Version</th><th>Ação</th></tr></thead>
        <tbody id="lb">${buildLogsHtml()}</tbody>
      </table>
    </div>
  </div>
</main>

<div class="toast" id="toast"></div>

<script>
function toast(msg,ok=true){
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.style.background=ok?'var(--green)':'var(--red)';
  t.style.color=ok?'#000':'#fff';
  t.style.display='block';
  setTimeout(()=>t.style.display='none',3000);
}
async function generateKey(){
  const label=document.getElementById('nlabel').value.trim();
  if(!label){toast('Informe o nome do cliente',false);return}
  const r=await fetch('/admin/api/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label})});
  const d=await r.json();
  if(d.ok){toast('Gerada: '+d.key);document.getElementById('nlabel').value='';refresh();}
  else toast('Erro',false);
}
async function toggleKey(code){
  const r=await fetch('/admin/api/keys/'+code+'/toggle',{method:'POST'});
  const d=await r.json();
  if(d.ok){toast(d.active?'Chave liberada!':'Chave bloqueada!');refresh();}
}
async function deleteKey(code){
  if(!confirm('Excluir chave '+code+'?'))return;
  const r=await fetch('/admin/api/keys/'+code,{method:'DELETE'});
  const d=await r.json();
  if(d.ok){toast('Chave excluída');refresh();}
}
async function refresh(){
  const r=await fetch('/admin/api/data');
  const d=await r.json();
  document.getElementById('s-total').textContent=d.totalKeys;
  document.getElementById('s-active').textContent=d.activeKeys;
  document.getElementById('s-logs').textContent=d.totalLogs;
  document.getElementById('kb').innerHTML=d.keysHtml;
  document.getElementById('lb').innerHTML=d.logsHtml;
}
async function refreshLogs(){await refresh();toast('Logs atualizados');}
setInterval(refresh,30000);
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
  const path = url.pathname;
  const ip = getIp(req);
  console.log(`[${new Date().toISOString()}] ${req.method} ${path} — ${ip}`);

  // LOGIN ADMIN
  if (path === '/admin/login' && req.method === 'POST') {
    let body = '';
    await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });
    const p = new URLSearchParams(body);
    if (p.get('user') === ADMIN_USER && p.get('pass') === ADMIN_PASS) {
      const token = generateToken();
      sessions[token] = { expiresAt: new Date(Date.now() + 8*60*60*1000).toISOString() };
      res.setHeader('Set-Cookie', `zv_admin=${token}; Path=/; HttpOnly; SameSite=Strict`);
      res.writeHead(302, { Location: '/admin' }); res.end();
    } else {
      sendHtml(res, renderLogin('Usuário ou senha incorretos'));
    }
    return;
  }

  // LOGOUT ADMIN
  if (path === '/admin/logout') {
    res.setHeader('Set-Cookie', 'zv_admin=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    res.writeHead(302, { Location: '/admin' }); res.end(); return;
  }

  // PAINEL ADMIN
  if (path === '/admin' || path === '/admin/') {
    if (!isAdminSession(req)) { sendHtml(res, renderLogin()); return; }
    sendHtml(res, renderDashboard()); return;
  }

  // API DATA
  if (path === '/admin/api/data') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    sendJson(res, {
      totalKeys: Object.keys(keys).length,
      activeKeys: Object.values(keys).filter(k=>k.active).length,
      totalLogs: logs.length,
      keysHtml: buildKeysHtml(),
      logsHtml: buildLogsHtml()
    }); return;
  }

  // API GERAR CHAVE
  if (path === '/admin/api/keys' && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const body = await parseBody(req);
    const code = generateKey();
    keys[code] = { label: body.label || 'Cliente', active: true, createdAt: new Date().toISOString(), uses: 0, lastUsed: null, lastIp: null, lastPhone: null };
    sendJson(res, { ok: true, key: code }); return;
  }

  // API TOGGLE CHAVE
  if (path.match(/^\/admin\/api\/keys\/[^/]+\/toggle$/) && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const code = path.split('/')[4];
    if (!keys[code]) { sendJson(res, { error: 'not found' }, 404); return; }
    keys[code].active = !keys[code].active;
    sendJson(res, { ok: true, active: keys[code].active }); return;
  }

  // API DELETAR CHAVE
  if (path.match(/^\/admin\/api\/keys\/[^/]+$/) && req.method === 'DELETE') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const code = path.split('/')[4];
    delete keys[code];
    sendJson(res, { ok: true }); return;
  }

  // EXTENSÃO: LOGIN EXTERNO
  if (path.startsWith('/extension/auth') && req.method === 'GET') {
    const callback = url.searchParams.get('callback');
    addLog({ keyCode: 'external', label: 'Login Externo', phone: '-', ip, wppVersion: '-', action: 'external_login' });
    if (callback) {
      const cb = new URL(callback);
      cb.searchParams.set('key', 'lr1290-free');
      cb.searchParams.set('keyId', 'free-id');
      cb.searchParams.set('ownerId', 'lr1290-owner');
      cb.searchParams.set('managerId', 'lr1290-manager');
      cb.searchParams.set('isPremium', 'true');
      cb.searchParams.set('isLoggedIn', 'true');
      cb.searchParams.set('planName', 'Pro');
      cb.searchParams.set('marketplace', 'premium');
      cb.searchParams.set('username', 'LR1290 Premium');
      cb.searchParams.set('email', 'lr1290@dfg.com.br');
      cb.searchParams.set('plan_id', 'ZV_PRO');
      cb.searchParams.set('permissions', FULL_PERMISSIONS.join(','));
      res.writeHead(302, { Location: cb.toString() }); res.end();
    } else {
      sendJson(res, { ok: true });
    }
    return;
  }

  // EXTENSÃO: VALIDAR CHAVE
  if (path === '/extension/v3/key' && req.method === 'POST') {
    const body = await parseBody(req);
    const keyCode = body.authKey;
    const phone = body.phoneNumber || '-';
    const wppVersion = body.wppVersion || '-';

    if (!keyCode || !keys[keyCode]) {
      addLog({ keyCode: keyCode||'?', label: '-', phone, ip, wppVersion, action: 'key_not_found' });
      sendJson(res, { authError: 'keyNotFound', authErrorMessage: 'Chave não encontrada. Contate o vendedor.' }); return;
    }

    if (!keys[keyCode].active) {
      addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: 'login_blocked' });
      sendJson(res, { authError: 'keyBlocked', authErrorMessage: 'Chave bloqueada. Contate o vendedor.' }); return;
    }

    keys[keyCode].uses = (keys[keyCode].uses || 0) + 1;
    keys[keyCode].lastUsed = new Date().toISOString();
    keys[keyCode].lastIp = ip;
    keys[keyCode].lastPhone = phone;
    addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: 'login_ok' });
    sendJson(res, getAuthData(keyCode)); return;
  }

  // EXTENSÃO: USAGE ENDPOINTS
  if (['/extension/v3/usage', '/extension/v3/get-usage', '/extension/v3/sync-usage'].includes(path)) {
    sendJson(res, { ok: true, status: true, limits: USAGE_LIMITS,
      expires_at: new Date(Date.now() + 365*24*60*60*1000).toISOString(), isExpired: false }); return;
  }

  sendJson(res, { ok: true });
}

http.createServer(handleRequest).listen(PORT, () => {
  console.log(`✅ ZapVoice Admin Server — porta ${PORT}`);
  console.log(`🔑 Painel: /admin  |  User: ${ADMIN_USER}`);
});
