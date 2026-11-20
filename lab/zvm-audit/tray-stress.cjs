const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
 try{
  for(const [index,tree] of process.argv.slice(2).entries()){
   const page=await browser.newPage({offline:true});
   await page.addScriptTag({content:fs.readFileSync(path.join(tree,'app/sidebar/tray-motion.js'),'utf8')});
   const cdp=await page.context().newCDPSession(page);
   for(const count of [1,10,100,1000,10000]){
    const result=await page.evaluate(n=>{
     const node=document.createElement('div');document.body.append(node);node.hidden=true;
     const elapsed=[];let shown=0,clear=0;
     const tray=ExtensionUI.TrayMotion.create(node,{getDurationMs:()=>0,render:key=>{node.textContent=key},onShown:()=>shown++,onClear:()=>clear++});
     for(let i=0;i<n;i++){
      const start=performance.now();tray.request('local');tray.request(null);elapsed.push(performance.now()-start);
     }
     tray.dispose();node.remove();elapsed.sort((a,b)=>a-b);
     const pct=p=>elapsed[Math.ceil(n*p)-1];
     return {shown,clear,p50:pct(.5),p95:pct(.95),p99:pct(.99),max:pct(1),disposed:tray.status()==='disposed'};
    },count);
    assert.equal(result.shown,count);assert.equal(result.clear,count);assert.ok(result.disposed);
    await cdp.send('HeapProfiler.collectGarbage');
    const counters=await cdp.send('Memory.getDOMCounters');
    console.log(JSON.stringify({revision:['R112','R113','R114','candidate'][index],count,...result,...counters}));
   }
   await page.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
