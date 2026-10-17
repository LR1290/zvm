'use strict';
// ZVM: gate offline, fail closed, para o pacote EXATO que sera publicado.
// npm run gate:release -- --artifact <zip-ou-pasta>
// ZIP requer unzip (runner Linux/macOS). Pasta extraida funciona no Windows.
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const STORE_ID='bdhnikgcdccjabkmbfcakgjkkgdlmgja';
function refuse(code,reason){const e=new Error(reason);e.code=code;throw e;}
function jsonFromArtifact(artifact,rel){
  const abs=path.resolve(artifact);
  const content=fs.statSync(abs).isDirectory()
    ? fs.readFileSync(path.join(abs,rel),'utf8')
    : execFileSync('unzip',['-p',abs,rel],{encoding:'utf8',maxBuffer:12*1024*1024});
  try{return JSON.parse(content);}catch(_){refuse('ARTIFACT_INVALID','JSON invalido: '+rel);}
}
function preflight({artifact,registry}){
  if(!artifact||!registry)refuse('ARGS_REQUIRED','Informe --artifact e --registry');
  const manifest=jsonFromArtifact(artifact,'manifest.json');
  const identity=jsonFromArtifact(artifact,'app/security/build-identity.json');
  const integrity=jsonFromArtifact(artifact,'app/security/integrity.json');
  const raw=JSON.parse(fs.readFileSync(registry,'utf8'));
  if(raw.schema!==2||!Array.isArray(raw.builds))refuse('REGISTRY_INVALID','Registry V2 invalido');
  if(!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(String(identity.extensionVersion||'')))refuse('IDENTITY_INVALID','Versao invalida');
  for(const [key,value] of Object.entries({channel:'production',profile:'release',securityProtocol:2}))
    if(identity[key]!==value)refuse('PROFILE_MISMATCH',key+' deve ser '+value);
  if(manifest.version!==identity.extensionVersion||integrity.extensionVersion!==identity.extensionVersion)
    refuse('VERSION_MISMATCH','manifest/identity/integrity divergem');
  if(!/^[a-f0-9]{64}$/.test(String(integrity.buildFingerprint||'')))
    refuse('FINGERPRINT_INVALID','Fingerprint invalido');
  if(!/^[a-f0-9]{64}$/.test(String(identity.sourceTreeSha256||'')))
    refuse('SOURCE_INVALID','Hash de origem invalido');
  const expectedId='zvm-production-'+identity.extensionVersion+'-s'+identity.sourceTreeSha256.slice(0,12);
  if(identity.buildId!==expectedId)refuse('BUILD_ID_MISMATCH','ID diverge do hash da origem');
  const entries=raw.builds.filter(x=>x.buildId===identity.buildId);
  if(entries.length!==1)refuse('BUILD_ID_NOT_ALLOWED','Build ausente/duplicada no registry');
  const entry=entries[0];
  if(entry.status!=='active')refuse('BUILD_REVOKED','Build inativa/revogada');
  for(const key of ['buildId','channel','profile','extensionVersion','securityProtocol','sourceTreeSha256','sourceRevision','createdAt'])
    if(entry[key]!==identity[key])refuse('BUILD_MISMATCH','Registro diverge em '+key);
  if(entry.buildFingerprint!==integrity.buildFingerprint)
    refuse('FINGERPRINT_MISMATCH','Fingerprint do registro difere do ZIP');
  if(!Array.isArray(entry.extensionIds)||entry.extensionIds.length!==1||entry.extensionIds[0]!==STORE_ID)
    refuse('STORE_ID_MISMATCH','ID da loja nao e o oficial');
  // Nem ZVM_CWS_COMPAT nem uma licença valida podem abrir excecao aqui.
  return {buildId:identity.buildId,storeId:STORE_ID,registryEntries:raw.builds.length};
}
function args(argv){
 const x={};
 for(let i=0;i<argv.length;i++){
   if(!['--artifact','--registry'].includes(argv[i])||!argv[i+1]||argv[i+1].startsWith('--'))
     refuse('ARGS_INVALID','Argumento invalido: '+argv[i]);
   x[argv[i].slice(2)]=argv[++i];
 }
 x.registry=x.registry||path.join(__dirname,'..','zvm-build-registry-v2.json');
 return x;
}
if(require.main===module){
 try{
  const r=preflight(args(process.argv.slice(2)));
  console.log('GATE_OFFLINE_PASS '+r.buildId+' store='+r.storeId+' registryEntries='+r.registryEntries);
  console.log('PENDENTE: deploy LIVE da mesma revisao no Render e login QA com a RELEASE antes de publicar na CWS');
 }catch(error){console.error('GATE_BLOCKED '+(error.code||'UNEXPECTED')+': '+error.message);process.exitCode=1;}
}
module.exports={preflight,STORE_ID};
