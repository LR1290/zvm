'use strict';
// R95: read-only cutover preflight. Never logs keys, users, identities or URIs.
const M=require('./zvm-mongodb-migrate');
const REQUIRED=Object.freeze([
 'store','portal_users','payments','extension_sessions','webhook_events','cakto_mail_outbox'
]);
const READ_ACTIONS=Object.freeze(['find','listCollections','listIndexes']);
const WRITE_ACTIONS=Object.freeze(['find','insert','remove','createCollection','createIndex','dropCollection']);
function privilegesForDatabase(authInfo,dbName,actions) {
 const users=authInfo&&Array.isArray(authInfo.authenticatedUsers)?authInfo.authenticatedUsers:[];
 const privileges=authInfo&&Array.isArray(authInfo.authenticatedUserPrivileges)?
   authInfo.authenticatedUserPrivileges:[];
 if(!users.length||!privileges.length)return false;
 return actions.every(action=>privileges.some(p=>{
   if(!p||!Array.isArray(p.actions)||!p.actions.includes(action)||!p.resource)return false;
   const resource=p.resource;
   return resource.anyResource===true||
      (resource.db===dbName&&resource.collection==='')||
      (resource.db===''&&resource.collection==='');
 }));
}
function summarizeAuthorization(status) {
 const info=status&&status.authInfo;
 return {
   authenticated:!!(info&&Array.isArray(info.authenticatedUsers)&&info.authenticatedUsers.length),
   sourceReadAuthorized:privilegesForDatabase(info,M.SOURCE_DB,READ_ACTIONS),
   targetWriteAuthorized:privilegesForDatabase(info,M.TARGET_DB,WRITE_ACTIONS)
 };
}
async function inspectSource(source) {
 const rows=await source.listCollections({}, {nameOnly:true}).toArray();
 const names=M.listCollectionNames(rows.map(x=>({...x,type:x.type||'collection'})));
 const requiredCollectionsPresent=REQUIRED.every(name=>names.includes(name));
 let documents=0,indexes=0;
 for(const name of names) {
  const [count,idx]=await Promise.all([
    source.collection(name).countDocuments({}),
    source.collection(name).listIndexes().toArray()
  ]);
  documents+=count;
  indexes+=idx.length;
 }
 const [keysDoc,accounts,payments,sessions]=await Promise.all([
  source.collection('store').findOne({_id:'keys'},{projection:{data:1}}),
  source.collection('portal_users').countDocuments({}),
  source.collection('payments').countDocuments({}),
  source.collection('extension_sessions').countDocuments({})
 ]);
 const data=keysDoc&&keysDoc.data&&typeof keysDoc.data==='object'&&!Array.isArray(keysDoc.data)?
  keysDoc.data:{};
 const keyCodes=Object.keys(data);
 const officialKeys=keyCodes.filter(x=>/^zv-(?:[a-z0-9]{5}-){2}[a-z0-9]{5}$|^zv2a-[a-z2-7]{52}$/.test(x)).length;
 const historicalKeys=keyCodes.length-officialKeys;
 return {collections:names.length,indexes,documents,accounts,payments,sessions,
  officialKeys,historicalKeys,requiredCollectionsPresent,
  integrityMinimumMet:requiredCollectionsPresent&&indexes>=49&&names.length>=20&&
    officialKeys>0&&accounts>0&&payments>0};
}
async function inspectClient(client) {
 if(!client||typeof client.db!=='function')throw new Error('ZVM_PREFLIGHT_CLIENT_REQUIRED');
 let auth;
 try {
  // No personal identifiers are printed, even though connectionStatus can
  // return internal usernames. Only the derived boolean capabilities leave this scope.
  auth=summarizeAuthorization(await client.db('admin').command({
    connectionStatus:1,showPrivileges:true
  }));
 }catch{
  auth={authenticated:false,sourceReadAuthorized:false,targetWriteAuthorized:false};
 }
 let source;
 try{source=await inspectSource(client.db(M.SOURCE_DB));}
 catch{source={readable:false,integrityMinimumMet:false};}
 let targetEmpty=false;
 try{
  const target=await client.db(M.TARGET_DB).listCollections({}, {nameOnly:true}).toArray();
  targetEmpty=target.length===0;
 }catch{targetEmpty=false;}
 return {
   mode:'cutover-preflight-readonly',
   sourceDatabase:M.SOURCE_DB,targetDatabase:M.TARGET_DB,
   auth,source,targetEmpty,
   permissionReady:auth.authenticated&&auth.sourceReadAuthorized&&auth.targetWriteAuthorized,
   technicalPreflightPassed:auth.authenticated&&auth.sourceReadAuthorized&&
     auth.targetWriteAuthorized&&source.integrityMinimumMet&&targetEmpty,
   manualBackupPauseAndDeployStillRequired:true,
   mutating:false
 };
}
async function main(env=process.env){
 const uri=String(env.MONGODB_URI||'').trim();
 if(!uri)throw new Error('ZVM_PREFLIGHT_MONGODB_URI_REQUIRED');
 const {MongoClient}=require('mongodb');
 const client=new MongoClient(uri,{maxPoolSize:2,serverSelectionTimeoutMS:10000});
 await client.connect();
 try{return await inspectClient(client);}
 finally{await client.close();}
}
if(require.main===module){
 main().then(summary=>{
   console.log(JSON.stringify(summary,null,2));
   if(!summary.technicalPreflightPassed)process.exitCode=2;
 }).catch(e=>{
   console.error('ZVM_PREFLIGHT_FAILED:',String(e.code||e.message||'unknown').slice(0,150));
   process.exitCode=1;
 });
}
module.exports={REQUIRED,READ_ACTIONS,WRITE_ACTIONS,privilegesForDatabase,
 summarizeAuthorization,inspectSource,inspectClient,main};
