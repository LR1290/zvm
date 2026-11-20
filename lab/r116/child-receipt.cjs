const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 for(const [index,tree] of process.argv.slice(2).entries()){
  const s=fs.readFileSync(path.join(tree,'app/content/features/followup/engine.js'),'utf8');
  for(const kind of ['flow','funnel','direct','local']){
   const scope='a'.repeat(64),q={id:'queue',followUpId:'r',status:'pending',trigger:'enter',whatsappScope:scope};
   const events=[],childId='followup-'+kind+':queue';
   const env={window:{__extFunnelActionWhatsappIdentity:{currentScope:async()=>scope},__extFluxosStartFlowManually:async()=>({status:'waitingDelay',executionId:childId}),
    __extFunnelsStartManually:async()=>({id:childId,status:'running'}),__extActionExecutor:{execute:async()=>({status:'success',remoteEffectSucceeded:kind==='direct'})},
    __extDataMutationClient:{followup:async(_,p)=>({item:{...q,status:'sending',attemptToken:p.attemptToken}})}},
    resolveTarget:async()=>'fixture',allowsGroup:()=>true,actionsForRule:async()=>['fixture'],started:true,pageSuspended:false,lifecycleEpoch:1,cancelledFollowupIds:new Set()};
   const range=(a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
   vm.runInNewContext(range('async function dispatch','function enqueue(')+range('function isTickCurrent','async function publishFollowUpOutcomes'),env);
   await env.fireDue([{id:'r',active:true,sendType:kind}],[q],1,null,1,events);
   const expectedSent=!index||kind==='direct';
   assert.equal(q.status,expectedSent?'sent':'processed');
   assert.equal(events[0].name,expectedSent?'FollowUpSent':'FollowUpProcessed');
   if(index&&['flow','funnel'].includes(kind))assert.equal(q.childExecutionId,childId);
   console.log(JSON.stringify({version:index?'candidate':'base',kind,status:q.status,event:events[0].name}));
  }
 }
})().catch(e=>{console.error(e);process.exitCode=1});
