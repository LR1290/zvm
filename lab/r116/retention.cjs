const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
 try{
  const page=await browser.newPage({offline:true});
  await page.addScriptTag({content:fs.readFileSync(path.join(process.argv[2],'app/content/core/action-engine.js'),'utf8')});
  const client=await page.context().newCDPSession(page);
  const start=Date.now();
  async function sample(label){
   await client.send('HeapProfiler.collectGarbage');
   const heap=await client.send('Runtime.getHeapUsage'),dom=await client.send('Memory.getDOMCounters');
   console.log(JSON.stringify({label,ms:Date.now()-start,heap:heap.usedSize,...dom,...await page.evaluate(()=>({rpc:window.rpc,observerAllocations:window.observerAllocations,retained:!!window.__extActionExecutor.getExecution('qa-0')}))}));
  }
  await page.evaluate(()=>{
   window.rpc=0;window.observerAllocations=0;
   window.MutationObserver=class extends MutationObserver{constructor(...args){super(...args);window.observerAllocations++}};
   window.__extPlanGate={requireActive:async()=>{window.rpc++;return {isPaid:true}}};
  });
  await sample('baseline');
  await page.evaluate(async()=>{for(let i=0;i<10000;i++)await window.__extActionExecutor.execute([],{executionId:'qa-'+i});});
  await sample('burst');
  const minutes=Number(process.argv[3]||0);
  for(let m=1;m<=minutes;m++){
   const until=start+m*60000;
   while(Date.now()<until){
    await page.evaluate(async()=>{for(let i=0;i<25;i++)await window.__extActionExecutor.execute([],{executionId:'loop-'+window.rpc});});
    await new Promise(r=>setTimeout(r,Math.min(5000,Math.max(0,until-Date.now()))));
   }
   await sample('minute-'+m);
  }
  await new Promise(r=>setTimeout(r,62000));await sample('after-retention');
  assert.equal(await page.evaluate(()=>window.__extActionExecutor.getExecution('qa-0')),null);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
