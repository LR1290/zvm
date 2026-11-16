'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeAdminIdentifier, checkAdminLoginCredentials } = require('../src/admin-login-credentials');

const user = 'Admin.ZVM@Example.Invalid';
const password = 'Senha exata + com espaços!';
const salt = crypto.randomBytes(16);
const expectedHash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
const check = (inputUser, inputPass, extras = {}) => checkAdminLoginCredentials({
  user: inputUser, pass: inputPass, expectedUser: user, expectedHash, salt, ...extras,
});

test('admin accepts exact username and password', () => {
  assert.equal(check(user, password).accepted, true);
});
test('admin username is case-insensitive and trims mobile keyboard whitespace', () => {
  const result = check('  ADMIN.ZVM@EXAMPLE.INVALID  ', password);
  assert.equal(result.accepted, true);
  assert.equal(result.userMatches, true);
  assert.equal(result.passMatches, true);
});
test('admin username supports NFC-equivalent Unicode', () => {
  assert.equal(normalizeAdminIdentifier('  JOSE\u0301  '), normalizeAdminIdentifier('josé'));
});
test('admin password must match byte-for-byte (case, spaces and symbols)', () => {
  for (const attempt of [password.toLowerCase(), password.trim(), password+' ', 'not-password']) {
    assert.equal(check(user, attempt).accepted, false);
  }
});
test('incorrect username never authenticates even with correct password', () => {
  const result = check('other', password);
  assert.equal(result.accepted, false);
  assert.equal(result.userMatches, false);
  assert.equal(result.passMatches, true);
});
test('empty username and absent password cannot authenticate', () => {
  assert.equal(check('', password).accepted, false);
  assert.equal(check(user, null).accepted, false);
  assert.equal(check(' ', password).accepted, false);
});
test('hash derivation errors fail closed', () => {
  const result = check(user, password, { expectedHash: null });
  assert.equal(result.accepted, false);
  assert.equal(result.passMatches, false);
});
test('admin login UI and backend use the same credential contract and no raw username log', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /checkAdminLoginCredentials\(\{/);
  assert.match(source, /autocapitalize="none" autocorrect="off" spellcheck="false"/);
  assert.match(source, /form\.getAll\('user'\)\.length === 1/);
  assert.match(source, /form\.getAll\('pass'\)\.length === 1/);
  assert.match(source, /\[ADMIN-AUTH\] rejected request=/);
  assert(!source.includes(" · user=\""), 'Never persist the raw admin username in alerts');
  assert.match(source, /const totpOk = verifyTOTP\(TOTP_SECRET/);
  assert.match(source, /if \(credOk && totpOk\)/);
});
