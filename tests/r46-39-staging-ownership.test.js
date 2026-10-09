'use strict';
const assert = require('node:assert/strict');
const {
 APPROVAL,PARTIAL_UNIQUE,configFrom,isDup,fixtureName,checkSyntheticName,runWithClient
}=require('../tools/r46-39-staging-ownership');
const clone=x=>structuredClone(x);
function failDuplicate() { const e=Error('duplicate');e.code=11000;throw e; }
class FakeCollection {
 constructor(state) {this.state=state;}
 async insertOne(doc, opts) {
   if(opts?.session && this.state.mode === 'reserve' && [...(this.state.reserveSnapshot || [])].some(([,v])=>v.keyCode===doc.keyCode)) failDuplicate();
   if(this.state.docs.has(doc._id)) failDuplicate();
   if(typeof doc.keyCode==='string' && doc.keyCode>'') {
     for(const val of this.state.docs.values())if(val.keyCode===doc.keyCode)failDuplicate();
   }
   this.state.docs.set(doc._id,clone(doc));return {acknowledged:true};
 }
 async updateOne(q,patch) {
   const doc=this.state.docs.get(q._id);if(!doc)return {matchedCount:0};
   let next=clone(doc);
   for(const k of Object.keys(patch.$unset||{}))delete next[k];
   Object.assign(next,patch.$set||{});
   if(typeof next.keyCode==='string' && next.keyCode>'')for(const [id,v] of this.state.docs){
     if(id!==q._id && v.keyCode===next.keyCode)failDuplicate();
   }
   this.state.docs.set(q._id,next);return {matchedCount:1};
 }
 async countDocuments(q) {
   let rows=[...this.state.docs.values()];
   if(Object.hasOwn(q,'_id'))rows=rows.filter(d=>d._id===q._id);
   if(Object.hasOwn(q,'keyCode'))rows=rows.filter(d=>q.keyCode===null ? !Object.hasOwn(d,'keyCode')||d.keyCode===null : d.keyCode===q.keyCode);
   return rows.length;
 }
 async createIndex(k,o){this.state.indexes.push({key:k,...o});return o.name;}
 listIndexes(){return {toArray:async()=>clone(this.state.indexes)}};
 async drop(){this.state.dropped=true;this.state.docs.clear()}
}
function fakeClient(mode = 'reserve') {
 const state={docs:new Map(),indexes:[{name:'_id_',key:{_id:1},unique:true}],dropped:false,mode};
 const coll=new FakeCollection(state);
 const db={collection(name){assert.ok(checkSyntheticName(name));return coll;},async createCollection(name){assert.ok(checkSyntheticName(name));state.created=true;},listCollections(){return{toArray:async()=>state.dropped?[]:[{name:'still_present'}]}}};
 const client={db(name){assert.match(name,/^zvm_r4639_stage_/);return db},startSession(){return {
   async withTransaction(fn){const snapshot=clone([...state.docs.entries()]);state.reserveSnapshot=snapshot;try{await fn();}catch(err){state.docs=new Map(snapshot);throw err}finally{state.reserveSnapshot=null}},
   async endSession(){} }}};
 return {state,client};
}
(async()=>{
 let n=0;
 const valid={ZVM_R4639_STAGING_APPROVAL:APPROVAL,ZVM_R4639_STAGING_DB:'zvm_r4639_stage_deadbeef',ZVM_R4639_STAGING_URI:'mongodb://127.0.0.1:27017'};
 assert.equal(configFrom(valid,['--isolated-staging']).local,true);n++;
 for(const args of [[],['--audit'],['--isolated-staging','extra']]){assert.throws(()=>configFrom(valid,args));n++}
 for(const bad of [{ZVM_R4639_STAGING_APPROVAL:''},{ZVM_R4639_STAGING_DB:'zapvoice'},{ZVM_R4639_STAGING_DB:'zvm_r4639_stage_a'},{ZVM_R4639_STAGING_URI:'https://example.invalid'}]){assert.throws(()=>configFrom({...valid,...bad},['--isolated-staging']));n++}
 assert.throws(()=>configFrom({...valid,ZVM_R4639_STAGING_URI:'mongodb+srv://prod.example.invalid'},['--isolated-staging']));n++;
 assert.throws(()=>configFrom({...valid,ZVM_R4639_STAGING_URI:'mongodb+srv://staging.example.invalid'},['--isolated-staging']));n++;
 const remote={...valid,ZVM_R4639_STAGING_URI:'mongodb+srv://staging.example.invalid',ZVM_R4639_REMOTE_STAGING_APPROVED:'YES'};
 assert.equal(configFrom(remote,['--isolated-staging']).local,false);n++;
 assert.equal(isDup({code:11000}),true);assert.equal(isDup({code:11001}),false);n++;
 const a=fixtureName(),b=fixtureName();assert.notEqual(a,b);assert.ok(checkSyntheticName(a));n++;
 for(const path of ['portal_users','payments','zvm_r4639_fixture_guess','zvm_r4639_fixture_zzzzzzzzzzzzzzzzzzzzzzzz']){assert.equal(checkSyntheticName(path),false);n++}
 assert.equal(PARTIAL_UNIQUE.unique,true);assert.ok(PARTIAL_UNIQUE.partialFilterExpression.keyCode.$gt==='');n++;
 const {state,client}=fakeClient('reserve');
 const result=await runWithClient(client,{name:valid.ZVM_R4639_STAGING_DB});
 assert.equal(result.productionCertified,false);assert.equal(result.transactionTransfer,'duplicate_key');n++;
 assert.equal(result.tested,20);assert.equal(result.checks.length,20);n++;
 assert.equal(state.dropped,true);assert.equal(state.docs.size,0);n++;
 assert.equal(state.created,true);assert.ok(state.indexes.some(x=>x.unique&&x.name==='r4639_unique_key_synthetic'));n++;
 assert.ok(result.checks.includes('rollback_keeps_owner'));n++;
 const permissive=fakeClient('release'); const possible=await runWithClient(permissive.client,{name:valid.ZVM_R4639_STAGING_DB});
 assert.equal(possible.transactionTransfer,'committed');assert.equal(possible.tested,20);assert.equal(permissive.state.dropped,true);n++;
 console.log('R46.39 isolated Mongo staging fixture: PASS '+n+' guard groups; '+result.tested+' scenario checks; no external DB');
})().catch(e=>{console.error(e);process.exitCode=1});
