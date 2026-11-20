'use strict';
// R110: rename PRODUCT LABELS in a safely extracted R109 extension source tree.
// Do this BEFORE recalculating sourceTree SHA256, manifest fingerprint and Ed25519 signature.
// Never run on a signed/installed extension directly. No key or network access.
const fs=require('node:fs');
const path=require('node:path');
const previous='ZVM - Automações';
const official='ZVM Automações';
const counts=Object.freeze({
  'THIRD_PARTY_NOTICES.txt':1,
  'app/background/authority/backup-authority.js':1,
  'app/dashboard/features/expansion/core.js':3,
  'app/dashboard/features/flows/runtime.js':1,
  'app/dashboard/features/personalization/runtime.js':1,
  'app/shared/core/backup-migration-core.js':1,
  'app/shared/core/ui-language.js':3,
  'app/sidebar/view.js':2,
  'manifest.json':1,
  'pages/dashboard/index.html':3,
  'pages/disparos/index.html':1,
  'pages/popup/index.html':4
});
function count(text,needle){return text.split(needle).length-1;}
function normalizeTree(dir,opts={}){
  const root=path.resolve(dir);
  const pending=[];
  for(const [rel,expected] of Object.entries(counts)){
    const target=path.join(root,rel);
    const before=fs.readFileSync(target,'utf8');
    if(count(before,previous)!==expected)throw Error('R110_BRAND_SOURCE_DRIFT:'+rel);
    let after=before.split(previous).join(official);
    if(rel==='app/shared/core/ui-language.js'){
      if(count(after,'ZVM - Automations active')!==1)throw Error('R110_EN_LOCALE_DRIFT');
      after=after.replace('ZVM - Automations active','ZVM Automações active');
    }
    if(rel==='manifest.json'){
      const old=JSON.parse(before), next=JSON.parse(after);
      if(old.version!=='0.9.305'||old.name!==previous||next.name!==official||
          old.key!==next.key||JSON.stringify(old.permissions)!==JSON.stringify(next.permissions)||
          JSON.stringify(old.host_permissions)!==JSON.stringify(next.host_permissions))
        throw Error('R110_MANIFEST_IDENTITY_DRIFT');
      if(!old.version_name?.includes('R109-QA-LOGIN-RECOVERY'))throw Error('R110_PREVIOUS_BUILD_NOT_R109');
      after=after.replace(old.version_name,'0.9.305-dev+R110-NOME-OFICIAL');
    }
    pending.push({rel,target,after});
  }
  const expectedSum=Object.values(counts).reduce((a,b)=>a+b,0);
  if(expectedSum!==22)throw Error('R110_OCCURRENCE_SCOPE_DRIFT');
  if(opts.dryRun!==true)for(const item of pending)fs.writeFileSync(item.target,item.after);
  return {name:official,changedFiles:pending.map(x=>x.rel),correctedOccurrences:expectedSum,
    enLocaleCorrections:1,requiresNewAttestation:true,readyForInstallation:false};
}
if(require.main===module){
  try{
    if(!process.argv[2])throw Error('Use: node r110-official-product-name.cjs EXTRACTED_R109_SOURCE_DIR [--dry-run]');
    process.stdout.write(JSON.stringify(normalizeTree(process.argv[2],{dryRun:process.argv.includes('--dry-run')}))+'\n');
  }catch(e){process.stderr.write(String(e.message||e)+'\n');process.exitCode=1;}
}
module.exports={normalizeTree,counts,previous,official};
