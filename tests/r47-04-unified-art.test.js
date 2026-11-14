'use strict';
// R47.04: verified visual-system migration and commercial integrity, offline only.
const assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const assets=[
 ['zvm-reference-public.8ab0217a54b3.css','8ab0217a54b394dcd8f1dea10cd6e7145a9e7550f605cde5644e800f971d55c9','zvm-reference-public.8fc0cb9c94d6.css',['--zvm-art-halo','.r4701-hero-visual:after','.r4700-journey-list li','.price-card.featured','.r4701-plans-hero:before']],
 ['zvm-auth-premium.d44a7ff35e68.css','d44a7ff35e683572d8c5e11175c15d9db05ea3ab9816891617813afdb970e5a4','zvm-auth-premium.0ab8f63f1cb8.css',['.auth-promo::after','.auth-form-card::before','.auth-benefits li','prefers-contrast:more']],
 ['zvm-console-design.1ee8679046a6.css','1ee8679046a6429c4fdc26c4df29650f28299a8118397377cdf1cdf48d982d33','zvm-console-design.fc18bc02c200.css',['.admin-overview::before','.client-rail','.client-license-focus','.client-quickfact']],
 ['zvm-legal-premium.52736d436442.css','52736d43644292225a83aea79e052b9a40fe41c3f2673f3f183cd2f4dc702db3','zvm-legal-premium.29b8336d5c01.css',['.page-hero::before','.zvm-trust-toc','.zvm-error-aside']],
 ['zvm-analytics-premium.cba05e60d098.css','cba05e60d098ba8481181176835069b8303b0683044dcdc1c50ea1fff8b5209d','zvm-analytics-premium.98c1933c3e7f.css',['.analytics-hero::before','.analytics-rail','.analytics-pulse','.chart-card','prefers-reduced-motion:reduce']]
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
 const fresh=css.slice(css.indexOf('/* R47.04'),name.includes('console-design')?css.indexOf('/* Legacy R8 set'):undefined);
 assert(fresh.includes('@media('),'new visual rules lack responsive/accessibility media');
 assert(!fresh.includes('!important'),'R47.04 must add no specificity overrides: '+name);
}
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
for(const p of ['privacy','terms','notFound','unavailable'])includes(p,assets[3][0]);
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
