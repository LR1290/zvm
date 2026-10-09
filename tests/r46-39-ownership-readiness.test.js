'use strict';
const assert=require('node:assert/strict');
const {inspect,describeIndex}=require('../tools/r46-39-ownership-readiness');
function makeDB({owners=[],indexes=[],active=0,bound=0,fail=null}={}){
 const calls=[];
 const coll={
  aggregate(pipeline,opts){calls.push('aggregate');assert.ok(opts.maxTimeMS<=8000);return{async toArray(){if(fail==='aggregate')throw Error('mongo_down');return owners}}},
  listIndexes(){calls.push('listIndexes');return{async toArray(){if(fail==='indexes')throw Error('index_error');return indexes}}},
  async countDocuments(filter){calls.push('countDocuments');return filter.emailChangeOp?active:bound},
  // If the implementation tries mutating, make the test fail deterministically.
  insertOne(){throw Error('UNEXPECTED_WRITE')},updateOne(){throw Error('UNEXPECTED_WRITE')},createIndex(){throw Error('UNEXPECTED_WRITE')},deleteOne(){throw Error('UNEXPECTED_WRITE')},dropIndex(){throw Error('UNEXPECTED_WRITE')},
 };
 return {db:{collection(name){assert.equal(name,'portal_users');return coll}},calls};
}
(async()=>{
 let checks=0;
 const legacy=[{name:'_id_',key:{_id:1},unique:true},{name:'keyCode_1',key:{keyCode:1}}];
 const sample=makeDB({indexes:legacy,bound:5});
 const a=await inspect(sample.db);
 assert.equal(a.safeToDeploy,false);assert.equal(a.boundAccounts,5);assert.equal(a.duplicateGroupCount,0);
 assert.equal(a.bindingIndexUniquePartial,false);assert.equal(a.indexNameCollision,true);
 assert.deepEqual(a.migrationBlockers,['unique_partial_index_missing']);checks++;
 const bad=makeDB({owners:[{_id:'SUPERSECRET-A',owners:3},{_id:'SUPERSECRET-B',owners:2}],indexes:legacy,active:1,bound:6});
 const b=await inspect(bad.db);
 assert.equal(b.duplicateGroupCount,2);assert.equal(b.largestOwnerGroup,3);
 assert.deepEqual(b.migrationBlockers,['duplicate_bindings','email_change_in_progress','unique_partial_index_missing']);
 assert.doesNotMatch(JSON.stringify(b),/SUPERSECRET/);checks++;
 const cap=makeDB({owners:Array.from({length:50},(_,i)=>({_id:'secret'+i,owners:2}))});
 const c=await inspect(cap.db);assert.equal(c.duplicateGroupListTruncated,true);
 assert.ok(c.migrationBlockers.includes('duplicate_scan_truncated'));checks++;
 const uniq=[{name:'keyCode_unique_present',key:{keyCode:1},unique:true,partialFilterExpression:{keyCode:{$type:'string',$gt:''}}}];
 const healthy=await inspect(makeDB({indexes:uniq,bound:2}).db);
 assert.equal(healthy.bindingIndexUniquePartial,true);assert.equal(healthy.migrationBlockers.length,0);
 assert.equal(healthy.safeToDeploy,false,'other Mongo transaction+Chromium gates remain');checks++;
 assert.deepEqual(describeIndex({key:{email:1},name:'email_1'}),null);checks++;
 assert.equal(describeIndex({key:{keyCode:1},unique:true}).partial,false);checks++;
 assert.equal(describeIndex({key:{keyCode:1},unique:true,partialFilterExpression:{keyCode:{$type:'string',$gt:''}}}).partialExcludesEmpty,true);checks++;
 assert.equal(describeIndex({key:{keyCode:1},unique:true,partialFilterExpression:{other:{$gt:''},keyCode:{$exists:true}}}).partialExcludesEmpty,false);checks++;
 assert.equal(describeIndex({key:{keyCode:1},unique:true,partialFilterExpression:{keyCode:{$gt:''}}}).partialExcludesEmpty,false);checks++;
 for(const where of ['aggregate','indexes']){
   await assert.rejects(()=>inspect(makeDB({indexes:legacy,fail:where}).db));checks++;
 }
 const response=await inspect(makeDB({indexes:legacy}).db);
 assert.equal(response.ownerIndexes[0].unique,false);checks++;
 assert.equal(a.scanned,true);checks++;
 assert.ok(sample.calls.includes('listIndexes'));checks++;
 console.log(`R46.39 ownership index/readiness read-only PASS / ${checks} groups, zero writes`);
})().catch(err=>{console.error(err);process.exitCode=1});
