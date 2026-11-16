'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.join(__dirname, '..');
const canonical = require('../src/web/public/landing/owner');
const template = fs.readFileSync(path.join(root,'src/web/public/landing/owner-template.html'),'utf8');
const logoInHome = template.match(/<a href="\/" aria-label="ZVM Automações"><img src="(data:image\/png;base64,[A-Za-z0-9+/=]+)"/);
assert(logoInHome, 'sale homepage canonical artwork');
assert.equal(canonical.OWNER_TOP_BRAND_SRC,logoInHome[1], 'same exact top image, not an imitation');
assert(canonical.OWNER_TOP_BRAND_SRC.length>20000, 'real branded artwork');
const css = fs.readFileSync(path.join(root,'assets/zvm-owner-site.42d17a62234b.css'),'utf8');
for (const part of ['.owner-panel-brand-img','.owner-nav-install','.owner-panel-rail-brand',
  '.znav-links.is-open','max-width:1150px','max-width:480px','prefers-reduced-motion']) {
  assert(css.includes(part), 'style contract missing '+part);
}
const s = fs.readFileSync(path.join(root,'server.js'),'utf8');
assert(s.includes("renderOwnerSalesLanding, OWNER_TOP_BRAND_SRC"), 'reuse logo from sale');
assert(s.includes("renderCanonicalOwnerBrand()"), 'single render for brand');
assert(s.includes('class="owner-nav-install"'), 'same install CTA in shared header');
assert(s.includes('class="client-rail-logo owner-panel-rail-brand"'), 'client rail brand');
assert(s.includes("if (await serveZVMCloud(req, res, p)) return;"), 'Cloud unmodified');
assert(s.includes("salesPaused: ZVM_SALES_PAUSED"), 'checkout gate still on server');
const installed = '/assets/zvm-owner-site.42d17a62234b.css';
assert(s.includes(installed), 'new visual asset must be registered');
assert(!s.includes('zvm-owner-site.ddd1b37eb938.css'),'old visual CSS references not removed');
assert(!fs.existsSync(path.join(root,'assets/zvm-owner-site.ddd1b37eb938.css')), 'old CSS still present');

process.env.RENDER='true';process.env.NODE_ENV='test';
process.env.MONGODB_URI='mongodb://127.0.0.1:1/test';
process.env.ADMIN_USER='fixture-admin';process.env.ADMIN_PASS='fixture-password';
process.env.ANALYTICS_PASS='fixture-analytics';
process.env.APP_SECRET='fixture-long-app-secret-123456789-123456789-123456789';
const original=Module._load;
let api;
try {
  Module._load=function(id,...args) {
    if(id==='mongodb')return {MongoClient:class OfflineMongo{}};
    return original.call(this,id,...args);
  };
  api=require('../server.js').__test;
} finally {Module._load=original;}
const nav=api._sharedNav({activePath:'/faq',portalUser:null});
assert(nav.includes('class="znav-brand owner-panel-brand"'), 'shared header landmark');
assert(nav.includes(canonical.OWNER_TOP_BRAND_SRC), 'exact same image as homepage');
assert(nav.includes('class="owner-nav-install"'), 'install button present');
assert(nav.includes('class="nav-menu-toggle"'), 'mobile menu toggle');
assert(nav.includes('id="zvm-nav-links"'), 'mobile menu container');
assert(nav.includes('href="/cliente"'), 'login link preserved');
assert(nav.includes('href="/cliente/registro"'), 'registration link preserved');
assert(nav.includes('href="/planos"'), 'pricing link preserved');
assert(nav.includes('href="/privacidade"'), 'legal link preserved');
assert(nav.includes('aria-current="page"'), 'active navigation semantics');
const withUser=api._sharedNav({activePath:'/planos',portalUser:{name:'Cliente',email:'c@example.test'}});
assert(withUser.includes(canonical.OWNER_TOP_BRAND_SRC));
assert(withUser.includes('class="nav-account"'));
assert(!withUser.includes('href="/cliente/registro"'), 'avoid duplicate register for logged-in clients');

for(const [label,render] of [
  ['FAQ',()=>api.renderStandaloneFaqPage()],
  ['plans',()=>api.renderPlanosPage(null)],
  ['privacy',()=>api.renderStandalonePrivacyPage()],
  ['terms',()=>api.renderStandaloneTermsPage(null,'pt-BR')]
]) {
  const html=render();
  assert(html.includes(canonical.OWNER_TOP_BRAND_SRC), label+' brand parity');
  assert.equal((html.match(/class="znav-brand owner-panel-brand"/g)||[]).length,1, label+' single header');
  assert(html.includes('class="owner-nav-install"'), label+' same install CTA');
  assert(html.includes('class="nav-menu-toggle"'), label+' responsive nav remains');
}
const portal=api.renderPortalDashboard({name:'Teste',email:'teste@example.com'},null);
assert(portal.includes('class="client-rail-logo owner-panel-rail-brand"'), 'client button rail uses same mark');
assert(portal.includes(canonical.OWNER_TOP_BRAND_SRC), 'client branding matches top');
assert(portal.includes('href="/cliente/senha"'), 'password feature intact');
assert(portal.includes('href="/cliente/email"'), 'email feature intact');
assert(portal.includes('href="/cliente/2fa/setup"'), 'MFA feature intact');

console.log('ZVM canonical top header and buttons: branded parity, mobile, client and legal contracts passed');
