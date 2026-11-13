'use strict';
// R46.97 QA: synthetic legal/error/Analytics pages, offline only.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
process.env.RENDER='true';
process.env.ADMIN_USER='zvm-visual-fixture';
process.env.ADMIN_PASS='qa-visual-password';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/zvm_legal_qa_offline';
const native=Module._load;
let api;
try{
 Module._load=function(id,...rest){
  if(id==='mongodb')return {MongoClient:class OfflineMongoFixture{}};
  return native.call(this,id,...rest);
 };
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=native}
const fixture={stats:{total:0,last7:0,last30:0,revenueTotal:0,revenueLast30:0,
 byDay:[],byProduct:[],byHour:[],byMethod:[],topClients:[],uniqueClients:0,retentionRate:0},payments:[]};
const output=path.join(root,'artifacts','visual-qa');
fs.mkdirSync(output,{recursive:true});
async function run(){
 const pages=[
  ['privacy',api.renderStandalonePrivacyPage(null)],
  ['terms-ptbr',api.renderStandaloneTermsPage(null,'pt-BR')],
  ['terms-ptpt',api.renderStandaloneTermsPage(null,'pt-PT')],
  ['terms-en',api.renderStandaloneTermsPage(null,'en')],
  ['404',api.renderStandalone404Page(null)],
  ['500',api.renderStandalone500Page(null)],
  ['analytics',await api.renderAnalyticsDashboard(fixture)]
 ];
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 let count=0;
 try{
  for(const [label,html] of pages){
   for(const width of [1440,390,320]){
    const page=await browser.newPage({viewport:{width,height:width===1440?900:760},
      deviceScaleFactor:1,reducedMotion:'reduce'});
    const runtimeErrors=[];
    page.on('pageerror',err=>runtimeErrors.push(String(err.message)));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.hostname!=='zvm.local'){await route.abort();return}
      if(url.pathname==='/'+label+'-qa'){
       await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html});return;
      }
      if(url.pathname.startsWith('/assets/')){
       const name=path.basename(decodeURIComponent(url.pathname));
       if(!/^[a-zA-Z0-9_.-]+$/.test(name)){await route.fulfill({status:400,body:'Unsafe asset'});return}
       const file=path.join(root,'assets',name);
       if(!fs.existsSync(file)){await route.fulfill({status:404,body:'Missing asset '+name});return}
       await route.fulfill({status:200,contentType:name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':name.endsWith('.png')?'image/png':'application/octet-stream',body:fs.readFileSync(file)});return;
      }
      await route.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"data":[]}'});
    });
    await page.goto('http://zvm.local/'+label+'-qa',{waitUntil:'load'});
    await page.waitForTimeout(180);
    assert.deepEqual(runtimeErrors,[],label+'/'+width+' JS runtime errors');
    const dimensions=await page.evaluate(()=>({inner:innerWidth,scroll:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
    if(dimensions.scroll>width+4){
      const offenders=await page.evaluate(()=>[...document.querySelectorAll('body *')].map(el=>({
       tag:el.tagName,className:typeof el.className==='string'?el.className.slice(0,75):'',
       right:Math.round(el.getBoundingClientRect().right),width:Math.round(el.getBoundingClientRect().width)
      })).filter(z=>z.right>innerWidth+4).slice(0,10));
      assert.fail(label+'/'+width+' horizontal overflow: '+JSON.stringify({dimensions,offenders}));
    }
    assert(await page.locator('main').first().isVisible(),label+'/'+width+' main is hidden');
    if(label!=='analytics'){
      assert.equal(await page.locator('main#main-content').count(),1,label+'/'+width+' missing main skip link target');
      const nav=page.locator('.nav-menu-toggle');
      if(width<=390){
        const links=page.locator('.standalone-nav .znav-links');
        assert(await nav.isVisible(),label+'/'+width+' menu toggle missing');
        assert(await links.isHidden(),label+'/'+width+' menu unexpectedly expanded');
        await nav.click();
        assert(await links.isVisible(),label+'/'+width+' menu did not expand');
        await page.keyboard.press('Escape');
        assert(await links.isHidden(),label+'/'+width+' Escape did not close menu');
      }
      if(label==='privacy'){
        assert(await page.locator('.info-box').isVisible());
        assert.equal(await page.locator('.doc-section').count(),9,'Privacy sections lost');
        assert(await page.locator('h1').isVisible());
      }else if(label.startsWith('terms')){
        assert(await page.locator('.terms-toc').isVisible(),label+'/'+width+' terms toc missing');
        assert(await page.locator('.terms-section').count()>4,'Terms sections missing');
        const link=page.locator('.terms-toc a[href^="#"]').first();
        assert(await link.count()>0,'Terms internal navigation missing');
        const target=await link.getAttribute('href');
        assert(await page.locator(target).count()>0,'Terms internal link is broken '+target);
      }else{
        assert(await page.locator('.err-title').isVisible());
        assert(await page.locator('.err-actions a[href="/"]').count()>0,'Error page missing home recovery');
      }
    }else{
      assert(await page.locator('.analytics-shell').isVisible());
      assert(await page.locator('.analytics-nav a').count()>=4,'Analytics navigation lost');
      assert(await page.locator('.sc').count()>=6,'Executive KPIs missing');
      assert(await page.locator('#lab-sec').count()===1,'Sandbox lab missing');
      assert(await page.locator('#purge-dialog').count()===1,'Confirmation guard missing');
      const bg=await page.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--dark').trim());
      assert.equal(bg,'#070d0b','Analytics not using shared palette');
    }
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.waitForTimeout(60);
    await page.screenshot({path:path.join(output,'r4697-'+label+'-'+width+'.png'),fullPage:true,animations:'disabled'});
    count++;
    await page.close();
   }
  }
  console.log('R46.97 CHROMIUM PASS: '+count+' responsive legal, error and Analytics screens at 1440/390/320');
 }finally{await browser.close()}
}
run().catch(e=>{console.error(e);process.exitCode=1});
