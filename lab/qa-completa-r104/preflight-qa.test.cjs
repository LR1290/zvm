'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto=require('node:crypto');
const { checkQaEnvironment, DEV_EXTENSION_ID } = require('./preflight-qa.cjs');
const syntheticKey = crypto.generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).toString('base64');
const approved = () => ({
  ZVM_QA_SCOPE: 'zvm-completa-r104',
  ZVM_QA_PUBLIC_HOSTNAME: 'zvm-completa-qa-r104.onrender.com',
  RENDER_EXTERNAL_HOSTNAME: 'zvm-completa-qa-r104.onrender.com',
  MONGODB_DB: 'zvm_completa_qa_r103',
  ZVM_QA_ATLAS_HOST: 'qa-r104.abcd1234.mongodb.net',
  MONGODB_URI: 'mongodb+srv://zvm_completa_qa_runner:synthetic-fixture@qa-r104.abcd1234.mongodb.net/zvm_completa_qa_r103',
  ZVM_EXTENSION_IDS: DEV_EXTENSION_ID,
  ZVM_QA_VERIFY_ONLY:'1', ZVM_DEV_SIGNED_BUILDS_ALLOW:'1',
  ZVM_DEV_EXTENSION_ID: DEV_EXTENSION_ID, ZVM_DEV_SIGNING_KEY_ID:'dev-2026-01',
  ZVM_DEV_SIGNING_PUBLIC_KEY_B64:syntheticKey,
  ZVM_QA_FREE_SUBJECT: 'a'.repeat(64),
  ADMIN_USER: 'qa-admin', ADMIN_PASS: 'synthetic-pass-12345', APP_SECRET: 'x'.repeat(48),
});
const cases = [
  ['missing scope', {ZVM_QA_SCOPE:''}, 'QA_SCOPE_NOT_CONFIRMED'],
  ['production host', {ZVM_QA_PUBLIC_HOSTNAME:'zvm.onrender.com'}, 'QA_PUBLIC_HOST_NOT_EXCLUSIVE'],
  ['lite host', {ZVM_QA_PUBLIC_HOSTNAME:'zvm-lite-homolog-20261118.onrender.com'}, 'QA_PUBLIC_HOST_NOT_EXCLUSIVE'],
  ['render host does not match', {RENDER_EXTERNAL_HOSTNAME:'zvm.onrender.com'}, 'QA_RENDER_HOST_MISMATCH'],
  ['shared database', {MONGODB_DB:'zapvoice'}, 'QA_DATABASE_MISMATCH'],
  ['different Atlas hostname', {ZVM_QA_ATLAS_HOST:'cluster0.abcd1234.mongodb.net'}, 'QA_MONGODB_TARGET_INVALID'],
  ['wrong Atlas login', {MONGODB_URI:'mongodb+srv://admin:synthetic-fixture@qa-r104.abcd1234.mongodb.net/zvm_completa_qa_r103'}, 'QA_MONGODB_TARGET_INVALID'],
  ['different database in URI', {MONGODB_URI:'mongodb+srv://zvm_completa_qa_runner:synthetic-fixture@qa-r104.abcd1234.mongodb.net/watidy'}, 'QA_MONGODB_TARGET_INVALID'],
  ['URI with query parameters', {MONGODB_URI:'mongodb+srv://zvm_completa_qa_runner:synthetic-fixture@qa-r104.abcd1234.mongodb.net/zvm_completa_qa_r103?retryWrites=true'}, 'QA_MONGODB_TARGET_INVALID'],
  ['commercial extension id', {ZVM_EXTENSION_IDS:'bdhnikgcdccjabkmbfcakgjkkgdlmgja'}, 'QA_EXTENSION_ID_MISMATCH'],
  ['missing Free test subject', {ZVM_QA_FREE_SUBJECT:''}, 'QA_FREE_SUBJECT_NOT_CONFIGURED'],
  ['missing admin secret', {ADMIN_PASS:'short'}, 'QA_ADMIN_OR_APP_SECRETS_MISSING'],
  ['live payment webhook secret copied', {CAKTO_WEBHOOK_SECRET:'NOT-A-LIVE-KEY'}, 'QA_PRODUCTION_INTEGRATION_SECRET_PRESENT'],
  ['live Meta app secret copied', {META_APP_SECRET:'NOT-A-LIVE-KEY'}, 'QA_PRODUCTION_INTEGRATION_SECRET_PRESENT'],
];
test('approved dedicated QA fixture is parsed without connecting or writing', () => {
  const r = checkQaEnvironment(approved());
  assert.equal(r.backendHostname, 'zvm-completa-qa-r104.onrender.com');
  assert.equal(r.atlasProjectAndRoleVerified, false);
  assert.equal(r.buildAuthorized, false);
  assert.equal(r.writesPerformed, false);
  assert(!JSON.stringify(r).includes('synthetic-fixture'));
});
for (const [name, mutation, code] of cases) {
  test('fail-closed: '+name, () => {
    assert.throws(() => checkQaEnvironment({ ...approved(), ...mutation }), { code });
  });
}
test('when Render hostname is not provided, preflight does not claim runtime host verification', () => {
  const r=checkQaEnvironment({...approved(),RENDER_EXTERNAL_HOSTNAME:''});
  assert.equal(r.renderHostnameVerified, false);
});
