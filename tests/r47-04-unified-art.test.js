'use strict';
// R47.04: verified visual-system migration and commercial integrity, offline only.
const assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const assets=[
 ['zvm-reference-public.19040fd11331.css','19040fd113310e45c7f9096fdb75aece8f7a82a9cc5496781405fad178e2805b','zvm-reference-public.8fc0cb9c94d6.css',['--zvm-art-halo','.r4701-hero-visual:after','.r4700-journey-list li','.price-card.featured','.r4701-plans-hero:before']],
 ['zvm-auth-premium.a96f915db3f4.css','a96f915db3f4102b08fc53c39a66a3c1fbeffc0a017d09c0697c1f9c5976f020','zvm-auth-premium.0ab8f63f1cb8.css',['.auth-promo::after','.auth-form-card::before','.auth-benefits li','prefers-contrast:more']],
 ['zvm-console-design.44762cb103f8.css','44762cb103f86784b9a7ad5dccf99b5ec304076e728f5dac1bb7875631cb7349','zvm-console-design.fc18bc02c200.css',['.admin-overview::before','.client-rail','.client-license-focus','.client-quickfact']],
 ['zvm-legal-premium.a828eee21356.css','a828eee213564319d2ca10241ce281301f9e33b364152aac47a1e29baa8af1c5','zvm-legal-premium.29b8336d5c01.css',['.page-hero::before','.zvm-trust-toc','.zvm-error-aside']],
 ['zvm-analytics-premium.e8ce624836b1.css','e8ce624836b1715d4dd8d4d44c73563e2aa2250f74f0990b9020ff0f0d3b3ef6','zvm-analytics-premium.98c1933c3e7f.css',['.analytics-hero::before','.analytics-rail','.analytics-pulse','.chart-card','prefers-reduced-motion:reduce']]
];
for(const [name,hash,old,selectors] of assets){
 const css=fs.readFileSync(path.join(root,'assets',name),'utf8');
 assert.equal(crypto.createHash('sha256').update(css).digest('hex'),hash,'mismatched immutable SHA '+name);
 assert(server.includes("sha256: '"+hash+"'"),'asset registry lacks '+name);
 assert(server.includes('/assets/'+name),'asset HTML/registry lacks '+name);
 assert(!fs.existsSync(path.join(root,'assets',old)),'retired source asset retained '+old);
 assert(!server.includes(old),'retired CSS still referenced by server: '+old);
 for(const sel of selectors)assert(css.includes(sel),'missing cohesive visual element '+name+'/'+sel);
 if(!name.includes('console-design'))assert(!css.includes('!important'),'new styling debt in '+name);
 assert(!/radial-gradient\(\s*ellipse\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%\s+at/i.test(css),'invalid elliptical gradient syntax '+name);
 const fresh=css.slice(css.indexOf('/* R47.04'),name.includes('console-design')?css.indexOf('/* Legacy R8 set'):undefined);
 assert(fresh.includes('@media('),'new visual rules lack responsive/accessibility media');
 assert(!fresh.includes('!important'),'R47.04 must add no specificity overrides: '+name);
}
// A global R46 legacy CSS !important had neutralized R47.04 backgrounds.
const systemFile='zvm-r46-system.cf01433d7f45.css';
const legacySystemFile='zvm-r46-system.8873e4d662f5.css';
const systemCss=fs.readFileSync(path.join(root,'assets',systemFile),'utf8');
assert.equal(crypto.createHash('sha256').update(systemCss).digest('hex'),
 'cf01433d7f45c6054eefdc7a33b8f80c225b94bbe2c927b04a1ebe1809a79b6b',
 'immutable global CSS fingerprint');
assert(server.includes('/assets/'+systemFile),'new canonical system CSS not linked');
assert(!server.includes(legacySystemFile),'obsolete global CSS registry leaked');
assert(!fs.existsSync(path.join(root,'assets',legacySystemFile)),
 'unreferenced legacy system CSS retained');
assert(!systemCss.includes('.page-hero{background:transparent!important'),
 'global hero transparent lock blocks the approved illustrations');
assert(!systemCss.includes(',.analytics-hero,.analytics-pulse,.analytics-insights>*,.admin-overview,.admin-pulse,.chart-card,.viz-frame,.doc-section,.faq-item{background:linear-gradient(180deg,rgba(8,20,13,.90),rgba(4,11,7,.90))!important'),
 'global surface important lock still masks local art');
process.env.ZVM_SALES_PAUSED='1';process.env.RENDER='true';
process.env.ADMIN_USER='r4704-test-admin';process.env.ADMIN_PASS='r4704-test-only';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/zvm_r4704_offline';
let api;const load=Module._load;
try{
 Module._load=function(id,...rest){if(id==='mongodb')return{MongoClient:class OfflineMongo{}};return load.call(this,id,...rest)};
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=load}
const user={name:'Pessoa Teste',email:'qa@example.invalid',_id:'qa@example.invalid',verified:true};
const key={code:'r4704-licence',label:'Licença de laboratório',active:true,planId:'solo',maxUses:1,phones:[]};
const pages={
 home:api.renderStandaloneLandingPage(null),
 faq:api.renderStandaloneFaqPage(null),
 plans:api.renderPlanosPage(null),
 login:api.renderStandalonePortalLogin(),
 register:api.renderStandalonePortalRegister(),
 client:api.renderPortalDashboard(user,key,'',''),
 admin:api.renderAdminDashboard({keysSnapshot:{[key.code]:key},portalUsers:[],portalUserCount:0}),
 privacy:api.renderStandalonePrivacyPage(null),
 terms:api.renderStandaloneTermsPage(null,'pt-BR'),
 notFound:api.renderStandalone404Page(null),
 unavailable:api.renderStandalone500Page(null)
};
const includes=(page,file)=>assert(pages[page].includes('/assets/'+file),page+' missing '+file);
for(const p of ['home','faq','plans'])includes(p,assets[0][0]);
for(const p of ['login','register'])includes(p,assets[1][0]);
for(const p of ['client','admin'])includes(p,assets[2][0]);
for(const p of ['notFound','unavailable'])includes(p,assets[3][0]);
for(const p of ['privacy','terms']){
 includes(p,'zvm-legal-reading.49002e7e3dc1.css');
 assert(!pages[p].includes('/assets/'+assets[3][0]),'legal page must not load recovery art CSS: '+p);
}
assert(server.includes('/assets/'+assets[4][0]),'Analytics new CSS not linked');
assert(pages.home.includes('zvm-shell-home-real.a9c1a0d7b030.png'),'genuine product image removed');
assert(pages.faq.includes('r4701-question-art'),'FAQ artwork lost');
assert(pages.plans.includes('r4701-license-demo'),'approved pricing concept removed');
for(const p of ['home','faq','plans']){
 assert(!pages[p].includes('data-buy-plan='),'paused purchases leaked on '+p);
 assert(!pages[p].includes('https://pay.cakto.com.br/'),'checkout leaked on '+p);
}
assert(server.includes("if (p === '/cakto/webhook' && req.method === 'POST')"),'existing Cakto delivery route missing');
console.log('R47.04 PASS: five versioned CSS migrations, eleven synchronously rendered pages, Analytics link, real product art and paused commerce');
