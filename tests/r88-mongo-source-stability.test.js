'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../tools/zvm-mongodb-migrate');
const EJSON={serialize:x=>JSON.parse(JSON.stringify(x))};
let checks=0;
const verify=(condition,msg)=>{assert.ok(condition,msg);checks++};
function dbFixture() {
  const items=new Map([
    ['store',{rows:[{_id:'keys',data:{'zv-abcde-12345-abcde':{status:'active',maxUses:3}}}],indexes:[{name:'_id_',key:{_id:1}}]}],
    ['payments',{rows:[{_id:42,amount:14990,paid:true}],indexes:[{name:'_id_',key:{_id:1}},{name:'payment_1',key:{amount:1},unique:false}],options:{validationLevel:'strict',validationAction:'error',validator:{amount:{$gte:0}}}}],
    ['portal_users',{rows:[{_id:'synthetic@example.invalid',keyCode:'zv-abcde-12345-abcde'}],indexes:[{name:'_id_',key:{_id:1}}]}]
  ]);
  return {items,
    listCollections(){return {toArray:async()=>[...items.keys()].map(name=>({name,type:'collection',options:items.get(name).options||{}}))};},
    collection(name) {
      const item=items.get(name);
      return {
        countDocuments:async()=>item.rows.length,
        listIndexes:()=>({toArray:async()=>item.indexes}),
        find:()=>({async *[Symbol.asyncIterator](){
          for(const row of [...item.rows].sort((a,b)=>String(a._id).localeCompare(String(b._id))))yield row;
        }})
      };
    }
  };
}
(async()=>{
 const src=dbFixture();
 const first=await M.snapshotDatabase(src,EJSON);
 verify(first.sections.length===3,'all three collections included');
 verify(/^[0-9a-f]{64}$/.test(first.checksum),'SHA256 receipt');
 verify(first.sections.some(x=>x.name==='store'&&x.count===1),'license record included');
 verify(first.sections.some(x=>x.name==='payments'&&x.indexes.length===2),'indexes included');
 verify((await M.snapshotDatabase(src,EJSON)).checksum===first.checksum,'deterministic stable receipt');
 src.items.get('store').rows[0].data['zv-abcde-12345-abcde'].maxUses=2;
 verify((await M.snapshotDatabase(src,EJSON)).checksum!==first.checksum,'field-level license mutation detected');
 src.items.get('store').rows[0].data['zv-abcde-12345-abcde'].maxUses=3;
 verify((await M.snapshotDatabase(src,EJSON)).checksum===first.checksum,'revert returns baseline receipt');
 src.items.get('payments').indexes[1].unique=true;
 verify((await M.snapshotDatabase(src,EJSON)).checksum!==first.checksum,'unique-index change detected');
 src.items.get('payments').indexes[1].unique=false;
 src.items.get('payments').options.validationAction='warn';
 verify((await M.snapshotDatabase(src,EJSON)).checksum!==first.checksum,'validator action mutation detected');
 src.items.get('payments').options.validationAction='error';
 verify((await M.snapshotDatabase(src,EJSON)).checksum===first.checksum,'metadata revert returns original receipt');
 src.items.get('portal_users').rows.push({_id:'extra',keyCode:'fake'});
 verify((await M.snapshotDatabase(src,EJSON)).checksum!==first.checksum,'new portal record detected');
 src.items.get('portal_users').rows.pop();
 src.items.delete('payments');
 verify((await M.snapshotDatabase(src,EJSON)).checksum!==first.checksum,'missing collection detected');
 const original=fs.readFileSync(path.join(__dirname,'..','tools','zvm-mongodb-migrate.js'),'utf8');
 const copyBody=original.slice(original.indexOf('async function copyDatabase('),original.indexOf('async function execute('));
 verify(copyBody.includes('const baseline = await snapshotDatabase(source, EJSON);'),'baseline before any copy');
 verify(copyBody.indexOf('const baseline = await snapshotDatabase')<copyBody.indexOf('await target.createCollection'),'baseline before writes');
 verify(copyBody.indexOf('const after = await snapshotDatabase')>copyBody.indexOf('await compareDatabases'),'recheck after equality validation');
 verify(copyBody.includes("throw new Error('source_changed_during_migration')"),'concurrent change fails closed');
 verify(!copyBody.includes('dropDatabase'),'no origin drop');
 const toy=crypto.createHash('sha256').update('synthetic').digest('hex');
 verify(toy!==first.checksum,'receipt derives from records, not static fixture');
 console.log('R88 MongoDB source stability PASS: '+checks+' controls');
})().catch(e=>{console.error(e);process.exitCode=1});
