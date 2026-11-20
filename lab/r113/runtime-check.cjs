const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]),id='ckbffcbmanboelbihfkhiahgafnimcho',prefix='chrome-extension://'+id+'/';
async function run(tamper){
 const env={chrome:{runtime:{id,getURL:n=>prefix+n,getManifest:()=>JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))),onMessage:{addListener(){}}},storage:{session:{set:async()=>{},remove:async()=>{}}}},crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,atob,btoa,setTimeout,clearTimeout,performance,
 fetch:async url=>{assert(url.startsWith(prefix));const n=url.slice(prefix.length);assert(!n.split('/').includes('..'));const bytes=fs.readFileSync(path.join(root,n));if(tamper&&n==='app/shared/core/theme-system.js')bytes[0]^=1;return new Response(bytes)}};
 env.self=env;env.URL=URL;vm.createContext(env);vm.runInContext(fs.readFileSync(path.join(root,"app/shared/core/runtime-config.js"),"utf8"),env);
 for(const n of ['manifest-integrity-policy','browser-icon-integrity-policy','foundation-integrity'])vm.runInContext(fs.readFileSync(path.join(root,'app/background/authority',n+'.js'),'utf8'),env);
 const r=await env.extIntegrityVerify(true,'full');console.log(JSON.stringify({ok:r.ok,count:r.verifiedFileCount,error:r.errorCode,path:r.failurePath,message:r.message}));return r;
}
(async()=>{assert.equal((await run(false)).verifiedFileCount,357);const r=await run(true);assert.equal(r.errorCode,'EXTENSION_INTEGRITY_FAILED');assert.equal(r.failurePath,'app/shared/core/theme-system.js')})().catch(e=>{console.error(e);process.exitCode=1});
