'use strict';
// Cloud demo controller: reuse real ZVM portal accounts, require a DEV-enabled license.
// No message dispatch, scheduling, WhatsApp webhook or public registration exists here.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {once}=require('node:events');
const {createMongoStore}=require('./store');
const {MODULES,moduleCheck,checkAudience,planLegacy,mergeModules,checkWhole}=require('./workspace-domain');
const {changeCrmBoard,checkCrmLinks}=require('./crm-board-domain');
const Media=require('./media-domain');
const Large=require('./large-media-domain');
const {checkLibraryRecords}=require('./library-domain');
const Meta=require('./meta-webhook');
const ASSETS={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','application/javascript; charset=utf-8'],'/styles.css':['styles.css','text/css; charset=utf-8'],'/workspace.js':['workspace.js','application/javascript; charset=utf-8'],'/backup-zip.js':['backup-zip.js','application/javascript; charset=utf-8'],'/cloud-ui.js':['cloud-ui.js','application/javascript; charset=utf-8'],'/cloud-ui.css':['cloud-ui.css','text/css; charset=utf-8'],'/cloud-crm-board.js':['cloud-crm-board.js','application/javascript; charset=utf-8'],'/cloud-crm-board.css':['cloud-crm-board.css','text/css; charset=utf-8'],'/cloud-library.js':['cloud-library.js','application/javascript; charset=utf-8'],'/cloud-library.css':['cloud-library.css','text/css; charset=utf-8'],'/backup-asset-links.js':['backup-asset-links.js','application/javascript; charset=utf-8']};
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
async function readBinary(req,maxBytes=Large.CHUNK_BYTES){
 if(String(req.headers['content-type']||'').toLowerCase()!=='application/octet-stream')throw Error('invalid_content_type');
 const parts=[];let total=0;
 for await(const part of req){
  const bytes=Buffer.isBuffer(part)?part:Buffer.from(part);
  total+=bytes.length;if(total>maxBytes)throw Error('chunk_too_large');
  parts.push(bytes);
 }
 return Buffer.concat(parts,total);
}
function largeError(error){
 const code=error?.code||'invalid_large_upload';
 const status=code==='large_media_limit'||code==='chunk_too_large'?413:
  /^(upload_already_active|media_id_collision|chunk_conflict|chunk_out_of_order|upload_incomplete|upload_finalizing|upload_in_progress|media_storage_quota|media_item_quota)$/.test(code)?409:
  code==='upload_not_found'||code==='media_not_found'?404:422;
 return {code,status};
}
async function commitWorkspace(store,email,revision,modules){
 try{return await store.writeWorkspace(email,revision,modules);}
 catch(error){
  const code=error?.code||'workspace_transaction_failed';
  if(['unknown_library_media','library_media_kind_mismatch','library_media_required',
   'library_text_required','invalid_library_kind','invalid_library_status',
   'invalid_library_media'].includes(code))return {invalid:true,error:code};
  throw error;
 }
}
async function validateLargeDownload(store,email,file){
 const digest=crypto.createHash('sha256');
 let length=0,count=0,first=null;
 for await(const bytes of store.large.chunks(email,file.id)){
  const expected=Large.expectedSize({size:file.size,chunks:Math.ceil(file.size/Large.CHUNK_BYTES)},count);
  if(bytes.length!==expected)throw Error('large_media_corrupt_chunk');
  if(!first)first=bytes.subarray(0,32);
  length+=bytes.length;digest.update(bytes);count++;
 }
 if(length!==file.size||count!==Math.ceil(file.size/Large.CHUNK_BYTES)||
    digest.digest('hex')!==file.sha256||!Media.mimeDetected(first,file.mime))throw Error('large_media_integrity_failed');
}
async function streamLargeDownload(store,email,file,res,method){
 await validateLargeDownload(store,email,file);
 res.writeHead(200,{'Content-Type':file.mime,'Content-Length':file.size,
  'Content-Disposition':file.mime.startsWith('image/')?'inline; filename="zvm-cloud-anexo"':'attachment; filename="zvm-cloud-anexo"',
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'X-Download-Options':'noopen','Cross-Origin-Resource-Policy':'same-origin'});
 if(method==='HEAD'){res.end();return;}
 for await(const bytes of store.large.chunks(email,file.id)){
  if(!res.write(bytes))await once(res,'drain');
 }
 res.end();
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
  // DEV trust belongs to the authenticated Portal ACCOUNT, never to a browser
  // session or 8-hour TTL. Do not migrate legacy per-session grants implicitly:
  // explicit revocation must not be resurrected by another old session.
  const grant=await store.getAccountGrant(user.email);
  if(!grant||typeof grant.keyHash!=='string'||!/^[a-f0-9]{64}$/.test(grant.keyHash))return false;
  // Each privileged request checks the CURRENT authoritative license. Revoked,
  // unlinked, replaced or no-longer-DEV keys stop working immediately.
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
   if(pathname==='/meta/webhook')return Meta.handleWebhook(req,res,{store});
   if(!pathname.startsWith('/api/'))return json(res,404,{error:'not_found'});
   if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&!originAllowed(req))return json(res,403,{error:'origin_denied'});
   const user=await portal(req);
   if(req.method==='GET'&&pathname==='/api/session'){
    const devAuthorized=await activated(user);
    return json(res,200,{loggedIn:!!user,email:user?.email||null,devAuthorized,devRequired:!!user&&!devAuthorized,persistence:!!store,rememberedForAccount:devAuthorized,sending:false,mode:'dev-pilot'});
   }
   if(pathname==='/api/login'||pathname==='/api/admin/guest')return json(res,404,{error:'not_found'});
   if(!user)return json(res,401,{error:'site_login_required'});
   if(!store||typeof verifyDevKey!=='function')return json(res,503,{error:'cloud_unavailable'});
   if(req.method==='POST'&&pathname==='/api/dev/activate'){
    const prev=failures.get(user.email)||{count:0,until:0};
    if(prev.until<=Date.now()){prev.count=0;prev.until=Date.now()+WINDOW_MS;}
    prev.count++;failures.set(user.email,prev);
    if(prev.count>MAX_TRIES)return json(res,429,{error:'try_again_later'});
    let data;try{data=await readJson(req);}catch{return json(res,400,{error:'invalid_request'});}
    const code=typeof data.key==='string'?data.key.trim().toLowerCase():'';
    if(!/^[a-z0-9_-]{1,64}$/.test(code))return json(res,400,{error:'invalid_key'});
    const result=await verifyDevKey(user.email,code,null);
    if(!result||typeof result.keyHash!=='string'||!/^[a-f0-9]{64}$/.test(result.keyHash))return json(res,403,{error:'dev_key_not_authorized'});
    await store.grantAccount(user.email,result.keyHash);
    failures.delete(user.email);
    return json(res,200,{ok:true,devAuthorized:true,rememberedForAccount:true});
   }
   if(req.method==='POST'&&pathname==='/api/dev/leave'){
    // Explicit unlink is account-wide, not just a sign-out from this session.
    await store.revokeAccountGrant(user.email);
    failures.delete(user.email);
    return json(res,200,{ok:true,devAuthorized:false,rememberedForAccount:false});
   }
   if(!await activated(user))return json(res,403,{error:'dev_key_required'});
   if(req.method==='GET'&&pathname==='/api/overview'){
    return json(res,200,{account:user.email,role:'client',environment:'dev-pilot',sending:'disabled',whatsapp:'not_connected',scheduledJobs:0,realMessages:0,persistence:'isolated_mongodb',uptimeSeconds:Math.floor(process.uptime())});
   }
   if(req.method==='POST'&&pathname==='/api/ping'){
    pingCount++;return json(res,200,{ok:true,at:new Date().toISOString(),number:pingCount});
   }
   // R24 resumable file chunks. Security gates above apply to every operation.
   if(store.large&&pathname==='/api/media/uploads'){
    if(req.method==='GET')return json(res,200,{upload:await store.large.status(user.email),sending:false});
    if(req.method==='POST'){
     let body;try{body=await readJson(req,2000);}catch{return json(res,400,{error:'invalid_upload'});}
     let payload;
     try{
      const spec=Large.specOf(body),legacy=await store.readMedia(user.email);
      const existing=legacy.items.find(item=>item.id===spec.id);
      if(existing){
       if(existing.sha256!==spec.sha256||existing.mime!==spec.mime)return json(res,409,{error:'media_id_collision'});
       return json(res,200,{ok:true,duplicate:true,file:Large.publicFile(existing),upload:null});
      }
      payload=await store.large.begin(user.email,spec,Media.output(legacy).usedBytes,legacy.items.length);
     }catch(error){const err=largeError(error);return json(res,err.status,{error:err.code});}
     return json(res,200,{ok:true,...payload,sending:false});
    }
   }
   const uploadPart=/^\/api\/media\/uploads\/([a-f0-9]{32})\/(\d{1,3})$/.exec(pathname);
   if(store.large&&uploadPart&&req.method==='PUT'){
    let bytes;try{bytes=await readBinary(req);}catch{return json(res,413,{error:'chunk_payload_invalid'});}
    try{
     const progress=await store.large.append(user.email,uploadPart[1],Number(uploadPart[2]),bytes,String(req.headers['x-chunk-sha256']||''));
     return json(res,200,{ok:true,upload:progress,sending:false});
    }catch(error){const err=largeError(error);return json(res,err.status,{error:err.code});}
   }
   const uploadEnd=/^\/api\/media\/uploads\/([a-f0-9]{32})\/complete$/.exec(pathname);
   if(store.large&&uploadEnd&&req.method==='POST'){
    try{
     const done=await store.large.finish(user.email,uploadEnd[1]);
     const vault=await store.readMedia(user.email),large=await store.large.list(user.email);
     return json(res,200,{ok:true,duplicate:done.duplicate,mediaId:done.file.id,...Large.combined(vault,large),sending:false});
    }catch(error){const err=largeError(error);return json(res,err.status,{error:err.code});}
   }
   const uploadCancel=/^\/api\/media\/uploads\/([a-f0-9]{32})$/.exec(pathname);
   if(store.large&&uploadCancel&&req.method==='DELETE'){
    try{await store.large.cancel(user.email,uploadCancel[1]);return json(res,200,{ok:true,sending:false});}
    catch(error){const err=largeError(error);return json(res,err.status,{error:err.code});}
   }
   // Private media vault: bounded binary storage, signature verification, tenant scope.
   // Media objects are never served from public static paths.
   if(req.method==='GET'&&pathname==='/api/media'){
    const vault=await store.readMedia(user.email);
    return json(res,200,{...Large.combined(vault,store.large?await store.large.list(user.email):[]),sending:false});
   }
   if(req.method==='POST'&&pathname==='/api/media'){
    let payload;try{payload=await readJson(req,1500000);}catch{return json(res,413,{error:'media_payload_too_large'});}
    let media;
    try{media=Media.decode(payload);}catch(error){return json(res,422,{error:error.code||'invalid_media'});}
    const current=await store.readMedia(user.email);
    const large=store.large?await store.large.list(user.email):[];
    const collision=large.find(x=>x.id===media.id);
    if(collision){
     if(collision.sha256!==media.sha256||collision.mime!==media.mime)return json(res,409,{error:'media_id_collision'});
     return json(res,200,{ok:true,duplicate:true,mediaId:media.id,...Large.combined(current,large)});
    }
    if(Large.combined(current,large).usedBytes+media.size>Large.MAX_ACCOUNT)
     return json(res,409,{error:'media_storage_quota'});
    if(!current.items.some(x=>x.id===media.id)&&current.items.length+large.length>=Large.MAX_ITEMS)
     return json(res,409,{error:'media_item_quota'});
    let updated;try{updated=Media.add(current,media,payload.revision);}
    catch(error){return json(res,error.code==='media_revision_conflict'?409:422,{error:error.code||'media_rejected'});}
    if(updated.duplicate)return json(res,200,{ok:true,duplicate:true,mediaId:media.id,...Large.combined(current,large)});
    const result=await store.writeMedia(user.email,current.revision,updated.next.items);
    if(result.conflict)return json(res,409,{error:'media_revision_conflict'});
    return json(res,200,{ok:true,duplicate:false,mediaId:media.id,...Large.combined({...updated.next,revision:result.revision},large)});
   }
   const mediaPath=/^\/api\/media\/(m_[a-f0-9]{40})$/.exec(pathname);
   if(mediaPath){
    const id=mediaPath[1];
    if(req.method==='GET'||req.method==='HEAD'){
     const vault=await store.readMedia(user.email),media=vault.items.find(x=>x.id===id);
     if(!media){
      const file=store.large?await store.large.get(user.email,id):null;
      if(!file)return json(res,404,{error:'media_not_found'});
      try{await streamLargeDownload(store,user.email,file,res,req.method);}
      catch(error){
       if(!res.headersSent)return json(res,503,{error:'large_media_integrity_failed'});
       res.destroy(error);
      }
      return;
     }
     const bytes=Media.getBytes(media);
     if(bytes.length!==media.size||Media.sha(bytes)!==media.sha256||!Media.mimeDetected(bytes,media.mime)){
      return json(res,503,{error:'media_integrity_failed'});
     }
     res.writeHead(200,{
      'Content-Type':media.mime,'Content-Length':bytes.length,
      'Content-Disposition':'attachment; filename="zvm-cloud-anexo"',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'X-Download-Options':'noopen',
      'Cross-Origin-Resource-Policy':'same-origin'
     });
     res.end(req.method==='HEAD'?undefined:bytes);
     return;
    }
    if(req.method==='DELETE'){
     let payload;try{payload=await readJson(req);}catch{return json(res,400,{error:'invalid_request'});}
     if(!Number.isSafeInteger(payload.revision)||payload.revision<0)
      return json(res,400,{error:'invalid_revision'});
     // One owner fence/transaction protects both Library CAS and file deletion.
     // An earlier readWorkspace check followed by a separate delete was unsafe.
     let result;
     try{result=await store.removeMediaIfUnlinked(user.email,id,payload.revision);}
     catch(error){return json(res,503,{error:'media_transaction_unavailable'});}
     if(result.conflict){
      const code=result.code||'media_revision_conflict';
      return json(res,code==='media_not_found'?404:409,{error:code});
     }
     const vault=await store.readMedia(user.email);
     const large=store.large?await store.large.list(user.email):[];
     return json(res,200,{ok:true,...Large.combined(vault,large),sending:false});
    }
   }
   if(req.method==='GET'&&pathname==='/api/meta/status'){
    const status=Meta.readiness(process.env,store);
    return json(res,200,{provider:'whatsapp_business_platform',webhookReady:status.configured&&status.ownerEmail===user.email,sending:false,transportEnabled:false,credentialsConfiguredForUser:status.configured&&status.ownerEmail===user.email});
   }
   // CRM R21 — validated draft-only operations, tenant scope and global CAS.
   if(req.method==='POST'&&pathname==='/api/crm/board'){
    let payload;try{payload=await readJson(req,20000);}
    catch{return json(res,400,{error:'invalid_crm_payload'});}
    if(!Number.isSafeInteger(payload.revision)||payload.revision<0)
     return json(res,400,{error:'invalid_revision'});
    const current=await store.readWorkspace(user.email);
    if(current.revision!==payload.revision)
     return json(res,409,{error:'workspace_conflict',revision:current.revision});
    let result,modules;
    try{
     result=changeCrmBoard(current.modules.crm||[],current.modules.contacts||[],payload);
     modules={...current.modules,crm:moduleCheck('crm',result.records)};
     checkWhole(modules);checkCrmLinks(modules.crm||[],modules.contacts||[]);
    }catch(error){return json(res,422,{error:error.code||'crm_board_invalid'});}
    const saved=await commitWorkspace(store,user.email,current.revision,modules);
    if(saved.conflict)return json(res,409,{error:'workspace_conflict'});
    if(saved.invalid)return json(res,422,{error:saved.error});
    return json(res,200,{ok:true,revision:saved.revision,action:result.action,
     pipelineId:result.pipelineId,columns:result.columns,cards:result.cards,sending:false});
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
     if(name==='library'){
      try{const vault=await store.readMedia(user.email);checkLibraryRecords(records,[...vault.items,...(store.large?await store.large.list(user.email):[])]);}
      catch(error){return json(res,422,{error:error.code||'invalid_library'});}
     }
     const modules={...current.modules,[name]:records};
     try{checkWhole(modules);checkCrmLinks(modules.crm||[],modules.contacts||[]);for(const audienceModule of ['campaigns','flows','funnels'])checkAudience(audienceModule,modules[audienceModule]||[],modules.contacts||[]);}
     catch(error){return json(res,422,{error:error.code||'workspace_invalid'});}
     const saved=await commitWorkspace(store,user.email,current.revision,modules);
     if(saved.conflict)return json(res,409,{error:'workspace_conflict'});
    if(saved.invalid)return json(res,422,{error:saved.error});
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
    try{
     modules=mergeModules(current.modules,plan.modules,mode);checkWhole(modules);
     checkCrmLinks(modules.crm||[],modules.contacts||[]);
     if(Array.isArray(modules.library)){const vault=await store.readMedia(user.email);checkLibraryRecords(modules.library,[...vault.items,...(store.large?await store.large.list(user.email):[])]);}
    }
    catch(error){return json(res,422,{error:error.code||'import_failed'});}
    const committed=await commitWorkspace(store,user.email,current.revision,modules);
    if(committed.conflict)return json(res,409,{error:'workspace_conflict'});
    if(committed.invalid)return json(res,422,{error:committed.error});
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
