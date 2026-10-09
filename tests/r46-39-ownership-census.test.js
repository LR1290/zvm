'use strict';
const assert=require('node:assert/strict');
const {audit,pipeline}=require('../tools/r46-39-ownership-census');
(async()=>{
 let writes=0,collName,options;
 const rows=[{_id:'a-secret-license',owners:2},{_id:'b-secret-license',owners:3}];
 const db={collection(n){collName=n;return{
  aggregate(q,opts){assert.deepEqual(q,pipeline);options=opts;return {async toArray(){return rows}}},
  insertOne(){writes++;throw Error('write forbidden')},updateOne(){writes++;throw Error('write forbidden')}
 }}};
 const r=await audit(db);
 assert.notEqual(r.duplicates[0].keyHash,require('node:crypto').createHash('sha256').update(rows[0]._id).digest('hex').slice(0,12),'unsalted IDs must not be exposed');
 assert.equal(collName,'portal_users');assert.equal(writes,0);
 assert.equal(options.allowDiskUse,false);assert.equal(options.maxTimeMS,8000);
 assert.equal(r.duplicateGroups,2);assert.equal(r.duplicates[0].holders,2);
 assert.match(r.duplicates[0].keyHash,/^[a-f0-9]{12}$/);
 assert.ok(!JSON.stringify(r).includes('a-secret-license'));
 assert.ok(!JSON.stringify(r).includes('b-secret-license'));
 assert.equal(r.complete,true);
 console.log('R46.39 ownership census mocked Mongo read-only PASS / 8 checks');
})().catch(e=>{console.error(e);process.exitCode=1});
