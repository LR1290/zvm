const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(process.env.ZVM_LAB_SOURCE || path.join(__dirname,'../staging'),'app/content/core/send-safety.js'),'utf8');
const start=src.indexOf('  function extBoundedSendTask('),end=src.indexOf('  async function runJob(',start);
assert(start>=0&&end>start);
test('campaign timeout remains uncertain after late ACK and dispatches once',async()=>{
  let expire,finish,budget,calls=0;
  const env={setTimeout:(fn,ms)=>{expire=fn;budget=ms;return 1},clearTimeout:()=>{},makeError:(code,msg,extra)=>Object.assign(Error(msg),{code,...extra})};
  vm.runInNewContext(src.slice(start,end),env);
  const outcome=env.extBoundedSendTask(()=>{calls++;return new Promise(resolve=>{finish=resolve})},'sendTxt',true);
  await Promise.resolve();
  assert.equal(budget,240000);
  expire();
  await assert.rejects(outcome,e=>e.remoteEffectUncertain===true && e.code==='SEND_TASK_ACK_TIMEOUT');
  finish('ack'); await Promise.resolve();assert.equal(calls,1);
});
const panel=fs.readFileSync(path.join(process.env.ZVM_LAB_SOURCE || path.join(__dirname,'../staging'),'app/content/features/broadcast/panel.js'),'utf8');
const begin=panel.indexOf('  function bulkPreDispatchUnadmitted('), finish=panel.indexOf('  async function runBulkWatchdog(',begin);
assert(begin>=0&&finish>begin);
test('campaign recovery requeues only pre-dispatch delay',()=>{
  const env={};vm.runInNewContext(panel.slice(begin,finish),env);
  const delay={state:'sending',processorStage:'delay',delayStartedAt:1};
  assert.equal(env.bulkPreDispatchUnadmitted(delay),true);
  for(const evidence of [{actionAttemptToken:'pending'},{effectProofs:['receipt']},{remoteEffectUncertain:true},{remoteEffectSucceeded:true},{state:'paused'},{state:'cancelled'},{durableReviewRequired:true},{processorStage:'dispatch'}])
    assert.equal(env.bulkPreDispatchUnadmitted({...delay,...evidence}),false);
});
for(const [folder,kind,endMarker] of [['flows','Flow','  async function createBoundFlowInstance'],['funnels','Funnel','  // O armazenamento']]){
  test(kind+' refuses continuation after account switch or loss of identity',async()=>{
    const source=fs.readFileSync(path.join(process.env.ZVM_LAB_SOURCE || path.join(__dirname,'../staging'),'app/content/features',folder,'engine.js'),'utf8');
    const start=source.indexOf('  async function current'+kind+'SenderScope'),end=source.indexOf(endMarker,start);
    assert(start>=0&&end>start);
    let scope='a'.repeat(64);
    const env={window:{__extFunnelActionWhatsappIdentity:{currentScope:async()=>scope}},flowTerminalError:(code,msg)=>Object.assign(Error(msg),{code})};
    vm.runInNewContext(source.slice(start,end),env);
    const verify=env['verify'+kind+'SenderScope'],instance={whatsappScope:scope};
    await verify(instance);
    scope='b'.repeat(64);
    await assert.rejects(verify(instance),{code:kind.toUpperCase()+'_SENDER_SCOPE_CHANGED'});
    scope='';
    await assert.rejects(verify(instance),{code:kind.toUpperCase()+'_SENDER_SCOPE_UNAVAILABLE'});
  });
}
test('follow-up preserves uncertain effect across cancellation and next tick',async()=>{
  const src=fs.readFileSync(path.join(process.env.ZVM_LAB_SOURCE || path.join(__dirname,'../staging'),'app/content/features/followup/engine.js'),'utf8');
  const start=src.indexOf('  function isTickCurrent('),end=src.indexOf('  async function publishFollowUpOutcomes(',start);
  assert(start>=0&&end>start);
  const cancelled=new Set(),outcomes=[];
  let sends=0;
  const env={started:true,pageSuspended:false,lifecycleEpoch:1,cancelledFollowupIds:cancelled,
    window:{__extDataMutationClient:{followup:async(action,claim)=>{
      assert.equal(action,'queue_claim');
      return {item:{id:claim.id,status:'sending',attemptToken:claim.attemptToken}};
    }}},dispatch:async(rule,entry)=>{
      sends++;cancelled.add(entry.id);
      throw Object.assign(Error('ACK unavailable'),{remoteEffectUncertain:true});
    }};
  vm.runInNewContext(src.slice(start,end),env);
  const rules=[{id:'r',active:true}],queue=[{id:'q',followUpId:'r',status:'pending',trigger:'enter'}];
  await env.fireDue(rules,queue,1,null,1,outcomes);
  assert.equal(queue[0].durableReviewRequired,true);
  assert.equal(outcomes[0].name,'FollowUpFailed');
  await env.fireDue(rules,queue,2,null,1,outcomes);
  assert.equal(sends,1);
});
