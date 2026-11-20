'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'),path=require('node:path');
const {normalizeTree,counts,previous,official}=require('./r110-official-product-name.cjs');
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zvm-r110-brand-'));
  for(const [rel,n] of Object.entries(counts)){
    const f=path.join(dir,rel);fs.mkdirSync(path.dirname(f),{recursive:true});
    let s=Array(n).fill(previous).join(' / ');
    if(rel==='manifest.json')s=JSON.stringify({manifest_version:3,name:previous,version:'0.9.305',
      version_name:'0.9.305-dev+R109-QA-LOGIN-RECOVERY',key:'synthetic-test-public-key',
      permissions:['storage'],host_permissions:['https://zvm-completa-qa-r104.onrender.com/*']});
    if(rel==='app/shared/core/ui-language.js')s+=' / ZVM - Automations active';
    fs.writeFileSync(f,s);
  }
  return dir;
}
test('corrects all visible labels and preserves MV3 identifier and permissions',()=>{
 const dir=fixture();
 try{
  const before=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  const result=normalizeTree(dir);
  assert.equal(result.name,official);assert.equal(result.changedFiles.length,12);
  assert.equal(result.correctedOccurrences,22);assert.equal(result.readyForInstallation,false);
  for(const rel of Object.keys(counts)){
    const text=fs.readFileSync(path.join(dir,rel),'utf8');
    assert(!text.includes(previous),rel);
  }
  const m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  assert.equal(m.name,official);assert.equal(m.key,before.key);assert.equal(m.version,before.version);
  assert.deepEqual(m.permissions,before.permissions);
  assert.deepEqual(m.host_permissions,before.host_permissions);
  assert.equal(m.version_name,'0.9.305-dev+R110-NOME-OFICIAL');
  const locale=fs.readFileSync(path.join(dir,'app/shared/core/ui-language.js'),'utf8');
  assert(!locale.includes('ZVM - Automations active'));
  assert(locale.includes('ZVM Automações active'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('detects unexpected branding drift before writing any files',()=>{
 const dir=fixture();
 try{
  const rel='app/sidebar/view.js';
  fs.writeFileSync(path.join(dir,rel),'different branding');
  const before=fs.readFileSync(path.join(dir,'manifest.json'),'utf8');
  assert.throws(()=>normalizeTree(dir),/R110_BRAND_SOURCE_DRIFT/);
  assert.equal(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'),before);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('dry-run performs no mutation',()=>{
 const dir=fixture();
 try{
  const before=fs.readFileSync(path.join(dir,'manifest.json'),'utf8');
  normalizeTree(dir,{dryRun:true});
  assert.equal(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'),before);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
