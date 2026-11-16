'use strict';
// Cloud demo controller: reuse real ZVM portal accounts, require a DEV-enabled license.
// No message dispatch, scheduling, WhatsApp webhook or public registration exists here.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {createMongoStore}=require('./store');
const {MODULES,moduleCheck,checkAudience,planLegacy,mergeModules,checkWhole}=require('./workspace-domain');
const ASSETS={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','application/javascript; charset=utf-8'],'/styles.css':['styles.css','text/css; charset=utf-8'],'/workspace.js':['workspace.js','application/javascript; charset=utf-8']};
const MAX_TRIES=8, WINDOW_MS=15*60*1000;
function json(res,status,body){
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
 res.end(JSON.stringify(body));
}
function originAllowed(req){
 try{
  const origin=new URL(req.headers.origin||''),host=String(req.headers.host||'');
  return origin.host===host&&(origin.protocol==='https:'||(/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)&&origin.protocol==='http:'));
 }catch{return false;}
}
async function readJson(req,maxBytes=8192){
 if(!String(req.headers['content-type']||'').startsWith('application/json'))throw Error('invalid_content_type');
 let text='',received=0;
 for await(const part of req){
  received+=part.length;
  if(received>maxBytes)throw Error('request_too_large');
  text+=part.toString('utf8');
 }
 return JSON.parse(text||'{}');
}
function createHandler({store=null,resolvePortal=null,verifyDevKey=null}={}){
 // No alternate password database and no fallback identity from caller-supplied email.
 const failures=new Map();
 let pingCount=0;
 async function portal(req){
  if(typeof resolvePortal!=='function')return null;
  const user=await resolvePortal(req);
  if(!user||typeof user.email!=='string'||typeof user.sessionId!=='string'||!/^[a-f0-9]{64}$/.test(user.sessionId))return null;
  const expiresAt=Number(user.expiresAt);
  if(!Number.isFinite(expiresAt)||expiresAt<=Date.now())return null;
  return {email:user.email.toLowerCase(),sessionId:user.sessionId,expiresAt};
 }
 async function activated(user){
  if(!user||!store||typeof verifyDevKey!=='function')return false;
  const grant=await store.getGrant(user.sessionId);
  if(!grant||grant.email!==user.email||!(new Date(grant.expiresAt).getTime()>Date.now()))return false;
  // Re-check the authoritative, current DEV status on every privileged request.
  return (await verifyDevKey(user.email,null,grant.keyHash))===true;
 }
 return async function handleCloudRequest(req,res){
  const pathname=new URL(req.url||'/','http://localhost').pathname;
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('X-Robots-Tag','noindex, nofollow');
  try{
   if(req.method==='GET'&&pathname==='/healthz')return json(res,200,{status:store?'ready':'sealed',sending:false});
   if(req.method==='GET'&&pathname==='/robots.txt'){
    res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});
    return res.end('User-agent: *\nDisallow: /\n');
   }
   if((req.method==='GET'||req.method==='HEAD')&&ASSETS[pathname]){
    const [filename,type]=ASSETS[pathname];
    return fs.readFile(path.join(__dirname,'public',filename),(error,data)=>{
     if(error)return json(res,503,{error:'assets_unavailable'});
     res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});
     res.end(req.method==='HEAD'?undefined:data);
    });
   }
   if(!pathname.startsWith('/api/'))return json(res,404,{error:'not_found'});
   if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&!originAllowed(req))return json(res,403,{error:'origin_denied'});
   const user=await portal(req);
   if(req.method==='GET'&&pathname==='/api/session'){
    const devAuthorized=await activated(user);
    return json(res,200,{loggedIn:!!user,email:user?.email||null,devAuthorized,devRequired:!!user&&!devAuthorized,persistence:!!store,sending:false,mode:'dev-pilot'});
   }
   if(pathname==='/api/login'||pathname==='/api/admin/guest')return json(res,404,{error:'not_found'});
   if(!user)return json(res,401,{error:'site_login_required'});
   if(!store||typeof verifyDevKey!=='function')return json(res,503,{error:'cloud_unavailable'});
   if(req.method==='POST'&&pathname==='/api/dev/activate'){
    const prev=failures.get(user.sessionId)||{count:0,until:0};
    if(prev.until<=Date.now()){prev.count=0;prev.until=Date.now()+WINDOW_MS;}
    prev.count++;failures.set(user.sessionId,prev);
    if(prev.count>MAX_TRIES)return json(res,429,{error:'try_again_later'});
    let data;try{data=await readJson(req);}catch{return json(res,400,{error:'invalid_request'});}
    const code=typeof data.key==='string'?data.key.trim().toLowerCase():'';
    if(!/^[a-z0-9_-]{1,64}$/.test(code))return json(res,400,{error:'invalid_key'});
    const result=await verifyDevKey(user.email,code,null);
    if(!result||typeof result.keyHash!=='string'||!/^[a-f0-9]{64}$/.test(result.keyHash))return json(res,403,{error:'dev_key_not_authorized'});
    await store.grant(user.sessionId,user.email,result.keyHash,Math.min(user.expiresAt,Date.now()+8*60*60*1000));
    failures.delete(user.sessionId);
    return json(res,200,{ok:true,devAuthorized:true});
   }
   if(req.method==='POST'&&pathname==='/api/dev/leave'){
    await store.revokeGrant(user.sessionId);
    return json(res,200,{ok:true});
   }
   if(!await activated(user))return json(res,403,{error:'dev_key_required'});
   if(req.method==='GET'&&pathname==='/api/overview'){
    return json(res,200,{account:user.email,role:'client',environment:'dev-pilot',sending:'disabled',whatsapp:'not_connected',scheduledJobs:0,realMessages:0,persistence:'isolated_mongodb',uptimeSeconds:Math.floor(process.uptime())});
   }
   if(req.method==='POST'&&pathname==='/api/ping'){
    pingCount++;return json(res,200,{ok:true,at:new Date().toISOString(),number:pingCount});
   }
   if(req.method==='GET'&&pathname==='/api/workspace'){
    const current=await store.readWorkspace(user.email);
    const counts=Object.fromEntries(Object.keys(MODULES).map(name=>[name,Array.isArray(current.modules[name])?current.modules[name].length:0]));
    return json(res,200,{revision:current.revision,updatedAt:current.updatedAt,counts,moduleNames:Object.keys(MODULES),data:current.modules,sending:false});
   }
   if(req.method==='GET'&&pathname==='/api/workspace/export'){
    const data=await store.readWorkspace(user.email);
    return json(res,200,{format:'ZVM_CLOUD_V1',version:1,createdAt:new Date().toISOString(),
      note:'Somente rascunhos Cloud. Não contém mídias locais, autenticação ou chaves.',
      revision:data.revision,modules:data.modules});
   }
   const moduleRoute=/^\/api\/workspace\/([a-zA-Z]+)$/.exec(pathname);
   if(moduleRoute){
    const name=moduleRoute[1];
    if(!Object.prototype.hasOwnProperty.call(MODULES,name))return json(res,404,{error:'module_unknown'});
    if(req.method==='GET'){
     const current=await store.readWorkspace(user.email);
     return json(res,200,{module:name,revision:current.revision,records:current.modules[name]||[],updatedAt:current.updatedAt,sending:false});
    }
    if(req.method==='PUT'){
     let payload;try{payload=await readJson(req,950000);}catch{return json(res,400,{error:'invalid_payload'});}
     if(!Number.isSafeInteger(payload.revision)||payload.revision<0)return json(res,400,{error:'invalid_revision'});
     let records;
     try{records=moduleCheck(name,payload.records);}catch(error){return json(res,422,{error:error.code||'invalid_module'});}
     const current=await store.readWorkspace(user.email);
     if(current.revision!==payload.revision)return json(res,409,{error:'workspace_conflict',revision:current.revision});
     const modules={...current.modules,[name]:records};
     try{checkWhole(modules);for(const audienceModule of ['campaigns','flows','funnels'])checkAudience(audienceModule,modules[audienceModule]||[],modules.contacts||[]);}
     catch(error){return json(res,422,{error:error.code||'workspace_invalid'});}
     const saved=await store.writeWorkspace(user.email,current.revision,modules);
     if(saved.conflict)return json(res,409,{error:'workspace_conflict'});
     return json(res,200,{ok:true,module:name,revision:saved.revision,updatedAt:saved.updatedAt,count:records.length});
    }
   }
   if(req.method==='POST'&&(pathname==='/api/import/preview'||pathname==='/api/import/commit')){
    let input;try{input=await readJson(req,2200000);}catch{return json(res,413,{error:'invalid_or_oversize_import'});}
    let plan;
    try{plan=planLegacy(input.backup);}catch(error){return json(res,422,{error:error.code||'backup_not_supported'});}
    const current=await store.readWorkspace(user.email);
    if(pathname==='/api/import/preview'){
     return json(res,200,{ok:true,digest:plan.digest,counts:plan.counts,warnings:plan.warnings,
       skipped:plan.skipped,sourceFormat:plan.sourceFormat,revision:current.revision,
       note:'Nenhum dado importado. Mídias locais e segredos não são transferidos.'});
    }
    const mode=input.mode||'merge';
    if(!Number.isSafeInteger(input.revision)||input.revision<0||input.revision!==current.revision)return json(res,409,{error:'workspace_conflict',revision:current.revision});
    if(typeof input.digest!=='string'||input.digest!==plan.digest)return json(res,409,{error:'backup_changed_since_preview'});
    let modules;
    try{modules=mergeModules(current.modules,plan.modules,mode);checkWhole(modules);}
    catch(error){return json(res,422,{error:error.code||'import_failed'});}
    const committed=await store.writeWorkspace(user.email,current.revision,modules);
    if(committed.conflict)return json(res,409,{error:'workspace_conflict'});
    console.log('[ZVM-CLOUD] authorized import categories='+Object.keys(plan.counts).join(',')+'; no real sending');
    return json(res,200,{ok:true,revision:committed.revision,counts:plan.counts,warnings:plan.warnings,
      sending:false});
   }
   if(pathname==='/api/draft'){
    if(req.method==='GET'){
     const d=await store.getDraft(user.email);
     return json(res,200,{name:d?.name||'',message:d?.message||'',updatedAt:d?.updatedAt||null,persistence:'cloud'});
    }
    if(req.method==='PUT'){
     let d;try{d=await readJson(req);}catch{return json(res,400,{error:'invalid_request'});}
     if(typeof d.name!=='string'||d.name.length>80||typeof d.message!=='string'||d.message.length>2000)return json(res,400,{error:'invalid_draft'});
     const updatedAt=new Date().toISOString();
     await store.setDraft(user.email,{name:d.name,message:d.message,updatedAt});
     return json(res,200,{ok:true,updatedAt,persistence:'cloud'});
    }
    if(req.method==='DELETE'){
     await store.clearDraft(user.email);return json(res,200,{ok:true});
    }
   }
   return json(res,404,{error:'not_found'});
  }catch(error){
   console.error('[ZVM-CLOUD] request failed:',error?.name||'Error');
   if(res.headersSent)return;
   return json(res,503,{error:'temporarily_unavailable'});
  }
 };
}
function createServer(config={}){return http.createServer(createHandler(config));}
// Test harness only. Main service must provide real portal authentication callbacks.
async function start(){
 const uri=String(process.env.CLOUD_MONGODB_URI||'');
 const store=uri?await createMongoStore(uri):null;
 const server=createServer({store});
 server.listen(Number(process.env.PORT||10000),'0.0.0.0',()=>console.log('Cloud QA harness; live sends disabled'));
}
if(require.main===module)start().catch(error=>{console.error('[ZVM-CLOUD] init:',error?.name||'Error');process.exitCode=1;});
module.exports={createHandler,createServer,originAllowed};
