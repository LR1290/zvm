'use strict';
// R92: actual MongoDB 8.x end-to-end lab with synthetic data ONLY.
// MUST be run exclusively against the throwaway CI Docker container.
// Never use a production URI; never import customer data.
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {MongoClient,BSON}=require('mongodb');
const M=require('../tools/zvm-mongodb-migrate');
const R=require('../tools/zvm-mongodb-local-restore');
const uri='mongodb://127.0.0.1:27018';
const srcName='zapvoice',destName='zvm',restoreName='zvm_r92_archive';
const collectionNames=[
 'store','portal_users','payments','extension_sessions','webhook_events',
 'cakto_mail_outbox','worker_locks','commercial_tx_claims','meta_webhook_events',
 'queue_counters','meta_connections','password_resets','security_alerts',
 'admin_audit_logs','rate_blocks','mod_logs','settings','user_events',
 'extension_security_replay','meta_signup_flows'
];
const flags={ZVM_MONGO_MIGRATION_ACK:M.COPY_ACK,ZVM_MONGO_WRITERS_PAUSED:M.PAUSE_ACK};
const EJSON=BSON.EJSON;
let checks=0;
function check(value,label){assert.ok(value,label);checks++;}
function docker(args) {
 const p=spawnSync('docker',['exec','zvm-r92-mongodb',...args],
   {encoding:'utf8',shell:false,timeout:90000,maxBuffer:1024*1024});
 if(p.error||p.status!==0){
   // Never print raw MongoDB output; even though only synthetic lab data exists.
   throw Error('r92_docker_mongo_tool_failed:' + args[0] + ':exit_' + String(p.status));
 }
}
function collectionOptions(name){
 return name==='payments'?{
  validator:{$jsonSchema:{bsonType:'object',required:['_id','amount'],
   properties:{amount:{bsonType:'decimal'}}}},
  validationLevel:'strict',validationAction:'error',
  collation:{locale:'en',strength:2}
 }:{};
}
async function seed(db){
 for(let i=0;i<collectionNames.length;i++){
   const name=collectionNames[i];
   await db.createCollection(name,collectionOptions(name));
   const indexes=[{key:{tag:1},name:'tag_1'}];
   if(i<9)indexes.push({key:{status:1,createdAt:-1},name:'status_1_createdAt_-1'});
   await db.collection(name).createIndexes(indexes);
   let row={_id:'synthetic-'+name,tag:'fixture-'+i,status:'ready',
     createdAt:new Date('2032-06-01T12:00:00Z')};
   if(name==='store') row={_id:'keys',data:{
     'zv-abcde-12345-abcde':{active:true,expireDate:new Date('2032-07-01T00:00:00Z')},
     'wt-abcde-12345-abcde':{active:false},
     ['zv2a-'+'a'.repeat(52)]:{active:false}
   },tag:'keys',status:'ready',createdAt:row.createdAt};
   if(name==='payments')row={_id:'synthetic-payment',amount:BSON.Decimal128.fromString('149.90'),
     tag:'payment',status:'processed',createdAt:row.createdAt};
   if(name==='portal_users')row={_id:'synthetic@example.invalid',keyCode:'zv-abcde-12345-abcde',
     tag:'portal',status:'ready',createdAt:row.createdAt};
   if(name==='extension_sessions')row={...row,tokenHash:'sha256-synthetic-value',encoded:BSON.Binary.createFromBase64('AAECAw==')};
   await db.collection(name).insertOne(row);
 }
}
async function main(){
 if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||
   process.env.ZVM_R92_EPHEMERAL_ACK!=='throwaway-mongo-only'||
   process.env.MONGODB_URI||process.env.ZVM_MONGO_BACKUP_MANIFEST){
   throw Error('r92_refuses_non_ephemeral_environment');
 }
 const client=new MongoClient(uri,{serverSelectionTimeoutMS:10000,maxPoolSize:4});
 await client.connect();
 let started=false;
 try {
  const dbs=(await client.db('admin').admin().listDatabases({nameOnly:true})).databases.map(x=>x.name);
  check(![srcName,destName,restoreName].some(name=>dbs.includes(name)),
    'all 3 lab namespaces initially absent');
  started=true;
  const source=client.db(srcName),restored=client.db(restoreName),destination=client.db(destName);
  await seed(source);
  const before=await M.snapshotDatabase(source,EJSON);
  check(before.sections.length===20,'20 actual MongoDB collections seeded');
  check(before.sections.reduce((n,s)=>n+s.indexes.length,0)===49,
    '49 actual MongoDB classic indexes seeded');
  check(before.sections.some(s=>s.name==='payments'&&s.options.includes('validator')),
    'real validator and collation read by listCollections');
  check(M.indexSignatures([{name:'compound',key:{a:1,b:-1}}])[0]!==
    M.indexSignatures([{name:'compound',key:{b:-1,a:1}}])[0],
    'compound index field order not canonicalized away');
  // Actual Database Tools, NOT a mock: BSON archive round-trip.
  docker(['mongodump','--db='+srcName,'--archive=/tmp/zvm-r92.archive.gz','--gzip']);
  docker(['mongorestore','--archive=/tmp/zvm-r92.archive.gz','--gzip','--stopOnError',
    '--nsFrom='+srcName+'.*','--nsTo='+restoreName+'.*']);
  const receipt=await M.snapshotDatabase(restored,EJSON);
  check(receipt.checksum===before.checksum,'real mongodump/mongorestore BSON + options + indexes match');
  const result=await R.inspectRestoredDb(restored);
  check(result.collections===20&&result.indexes===49,
    'real restore has exactly 20 collections and 49 indexes');
  check(result.legacyOrOfficialKeyCount===2&&result.portalUserCount===1&&result.paymentCount===1,
    'real restore contains old key, new key, accounts and payments');
  check((await M.compareDatabases(source,restored,EJSON)).verified,
    'real archive parity including complex MongoDB metadata');
  const copied=await M.copyDatabase(client,EJSON,flags,receipt.checksum);
  check(copied.sourceStable&&copied.verified,'actual cross-db $out passed all migration guards');
  check(copied.collections===20&&copied.indexes===49&&copied.documents===20,
    'actual $out preserves 20 documents and 49 indexes');
  check((await M.snapshotDatabase(destination,EJSON)).checksum===before.checksum,
    'actual cross-db $out preserves source fingerprint');
  check((await M.compareDatabases(source,destination,EJSON)).verified,
    'actual cross-db source vs target compare passed');
  check((await destination.collection('store').findOne({_id:'keys'})).data['wt-abcde-12345-abcde'].active===false,
    'historical inactive legacy key preserved exactly');
  const same=await destination.collection('payments').findOne({_id:'synthetic-payment'});
  check(same.amount.toString()==='149.90','Decimal128 payment survived copy');
  await assert.rejects(M.copyDatabase(client,EJSON,flags,receipt.checksum),
    /target_not_empty_manual_review_required/);
  checks++;
  console.log('R92 MongoDB 8 REAL synthetic integration PASS: '+checks+' controls');
 }finally{
  if(started){
    await client.db(destName).dropDatabase();
    await client.db(restoreName).dropDatabase();
    await client.db(srcName).dropDatabase();
    const names=(await client.db('admin').admin().listDatabases({nameOnly:true})).databases.map(x=>x.name);
    assert.ok(![srcName,destName,restoreName].some(n=>names.includes(n)),
      'all 3 temporary namespaces were removed');
  }
  await client.close();
 }
}
main().catch(error=>{
 console.error('R92_REAL_MONGO_FAILED:',String(error&&error.message||'unknown').slice(0,300));
 process.exitCode=1;
});
