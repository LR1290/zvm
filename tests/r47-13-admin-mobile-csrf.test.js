'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createAdminLoginCsrf, verifyAdminLoginCsrf, canUseAdminLoginCsrfFallback } = require('../src/admin-login-csrf');
const ADMIN = '/1234567890abcd';
const req = (headers = {}) => ({ headers });
const issue = () => {
  const hdr = {};
  const res = { setHeader: (k, v) => { hdr[k] = v; } };
  const token = createAdminLoginCsrf(res, ADMIN);
  const cookie = hdr['Set-Cookie'].split(';')[0];
  return { token, cookie, setCookie: hdr['Set-Cookie'] };
};

test('issues 256-bit unpredictable token and scoped secure cookie', () => {
  const a=issue(),b=issue();
  assert.match(a.token, /^[a-f0-9]{64}$/);
  assert.notEqual(a.token,b.token);
  assert.match(a.setCookie, /; Path=\/1234567890abcd;/);
  assert.match(a.setCookie, /; Max-Age=900; HttpOnly; Secure; SameSite=Strict$/);
});
test('mobile privacy mode without metadata: matching cookie and form token accepted', () => {
  const {token,cookie}=issue();
  assert.equal(verifyAdminLoginCsrf(req({cookie}),token),true);
  assert.equal(verifyAdminLoginCsrf(req({cookie,'sec-fetch-site':'none'}),token),true);
  assert.equal(verifyAdminLoginCsrf(req({cookie,'sec-fetch-site':'same-site'}),token),true);
  assert.equal(verifyAdminLoginCsrf(req({cookie,host:'zvm.onrender.com',origin:'https://zvm.onrender.com','sec-fetch-site':'same-site'}),token),true);
  assert.equal(verifyAdminLoginCsrf(req({cookie,host:'zvm.onrender.com',referer:'https://zvm.onrender.com/abc','sec-fetch-site':'same-site'}),token),true);
  assert.equal(verifyAdminLoginCsrf(req({cookie,origin:'null'}),token),true);
});
test('CSRF fallback refuses absent, malformed, replayed without matching cookie or duplicated token', () => {
  const {token,cookie}=issue();
  const other=issue();
  for(const form of ['', 'xyz',other.token,token.toUpperCase()])assert.equal(verifyAdminLoginCsrf(req({cookie}),form),false);
  assert.equal(verifyAdminLoginCsrf(req({}),token),false);
  assert.equal(verifyAdminLoginCsrf(req({cookie:cookie+'; '+cookie}),token),false);
  assert.equal(verifyAdminLoginCsrf(req({cookie:other.cookie}),token),false);
});
test('CSRF fallback cannot override cross-site, malicious Origin or Referer', () => {
  const {token,cookie}=issue();
  for(const headers of [
    {cookie,'sec-fetch-site':'cross-site'},
    {cookie,origin:'https://attacker.example'},
    {cookie,referer:'https://attacker.example/fake'},
    {cookie,'sec-fetch-site':'navigate'},
  ]) {
    assert.equal(canUseAdminLoginCsrfFallback(req(headers)),false);
    assert.equal(verifyAdminLoginCsrf(req(headers),token),false);
  }
});
test('invalid admin route rejects token issue (cookie path injection protected)', () => {
  assert.throws(()=>createAdminLoginCsrf({setHeader(){}},'/other; SameSite=None'),/invalid_admin_login_path/);
});
test('admin login GET and all failure cases issue token; POST checks it for absent metadata', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server,/function sendAdminLogin\(res, error = '', status = 200\)/);
  assert.match(server,/createAdminLoginCsrf\(res, R_ADMIN\)/);
  assert.match(server,/name="admin_login_csrf"/);
  assert.match(server,/verifyAdminLoginCsrf\(req, form\.get\('admin_login_csrf'\)\)/);
  assert.match(server,/form\.getAll\('admin_login_csrf'\)\.length !== 1/);
  assert.match(server,/if \(!isAdminSession\(req\)\) \{ sendAdminLogin\(res\); return; \}/);
  assert.match(server,/sendAdminLogin\(res, msg\)/);
  assert.match(server,/sendAdminLogin\(res, 'Não foi possível validar o formulário/);
  assert.match(server,/if \(!originVerified && !canUseAdminLoginCsrfFallback\(req\)\)/);
});
