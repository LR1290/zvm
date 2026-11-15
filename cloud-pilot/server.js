'use strict';
const http=require('node:http');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const ASSETS={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','application/javascript; charset=utf-8'],'/styles.css':['styles.css','text/css; charset=utf-8']};
const COOKIE='__Host-zvm_cloud_pilot';
function validatePass(pass, spec){
 if(typeof pass!=='string'||pass.length>1024)return false;
 const m=/^([a-f0-9]{32}):([a-f0-9]{64})$/i.exec(spec||'');
 if(!m)return false;
 const actual=crypto.scryptSync(pass,Buffer.from(m[1],'hex'),32);
 return crypto.timingSafeEqual(actual,Buffer.from(m[2],'hex'));
}
function equals(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function send(res,status,data,headers={}){res.writeHead(status,Object.assign({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},headers));res.end(JSON.stringify(data));}
function getCookie(req){const s=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));return s?s.slice(COOKIE.length+1):'';}
function originAllowed(req){
 try {const o=new URL(req.headers.origin||'');const h=req.headers.host||'';return o.host===h&&(o.protocol==='https:'||(/^((127\.0\.0\.1)|(localhost))(:[0-9]+)?$/.test(h)&&o.protocol==='http:'));}
 catch{return false;}
}
async function receive(req){
 if(!String(req.headers['content-type']||'').startsWith('application/json'))throw Error('type');
 let data='';
 for await(const part of req){data+=part.toString('utf8');if(data.length>8192)throw Error('size');}
 return JSON.parse(data||'{}');
}
function createServer(config={}){
 const email=String(config.email??process.env.PILOT_EMAIL??'').trim().toLowerCase();
 const passHash=String(config.passHash??process.env.PILOT_PASSWORD_SCRYPT??'');
 const active=email.includes('@')&&/^([a-f0-9]{32}):([a-f0-9]{64})$/i.test(passHash);
 const sessions=new Map(),attempts=new Map();
 let checks=0;
 function authed(req){const token=getCookie(req),entry=sessions.get(token);if(!token||!entry||entry.expires<Date.now()||!active){if(token)sessions.delete(token);return false;}return entry.email===email;}
 return http.createServer(async(req,res)=>{
  const route=new URL(req.url||'/','http://localhost').pathname;
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if(req.method==='GET'&&route==='/healthz')return send(res,200,{status:'ok',service:'zvm-cloud-private-pilot',sending:'disabled'});
  if(req.method==='GET'&&route==='/robots.txt'){res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});return res.end('User-agent: *\nDisallow: /\n');}
  if(req.method==='GET'&&ASSETS[route]){
   const [file,type]=ASSETS[route];return fs.readFile(path.join(__dirname,'public',file),(err,data)=>{if(err)return send(res,500,{error:'unavailable'});res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(data);});
  }
  if(req.method==='GET'&&route==='/api/session')return send(res,200,{configured:active,loggedIn:authed(req),email:authed(req)?email:null,mode:'demo',sending:false});
  if(route.startsWith('/api/')&&req.method==='POST'&&!originAllowed(req))return send(res,403,{error:'origin_denied'});
  if(req.method==='POST'&&route==='/api/login'){
   const ip=String(req.socket.remoteAddress||'local');let a=attempts.get(ip)||{total:0,until:0};
   if(a.until<Date.now())a={total:0,until:Date.now()+900000};
   if(++a.total>8){attempts.set(ip,a);return send(res,429,{error:'rate_limited'});}
   attempts.set(ip,a);let body;
   try{body=await receive(req);}catch{return send(res,400,{error:'bad_request'});}
   if(!active||!equals(String(body.email||'').toLowerCase().trim(),email)||!validatePass(body.password,passHash))return send(res,401,{error:'unauthorized'});
   attempts.delete(ip);
   const token=crypto.randomBytes(32).toString('base64url');sessions.set(token,{email,expires:Date.now()+28800000});
   for(const [key,s] of sessions)if(s.expires<Date.now())sessions.delete(key);
   return send(res,200,{ok:true},{'Set-Cookie':COOKIE+'='+token+'; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'});
  }
  if(req.method==='POST'&&route==='/api/logout'){sessions.delete(getCookie(req));return send(res,200,{ok:true},{'Set-Cookie':COOKIE+'=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
  if(route.startsWith('/api/')&&!authed(req))return send(res,401,{error:'login_required'});
  if(req.method==='GET'&&route==='/api/overview')return send(res,200,{account:email,environment:'private-test',whatsapp:'not_connected',sending:'disabled',scheduledJobs:0,realMessages:0,drafts:'browser_only',uptimeSeconds:Math.floor(process.uptime())});
  if(req.method==='POST'&&route==='/api/ping'){checks++;return send(res,200,{ok:true,at:new Date().toISOString(),number:checks});}
  // No sending, webhooks, imports or scheduling routes in this proof of concept.
  return send(res,404,{error:'not_found'});
 });
}
if(require.main===module)createServer().listen(Number(process.env.PORT||10000),'0.0.0.0',()=>console.log('ZVM Cloud pilot ready; real sending disabled'));
module.exports={createServer,validatePass};
