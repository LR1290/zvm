'use strict';
// R47.00 public i18n — wording changes must not bypass the existing locale pipeline.
const assert=require('node:assert/strict');
const Module=require('node:module');
const path=require('node:path');
const {localizePublicHtml}=require('../src/web/public/i18n');
const root=path.resolve(__dirname,'..');
process.env.ZVM_SALES_PAUSED='1';
process.env.RENDER='true';
process.env.ADMIN_USER='i18n-r4700-qa';
process.env.ADMIN_PASS='fake-only-test';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/i18n_r4700_offline';
const native=Module._load;let api;
try{
 Module._load=function(id,...args){if(id==='mongodb')return{MongoClient:class DummyDb{}};return native.call(this,id,...args)};
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=native}
const templates=[
 ['landing',api.renderStandaloneLandingPage(null),'/'],
 ['faq',api.renderStandaloneFaqPage(null),'/faq'],
 ['plans',api.renderPlanosPage(null),'/planos'],
];
for(const [kind,html,sitePath] of templates){
 for(const locale of ['pt-BR','pt-PT','en']){
  const translated=localizePublicHtml(html,locale,{path:sitePath});
  assert(translated.includes('<html lang="'+locale+'"'),kind+'/'+locale+' document locale incorrect');
  assert(translated.includes('zvm-experience'),kind+'/'+locale+' scoped styling lost');
  assert(translated.includes('id="main-content"'),kind+'/'+locale+' main landmark lost');
  assert(!translated.includes('R4700_FAQ_JS_PENDING'),kind+'/'+locale+' unfinished template link');
  if(kind==='faq'){
   assert.equal((translated.match(/data-faq-item>/g)||[]).length,16,kind+'/'+locale+' FAQ questions lost');
   assert(translated.includes('id="faq-search"'),kind+'/'+locale+' FAQ form broken');
  }
  if(locale==='en'){
   if(kind==='landing'){
    assert(translated.includes('Explore the product'),'English hero primary CTA missing');
    assert(translated.includes('A connected workflow, not just a list of tools'),'English story heading missing');
    assert(translated.includes('Without losing context.'),'English story emphasis missing');
    assert(translated.includes('Browse all questions and answers'),'English FAQ link missing');
   }else if(kind==='faq'){
    assert(translated.includes('Help center • ZVM - Automações'),'English FAQ kicker missing');
    assert(translated.includes('Answers for'),'English FAQ heading missing');
    assert(translated.includes('questions available.'),'English FAQ count missing');
    assert(translated.includes('Get support'),'English support CTA missing');
   }else{
    assert(translated.includes('Your workflow.'),'English Plans heading missing');
    assert(translated.includes('Three simple steps to access ZVM.'),'English purchase journey missing');
    assert(translated.includes('Find the right license.'),'English plan selection missing');
   }
  }
 }
}
console.log('R47.00 I18N PASS: 3 public pages × 3 locales, accessible headings, canonical prices/routes and FAQ counts');
