'use strict';
// ZVM R47.02: Chromium QA for public legal/recovery pages; synthetic and offline.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
process.env.ZVM_SALES_PAUSED='1';process.env.RENDER='true';
process.env.ADMIN_USER='r4702-browser-fixture';process.env.ADMIN_PASS='fixture-credentials-only';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/r4702_browser_offline';
const original=Module._load;let api;
try{
 Module._load=function(id,...args){
  if(id==='mongodb')return {MongoClient:class OfflineDatabase{}};
  return original.call(this,id,...args);
 };
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=original}
const pages=[
 ['privacy',api.renderStandalonePrivacyPage(null)],
 ['terms-ptbr',api.renderStandaloneTermsPage(null,'pt-BR')],
 ['terms-ptpt',api.renderStandaloneTermsPage(null,'pt-PT')],
 ['terms-en',api.renderStandaloneTermsPage(null,'en')],
 ['404',api.renderStandalone404Page(null)],
 ['500',api.renderStandalone500Page(null)]
];
const artifactDir=path.join(root,'artifacts','visual-qa');fs.mkdirSync(artifactDir,{recursive:true});
async function run(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 let count=0;
 try{
 for(const [name,html] of pages)for(const width of [1440,768,390,320]){
  const page=await browser.newPage({viewport:{width,height:width===1440?900:780},deviceScaleFactor:1,reducedMotion:'reduce'});
  const errors=[];let external=0;const missing=[];
  page.on('pageerror',e=>errors.push(String(e.message)));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='zvm.local'){external++;await route.abort();return}
   if(url.pathname==='/'+name+'-fixture'){
    await route.fulfill({status:name==='404'?404:name==='500'?500:200,contentType:'text/html; charset=utf-8',body:html});return;
   }
   if(url.pathname.startsWith('/assets/')){
    const fileName=path.basename(decodeURIComponent(url.pathname));
    if(!/^[a-zA-Z0-9_.-]+$/.test(fileName)){await route.fulfill({status:400,body:'invalid'});return}
    const file=path.join(root,'assets',fileName);
    if(!fs.existsSync(file)){missing.push(fileName);await route.fulfill({status:404,body:'not found'});return}
    const ext=path.extname(fileName);
    const mime=ext==='.css'?'text/css':ext==='.js'?'text/javascript':ext==='.png'?'image/png':ext==='.webp'?'image/webp':ext==='.svg'?'image/svg+xml':'application/octet-stream';
    await route.fulfill({status:200,contentType:mime,body:fs.readFileSync(file)});return;
   }
   await route.fulfill({status:404,body:'offline route'});
  });
  await page.goto('http://zvm.local/'+name+'-fixture',{waitUntil:'load'});
  await page.waitForTimeout(100);
  assert.deepEqual(errors,[],name+'/'+width+' runtime errors');
  assert.deepEqual(missing,[],name+'/'+width+' missing versioned assets');
  assert.equal(external,0,name+'/'+width+' external requests prohibited');
  const {scroll,viewport}=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
  if(scroll>viewport+4){
   const offenders=await page.evaluate(()=>[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,cls:typeof e.className==='string'?e.className.slice(0,70):'',right:Math.round(e.getBoundingClientRect().right)})).filter(x=>x.right>innerWidth+4).slice(0,12));
   assert.fail(name+'/'+width+' horizontal overflow '+JSON.stringify({scroll,viewport,offenders}));
  }
  assert(await page.locator('main#main-content').isVisible(),name+'/'+width+' semantic main missing');
  assert.equal(await page.locator('[data-buy-plan],a[href^="https://pay.cakto.com.br/"]').count(),0,name+'/'+width+' checkout leaked while paused');
  if(name==='privacy'){
   const anchors=page.locator('.zvm-trust-toc a');
   assert.equal(await anchors.count(),9,'privacy navigable 9 sections');
   assert(await anchors.first().isVisible());
   await anchors.first().click();
   assert.equal(new URL(page.url()).hash,'#privacidade-dados','Privacy TOC anchor route');
   assert(await page.locator('#privacidade-dados').isVisible());
   assert.equal(await page.locator('.zvm-trust-content section.doc-section').count(),9);
  }else if(name.startsWith('terms')){
   const links=page.locator('.terms-toc a');
   assert(await links.count()>5,name+' terms TOC removed');
   await links.first().click();
   const hash=new URL(page.url()).hash;
   assert(hash.length>1,name+' terms index not navigable');
   assert(await page.locator(hash).count()===1,name+' terms index missing target');
  }else{
   assert.equal(await page.locator('.zvm-error-aside>a').count(),name==='404'?3:2,'recovery links');
   assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'),'noindex');
   assert(await page.locator('.err-actions a').first().isVisible());
  }
  // Shared ZVM navigation must remain functional at mobile sizes.
  if(width<=768){
   const toggle=page.locator('.nav-menu-toggle');
   if(await toggle.isVisible()){
    assert.equal(await toggle.getAttribute('aria-expanded'),'false','menu should begin collapsed');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'),'true','menu did not expand');
    await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-expanded'),'false','menu did not close via Escape');
   }
  }
  assert.deepEqual(errors,[],name+'/'+width+' JS error after interaction');
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:path.join(artifactDir,'r4702-'+name+'-'+width+'.png'),fullPage:true,animations:'disabled'});
  count++;await page.close();
 }
 console.log('R47.02 CHROMIUM PASS: '+count+' legal and error screen states, nine privacy anchors, Terms languages, mobile menu and zero checkout/network requests');
 }finally{await browser.close()}
}
run().catch(err=>{console.error(err);process.exitCode=1});
