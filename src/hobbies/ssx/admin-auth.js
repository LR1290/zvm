'use strict';

// Independent SSX administrator account: no ZVM portal, license or admin session is reused.
const crypto = require('node:crypto');
const net = require('node:net');
const { resolveClientIp } = require('../../../client-ip-policy');
const BASE = '/hobbies/ssx/ssx2012/admin';
const COOKIE = 'ssx_admin';
const TTL_MS = 8 * 60 * 60 * 1000;
const attempts = new Map();

function config() {
  const email = String(process.env.SSX_SITE_ADMIN_EMAIL || '').trim().toLowerCase();
  const hash = String(process.env.SSX_SITE_ADMIN_PASSWORD_HASH || '').trim();
  const secret = String(process.env.SSX_SITE_ADMIN_SESSION_KEY || '');
  const match = /^scrypt\$([0-9a-f]{32,64})\$([0-9a-f]{128})$/.exec(hash);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !match ||
      Buffer.byteLength(secret) < 32) return null;
  return { email, salt: match[1], hash: Buffer.from(match[2], 'hex'), secret };
}
function same(a,b) {
  const x=Buffer.from(String(a)),y=Buffer.from(String(b));
  return x.length===y.length && crypto.timingSafeEqual(x,y);
}
function checkPassword(password, settings) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 512) return false;
  const result=crypto.scryptSync(password,Buffer.from(settings.salt,'hex'),64,{N:16384,r:8,p:1,maxmem:32*1024*1024});
  return crypto.timingSafeEqual(result,settings.hash);
}
function newSession(settings) {
  const payload=Buffer.from(JSON.stringify({e:settings.email,t:Date.now()+TTL_MS,n:crypto.randomBytes(16).toString('hex')})).toString('base64url');
  const sig=crypto.createHmac('sha256',settings.secret).update(payload).digest('base64url');
  return payload+'.'+sig;
}
function readSession(req) {
  const settings=config();
  if(!settings)return false;
  const cookie=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='));
  if(!cookie)return false;
  const token=cookie.slice(COOKIE.length+1);
  const parts=token.split('.');
  if(parts.length!==2 || parts[0].length>500 || parts[1].length>80)return false;
  const expect=crypto.createHmac('sha256',settings.secret).update(parts[0]).digest('base64url');
  if(!same(parts[1],expect))return false;
  try {
    const obj=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    return obj.e===settings.email && Number.isSafeInteger(obj.t) &&
      obj.t>Date.now() && obj.t<=Date.now()+TTL_MS;
  } catch {return false;}
}
const baseHeaders = {
  'Cache-Control':'no-store, private',
  'X-Content-Type-Options':'nosniff',
  'X-Robots-Tag':'noindex, nofollow, noarchive',
  'Referrer-Policy':'same-origin',
  'X-Frame-Options':'DENY',
  'Cross-Origin-Resource-Policy':'same-origin'
};
const escape = x => String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function send(res,status,body,extra={},method='GET') {
  const buf=Buffer.from(body,'utf8');
  res.writeHead(status,{...baseHeaders,'Content-Type':'text/html; charset=utf-8',
    'Content-Length':buf.length,...extra});
  res.end(method==='HEAD'?undefined:buf);
}
function loginPage(message='') {
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SSX · Administração</title>'+
  '<style>*,*:before,*:after{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07131d;color:#e8f5ff;font:16px system-ui,sans-serif;padding:24px}main{background:#11283a;border:1px solid #34526a;border-radius:18px;width:100%;max-width:420px;padding:28px;box-shadow:0 18px 50px #0005}h1{margin:0 0 6px;font-size:27px}p{color:#bbcedb;line-height:1.5}label{display:block;margin:18px 0 6px}input{width:100%;border:1px solid #69869d;border-radius:9px;background:#07131d;color:white;font:inherit;padding:12px}button{width:100%;margin-top:24px;background:#17bbd4;color:#061924;border:0;border-radius:10px;padding:13px;font:inherit;font-weight:700;cursor:pointer}.error{color:#ffc7be}a{color:#9ee7fa}</style></head><body><main><h1>Administração SSX 2012</h1><p>Área restrita a administradores autorizados.</p>'+
  (message?'<p class="error" role="alert">'+escape(message)+'</p>':'')+
  '<form method="post" action="'+BASE+'/login" autocomplete="on"><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="username" required maxlength="254"><label for="password">Senha</label><input id="password" name="password" type="password" autocomplete="current-password" required minlength="12"><button type="submit">Entrar na administração</button></form><p><a href="/hobbies/ssx/ssx2012">Voltar aos recordes</a></p></main></body></html>';
}

