'use strict';
// R46.94 Chromium smoke with ONLY fictitious users/licenses. No production URLs.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const { chromium }=require('playwright');
const root=path.resolve(__dirname,'..');
process.env.RENDER='true';
process.env.ADMIN_USER='zvm-ui-qa';
process.env.ADMIN_PASS='zvm-ui-qa-fixture';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/zvm_visual_qa_offline';
const native=Module._load;
let api;
try{
 Module._load=function(id,...args){
  if(id==='mongodb')return {MongoClient:class OfflineMongoFixture{}};
  return native.call(this,id,...args);
 };
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=native}
const key={code:'zvm-qa-visual',label:'Licença fictícia',active:true,
 phones:['551100000001','551100000002'],maxUses:3,planId:'monthly',
 createdAt:'2026-11-01T00:00:00.000Z',expiresAt:'2027-11-01T00:00:00.000Z'};
const user={name:'Cliente Visual QA',_id:'qa@example.invalid',email:'qa@example.invalid',verified:true};
const adminHtml=api.renderAdminDashboard({keysSnapshot:{[key.code]:key},portalUsers:[],portalUserCount:0});
const clientHtml=api.renderPortalDashboard(user,key,'','');
const adminRows=(adminHtml.match(/<tbody id="kb">([\s\S]*?)<\/tbody>/)||[])[1]||'';
const out=path.join(root,'artifacts','visual-qa');
fs.mkdirSync(out,{recursive:true});
async function run(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 let count=0;
 try{
  for(const [label,html] of [
   ['admin',adminHtml],['client',clientHtml],
   ['login',api.renderStandalonePortalLogin()],
   ['register',api.renderStandalonePortalRegister()],
   ['verify-2fa',api.renderStandalone2FAVerify()],
   ['recovery',api.renderStandalonePortalResetRequest()],
   ['reset',api.renderStandalonePortalResetForm('','','fixture-token')],
   ['admin-login',api.renderAdminLogin()],
   ['analytics-login',api.renderAnalyticsLogin()]
  ]){
   for(const width of [1440,390,320]){
    const page=await browser.newPage({viewport:{width,height:width===1440?900:760},deviceScaleFactor:1,reducedMotion:'reduce'});
    const errs=[];
    page.on('pageerror',err=>errs.push(String(err.message)));
    await page.route('**/*',async route=>{
     const url=new URL(route.request().url());
     if(url.hostname!=='zvm.local'){await route.abort();return;}
     if(url.pathname==='/'+label+'-qa'){
      await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html});return;
     }
     if(url.pathname.startsWith('/assets/')){
      const name=path.basename(decodeURIComponent(url.pathname));
      if(!/^[a-zA-Z0-9_.-]+$/.test(name)){await route.fulfill({status:400,body:'Bad asset'});return;}
      const file=path.join(root,'assets',name);
      if(!fs.existsSync(file)){await route.fulfill({status:404,body:'Missing fixture asset: '+name});return;}
      await route.fulfill({status:200,contentType:name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'application/octet-stream',body:fs.readFileSync(file)});return;
     }
     if(url.pathname.endsWith('/api/data')){
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
       totalKeys:1,activeKeys:1,blockedKeys:0,deferredKeys:0,expiredKeys:0,warnKeys:0,
       suspectKeys:0,totalLogs:0,keysHtml:adminRows,logsHtml:'',ok:true
      })});return;
     }
     if(url.pathname.endsWith('/api/portal-users')||url.pathname.endsWith('/api/ip-blacklist')){
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,users:[],ips:[]})});return;
     }
     await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
    });
    await page.addInitScript(()=>{try{localStorage.removeItem('zvmTab')}catch(_){}});
    await page.goto('http://zvm.local/'+label+'-qa',{waitUntil:'load'});
    await page.waitForTimeout(220);
    assert.deepEqual(errs,[],label+'/'+width+' JS runtime errors');
    const overflow=await page.evaluate(()=>({
      scroll:document.documentElement.scrollWidth,
      inner:window.innerWidth,
      body:document.body.scrollWidth
    }));
    if(overflow.scroll>width+4){
      const offenders=await page.evaluate(()=>{
        return [...document.body.querySelectorAll('*')].map(el=>({tag:el.tagName.toLowerCase(),
          className:typeof el.className==='string'?el.className.slice(0,100):'',
          right:Math.round(el.getBoundingClientRect().right),
          width:Math.round(el.getBoundingClientRect().width)}))
          .filter(x=>x.right>innerWidth+4).sort((a,b)=>b.right-a.right).slice(0,8);
      });
      assert.fail(label+'/'+width+' horizontal viewport overflow: '+JSON.stringify({overflow,offenders}));
    }
    if(label==='admin'){
      const nav=page.locator('#rsidebar');
      assert(await nav.isVisible(),'Admin navigation should always remain visible');
      if(width===1440){
       const box=await nav.boundingBox();
       assert(box.width>=190,'desktop sidebar should be expanded');
      }
      await page.locator('.rtab[data-tab="security"]').click();
      assert.equal(await page.locator('.rtab[data-tab="security"]').getAttribute('aria-current'),'page');
      assert(await page.locator('.sec-panel[data-panel="security"]').isVisible());
      await page.locator('.rtab[data-tab="keys"]').click();
    }else if(label==='client'){
      assert(await page.locator('.client-quickfacts .client-quickfact').count()===3);
      assert(await page.locator('.client-device-list .device-row').count()===2);
      assert(await page.locator('a[href="/cliente/2fa/setup"]').count()>0);
      if(width<=390){
       const rail=await page.locator('.client-rail').evaluate(el=>{
         const nav=el.querySelector('.client-nav');
         return {
           height:el.getBoundingClientRect().height,
           display:getComputedStyle(nav).display,
           scrollable:nav.scrollWidth>nav.clientWidth,
           card:getComputedStyle(el.querySelector('.client-rail-card')).display,
         };
       });
       assert(rail.height<210,'mobile account navigation must not cover first viewport: '+JSON.stringify(rail));
       assert.equal(rail.display,'flex','mobile nav must stay in a single swipeable row');
       assert.equal(rail.card,'none','redundant rail card must be hidden on small screens');
       assert(rail.scrollable,'all account routes must remain reachable by horizontal scroll');
      }
      if(width===320){
       const display=await page.locator('.client-command-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns);
       assert(display&&!display.includes('330px'),'mobile cards must reflow');
      }
    }else{
      const card=page.locator('.auth-form-card');
      assert(await card.isVisible(),label+'/'+width+' auth card missing');
      const rect=await card.boundingBox();
      assert(rect&&rect.x>=-3&&rect.x+rect.width<=width+3,label+'/'+width+' auth card outside viewport');
      if(width<=390)assert(rect.y<700,label+'/'+width+' auth form hidden below mobile first viewport');
      const input=page.locator('.auth-form-card input:not([type="hidden"])').first();
      assert(await input.count()>0,label+'/'+width+' missing form input');
      await input.focus();
      const focus=await input.evaluate(el=>({active:document.activeElement===el,
        outline:getComputedStyle(el).outlineStyle,shadow:getComputedStyle(el).boxShadow}));
      assert(focus.active&&(focus.outline!=='none'||focus.shadow!=='none'),label+'/'+width+' focus invisible');
      assert(await page.locator('.auth-submit').isVisible(),label+'/'+width+' submit hidden');
    }
    await page.screenshot({path:path.join(out,label+'-'+width+'.png'),fullPage:true,animations:'disabled'});
    count++;
    await page.close();
   }
  }
  console.log('R46.95 CHROMIUM PASS: '+count+' rendered screens (Admin/Client/Auth x 1440/390/320), navigation, focus, overflow and JS runtime');
 }finally{await browser.close()}
}
run().catch(err=>{console.error(err);process.exitCode=1});
