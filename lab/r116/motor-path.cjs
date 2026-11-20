const {setup}=require('./durable-path.cjs');
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.argv[2];
function functions(folder,regions){
 const source=fs.readFileSync(path.join(root,'app/content/features',folder),'utf8');
 return regions.map(([start,end])=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b)}).join('\n');
}
const sources={
 flows:functions('flows/engine.js',[['function requiresFlowEffectReview','function flowErrorFallbackNodeId'],['async function executeSharedActions','async function sendTextThroughFlowPipeline']]),
 funnels:functions('funnels/engine.js',[['function funnelExecutorThrownError','function funnelJobQueue'],['function funnelDispatchGuard','async function sendTextThroughFunnelPipeline'],['async function sendFunnelItem','var DELAY_UNIT_MS']]),
 followup:functions('followup/engine.js',[['async function dispatch','function enqueue(']]),
 broadcast:functions('broadcast/panel.js',[['function requireBulkSafetyAttestation','function bulkItemExecutionTimeoutMs'],['function bulkAssertStaticInlineMedia','async function bulkPreflightRecipient'],['async function sendQueueItem','function bulkRetryLimit']])
};
async function exercise(page,motor){
 return page.evaluate(async ({motor,source})=>{
  const actions=[{id:'act',type:'txt',properties:{mensagem:'fixture',aguarde:0,composing:0}}];
  const whatsappScope='a'.repeat(64),chatId='00000000000@c.us',lease={assertActive(){},assertDispatchAuthorized:async()=>{}};
  window.__extFunnelActionWhatsappIdentity={currentScope:async()=>whatsappScope};
  window.__extQuickResponseService={nativeToActions:async()=>actions};
  window.failAck=true;window.calls=0;window.transition=[];
  const instance={id:'instance-'+motor,status:'running',flowId:'flow',chatId,whatsappScope,currentItemIndex:0,pendingRemoteStep:{phase:'preparing'}};
  const loadRunning=async()=>[structuredClone(instance)],saveRunning=async()=>{},ensureExecutionActive=async()=>{},
   verifyFlowSenderScope=async()=>{},verifyFunnelSenderScope=async()=>{},persistPendingFlowRemoteAction=async row=>{row.pendingRemoteAction={phase:'preparing'};},
   promotePendingFlowRemoteAction=async row=>{row.pendingRemoteAction.phase='dispatching';},
   funnelRuntime={activeActionExecutions:new Map()},flowRuntime={activeActionExecutions:new Map(),activeActionExecutionChats:new Map()},
   actionsForRule=async()=>actions,resolveTarget=async()=>chatId,allowsGroup=()=>true,requireBulkWhatsappScope=async()=>whatsappScope,
   bulkError=(code,msg)=>Object.assign(Error(msg),{code});
  let activeActionExecutionId=null;
  const entry={id:'follow',chatId,whatsappScope};
  const item={actions,whatsappScope,phoneNumber:'00000000000',campaignId:'qa',effectExecutionId:'bulk:qa',state:'sending',
   actionAttemptToken:'synthetic',safetyAttestation:{consentConfirmed:true,optOutReviewed:true,policyRevision:2}};
  const call={
   flows:'executeSharedActions(actions,chatId,instance,"flow-runtime",lease,"qa")',
   funnels:'sendFunnelItem({type:"message",itemId:"fixture"},chatId,lease,instance)',
   followup:'dispatch({id:"rule",actions},entry,lease)',
   broadcast:'(async()=>{item.compiledPlanDigest=await bulkAuthorizedPlanDigest(item,actions);return sendQueueItem(item,async()=>{},null,actions,{chatId,whatsappScope,phoneNumber:item.phoneNumber});})()'
  }[motor];
  let error;
  try{await eval('(async()=>{'+source+';return '+call+'})()');}catch(e){error=e;}
  return {motor,calls:window.calls,transitions:window.transition,code:error?.code,message:error?.code?undefined:error?.message};
 },{motor,source:sources[motor]});
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
 try{
  const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({body:'<title>QA</title>',contentType:'text/html'}));await page.goto('https://local-qa.invalid');
  for(const motor of Object.keys(sources)){
   await page.reload();await setup(page);const first=await exercise(page,motor);
   await page.reload();await setup(page);const replay=await exercise(page,motor);console.log(JSON.stringify({first,replay}));
   assert.equal(first.calls,1);assert.equal(replay.calls,0);assert.equal(first.code,'SEND_EFFECT_AMBIGUOUS');assert.equal(replay.code,first.code);
   assert.deepEqual(first.transitions,['effect_prepare','effect_begin','effect_ambiguous']);assert.deepEqual(replay.transitions,['effect_prepare']);
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
