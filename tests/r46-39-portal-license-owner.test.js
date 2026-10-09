'use strict';
const assert=require('node:assert/strict');
const owner=require('../src/portal-license-owner');
const clone=value=>structuredClone(value);
const index={name:'staging_only',key:{keyCode:1},unique:true,partialFilterExpression:{keyCode:{$type:'string',$gt:''}}};
function clash(){throw Object.assign(new Error('synthetic_duplicate'),{code:11000});}
function model({unique=true,commit=true}={}){
 const state={rows:new Map(),writes:0};
 const docMatch=(row,q)=>Object.entries(q).every(([k,v])=>k==='emailChangeOp' && v?.$exists===false?!Object.hasOwn(row,k):row[k]===v);
 const col={
  listIndexes:()=>({toArray:async()=>unique?[index]:[{name:'keyCode_1',key:{keyCode:1}}]}),
  async findOne(q){const r=state.rows.get(q._id);return r&&docMatch(r,q)?clone(r):null;},
  async insertOne(row){
   if(state.rows.has(row._id))clash();
   if(row.keyCode)for(const v of state.rows.values())if(v.keyCode===row.keyCode)clash();
   state.rows.set(row._id,clone(row));state.writes++;return {insertedId:row._id};
  },
  async updateOne(q,patch){
   const r=state.rows.get(q._id);if(!r||!docMatch(r,q))return {matchedCount:0};
   const next=clone(r);Object.assign(next,patch.$set||{});
   for(const k of Object.keys(patch.$unset||{}))delete next[k];
   if(next.keyCode)for(const [id,v] of state.rows)if(id!==q._id&&v.keyCode===next.keyCode)clash();
   state.rows.set(q._id,next);state.writes++;return {matchedCount:1};
  },
  async deleteOne(q){const r=state.rows.get(q._id);if(!r||!docMatch(r,q))return {deletedCount:0};state.rows.delete(q._id);state.writes++;return {deletedCount:1};}
 };
 const db={collection(name){assert.equal(name,'portal_users');return col}};
 const session={async withTransaction(fn){
  const backup=clone([...state.rows]),oldWrites=state.writes;
  try{await fn();if(!commit)clash();}catch(e){state.rows=new Map(backup);state.writes=oldWrites;throw e;}
 }};
 return {db,session,state};
}
(async()=>{
 let checks=0;
 assert.equal(owner.isOwnershipIndex(index),true);checks++;
 for(const extra of [
  {...index,unique:false},
  {...index,key:{keyCode:1,email:1}},
  {...index,partialFilterExpression:{keyCode:{$gt:''}}},
  {...index,partialFilterExpression:{$and:[{keyCode:{$gt:'',$type:'string'}},{status:'paid'}]}},
  {...index,collation:{locale:'en',strength:2}}
 ]){assert.equal(owner.isOwnershipIndex(extra),false);checks++;}
 const noIndex=model({unique:false});
 await assert.rejects(()=>owner.bind(noIndex.db,'a@example.invalid','aaaa'),{code:'ownership_index_not_ready'});
 assert.equal(noIndex.state.writes,0);checks++;
 const m=model();await owner.requireOwnershipIndex(m.db);checks++;
 for(const id of ['a','b','c'])await owner.register(m.db,{_id:id+'@example.invalid',email:id+'@example.invalid',keyCode:null});checks++;
 const writes=await Promise.allSettled([
  owner.bind(m.db,'a@example.invalid','license-a'),
  owner.bind(m.db,'b@example.invalid','license-a')
 ]);
 assert.equal(writes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(writes.filter(x=>x.reason?.code==='license_already_linked').length,1);checks++;
 assert.equal([...m.state.rows.values()].filter(v=>v.keyCode==='license-a').length,1);checks++;
 await assert.rejects(()=>owner.register(m.db,{_id:'d@example.invalid',email:'d@example.invalid',keyCode:'license-a'}),{code:'account_or_license_already_used'});checks++;
 const holder=[...m.state.rows.values()].find(v=>v.keyCode==='license-a')._id;
 await owner.unbind(m.db,holder,'license-a');checks++;
 await owner.bind(m.db,'c@example.invalid','license-a');checks++;
 await assert.rejects(()=>owner.unbind(m.db,holder,'license-a'),{code:'binding_changed'});checks++;
 m.state.rows.get('c@example.invalid').emailChangeOp='inflight';
 await assert.rejects(()=>owner.bind(m.db,'c@example.invalid','license-b'),{code:'account_unavailable'});checks++;
 delete m.state.rows.get('c@example.invalid').emailChangeOp;
 await owner.transferEmail(m.db,m.session,'c@example.invalid','changed@example.invalid',(r,to)=>({...r,_id:to,email:to}));
 assert.equal(m.state.rows.has('c@example.invalid'),false);
 assert.equal(m.state.rows.get('changed@example.invalid').keyCode,'license-a');checks++;
 const fail=model({commit:false});
 await owner.register(fail.db,{_id:'before@example.invalid',email:'before@example.invalid',keyCode:'license-b'});
 await assert.rejects(()=>owner.transferEmail(fail.db,fail.session,'before@example.invalid','after@example.invalid',(r,to)=>({...r,_id:to,email:to})),{code:11000});
 assert.equal(fail.state.rows.get('before@example.invalid').keyCode,'license-b');
 assert.equal(fail.state.rows.has('after@example.invalid'),false);checks++;
 await assert.rejects(()=>owner.transferEmail(m.db,null,'changed@example.invalid','new@example.invalid',()=>({})),{code:'transactions_required'});checks++;
 await assert.rejects(()=>owner.bind(m.db,'missing@example.invalid','license-c'),{code:'account_unavailable'});checks++;
 await assert.rejects(()=>owner.transferEmail(m.db,m.session,'changed@example.invalid','bad@example.invalid',()=>({email:'bad@example.invalid',_id:'bad@example.invalid',keyCode:'wrong'})),{code:'unsafe_email_move'});checks++;
 console.log('R46.39 ownership contract staged: PASS '+checks+' groups; fake DB only');
})().catch(e=>{console.error(e);process.exitCode=1});
