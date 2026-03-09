const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'lr1290';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

// ─────────────────────────────────────────────
// PERSISTÊNCIA EM ARQUIVO
// ─────────────────────────────────────────────
const DB_FILE = process.env.DB_PATH || '/tmp/zapvoice_db.json';

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Erro ao carregar DB:', e.message);
  }
  return { keys: {}, logs: [] };
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify({ keys, logs }, null, 2), 'utf8');
  } catch (e) {
    console.error('Erro ao salvar DB:', e.message);
  }
}

// Carrega dados persistidos
const db = loadDb();
let keys     = db.keys || {};
let logs     = db.logs || [];
let sessions = {};

// ─────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────
const FULL_PERMISSIONS = [
  "create_flow","massive_dispatching","schedule_item",
  "send_flow","send_funnel","send_trigger"
];

const USAGE_LIMITS = {
  audio:        { sent: 0, max: -1 },
  bulkMessages: { sent: 0, max: -1 },
  document:     { sent: 0, max: -1 },
  flow:         { sent: 0, max: -1 },
  funnel:       { sent: 0, max: -1 },
  media:        { sent: 0, max: -1 },
  message:      { sent: 0, max: -1 },
  scheduleItem: { sent: 0, max: -1 }
};

// Limite máximo de ativações por chave (0 = ilimitado)
const MAX_USES = 3;

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function generateKey() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const seg = () => Array.from({length:5}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  return `zv-${seg()}-${seg()}-${seg()}`;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getAuthData(keyCode) {
  return {
    numberWarning: false,
    segments: [],
    data: {
      key:         keyCode,
      keyId:       `id-${keyCode}`,
      ownerId:     'lr1290-owner',
      managerId:   'lr1290-manager',
      permissions: FULL_PERMISSIONS,
      username:    keys[keyCode]?.label || 'Cliente ZapVoice',
      paymentUrl:  null,
      marketplace: 'premium',
      email:       'cliente@zapvoice.com.br',
      planName:    'Pro',
      plan_id:     'ZV_PRO',
      isLoggedIn:  true,
      isPremium:   true,
      isBasicPlan: false
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
  res.writeHead(status);
  res.end(JSON.stringify(data));
}

function sendHtml(res, html, status = 200) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.writeHead(status);
  res.end(html);
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─────────────────────────────────────────────
// PÁGINA DE LOGIN DA EXTENSÃO
// ─────────────────────────────────────────────
function renderExtensionLogin({ callback, error = '', keyVal = '' }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZapVoice — Ativar</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800;900&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--green:#00ff87;--dark:#07070f;--card:#0f0f1a;--border:#1a1a2e;--text:#e8e8f8;--muted:#5a5a7a;--red:#ff4560}
html,body{height:100%}
body{background:var(--dark);color:var(--text);font-family:'Space Mono',monospace;min-height:100vh;display:flex;align-items:center;justify-content:center;background-image:radial-gradient(ellipse 80% 50% at 50% -10%,#00ff8718 0%,transparent 60%),radial-gradient(ellipse 40% 40% at 80% 80%,#7c3aed0d 0%,transparent 60%)}
.wrap{width:100%;max-width:440px;padding:24px}
.card{background:var(--card);border:1px solid var(--border);border-radius:20px;padding:48px 40px 40px;box-shadow:0 0 80px #00ff8708,0 40px 80px #00000060;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--green),transparent)}
.logo-wrap{text-align:center;margin-bottom:36px}
.logo{font-family:'Syne',sans-serif;font-size:32px;font-weight:900;color:var(--green);letter-spacing:-1.5px;line-height:1}
.logo-sub{color:var(--muted);font-size:12px;margin-top:8px;letter-spacing:2px;text-transform:uppercase}
.field{margin-bottom:20px}
label{display:block;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:8px}
input{width:100%;padding:14px 18px;background:#0a0a16;border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:'Space Mono',monospace;font-size:15px;outline:none;transition:border-color .2s,box-shadow .2s;letter-spacing:1px}
input:focus{border-color:var(--green);box-shadow:0 0 0 3px #00ff8715}
input::placeholder{color:var(--muted)}
.hint{font-size:11px;color:var(--muted);margin-top:8px;line-height:1.5}
.btn{width:100%;padding:16px;background:var(--green);color:#000;border:none;border-radius:10px;font-family:'Syne',sans-serif;font-weight:800;font-size:16px;letter-spacing:.5px;cursor:pointer;margin-top:8px;transition:opacity .15s,transform .15s}
.btn:hover{opacity:.88;transform:translateY(-1px)}
.btn:active{transform:translateY(0)}
.error{background:#ff456015;border:1px solid #ff456035;color:#ff7088;padding:12px 16px;border-radius:10px;font-size:13px;text-align:center;margin-bottom:20px;line-height:1.5}
.divider{display:flex;align-items:center;gap:12px;margin:24px 0 0;color:var(--muted);font-size:11px}
.divider::before,.divider::after{content:'';flex:1;height:1px;background:var(--border)}
.footer{text-align:center;margin-top:16px;font-size:11px;color:var(--muted);line-height:1.6}
.footer a{color:var(--green);text-decoration:none}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="logo-wrap">
      <div class="logo">⚡ ZapVoice</div>
      <div class="logo-sub">Ativação da Extensão</div>
    </div>
    ${error ? `<div class="error">${error}</div>` : ''}
    <form method="POST" action="/extension/auth/verify">
      <input type="hidden" name="callback" value="${escHtml(callback)}">
      <div class="field">
        <label>Sua Chave de Ativação</label>
        <input type="text" name="key" id="keyInput" value="${escHtml(keyVal)}"
          placeholder="ZV-XXXXX-XXXXX-XXXXX"
          autocomplete="off" autofocus required maxlength="20">
        <div class="hint">Você recebeu esta chave junto com a sua compra.</div>
      </div>
      <button type="submit" class="btn">Ativar Agora</button>
    </form>
    <div class="divider">precisa de ajuda?</div>
    <div class="footer">
      Entre em contato com o vendedor<br>
      <a href="https://www.dfg.com.br/pt/outros/zapvoice-pro-versao-3-16-15-brinde-entrega-automatica-971973941" target="_blank">dfg.com.br/user/lr1290</a>
    </div>
  </div>
</div>
<script>
document.getElementById('keyInput').addEventListener('input', function(e) {
  let raw = e.target.value.replace(/[^A-Za-z0-9]/g,'').toUpperCase();
  let out = '';
  if (raw.length > 0)  out = raw.slice(0,2);
  if (raw.length > 2)  out += '-' + raw.slice(2,7);
  if (raw.length > 7)  out += '-' + raw.slice(7,12);
  if (raw.length > 12) out += '-' + raw.slice(12,17);
  e.target.value = out;
});
</script>
</body></html>`;
}

// ─────────────────────────────────────────────
// PAINEL ADMIN
// ─────────────────────────────────────────────
function renderAdminLogin(error = '') {
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
.box{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:48px;width:100%;max-width:400px}
.logo{font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:var(--green);text-align:center;letter-spacing:-1px}
.logo span{color:var(--muted);font-weight:400;font-size:13px;display:block;margin-top:4px}
form{margin-top:32px;display:flex;flex-direction:column;gap:16px}
label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px}
input{width:100%;padding:12px 16px;background:var(--dark);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'Space Mono',monospace;font-size:14px;margin-top:6px;outline:none;transition:border-color .2s}
input:focus{border-color:var(--green)}
button{padding:14px;background:var(--green);color:#000;border:none;border-radius:8px;font-family:'Syne',sans-serif;font-weight:700;font-size:15px;cursor:pointer;margin-top:8px}
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
  const entries = Object.entries(keys);
  if (!entries.length) return `<tr><td colspan="9" class="empty">Nenhuma chave cadastrada</td></tr>`;
  return entries.map(([code, k]) => `
<tr>
  <td><span class="kc">${escHtml(code)}</span></td>
  <td>${escHtml(k.label)}</td>
  <td><span class="badge ${k.active?'on':'off'}">${k.active?'ATIVO':'BLOQUEADO'}</span></td>
  <td><span style="color:${(k.uses||0)>=MAX_USES&&!k.active?'var(--red)':'inherit'}">${k.uses||0}/${MAX_USES}</span></td>
  <td>${escHtml(k.lastPhone||'-')}</td>
  <td>${escHtml(k.lastIp||'-')}</td>
  <td>${k.lastUsed?new Date(k.lastUsed).toLocaleString('pt-BR'):'-'}</td>
  <td>${new Date(k.createdAt).toLocaleString('pt-BR')}${k.expiresAt?`<br><span style="font-size:10px;color:${new Date()>new Date(k.expiresAt)?'var(--red)':'var(--yellow)'}">exp: ${new Date(k.expiresAt).toLocaleDateString('pt-BR')}</span>`:''}</td>
  <td>
    <button class="bs ${k.active?'bd':'bg'}" onclick="toggleKey('${escHtml(code)}')">${k.active?'Bloquear':'Liberar'}</button>
    <button class="bs bd" onclick="deleteKey('${escHtml(code)}')">Excluir</button>
  </td>
</tr>`).join('');
}

function buildLogsHtml(arr) {
  const src = arr ?? logs;
  if (!src.length) return `<tr><td colspan="7" class="empty">Nenhum log ainda</td></tr>`;
  return src.slice(0,150).map(l => `
<tr>
  <td>${new Date(l.timestamp).toLocaleString('pt-BR')}</td>
  <td><span class="kc" style="font-size:11px">${escHtml(l.keyCode||'-')}</span></td>
  <td>${escHtml(l.label||'-')}</td>
  <td>${escHtml(l.phone||'-')}</td>
  <td>${escHtml(l.ip||'-')}</td>
  <td>${escHtml(l.wppVersion||'-')}</td>
  <td><span class="badge ${l.action==='login_ok'?'on':l.action==='relogin_ok'?'re':l.action==='verify_ok'?'vr':l.action==='login_blocked'||l.action==='auto_blocked'?'off':'warn'}">${escHtml(l.action)}</span></td>
</tr>`).join('');
}

function renderAdminDashboard() {
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
.sh{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:12px}
.st{font-family:'Syne',sans-serif;font-weight:700;font-size:15px}
.gf{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.gf input{padding:9px 13px;background:var(--dark);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'Space Mono',monospace;font-size:13px;outline:none;width:210px}
.gf input:focus{border-color:var(--green)}
.btn{padding:10px 18px;border:none;border-radius:8px;cursor:pointer;font-family:'Syne',sans-serif;font-weight:700;font-size:13px;transition:opacity .2s}
.btn:hover{opacity:.8}
.bp{background:var(--green);color:#000}
.bw{background:#ffd32a20;color:var(--yellow);border:1px solid var(--yellow)}
.bs{padding:5px 11px;border:none;border-radius:6px;cursor:pointer;font-family:'Space Mono',monospace;font-size:11px;margin-right:3px}
.bs:hover{opacity:.8}
.bg{background:#00ff8720;color:var(--green);border:1px solid var(--green)}
.bd{background:#ff475720;color:var(--red);border:1px solid var(--red)}
.ov{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{padding:11px 15px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);border-bottom:1px solid var(--border);font-weight:400}
td{padding:13px 15px;font-size:12px;border-bottom:1px solid var(--border);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover{background:#ffffff04}
.kc{color:var(--green);font-size:12px;letter-spacing:1px}
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
        <input type="text" id="nlabel" placeholder="Nome do cliente" style="width:170px">
        <input type="number" id="ndays" placeholder="Dias (ex: 30)" min="1" style="width:130px" title="Validade em dias (vazio = sem expiração)">
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
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="date" id="logDate" style="padding:8px 12px;background:var(--dark);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'Space Mono',monospace;font-size:12px;outline:none" onchange="filterLog()">
        <button class="btn bw" onclick="clearDateFilter()" title="Limpar filtro">✕ Filtro</button>
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
  const days=document.getElementById('ndays').value.trim();
  if(!label){toast('Informe o nome do cliente',false);return;}
  try{
    const body={label};
    if(days&&parseInt(days)>0)body.expireDays=parseInt(days);
    const r=await fetch('/admin/api/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(r.status===401){toast('Sessão expirada, faça login novamente',false);setTimeout(()=>location.href='/admin',1500);return;}
    const d=await r.json();
    if(d.ok){
      const expMsg=days?' (expira em '+days+'d)':'';
      toast('Gerada: '+d.key+expMsg);
      document.getElementById('nlabel').value='';
      document.getElementById('ndays').value='';
      await doRefresh();
    } else toast('Erro ao gerar chave: '+(d.error||'desconhecido'),false);
  }catch(e){toast('Erro de rede: '+e.message,false);}
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
function clearDateFilter(){
  document.getElementById('logDate').value='';
  doRefresh();
}
async function clearLog(){
  const date=document.getElementById('logDate').value;
  const msg=date?'Limpar logs do dia '+date+'?':'Limpar TODO o log de acessos?';
  if(!confirm(msg))return;
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
async function doRefresh(){
  try{
    const r=await fetch('/admin/api/data');
    const d=await r.json();
    if(d.error){return;}
    document.getElementById('s-total').textContent=d.totalKeys||0;
    document.getElementById('s-active').textContent=d.activeKeys||0;
    document.getElementById('s-logs').textContent=d.totalLogs||0;
    document.getElementById('kb').innerHTML=d.keysHtml||'';
    document.getElementById('lb').innerHTML=d.logsHtml||'';
  }catch(e){console.error('Refresh error',e);}
}
setInterval(doRefresh,30000);
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

  const url  = new URL(req.url, `http://localhost:${PORT}`);
  const p    = url.pathname;
  const ip   = getIp(req);
  console.log(`[${new Date().toISOString()}] ${req.method} ${p} — ${ip}`);

  // ── EXTENSÃO: mostra página de login com campo de chave ──
  if (p === '/extension/auth/' || p === '/extension/auth' && req.method === 'GET') {
    const callback = url.searchParams.get('callback') || '';
    sendHtml(res, renderExtensionLogin({ callback }));
    return;
  }

  // ── EXTENSÃO: verifica chave e faz callback ──
  if (p === '/extension/auth/verify' && req.method === 'POST') {
    const form    = await parseFormBody(req);
    const keyCode = (form.get('key') || '').trim().toLowerCase();
    const callback = form.get('callback') || '';

    if (!keyCode || !keys[keyCode]) {
      addLog({ keyCode: keyCode||'?', label: '-', phone: '-', ip, wppVersion: '-', action: 'key_not_found' });
      sendHtml(res, renderExtensionLogin({ callback, keyVal: keyCode, error: '❌ Chave não encontrada. Verifique se digitou corretamente ou entre em contato com o vendedor.' }));
      return;
    }
    if (!keys[keyCode].active) {
      addLog({ keyCode, label: keys[keyCode].label, phone: '-', ip, wppVersion: '-', action: 'login_blocked' });
      sendHtml(res, renderExtensionLogin({ callback, keyVal: keyCode, error: '🚫 Chave bloqueada. Entre em contato com o vendedor.' }));
      return;
    }
    if (isKeyExpired(keys[keyCode])) {
      keys[keyCode].active = false;
      addLog({ keyCode, label: keys[keyCode].label, phone: '-', ip, wppVersion: '-', action: 'expired' });
      saveDb();
      sendHtml(res, renderExtensionLogin({ callback, keyVal: keyCode, error: '⏰ Chave expirada. Entre em contato com o vendedor.' }));
      return;
    }

    // auth/verify NUNCA incrementa o contador — quem controla usos é somente /v3/key
    // (verify apenas valida a chave e faz o redirect; /v3/key é quem autentica com phone)
    // Mas ainda verifica se já está bloqueada por limite (para não deixar passar)
    if (!keys[keyCode].active || (MAX_USES > 0 && (keys[keyCode].uses || 0) >= MAX_USES)) {
      keys[keyCode].active = false;
      addLog({ keyCode, label: keys[keyCode].label, phone: '-', ip, wppVersion: '-', action: 'auto_blocked' });
      saveDb();
      sendHtml(res, renderExtensionLogin({ callback, keyVal: keyCode, error: '🚫 Limite de ativações atingido. Entre em contato com o vendedor.' }));
      return;
    }

    keys[keyCode].lastUsed = new Date().toISOString();
    keys[keyCode].lastIp   = ip;
    addLog({ keyCode, label: keys[keyCode].label, phone: '-', ip, wppVersion: '-', action: 'verify_ok' });
    saveDb();

    try {
      const cb = new URL(callback);
      cb.searchParams.set('key',         keyCode);
      cb.searchParams.set('keyId',       `id-${keyCode}`);
      cb.searchParams.set('ownerId',     'lr1290-owner');
      cb.searchParams.set('managerId',   'lr1290-manager');
      cb.searchParams.set('isPremium',   'true');
      cb.searchParams.set('isLoggedIn',  'true');
      cb.searchParams.set('planName',    'Pro');
      cb.searchParams.set('marketplace', 'premium');
      cb.searchParams.set('username',    keys[keyCode].label);
      cb.searchParams.set('email',       'cliente@zapvoice.com.br');
      cb.searchParams.set('plan_id',     'ZV_PRO');
      cb.searchParams.set('permissions', FULL_PERMISSIONS.join(','));
      const finalUrl = cb.toString();
      res.writeHead(302, { Location: finalUrl });
      res.end();
    } catch (e) {
      sendHtml(res, renderExtensionLogin({ callback, keyVal: keyCode, error: 'Callback invalido. Tente novamente.' }));
    }
    return;
  }

  // ── EXTENSÃO: validação via campo "Chave de acesso" ──
  if (p === '/extension/v3/key' && req.method === 'POST') {
    const body       = await parseBody(req);
    const keyCode    = (body.authKey || '').toLowerCase();
    const phone      = body.phoneNumber || '-';
    const wppVersion = body.wppVersion  || '-';

    if (!keyCode || !keys[keyCode]) {
      addLog({ keyCode: keyCode||'?', label: '-', phone, ip, wppVersion, action: 'key_not_found' });
      sendJson(res, { authError: 'keyNotFound', authErrorMessage: 'Chave não encontrada. Contate o vendedor.' });
      return;
    }
    if (!keys[keyCode].active) {
      addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: 'login_blocked' });
      sendJson(res, { authError: 'keyBlocked', authErrorMessage: 'Chave bloqueada. Contate o vendedor.' });
      return;
    }
    if (isKeyExpired(keys[keyCode])) {
      keys[keyCode].active = false;
      addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: 'expired' });
      saveDb();
      sendJson(res, { authError: 'expiredKey', authErrorMessage: 'Chave expirada. Contate o vendedor.' });
      return;
    }

    // Relogin do mesmo telefone = não consome uso (rehydrate automático da extensão)
    const samePhone = phone && phone !== '-' && keys[keyCode].lastPhone === phone;
    if (!samePhone) {
      // Checar limite ANTES de incrementar — rejeita se já esgotou
      if (MAX_USES > 0 && (keys[keyCode].uses || 0) >= MAX_USES) {
        keys[keyCode].active = false;
        addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: 'auto_blocked' });
        saveDb();
        sendJson(res, { authError: 'keyBlocked', authErrorMessage: 'Limite de ativações atingido. Contate o vendedor.' });
        return;
      }
      keys[keyCode].uses      = (keys[keyCode].uses || 0) + 1;
    }

    keys[keyCode].lastUsed  = new Date().toISOString();
    keys[keyCode].lastIp    = ip;
    keys[keyCode].lastPhone = phone;
    addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: samePhone ? 'relogin_ok' : 'login_ok' });
    saveDb();
    sendJson(res, getAuthData(keyCode));
    return;
  }

  // ── EXTENSÃO: usage endpoints ──
  if (['/extension/v3/usage','/extension/v3/get-usage','/extension/v3/sync-usage'].includes(p)) {
    sendJson(res, {
      ok: true, status: true, limits: USAGE_LIMITS,
      expires_at: new Date(Date.now() + 365*24*60*60*1000).toISOString(),
      isExpired: false
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
    } else {
      sendHtml(res, renderAdminLogin('Usuário ou senha incorretos'));
    }
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
      totalKeys:  Object.keys(keys).length,
      activeKeys: Object.values(keys).filter(k=>k.active).length,
      totalLogs:  logs.length,
      keysHtml:   buildKeysHtml(),
      logsHtml:   buildLogsHtml()
    }); return;
  }

  // ── ADMIN API: gerar chave ──
  if (p === '/admin/api/keys' && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const body = await parseBody(req);
    const code = generateKey();
    // expiresAt: aceita 'YYYY-MM-DD' ou número de dias; null = sem expiração
    let expiresAt = null;
    if (body.expiresAt) {
      expiresAt = new Date(body.expiresAt).toISOString();
    } else if (body.expireDays && parseInt(body.expireDays) > 0) {
      const d = new Date();
      d.setDate(d.getDate() + parseInt(body.expireDays));
      expiresAt = d.toISOString();
    }
    keys[code] = { label: body.label || 'Cliente', active: true, createdAt: new Date().toISOString(), uses: 0, lastUsed: null, lastIp: null, lastPhone: null, expiresAt };
    saveDb();
    sendJson(res, { ok: true, key: code }); return;
  }

  // ── ADMIN API: toggle ──
  if (p.match(/^\/admin\/api\/keys\/[^/]+\/toggle$/) && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const code = decodeURIComponent(p.split('/')[4]);
    if (!keys[code]) { sendJson(res, { error: 'not found' }, 404); return; }
    keys[code].active = !keys[code].active;
    saveDb();
    sendJson(res, { ok: true, active: keys[code].active }); return;
  }

  // ── ADMIN API: limpar log ──
  if (p === '/admin/api/logs' && req.method === 'DELETE') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const body = await parseBody(req);
    if (body.date) {
      // Limpar apenas logs do dia especificado
      const d = body.date; // 'YYYY-MM-DD'
      logs = logs.filter(l => !l.timestamp.startsWith(d));
    } else {
      logs = [];
    }
    saveDb();
    sendJson(res, { ok: true, remaining: logs.length }); return;
  }

  // ── ADMIN API: filtrar log por data ──
  if (p === '/admin/api/logs' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const date = url.searchParams.get('date'); // 'YYYY-MM-DD' ou vazio = todos
    const filtered = date ? logs.filter(l => l.timestamp.startsWith(date)) : logs;
    sendJson(res, { ok: true, logsHtml: buildLogsHtml(filtered) }); return;
  }

  // ── ADMIN API: deletar ──
  if (p.match(/^\/admin\/api\/keys\/[^/]+$/) && req.method === 'DELETE') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const code = decodeURIComponent(p.split('/')[4]);
    delete keys[code];
    saveDb();
    sendJson(res, { ok: true }); return;
  }

  sendJson(res, { ok: true });
}

http.createServer(handleRequest).listen(PORT, () => {
  console.log(`✅ ZapVoice Server v4 — porta ${PORT}`);
  console.log(`💾 DB: ${DB_FILE}`);
  console.log(`🔑 Admin: /admin | User: ${ADMIN_USER}`);
  console.log(`📊 Chaves carregadas: ${Object.keys(keys).length}`);
});
