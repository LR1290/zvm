const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const tree=process.argv[2];
function region(file,from,to,env={}){
 const s=fs.readFileSync(path.join(tree,'app/content/features',file),'utf8');
 const a=s.indexOf(from),b=s.indexOf(to,a);assert(a>=0&&b>a);
 vm.runInNewContext(s.slice(a,b),env);return env;
}
(async()=>{
 const item={id:'x',flowId:'f',chatId:'c'};
 const state={cancelledExecutionIds:new Set(),pausedExecutionIds:new Set()};
 let command='pause';
 const flow=region('flows/engine.js','async function applyPersistedFlowControlIntent','async function reflectWorkerFlowStop',{flowRuntime:state,loadRunning:async()=>[{...item,controlIntent:{command}}]});
 assert(await flow.applyPersistedFlowControlIntent(item));assert(state.pausedExecutionIds.has('x'));
 command='cancel';assert(await flow.applyPersistedFlowControlIntent(item));assert(state.cancelledExecutionIds.has('x'));
 const fallback=region('flows/engine.js','function requiresFlowEffectReview','function matchesKeywordRule',{window:{},isFlowCancellationError:()=>false});
 const graph={nodes:[{id:'retry'}]},node={id:'x',data:{errorFallbackNodeId:'retry'}};
 for(const evidence of [{remoteEffectUncertain:true},{remoteEffectSucceeded:true},{effectDigest:'proof'}])
  assert.equal(fallback.flowErrorFallbackNodeId(graph,node,evidence),'');
 assert.equal(fallback.flowErrorFallbackNodeId(graph,node,{}),'retry');
 const funnel=region('funnels/engine.js','function funnelActionResultError','function funnelJobQueue');
 for(const result of [null,{status:'cancelled',effectDigest:'proof'},{status:'cancelled',remoteActionsSucceeded:1},{status:'error',error:{remoteEffectUncertain:true}}])
  assert.equal(funnel.funnelActionResultError(result,'ERR','error').durableReviewRequired,true);
 const follow=region('followup/engine.js','function isDue','async function fireDue');
 assert(!follow.isDue({status:'pending',trigger:'enter',durableReviewRequired:true},{},1));
 const dispatch=region('followup/engine.js','async function dispatch','function enqueue(',{
  window:{__extActionExecutor:{execute:async()=>null},__extFunnelActionWhatsappIdentity:{currentScope:async()=>'a'.repeat(64)}},resolveTarget:async()=>'qa',allowsGroup:()=>true,actionsForRule:async()=>['qa']});
 await assert.rejects(dispatch.dispatch({actions:['qa']},{id:'qa',whatsappScope:'a'.repeat(64)}),e=>e.remoteEffectUncertain===true&&e.durableReviewRequired===true);
 const s=fs.readFileSync(path.join(tree,'app/content/features/broadcast/panel.js'),'utf8');
 const a=s.indexOf('if(!sequenceResult||sequenceResult.status!=="success")'),b=s.indexOf('item.actionSucceeded=totalActions',a);
 for(const result of [null,{status:'cancelled',remoteActionsSucceeded:1}]){
  assert.throws(()=>vm.runInNewContext(s.slice(a,b),{sequenceResult:result,item:{actionSucceeded:0},startIndex:0,totalActions:2}),e=>result?e.remoteEffectSucceeded===true:e.remoteEffectUncertain===true);
 }
 console.log('PASS Fluxos: pause/cancel persisted intent and fallback guard');
 console.log('PASS Funis: cancel with digest, partial success, uncertain or missing result');
 console.log('PASS Follow-up: restored pending+review held, missing executor response marked uncertain');
 console.log('PASS Disparos: partial sequence and absent executor result retain remote evidence');
})().catch(e=>{console.error(e);process.exitCode=1});
