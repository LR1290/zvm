'use strict';
// R47.00 — visual experience contracts, no external payment, account or DB operations.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Module=require('node:module');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'server.js'),'utf8');
const htmlSource=fs.readFileSync(path.join(root,'src/web/public/landing/render.js'),'utf8');
for(const [name,digest] of [
 ['zvm-public-experience.a4975afdd005.css','a4975afdd0057815454bf7d2a5b7c05159a8755524c49c556b75c3b4290129bc'],
 ['zvm-faq-experience.531cb23ececc.js','531cb23ececcb3ce1a1ac99349df1618c25c6ac88c9ea92d536aed58bc70f9b2']
]){
 const body=fs.readFileSync(path.join(root,'assets',name));
 const actual=crypto.createHash('sha256').update(body).digest('hex');
 assert.equal(actual,digest,'SHA-256 drift: '+name);
 assert(source.includes("sha256: '"+actual+"'"),'asset must be registered by full digest: '+name);
 assert(source.includes('/assets/'+name),'asset must appear in HTML or link constant: '+name);
}
const css=fs.readFileSync(path.join(root,'assets/zvm-public-experience.a4975afdd005.css'),'utf8');
const js=fs.readFileSync(path.join(root,'assets/zvm-faq-experience.531cb23ececc.js'),'utf8');
assert(!css.includes('!important'),'new public experience CSS must not accumulate overrides');
assert(css.includes('@media(max-width:460px)'),'mobile 320px responsive rule absent');
assert(css.includes('prefers-reduced-motion:reduce'),'reduced motion rule absent');
assert(css.includes('prefers-contrast:more'),'contrast option absent');
assert(js.includes("normalize('NFD')"),'FAQ search needs accent-tolerant matching');
assert(!htmlSource.includes('R4700_FAQ_JS_PENDING')&&!source.includes('R4700_FAQ_JS_PENDING'));
assert(!source.includes('onsubmit="return false"'),'FAQ form cannot rely on inline JavaScript');
assert(source.includes("const ZVM_SALES_PAUSED = "),'existing owner pause switch removed');

process.env.ZVM_SALES_PAUSED='1';
process.env.RENDER='true';
process.env.ADMIN_USER='r4700-qa-only';
process.env.ADMIN_PASS='r4700-only-fake';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/zvm_r4700_offline';
const load=Module._load;let api;
try{
 Module._load=function(id,...args){
  if(id==='mongodb')return {MongoClient:class MockMongoOffline{}};
  return load.call(this,id,...args);
 };
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=load}
const guest=api.renderPlanosPage(null);
const customer={name:'Cliente Teste',email:'buyer@example.invalid',keyCode:'zv-test-fixture'};
const member=api.renderPlanosPage(customer);
const portal=api.renderPortalPlans(customer,{planId:'solo',maxUses:1,expiresAt:'2030-01-01T00:00:00Z'});
const home=api.renderStandaloneLandingPage(null);
const faq=api.renderStandaloneFaqPage(null);
for(const [type,html] of [['landing',home],['plans-guest',guest],['plans-member',member],['faq',faq]]){
 assert(html.includes('/assets/zvm-public-experience.a4975afdd005.css'),type+' missing experience CSS');
 assert(html.includes('zvm-experience'),type+' missing scoped class');
 assert(html.includes('id="main-content"'),type+' missing main landmark');
}
assert(home.includes('Organize o atendimento.'),'approved hero copy changed');
assert(home.includes('id="jornada"'),'journey lacks anchor');
for(const section of ['produto','beneficios','recursos','planos','faq']){
 assert(home.includes('id="'+section+'"'),'landing section missing '+section);
}
for(const step of ['Atenda','Organize','Reutilize','Automatize']){
 assert(home.includes('<h3>'+step+'</h3>'),'journey step missing '+step);
}
assert(home.includes('zvm-shell-home-real.a9c1a0d7b030.png'),'must preserve real product screenshot');
assert(home.includes('r4700-product-trust'),'feature trust strip missing');
assert(home.includes('r466-sales-paused'),'pause notice must remain in landing');
assert(!home.includes('href="https://pay.cakto.com.br/'),'landing cannot advertise direct checkouts during pause');
assert(home.includes('Ver todas as perguntas e respostas'),'FAQ continuation missing');

assert(faq.includes('aria-label="Navegação da central de ajuda"'),'FAQ navigation missing');
assert(faq.includes('role="search"')&&faq.includes('id="faq-search"'),'FAQ search missing');
assert(faq.includes('id="faq-result-status" role="status" aria-live="polite"'),'FAQ live feedback missing');
assert(faq.includes('r4700-faq-pause'),'FAQ must display current sales pause');
for(const id of ['faq-compra','faq-licenca','faq-produto','faq-conta']){
 assert(faq.includes('id="'+id+'"'),'FAQ group missing '+id);
 assert(faq.includes('href="#'+id+'"'),'FAQ navigation link missing '+id);
}
assert.equal((faq.match(/<details class="faq-item" data-faq-item>/g)||[]).length,16,'16 canonical FAQ questions expected');
assert(faq.includes('Não. Quando as vendas estiverem abertas'),'guest checkout FAQ contract lost');

for(const [name,html] of [['guest',guest],['member',member],['portal',portal]]){
 assert(html.includes('r4700-purchase-journey'),name+' missing 3-stage purchase guidance');
 for(const a of ['Escolha sua licença','Receba e vincule a chave']){
  assert(html.includes(a),name+' missing guidance '+a);
 }
 assert(html.includes('/cliente/vincular'),name+' must show account-linking destination');
 assert(!html.includes('data-buy-plan=')&&!html.includes('data-checkout='),name+' must remain paused');
 assert(!html.includes('href="https://pay.cakto.com.br/'),name+' exposes Cakto while paused');
}
assert(guest.includes('39<span>,90')&&guest.includes('59<span>,90')&&guest.includes('94<span>,90'),'original licensed prices altered');
assert(!guest.includes('data-login-plan='),'mandatory login gate must remain retired');
assert(guest.includes('r4700-plans-assurance'),'product capabilities comparison missing');
assert(portal.includes('/assets/zvm-public-experience.a4975afdd005.css'),'client plans need same design language');
assert(source.includes("if (p === '/cakto/webhook' && req.method === 'POST')"),'webhook for already-paid purchases removed');
console.log('R47.00 PASS: 5 page states, 16 FAQ questions, shared purchase journey, genuine demo, responsive asset SHA and paused sales');
