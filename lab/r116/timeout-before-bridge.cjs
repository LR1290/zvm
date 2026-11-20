const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
 try{
  for(const [i,tree] of process.argv.slice(2).entries()){
   const page=await browser.newPage({offline:true});
   const safety=fs.readFileSync(path.join(tree,'app/content/core/send-safety.js'),'utf8');
   await page.addScriptTag({content:safety.slice(safety.indexOf('function extBoundedSendTask'),safety.indexOf('async function runJob'))});
   await page.addScriptTag({content:fs.readFileSync(path.join(tree,'app/content/core/action-engine.js'),'utf8')});
   const result=await page.evaluate(async()=>{
    window.makeError=(code,msg,extra)=>Object.assign(Error(msg),{code,...extra});
    let expire,release,entered,bridge=0;const waiting=new Promise(r=>{entered=r});
    const timer=window.setTimeout.bind(window);
    window.setTimeout=(cb,ms,...args)=>ms===90000?(expire=cb,0):timer(cb,ms,...args);
    window.__extPlanGate={requireActive:async()=>({isPaid:true})};
    window.__extWppBridge={invoke:async()=>{bridge++;return {ok:true}}};
    window.__extSendSafetyManager={enqueue:(meta,f)=>extBoundedSendTask(f,meta.method,false,meta.__extDispatchState)};
    const op=window.__extActionExecutor.execute([{type:'txt',properties:{aguarde:0,composing:0}}],{executionId:'fixture',contactId:'fixture@c.us',
     __extPreDispatchCheck:()=>{entered();return new Promise(r=>{release=r});}});
    await waiting;expire();const outcome=await op;
    release();await new Promise(r=>timer(r,10));
    return {status:outcome.status,code:outcome.error.code,bridge};
   });
   console.log(JSON.stringify({version:i?'candidate':'base',...result}));
   assert.equal(result.bridge,i?0:1);assert.equal(result.code,'SEND_TASK_ACK_TIMEOUT');
   await page.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
