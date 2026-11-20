'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
 try{
  for(const [index,tree] of process.argv.slice(2).entries()){
   const page=await browser.newPage({offline:true});
   await page.addScriptTag({content:fs.readFileSync(path.join(tree,'app/content/core/action-engine.js'),'utf8')});
   const rows=await page.evaluate(async()=>{
    window.__extPlanGate={requireActive:async()=>({isPaid:true})};
    window.__extSendSafetyManager={enqueue:(_,task)=>task()};
    let calls=0;
    window.__extWppBridge={invoke:async()=>{calls++;return {ok:true}}};
    const api=window.__extActionExecutor;
    const message={type:'txt',properties:{mensagem:'qa',aguarde:0,composing:0}};
    const unknown={type:'qa-unregistered-action'};
    api.registerAdapter('QuickReplyResolver',{resolve:async()=>[message,unknown]});
    const rows=[];
    for(const source of ['flow-runtime','funnel','bulk','followup']){
     for(const nested of [false,true]){
      const before=calls;
      const result=await api.execute(nested?[{type:'respostaRapida'}]:[message,unknown],{source,contactId:'fixture@c.us',executionId:source+nested});
      rows.push({source,nested,status:result.status,code:result.error?.code,evidence:result.error?.remoteEffectSucceeded===true,calls:calls-before});
     }
    }
    return rows;
   });
   console.log(JSON.stringify({version:index?'candidate':'base',rows}));
   for(const row of rows){assert.equal(row.calls,1);assert.equal(row.status,'error');assert.equal(row.code,'UNKNOWN_ACTION_TYPE');assert.equal(row.evidence,!!index);}
   await page.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
