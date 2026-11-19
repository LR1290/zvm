'use strict';
const assert = require('node:assert/strict');
const M = require('../tools/zvm-mongodb-migrate');

// R86: integration harness exercises copyDatabase against two independent mock DBs.
// It never contacts MongoDB, never touches real user keys, and does not fake its outcomes.
const EJSON = {serialize:doc=>JSON.parse(JSON.stringify(doc))};
const flags = {
  ZVM_MONGO_MIGRATION_ACK:M.COPY_ACK,
  ZVM_MONGO_WRITERS_PAUSED:M.PAUSE_ACK,
};
function clone(x) {return JSON.parse(JSON.stringify(x));}
function makeClient({corruptOutput=false, failAfterOutput=false, mutateBothAfterOut=false}={}) {
  const initial = {
    store:[{_id:'keys',data:{'zv-abcde-12345-abcde':{active:true,expiresAt:'2030-01-01'}}}],
    payments:[{_id:'tx-1',approved:true,amount:14990}],
    portal_users:[{_id:'synthetic@example.invalid',keyCode:'zv-abcde-12345-abcde'}],
    extension_sessions:[{_id:'session-1',subject:{type:'license',id:'sha256-placeholder'}}],
  };
  function mkDb(dbName, prepopulate={}) {
    const items = new Map();
    for (const [name, docs] of Object.entries(prepopulate)) {
      items.set(name,{
        rows:clone(docs),
        indexes:[{name:'_id_',key:{_id:1}},...(name==='payments'?[{name:'txId_1',key:{_id:1},unique:true}]:[])],
        options:{}
      });
    }
    const db={
      name:dbName,items,
      listCollections(){return {toArray:async()=>[...items.keys()].map(name=>({name,type:'collection',options:{}}))};},
      async createCollection(name,options) {
        if(items.has(name))throw Error('already_exists');
        items.set(name,{rows:[],indexes:[{name:'_id_',key:{_id:1}}],options:clone(options)});
        return db.collection(name);
      },
      collection(name) {
        if(!items.has(name))throw Error('collection_missing:'+name);
        const item=items.get(name);
        return {
          countDocuments:async()=>item.rows.length,
          listIndexes(){return {toArray:async()=>clone(item.indexes)};},
          async createIndexes(specs){item.indexes.push(...clone(specs));},
          find(){return {async *[Symbol.asyncIterator]() {
            for(const doc of [...item.rows].sort((a,b)=>String(a._id).localeCompare(String(b._id)))) yield clone(doc);
          }};},
          aggregate(pipeline) {
            assert.equal(pipeline.length,1,'single $out stage');
            const out=pipeline[0].$out;
            assert.equal(out.db,'zvm');
            assert.equal(out.coll,name);
            return {async toArray(){
              const destination=client.db(out.db).items.get(out.coll);
              if(!destination)throw Error('destination_missing');
              destination.rows=clone(item.rows);
              if(mutateBothAfterOut && name==='store') {
                // An external writer touched BOTH stores after copy: equality alone
                // would pass, but the origin's initial checksum must reject it.
                const legacy='zv-abcde-12345-abcde';
                item.rows[0].data[legacy].active=false;
                destination.rows[0].data[legacy].active=false;
              }
              if(corruptOutput && name==='payments')destination.rows[0].amount++;
              if(failAfterOutput && name==='payments')throw Error('connection lost after server-side $out');
              return [];
            }};
          }
        };
      },
    };
    return db;
  }
  const origin=mkDb('zapvoice',initial);
  const target=mkDb('zvm');
  const client={db:name=>({zapvoice:origin,zvm:target})[name]};
  return {client,origin,target};
}
(async()=>{
  let checks=0;
  const {client,origin,target}=makeClient();
  const before=await M.describe(origin);
  assert.equal(before.length,4);checks++;
  assert.equal((await M.describe(target)).length,0);checks++;
  const result=await M.copyDatabase(client,EJSON,flags);
  assert.equal(result.verified,true);checks++;
  assert.equal(result.sourceStable,true,'double-source snapshot stable');checks++;
  assert.equal(result.collections,4);checks++;
  assert.equal(result.documents,4);checks++;
  assert.equal(result.indexes,5);checks++;
  assert.equal((await M.describe(origin)).length,4,'source retained');checks++;
  assert.equal(target.items.get('payments').indexes.length,2,'unique index preserved');checks++;
  assert.deepEqual(target.items.get('store').rows,origin.items.get('store').rows,'key content preserved');checks++;
  assert.deepEqual(target.items.get('extension_sessions').rows,origin.items.get('extension_sessions').rows,'sessions preserved');checks++;
  await assert.rejects(M.copyDatabase(client,EJSON,flags),/target_not_empty_manual_review_required/);checks++;
  await assert.rejects(M.copyDatabase(client,EJSON,{}),/migration_requires_explicit_ack/);checks++;
  // If the copy finished server-side but transport failed, never silently retry or drop target.
  const t=makeClient({failAfterOutput:true});
  await assert.rejects(M.copyDatabase(t.client,EJSON,flags),/connection lost/);checks++;
  assert.equal(t.target.items.get('payments').rows.length,1,'outcome remains inspectable after network failure');checks++;
  await assert.rejects(M.copyDatabase(t.client,EJSON,flags),/target_not_empty_manual_review_required/);checks++;
  const c=makeClient({corruptOutput:true});
  await assert.rejects(M.copyDatabase(c.client,EJSON,flags),/database_mismatch:payments/);checks++;
  assert.equal(c.origin.items.get('payments').rows[0].amount,14990,'source untouched if output corrupt');checks++;
  const drifting=makeClient({mutateBothAfterOut:true});
  await assert.rejects(M.copyDatabase(drifting.client,EJSON,flags),/source_changed_during_migration/);checks++;
  assert.equal(drifting.origin.items.get('store').rows[0].data['zv-abcde-12345-abcde'].active,false);checks++;
  console.log('R86 MongoDB cross-DB copy PASS: '+checks+' synthetic controls');
})().catch(error=>{console.error(error);process.exitCode=1});
