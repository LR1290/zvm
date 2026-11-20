const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const lines=fs.readFileSync(path.join(process.argv[2],'app/background/authority/license-authority.js'),'utf8').split('\n');
 const writes=[];let deliver,entered;const pending=new Promise(r=>{entered=r});
 const env={_s00:'pub',_s01:'legacy',_s1E:'legacy-key',_s1G:null,extIntegrityRequire:async()=>{},
  extError:(code,msg)=>Object.assign(Error(msg),{code}),self:{extuiOpaqueV4LoginAccount:async email=>{
   if(email==='first'){entered();return new Promise(r=>{deliver=r});}return {subject:email};
  },extuiOpaqueV4Clear:async()=>writes.push('clear')},chrome:{storage:{local:{get:async()=>({})}}},
  extStorageRemove:async()=>{},extClearLegacyAuthorityCaches:async()=>{},extAccountPublicFromSession:session=>session.subject,_s0r:async value=>writes.push(value)};
 vm.createContext(env);vm.runInContext(lines.filter(s=>/^(var extLicenseOperationRevision|function extLicense(BeginOperation|AssertOperation|Commit)\(|async function (extLicenseAbortIssuedSession|extAccountV4Login)\()/.test(s)).join('\n'),env);
 const first=env.extAccountV4Login('first','fixture','');await pending;
 const next=await env.extAccountV4Login('second','fixture','');
 deliver({subject:'first'});await assert.rejects(first,{code:'LICENSE_OPERATION_SUPERSEDED'});
 assert.equal(next.authorized,true);assert.deepEqual(writes,['second']);
 console.log('PASS positive late login: one public session write, newer identity retained, zero clears');
})().catch(e=>{console.error(e);process.exitCode=1});
