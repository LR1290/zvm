'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const server = read('server.js');
const owner = read('src/web/public/landing/owner-template.html');
const themePath = 'assets/zvm-owner-site.e10ede63c1f0.css';
const theme = read(themePath);
const ownerCssPath = 'assets/zvm-sales-owner.a610cb96b94d.css';
const ownerCss = read(ownerCssPath);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

assert.equal(hash(theme), 'e10ede63c1f0d73eaf6cae01395114196f20178e6a4c34cf1516d62978a80918');
assert.equal(hash(ownerCss), 'a610cb96b94de78e36d8cf6241b6497c319c228c2df0ae34c219a0ef5bf4e98c');
for (const [file, digest] of [
  [themePath, hash(theme)],
  [ownerCssPath, hash(ownerCss)]
]) {
  assert(server.includes("'/"+file+"': Object.freeze({"), file+' not pinned');
  assert(server.includes("sha256: '"+digest+"'"), file+' digest missing');
}
assert(!fs.existsSync(path.join(root, 'assets/zvm-sales-owner.6a148f96da38.css')),
  'orphaned superseded owner stylesheet');
assert(owner.includes('{{ZVM_OWNER_CSS}}'), 'CSS is rendered by the owner module');
assert(server.includes('zvm-sales-owner.a610cb96b94d.css'));
assert(!fs.existsSync(path.join(root, 'assets/zvm-sales-owner.76ccce3f6669.css')), 'superseded owner CSS not removed');
assert(!owner.includes('6a148f96da38.css'));
assert(owner.includes('{{ZVM_PUBLIC_NAV}}'), 'shared nav placeholder');
assert(!owner.includes('owner-mobile-menu'), 'legacy duplicate nav must be retired');
assert(owner.includes('class="zvm-public-premium zvm-owner-landing"'));
assert(server.includes('publicNavHtml: _sharedNav({activePath:'), 'navbar must come from single shared renderer');
assert(owner.includes('id="main-content"'));
assert(owner.includes('href="/cliente"'));
assert(owner.includes('href="/faq"'));
assert(owner.includes('href="/privacidade"'));
assert(owner.includes('{{ZVM_SUPPORT_URL}}'));
assert(server.includes('supportUrl: ZVM_SUPPORT_URL'));
assert(!server.includes("'/?sec=produto'"));
assert(!server.includes("'/?sec=recursos'"));
assert(server.includes("['/#recursos', 'Recursos']"));
assert(server.includes("['/#como', 'Como funciona']"));
for (const id of ['recursos','como','planos','faq']) {
  assert(owner.includes('id="'+id+'"'), 'missing target #'+id);
}
assert(!theme.includes('!important') && !ownerCss.includes('!important'),
  'new CSS must not rely on important');
for(const scope of ['zvm-public-premium','zvm-client-premium','zvm-auth-premium','zvm-admin-r6']) {
  assert(theme.includes('body.'+scope), 'missing style scope '+scope);
}
for(const surface of ['.faq-item','.price-card','.doc-section','.terms-section',
  '.client-nav','.client-key-command','.auth-form-card','.rtab','.device-remove']) {
  assert(theme.includes(surface), 'missing UI component '+surface);
}
assert(theme.includes('prefers-reduced-motion'));
assert(theme.includes('max-width:600px'));
assert(ownerCss.includes('body.zvm-owner-landing .hero'));
assert(ownerCss.includes('body.zvm-owner-landing .mock'));
assert(ownerCss.includes('body.zvm-owner-landing .owner-sale-status'));
assert(ownerCss.includes('body.zvm-owner-landing .wrap'));
assert(ownerCss.includes('body.zvm-owner-landing .znav.standalone-nav'));
assert(!ownerCss.includes('owner-mobile-menu'), 'old native nav CSS residual must be absent');
assert(ownerCss.includes('max-width:600px'));
assert(ownerCss.includes('prefers-reduced-motion'));
assert(ownerCss.includes('.cards.c4'));
assert(ownerCss.includes('.cards.c3'));
assert(ownerCss.includes('.hero .grid'));
assert(ownerCss.includes('color:#aef2ce'));
assert(!owner.includes('<header>'), 'old redundant header removed');
const helperStart = server.indexOf('const ZVM_OWNER_SITE_THEME =');
const helperEnd = server.indexOf('function sendHtml(', helperStart);
assert(helperStart > 0 && helperEnd > helperStart, 'missing theme adapter');
const helper = new Function(server.slice(helperStart, helperEnd) + '\nreturn applyOwnerSiteTheme;')();
const asset = '/'+themePath;
for(const cls of ['zvm-public-premium','zvm-client-premium','zvm-auth-premium','zvm-admin-r6']){
  const html = '<!DOCTYPE html><html><head><title>Test</title></head><body class="'+cls+'"><main>Ok</main></body></html>';
  const updated = helper(html);
  assert(updated.includes(asset));
  assert.equal(updated.split(asset).length, 2, 'theme injected once');
  assert.equal(helper(updated), updated, 'idempotent CSS injection');
}
const independent = '<!DOCTYPE html><html><head></head><body><main>ZVM Cloud</main></body></html>';
assert.equal(helper(independent), independent, 'Cloud/application not themed');
const homepage = '<!DOCTYPE html><html><head></head><body><main id="main-content">Owner home</main></body></html>';
assert.equal(helper(homepage), homepage, 'sales homepage owns its styles');
for (const [fn, next] of [
  ['sendHtml(', 'function sendAuthHtml('],
  ['sendAuthHtml(', 'function sendPublicHtml('],
  ['sendPublicHtml(', 'function escHtml(']
]) {
  const begin = server.indexOf('function '+fn);
  const end = server.indexOf(next, begin + 1);
  assert(begin >= 0 && end > begin, fn+' structure not found');
  const chunk = server.slice(begin, end);
  assert(chunk.includes('html = applyOwnerSiteTheme(html);'), fn+' lacks theme adapter');
  assert(chunk.indexOf('html = applyOwnerSiteTheme(html);') < chunk.indexOf("Buffer.from(html, 'utf8')"), fn+' adapter too late');
}
assert(server.includes('salesPaused: ZVM_SALES_PAUSED'));
assert(server.includes("renderOwnerSalesLanding, OWNER_TOP_BRAND_SRC"), 'canonical owner header asset reused');
assert(server.includes('function renderCanonicalOwnerBrand()'), 'shared top brand renderer');
assert(server.includes('class="znav-brand owner-panel-brand"'), 'public pages reuse owner header logo');
assert(server.includes('class="owner-nav-install"'), 'shared top install button');
assert(server.includes('class="client-rail-logo owner-panel-rail-brand"'), 'client rail reuses logo');
assert(server.includes('/assets/zvm-owner-site.e10ede63c1f0.css'), 'latest stylesheet');
assert(theme.includes('.owner-panel-brand-img'), 'top logo styled');
assert(theme.includes('.owner-nav-install'), 'install button styled');
assert(theme.includes('.znav-links.is-open'), 'mobile nav remains working');
assert(theme.includes('.owner-panel-rail-brand'), 'client rail logo styled');
assert(theme.includes('max-width:1150px'), 'menu access at laptop widths');
assert(!fs.existsSync(path.join(root, 'assets/zvm-owner-site.ddd1b37eb938.css')),
  'superseded shared stylesheet must be retired');
assert(server.includes("if (p === '/cliente' || p === '/cliente/')"));
assert(server.includes('if (await serveZVMCloud(req, res, p)) return;'), 'Cloud mount must remain active');
console.log('ZVM owner visual system: SHA-256, CSS, portal, auth, legal, admin, menu and Cloud isolation passed.');
