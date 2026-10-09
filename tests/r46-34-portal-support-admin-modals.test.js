'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
process.env.RENDER = 'true';
process.env.NODE_ENV = 'test';
process.env.ADMIN_USER = 'test-admin';
process.env.ADMIN_PASS = 'test-secret';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/fixture';
const origLoad = Module._load;
let api;
try {
  Module._load = function(id, ...args) {
    if (id === 'mongodb') return {MongoClient: class Dummy {}};
    return origLoad.call(this, id, ...args);
  };
  api = require('../server').__test;
} finally { Module._load = origLoad; }
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const findCss = prefix => fs.readFileSync(path.join(root, 'assets', fs.readdirSync(path.join(root,'assets')).find(s => s.startsWith(prefix) && s.endsWith('.css'))), 'utf8');
const expectedMessage = 'LR Preciso de ajuda com a ZVM - Automações';
const canonical = 'https://wa.me/5521996771552?text=' + encodeURIComponent(expectedMessage);
const portal = api.renderPortalDashboard({name:'Cliente Exemplo',email:'conta@example.test'}, null);
const plans = api.renderPortalPlans({name:'Cliente Exemplo',email:'conta@example.test'}, null);
const fixtureUser = {name:'Cliente Exemplo',email:'conta@example.test'};
const password = api.renderStandalonePortalChangePwd('', '', fixtureUser);
const emailPage = api.renderStandalonePortalChangeEmail('', '', fixtureUser);
const license = api.renderStandalonePortalLinkKey('', '', fixtureUser);
const security = api.renderStandaloneSetup2FA(fixtureUser);
for (const html of [portal, plans, password, emailPage, license, security]) {
  assert.match(html, /class="dash-topbar-name"[^>]*>Cliente<\/span>/, 'authenticated first name visible');
  assert.match(html, /class="dash-topbar-email"[^>]*>conta@example\.test<\/span>/, 'authenticated email beside name');
}
const escaped = api.renderPortalDashboard({name:'Ana',email:'safe\"<img src=x onerror=alert(1)>@example.test'}, null);
assert.doesNotMatch(escaped, /<img src=x/, 'escape user email in header');
assert.match(portal, /https:\/\/wa\.me\/5521996771552\?text=LR%20Preciso/, 'portal support uses canonical URL');
assert.match(api.renderStandaloneFaqPage(), /https:\/\/wa\.me\/5521996771552\?text=LR%20Preciso/, 'FAQ uses canonical URL');
assert.match(require('../src/web/public/footer').renderPublicFooter(), /https:\/\/wa\.me\/5521996771552\?text=LR%20Preciso/, 'public footer uses canonical URL');
assert.equal(decodeURIComponent(canonical.split('text=')[1]), expectedMessage);
assert.equal(require('../src/support-contact').SUPPORT_URL, canonical, 'single shared source of WhatsApp support URL');
assert.doesNotMatch(server,/Preciso\+de\+ajuda\+com\+o\+ZVM|LR!%20Preciso/,'no old text variants in server');
const systemCss = findCss('zvm-r46-system.');
const adminCss = findCss('zvm-admin-dashboard.');
assert.doesNotMatch(systemCss,/body>\.modal-bg/, 'shared CSS must not hijack position of admin modal');
assert.match(adminCss,/\.modal-bg\{[^}]*position:fixed/, 'admin owns fixed modal positioning');
assert.match(adminCss,/\.modal-bg\.open\{display:flex\}/, 'open modal centered as flex');
console.log('R46.34 support + identity + admin modal regression PASS');
