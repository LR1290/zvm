'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const B=require('../tools/zvm-mongodb-backup-proof');
const R=require('../tools/zvm-mongodb-local-restore');
const M=require('../tools/zvm-mongodb-migrate');
let checks=0;
const pass=(v,msg)=>{assert.ok(v,msg);checks++};
const rejects=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zvm-r89-synthetic-'));
(async()=>{
 try{
  const archive=path.join(dir,'synthetic.archive.gz');
  const source=crypto.randomBytes(384);
  fs.writeFileSync(archive,source);
  const sha=crypto.createHash('sha256').update(source).digest('hex');
  const manifestPath=path.join(dir,'synthetic.archive.gz.sha256.json');
  const proofPath=path.join(dir,'synthetic.archive.gz.restore-proof.json');
  const base={sourceDatabase:'zapvoice',dryRunVerified:true,writersReportedPaused:true,
    archiveFile:'synthetic.archive.gz',sizeBytes:source.length,sha256:sha};
  const proof={format:B.FORMAT,sourceDatabase:'zapvoice',archiveSha256:sha,
    verifiedAtUtc:new Date().toISOString(),cleanupConfirmed:true,localOnly:true,
    collections:20,indexes:49,legacyOrOfficialKeyCount:61,portalUserCount:39,paymentCount:33};
  const write=(file,obj)=>fs.writeFileSync(file,JSON.stringify(obj));
  write(manifestPath,base);write(proofPath,proof);
  const env={ZVM_MONGO_BACKUP_MANIFEST:manifestPath,ZVM_MONGO_RESTORE_PROOF:proofPath};
  pass((await B.validateBackupGate(env)).verified,'real archive and proof accepted');
  pass((await B.validatedBackup(manifestPath)).sha256===sha,'archive SHA validated');
  await rejects(()=>M.execute('copy',{ZVM_MONGO_MIGRATION_ACK:M.COPY_ACK,
    ZVM_MONGO_WRITERS_PAUSED:M.PAUSE_ACK}),/ZVM_DB_BACKUP_PATH_REQUIRED/);
  await rejects(()=>B.validateBackupGate({...env,ZVM_MONGO_RESTORE_PROOF:path.join(dir,'missing.json')}),/ENOENT/);
  write(proofPath,{...proof,archiveSha256:'b'.repeat(64)});
  await rejects(()=>B.validateBackupGate(env),/RESTORE_PROOF_MISMATCH/);
  write(proofPath,{...proof,cleanupConfirmed:false});
  await rejects(()=>B.validateBackupGate(env),/RESTORE_PROOF_MISMATCH/);
  write(proofPath,{...proof,collections:19});
  await rejects(()=>B.validateBackupGate(env),/RESTORE_COLLECTIONS_INCOMPLETE/);
  write(proofPath,{...proof,indexes:48});
  await rejects(()=>B.validateBackupGate(env),/RESTORE_INDEXES_INCOMPLETE/);
  write(proofPath,{...proof,paymentCount:0});
  await rejects(()=>B.validateBackupGate(env),/RESTORE_CRITICAL_RECORDS_MISSING/);
  write(proofPath,proof);
  write(manifestPath,{...base,writersReportedPaused:false});
  await rejects(()=>B.validateBackupGate(env),/WRITERS_NOT_DECLARED_PAUSED/);
  write(manifestPath,{...base,archiveFile:'../other.archive.gz'});
  await rejects(()=>B.validateBackupGate(env),/ARCHIVE_FILENAME_INVALID/);
  write(manifestPath,{...base,sizeBytes:source.length+1});
  await rejects(()=>B.validateBackupGate(env),/ARCHIVE_SIZE_MISMATCH/);
  write(manifestPath,base);
  fs.writeFileSync(archive,Buffer.concat([Buffer.from([source[0]^0xff]),source.subarray(1)]));
  await rejects(()=>B.validateBackupGate(env),/ARCHIVE_HASH_MISMATCH/);
  fs.writeFileSync(archive,source);
  pass((await B.validateBackupGate(env)).verified,'valid archive recovered');
  pass(B.localUri('mongodb://127.0.0.1:27017')==='mongodb://127.0.0.1:27017','loopback allowed');
  pass(B.localUri('mongodb://localhost:27017')==='mongodb://localhost:27017','hostname loopback allowed');
  for(const url of ['mongodb+srv://prod.example.com','mongodb://atlas.example.com:27017',
    'mongodb://user:pass@localhost:27017','mongodb://localhost:27017/?replicaSet=prod',
    'mongodb://localhost:27017/prod','mongodb://localhost:27017,elsewhere:27017']){
    assert.throws(()=>B.localUri(url),/ZVM_DB_BACKUP_/);checks++;
  }
  assert.throws(()=>R.restorationAck({}),/ZVM_LOCAL_RESTORE_NOT_CONFIRMED/);checks++;
  R.restorationAck({ZVM_LOCAL_RESTORE_ACK:'restore-archive-local-only'});checks++;
  const required=['store','portal_users','payments','extension_sessions','webhook_events','cakto_mail_outbox'];
  const names=[...required,...Array.from({length:14},(_,i)=>'fixture_'+i)];
  const indexes=names.map((_,i)=>i===0?4:i<=13?3:1); // 4 + 13*3 + 6 = 49
  const fake={listCollections:()=>({toArray:async()=>names.map(name=>({name}))}),
    collection(name){const i=names.indexOf(name);return {
      listIndexes:()=>({toArray:async()=>Array.from({length:indexes[i]},(_,n)=>({name:'ix'+n}))}),
      findOne:async()=>({data:{'zv-abcde-12345-abcde':{active:true}}}),
      countDocuments:async()=>name==='payments'?33:39
    }}};
  const result=await R.inspectRestoredDb(fake);
  pass(result.collections===20&&result.indexes===49&&result.legacyOrOfficialKeyCount===1,'isolated restore inspection');
  await rejects(()=>R.inspectRestoredDb({...fake,listCollections:()=>({toArray:async()=>names.slice(0,19).map(name=>({name}))})}),/COLLECTIONS_INCOMPLETE/);
  const migration=fs.readFileSync(path.join(__dirname,'..','tools','zvm-mongodb-migrate.js'),'utf8');
  pass(migration.indexOf('await validateBackupGate(env)')<migration.indexOf('const uri = String(env.MONGODB_URI'),'backup proof before Atlas connection');
  const restoration=fs.readFileSync(path.join(__dirname,'..','tools','zvm-mongodb-local-restore.js'),'utf8');
  pass(restoration.includes('await client.db(tmpName).dropDatabase()'),'temporary local cleanup exists');
  pass(restoration.includes("fs.writeFileSync(proofPath")&&restoration.indexOf("fs.writeFileSync(proofPath")>restoration.indexOf("if(!cleanupConfirmed)throw"),'proof only after cleanup');
  console.log('R89 MongoDB external backup + isolated restore gate PASS: '+checks+' controls');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
