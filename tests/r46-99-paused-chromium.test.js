'use strict';
// R46.99 paused sales UI: 4 readonly page fixtures, no real purchases or external network.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
process.env.ZVM_SALES_PAUSED='1';process.env.RENDER='true';
process.env.ADMIN_USER='paused-chromium-qa';process.env.ADMIN_PASS='offline-fixture-only';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/r4699_paused_chromium';
const native=Module._load;let api;
try{Module._load=function(id,...args){if(id==='mongodb')return{MongoClient:class MockMongo{}};return native.call(this,id,...args)};api=require(path.join(root,'server.js')).__test;}finally{Module._load=native}
const user={email:'demo@example.invalid',name:'QA Buyer',keyCode:'zv-qa-only'};
const pages=[['home',api.renderStandaloneLandingPage(null)],
 ['plans-guest',api.renderPlanosPage(null)],
 ['plans-member',api.renderPlanosPage(user)],
 ['portal-renew',api.renderPortalPlans(user,{planId:'solo',maxUses:1})]];
const out=path.join(root,'artifacts','visual-qa');fs.mkdirSync(out,{recursive:true});
async function run(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});let count=0;
 try{
  for(const [label,html] of pages)for(const width of [1440,390,320]){
   const page=await browser.newPage({viewport:{width,height:width===1440?900:760},deviceScaleFactor:1,reducedMotion:'reduce'});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='zvm.local'){await route.abort();return}
    if(url.pathname==='/'+label+'-qa'){await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html});return}
    if(url.pathname.startsWith('/assets/')){
      const name=path.basename(decodeURIComponent(url.pathname));
      if(!/^[a-zA-Z0-9_.-]+$/.test(name)){await route.fulfill({status:400,body:'Invalid asset'});return}
      const fp=path.join(root,'assets',name);
      if(!fs.existsSync(fp)){await route.fulfill({status:404,body:'Missing asset '+name});return}
      await route.fulfill({status:200,contentType:name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'application/octet-stream',body:fs.readFileSync(fp)});return;
    }
    await route.fulfill({status:404,body:'No external services'});
   });
   await page.goto('http://zvm.local/'+label+'-qa',{waitUntil:'load'});
   await page.waitForTimeout(110);
   assert.deepEqual(errors,[],label+'/'+width+' JS runtime');
   assert(await page.getByText(/Vendas temporariamente suspensas|Vendas e renovações temporariamente suspensas/).first().isVisible(),label+'/'+width+' missing pause notice');
   assert.equal(await page.locator('[data-buy-plan],[data-checkout],.checkout-dialog').count(),0,label+'/'+width+' live purchase still exposed');
   assert.equal(await page.locator('a[href^="https://pay.cakto.com.br/"]').count(),0,label+'/'+width+' provider URL leak');
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
   assert(overflow<=4,label+'/'+width+' horizontal overflow '+overflow);
   await page.screenshot({path:path.join(out,'r4699-pause-'+label+'-'+width+'.png'),fullPage:true,animations:'disabled'});
   count++;await page.close();
  }
  console.log('R46.99 CHROMIUM PAUSED PASS: '+count+' readonly snapshots, no checkout leaks, no page errors');
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1});
