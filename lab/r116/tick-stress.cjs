const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
 try{
  for(const [index,tree] of process.argv.slice(2).entries()){
   const page=await browser.newPage({offline:true});
   await page.evaluate(()=>{
    let reads=0,subscriptions=0,completed=0;const events=new Map();
    window.stats=()=>({reads,subscriptions,completed});
    window.__extEventBus={on:(key,fn)=>{events.set(key,fn);subscriptions++;return()=>{events.delete(key);subscriptions--}},
     emit:key=>{if(key==='FollowUpTickCompleted')completed++;}};
    window.ExtensionStorage={get:async()=>{reads++;return null},subscribe:()=>{subscriptions++;return()=>{subscriptions--}}};
    window.__extBootPhases={when:()=>{}};
   });
   await page.addScriptTag({content:fs.readFileSync(path.join(tree,'app/content/features/followup/engine.js'),'utf8')});
   for(const n of [1,10,100,1000,10000]){
    const result=await page.evaluate(async n=>{
     const api=window.__extFollowUpService;api.start();await api.runTick('warm');
     const before=stats(),start=performance.now();await Promise.all(Array.from({length:n},()=>api.runTick('fixture')));
     const total=performance.now()-start,after=stats();api.stop();
     return {n,reads:after.reads-before.reads,ticks:after.completed-before.completed,ms:total,active:after.subscriptions,afterStop:stats().subscriptions};
    },n);
    assert.equal(result.ticks,index?1:n);assert.equal(result.reads,result.ticks*2);assert.equal(result.afterStop,0);
    console.log(JSON.stringify({version:index?'candidate':'base',...result}));
   }
   await page.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
