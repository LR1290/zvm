'use strict';
// Regression for login navigation: failed POST leaves /login in browser history;
// a subsequent GET (refresh, link, bookmark) must resolve to the canonical form.
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const Module = require('node:module');

process.env.RENDER = 'true';
process.env.ADMIN_USER = 'zvm-offline-test-admin';
process.env.ADMIN_PASS = 'offline-test-password-not-for-production';
process.env.ANALYTICS_PASS = 'offline-analytics-password-not-for-production';
process.env.TOTP_SECRET = '';
process.env.ANALYTICS_TOTP_SECRET = '';
process.env.APP_SECRET = 'offline-privileged-login-route-fixture-not-production';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/offline-test';

const originalLoad = Module._load;
let api;
try {
  Module._load = function(id, ...args) {
    if (id === 'mongodb') return { MongoClient: class OfflineMongoDouble {} };
    return originalLoad.call(this, id, ...args);
  };
  api = require(path.join(__dirname, '..', 'server.js')).__test;
} finally {
  Module._load = originalLoad;
}
assert.equal(typeof api.handleRequest, 'function');

const slug = (seed) => '/' + crypto.createHmac('sha256', process.env.APP_SECRET)
  .update(seed).digest('hex').slice(0, 14);
const admin = slug('admin-panel');
const analytics = slug('analytics-panel');
const service = http.createServer((req, res) => {
  Promise.resolve(api.handleRequest(req, res)).catch(error => {
    if (!res.headersSent) res.writeHead(500);
    res.end('test-handler-error:' + error.message);
  });
});

(async () => {
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + service.address().port;
  const get = (route) => fetch(base + route, { redirect: 'manual' });
  const post = (route, form) => fetch(base + route, {
    method: 'POST', redirect: 'manual',
    headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });

  const a = await get(admin + '/login');
  assert.equal(a.status, 302, 'admin GET /login redirects to canonical admin root');
  assert.equal(a.headers.get('location'), admin);
  const aRoot = await get(admin);
  assert.equal(aRoot.status, 200, 'canonical admin root remains accessible as login form');
  assert.match(await aRoot.text(), /name="user"[\s\S]*name="pass"/);

  const n = await get(analytics + '/login');
  assert.equal(n.status, 302, 'analytics GET /login redirects to canonical analytics root');
  assert.equal(n.headers.get('location'), analytics);
  const nRoot = await get(analytics);
  assert.equal(nRoot.status, 200, 'canonical analytics root remains accessible as login form');
  assert.match(await nRoot.text(), /name="pass"/);

  const denied = await get(admin + '/api/data');
  assert.equal(denied.status, 401, 'private data must remain inaccessible without a session');

  const rejected = await post(admin + '/login', { user: 'wrong', pass: 'wrong' });
  assert.equal(rejected.status, 200, 'existing invalid-password form contract remains intact');
  assert.match(await rejected.text(), /Usuário ou senha incorretos/);
  assert.equal(rejected.headers.get('set-cookie'), null, 'invalid login must never issue a session');

  const reloaded = await get(admin + '/login');
  assert.equal(reloaded.status, 302, 'refresh after rejected POST must no longer return 404');
  assert.equal(reloaded.headers.get('location'), admin);
  console.log('R46.60 privileged-login GET route and access regression PASS');
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => service.close());
