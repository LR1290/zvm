'use strict';
// R46.96 - Public visual modernization: rendering and commercial invariants, offline.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Module=require('node:module');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'server.js'),'utf8');
const found=source.match(/const _CSS_PUBLIC_PREMIUM = '<link rel="stylesheet" href="\/assets\/(zvm-public-premium\.([a-f0-9]{12})\.css)">';/);
assert(found,'missing versioned public stylesheet');
const css=fs.readFileSync(path.join(root,'assets',found[1]),'utf8');
const sha=crypto.createHash('sha256').update(css).digest('hex');
assert.equal(found[2],sha.slice(0,12),'public asset prefix SHA-256');
assert(source.includes("sha256: '"+sha+"'"),'asset registry SHA must match file');
assert(css.includes('body.zvm-public-premium'),'style must be page-scoped');
assert(css.includes('.standalone-nav .znav-links{display:none}'),'mobile navigation must not be forced open by legacy CSS');
assert(!css.includes('!important'),'new design must not add specificity debt');
for(const x of ['@media(max-width:900px)','@media(max-width:620px)',
 'prefers-reduced-motion:reduce','prefers-contrast:more','focus-visible']){
 assert(css.includes(x),'missing public a11y/reflow rule: '+x);
}
const lum=h=>{
 const v=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255);
 return v.map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4)
  .reduce((a,n,i)=>a+n*[.2126,.7152,.0722][i],0);
};
const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
assert(contrast('#f3f8f4','#101a16')>=4.5,'primary text contrast');
assert(contrast('#b7cbbf','#101a16')>=4.5,'secondary text contrast');
assert(contrast('#082118','#46e3a2')>=4.5,'CTA contrast');

process.env.RENDER='true';process.env.ADMIN_USER='public-qa';
process.env.ADMIN_PASS='public-only-fixture';process.env.MONGODB_URI='mongodb://127.0.0.1:27017/public_qa_offline';
const original=Module._load;
let api;
try{
 Module._load=function(name,...args){
  if(name==='mongodb')return {MongoClient:class MockMongo{}};
  return original.call(this,name,...args);
 };
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=original}
const home=api.renderStandaloneLandingPage(null);
const plans=api.renderPlanosPage(null);
const faq=api.renderStandaloneFaqPage(null);
const fixtureUser={name:'Cliente ficticio',email:'qa@example.invalid',keyCode:''};
const logged=api.renderPlanosPage(fixtureUser);
for(const [name,html,bodyClass] of [
 ['home',home,'r466-body zvm-public-premium'],
 ['plans',plans,'zvm-public-premium zvm-plans-premium'],
 ['faq',faq,'zvm-public-premium zvm-faq-premium'],
 ['plans-logged',logged,'zvm-public-premium zvm-plans-premium']]){
 assert(html.includes('class="'+bodyClass+'"'),name+' missing scoped body');
 assert(html.includes('/assets/'+found[1]),name+' missing stylesheet');
 assert(html.includes('id="main-content"'),name+' missing main landmark');
 assert(html.includes('aria-label="Navega'),name+' missing public navigation');
}
assert(home.includes('id="produto"')&&home.includes('id="recursos"'),'landing anchors were removed');
assert(home.includes('r466-tab-strip'),'real UI preview tabs must remain');
assert(home.includes('href="/planos'),'landing must link to canonical plans route');
assert(plans.includes('name="need"'),'plans selector must remain');
assert(plans.includes('class="checkout-dialog"'),'native checkout dialog must remain');
assert(plans.includes('data-buy-plan='),'visitor checkout should not require login');
assert(!plans.includes('data-login-plan='),'obsolete mandatory login checkout must be absent');
assert(plans.includes('purchase-link-notice'),'linking guidance must be present');
assert(logged.includes('class="buyer-box"'),'signed-in purchase identity must remain');
assert(logged.includes('qa@example.invalid'),'signed-in identity must match user');
assert(!plans.includes('qa@example.invalid'),'anonymous page must not receive other identity');
assert(faq.includes('class="faq-item"'),'native FAQ disclosures must remain');
assert(faq.includes('<details class="faq-item">'),'FAQ must remain keyboard usable');
for(const p of ['href="/cliente"','href="/planos"'])assert(home.includes(p),'home missing route '+p);
assert(!source.includes('zvm-public-premium"\n<link rel="stylesheet"'),'unexpected HTML injection');
console.log('R46.96 PASS: public SHA-256, contrast, 4 render states, 3 public pages and unchanged checkout/navigation contracts');
