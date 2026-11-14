'use strict';
// R47.01: trustworthy reference implementation, no payment/DB calls.
const assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto'),Module=require('node:module');
const root=path.resolve(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const landingSource=fs.readFileSync(path.join(root,'src/web/public/landing/render.js'),'utf8');
const cssName='zvm-reference-public.dea9e334f766.css';
const css=fs.readFileSync(path.join(root,'assets',cssName),'utf8');
const digest=crypto.createHash('sha256').update(css).digest('hex');
assert.equal(digest,'dea9e334f766deabb6f458713c469995353866ebdd5721a40100f5b11c281aae');
assert(server.includes("sha256: '"+digest+"'"),'new CSS full SHA missing');
assert(server.includes('/assets/'+cssName),'new CSS asset missing from allowlist/renderers');
assert(!css.includes('!important'),'no new CSS specificity hacks');
assert(css.includes('@media(max-width:570px)'),'required responsive breakpoint missing');
assert(css.includes('prefers-reduced-motion:reduce'),'accessible reduced motion missing');
assert(css.includes('prefers-contrast:more'),'higher contrast media rule missing');
const faqJsName='zvm-faq-experience.5cf1ddccd700.js',faqJs=fs.readFileSync(path.join(root,'assets',faqJsName));
assert.equal(crypto.createHash('sha256').update(faqJs).digest('hex'),'5cf1ddccd70018f9b6ca96b3b61a4ef55a09b1782a7193c080b2b247ea6b191e');
assert(server.includes("sha256: '5cf1ddccd70018f9b6ca96b3b61a4ef55a09b1782a7193c080b2b247ea6b191e'"));
assert(faqJs.toString().includes("event.key.toLowerCase()==='k'"),'FAQ Ctrl+K shortcut not implemented');
assert(!fs.existsSync(path.join(root,'assets/zvm-faq-experience.66e20508c9af.js')),'obsolete FAQ JS remains');

process.env.ZVM_SALES_PAUSED='1';process.env.RENDER='true';
process.env.ADMIN_USER='qa-r4701';process.env.ADMIN_PASS='dummy-only';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/zvm_reference_offline';
let api;const saved=Module._load;
try{Module._load=function(id,...args){if(id==='mongodb')return{MongoClient:class FakeDb{}};return saved.call(this,id,...args)};api=require(path.join(root,'server.js')).__test;}
finally{Module._load=saved}
const {localizePublicHtml}=require('../src/web/public/i18n');
const user={name:'Pessoa de teste',email:'buyer@example.invalid',keyCode:'test-key-only'};
const home=api.renderStandaloneLandingPage(null),faq=api.renderStandaloneFaqPage(null);
const plans=api.renderPlanosPage(null),member=api.renderPlanosPage(user);
const portal=api.renderPortalPlans(user,{planId:'solo',maxUses:1});
for(const [label,html] of [['home',home],['faq',faq],['plans',plans],['member',member]]){
 assert(html.includes('/assets/'+cssName),label+' missing reference CSS');
 assert(html.includes('id="main-content"'),label+' main landmark missing');
 assert(!html.includes('href="https://pay.cakto.com.br/'),label+' leaked payment link while paused');
 assert(!html.includes('data-buy-plan='),label+' exposed active checkout while paused');
}
assert(home.includes('class="r4701-hero-visual"'),'reference split hero missing');
assert(home.includes('/assets/zvm-shell-home-real.a9c1a0d7b030.png'),'genuine app screen missing');
assert(home.indexOf('id="jornada"')<home.indexOf('id="produto"'),'reference journey should precede demo');
assert.equal((home.match(/class="r4701-feature-card"/g)||[]).length,6,'six modules card grid missing');
assert(home.includes('class="r4701-workflow-showcase"'),'workflow feature section missing');
assert(home.includes('Visão ilustrativa'),'visual workflow must be labelled as illustrative');
assert(home.includes('Vendas temporariamente suspensas.'),'pause notice must remain');
const heroSection=home.slice(home.indexOf('<section class="r466-hero'),home.indexOf('<section class="r4700-product-trust"'));
assert.equal((heroSection.match(/r466-btn (?:primary|secondary)/g)||[]).length,2,'hero CTA count changed');
assert(landingSource.includes('renderProductTabs()'),'real product tabs must remain');

assert(faq.includes('class="r4701-question-art"'),'FAQ reference hero artwork missing');
assert.equal((faq.match(/class="r4701-faq-tile"/g)||[]).length,4,'FAQ should have four category cards');
assert.equal((faq.match(/<details class="faq-item" data-faq-item>/g)||[]).length,16,'16 canonical FAQs lost');
assert.equal((faq.match(/id="faq-search"/g)||[]).length,1,'FAQ search should not be duplicated');
assert(faq.indexOf('id="faq-search"')<faq.indexOf('class="r4700-faq-layout"'),'FAQ search should be full-width above content');
assert(faq.includes('Ctrl + K'),'the shown FAQ shortcut must be functional');
assert(faq.includes('class="r4700-faq-pause"'),'amber sales-paused banner must remain');


assert(plans.includes('class="r4701-license-demo"'),'Plans visual license preview missing');
assert(plans.includes('Prévia ilustrativa'),'do not pass off illustrative data as real');
assert(plans.includes('id="selecionar-plano"'),'Plans section jump link missing');
assert.equal((plans.match(/class="price-card(?: featured)?"/g)||[]).length,4,'official price cards not preserved');
for(const price of ['39<span>,90','59<span>,90','94<span>,90'])assert(plans.includes(price),'contract price missing '+price);
assert(plans.includes('class="price-card featured"'),'PRO featured without changing price');
assert(plans.includes('class="r4701-plans-included"'),'six-feature comparison missing');
assert.equal((plans.match(/class="r4701-plans-included-grid"/g)||[]).length,1);
assert(plans.includes('class="r4701-plans-faq"'),'pricing FAQ section missing');
assert(plans.includes('A chave é vinculada depois da compra'),'guest purchase key guidance missing');
assert(plans.includes('href="/cliente/vincular"'),'license linking destination missing');
assert(plans.includes('Vendas em pausa'),'final CTA must not solicit payment when paused');
assert(member.includes('r4701-license-demo'),'signed-in visitor sees same reference design');
assert(portal.includes('r4700-purchase-journey'),'authenticated Portal continues unchanged');
assert(server.includes("if (p === '/cakto/webhook' && req.method === 'POST')"),'fulfillment must stay enabled');
for(const [name,html,url] of [['home',home,'/'],['faq',faq,'/faq'],['plans',plans,'/planos']]){
 const en=localizePublicHtml(html,'en',{path:url});
 assert(en.includes('<html lang="en"'),name+' English locale broken');
 assert(en.includes('zvm-experience'),name+' loses public design in English');
 if(name==='faq')assert(en.includes('Help Center.')&&en.includes('Search the Help Center'), 'FAQ English reference copy missing');
 if(name==='plans')assert(en.includes('Plans and Licenses')&&en.includes('Sales paused'),'Plans English pause guidance missing');
}
console.log('R47.01 REFERENCE PASS: real product screenshot, full-width FAQ, 4 genuine catalog plans, responsive design integrity, 3 locales and pause invariant');
