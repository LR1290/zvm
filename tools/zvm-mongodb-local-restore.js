'use strict';
// R89 isolated restore proof. Never connects to the production Atlas cluster.
// Requires local mongod on loopback and wipes only its random temporary namespace.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const B=require('./zvm-mongodb-backup-proof');
const REQUIRED=Object.freeze(['store','portal_users','payments','extension_sessions',
  'webhook_events','cakto_mail_outbox']);
function restorationAck(env) {
  if(env.ZVM_LOCAL_RESTORE_ACK!=='restore-archive-local-only') {
    throw new Error('ZVM_LOCAL_RESTORE_NOT_CONFIRMED');
  }
}
async function inspectRestoredDb(db) {
  const names=(await db.listCollections({}, {nameOnly:true}).toArray()).map(x=>x.name);
  if(names.length<B.REQUIRED_COLLECTIONS||REQUIRED.some(x=>!names.includes(x))) {
    throw new Error('ZVM_LOCAL_RESTORE_COLLECTIONS_INCOMPLETE');
  }
  let indexCount=0;
  for(const name of names){
    indexCount+=(await db.collection(name).listIndexes().toArray()).length;
  }
  if(indexCount<B.REQUIRED_INDEXES)throw new Error('ZVM_LOCAL_RESTORE_INDEXES_INCOMPLETE');
  const [keysDoc,portalUserCount,paymentCount]=await Promise.all([
    db.collection('store').findOne({_id:'keys'},{projection:{data:1}}),
    db.collection('portal_users').countDocuments({}),
    db.collection('payments').countDocuments({})
  ]);
  const keys=keysDoc&&keysDoc.data&&typeof keysDoc.data==='object'?keysDoc.data:{};
  const legacyOrOfficialKeyCount=Object.keys(keys)
    .filter(x=>/^zv-(?:[a-z0-9]{5}-){2}[a-z0-9]{5}$|^zv2a-[a-z2-7]{52}$/.test(x)).length;
  if(legacyOrOfficialKeyCount<1||portalUserCount<1||paymentCount<1){
    throw new Error('ZVM_LOCAL_RESTORE_CRITICAL_RECORDS_MISSING');
  }
  return {collections:names.length,indexes:indexCount,legacyOrOfficialKeyCount,portalUserCount,paymentCount};
}
async function runLocalRestore(env=process.env) {
  restorationAck(env);
  const uri=B.localUri(env.ZVM_LOCAL_RESTORE_URI);
  const manifestPath=String(env.ZVM_MONGO_BACKUP_MANIFEST||'');
  const {archive,sha256}=await B.validatedBackup(manifestPath,{pauseRequired:false});
  const proofPath=path.resolve(path.dirname(path.resolve(manifestPath)),path.basename(archive)+'.restore-proof.json');
  if(fs.existsSync(proofPath))throw new Error('ZVM_LOCAL_RESTORE_PROOF_ALREADY_EXISTS');
  const {MongoClient}=require('mongodb');
  const client=new MongoClient(uri,{serverSelectionTimeoutMS:4000,maxPoolSize:2});
  const tmpName='zvm_restore_r89_'+crypto.randomBytes(8).toString('hex');
  let created=false,cleanupConfirmed=false,summary=null;
  await client.connect();
  try {
    const dbs=await client.db('admin').admin().listDatabases({nameOnly:true});
    if(dbs.databases.some(x=>x.name===tmpName))throw new Error('ZVM_LOCAL_RESTORE_TEMP_NAMESPACE_COLLISION');
    created=true;
    const args=['--uri='+uri,'--archive='+archive,'--gzip','--stopOnError',
      '--nsFrom=zapvoice.*','--nsTo='+tmpName+'.*'];
    const proc=spawnSync('mongorestore',args,{shell:false,encoding:'utf8',
      timeout:180000,windowsHide:true,maxBuffer:1024*1024});
    if(proc.error||proc.status!==0)throw new Error('ZVM_LOCAL_RESTORE_EXECUTION_FAILED');
    summary=await inspectRestoredDb(client.db(tmpName));
  } finally {
    if(created){
      try{
        await client.db(tmpName).dropDatabase();
        const after=await client.db('admin').admin().listDatabases({nameOnly:true});
        cleanupConfirmed=!after.databases.some(x=>x.name===tmpName);
      }catch(error){cleanupConfirmed=false;}
    }
    await client.close();
  }
  if(!cleanupConfirmed)throw new Error('ZVM_LOCAL_RESTORE_CLEANUP_NOT_CONFIRMED');
  if(!summary)throw new Error('ZVM_LOCAL_RESTORE_NO_SUMMARY');
  const proof={
    format:B.FORMAT,sourceDatabase:'zapvoice',archiveSha256:sha256,
    verifiedAtUtc:new Date().toISOString(),localOnly:true,cleanupConfirmed:true,...summary
  };
  fs.writeFileSync(proofPath,JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});
  return {validated:true,proofPath,collections:summary.collections,indexes:summary.indexes};
}
if(require.main===module){
  runLocalRestore().then(result=>console.log(JSON.stringify(result,null,2)))
    .catch(e=>{console.error('ZVM_LOCAL_RESTORE_FAILED:',String(e.code||e.message||'error').slice(0,140));process.exitCode=1;});
}
module.exports={restorationAck,inspectRestoredDb,runLocalRestore};
