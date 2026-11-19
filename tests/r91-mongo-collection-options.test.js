'use strict';
const assert=require('node:assert/strict');
const M=require('../tools/zvm-mongodb-migrate');
const EJSON={serialize:x=>JSON.parse(JSON.stringify(x))};
let checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++};
const error=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++};
const opts={validator:{amount:{$gte:0},approved:{$type:'bool'}},validationAction:'error',
  validationLevel:'strict',collation:{locale:'pt',strength:2}};
function fixture(options) {
 const entries=new Map([['payments',{rows:[{_id:1,amount:14990,approved:true}],
   indexes:[{name:'_id_',key:{_id:1}}],options}]]);
 return {entries,
   listCollections(){return {toArray:async()=>[...entries].map(([name,item])=>({name,type:'collection',options:item.options}))};},
   collection(name){const item=entries.get(name);
     return {
       countDocuments:async()=>item.rows.length,
       listIndexes(){return {toArray:async()=>item.indexes};},
       find(){return {async *[Symbol.asyncIterator](){for(const d of item.rows)yield d;}}}
     };
   }
 };
}
(async()=>{
 const initial=M.collectionOptionsSignature({name:'payments',options:opts},EJSON);
 check(typeof initial==='string'&&initial.includes('validator'),'validator included in signed metadata');
 const reordered={collation:{strength:2,locale:'pt'},validationLevel:'strict',
   validationAction:'error',validator:{approved:{$type:'bool'},amount:{$gte:0}}};
 check(M.collectionOptionsSignature({options:reordered},EJSON)===initial,'field order irrelevant');
 check(M.collectionOptionsSignature({options:{}},EJSON)==='{}','empty options canonical');
 check(M.collectionOptionsSignature({options:null},EJSON)==='{}','missing options canonical');
 for(const altered of [
  {...opts,validationAction:'warn'},
  {...opts,validationLevel:'moderate'},
  {...opts,collation:{locale:'en',strength:2}},
  {...opts,validator:{amount:{$gt:0},approved:{$type:'bool'}}},
  {...opts,capped:true,size:1024}
 ])check(M.collectionOptionsSignature({options:altered},EJSON)!==initial,'metadata mismatch detected');
 check(M.collectionOptionsByName([{name:'payments',options:opts}],EJSON).get('payments')===initial,'map captures signature');
 assert.throws(()=>M.collectionOptionsByName([{name:'a'},{name:'a'}],EJSON),/duplicate_collection_name/);checks++;
 const first=fixture(JSON.parse(JSON.stringify(opts))),second=fixture({...opts,validationAction:'warn'});
 const original=await M.snapshotDatabase(first,EJSON);
 const changed=await M.snapshotDatabase(second,EJSON);
 check(original.checksum!==changed.checksum,'restored checksum includes collection configuration');
 await error(()=>M.compareDatabases(first,second,EJSON),/collection_options_mismatch:payments/);
 const matching=fixture(JSON.parse(JSON.stringify(opts)));
 const result=await M.compareDatabases(first,matching,EJSON);
 check(result.verified&&result.documents===1,'equal docs, indexes, options accepted');
 check((await M.snapshotDatabase(matching,EJSON)).checksum===original.checksum,'stable canonical metadata signature');
 const originalOptions=JSON.parse(JSON.stringify(opts));
 first.entries.get('payments').options.validator.amount={$gte:1};
 check((await M.snapshotDatabase(first,EJSON)).checksum!==original.checksum,'in-place validator mutation rejected');
 first.entries.get('payments').options=originalOptions;
 check((await M.snapshotDatabase(first,EJSON)).checksum===original.checksum,'restoring metadata recovers checksum');
 const views=[{name:'payments',type:'view',options:opts}];
 assert.throws(()=>M.listCollectionNames(views),/unsupported_collection_type_or_name/);checks++;
 console.log('R91 MongoDB collection options fidelity PASS: '+checks+' controls');
})().catch(error=>{console.error(error);process.exitCode=1});
