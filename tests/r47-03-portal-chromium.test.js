'use strict';
// R47.03: offline Chromium checks for paused-sales communication, mobile and keyboard.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
process.env.ZVM_SALES_PAUSED='1';
process.env.RENDER='true';
process.env.ADMIN_USER='r4703-chromium-fixture';
process.env.ADMIN_PASS='r4703-not-real';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/zvm_r4703_browser';
const original=Module._load;
let api;
try{
 Module._load=function(id,...args){
  if(id==='mongodb')return{MongoClient:class OfflineMongo{}};
  return original.call(this,id,...args);
 };
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=original}
const {localizePublicHtml}=require('../src/web/public/i18n');
const user={name:'Cliente Teste',email:'buyer@example.invalid',_id:'buyer@example.invalid',verified:true};
const key={code:'r4703-expired-fixture',label:'Cliente de laboratório',planId:'solo',active:false,
 maxUses:1,phones:[],expiresAt:'2026-02-01T00:00:00.000Z',createdAt:'2026-01-01T00:00:00.000Z'};
const faq=api.renderStandaloneFaqPage(null);
const scenarios=[
 ['cliente-expirada',api.renderPortalDashboard(user,key,'','')],
 ['admin',api.renderAdminDashboard({keysSnapshot:{[key.code]:key},portalUsers:[],portalUserCount:0})],
 ['faq-pt',faq],
 ['faq-en',localizePublicHtml(faq,'en',{path:'/faq'})],
 ['planos',api.renderPlanosPage(null)]
];
const out=path.join(root,'artifacts','visual-qa');fs.mkdirSync(out,{recursive:true});
async function main(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 let count=0;
 try{
  for(const [name,html] of scenarios)for(const width of [1440,768,390,320]){
   const page=await browser.newPage({viewport:{width,height:width>800?900:760},reducedMotion:'reduce'});
   let errors=[],external=0;
   page.on('pageerror',e=>errors.push(String(e.message)));
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='zvm.local'){external++;await route.abort();return;}
    if(url.pathname==='/'+name+'-r4703'){
     await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html});return;
    }
    if(url.pathname.startsWith('/assets/')){
     const base=path.basename(decodeURIComponent(url.pathname));
     if(!/^[a-zA-Z0-9_.-]+$/.test(base)){await route.fulfill({status:400,body:'Bad name'});return}
     const local=path.join(root,'assets',base);
     if(!fs.existsSync(local)){await route.fulfill({status:404,body:'Missing fixture asset'});return}
     const ext=path.extname(local),type=ext==='.css'?'text/css':ext==='.js'?'text/javascript':ext==='.svg'?'image/svg+xml':ext==='.png'?'image/png':'application/octet-stream';
     await route.fulfill({status:200,contentType:type,body:fs.readFileSync(local)});return;
    }
    if(url.pathname.endsWith('/api/data')){
     await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,totalKeys:1,activeKeys:0,suspectKeys:0,keysHtml:'',logsHtml:'',totalLogs:0})});return;
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,users:[],ips:[]})});
   });
   await page.addInitScript(()=>{try{localStorage.clear()}catch(_){}});
   await page.goto('http://zvm.local/'+name+'-r4703',{waitUntil:'load'});
   await page.waitForTimeout(160);
   assert.deepEqual(errors,[],name+' '+width+' page errors');
   assert.equal(external,0,name+' '+width+' external request');
   const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:window.innerWidth}));
   assert(size.scroll<=width+4,name+' '+width+' horizontal overflow: '+JSON.stringify(size));
   if(name==='cliente-expirada'){
    assert.equal(await page.locator('.expiry-alert-cta').innerText(),'Consultar planos');
    assert(await page.locator('.expiry-alert-text').innerText().then(x=>x.includes('suspensas')));
    assert.equal(await page.locator('.client-nav a[aria-current="page"]').count(),1);
    assert.equal(await page.locator('a[href="/cliente/planos"].primary').innerText(),'Consultar planos');
   }
   if(name==='admin'){
    const button=page.locator('#hdr-suspect-badge');
    assert.equal(await button.evaluate(e=>e.tagName),'BUTTON');
    await button.focus();
    assert.equal(await button.evaluate(e=>document.activeElement===e),true,'suspect filter did not receive focus');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#filter-status').inputValue(),'suspect','native keyboard filter failed');
   }
   if(name==='faq-pt'){
    assert((await page.locator('main').textContent()).includes('As renovações estão temporariamente suspensas.'));
   }
   if(name==='faq-en'){
    assert((await page.locator('main').textContent()).includes('Renewals are temporarily paused.'));
    assert((await page.locator('main').textContent()).includes('Do not retry payments while checkout is unavailable.'));
   }
   if(name==='planos'){
    assert.equal(await page.locator('[data-buy-plan]').count(),0,'paused purchase button leaked');
    assert((await page.locator('main').textContent()).includes('As renovações estão temporariamente suspensas.'));
   }
   await page.screenshot({path:path.join(out,'r47-03-'+name+'-'+width+'.png'),fullPage:true,animations:'disabled'});
   await page.close();count++;
  }
  console.log('R47.03 CHROMIUM PASS: '+count+' isolated desktop/tablet/mobile viewport checks');
 }finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
