'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const template=read('src/web/public/landing/owner-template.html');
const homeCssPath='assets/zvm-sales-owner.a610cb96b94d.css';
const homeCss=read(homeCssPath);
const server=read('server.js');
const owner=require('../src/web/public/landing/owner');

assert(!template.includes('<header>'), 'retired home header is still present');
assert(!template.includes('owner-mobile-menu'), 'home cannot create its own menu');
assert.equal((template.match(/\{\{ZVM_PUBLIC_NAV\}\}/g)||[]).length,1);
assert(template.includes('class="zvm-public-premium zvm-owner-landing"'));
assert(template.includes('/assets/zvm-shared.6dac16eb7b5b.css'), 'public shared CSS');
assert(template.includes('/assets/zvm-standalone.d6d2222fe00a.css'), 'public standalone CSS');
assert(template.includes('{{ZVM_OWNER_CSS}}'), 'fingerprinted owner stylesheet');
assert(!homeCss.includes('owner-mobile-menu'), 'old duplicate menu CSS must be gone');
assert(homeCss.includes('body.zvm-owner-landing .hero'));
assert(homeCss.includes('body.zvm-owner-landing .mock'));
assert(homeCss.includes('body.zvm-owner-landing .owner-sale-status'));
assert(homeCss.includes('body.zvm-owner-landing .znav.standalone-nav'));
assert(homeCss.includes('body.zvm-owner-landing .wrap'));
assert(homeCss.includes('max-width:900px') && homeCss.includes('max-width:600px'));
assert(!homeCss.includes('!important'), 'no specificity overrides');
assert(!fs.existsSync(path.join(root,'assets/zvm-sales-owner.76ccce3f6669.css')), 'superseded CSS removed');
assert(server.includes('publicNavHtml: _sharedNav({activePath:'), 'single shared nav server path');
assert(server.includes('isPortalSession(req)?getPortalUser(req):null'), 'account status must respect session');
assert(server.includes('salesPaused: ZVM_SALES_PAUSED'), 'sales pause must remain server side');
assert(server.includes("if (await serveZVMCloud(req, res, p)) return;"), 'Cloud mount unchanged');

process.env.RENDER='true';process.env.NODE_ENV='test';
process.env.MONGODB_URI='mongodb://127.0.0.1:1/test';
process.env.ADMIN_USER='fixture-admin';process.env.ADMIN_PASS='fixture-password';
process.env.ANALYTICS_PASS='fixture-analytics';
process.env.APP_SECRET='fixture-long-app-secret-123456789-123456789-123456789';
const original=Module._load;
let api;
try {
  Module._load=function(id,...args){
    if(id==='mongodb')return {MongoClient:class OfflineMongo{}};
    return original.call(this,id,...args);
  };
  api=require('../server.js').__test;
} finally {Module._load=original;}
const esc=s=>String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plans={
 solo:{id:'solo',price:39.9,maxUses:1,enabled:true},
 padrao:{id:'padrao',price:59.9,maxUses:3,enabled:true},
 pro:{id:'pro',price:94.9,maxUses:5,enabled:true},
 enterprise_v2:{id:'enterprise_v2',maxUses:10,consult:true}
};
const supportUrl='https://wa.me/5521996771552?text=LR%20Preciso%20de%20ajuda';
function render(portalUser,paused=true){
 const publicNavHtml=api._sharedNav({activePath:'/',portalUser});
 return owner.renderOwnerSalesLanding({plans,salesPaused:paused,escHtml:esc,supportUrl,publicNavHtml});
}
for(const page of [render(null),render({name:'Cliente Teste',email:'client@example.test'})]){
 assert(page.includes('class="znav standalone-nav"'), 'home missing shared nav');
 assert.equal((page.match(/class="znav standalone-nav"/g)||[]).length,1,'duplicate site navbar');
 assert(page.includes(owner.OWNER_TOP_BRAND_SRC),'same logo as FAQ');
 assert(page.includes('class="owner-panel-brand-img"'),'site logo component');
 assert(page.includes('href="/#recursos"'),'same resource route');
 assert(page.includes('href="/#como"'),'same guide route');
 assert(page.includes('href="/planos"'),'same plan route');
 assert(page.includes('href="/faq"'),'same FAQ route');
 assert(page.includes('href="/privacidade"'),'same privacy route');
 assert(page.includes('href="/termos"'),'same terms route');
 assert(page.includes('class="owner-nav-install"'),'same install CTA');
 assert(page.includes('class="nav-menu-toggle"'),'shared mobile menu');
 assert(page.includes('/assets/zvm-nav.d7d7bba83d44.js'),'real nav toggle wired');
 assert(page.includes('/assets/zvm-sales-owner.a610cb96b94d.css'),'fingerprinted site stylesheet');
 assert(!page.includes('{{ZVM_'),'all server tokens resolved');
 assert(page.includes('id="aviso" role="status"'), 'sales pause visible');
 assert(!page.includes('https://pay.cakto.com.br/'), 'no direct payment bypass');
 assert(page.includes('id="main-content"'),'skip landmark preserved');
 for(const anchor of ['recursos','como','planos','faq']){
   assert(page.includes('id="'+anchor+'"'),'main navigation target '+anchor);
 }
}
const guest=render(null);
assert(guest.includes('href="/cliente/registro"'),'registration preserved for guests');
assert(guest.includes('class="nav-login"'),'guest sign in');
const loggedIn=render({name:'Cliente Teste',email:'client@example.test'});
assert(loggedIn.includes('class="nav-account"'), 'logged-in home must mirror the other pages');
assert(loggedIn.includes('Cliente Teste'), 'account display name');
assert(!loggedIn.includes('class="nav-login"'),'do not show logout users guest access');
const enabled=render(null,false);
assert(enabled.includes('id="aviso" hidden'),'pause notice must hide only when sales open');
assert(enabled.includes('data-nome="PRO"'),'plan contract retained');
assert(enabled.includes('Assinar PRO'),'eligible purchase label still managed by server');
for(const [label,renderPage] of [
 ['FAQ',()=>api.renderStandaloneFaqPage()],
 ['Planos',()=>api.renderPlanosPage(null)],
 ['Privacidade',()=>api.renderStandalonePrivacyPage()],
 ['Termos',()=>api.renderStandaloneTermsPage(null,'pt-BR')]
]){
 const html=renderPage();
 assert(html.includes(owner.OWNER_TOP_BRAND_SRC), label+' has same brand');
 assert(html.includes('class="znav standalone-nav"'), label+' uses the same header');
}
console.log('R48 unified homepage: shared nav, account session, 4 inner pages, visual CSS, pause and routes PASS');
