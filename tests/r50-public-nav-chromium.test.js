'use strict';
// Offline, browser-based, *actual server-rendered HTML and real CSS assets*.
// Regressions would fail if an old global CSS forces different nav font sizes
// on the homepage and on /planos or other public pages.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {chromium}=require('playwright');
const {localizePublicHtml}=require('../src/web/public/i18n');
const {renderOwnerSalesLanding}=require('../src/web/public/landing/owner');
const root=path.join(__dirname,'..');
process.env.ZVM_SALES_PAUSED='1';
process.env.RENDER='true';
process.env.ADMIN_USER='r50-offline';
process.env.ADMIN_PASS='offline-only-r50';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/zvm_r50_offline';
const loader=Module._load;let api;
try{
 Module._load=function(id,...args){
  if(id==='mongodb')return {MongoClient:class OfflineMongo{}};
  return loader.call(this,id,...args);
 };
 api=require('../server.js').__test;
}finally{Module._load=loader}

const planMocks={
 solo:{id:'solo',price:39.9,maxUses:1,enabled:true},
 padrao:{id:'padrao',price:59.9,maxUses:3,enabled:true},
 pro:{id:'pro',price:94.9,maxUses:5,enabled:true},
 enterprise_v2:{id:'enterprise_v2',maxUses:10,consult:true}
};
const escHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sampleHome=renderOwnerSalesLanding({
 plans:planMocks,salesPaused:true,escHtml,
 publicNavHtml:api._sharedNav({activePath:'/',portalUser:null}),
 supportUrl:'https://wa.me/5521996771552?text=LR%20Preciso%20de%20ajuda'
});
const pages=[
 ['home','/',sampleHome],
 ['planos','/planos',api.renderPlanosPage(null)],
 ['faq','/faq',api.renderStandaloneFaqPage(null)],
 ['privacidade','/privacidade',api.renderStandalonePrivacyPage(null)],
 ['termos','/termos',api.renderStandaloneTermsPage(null,'pt-BR')]
].map(([name,route,html])=>{
  html=localizePublicHtml(html,'pt-BR',{path:route});
  if(!html.includes('/assets/zvm-owner-site.e10ede63c1f0.css'))
   html=html.replace('</head>','<link rel="stylesheet" href="/assets/zvm-owner-site.e10ede63c1f0.css"></head>');
  return {name,route,html};
});
const visuals=path.join(root,'artifacts','visual-qa');
fs.mkdirSync(visuals,{recursive:true});
const takeMetrics=()=> {
 const nav=document.querySelector('nav.znav.standalone-nav');
 const a=document.querySelector('.znav-main-links a[href="/#recursos"]');
 const c=document.querySelector('.znav-action-links .nav-cta');
 if(!nav||!a||!c)throw new Error('Missing public nav controls');
 const x=getComputedStyle(a),y=getComputedStyle(c),n=getComputedStyle(nav);
 const rect=a.getBoundingClientRect();
 return {
  font:x.fontFamily, size:x.fontSize, weight:x.fontWeight,
  lineHeight:x.lineHeight,letterSpacing:x.letterSpacing,
  linkWidth:Math.round(rect.width*100)/100,
  navHeight:Math.round(nav.getBoundingClientRect().height*100)/100,
  buttonFont:y.fontFamily,buttonSize:y.fontSize,buttonWeight:y.fontWeight,
  buttonRadius:y.borderRadius,
  menuOpen:getComputedStyle(document.querySelector('.znav-links')).display!=='none',
  scrollWidth:document.documentElement.scrollWidth,
  viewport:window.innerWidth,
  navBackground:n.backgroundColor
 };
};

async function run(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 let checks=0;
 try{
  for(const width of [1920,1440,390]){
   let baseline=null;
   for(const {name,route,html} of pages){
    const page=await browser.newPage({viewport:{width,height:940},reducedMotion:'reduce'});
    const missing=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async req=>{
     const u=new URL(req.request().url());
     if(u.hostname!=='zvm.r50.local'){await req.abort();return}
     if(u.pathname===route){await req.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html});return}
     if(u.pathname.startsWith('/assets/')){
      const p=path.join(root,'assets',path.basename(u.pathname));
      if(!fs.existsSync(p)){missing.push(u.pathname);await req.fulfill({status:404,body:'Missing'});return}
      const ext=path.extname(p),contentType=ext==='.css'?'text/css':ext==='.js'?'text/javascript':ext==='.png'?'image/png':ext==='.svg'?'image/svg+xml':'application/octet-stream';
      await req.fulfill({status:200,contentType,body:fs.readFileSync(p)});return;
     }
     await req.fulfill({status:200,body:'{}',contentType:'application/json'});
    });
    await page.goto('http://zvm.r50.local'+route,{waitUntil:'load'});
    await page.evaluate(()=>document.fonts.ready);
    if(width<=1150){
      const toggle=page.locator('.nav-menu-toggle');
      assert.equal(await toggle.isVisible(),true,name+' mobile toggle hidden');
      await toggle.click();
      assert.equal(await page.locator('.znav-links').isVisible(),true,name+' mobile menu did not open');
    }
    const result=await page.evaluate(takeMetrics);
    assert.deepEqual(missing,[],name+' missing assets');
    assert.deepEqual(errors,[],name+' uncaught JS errors');
    assert(result.scrollWidth<=width+3,name+' overflow: '+JSON.stringify(result));
    const compareKeys=['font','size','weight','lineHeight','letterSpacing','linkWidth','navHeight','buttonFont','buttonSize','buttonWeight','buttonRadius','menuOpen'];
    const comparable=Object.fromEntries(compareKeys.map(key=>[key,result[key]]));
    if(!baseline)baseline=comparable;
    else assert.deepEqual(comparable,baseline,
      name+'/'+width+' header font/layout diverged from HOME');
    const expectedSize=width===1920?'14px':width===1440?'13px':'15px';
    assert.equal(result.size,expectedSize,name+'/'+width+' unintended font-size');
    assert.equal(result.buttonRadius,'999px',name+'/'+width+' legacy CTA corners');
    if(width===1920)await page.screenshot({path:path.join(visuals,'r50-public-nav-'+name+'.png'),fullPage:false,animations:'disabled'});
    console.log('R50',width,name,JSON.stringify(comparable));
    checks++;
    await page.close();
   }
  }
  console.log('R50 REAL CSS CHROMIUM PASS: '+checks+' five-page viewport comparisons, 0 missing assets/JS errors');
 } finally {await browser.close()}
}
run().catch(e=>{console.error(e);process.exitCode=1});
