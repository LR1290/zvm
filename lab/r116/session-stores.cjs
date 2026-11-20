const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(process.argv[2],'app/background/authority');
const opaque=fs.readFileSync(path.join(root,'offscreen-options.js'),'utf8');
const authority=fs.readFileSync(path.join(root,'license-authority.js'),'utf8');
function range(s,a,b){const i=s.indexOf(a),j=s.indexOf(b,i);assert(i>=0&&j>i);return s.slice(i,j);}
(async()=>{
 for(const firstOutcome of ['positive',429,503]){
  let resolveOld,firstStarted;const oldStarted=new Promise(r=>{firstStarted=r});
  const stored={},sealed={},publicRows={};const oldEmail='old@example.invalid',newEmail='new@example.invalid';
  function reply(email,status){
   if(status!==200)return {status,data:{errorCode:status===429?'rate_limited':'temporarily_unavailable'}};
   return {status,data:{session:{token:(email===oldEmail?'a':'b').repeat(64),subject:{id:email},expiresAt:new Date(Date.now()+3600000).toISOString(),authMethod:'password'},entitlement:{tier:'free',expiresAt:new Date(Date.now()+3600000).toISOString()}}};
  }
  const shared={extError:(code,msg)=>Object.assign(Error(msg),{code}),self:{},extIntegrityRequire:async()=>({}),
   chrome:{storage:{session:{set:async data=>Object.assign(stored,data)},local:{get:async()=>publicRows}}},
   _s04:'phone',_s00:'public',_s01:'key',_s1E:'secret',_s1G:null,_s0p:async()=>'device',_s17:async()=>({}),extStorageGetOne:async()=>null,
   extOffscreenStorageMutation:(_,fn)=>fn(),extStorageRemove:async()=>{},extClearLegacyAuthorityCaches:async()=>{},
   extLicenseAccessCount:x=>x??null,extLicenseExpiryForSession:()=>({}),_s0r:async data=>{publicRows.public=data;},
   request:async(_,body)=>{if(body.email===oldEmail){firstStarted();return new Promise(r=>{resolveOld=r;});}return reply(body.email,200);}};
  shared.self.__extSensitiveStorage={get:async()=>sealed,set:async data=>Object.assign(sealed,data),remove:async k=>{delete sealed[k]},isSensitiveKey:()=>true};
  vm.createContext(shared);
  vm.runInContext(range(opaque,'var EXTUI_OPAQUE_V4_KEY=','async function readDurableAccountSession')+
   range(opaque,'async function setStored','async function clearStored')+
   range(opaque,'function normalizeEntitlement','function authoritativeSessionError'),shared);
  shared.self.extuiOpaqueV4LoginAccount=shared.loginAccount;
  vm.runInContext(range(authority,'var extLicenseOperationRevision','var extuiLicenseExpiryCore')+
   authority.split('\n').filter(line=>/^(async function (extLicenseAbortIssuedSession|extAccountV4Login)|function extAccountPublicFromSession)\(/.test(line)).join('\n'),shared);
  const old=shared.extAccountV4Login(oldEmail,'fixture','');await oldStarted;
  const newest=await shared.extAccountV4Login(newEmail,'fixture','');assert(newest.authorized);
  resolveOld(reply(oldEmail,firstOutcome==='positive'?200:firstOutcome));
  await assert.rejects(old,e=>e.code===({positive:'SESSION_OPERATION_SUPERSEDED',429:'ACCOUNT_RATE_LIMITED',503:'ACCOUNT_LOGIN_UNAVAILABLE'}[firstOutcome]));
  assert.equal(publicRows.public.serverSubjectId,newEmail);
  assert.equal(stored['EXTUI:opaqueSessionV4'].subject.id,newEmail);
  assert.equal(sealed['EXTUI:opaqueSessionV4Sealed'].subject.id,newEmail);
  console.log(JSON.stringify({late:firstOutcome,public:'newer',opaque:'newer',sealed:'newer'}));
 }
})().catch(e=>{console.error(e);process.exitCode=1});
