'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const M=require('../tools/zvm-mongodb-migrate');
const {validateRuntimeSecurityConfig}=require('../runtime-config');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
let checks=0;
function yes(p,m){assert.ok(p,m);checks++}
function guard(fn,re){assert.throws(fn,re);checks++}
yes(M.SOURCE_DB==='zapvoice'&&M.TARGET_DB==='zvm','authorized pair only');
guard(()=>M.copyGuard('copy',{}),/migration_requires_explicit_ack/);
guard(()=>M.copyGuard('copy',{ZVM_MONGO_MIGRATION_ACK:M.COPY_ACK}),/migration_requires_explicit_ack/);
yes(M.copyGuard('copy',{ZVM_MONGO_MIGRATION_ACK:M.COPY_ACK,ZVM_MONGO_WRITERS_PAUSED:M.PAUSE_ACK})===true,'two flags required');
yes(M.copyGuard('audit',{})===false,'audit read-only');
yes(M.canonical({b:2,a:1})===M.canonical({a:1,b:2}),'canonical hash order');
const idx=M.indexSpec({v:2,ns:'zapvoice.payments',background:true,key:{tx:1},name:'tx_1',unique:true,sparse:true,expireAfterSeconds:3600});
yes(!('v'in idx)&&!('ns'in idx)&&!('background'in idx),'discard source namespace metadata');
yes(idx.unique&&idx.sparse&&idx.expireAfterSeconds===3600,'preserve security and TTL index options');
yes(M.indexSignatures([{key:{a:1},name:'a'},{key:{b:1},name:'b'}]).join('|')===M.indexSignatures([{key:{b:1},name:'b'},{key:{a:1},name:'a'}]).join('|'),'index ordering independent');
guard(()=>M.listCollectionNames([{name:'v',type:'view'}]),/unsupported_collection/);
guard(()=>M.listCollectionNames([{name:'system.profile',type:'collection'}]),/unsupported_collection/);
const stg={ZVM_RUNTIME_ENV:'staging',MONGODB_DB:'zvm',ZVM_BUILD_ENFORCE:'1',ZVM_EXTENSION_IDS:'abcdefghijklmnopabcdefghijklmnop'};
const auth={buildEnforce:true,extensionIdCount:1,registryV2ActiveCount:1};
guard(()=>validateRuntimeSecurityConfig(stg,auth,{productionDbName:'zapvoice'}),/MONGODB_DB_must_be_isolated/);
guard(()=>validateRuntimeSecurityConfig({...stg,MONGODB_DB:'zapvoice'},auth,{productionDbName:'zapvoice'}),/MONGODB_DB_must_be_isolated/);
yes(validateRuntimeSecurityConfig({...stg,MONGODB_DB:'zvm_lite_staging_20261118'},auth,{productionDbName:'zapvoice'}).ok,'stage stays isolated');
yes(server.includes("return fromEnv || 'zapvoice';"),'legacy default until cutover');
yes(server.includes('retired_watidy_database'),'watidy fail-closed');
yes(server.includes('MongoDB: $'+'{MONGODB_DB}.store'),'runtime log displays selected database');
const docs={store:[{_id:'keys',data:{'zv-abcde-12345-abcde':{active:true}}}],portal_users:[{_id:'synthetic',keyCode:'zv-abcde-12345-abcde'}],payments:[{_id:1,tx:1}]};
function mockDb(name,data){
  const store=Object.fromEntries(Object.entries(data).map(([name,rows])=>[name,{rows:rows.map(x=>JSON.parse(JSON.stringify(x))),indices:[{name:'_id_',key:{_id:1}},...(name==='payments'?[{name:'tx_1',key:{tx:1},unique:true}]:[])]}]));
  return {databaseName:name,store,
    listCollections:()=>({toArray:async()=>Object.keys(store).map(name=>({name,type:'collection'}))}),
    collection:n=>{const c=store[n];return {
      countDocuments:async()=>c.rows.length,
      listIndexes:()=>({toArray:async()=>c.indices}),
      find:()=>({async *[Symbol.asyncIterator](){for(const row of c.rows)yield row;}})
    }}
  };
}
(async()=>{
 const src=mockDb('zapvoice',docs),dst=mockDb('zvm',docs),EJSON={serialize:x=>x};
 const result=await M.compareDatabases(src,dst,EJSON);
 yes(result.verified&&result.collections===3&&result.documents===3,'exact BSON content and indexes');
 dst.store.portal_users.rows[0].keyCode='changed';
 await assert.rejects(M.compareDatabases(src,dst,EJSON),/database_mismatch:portal_users/);checks++;
 dst.store.portal_users.rows[0].keyCode='zv-abcde-12345-abcde';
 dst.store.payments.indices[1].unique=false;
 await assert.rejects(M.compareDatabases(src,dst,EJSON),/database_mismatch:payments/);checks++;
 const fakeClient={db:n=>n==='zapvoice'?src:dst};
 await assert.rejects(M.copyDatabase(fakeClient,EJSON,{}),/migration_requires_explicit_ack/);checks++;
 await assert.rejects(M.copyDatabase(fakeClient,EJSON,{ZVM_MONGO_MIGRATION_ACK:M.COPY_ACK,ZVM_MONGO_WRITERS_PAUSED:M.PAUSE_ACK}),/target_not_empty_manual_review_required/);checks++;
 console.log('R85 MongoDB migration safety PASS: '+checks+' controls');
})().catch(e=>{console.error(e);process.exitCode=1});
