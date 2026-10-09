'use strict';
// Read-only preflight: the database account must have MongoDB read privilege only.
// Does not output emails, raw key codes, IPs or customer records.
const crypto=require('node:crypto');
function shortHash(value){return crypto.createHash('sha256').update(String(value),'utf8').digest('hex').slice(0,12);}
const pipeline = Object.freeze([
 {$match:{keyCode:{$type:'string',$ne:''}}},
 {$group:{_id:'$keyCode',owners:{$sum:1}}},
 {$match:{owners:{$gt:1}}},
 {$sort:{owners:-1}},
 {$limit:50}
]);
async function audit(db) {
 if(!db || typeof db.collection!=='function')throw Error('db_readonly_required');
 const rows=await db.collection('portal_users').aggregate(pipeline,{allowDiskUse:false,maxTimeMS:8000}).toArray();
 return {status:'read_only',complete:rows.length<50,duplicateGroups:rows.length,
  duplicates: rows.map(r=>({keyHash:shortHash(r._id),holders:Number(r.owners)||0}))};
}
async function main(argv=process.argv.slice(2),env=process.env){
 if(argv.length!==1 || argv[0]!=='--audit' || env.ZVM_AUDIT_READONLY!=='1' || !env.ZVM_AUDIT_MONGODB_URI || !env.ZVM_AUDIT_DB_NAME){
  throw Error('requires --audit, ZVM_AUDIT_READONLY=1, ZVM_AUDIT_MONGODB_URI, ZVM_AUDIT_DB_NAME');
 }
 const {MongoClient}=require('mongodb');
 const client=new MongoClient(env.ZVM_AUDIT_MONGODB_URI,{serverSelectionTimeoutMS:5000,connectTimeoutMS:5000,maxPoolSize:1});
 try {await client.connect();const report=await audit(client.db(env.ZVM_AUDIT_DB_NAME));console.log(JSON.stringify(report));}
 finally {await client.close();}
}
if(require.main===module) main().catch(e=>{console.error('R46.39 census failed:',e.code||'audit_failed');process.exitCode=1});
module.exports={pipeline,audit,shortHash};
