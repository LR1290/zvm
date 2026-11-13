'use strict';
// R46.96 visual QA: only offline HTML fixtures. No production calls or real purchases.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
process.env.RENDER='true';
process.env.ADMIN_USER='zvm-public-visual-fixture';
process.env.ADMIN_PASS='zvm-public-visual-test-only';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/visual_public_qa_offline';
const saved=Module._load;let api;
try{
 Module._load=function(id,...args){
  if(id==='mongodb')return{MongoClient:class OfflineMongoFixture{}};
  return saved.call(this,id,...args);
 };
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=saved}
const fictitious={name:'Pessoa Ficticia',email:'qa@example.invalid',keyCode:''};
const pages=[
 ['landing',api.renderStandaloneLandingPage(null)],
 ['plans',api.renderPlanosPage(null)],
 ['plans-member',api.renderPlanosPage(fictitious)],
 ['faq',api.renderStandaloneFaqPage(null)]
];
const output=path.join(root,'artifacts','visual-qa');
fs.mkdirSync(output,{recursive:true});
async function run(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 let screenshots=0;
 try{
  for(const [label,html] of pages){
   for(const width of [1440,390,320]){
    const page=await browser.newPage({viewport:{width,height:width===1440?900:760},deviceScaleFactor:1,reducedMotion:'reduce'});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.hostname!=='zvm.local'){await route.abort();return}
      if(url.pathname==='/'+label+'-qa'){
        await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html});return;
      }
      if(url.pathname.startsWith('/assets/')){
        const name=path.basename(decodeURIComponent(url.pathname));
        if(!/^[a-zA-Z0-9_.-]+$/.test(name)){await route.fulfill({status:400,body:'Bad asset'});return}
        const file=path.join(root,'assets',name);
        if(!fs.existsSync(file)){await route.fulfill({status:404,body:'Missing asset '+name});return}
        await route.fulfill({status:200,contentType:name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':name.endsWith('.png')?'image/png':'application/octet-stream',body:fs.readFileSync(file)});return;
      }
      await route.fulfill({status:404,body:'Blocked offline fixture route'});
    });
    await page.goto('http://zvm.local/'+label+'-qa',{waitUntil:'load'});
    await page.waitForTimeout(150);
    assert.deepEqual(errors,[],label+'/'+width+' page JS errors');
    const metrics=await page.evaluate(()=>({
       scrollWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,
       clientWidth:document.documentElement.clientWidth,green:getComputedStyle(document.body).getPropertyValue('--g').trim()
    }));
    if(metrics.scrollWidth>width+4){
      const offenders=await page.evaluate(()=>[...document.querySelectorAll('body *')].map(el=>({
       tag:el.tagName,className:typeof el.className==='string'?el.className.slice(0,85):'',
       right:Math.round(el.getBoundingClientRect().right)})).filter(x=>x.right>innerWidth+4).slice(0,10));
      assert.fail(label+'/'+width+' horizontal overflow '+JSON.stringify({metrics,offenders}));
    }
    assert.equal(metrics.green,'#46e3a2',label+'/'+width+' wrong public theme');
    assert(await page.locator('main#main-content').count()>0,label+'/'+width+' missing semantic main');
    if(width<=390){
      const nav=page.locator('.nav-menu-toggle');
      assert(await nav.isVisible(),label+'/'+width+' missing mobile navigation button');
      await nav.click();
      assert.equal(await nav.getAttribute('aria-expanded'),'true',label+'/'+width+' menu failed to open');
      assert(await page.locator('.standalone-nav .znav-links').isVisible(),label+'/'+width+' mobile routes hidden');
      await page.keyboard.press('Escape');
      assert.equal(await nav.getAttribute('aria-expanded'),'false',label+'/'+width+' Escape failed to close nav');
    }
    if(label==='landing'){
      assert(await page.locator('.r466-hero h1').isVisible(),label+'/'+width+' hero missing');
      assert(await page.locator('.r466-product .r466-tab-radio').count()>=2,'product screenshots missing');
      const tabs=page.locator('.r466-tab-strip label');
      await tabs.nth(1).click();
      assert(await page.locator('.r466-tab-radio').nth(1).isChecked(),label+'/'+width+' preview tab cannot select');
      assert(await page.locator('a[href^="/planos"]').count()>0,'landing plans link missing');
    }else if(label==='faq'){
      const item=page.locator('.faq-item').first();
      await item.locator('summary').evaluate(el=>el.scrollIntoView({block:'center',behavior:'auto'}));
      await item.locator('summary').click();
      assert(await item.evaluate(el=>el.open),label+'/'+width+' FAQ disclosure not operable');
      assert(await item.locator('p').isVisible(),label+'/'+width+' FAQ answer hidden');
      if(width<=390){
        const count=await page.locator('.faq-group').count();
        assert(count>=4,'FAQ groups missing on mobile');
      }
    }else{
      assert(await page.locator('.price-card').count()>=3,label+'/'+width+' pricing cards missing');
      // The visible label is the actual public control; the radio is visually hidden
      // under its span. Test a real user click, not a click on the transparent input.
      const chooser=page.locator('.need-opt').first();
      // Mimic a reader scrolling the chooser to a visible place below the sticky nav.
      await chooser.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
      await chooser.locator('span').click();
      assert(await chooser.locator('input[name="need"]').isChecked(),label+'/'+width+' user cannot choose number of devices');
      const hit=await chooser.locator('span').evaluate(el=>document.elementFromPoint(el.getBoundingClientRect().x+el.getBoundingClientRect().width/2,el.getBoundingClientRect().y+el.getBoundingClientRect().height/2)===el);
      assert(hit,label+'/'+width+' visible price selector must own hit testing');
      assert(await page.locator('.price-card.suggested').count()===1,label+'/'+width+' selector does not highlight exactly one card');
      if(label==='plans'){
        const btn=page.locator('.plan-btn-locked').first();
        assert(await btn.count()>0,'anonymous purchase must require login');
        await btn.click();
        const dialog=page.locator('.checkout-dialog');
        assert(await dialog.evaluate(el=>el.open),label+'/'+width+' checkout login dialog inaccessible');
        assert(await dialog.locator('a[href="/cliente?redir=/planos"]').count()>0,'checkout login continuation missing');
        await dialog.locator('.modal-cancel').click();
        assert(!(await dialog.evaluate(el=>el.open)),'checkout dialog did not close');
      }else{
        assert(await page.locator('.buyer-box').isVisible(),'buyer identity missing');
        assert(await page.locator('.plan-btn-locked').count()===0,'logged-in buyer should not see login CTA');
      }
    }
    await page.screenshot({path:path.join(output,'public-'+label+'-'+width+'.png'),fullPage:true,animations:'disabled'});
    screenshots++;
    await page.close();
   }
  }
  console.log('R46.96 CHROMIUM PASS: '+screenshots+' public renderings, navigation, FAQ, modal, pricing, overflow and JS runtime');
 }finally{await browser.close()}
}
run().catch(e=>{console.error(e);process.exitCode=1});
