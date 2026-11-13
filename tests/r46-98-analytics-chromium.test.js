'use strict';
// R46.98 accessible Analytics, Chromium offline fixtures only (never invoke live APIs).
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
process.env.RENDER='true';process.env.ADMIN_USER='r4698-chromium-admin';
process.env.ADMIN_PASS='fake-chromium-only';process.env.MONGODB_URI='mongodb://127.0.0.1:27017/r4698_chromium_offline';
const load=Module._load;let api;
try{
 Module._load=function(id,...args){
  if(id==='mongodb')return{MongoClient:class OfflineMongoFixture{}};
  return load.call(this,id,...args);
 };
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=load}
const today=new Date().toISOString();
const makePayment=(name,testMode)=>({
 clientName:name,clientEmail:testMode?'test@example.invalid':'buyer@example.invalid',
 productName:'ZVM START',keyCode:testMode?'QA-TEST':'QA-REAL',paymentMethod:'pix',
 paidAt:today,amount:59.90,approved:true,testMode,
 tracking:{src:testMode?'laboratorio':'site'},
});
const fixture={stats:{
 total:2,last30:2,last7:2,revenueTotal:119.80,revenueLast30:119.80,revenueLast7:119.80,
 uniqueClients:2,returningClients:0,retentionRate:0,byDay:[],byProduct:[{_id:'START',count:2,revenue:119.8}],
 byMethod:[{_id:'pix',count:2}],byHour:[{_id:'10',count:1},{_id:'16',count:1}],topClients:[],
 },payments:[makePayment('Comprador Real',false),makePayment('Cliente Teste',true)]};
const out=path.join(root,'artifacts','visual-qa');fs.mkdirSync(out,{recursive:true});
async function run(){
 const html=await api.renderAnalyticsDashboard(fixture);
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 let count=0;
 try{
  for(const width of [1440,390,320]){
   const page=await browser.newPage({viewport:{width,height:width===1440?900:760},deviceScaleFactor:1,reducedMotion:'reduce'});
   const errors=[];let apiRequests=0;
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='zvm.local'){await route.abort();return;}
    if(url.pathname==='/analytics-qa'){await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html});return}
    if(url.pathname.startsWith('/api/')||url.pathname.includes('/api/')){
     apiRequests++;await route.fulfill({status:403,contentType:'application/json',body:'{"error":"offline_test_block"}'});return;
    }
    if(url.pathname.startsWith('/assets/')){
     const name=path.basename(decodeURIComponent(url.pathname));
     if(!/^[a-zA-Z0-9_.-]+$/.test(name)){await route.fulfill({status:400,body:'Unsafe asset'});return}
     const file=path.join(root,'assets',name);
     if(!fs.existsSync(file)){await route.fulfill({status:404,body:'Missing '+name});return}
     await route.fulfill({status:200,contentType:name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'application/octet-stream',body:fs.readFileSync(file)});return;
    }
    await route.fulfill({status:404,body:'Blocked fixture URL'});
   });
   await page.goto('http://zvm.local/analytics-qa',{waitUntil:'load'});
   await page.waitForTimeout(160);
   assert.deepEqual(errors,[],'runtime errors at '+width);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
   assert(overflow<=4,width+' horizontal overflow: '+overflow);
   assert(await page.locator('#analytics-main').isVisible(),width+' missing main');
   await page.keyboard.press('Tab');
   assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('analytics-skip')),true,width+' skip link not first focusable');
   await page.keyboard.press('Enter');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'analytics-main',width+' skip link did not focus main');
   assert.equal(await page.locator('#analytics-filter-status').innerText(),'2 de 2 pagamentos exibidos.');
   const group=page.getByRole('group',{name:'Tipo de pagamento'});
   await group.getByRole('button',{name:'Testes'}).click();
   assert.equal(await group.getByRole('button',{name:'Testes'}).getAttribute('aria-pressed'),'true');
   assert.equal(await group.getByRole('button',{name:'Todos'}).getAttribute('aria-pressed'),'false');
   assert.equal(await page.locator('#payments-body tr[data-row]:visible').count(),1,'test-only filter failed');
   assert.equal(await page.locator('#analytics-filter-status').innerText(),'1 de 2 pagamentos exibidos.');
   await page.locator('#search').fill('nao-existe-nesta-tabela');
   assert.equal(await page.locator('#payments-body tr[data-row]:visible').count(),0);
   assert.equal(await page.locator('#analytics-filter-status').innerText(),'0 de 2 pagamentos exibidos.');
   await page.locator('#search').fill('');
   await group.getByRole('button',{name:'Todos'}).click();
   assert.equal(await page.locator('#payments-body tr[data-row]:visible').count(),2);
   const period=page.getByRole('group',{name:'Periodo de pagamentos'});
   assert.equal(await period.getByRole('button',{name:'Todos'}).getAttribute('aria-pressed'),'true');
   await period.getByRole('button',{name:'7d'}).click();
   assert.equal(await period.getByRole('button',{name:'7d'}).getAttribute('aria-pressed'),'true');
   const toggle=page.locator('#lab-toggle');
   assert.equal(await toggle.getAttribute('aria-expanded'),'false');
   await toggle.click();
   assert.equal(await toggle.getAttribute('aria-expanded'),'true');
   assert(await page.locator('#lab-body').isVisible());
   const sale=page.locator('#lab-tab-sale'),email=page.locator('#lab-tab-email');
   await sale.focus();
   await page.keyboard.press('ArrowRight');
   assert.equal(await email.getAttribute('aria-selected'),'true','ArrowRight did not select email');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'lab-tab-email','focus did not follow tab');
   assert(await page.locator('#lab-email-pane').isVisible());
   assert(await page.locator('#lab-sale-pane').isHidden());
   await page.keyboard.press('Home');
   assert.equal(await sale.getAttribute('aria-selected'),'true','Home did not return to sale');
   await page.keyboard.press('End');
   assert.equal(await email.getAttribute('aria-selected'),'true','End did not select final tab');
   await page.keyboard.press('ArrowLeft');
   assert.equal(await sale.getAttribute('aria-selected'),'true','ArrowLeft did not wrap');
   await toggle.click();
   assert.equal(await toggle.getAttribute('aria-expanded'),'false');
   assert(await page.locator('#lab-body').isHidden());
   const daily=page.locator('.analytics-chart-data');
   await daily.locator('summary').click();
   assert(await daily.evaluate(el=>el.open),'accessible daily table did not expand');
   assert.equal(await daily.locator('tbody tr').count(),30);
   assert(await daily.locator('table caption').isVisible());
   assert(await page.locator('#purge-exec-btn').isDisabled(),'purge action must stay disabled');
   assert.equal(apiRequests,0,'test unexpectedly requested an API');
   assert.deepEqual(errors,[],'JS errors after interactions at '+width);
   await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
   await page.screenshot({path:path.join(out,'r4698-analytics-'+width+'.png'),fullPage:true,animations:'disabled'});
   count++;await page.close();
  }
  console.log('R46.98 CHROMIUM PASS: '+count+' Analytics viewport states; skip link, tabs, filters, accessible chart, zero network calls');
 }finally{await browser.close()}
}
run().catch(e=>{console.error(e);process.exitCode=1});
