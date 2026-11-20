const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
 try{
  const page=await browser.newPage({offline:true});
  await page.addScriptTag({content:fs.readFileSync(path.join(process.argv[2],'app/content/core/action-engine.js'),'utf8')});
  const result=await page.evaluate(async()=>{
   const api=window.__extActionExecutor;
   let count=0,ack,start;
   const entered=new Promise(r=>{start=r});
   window.__extPlanGate={requireActive:async()=>({isPaid:true})};
   window.__extSendSafetyManager={enqueue:(_,f)=>f()};
   window.__extWppBridge={invoke:()=>{count++;start();return new Promise((_,reject)=>{ack=reject});}};
   const msg={type:'txt',properties:{aguarde:0,composing:0,mensagem:'fixture'}};
   api.registerAdapter('QuickReplyResolver',{resolve:async()=>[msg]});
   const ctx={source:'followup',contactId:'fixture@c.us',executionId:'same'};
   const run=api.execute([{type:'respostaRapida'},msg],ctx);
   await entered;
   const duplicate=await api.execute([msg],ctx).then(()=>'',e=>e.code);
   const pause=api.pause('same'),resume=api.resume('same'),cancel=api.cancel('same');
   let finished=false;run.then(()=>{finished=true});
   await new Promise(r=>setTimeout(r,25));
   const beforeAck=finished;
   ack(Object.assign(new Error('offline after dispatch'),{code:'SEND_TASK_ACK_TIMEOUT',remoteEffectUncertain:true}));
   const final=await run;
   return {count,duplicate,pause,resume,cancel,beforeAck,status:final.status,uncertain:final.error?.remoteEffectUncertain};
  });
  console.log(JSON.stringify(result));
  assert.equal(result.count,1);assert.equal(result.duplicate,'ACTION_EXECUTION_IN_PROGRESS');
  assert.equal(result.beforeAck,false);assert.equal(result.uncertain,true);assert.equal(result.status,'error');
  assert.equal(result.pause,'paused');assert.equal(result.cancel,'cancelled');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
