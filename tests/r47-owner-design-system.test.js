'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const server = read('server.js');
const owner = read('src/web/public/landing/owner-template.html');
const themePath = 'assets/zvm-owner-site.42d17a62234b.css';
const theme = read(themePath);
const ownerCssPath = 'assets/zvm-sales-owner.76ccce3f6669.css';
const ownerCss = read(ownerCssPath);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

assert.equal(hash(theme), '42d17a62234b677c088e216baa0565ec3edc192f3345ac74661034405b1e2da8');
assert.equal(hash(ownerCss), '76ccce3f666924644952fd3cce80e6bf881768526e360bdb76798a1da10eac5d');
for (const [file, digest] of [
  [themePath, hash(theme)],
  [ownerCssPath, hash(ownerCss)]
]) {
  assert(server.includes("'/"+file+"': Object.freeze({"), file+' not pinned');
  assert(server.includes("sha256: '"+digest+"'"), file+' digest missing');
}
assert(!fs.existsSync(path.join(root, 'assets/zvm-sales-owner.6a148f96da38.css')),
  'orphaned superseded owner stylesheet');
assert(owner.includes('/'+ownerCssPath));
assert(!owner.includes('6a148f96da38.css'));
assert(owner.includes('class="owner-mobile-menu"'));
assert(owner.includes('class="owner-skip-link"'));
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
assert(ownerCss.includes('owner-mobile-menu[open]'));
assert(ownerCss.includes('max-width:390px'));
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
assert(server.includes('/assets/zvm-owner-site.42d17a62234b.css'), 'latest stylesheet');
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
