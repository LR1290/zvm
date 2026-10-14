'use strict';
// Standalone read-only diagnostic. Does NOT import server.js or execute webhooks.
const {MongoClient}=require('mongodb');
const {auditPaidOrders,getScopedToken}=require('../src/cakto-paid-order-audit');
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--audit')throw Error('explicit_audit_flag_required');
 const clientId=process.env.CAKTO_READONLY_CLIENT_ID;
 const clientSecret=process.env.CAKTO_READONLY_CLIENT_SECRET;
 const mongoUri=process.env.MONGODB_URI;
 const dbName=process.env.MONGODB_DB;
 const from=process.env.CAKTO_AUDIT_FROM;
 const to=process.env.CAKTO_AUDIT_TO;
 if(!clientId||!clientSecret||!mongoUri||!dbName||!from||!to)throw Error('read_only_configuration_required');
 const token=await getScopedToken(clientId,clientSecret);
 const client=new MongoClient(mongoUri,{serverSelectionTimeoutMS:8000});
 try{
  await client.connect();
  const summary=await auditPaidOrders({token,db:client.db(dbName),from,to,maxPages:10});
  console.log(JSON.stringify(summary));
  if(!summary.complete)process.exitCode=2;
 }finally{await client.close();}
}
if(require.main===module)main().catch(e=>{
 const message=String(e?.message||'');
 console.error('Cakto audit failed:',/^cakto_[a-z0-9_]+$|^read_only_configuration_required$|^explicit_audit_flag_required$/.test(message)?message:'internal_error');
 process.exitCode=1;
});
module.exports={main};
