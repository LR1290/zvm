'use strict';
// R47.05: offline 1440/1920/2560 visual contract for site-wide desktop utilization.
// Real CSS, mocked accounts and analytics, zero production traffic or commercial writes.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
process.env.ZVM_SALES_PAUSED='1';process.env.RENDER='true';
process.env.ADMIN_USER='r4705-browser';process.env.ADMIN_PASS='offline-test-only';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/zvm_r4705_browser';
const orig=Module._load;let api;
try{
 Module._load=function(id,...args){if(id==='mongodb')return{MongoClient:class MockMongo{}};return orig.call(this,id,...args)};
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=orig}
const user={name:'QA Desktop',email:'qa@example.invalid',_id:'qa@example.invalid',verified:true};
const key={code:'r4705-fake-key',label:'QA',planId:'solo',active:true,maxUses:1,phones:[],expiresAt:'2032-01-01T00:00:00.000Z',createdAt:'2026-11-01T00:00:00.000Z'};
const pages=[
 ['home',api.renderStandaloneLandingPage(null),'.r466-product',true,'zvm-reference-public.19040fd11331.css'],
 ['faq',api.renderStandaloneFaqPage(null),'.r4700-faq-layout',true,'zvm-reference-public.19040fd11331.css'],
 ['plans',api.renderPlanosPage(null),'.plans-wrap',true,'zvm-reference-public.19040fd11331.css'],
 ['login',api.renderStandalonePortalLogin(),'.auth-shell',true,'zvm-auth-premium.a96f915db3f4.css'],
 ['register',api.renderStandalonePortalRegister(),'.auth-shell',true,'zvm-auth-premium.a96f915db3f4.css'],
 ['client',api.renderPortalDashboard(user,key,'',''),'.client-shell',false,'zvm-console-design.7a7b24cd5fa8.css'],
 ['admin',api.renderAdminDashboard({keysSnapshot:{[key.code]:key},portalUsers:[],portalUserCount:0}),'.admin-content',false,'zvm-console-design.7a7b24cd5fa8.css'],
 ['privacy',api.renderStandalonePrivacyPage(null),'.zvm-trust-layout',true,'zvm-legal-reading.49002e7e3dc1.css'],
 ['terms',api.renderStandaloneTermsPage(null,'pt-BR'),'.terms-wrap',true,'zvm-legal-reading.49002e7e3dc1.css'],
 ['404',api.renderStandalone404Page(null),'.zvm-error-grid',true,'zvm-legal-premium.a828eee21356.css'],
 ['500',api.renderStandalone500Page(null),'.zvm-error-grid',true,'zvm-legal-premium.a828eee21356.css']
];
const activeConsole='zvm-console-design.7a7b24cd5fa8.css';
const activeBytes=fs.readFileSync(path.join(root,'assets',activeConsole));
assert.equal(crypto.createHash('sha256').update(activeBytes).digest('hex'),
 '7a7b24cd5fa8f487a6ce481ee8bb505bd68c75816876c745a0518ee175e83c8a',
 'the linked client/admin CSS must match its full immutable fingerprint');
