const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
 try{
  for(const [index,tree] of process.argv.slice(2).entries()){
   const page=await browser.newPage({offline:true});
   const source=fs.readFileSync(path.join(tree,'app/shared/core/theme-system.js'),'utf8');
   const code=source.slice(source.indexOf('function scheduleAutoThemeRefresh()'),source.indexOf('var startAutoThemeFallback'));
   const result=await page.evaluate(async code=>{
    document.body.innerHTML='<main id="app"></main>';
    const old=document.querySelector('#app');let notify, refreshes=0;
    const root={MutationObserver,document,__extWhatsAppStructureBroker:{subscribe:(k,fn)=>{notify=fn}}};
    Function('root','refreshAutoTheme','var _autoThemeTimer=0;'+code)(root,()=>refreshes++);
    old.replaceWith(Object.assign(document.createElement('main'),{id:'app'}));notify();
    const wait=()=>new Promise(resolve=>setTimeout(resolve,220));
    await wait();const initial=refreshes;
    old.className='obsolete';await wait();const stale=refreshes-initial;
    document.querySelector('#app').className='dark';await wait();
    return {staleRefreshes:stale,currentRefreshes:refreshes-initial-stale};
   },code);
   console.log(JSON.stringify(result));assert.equal(result.currentRefreshes,1);assert.equal(result.staleRefreshes,index===0?1:0);
   await page.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
