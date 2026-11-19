'use strict';
// R78 — offline Admin contract. No production calls, writes or messages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const cssName = 'zvm-admin-operations.d84043f003e4.css';
const cssBytes = fs.readFileSync(path.join(root, 'assets', cssName));
const digest = crypto.createHash('sha256').update(cssBytes).digest('hex');
assert.equal(digest, 'd84043f003e4982440cf28dd8fcb0b5105d6949e2de4855afbe4f6e5008479aa');
assert(source.includes("sha256: '" + digest + "'"), 'registered asset sha256');
assert(source.includes('<link rel="stylesheet" href="/assets/' + cssName + '">'), 'CSS loaded by Admin');
const scriptName = (source.match(/<script src="\/assets\/(zvm-admin-dashboard\.[a-f0-9]{12}\.js)" defer><\/script>/) || [])[1];
assert(scriptName, 'active admin JS pinned');
const script = fs.readFileSync(path.join(root, 'assets', scriptName), 'utf8');
new vm.Script(script, { filename: scriptName });
assert(script.includes('switchTab(t)') && script.includes("p.dataset.panel===t"), 'tab isolation behavior');
process.env.RENDER = 'true';
process.env.ADMIN_USER = 'qa-admin';
process.env.ADMIN_PASS = 'qa-password-not-live';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/qa';
const originalLoad = Module._load;
let api;
try {
  Module._load = function(id, ...args) {
    if (id === 'mongodb') return { MongoClient: class OfflineMongo {} };
    return originalLoad.call(this, id, ...args);
  };
  api = require(path.join(root, 'server.js')).__test;
} finally { Module._load = originalLoad; }
assert.equal(typeof api.renderAdminDashboard, 'function');
const snapshot = {
  'zv-qa-key': { label:'Fictício', active:true, phones:[], maxUses:3,
    createdAt:'2026-11-01T00:00:00.000Z', expiresAt:null, expireDuration:null },
};
const html = api.renderAdminDashboard({ keysSnapshot:snapshot, portalUsers:[], portalUserCount:0 });
const keysStart = html.indexOf('<div class="sec-panel active" data-panel="keys">');
const logsStart = html.indexOf('<!-- ── PAINEL LOGS ── -->');
assert(keysStart > 0 && logsStart > keysStart);
const keysHtml = html.slice(keysStart, logsStart);
const otherHtml = html.slice(logsStart);
for (const id of ['admin-overview-title','urgent-alert','s-total','s-active','s-expired',
  's-deferred','s-blocked','s-warn','s-suspect','s-logs','admin-key-guide',
  'nproduct','filter-product','admin-generate-key-btn']) {
  assert(keysHtml.includes('id="' + id + '"'), id + ' stays in Keys');
  assert(!otherHtml.includes('id="' + id + '"'), id + ' must not leak to other panels');
}
for (const name of ['logs','audit','users','security']) {
  assert(html.includes('data-panel="' + name + '"'), name + ' remains available');
}
assert.equal((html.match(/data-panel="keys"/g) || []).length, 1, 'one Keys panel');
assert(keysHtml.includes('value="zvm_automacoes"'));
assert(keysHtml.includes('value="zvm_lite"'));
assert(keysHtml.includes('Pensamento do dia'));
assert(keysHtml.includes('hero-admin-active'));
assert(!otherHtml.includes('class="stats"') && !otherHtml.includes('admin-overview-compact'));
assert(script.includes('hero-admin-active') && script.includes('hero-admin-expired'), 'live stats sync');
const lic = require(path.join(root, 'src/license-product-v2.js'));
const full = lic.generateLicenseKey(lic.PRODUCT_AUTOMACOES, () => Buffer.alloc(32, 1));
const lite = lic.generateLicenseKey(lic.PRODUCT_LITE, () => Buffer.alloc(32, 1));
assert.match(full, /^zv2a-/);
assert.match(lite, /^zv2l-/);
assert.equal(lic.keyBelongsTo({extensionProductId:lic.PRODUCT_LITE},lite,lic.PRODUCT_LITE), true);
assert.equal(lic.keyBelongsTo({extensionProductId:lic.PRODUCT_LITE},lite,lic.PRODUCT_AUTOMACOES), false);
assert.equal(lic.keyBelongsTo({extensionProductId:lic.PRODUCT_AUTOMACOES},full,lic.PRODUCT_LITE), false);
assert.equal(lic.selectAdminProduct('',{}),null);
assert.equal(lic.selectAdminProduct(undefined,{legacyRequest:true}),lic.PRODUCT_AUTOMACOES);
assert(source.includes('active: extensionProductId === PRODUCT_AUTOMACOES'), 'LITE not auto-activated');
console.log('R78 PASS: scoped admin panels, multiproduct authority, pinned assets, no network writes');
