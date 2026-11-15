'use strict';
// ZVM Cloud private pilot. No WhatsApp sender, webhook or scheduling code exists here.
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {createMongoStore}=require('./store');
const ASSETS={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','application/javascript; charset=utf-8'],'/styles.css':['styles.css','text/css; charset=utf-8']};
const COOKIE='__Host-zvm_cloud_pilot',SESSION_MS=8*60*60*1000;
const PASS_SPEC=/^([a-f0-9]{32}):([a-f0-9]{64})$/i;
function hashToken(value){return crypto.createHash('sha256').update(value).digest('hex');}
function equals(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function validatePass(pass,spec){
 if(typeof pass!=='string'||pass.length>1024)return false;
 const m=PASS_SPEC.exec(String(spec||''));if(!m)return false;
 return crypto.timingSafeEqual(crypto.scryptSync(pass,Buffer.from(m[1],'hex'),32),Buffer.from(m[2],'hex'));
}
function passwordHash(pass){
 if(typeof pass!=='string'||pass.length<12||pass.length>128)throw Error('invalid_password');
 const salt=crypto.randomBytes(16);return salt.toString('hex')+':'+crypto.scryptSync(pass,salt,32).toString('hex');
}
function json(res,status,data,headers={}){res.writeHead(status,Object.assign({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},headers));res.end(JSON.stringify(data));}
function sessionCookie(token,seconds){return COOKIE+'='+token+'; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age='+seconds;}
function getCookie(req){
 const item=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
 return item?item.slice(COOKIE.length+1):'';
}
function originAllowed(req){
 try{const source=new URL(req.headers.origin||'');const host=String(req.headers.host||'');const loop=/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return source.host===host&&(source.protocol==='https:'||(loop&&source.protocol==='http:'));
 }catch{return false;}
}
async function bodyJson(req){
 if(!String(req.headers['content-type']||'').startsWith('application/json'))throw Error('content_type');
 let text='';for await(const part of req){text+=part.toString('utf8');if(text.length>8192)throw Error('too_large');}
 return JSON.parse(text||'{}');
}
function safeEmail(value){
 if(typeof value!=='string')return '';
 const v=value.trim().toLowerCase();return /^[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@]{2,25}$/.test(v)&&v.length<=254?v:'';
}
function createServer(config={}){
 const adminEmail=safeEmail(config.adminEmail??process.env.CLOUD_ADMIN_EMAIL??'');
 const adminPassHash=String(config.adminPassHash??process.env.CLOUD_ADMIN_PASSWORD_SCRYPT??'');
 const adminConfigured=!!adminEmail&&PASS_SPEC.test(adminPassHash);
 const store=config.store||null;
 const attempts=new Map();let checkCount=0;
 async function identity(req){
  const token=getCookie(req);
  if(!store||!token||token.length>128)return null;
  const session=await store.session(hashToken(token));
  if(!session||!(new Date(session.expiresAt).getTime()>Date.now()))return null;
  if(session.subject==='admin'){
   if(!adminConfigured||session.email!==adminEmail)return null;
   return {role:'admin',email:adminEmail,subject:'admin'};
  }
  if(session.subject==='guest'){
   const user=await store.user();
   if(!user||!user.enabled||user.email!==session.email)return null;
   return {role:'guest',email:user.email,subject:'guest'};
  }
  return null;
 }
 const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url||'/','http://localhost').pathname;
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('X-Robots-Tag','noindex, nofollow');
  try{
   if(req.method==='GET'&&pathname==='/healthz')return json(res,200,{status:store?'ok':'sealed',service:'zvm-cloud-private-pilot',sending:'disabled'});
   if(req.method==='GET'&&pathname==='/robots.txt'){res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});return res.end('User-agent: *\nDisallow: /\n');}
   if(req.method==='GET'&&ASSETS[pathname]){
    const [file,type]=ASSETS[pathname];return fs.readFile(path.join(__dirname,'public',file),(err,data)=>{
     if(err)return json(res,500,{error:'asset_unavailable'});
     res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(data);
    });
   }
   if(req.method==='GET'&&pathname==='/api/session'){
    const current=await identity(req);
    return json(res,200,{configured:!!store&&adminConfigured,loggedIn:!!current,email:current?.email||null,role:current?.role||null,mode:'pilot',sending:false,persistence:!!store});
   }
   if(pathname.startsWith('/api/')&&['POST','PUT','PATCH','DELETE'].includes(req.method)&&!originAllowed(req))return json(res,403,{error:'origin_denied'});
   if(req.method==='POST'&&pathname==='/api/login'){
    if(!store||!adminConfigured)return json(res,503,{error:'setup_pending'});
    const ip=String(req.socket.remoteAddress||'unknown');
    let a=attempts.get(ip)||{count:0,until:0};
    if(a.until<Date.now())a={count:0,until:Date.now()+900000};
    if(++a.count>8){attempts.set(ip,a);return json(res,429,{error:'rate_limited'});}
    attempts.set(ip,a);
    let body;try{body=await bodyJson(req);}catch{return json(res,400,{error:'invalid_request'});}
    const email=safeEmail(body.email);
    const user=email&&email!==adminEmail?await store.user():null;
    const role=email===adminEmail?'admin':'guest';
    const checkHash=role==='admin'?adminPassHash:(user?.enabled&&user?.email===email?user.hash:adminPassHash);
    const valid=!!email&&validatePass(body.password,checkHash);
    if(!valid||(role==='guest'&&(!user||!user.enabled||user.email!==email)))return json(res,401,{error:'invalid_credentials'});
    attempts.delete(ip);
    const token=crypto.randomBytes(32).toString('base64url');
    await store.newSession(hashToken(token),{subject:role,email,expiresAt:new Date(Date.now()+SESSION_MS)});
    return json(res,200,{ok:true,role},{'Set-Cookie':sessionCookie(token,28800)});
   }
   if(req.method==='POST'&&pathname==='/api/logout'){
    if(store){const t=getCookie(req);if(t)await store.endSession(hashToken(t));}
    return json(res,200,{ok:true},{'Set-Cookie':sessionCookie('',0)});
   }
   if(pathname.startsWith('/api/')&&!store)return json(res,503,{error:'setup_pending'});
   const current=await identity(req);
   if(pathname.startsWith('/api/')&&!current)return json(res,401,{error:'login_required'});
   if(req.method==='GET'&&pathname==='/api/overview'){
    return json(res,200,{account:current.email,role:current.role,environment:'isolated-pilot',sending:'disabled',whatsapp:'not_connected',scheduledJobs:0,realMessages:0,persistence:'mongodb_isolated',uptimeSeconds:Math.floor(process.uptime())});
   }
   if(req.method==='POST'&&pathname==='/api/ping'){checkCount++;return json(res,200,{ok:true,at:new Date().toISOString(),number:checkCount});}
   if(pathname==='/api/admin/guest'){
    if(current.role!=='admin')return json(res,403,{error:'admin_only'});
    if(req.method==='GET'){
     const user=await store.user();return json(res,200,{user:user?{email:user.email,enabled:user.enabled,createdAt:user.createdAt}:null,maxGuests:1});
    }
    if(req.method==='POST'){
     let body;try{body=await bodyJson(req);}catch{return json(res,400,{error:'invalid_request'});}
     const guestEmail=safeEmail(body.email);
     if(!guestEmail||guestEmail===adminEmail||typeof body.password!=='string'||body.password.length<12||body.password.length>128)return json(res,400,{error:'invalid_user'});
     const hash=passwordHash(body.password);
     const old=await store.user();
     await store.setUser({email:guestEmail,enabled:true,hash,createdAt:old?.createdAt||new Date().toISOString()});
     return json(res,200,{ok:true,email:guestEmail,replaced:!!old});
    }
    if(req.method==='DELETE'){
     await store.revokeUser();
     return json(res,200,{ok:true});
    }
   }
   if(pathname==='/api/draft'){
    if(current.role!=='guest')return json(res,403,{error:'guest_only'});
    if(req.method==='GET'){
     const draft=await store.draft();return json(res,200,{name:draft?.name||'',message:draft?.message||'',updatedAt:draft?.updatedAt||null,persistence:'cloud'});
    }
    if(req.method==='PUT'){
     let body;try{body=await bodyJson(req);}catch{return json(res,400,{error:'invalid_request'});}
     if(typeof body.name!=='string'||body.name.length>80||typeof body.message!=='string'||body.message.length>2000)return json(res,400,{error:'invalid_draft'});
     const updatedAt=new Date().toISOString();
     await store.setDraft({name:body.name,message:body.message,updatedAt});
     return json(res,200,{ok:true,updatedAt,persistence:'cloud'});
    }
    if(req.method==='DELETE'){await store.clearDraft();return json(res,200,{ok:true});}
   }
   return json(res,404,{error:'not_found'});
  }catch(error){
   console.error('[cloud-pilot] error class:',error?.name||'Error');
   return json(res,503,{error:'temporarily_unavailable'});
  }
 });
 return server;
}
async function start(){
 let store=null;
 if(process.env.CLOUD_MONGODB_URI)store=await createMongoStore(process.env.CLOUD_MONGODB_URI);
 const server=createServer({store});
 server.listen(Number(process.env.PORT||10000),'0.0.0.0',()=>console.log('ZVM Cloud isolated pilot ready; real sending disabled'));
}
if(require.main===module)start().catch(e=>{console.error('[cloud-pilot] could not start:',e?.name||'Error');process.exitCode=1;});
module.exports={createServer,validatePass,passwordHash,safeEmail};
