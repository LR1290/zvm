const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
async function run(tree){
 const source=fs.readFileSync(path.join(tree,'app/content/features/followup/engine.js'),'utf8');
 const worker=fs.readFileSync(path.join(tree,'app/background/authority/offscreen-options-data.js'),'utf8');
 const rule={id:'r',active:true};
 let rows=[],sends=0,membership={schemaVersion:1,rules:{}};
 const events=[];
 const authority={extServerAuthorityRequire:async()=>{},extPlanRequirePaidBg:async()=>{},readFollowRules:async()=>({rows:[rule]}),
  followRuleInput:x=>structuredClone(x),followQueueInput:x=>structuredClone(x),readFollowQueue:async()=>({rows:structuredClone(rows)}),txt:(v,n)=>String(v??'').slice(0,n),
  extError:(code,msg)=>Object.assign(Error(msg),{code}),compactFollowQueue:x=>x,followReplace:(_,field,list)=>list,
  FOLLOWUP_QUEUE_KEY:'q',FOLLOWUP_MEMBERSHIP_KEY:'m',FOLLOWUP_TERMINAL_MAX:300,FOLLOWUP_TERMINAL_MAX_AGE_MS:2592000000,
  readFollowMembership:async()=>structuredClone(membership),followMembership:x=>structuredClone(x),
  writeFollowBatch:async values=>{rows=structuredClone(values.q);if(values.m)membership=JSON.parse(values.m);}};
 vm.runInNewContext(worker.slice(worker.indexOf('function followStatusTerminal'),worker.indexOf('function followReplace'))+
  worker.slice(worker.indexOf('function mergeFollowQueue'),worker.indexOf('async function mutateFollowup')),authority);
 vm.runInNewContext(worker.split('\n').find(l=>l.startsWith('async function mutateFollowup(')),authority);
 const client=async(action,payload)=>{
  events.push(action);
  return authority.mutateFollowup(action,payload,'scope');
 };
 const context={queuedTick:null,tickMutex:Promise.resolve(),repo:()=>({accountScopeId:async()=>'scope'}),window:{__extPlanGate:{isRestricted:async()=>false},__extFunnelActionWhatsappIdentity:{currentScope:async()=>'a'.repeat(64)},__extDataMutationClient:{followup:client},__extWithAutomationLease:(_,f)=>f({isActive:()=>true,assertActive(){}}),
  __extReportRuntimeError:(_,e)=>events.push(e.code||e.message)},queueStateMutation:f=>Promise.resolve().then(f),started:true,pageSuspended:false,lifecycleEpoch:1,
  cancelledFollowupIds:new Set(),loadRules:async()=>[rule],loadQueue:async()=>structuredClone(rows),loadMembership:async()=>({}),loadCrm:async()=>[],
  syncMembership:async(_,__,queue)=>{if(queue.length)return{};queue.push({id:'q1',followUpId:'r',trigger:'enter',status:'pending'});return{queueChanged:true,membershipChanged:true};},
  emit:name=>events.push(name),dispatch:async()=>{sends++;throw Object.assign(Error('lost ACK'),{remoteEffectUncertain:true});}};
 vm.runInNewContext(source.slice(source.indexOf('function isTickCurrent('),source.indexOf('async function cancelOnReply')),context);
 await context.runTick('event');await context.runTick('restart');
 return {events,sends,status:rows[0]?.status,review:rows[0]?.durableReviewRequired};
}
(async()=>{
 for(const [index,tree] of process.argv.slice(2).entries()){
  const result=await run(tree);console.log(JSON.stringify(result));
  if(!index){assert(result.events.includes('FOLLOWUP_QUEUE_NOT_FOUND'));assert.equal(result.sends,0);}
  else{assert.equal(result.sends,1);assert.equal(result.status,'error');assert.ok(result.review);assert.equal(result.events.filter(e=>e==='FollowUpFailed').length,1);}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
