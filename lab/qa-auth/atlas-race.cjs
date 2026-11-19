// Opt-in integration runner. Provide a dedicated cluster and independently approved QA role.
const {randomBytes}=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const assert=require('node:assert/strict');
const {MongoClient}=require('mongodb');
const {mongoQa}=require('./mongo-qa.cjs');
const {executeV4FreeQuota}=require('../../src/extension-v4-free-quota');
async function run(){
  if(process.env.ZVM_QA_WRITE_APPROVED!=='exclusive-cluster-verified')throw Error('QA_WRITE_AUTHORIZATION_REQUIRED');
  const cfg=mongoQa(process.env);
  const [mode,id,clock]=process.argv.slice(2);
  if(mode!=='worker'){
    const subject=randomBytes(32).toString('hex'),now=new Date().toISOString();
    const runs=await Promise.all(Array.from({length:4},()=>promisify(execFile)(process.execPath,[__filename,'worker',subject,now])));
    const counts=runs.map(x=>JSON.parse(x.stdout));
    assert.equal(counts.reduce((sum,x)=>sum+x.accepted,0),20);
    assert.equal(counts.reduce((sum,x)=>sum+x.refused,0),20);
    console.log('PASS: 20 reservas aceitas e 20 recusadas em quatro processos');
    return;
  }
  const client=new MongoClient(cfg.MONGODB_URI,{serverSelectionTimeoutMS:5000});
  try{
    const db=client.db(cfg.MONGODB_DB);
    const status=await db.command({connectionStatus:1});
    const roles=status.authInfo.authenticatedUserRoles;
    assert.deepEqual(roles,[{role:'readWrite',db:cfg.MONGODB_DB}]);
    const counts={accepted:0,refused:0};
    for(let i=0;i<10;i++){
      try{
        await executeV4FreeQuota({collection:db.collection('extension_v4_free_usage'),subject:{type:'account',id},tier:'free',action:'reserve',itemType:'message',operationId:randomBytes(16).toString('hex'),now:clock});
        counts.accepted++;
      }catch(error){if(error.code!=='MAX_LIMIT_REACHED')throw error;counts.refused++;}
    }
    console.log(JSON.stringify(counts));
  }finally{await client.close();}
}
run().catch(error=>{console.error(error.code||error.name, error.message==='QA_WRITE_AUTHORIZATION_REQUIRED'?error.message:'QA race failed');process.exitCode=1;});
