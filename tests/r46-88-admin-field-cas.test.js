'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const server = fs.readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
const start = server.indexOf('async function mutateAdminKeyRecordStrict(');
const end = server.indexOf('\nfunction sendAdminKeyPersistFailure(', start);
assert(start >= 0 && end > start, 'admin helper found');
const source = server.slice(start, end);
const clone=x=>JSON.parse(JSON.stringify(x));
const factory=new Function('getMongoDb','readAdminKeySnapshot','cloneKeyRecordForCommit','zvmInvalidateMongoOnNetworkError','keys','invalidateKeysHtmlCache',source+'\nreturn mutateAdminKeyRecordStrict;');
let passes=0;
function harness({ concurrent, network, initial={}, conflictEveryTime=false }={}) {
 const state={current:{label:'old',lastUsed:'before',phones:['one','two'],modules:{x:true,y:true},active:true,maxUses:3,updatedAt:new Date('2026-10-01T00:00:00.000Z'),...initial},writes:0,reads:0,invalidations:0,notifies:0};
 function get(path){return path.split('.').slice(2).reduce((o,p)=>o?.[p],state.current)}
 function set(path,value,del){const bits=path.split('.').slice(2);let o=state.current;for(const p of bits.slice(0,-1))o=o[p]??={};if(del)delete o[bits.at(-1)];else o[bits.at(-1)]=clone(value)}
 const db={collection(table){assert.equal(table,'store');return {async findOneAndUpdate(filter,update,opts){
   state.writes++;assert.equal(opts.maxTimeMS,7000);assert.equal(opts.returnDocument,'after');
   assert.equal(opts.projection['data.license'],1);assert.equal(filter['data.license'].$type,'object');
   assert.equal(update.$set['data.license'],undefined,'must never replace whole license');
   if(concurrent&&state.writes===1)concurrent(state.current);
   if(conflictEveryTime)return null;
   for(const [k,v] of Object.entries(filter)){
    if(k==='_id'||k==='data.license')continue;
    const actual=get(k);
    if(v&&typeof v==='object'&&v.$exists===false){if(actual!==undefined)return null;}
    else if(JSON.stringify(actual)!==JSON.stringify(v))return null;
   }
   for(const [k,v] of Object.entries(update.$set))if(k!=='updatedAt')set(k,v,false);
   for(const k of Object.keys(update.$unset||{}))set(k,null,true);
   if(network)throw new Error('ambiguous network result');
   return {data:{license:clone(state.current)}};
 }};}};
 const keys={};const fn=factory(async()=>db,async()=>{state.reads++;return clone(state.current)},clone,()=>{state.invalidations++;return true},keys,()=>state.notifies++);
 return {state,run:(change)=>fn('license',change,{db}),keys};
}
(async()=>{
 {const h=harness();const x=await h.run(d=>d.label='new');assert.equal(x.label,'new');assert.equal(h.state.writes,1);assert(h.state.current.updatedAt instanceof Date);passes++;}
 {const h=harness({concurrent:r=>r.lastUsed='login'});await h.run(d=>d.label='new');assert.equal(h.state.current.lastUsed,'login');assert.equal(h.state.writes,1);passes++;}
 {const h=harness({concurrent:r=>r.label='other'});await h.run(d=>d.label='new');assert.equal(h.state.writes,2);assert.equal(h.state.current.label,'new');passes++;}
 {const h=harness({concurrent:r=>r.modules.y=false});await h.run(d=>d.modules.x=false);assert.deepEqual(h.state.current.modules,{x:false,y:false});assert.equal(h.state.writes,1);passes++;}
 {const h=harness({concurrent:r=>{r.lastUsed='login';r.maxUses=10;}});await h.run(d=>d.phones=['one']);assert.equal(h.state.current.lastUsed,'login');assert.equal(h.state.current.maxUses,10);assert.deepEqual(h.state.current.phones,['one']);passes++;}
 {const h=harness({concurrent:r=>r.phones=['one','two','three']});await h.run(d=>{d.phones=d.phones.filter(x=>x!=='two')});assert.deepEqual(h.state.current.phones,['one','three']);assert.equal(h.state.writes,2);passes++;}
 {const h=harness({conflictEveryTime:true});await assert.rejects(h.run(d=>d.label='new'),e=>e.code==='key_write_conflict');assert.equal(h.state.writes,5);passes++;}
 {const h=harness({network:true});await assert.rejects(h.run(d=>d.label='new'),/ambiguous network/);assert.equal(h.state.writes,1);passes++;}
 {const h=harness();await h.run(d=>d.maxUses=3);assert.equal(h.state.writes,0);passes++;}
 {const h=harness({initial:{modules:null}});await h.run(d=>{d.modules={x:false}});assert.deepEqual(h.state.current.modules,{x:false});passes++;}
 {const h=harness();await h.run(d=>{delete d.maxUses});assert.equal(h.state.current.maxUses,undefined);passes++;}
 {const h=harness({concurrent:r=>r.active=false});await h.run(d=>d.label='new');assert.equal(h.state.current.active,false);passes++;}
 console.log('R46.88 PASS '+passes+' independent scenarios');
})().catch(e=>{console.error(e);process.exitCode=1});
