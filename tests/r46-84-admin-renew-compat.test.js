'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function between(a, b) {
  const i = source.indexOf(a), j = source.indexOf(b, i + a.length);
  assert(i >= 0 && j > i, 'source region: ' + a);
  return source.slice(i, j);
}
const clone = value => JSON.parse(JSON.stringify(value));
const functionText = between('async function mutateAdminKeyRecordStrict(', '\nfunction sendAdminKeyPersistFailure(');
// R46.87: renovação pertence ao helper atômico específico, testado em r46-87.\n// Aqui mantemos o contrato CAS das DEMAIS alterações administrativas.\nconst make = (store, overrides={}) => {
  const state={writes:0,reads:0,invalidations:0, cache:{},notified:0};
  const db={collection(name) {
    assert.equal(name,'store');
    return {async updateOne(filter, update, options) {
      state.writes++;
      assert.equal(options.timeoutMS,7000);
      assert.equal(filter._id,'keys');
      assert.ok(Object.hasOwn(filter,'data.license'));
      if(overrides.networkOnWrite) {
        if(overrides.applyBeforeNetworkError) store.current=clone(update.$set['data.license']);
        throw new Error('ambiguous network result');
      }
      if(overrides.forceConflict || (overrides.conflictOnce && state.writes===1)) {
        if(state.writes===1 && overrides.concurrentChange) Object.assign(store.current, overrides.concurrentChange);
        return { matchedCount:0 };
      }
      if(JSON.stringify(filter['data.license']) !== JSON.stringify(store.current))
        return { matchedCount:0 };
      store.current=clone(update.$set['data.license']);
      return { matchedCount:1 };
    }};
  }};
  const factory=new Function('getMongoDb','readAdminKeySnapshot','cloneKeyRecordForCommit','zvmInvalidateMongoOnNetworkError','keys','invalidateKeysHtmlCache',
    functionText + '\nreturn mutateAdminKeyRecordStrict;');
  const mutate=factory(async()=>db, async()=>{state.reads++;return clone(store.current);},clone,()=>{state.invalidations++;return true;},state.cache,()=>state.notified++);
  return {state,mutate};
};
(async()=>{
  const existing={active:true,label:'Cliente',expiresAt:'2026-10-18T12:00:00.000Z',lastUsed:'before'};
  {
    const store={current:clone(existing)};
    const {state,mutate}=make(store,{conflictOnce:true,concurrentChange:{lastUsed:'just-logged-in'}});
    const done=await mutate('license',draft=>{draft.label='Atualizado';});
    assert.equal(state.writes,2,'safe retry only after unmatched CAS');
    assert.equal(store.current.lastUsed,'just-logged-in','concurrent telemetry is preserved');
    assert.equal(done.label,'Atualizado');
    assert.equal(state.notified,1);
  }
  {
    const store={current:clone(existing)};
    const expiryAfterOtherRenewal='2026-11-18T12:00:00.000Z';
    const {state,mutate}=make(store,{conflictOnce:true,concurrentChange:{expiresAt:expiryAfterOtherRenewal}});
    await mutate('license',draft=>{draft.note='Nova nota administrativa';});
    assert.equal(state.writes,2);
    assert.equal(store.current.expiresAt,expiryAfterOtherRenewal,'CAS preserves other renewal');\n    assert.equal(store.current.note,'Nova nota administrativa');
  }
  {
    const store={current:clone(existing)};
    const {state,mutate}=make(store,{forceConflict:true});
    await assert.rejects(mutate('license',draft=>{draft.note='Nova nota administrativa';}),e=>e.code==='key_write_conflict');
    assert.equal(state.writes,5,'bounded CAS retry');
    assert.equal(state.notified,0,'no cache update after all conflicts');
  }
  {
    const store={current:clone(existing)};
    const {state,mutate}=make(store,{networkOnWrite:true,applyBeforeNetworkError:true});
    await assert.rejects(mutate('license',draft=>{draft.note='Nova nota administrativa';}),/ambiguous network result/);
    assert.equal(state.writes,1,'must NOT repeat a possibly committed renewal');
    assert.equal(state.notified,0);
  }
  const rates=between('const RL_CONFIG = {','\nfunction checkRateLimit(');
  assert.match(rates,/legacy_v3_usage:\s*\{ max: 180/);
  assert.match(rates,/ext_key_v3:\s*\{ max: 60/);
  assert.match(rates,/ext_key_v4:\s*\{ max: 60/);
  const v3=between("  if (p === R_EXT+'/v3/usage'", "  if ([R_EXT+'/v3/usage'");
  assert.equal((v3.match(/checkRateLimit\(ip, 'legacy_v3_usage'\)/g)||[]).length,3);
  assert.doesNotMatch(v3,/checkRateLimit\(ip, 'api'\)/);
  const v4=between("  if (p === R_EXT+'/v4/session/key'", "  if (p === R_EXT+'/v3/key'");
  assert.match(v4,/ext_key_v4/);
  console.log('R46.84 PASS: CAS for nonrenewal changes, no ambiguous repeat, isolated V3 budgets, V4 preserved');
})().catch(e=>{console.error(e);process.exitCode=1;});