for(const [name,html,,,cssName] of pages.filter(p=>p[0]==='client'||p[0]==='admin')){
 assert.equal(cssName,activeConsole,name+' must select the active Console stylesheet');
 assert(html.includes('/assets/'+activeConsole),name+' must render current CSS');
 assert(!html.includes('/assets/zvm-console-design.44762cb103f8.css'),name+' must not render the cached predecessor');
}
const shots=path.join(root,'artifacts','visual-qa');fs.mkdirSync(shots,{recursive:true});
async function run(){
 const stats={total:1,last30:1,last7:1,revenueTotal:59.9,revenueLast30:59.9,
  revenueLast7:59.9,uniqueClients:1,returningClients:0,retentionRate:0,
  byDay:[],byProduct:[],byMethod:[],byHour:[],topClients:[]};
 pages.push(['analytics',await api.renderAnalyticsDashboard({stats,payments:[]}),'.analytics-workspace main',false,'zvm-analytics-premium.e8ce624836b1.css']);
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 let checks=0;const rows=[];
 try{
  for(const [name,html,selector,centered,cssName] of pages){
   const legalDoc=name==='privacy'||name==='terms';
   for(const width of (legalDoc?[360,390,768,1024,1440,1920,2560]:name==='admin'?[320,390,1440,1920,2560]:[1440,1920,2560])){
    const page=await browser.newPage({viewport:{width,height:950},reducedMotion:'reduce'});
    let errors=[],external=0,missing=[];
    page.on('pageerror',e=>errors.push(String(e.message)));
    await page.route('**/*',async route=>{
     const u=new URL(route.request().url());
     if(u.hostname!=='zvm.local'){external++;await route.abort();return}
     if(u.pathname==='/'+name+'-r4705'){
      await route.fulfill({status:name==='404'?404:name==='500'?500:200,contentType:'text/html; charset=utf-8',body:html});return;
     }
     if(u.pathname.startsWith('/assets/')){
      const fileName=path.basename(decodeURIComponent(u.pathname));
      if(!/^[a-zA-Z0-9_.-]+$/.test(fileName)){await route.fulfill({status:400,body:'Bad asset'});return}
      const p=path.join(root,'assets',fileName);
      if(!fs.existsSync(p)){missing.push(fileName);await route.fulfill({status:404,body:'Missing asset'});return}
      const ext=path.extname(fileName),type=ext==='.css'?'text/css':ext==='.js'?'text/javascript':ext==='.svg'?'image/svg+xml':ext==='.png'?'image/png':ext==='.webp'?'image/webp':'application/octet-stream';
      await route.fulfill({status:200,contentType:type,body:fs.readFileSync(p)});return;
     }
     await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,totalKeys:1,activeKeys:1,keysHtml:'',logsHtml:'',users:[]})});
    });
    await page.goto('http://zvm.local/'+name+'-r4705',{waitUntil:'load'});
    await page.waitForTimeout(120);
    assert.deepEqual(errors,[],name+'/'+width+' JS exceptions');
    assert.deepEqual(missing,[],name+'/'+width+' missing assets');
    assert.equal(external,0,name+'/'+width+' external request blocked');
    assert.equal(await page.locator('link[href$="'+cssName+'"]').count(),1,name+'/'+width+' missing current stylesheet');
    const rect=await page.locator(selector).first().evaluate(el=>{
     const r=el.getBoundingClientRect();
     return {x:r.x,right:r.right,width:r.width,visible:getComputedStyle(el).display!=='none',
      page:document.documentElement.scrollWidth,viewport:window.innerWidth};
    });
    assert(rect.visible&&rect.width>0,name+'/'+width+' target hidden '+selector);
    assert(rect.page<=width+4,name+'/'+width+' horizontal overflow '+JSON.stringify(rect));
    const min=legalDoc?(width===1440?0.72:width===1920?0.54:0.42):
      width===1440?(centered?0.85:0.72):width===1920?(centered?0.82:0.72):(centered?0.69:0.67);
    if(legalDoc){
     assert(rect.width<=1102,name+'/'+width+' legal document is too wide '+JSON.stringify(rect));
     assert.equal(await page.locator('link[href*="zvm-legal-premium.a828eee21356.css"]').count(),0,'legacy recovery CSS leaked into '+name);
     assert.equal(await page.locator('link[href*="zvm-r46-system.cf01433d7f45.css"]').count(),0,'legacy R46 hero padding leaked into '+name);
     const heading=await page.evaluate(()=>{
      const hero=document.querySelector('.page-hero');
      const toc=document.querySelector('.zvm-trust-toc,.terms-toc');
      return {height:hero?.getBoundingClientRect().height??0,gradient:hero?getComputedStyle(hero).backgroundImage:'',tocHeight:toc?.getBoundingClientRect().height??0};
     });
     assert.equal(heading.gradient,'none',name+'/'+width+' green fog returned');
     assert(heading.height>0 && heading.height<260,name+'/'+width+' oversized document heading '+JSON.stringify(heading));
     if(width<=720)assert(heading.tocHeight<240,name+'/'+width+' mobile index consumes vertical reading space');
    }
    assert(rect.width/width>=min,name+'/'+width+' still narrow / excessively centralized '+JSON.stringify({rect,expected:min}));
    if(centered){
     const imbalance=Math.abs(rect.x-(width-rect.right));
     assert(imbalance<=90,name+'/'+width+' unbalanced gutters '+JSON.stringify(rect));
    }
    assert.equal(await page.locator('[data-buy-plan],a[href^="https://pay.cakto.com.br/"]').count(),0,name+'/'+width+' checkout appeared despite pause');
    if(width!==1440||name==='admin'){
     await page.screenshot({path:path.join(shots,'r47-05-'+name+'-'+width+'.png'),fullPage:false,animations:'disabled'});
    }
    rows.push({name,width,occupancy:Math.round(100*rect.width/width)});
    await page.close();checks++;
   }
  }
  console.log('R47.05 CHROMIUM PASS: '+checks+' offline wide viewports; '+JSON.stringify(rows));
 }finally{await browser.close()}
}
run().catch(e=>{console.error(e);process.exitCode=1});
