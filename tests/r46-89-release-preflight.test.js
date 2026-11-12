'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {preflight,STORE_ID}=require('../tools/check-release-admission');
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zvm-gate-'));
 const source='1'.repeat(64),fp='2'.repeat(64),version='0.9.99';
 const buildId='zvm-production-'+version+'-s'+source.slice(0,12);
 const identity={schema:1,buildId,channel:'production',profile:'release',extensionVersion:version,
  securityProtocol:2,sourceTreeSha256:source,sourceRevision:null,createdAt:'2026-10-17T00:00:00.000Z'};
 const registry={schema:2,builds:[{buildId,channel:'production',profile:'release',extensionVersion:version,
  securityProtocol:2,sourceTreeSha256:source,sourceRevision:null,createdAt:identity.createdAt,
  buildFingerprint:fp,extensionIds:[STORE_ID],status:'active'}]};
 const write=(rel,data)=>{const p=path.join(dir,'pkg',rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(data));};
 write('manifest.json',{version});write('app/security/build-identity.json',identity);
 write('app/security/integrity.json',{extensionVersion:version,buildFingerprint:fp});
 const reg=path.join(dir,'registry.json');
 const save=()=>fs.writeFileSync(reg,JSON.stringify(registry));save();
 return {dir,artifact:path.join(dir,'pkg'),reg,registry,identity,write,save,close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
function withFixture(fn){const f=fixture();try{return fn(f)}finally{f.close()}}
test('admite apenas RELEASE com registro ativo e identidade exata',()=>withFixture(f=>{
 assert.equal(preflight({artifact:f.artifact,registry:f.reg}).buildId,f.identity.buildId);
}));
test('bloqueia build RELEASE nao registrada (incidente 0.9.49)',()=>withFixture(f=>{
 f.registry.builds=[];f.save();
 assert.throws(()=>preflight({artifact:f.artifact,registry:f.reg}),{code:'BUILD_ID_NOT_ALLOWED'});
}));
test('nao ativa builds revogadas',()=>withFixture(f=>{
 f.registry.builds[0].status='revoked';f.save();
 assert.throws(()=>preflight({artifact:f.artifact,registry:f.reg}),{code:'BUILD_REVOKED'});
}));
test('fingerprint divergente bloqueado mesmo com CWS_COMPAT',()=>withFixture(f=>{
 const old=process.env.ZVM_CWS_COMPAT;process.env.ZVM_CWS_COMPAT='1';
 try{f.registry.builds[0].buildFingerprint='a'.repeat(64);f.save();
  assert.throws(()=>preflight({artifact:f.artifact,registry:f.reg}),{code:'FINGERPRINT_MISMATCH'});}
 finally{if(old===undefined)delete process.env.ZVM_CWS_COMPAT;else process.env.ZVM_CWS_COMPAT=old;}
}));
test('rejeita canal DEV e loja nao oficial',()=>withFixture(f=>{
 f.identity.channel='dev';f.write('app/security/build-identity.json',f.identity);
 assert.throws(()=>preflight({artifact:f.artifact,registry:f.reg}),{code:'PROFILE_MISMATCH'});
 f.identity.channel='production';f.write('app/security/build-identity.json',f.identity);
 f.registry.builds[0].extensionIds=['a'.repeat(32)];f.save();
 assert.throws(()=>preflight({artifact:f.artifact,registry:f.reg}),{code:'STORE_ID_MISMATCH'});
}));
test('rejeita divergencia de versao entre artefatos',()=>withFixture(f=>{
 f.write('manifest.json',{version:'0.9.98'});
 assert.throws(()=>preflight({artifact:f.artifact,registry:f.reg}),{code:'VERSION_MISMATCH'});
}));
test('rejeita sourceTreeSha256 diferente mesmo com build ID igual',()=>withFixture(f=>{
 f.registry.builds[0].sourceTreeSha256='a'.repeat(64);f.save();
 assert.throws(()=>preflight({artifact:f.artifact,registry:f.reg}),{code:'BUILD_MISMATCH'});
}));
