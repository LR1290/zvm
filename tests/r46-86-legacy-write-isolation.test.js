'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function region(a,b) { const x=source.indexOf(a), y=source.indexOf(b,x+a.length);assert(x>=0&&y>x,'region '+a);return source.slice(x,y); }
const operational=region('async function _writeKeyToDb(code, deps = {}) {','\n// Compatibilidade histórica:');
const portal=region("  if (p === '/cliente/dispositivos/remover'","  if (p === '/cliente/email')");
const clone=o=>o===null||o===undefined?o:JSON.parse(JSON.stringify(o));
function harness(sourceRecord,storedRecord) {
 const cached={license:clone(sourceRecord)};
 const persisted={record:storedRecord ? clone(storedRecord) : null, operations:[]};
 function match(filter){if(!persisted.record)return false;
   for(const [p,v] of Object.entries(filter)){
    if(p==='_id')continue;
    if(p==='data.license') { if(!(v&&v.$exists===true)) return false;continue; }
    if(p==='data.license.expiresAt' && persisted.record.expiresAt!==v)return false;
   }
   return true;
 }
 const db={collection(name){assert.equal(name,'store');return { async updateOne(filter,update,options) {
   assert.equal(options.timeoutMS,7000);assert.equal(options.upsert,undefined,'must not upsert');
   persisted.operations.push({filter,update});
   if(!match(filter))return {matchedCount:0,modifiedCount:0};
   for(const [field,value] of Object.entries(update.$set)) {
     if(field==='updatedAt')continue;
     assert(field.startsWith('data.license.'),'must NEVER replace whole license record: '+field);
     const key=field.slice('data.license.'.length);
     persisted.record[key]=clone(value);
   }
   return {matchedCount:1,modifiedCount:1};
 }}}};
 const fn=new Function('keys','getMongoDb','cloneKeyRecordForCommit','console',operational+'\nreturn _writeKeyToDb;')(
  cached,async()=>db,clone,{error:(...v)=>{throw Error(v.join(' '))}});
 return {write:()=>fn('license'),persisted,cached};
}
(async()=>{
 const expiry='2026-10-18T17:14:03.000Z';
 const old={label:'Atendimento Pós',planId:'pro',maxUses:3,phones:['phone-A'],active:true,expiresAt:expiry,lastUsed:'old',usageDate:'2026-10-16'};
 const current={...old,expiresAt:'2026-11-18T17:14:03.000Z',maxUses:5,phones:['phone-A','phone-B'],label:'Atendimento Pós - atualizado',active:false,warnEmailSent:false};
 const h=harness({...old,lastUsed:'new login',lastIp:'local-only',warnEmailSent:true,usage:{message:{sent:3,max:20}}},current);
 await h.write();
 assert.equal(h.persisted.record.expiresAt,current.expiresAt,'stale writer must preserve renewal');
 assert.equal(h.persisted.record.active,false,'stale writer must preserve admin lock');
 assert.equal(h.persisted.record.label,current.label);
 assert.equal(h.persisted.record.maxUses,current.maxUses);
 assert.deepEqual(h.persisted.record.phones,current.phones,'stale writer must preserve device list');
 assert.equal(h.persisted.record.warnEmailSent,false,'old warning must not consume new cycle');
 assert.equal(h.persisted.record.lastUsed,'new login');
 assert.equal(h.persisted.record.usage.message.sent,3,'legacy usage data is still persisted');
 assert(!h.persisted.operations.some(o=>Object.hasOwn(o.update.$set,'data.license')),'no full replacement');
 const deleted=harness(old,null);await deleted.write();
 assert.equal(deleted.persisted.record,null,'deleted license must not be recreated');
 const expired=harness({...old,active:false,expiresAt:'2020-10-01T00:00:00.000Z'}, {...old,active:true,expiresAt:'2020-10-01T00:00:00.000Z'});
 await expired.write();assert.equal(expired.persisted.record.active,false,'same expiry should still persist expired state');
 const renewed=harness({...old,active:false,expiresAt:'2020-10-01T00:00:00.000Z'}, {...old,active:true,expiresAt:current.expiresAt});
 await renewed.write();assert.equal(renewed.persisted.record.active,true,'post-renewal status must not be reverted');
 assert.match(portal,/await mutateAdminKeyRecordStrict\(user.keyCode, draft =>/,'portal must commit through DB-CAS');
 assert.doesNotMatch(portal,/await _writeKeyToDbStrict\(/,'portal must not use stale full-key writer');
 assert.match(portal,/device_changed/,'concurrent removal requires safe retry');
 console.log('R46.86 PASS: renewal+admin protections, status and expiry, warnings, device changes, deletion, legacy usage');
})().catch(e=>{console.error(e);process.exitCode=1;});
