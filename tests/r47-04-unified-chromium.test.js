'use strict';
// R47.04: isolated full-site art direction, no live network or user account.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
process.env.ZVM_SALES_PAUSED='1';process.env.RENDER='true';
process.env.ADMIN_USER='r4704-browser';process.env.ADMIN_PASS='r4704-dummy-only';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/zvm_r4704_browser';
const load=Module._load;let api;
try{Module._load=function(id,...args){if(id==='mongodb')return{MongoClient:class OfflineMongo{}};return load.call(this,id,...args)};
 api=require(path.join(root,'server.js')).__test;}finally{Module._load=load}
const user={name:'Cliente QA',email:'qa@example.invalid',_id:'qa@example.invalid',verified:true};
const key={code:'r4704-test-key',label:'Laboratório',planId:'solo',active:true,maxUses:1,phones:[],
 expiresAt:'2032-01-01T00:00:00.000Z',createdAt:'2026-11-01T00:00:00.000Z'};
const pages=[
 ['home',api.renderStandaloneLandingPage(null),'.r4701-hero-visual'],
 ['faq',api.renderStandaloneFaqPage(null),'.r4700-faq-search input'],
 ['plans',api.renderPlanosPage(null),'.r4701-license-demo'],
 ['login',api.renderStandalonePortalLogin(),'.auth-form-card'],
 ['register',api.renderStandalonePortalRegister(),'.auth-form-card'],
 ['client',api.renderPortalDashboard(user,key,'',''),'.client-license-focus'],
 ['admin',api.renderAdminDashboard({keysSnapshot:{[key.code]:key},portalUsers:[],portalUserCount:0}),'.admin-overview'],
 ['privacy',api.renderStandalonePrivacyPage(null),'.zvm-trust-toc'],
 ['terms',api.renderStandaloneTermsPage(null,'pt-BR'),'.terms-toc'],
 ['404',api.renderStandalone404Page(null),'.zvm-error-aside'],
 ['500',api.renderStandalone500Page(null),'.zvm-error-aside']
];
const dir=path.join(root,'artifacts','visual-qa');fs.mkdirSync(dir,{recursive:true});
async function run(){
 const fakeAnalytics={
  stats:{total:2,last30:2,last7:1,revenueTotal:119.8,revenueLast30:119.8,
   revenueLast7:59.9,uniqueClients:2,returningClients:0,retentionRate:0,
   byDay:[],byProduct:[{_id:'START',count:2,revenue:119.8}],byMethod:[],
   byHour:[],topClients:[]},payments:[]
 };
 pages.push(['analytics',await api.renderAnalyticsDashboard(fakeAnalytics),'.analytics-hero']);
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 let checks=0;
 try{
  for(const [name,html,selector] of pages)for(const width of [1440,768,390,320]){
   const page=await browser.newPage({viewport:{width,height:width===1440?900:760},reducedMotion:'reduce'});
   let errors=[],external=0;
   page.on('pageerror',e=>errors.push(String(e.message)));
   await page.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.hostname!=='zvm.local'){external++;await route.abort();return;}
    if(u.pathname==='/'+name+'-r4704'){
     await route.fulfill({status:name==='404'?404:name==='500'?500:200,contentType:'text/html; charset=utf-8',body:html});return;
    }
    if(u.pathname.startsWith('/assets/')){
     const base=path.basename(decodeURIComponent(u.pathname));
     if(!/^[a-zA-Z0-9_.-]+$/.test(base)){await route.fulfill({status:400,body:'Invalid filename'});return;}
     const file=path.join(root,'assets',base);
     if(!fs.existsSync(file)){await route.fulfill({status:404,body:'Missing asset '+base});return;}
     const ext=path.extname(base),type=ext==='.css'?'text/css':ext==='.js'?'text/javascript':ext==='.svg'?'image/svg+xml':ext==='.png'?'image/png':ext==='.webp'?'image/webp':'application/octet-stream';
     await route.fulfill({status:200,contentType:type,body:fs.readFileSync(file)});return;
    }
    if(u.pathname.endsWith('/api/data')){
     await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,totalKeys:1,activeKeys:1,suspectKeys:0,keysHtml:'',logsHtml:'',totalLogs:0})});return;
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,users:[],ips:[]})});
   });
   await page.addInitScript(()=>{try{localStorage.clear()}catch(_){}});
   await page.goto('http://zvm.local/'+name+'-r4704',{waitUntil:'load'});
   await page.waitForTimeout(120);
   assert.deepEqual(errors,[],name+'/'+width+' JavaScript errors');
   assert.equal(external,0,name+'/'+width+' external request');
   const d=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,body:document.body.scrollWidth,width:window.innerWidth}));
   assert(d.scroll<=width+4,name+'/'+width+' horizontal overflow '+JSON.stringify(d));
   const target=page.locator(selector).first();
   assert(await target.isVisible(),name+'/'+width+' visual component hidden: '+selector);
   const visual=await target.evaluate(el=>({border:getComputedStyle(el).borderColor,
     background:getComputedStyle(el).backgroundImage,boxShadow:getComputedStyle(el).boxShadow}));
   assert(visual.background!=='none'||visual.boxShadow!=='none',name+'/'+width+' missing art direction '+JSON.stringify(visual));
   assert.equal(await page.locator('[data-buy-plan],a[href^="https://pay.cakto.com.br/"]').count(),0,name+' leaked checkout');
   if(name==='home')assert(await page.locator('.r4701-hero-visual img').evaluate(im=>im.complete&&im.naturalWidth>0),'genuine product image missing');
   await page.screenshot({path:path.join(dir,'r47-04-'+name+'-'+width+'.png'),fullPage:true,animations:'disabled'});
   await page.close();
   checks++;
  }
  console.log('R47.04 CHROMIUM PASS: '+checks+' real CSS, mobile reflow, genuine media, paused sales, offline screenshots');
 }finally{await browser.close()}
}
run().catch(e=>{console.error(e);process.exitCode=1});
