'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=process.argv[2],read=f=>fs.readFileSync(path.join(root,f),'utf8');
const safety=read('app/content/core/send-safety.js');
function region(from,to){const a=safety.indexOf(from),b=safety.indexOf(to,a);assert(a>=0&&b>a);return safety.slice(a,b);}
const safetyCode=[
 region('async function safetyDigest','function coordinatorRequest('),
 region('async function durablePayloadDigest','function trimWindows'),
 region('function isRemoteConfirmationUncertain','function recordFailure'),
 region('async function ensureSenderScope','function enqueue(')
].join('\n');
async function setup(page){
 await page.addScriptTag({content:read('app/background/authority/send-effect-journal.js')});
 await page.evaluate(code=>{
  const metrics={ambiguous:0,recovered:0},MAX_EFFECT_PAYLOAD_DEPTH=32,MAX_EFFECT_PAYLOAD_NODES=8192;
  const makeError=(code,msg,data)=>Object.assign(Error(msg),{code,...data});
  const emitHealth=()=>{},recipientKey=x=>x,reportRuntimeError=(c,e)=>{throw e};
  const isBulkSend=m=>m.source==='bulk';
  const ensureSettingsReady=async()=>{},ensureSuppressionReady=async()=>{},ensureNotSuppressed=async()=>{},
    ensureQuietHours=()=>{},ensureCircuit=async()=>{},ensureRecipientCooldown=()=>{},ensureCampaign=()=>{},
    ensureGlobalPause=()=>{},waitRateLimits=async()=>{},reserveGlobalSafety=async()=>null,recordFailure=()=>{},recordSuccess=()=>{},
    ensureCompatible=async()=>{},ensureSessionReady=async()=>{};
  const journal=window.__extSendEffectJournalAuthority,auth={ownerHash:'a'.repeat(64),verify:async()=>{}};
  const methods={effect_prepare:'prepare',effect_begin:'begin',effect_commit:'commit',effect_fail:'fail',effect_ambiguous:'markAmbiguous'};
  async function coordinatorRequestRetry(payload){
   const result=await journal[methods[payload.action]](payload,auth);
   window.transition.push(payload.action);
   return result;
  }
  window.transition=[];window.calls=0;
  window.__extSendSafetyManager={enqueue:eval('(()=>{'+code+';return runJob})()')};
  window.__extPlanGate={requireActive:async()=>({isPaid:true})};
  window.__extWppBridge={invoke:async()=>{window.calls++;if(window.failAck)throw makeError('WPP_RPC_ACK_UNCERTAIN','fixture');return {ok:true}}};
 },safetyCode);
 await page.addScriptTag({content:read('app/content/core/action-engine.js')});
}
async function exercise(page,source,failAck){
 return page.evaluate(async({source,failAck})=>{
  window.transition=[];window.calls=0;window.failAck=failAck;
  const result=await window.__extActionExecutor.execute([{id:'action',type:'txt',properties:{aguarde:0,composing:0}}],
    {source,executionId:source+(failAck?'lost':'delivered'),contactId:'fixture@c.us'});
  return {source,failAck,calls:window.calls,status:result.status,code:result.error?.code,transitions:window.transition};
 },{source,failAck});
}
module.exports={setup};
if(require.main===module)(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
 try{
  const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({body:'<title>QA</title>',contentType:'text/html'}));
  await page.goto('https://local-qa.invalid');await setup(page);
  for(const source of ['flow-runtime','funnel','bulk','followup']){
   for(const fail of [true,false]){
    const first=await exercise(page,source,fail);assert.equal(first.calls,1);
    assert.deepEqual(first.transitions,['effect_prepare','effect_begin',fail?'effect_ambiguous':'effect_commit']);
    await page.reload();await setup(page);
    const replay=await exercise(page,source,fail);
    assert.equal(replay.calls,0);assert.equal(replay.status,fail?'error':'success');
    assert.deepEqual(replay.transitions,['effect_prepare']);if(fail)assert.equal(replay.code,'SEND_EFFECT_AMBIGUOUS');
    console.log(JSON.stringify({first,replay}));
   }
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
