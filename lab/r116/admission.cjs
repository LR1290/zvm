const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 for(const [i,tree] of process.argv.slice(2).entries()){
  const s=fs.readFileSync(path.join(tree,'app/content/features/broadcast/panel.js'),'utf8');
  let approved=true,writes=0;const scope='a'.repeat(64);
  const env={window:{__extPlanGate:{requirePaid:async()=>{}},__extSendSafetyManager:{preflightRecipients:async()=>({ok:true,allowedRecipients:['00000000000']})}},
   bulkCurrentWhatsappScope:async()=>scope,requireBulkWhatsappScope:async()=>{},traceBulkStage(){},pacedDelayMs:()=>0,
   bulkError:(code,msg)=>Object.assign(Error(msg),{code}),bulkCancelFlight:null,REMOTE_CANCEL_KEY:'cancel',REMOTE_PAUSE_KEY:'pause',
   extStorageGet:async key=>{if(key==='pause')approved=false;return null;},startQueue:async()=>{writes++;throw Object.assign(Error('fixture boundary'),{code:'ADMITTED'})}};
  const a=s.indexOf('async function enqueueAndStart(');vm.runInNewContext(s.slice(a,s.indexOf('var applyMessageVariables',a)),env);
  const state={consentConfirmed:true,optOutReviewed:true,contactEntries:[{value:'00000000000'}],selectedType:'message'};
  await assert.rejects(env.enqueueAndStart(state,()=>approved),{code:i?'BULK_PLAN_REVIEW_CHANGED':'ADMITTED'});
  assert.equal(writes,i?0:1);console.log(JSON.stringify({version:i?'candidate':'base',queueStartsAfterWithdrawal:writes}));
 }
})().catch(e=>{console.error(e);process.exitCode=1});
