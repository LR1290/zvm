'use strict';
const assert=require('node:assert/strict');
const P=require('../tools/zvm-mongodb-cutover-preflight');
const M=require('../tools/zvm-mongodb-migrate');
let checks=0;
const test=(condition,msg)=>{assert.ok(condition,msg);checks++;};
const users=[{user:'secret-username-not-for-logs',db:'admin'}];
const priv=(db,actions,collection='')=>({resource:{db,collection},actions});
const sourcePriv=[priv('zapvoice',[...P.READ_ACTIONS])];
const targetPriv=[priv('zvm',[...P.WRITE_ACTIONS])];
const granted={authInfo:{authenticatedUsers:users,authenticatedUserPrivileges:[...sourcePriv,...targetPriv]}};
const keyCode='zv-abcde-12345-abcde';
const fakeDb=({incomplete=false}={})=>{
 const names=[...P.REQUIRED,...Array.from({length:14},(_,i)=>'extra_'+i)];
 if(incomplete)names.pop();
 return {
  listCollections(){return {toArray:async()=>names.map(name=>({name,type:'collection'}))};},
  collection(name){
   const i=names.indexOf(name);
   return {
    countDocuments:async()=>name==='portal_users'?39:name==='payments'?33:name==='extension_sessions'?56:1,
    listIndexes(){return {toArray:async()=>Array.from({length:i<9?3:2},(_,j)=>({name:'idx'+j,key:{_id:1}}))};},
    findOne:async()=>({_id:'keys',data:{[keyCode]:{active:true},'wt-abcde-12345-abcde':{active:false}}})
   };
  }
 };
};
function client({status=granted,incomplete=false,targetExists=false}={}){
 return {db(name){
  if(name==='admin')return {command:async()=>status};
  if(name===M.SOURCE_DB)return fakeDb({incomplete});
  if(name===M.TARGET_DB)return {listCollections(){return {toArray:async()=>targetExists?[{name:'some_data'}]:[]};}};
  throw Error('unknown database');
 }};
}
(async()=>{
 test(P.privilegesForDatabase(granted.authInfo,'zapvoice',P.READ_ACTIONS),'read source');
 test(P.privilegesForDatabase(granted.authInfo,'zvm',P.WRITE_ACTIONS),'write target');
 test(!P.privilegesForDatabase({authenticatedUsers:[],authenticatedUserPrivileges:targetPriv},'zvm',P.WRITE_ACTIONS),
   'anonymous connection never trusted');
 test(!P.privilegesForDatabase({authenticatedUsers:users,authenticatedUserPrivileges:sourcePriv},'zvm',P.WRITE_ACTIONS),
   'read-only source cannot write target');
 test(!P.privilegesForDatabase({authenticatedUsers:users,authenticatedUserPrivileges:[
   ...sourcePriv,priv('zvm',P.WRITE_ACTIONS.slice(0,-1))]},'zvm',P.WRITE_ACTIONS),
   'missing dropCollection privilege blocks');
 test(!P.privilegesForDatabase({authenticatedUsers:users,authenticatedUserPrivileges:[
   priv('zvm',P.WRITE_ACTIONS,'payments')]},'zvm',P.WRITE_ACTIONS),
   'collection-scoped privilege insufficient');
 test(P.privilegesForDatabase({authenticatedUsers:users,authenticatedUserPrivileges:[
   {resource:{anyResource:true},actions:P.WRITE_ACTIONS}]},'zvm',P.WRITE_ACTIONS),
   'explicit global privilege recognized');
 const summary=await P.inspectClient(client());
 test(summary.technicalPreflightPassed&&summary.permissionReady&&summary.targetEmpty,
   'all checks pass with explicit privileges and empty target');
 test(summary.source.collections===20&&summary.source.indexes===49&&summary.source.payments===33,
   'synthetic source inventory checked');
 test(summary.source.officialKeys===1&&summary.source.historicalKeys===1,
   'old license preserved but excluded from active-license count');
 test(summary.manualBackupPauseAndDeployStillRequired===true&&!summary.mutating,
   'preflight cannot authorize actual cutover');
 test(!JSON.stringify(summary).includes('secret-username'),'no MongoDB username leaked');
 test(!JSON.stringify(summary).includes(keyCode),'no license leaked');
 const blocked=await P.inspectClient(client({status:{authInfo:{authenticatedUsers:[],authenticatedUserPrivileges:[]}}}));
 test(!blocked.permissionReady&&!blocked.technicalPreflightPassed,'anonymous real cluster rejected');
 const missing=await P.inspectClient(client({incomplete:true}));
 test(!missing.technicalPreflightPassed&&missing.source.collections===19,
   'missing collection rejected');
 const populated=await P.inspectClient(client({targetExists:true}));
 test(!populated.technicalPreflightPassed&&!populated.targetEmpty,'populated target rejected');
 const noRole=await P.inspectClient(client({status:{authInfo:{authenticatedUsers:users}}}));
 test(!noRole.technicalPreflightPassed,'missing privilege list rejected');
 const errorClient=client();
 const raw=errorClient.db.bind(errorClient);
 errorClient.db=name=>name==='admin'?{command:async()=>{throw Error('permission denied')}}:raw(name);
 const denied=await P.inspectClient(errorClient);
 test(!denied.permissionReady&&!denied.technicalPreflightPassed,'connectionStatus denial fails closed');
 console.log('R95 MongoDB read-only credential preflight PASS: '+checks+' controls');
})().catch(e=>{console.error(e);process.exitCode=1});
