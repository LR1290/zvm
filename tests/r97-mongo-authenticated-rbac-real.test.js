'use strict';
// R97: AUTHENTICATED RBAC E2E, only throwaway MongoDB 8 Docker localhost:27019.
// Every username/password/document below is deliberately fictional.
const assert=require('node:assert/strict');
const {MongoClient,BSON}=require('mongodb');
const P=require('../tools/zvm-mongodb-cutover-preflight');
const PORT='127.0.0.1:27019';
const URI_ROOT='mongodb://zvm_r97_root:synthetic-root-only@'+PORT+'/?authSource=admin';
const URI_RW='mongodb://zvm_r97_operator:synthetic-operator-only@'+PORT+'/?authSource=admin';
const URI_READ='mongodb://zvm_r97_auditor:synthetic-auditor-only@'+PORT+'/?authSource=admin';
let checks=0;
const ok=(value,msg)=>{assert.ok(value,msg);checks++;};
async function main() {
 if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||
    process.env.ZVM_R97_AUTH_LAB_ACK!=='synthetic-auth-mongodb-only'||
    process.env.MONGODB_URI||process.env.ZVM_MONGO_BACKUP_MANIFEST) {
  throw Error('ZVM_R97_REFUSE_NON_EPHEMERAL');
 }
 const root=new MongoClient(URI_ROOT,{serverSelectionTimeoutMS:10000,maxPoolSize:3});
 await root.connect();
 let rw,readOnly;
 try{
  const names=[...P.REQUIRED,...Array.from({length:14},(_,i)=>'r97_fake_'+i)];
  const db=root.db('zapvoice');
  for(let i=0;i<names.length;i++){
   const name=names[i];
   await db.createCollection(name);
   const indices=[{key:{tag:1},name:'tag_1'}];
   if(i<9)indices.push({key:{status:1,createdAt:-1},name:'status_1_createdAt_-1'});
   await db.collection(name).createIndexes(indices);
   const when=new Date('2032-01-01T00:00:00Z');
   let document={_id:'fake_'+name,tag:'test',status:'test',createdAt:when};
   if(name==='store')document={_id:'keys',data:{
     'zv-abcde-12345-abcde':{active:true},
     'wt-abcde-12345-abcde':{active:false}
   },tag:'test'};
   if(name==='portal_users')document={_id:'fake@example.invalid',tag:'test'};
   if(name==='payments')document={_id:'fake-payment',amount:BSON.Decimal128.fromString('59.90'),tag:'test'};
   await db.collection(name).insertOne(document);
  }
  const admin=root.db('admin');
  await admin.command({createUser:'zvm_r97_operator',pwd:'synthetic-operator-only',
    roles:[{role:'read',db:'zapvoice'},{role:'readWrite',db:'zvm'}]});
  await admin.command({createUser:'zvm_r97_auditor',pwd:'synthetic-auditor-only',
    roles:[{role:'read',db:'zapvoice'}]});
  rw=new MongoClient(URI_RW,{serverSelectionTimeoutMS:10000,maxPoolSize:2});
  readOnly=new MongoClient(URI_READ,{serverSelectionTimeoutMS:10000,maxPoolSize:2});
  await rw.connect();
  await readOnly.connect();
  const allowed=await P.inspectClient(rw);
  ok(allowed.auth.authenticated,'real SCRAM authentication succeeded');
  ok(allowed.auth.sourceReadAuthorized,'real read role on zapvoice recognized');
  ok(allowed.auth.targetWriteAuthorized,'real readWrite role on zvm recognized');
  ok(allowed.source.collections===20&&allowed.source.indexes===49,
    'live read-only inventory of 20 collections and 49 indexes');
  ok(allowed.source.officialKeys===1&&allowed.source.historicalKeys===1,
    'historical fake key preserved but not counted as official');
  ok(allowed.technicalPreflightPassed&&allowed.targetEmpty,
    'real authenticated least-privilege operator passes technical preflight');
  ok(!JSON.stringify(allowed).includes('zvm_r97_operator')&&
    !JSON.stringify(allowed).includes('zv-abcde-12345-abcde'),
    'no username or license leaked into preflight report');
  const denied=await P.inspectClient(readOnly);
  ok(denied.auth.authenticated&&denied.auth.sourceReadAuthorized,
    'read-only user authenticates and reads source');
  ok(!denied.auth.targetWriteAuthorized&&!denied.technicalPreflightPassed,
    'read-only role cannot authorize migration into zvm');
  await root.db('zvm').createCollection('some_existing_data');
  const occupied=await P.inspectClient(rw);
  ok(!occupied.targetEmpty&&!occupied.technicalPreflightPassed,
    'authenticated writer cannot copy into populated target');
  ok(occupied.manualBackupPauseAndDeployStillRequired===true,
    'even successful permissions do not waive manual backup/freeze');
  console.log('R97 MongoDB 8 AUTHENTICATED RBAC REAL E2E PASS: '+checks+' controls');
 }finally{
  if(rw)await rw.close().catch(()=>{});
  if(readOnly)await readOnly.close().catch(()=>{});
  // Drop ONLY local test namespaces/users. The whole test container is
  // destroyed by the workflow even if this cleanup fails.
  await root.db('zvm').dropDatabase().catch(()=>{});
  await root.db('zapvoice').dropDatabase().catch(()=>{});
  await root.db('admin').command({dropUser:'zvm_r97_operator'}).catch(()=>{});
  await root.db('admin').command({dropUser:'zvm_r97_auditor'}).catch(()=>{});
  await root.close().catch(()=>{});
 }
}
main().catch(e=>{
 console.error('ZVM_R97_RBAC_FAILED:',String(e.code||e.message||'unknown').slice(0,160));
 process.exitCode=1;
});
