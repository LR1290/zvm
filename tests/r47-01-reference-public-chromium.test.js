'use strict';
// Offline browser QA of ZVM's reference-faithful marketing, FAQ, and Plans.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {chromium}=require('playwright');
const {localizePublicHtml}=require('../src/web/public/i18n');
const root=path.resolve(__dirname,'..');
process.env.ZVM_SALES_PAUSED='1';process.env.RENDER='true';
process.env.ADMIN_USER='r4701-chromium-fixture';process.env.ADMIN_PASS='testing-only';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/zvm_reference_browser';
const orig=Module._load;let api;
try{Module._load=function(id,...args){if(id==='mongodb')return{MongoClient:class MockDb{}};return orig.call(this,id,...args)};api=require(path.join(root,'server.js')).__test;}
finally{Module._load=orig}
const customer={name:'Fictitious Customer',email:'qa@example.invalid',keyCode:'key-only-for-fixture'};
const faq=api.renderStandaloneFaqPage(null);
const cases=[
 ['home',api.renderStandaloneLandingPage(null)],
 ['faq',faq],
 ['faq-en',localizePublicHtml(faq,'en',{path:'/faq'})],
 ['plans',api.renderPlanosPage(null)],
 ['plans-member',api.renderPlanosPage(customer)]
];
const dir=path.join(root,'artifacts','visual-qa');fs.mkdirSync(dir,{recursive:true});
async function run(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 let count=0;
 try{
  for(const [name,html] of cases)for(const width of [1440,768,390,320]){
   const page=await browser.newPage({viewport:{width,height:width===1440?900:760},deviceScaleFactor:1,reducedMotion:'reduce'});
   let external=0,errors=[];page.on('pageerror',e=>errors.push(String(e.message)));
   await page.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.hostname!=='zvm.local'){external++;await route.abort();return;}
    if(u.pathname==='/'+name+'-offline'){await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html});return}
    if(u.pathname.startsWith('/assets/')){
      const asset=path.basename(decodeURIComponent(u.pathname));
      if(!/^[a-zA-Z0-9_.-]+$/.test(asset)){await route.fulfill({status:400,body:'Unsafe path'});return;}
      const fp=path.join(root,'assets',asset);
      if(!fs.existsSync(fp)){await route.fulfill({status:404,body:'Missing asset '+asset});return}
      const ext=path.extname(asset);
      const mime=ext==='.css'?'text/css':ext==='.js'?'text/javascript':ext==='.png'?'image/png':ext==='.svg'?'image/svg+xml':ext==='.webp'?'image/webp':'application/octet-stream';
      await route.fulfill({status:200,contentType:mime,body:fs.readFileSync(fp)});return;
    }
    await route.fulfill({status:404,body:'Offline route'});
   });
   await page.goto('http://zvm.local/'+name+'-offline',{waitUntil:'load'});
   await page.waitForTimeout(130);
   assert.deepEqual(errors,[],name+'/'+width+' JS page errors');
   assert.equal(external,0,name+'/'+width+' external network request attempted');
   const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
   if(dimensions.scroll>width+4){
    const elements=await page.evaluate(()=>[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,cl:typeof e.className==='string'?e.className.slice(0,80):'',right:Math.round(e.getBoundingClientRect().right),w:Math.round(e.getBoundingClientRect().width)})).filter(e=>e.right>innerWidth+4).slice(0,12));
    assert.fail(name+'/'+width+' horizontal overflow '+JSON.stringify({dimensions,elements}));
   }
   assert(await page.locator('main#main-content').isVisible(),name+'/'+width+' landmark hidden');
   assert.equal(await page.locator('[data-buy-plan],a[href^="https://pay.cakto.com.br/"]').count(),0,'paused checkout leaked');
   const bodyBg=await page.evaluate(()=>getComputedStyle(document.body).backgroundColor);
   assert(bodyBg!=='rgba(0, 0, 0, 0)',name+'/'+width+' missing dark palette');
   if(name==='home'){
    assert(await page.locator('.r4701-hero-visual').isVisible());
    assert(await page.locator('.r4701-hero-visual img').evaluate(img=>img.complete&&img.naturalWidth>0),'real dashboard screenshot failed to load');
    assert.equal(await page.locator('.r4701-feature-card').count(),6);
    assert.equal(await page.locator('.r4700-journey-list>li').count(),4);
    assert(await page.locator('.r4701-flow-preview').isVisible(),'flow storytelling preview hidden');
    assert(await page.locator('.r466-sales-paused').first().isVisible(),'pause banner absent');
   }else if(name.startsWith('faq')){
    const isEnglish=name==='faq-en';
    assert.equal(await page.locator('.r4701-faq-tile').count(),4);

    assert(await page.locator('.r4700-faq-pause').isVisible());
    assert.equal(await page.locator('[data-faq-item]').count(),16);
    const search=page.locator('#faq-search');
    await page.locator('body').click({position:{x:4,y:4}});
    await page.keyboard.press('Control+k');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'faq-search','Ctrl+K not focusing search');
    await search.fill(isEnglish?'license':'licenca');
    const visible=await page.locator('[data-faq-item]:visible').count();
    assert(visible>0&&visible<16,'FAQ accent-insensitive search filtering failed');
    await search.press('Escape');
    assert.equal(await search.inputValue(),'','Escape must clear FAQ query');
    assert.equal(await page.locator('[data-faq-item]:visible').count(),16,'FAQ groups not restored');
    const first=page.locator('[data-faq-item]').first();
    await first.locator('summary').click();
    assert(await first.evaluate(el=>el.open),'FAQ native details not interactive');
   }else{
    assert(await page.locator('.r4701-license-demo').isVisible(),'illustrative license panel hidden');
    assert.equal(await page.locator('.price-card').count(),4);
    assert(await page.locator('.price-card.featured').count()===1,'official PRO card not featured');
    assert.equal(await page.locator('.r4701-plans-included-grid article').count(),6);
    assert(await page.locator('.r4700-purchase-journey').isVisible());
    assert(await page.locator('.r4701-license-advice').isVisible());
    assert(await page.locator('.r4701-plans-faq details').count()===5);
    assert(await page.locator('.r4701-plans-final').isVisible());
    assert(await page.locator('.sales-paused-alert').isVisible());
   }
   assert.deepEqual(errors,[],name+'/'+width+' JS runtime errors after actions');
   await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
   await page.screenshot({path:path.join(dir,'r4701-'+name+'-'+width+'.png'),fullPage:true,animations:'disabled'});
   count++;await page.close();
  }
  console.log('R47.01 CHROMIUM PASS: '+count+' screen states (1440/768/390/320), no overflow, real ZVM preview, accessible FAQ shortcuts, paused sales');
 }finally{await browser.close()}
}
run().catch(e=>{console.error(e);process.exitCode=1});
