const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
 try{
  for(const [index,tree] of process.argv.slice(2).entries()){
   const page=await browser.newPage({offline:true});
   await page.addScriptTag({content:fs.readFileSync(path.join(tree,'app/content/core/action-engine.js'),'utf8')});
   const result=await page.evaluate(async()=>{
    const results=[];
    for(const source of ['flow-runtime','funnel']){
     let scope='a'.repeat(64),calls=0;
     window.__extPlanGate={requireActive:async()=>({isPaid:true})};
     window.__extFunnelActionWhatsappIdentity={currentScope:async()=>scope};
     window.__extSendSafetyManager={enqueue:(job,f)=>f()};
     window.__extWppBridge={invoke:async()=>{calls++;return {ok:true}}};
     const outcome=await window.__extActionExecutor.execute([{type:'txt',properties:{mensagem:'fixture',aguarde:0,composing:0}}],{
      source,executionId:source,contactId:'fixture@c.us',whatsappScope:scope,__extPreDispatchCheck:async()=>{scope='b'.repeat(64);}
     });
     results.push({source,calls,status:outcome.status,code:outcome.error?.code});
    }
    return results;
   });
   console.log(JSON.stringify({version:index?'candidate':'base',result}));
   for(const row of result){assert.equal(row.calls,index?0:1);if(index)assert.equal(row.code,'SEND_SAFETY_SENDER_SCOPE_CHANGED');}
   await page.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
