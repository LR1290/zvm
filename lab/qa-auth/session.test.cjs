const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(process.env.ZVM_LAB_SOURCE || path.join(__dirname,'../staging'),'app/background/authority/offscreen-options.js');
const source=fs.readFileSync(file,'utf8');
const start=source.lastIndexOf(';(function()',source.indexOf('var EXTUI_OPAQUE_V4_KEY'));
const end=source.indexOf('})();',source.indexOf('self.extuiOpaqueV4Ensure=ensure'));
assert(start>=0 && end>start);
function worker(subject, publicId, broken=false, fetch, expiry=Date.now()+3600000){
  const sessionKey='EXTUI:opaqueSessionV4', vaultKey=sessionKey+'Sealed';
  const saved={authMethod:'password',subject:{id:subject},token:'a'.repeat(64),expiresAtMs:expiry};
  const removed=[];
  let cached=null, durable=saved;
  const area={get:async()=>{if(broken)throw Error('read');return {[sessionKey]:cached};},set:async row=>{cached=row[sessionKey]},remove:async key=>{removed.push(key);cached=null}};
  const self={__extRuntimeConfig:{backendUrl:path=>path},__extBoundedResponseText:{read:async r=>JSON.stringify(r.body)},__extSensitiveStorage:{get:async()=>({[vaultKey]:durable}),set:async row=>{durable=row[vaultKey]},remove:async key=>{removed.push(key);durable=null},isSensitiveKey:k=>k===vaultKey}};
  vm.runInNewContext(source.slice(start,end+5),{self,fetch,AbortController,setTimeout,clearTimeout,extIntegrityRequire:async()=>({}),_s17:async()=>({}),extSecurityV2UserMessage:c=>c,chrome:{storage:{session:area,local:{get:async()=>({pub:{authenticated:true,credentialPresent:true,authMethod:'password',serverSubjectId:publicId}})}}},_s00:'pub',extError:(code)=>Object.assign(Error(code),{code}),extOffscreenStorageMutation:async(keys,fn)=>fn()});
  return {api:self,removed};
}
for(const [subject,pub,expected] of [['A','A',true],['A','B',false],[undefined,undefined,false],[' ',' ',false]]){
  test('cold start '+JSON.stringify([subject,pub]),async()=>assert.equal(await worker(subject,pub).api.extuiOpaqueV4HasLocalCredential(),expected));
}
test('logout clears both stores and reports the original read failure',async()=>{
  const {api,removed}=worker('A','A',true);
  const result=await api.extuiOpaqueV4Logout();
  assert.equal(result.errorCode,'SESSION_STORAGE_READ_FAILED');
  assert.equal(result.localCleared,true);
  assert.equal(result.remoteRevoked,false);
  assert.deepEqual(removed,['EXTUI:opaqueSessionV4Sealed','EXTUI:opaqueSessionV4']);
});
test('restoration offline blocks use then retries refresh once across concurrent callers',async()=>{
  let calls=0;
  const {api}=worker('A','A',false,async path=>{
    assert.equal(path,'/extension/v4/session/refresh');
    if(++calls===1)throw Error('offline');
    const expiresAt=new Date(Date.now()+3600000).toISOString();
    return {ok:true,status:200,body:{session:{authMethod:'password',token:'a'.repeat(64),subject:{id:'A'},expiresAt},entitlement:{tier:'free',expiresAt}}};
  });
  await assert.rejects(api.extuiOpaqueV4Ensure(),/offline/);
  const results=await Promise.all([api.extuiOpaqueV4Ensure(),api.extuiOpaqueV4Ensure()]);
  assert(results.every(r=>r.entitlement.tier==='free'));
  assert.equal(calls,2);
});
test('authoritative revocation prevents a second restoration',async()=>{
  const {api}=worker('A','A',false,async()=>({ok:false,status:401,body:{errorCode:'session_revoked'}}));
  await assert.rejects(api.extuiOpaqueV4Ensure(),{code:'session_revoked'});
  assert.equal(await api.extuiOpaqueV4HasLocalCredential(),false);
});
for(const [status,ok,revoked,confirmed] of [[200,true,true,true],[200,true,false,false],[503,false,false,false],[429,false,false,false]]){
  test('remote logout confirmation '+[status,ok,revoked],async()=>{
    const {api}=worker('A','A',false,async()=>({status,body:{ok,revoked}}));
    const result=await api.extuiOpaqueV4Logout();
    assert.equal(result.localCleared,true);
    assert.equal(result.remoteRevoked,confirmed);
    assert.equal(await api.extuiOpaqueV4HasLocalCredential(),false);
  });
}
test('in-flight refresh cannot restore the session after logout',async()=>{
  let acknowledge, started;
  const waiting=new Promise(resolve=>{started=resolve});
  const {api}=worker('A','A',false,async path=>{
    if(path.endsWith('/logout'))return {status:200,body:{ok:true,revoked:true}};
    started();
    return new Promise(resolve=>{acknowledge=resolve});
  });
  const pending=api.extuiOpaqueV4Ensure(true);
  await waiting;
  assert.equal((await api.extuiOpaqueV4Logout()).remoteRevoked,true);
  const expiresAt=new Date(Date.now()+3600000).toISOString();
  acknowledge({status:200,body:{session:{authMethod:'password',token:'a'.repeat(64),subject:{id:'A'},expiresAt},entitlement:{tier:'free',expiresAt}}});
  await assert.rejects(pending,{code:'SESSION_OPERATION_SUPERSEDED'});
  assert.equal(await api.extuiOpaqueV4HasLocalCredential(),false);
});
test('expired sealed account credential cannot authorize a protected operation',async()=>{
  let requests=0;
  const {api}=worker('A','A',false,async()=>{requests++},Date.now()-1000);
  assert.equal(await api.extuiOpaqueV4HasLocalCredential(),false);
  await assert.rejects(api.extuiOpaqueV4Authorize('disparos.execute'),{code:'ACCOUNT_SESSION_REQUIRED'});
  assert.equal(requests,0);
});