function setupPage() {
  // Credentials are deliberately never generated from a public GET.
  // This page must not suggest that an unconfigured login accepts passwords.
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta name="robots" content="noindex,nofollow">'+
    '<title>SSX 2012 · Administração protegida</title>'+
    '<style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#061521;color:#e8f5ff;'+
    'min-height:100vh;display:grid;place-items:center;padding:24px;font:16px/1.6 system-ui,sans-serif}'+
    'main{max-width:520px;width:100%;padding:32px;background:#102637;border:1px solid #335368;border-radius:20px}'+
    'h1{font-size:clamp(1.4rem,4vw,1.9rem);margin:0 0 12px}p{color:#b5cbd7}'+
    'a{display:inline-block;margin-top:18px;padding:11px 16px;color:#08202b;background:#22c1d8;'+
    'border-radius:10px;text-decoration:none;font-weight:750}a:focus-visible{outline:3px solid white}</style></head>'+
    '<body><main><h1>Administração protegida</h1>'+
    '<p>A página administrativa já está instalada, mas as credenciais do responsável ainda não foram ativadas no servidor.</p>'+
    '<p>Por segurança, nenhum visitante pode criar uma conta administrativa ou entrar sem autorização.</p>'+
    '<a href="/hobbies/ssx/ssx2012">Voltar aos recordes</a></main></body></html>';
}
function originAllowed(req) {
  const origin=String(req.headers.origin||'');
  const host=String(req.headers.host||'').toLowerCase();
  try {const u=new URL(origin);return u.host.toLowerCase()===host && (u.protocol==='https:' || (u.protocol==='http:' && /^localhost(?::|$)|^127\.0\.0\.1(?::|$)/.test(host))); }
  catch{return false;}
}
function adminClientIp(req) {
  const normalize = raw => {
    let value=String(raw||'').trim();
    if(value.startsWith('::ffff:'))value=value.slice(7);
    return net.isIP(value) ? value.toLowerCase() : '';
  };
  const isRender=String(process.env.RENDER||'').toLowerCase()==='true';
  return resolveClientIp({
    headers:req.headers||{},
    remoteAddress:req.socket?.remoteAddress||'',
    trustProxyHeaders:isRender,
    isRender,
    normalize
  });
}
function limit(ip, success=false) {
  const now=Date.now(), key=String(ip||'unknown');
  if(attempts.size>2048)for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
  if(success){attempts.delete(key);return false;}
  const entry=attempts.get(key);
  if(entry && entry.until>now && entry.count>=6)return true;
  attempts.set(key,{count:entry && entry.until>now?entry.count+1:1,until:now+15*60*1000});
  return false;
}
function replyRedirect(res,url,extras={}) {
  res.writeHead(303,{...baseHeaders,'Location':url,...extras});res.end();
}
function cookieHeader(value,expired=false) {
  return COOKIE+'='+value+'; Path='+BASE+'; HttpOnly; Secure; SameSite=Strict'+(expired?'; Max-Age=0':'; Max-Age='+Math.floor(TTL_MS/1000));
}
function handleAuth(req,res,pathname) {
  const method=String(req.method||'').toUpperCase();
  const isLogin=pathname===BASE+'/login',isLogout=pathname===BASE+'/logout';
  const isAdmin=[BASE,BASE+'/archive',BASE+'/editor',BASE+'/bridge-health'].includes(pathname);
  if(!isLogin && !isLogout && !isAdmin)return false;
  const settings=config();
  if(!settings){
    send(res,503,setupPage(),{'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"},method);return true;
  }
  if(isLogin){
    if(method==='GET' || method==='HEAD'){if(readSession(req))replyRedirect(res,BASE);else send(res,200,loginPage(),{'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"},method);return true;}
    if(method!=='POST'){res.writeHead(405,{...baseHeaders,Allow:'GET, HEAD, POST'});res.end();return true;}
    if(!originAllowed(req)){send(res,403,'Origem inválida',{'Content-Type':'text/plain; charset=utf-8'});return true;}
    const ip=adminClientIp(req);
    if(limit(ip,false)){send(res,429,loginPage('Muitas tentativas. Tente novamente mais tarde.'),{'Retry-After':'900'});return true;}
    const size=Number(req.headers['content-length']||0);
    if(size>4096 || !/^application\/x-www-form-urlencoded(?:;|$)/i.test(String(req.headers['content-type']||''))){
      send(res,400,'Requisição inválida',{'Content-Type':'text/plain; charset=utf-8'});return true;
    }
    const chunks=[];let total=0,ended=false;
    req.on('data',data=>{if(ended)return;total+=data.length;if(total>4096){ended=true;req.destroy();return;}chunks.push(data);});
    req.on('end',()=>{if(ended)return;ended=true;
      const fields=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const email=String(fields.get('email')||'').trim().toLowerCase();
      const password=fields.get('password')||'';
      let passwordGood=false;
      try{passwordGood=checkPassword(password,settings);}catch{passwordGood=false;}
      const good=passwordGood && same(email,settings.email);
      if(!good){send(res,401,loginPage('Credenciais inválidas.'),{'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});return;}
      limit(ip,true);replyRedirect(res,BASE,{'Set-Cookie':cookieHeader(newSession(settings))});
    });return true;
  }
  if(isLogout){
    if(method!=='POST'){res.writeHead(405,{...baseHeaders,Allow:'POST'});res.end();return true;}
    if(!originAllowed(req)){send(res,403,'Origem inválida',{'Content-Type':'text/plain; charset=utf-8'});return true;}
    replyRedirect(res,BASE+'/login',{'Set-Cookie':cookieHeader('',true)});return true;
  }
  if(!readSession(req)){replyRedirect(res,BASE+'/login');return true;}
  if(method!=='GET' && method!=='HEAD'){res.writeHead(405,{...baseHeaders,Allow:'GET, HEAD'});res.end();return true;}
  return false; // Authenticated: let SSX route deliver the protected page.
}
module.exports={BASE,config,readSession,handleAuth,adminClientIp};