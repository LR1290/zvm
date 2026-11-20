const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
function load(module,env,regions){
 const source=fs.readFileSync(path.join(process.argv[2],'app/content/features',module),'utf8');
 for(const [start,end] of regions){
  const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);
  vm.runInNewContext(source.slice(a,b),env);
 }
}
(async()=>{
 const flow={extTrackFlowError(){}};
 load('flows/engine.js',flow,[['var FLOW_ACTIVE_STATUSES','function isFlowCancellationError']]);
 for(const status of ['running','waitingDelay','paused']){
  const rows=['preparing','dispatching'].map(phase=>({status,pendingRemoteAction:{phase}}));
  assert.equal(flow.quarantinePendingFlowEffects(rows),2);assert.equal(rows[0].status,'paused');
  assert.equal(rows[1].status,'error');assert.equal(rows[1].needsAttention,true);
  assert.equal(flow.quarantinePendingFlowEffects(rows),0);
 }
 let state,steps=0;
 const funnel={withRunningLock:fn=>fn({assertActive(){},isActive:()=>true}),loadRunning:async()=>structuredClone(state),
  saveRunning:async rows=>{state=structuredClone(rows)},loadFunnels:async()=>[],window:{__extPlanGate:{isRestricted:async()=>false}},
  extTrackFunnelInstance(){},pendingMacroAutomationRun:()=>false,retainFunnelExecutions:x=>x,executeFunnelStep:async()=>{steps++;}};
 load('funnels/engine.js',funnel,[['function runTick()','var FUNNEL_SCHEDULER_MAX_ACTIVE_WAIT_MS']]);
 for(const command of [null,'pause','cancel']){
  state=['preparing','dispatching'].map((phase,i)=>({id:String(i),status:'running',pendingRemoteStep:{phase},controlIntent:command?{command}:null}));
  await funnel.runTick();await funnel.runTick();
  assert.equal(state[0].status,command==='cancel'?'cancelled':'paused');assert.equal(state[1].status,'error');assert(state[1].needsAttention);assert.equal(steps,0);
 }
 const queue={window:{},processing:false,paused:false,cancelled:false,processGeneration:0,broadcastRuntime:{},
  ensureBulkProcessorReady:async()=>{},requireBulkQueueScope:async()=>{},readQueue:async()=>structuredClone(state),queueCampaignId:()=> 'qa',
  holdBulkQueueForManualReview:async()=>{},reportRuntime(){},toast(){},bulkUserErrorMessage:()=>'',bulkError:(code,msg)=>Object.assign(Error(msg),{code})};
 load('broadcast/panel.js',queue,[['function bulkQueueNeedsManualReview','async function holdBulkQueueForManualReview'],['async function processQueueOwned','async function processQueue()']]);
 for(const [row,code] of [[{state:'sending',actionAttemptToken:'qa'},'BULK_INFLIGHT_RECOVERY_HOLD'],[{state:'error',remoteEffectUncertain:true},'BULK_REVIEW_REQUIRED']]){
  queue.paused=false;state=[row];assert.equal(await queue.processQueueOwned(),'error');assert.equal(queue.broadcastRuntime.bulkProcessorLastError.code,code);assert(queue.paused);
 }
 console.log('PASS Fluxos: 3 active states x preparing/dispatching, second recovery idempotent');
 console.log('PASS Funis: actual tick twice x restart/pause/cancel; no second step after ambiguous marker');
 console.log('PASS Disparos: processor holds admitted and uncertain rows before iterating recipients');
})().catch(e=>{console.error(e);process.exitCode=1});
