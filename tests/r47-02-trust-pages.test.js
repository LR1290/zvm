'use strict';
// R47.02: offline legal/recovery design contract; no real data, payments or network.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Module=require('node:module');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'server.js'),'utf8');
const cssFile='zvm-legal-premium.a828eee21356.css';
const hash='a828eee213564319d2ca10241ce281301f9e33b364152aac47a1e29baa8af1c5';
const css=fs.readFileSync(path.join(root,'assets',cssFile),'utf8');
const readingCssFile='zvm-legal-reading.49002e7e3dc1.css';
const readingHash='49002e7e3dc1e341831d1532929de7806ca9b1b11773e0db603fc8321b66806b';
const readingCss=fs.readFileSync(path.join(root,'assets',readingCssFile),'utf8');
assert.equal(crypto.createHash('sha256').update(readingCss).digest('hex'),readingHash,'legal reading stylesheet digest');
assert(source.includes('/assets/'+readingCssFile),'legal reading CSS must be served');
assert(source.includes("sha256: '"+readingHash+"'"),'legal reading asset SHA missing in server');
assert(!readingCss.includes('radial-gradient'),'legal reading stylesheet must not paint green fog');
assert(readingCss.includes('max-width:1100px'),'document width must be capped');
assert.equal(crypto.createHash('sha256').update(css).digest('hex'),hash,'immutable legal CSS digest');
assert(source.includes("sha256: '"+hash+"'"),'CSS must be in integrity registry');
assert(source.includes('/assets/'+cssFile),'legal CSS not linked');
assert(!source.includes('zvm-legal-premium.222751f96dd9.css'),'old stylesheet referenced');
assert(!fs.existsSync(path.join(root,'assets/zvm-legal-premium.222751f96dd9.css')),'obsolete stylesheet not removed');
assert(!css.includes('!important'),'new CSS adds specificity debt');
for(const required of ['.zvm-trust-layout','.zvm-trust-toc','.terms-wrap','.zvm-error-grid','@media(max-width:420px)','prefers-reduced-motion:reduce']){
 assert(css.includes(required),'missing responsive layout '+required);
}

process.env.ZVM_SALES_PAUSED='1';process.env.RENDER='true';
process.env.ADMIN_USER='r4702-legal-fixture';process.env.ADMIN_PASS='test-only-not-a-credential';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/r4702_offline';
const original=Module._load;let api;
try{
 Module._load=function(id,...args){
  if(id==='mongodb')return {MongoClient:class MockMongoNoNetwork{}};
  return original.call(this,id,...args);
 };
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=original}
const privacy=api.renderStandalonePrivacyPage(null);
const terms=['pt-BR','pt-PT','en'].map(lang=>[lang,api.renderStandaloneTermsPage(null,lang)]);
const notFound=api.renderStandalone404Page(null);
const unavailable=api.renderStandalone500Page(null);
assert(notFound.includes('/assets/'+cssFile)&&unavailable.includes('/assets/'+cssFile),'recovery pages must retain their original error presentation');
const ids=['dados','uso','terceiros','retencao','seguranca','direitos','cookies','google','contato'];
assert.equal((privacy.match(/<section class="doc-section"/g)||[]).length,9,'privacy 9 sections preserved');
assert.equal((privacy.match(/<\/section>/g)||[]).length,9,'privacy 9 section closings preserved');
assert.equal((privacy.match(/<li><a href="#privacidade-/g)||[]).length,9,'nine privacy TOC entries');
for(const id of ids){
 assert(privacy.includes('id="privacidade-'+id+'"'),id+' section anchor missing');
 assert(privacy.includes('id="heading-privacidade-'+id+'"'),id+' heading ID missing');
 assert(privacy.includes('href="#privacidade-'+id+'"'),id+' contents link missing');
 assert(privacy.includes('aria-labelledby="heading-privacidade-'+id+'"'),id+' section heading binding missing');
}
assert(privacy.includes('/assets/'+readingCssFile),'privacy reading CSS missing');
assert(!privacy.includes('/assets/'+cssFile),'privacy must not load obsolete error artwork CSS');
assert(privacy.includes('class="zvm-trust-layout"'),'privacy two-column layout not rendered');
assert(privacy.includes('class="zvm-trust-toc"'),'privacy navigation missing');
assert(!privacy.includes('Última atualização:')&&!privacy.includes('const updDate'),'privacy may not invent a daily policy revision');
assert(privacy.includes('Lei Geral de Proteção de Dados')&&privacy.includes('Não vendemos dados pessoais'),'Privacy copy changed');
for(const [lang,html] of terms){
 assert(html.includes('<html lang="'+lang+'"'),'locale lost '+lang);
 assert(html.includes('class="terms-toc"')&&html.includes('class="terms-body"'),'terms canonical index/content broken');
 assert(html.includes('/assets/'+readingCssFile),'terms reading CSS not loaded');
 assert(!html.includes('/assets/'+cssFile),'terms must not load recovery artwork CSS');
 assert(html.includes('<main id="main-content" class="terms-main">'),'terms landmark changed');
 assert(html.includes('href="/privacidade"'),'terms privacy link missing');
}
for(const [name,html] of [['404',notFound],['500',unavailable]]){
 assert(html.includes('<meta name="robots" content="noindex">'),name+' indexing safeguard missing');
 assert(html.includes('<main id="main-content" class="err-wrap zvm-trust-error'),name+' recovery landmark missing');
 assert(html.includes('class="zvm-error-aside"'),name+' recovery alternatives missing');
 assert(html.includes('href="/faq"')&&html.includes('href="/cliente"'),name+' navigation shortcuts missing');
 assert(html.includes('r466-footer'),name+' shared footer absent');
 assert(!html.includes('data-buy-plan=')&&!html.includes('https://pay.cakto.com.br/'),name+' exposed checkout');
}
assert(notFound.includes('Essa página não existe.'),'404 meaning lost');
assert(unavailable.includes('indisponibilidade temporária'),'500 meaning lost');
const plans=api.renderPlanosPage(null);
assert(plans.includes('Vendas temporariamente suspensas.'),'owner commercial pause changed');
assert(!plans.includes('data-buy-plan=')&&!plans.includes('data-checkout='),'public payment activated');
console.log('R47.02 PASS: 9 privacy anchors and headings, three terms locales, two safe recovery pages, SHA-256, paused sales');
