'use strict';
// R47.00 — synthetic browser review of the new public UI with commerce paused.
// Network is fully intercepted; no Cakto/payment/real server operation is possible.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {chromium}=require('playwright');
const {localizePublicHtml}=require('../src/web/public/i18n');
const root=path.resolve(__dirname,'..');
process.env.ZVM_SALES_PAUSED='1';
process.env.RENDER='true';
process.env.ADMIN_USER='r4700-browser-fixture';
process.env.ADMIN_PASS='offline-dummy-credentials';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/zvm_r4700_visual';
const original=Module._load;let api;
try{
 Module._load=function(id,...args){if(id==='mongodb')return{MongoClient:class OfflineDb{}};return original.call(this,id,...args)};
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=original}
const buyer={name:'Browser Test Buyer',email:'qa@example.invalid',keyCode:'zv-fake-key'};
const fixtures=[
 ['landing',api.renderStandaloneLandingPage(null)],
 ['faq',api.renderStandaloneFaqPage(null)],
 ['faq-en',localizePublicHtml(api.renderStandaloneFaqPage(null),'en',{path:'/faq'})],
 ['plans',api.renderPlanosPage(null)],
 ['plans-member',api.renderPlanosPage(buyer)]
];
const output=path.join(root,'artifacts','visual-qa');fs.mkdirSync(output,{recursive:true});
async function run(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 let count=0;
 try{
  for(const [label,html] of fixtures){
   for(const width of [1440,390,320]){
    const page=await browser.newPage({viewport:{width,height:width===1440?900:760},deviceScaleFactor:1,reducedMotion:'reduce'});
    const errors=[];let blocked=0;
    page.on('pageerror',e=>errors.push(String(e.message)));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.hostname!=='zvm.local'){blocked++;await route.abort();return;}
      if(url.pathname==='/'+label+'-qa'){
        await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html});return;
      }
      if(url.pathname.startsWith('/assets/')){
        const name=path.basename(decodeURIComponent(url.pathname));
        if(!/^[a-zA-Z0-9_.-]+$/.test(name)){await route.fulfill({status:400,body:'Unsafe fixture URL'});return;}
        const file=path.join(root,'assets',name);
        if(!fs.existsSync(file)){await route.fulfill({status:404,body:'Missing fixture '+name});return;}
        const ext=path.extname(name);
        const mime=ext==='.css'?'text/css':ext==='.js'?'text/javascript':ext==='.png'?'image/png':ext==='.svg'?'image/svg+xml':ext==='.webp'?'image/webp':'application/octet-stream';
        await route.fulfill({status:200,contentType:mime,body:fs.readFileSync(file)});return;
      }
      await route.fulfill({status:404,body:'Offline page only'});
    });
    await page.goto('http://zvm.local/'+label+'-qa',{waitUntil:'load'});
    await page.waitForTimeout(180);
    assert.deepEqual(errors,[],label+'/'+width+' JS runtime errors');
    const dims=await page.evaluate(()=>({inner:innerWidth,scroll:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
    if(dims.scroll>width+4){
      const offenders=await page.evaluate(()=>[...document.querySelectorAll('body *')].map(el=>({tag:el.tagName,cl:typeof el.className==='string'?el.className.slice(0,70):'',right:Math.round(el.getBoundingClientRect().right)})).filter(el=>el.right>innerWidth+4).slice(0,12));
      assert.fail(label+'/'+width+' horizontal overflow: '+JSON.stringify({dims,offenders}));
    }
    assert(await page.locator('main#main-content').first().isVisible(),label+'/'+width+' main hidden');
    assert.equal(await page.locator('a[href^="https://pay.cakto.com.br/"]').count(),0,'checkout URL must not leak when paused');
    if(label==='landing'){
      assert(await page.locator('.r466-hero h1').isVisible(),label+'/'+width+' hero missing');
      assert.equal(await page.locator('.r4700-trust-inner>span').count(),4);
      assert.equal(await page.locator('.r4700-journey-list>li').count(),4);
      assert(await page.locator('.r4700-journey').isVisible());
      assert(await page.locator('.r4700-hero-support .chrome-store-banner').count()===1);
      assert(await page.locator('a[href="/faq"]').count()>0);
    }else if(label==='faq'||label==='faq-en'){
      const search=page.locator('#faq-search');
      assert(await search.isVisible(),label+'/'+width+' FAQ search hidden');
      assert.equal(await page.locator('[data-faq-item]').count(),16);
      const isEnglish=label==='faq-en';
      assert.equal((await page.locator('#faq-result-status').textContent()).trim(),isEnglish?'16 questions available.':'16 perguntas disponíveis.');
      await search.fill(isEnglish?'license':'licenca');
      const visible=await page.locator('[data-faq-item]:visible').count();
      assert(visible>0&&visible<16,'diacritic-insensitive FAQ search failed '+visible);
      assert.equal((await page.locator('#faq-result-status').textContent()).trim(),isEnglish?visible+' of 16 questions found.':visible+' de 16 perguntas encontradas.');
      await search.fill('um-assunto-que-nao-existe-em-nenhuma-pergunta');
      assert(await page.locator('#faq-no-results').isVisible(),'empty result message not shown');
      assert.equal(await page.locator('[data-faq-item]:visible').count(),0);
      await search.press('Escape');
      assert.equal(await search.inputValue(),'','Escape should clear FAQ search');
      assert.equal(await page.locator('[data-faq-item]:visible').count(),16,'FAQ entries should return');
      assert(await page.locator('#faq-no-results').isHidden(),'FAQ empty state should hide');
      const first=page.locator('[data-faq-item]').first();
      await first.locator('summary').click();
      assert(await first.evaluate(el=>el.open),'native FAQ disclosure inoperable');
      assert.equal(await page.locator('.r4700-faq-topics a').count(),4,'topic navigation lost');
    }else{
      assert(await page.locator('.r4700-purchase-journey').isVisible());
      assert.equal(await page.locator('.r4700-purchase-steps li').count(),3);
      assert(await page.locator('.r4700-plans-assurance').isVisible());
      assert(await page.locator('.sales-paused-alert').isVisible());
      assert(await page.locator('.price-card').count()>=3);
      assert.equal(await page.locator('[data-buy-plan],[data-checkout],.checkout-dialog').count(),0,'paused checkout re-exposed');
    }
    assert.deepEqual(errors,[],label+'/'+width+' JS errors after interaction');
    assert.equal(blocked,0,label+'/'+width+' attempted an external network request');
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.waitForTimeout(45);
    await page.screenshot({path:path.join(output,'r4700-'+label+'-'+width+'.png'),fullPage:true,animations:'disabled'});
    count++;await page.close();
   }
  }
  console.log('R47.00 CHROMIUM PASS: '+count+' updated public page scenarios, keyboard/search in PT/EN, no overflow, no Cakto requests');
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1});
