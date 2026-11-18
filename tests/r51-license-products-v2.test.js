'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {
  PRODUCT_AUTOMACOES, PRODUCT_LITE, selectAdminProduct,
  generateLicenseKey, productOfKeyRecord, keyBelongsTo
} = require('../src/license-product-v2');

test('the administrator must select a known product, except for legacy callers', () => {
  assert.equal(selectAdminProduct(PRODUCT_AUTOMACOES), PRODUCT_AUTOMACOES);
  assert.equal(selectAdminProduct(PRODUCT_LITE), PRODUCT_LITE);
  assert.equal(selectAdminProduct(undefined), null);
  assert.equal(selectAdminProduct(undefined, {legacyRequest:true}), PRODUCT_AUTOMACOES);
  for (const forged of ['', 'ZVM_LITE', '__proto__', 'zvm', null, {}, ['zvm_lite'], true]) {
    assert.equal(selectAdminProduct(forged), null);
  }
});

test('v2 keys contain 256 unpredictable bits encoded in exactly 52 base32 characters', () => {
  let requested = 0;
  const fake = n => { requested = n; return Buffer.alloc(n, 0xab); };
  const full = generateLicenseKey(PRODUCT_AUTOMACOES, fake);
  assert.equal(requested, 32);
  assert.match(full, /^zv2a-[a-z2-7]{52}$/);
  assert.equal(full.length, 57);
  const lite = generateLicenseKey(PRODUCT_LITE, fake);
  assert.match(lite, /^zv2l-[a-z2-7]{52}$/);
  assert.equal(full.slice(5), lite.slice(5)); // prefix is display-only; underlying entropy identical
  assert.throws(() => generateLicenseKey('not-a-product'));
  assert.throws(() => generateLicenseKey(PRODUCT_LITE, () => Buffer.alloc(8)));
  assert.throws(() => generateLicenseKey(PRODUCT_LITE, () => 'weak'));
});

test('random key generation has no repeats in 2500 independent samples', () => {
  const set = new Set();
  for (let i = 0; i < 2500; i++) set.add(generateLicenseKey(PRODUCT_AUTOMACOES));
  assert.equal(set.size, 2500);
});

test('legacy keys with no explicit product stay with ZVM Automações', () => {
  assert.equal(productOfKeyRecord({ active:true }, 'zv-abcde-abcde-abcde'), PRODUCT_AUTOMACOES);
  assert.equal(keyBelongsTo({ active:true }, 'zv-abcde-abcde-abcde', PRODUCT_LITE), false);
  assert.equal(keyBelongsTo({ active:true }, 'zv-abcde-abcde-abcde', PRODUCT_AUTOMACOES), true);
});

test('new keys require exact server-side metadata, never a client-supplied product', () => {
  const fullKey = generateLicenseKey(PRODUCT_AUTOMACOES);
  const liteKey = generateLicenseKey(PRODUCT_LITE);
  const fullRec = { active:true, extensionProductId:PRODUCT_AUTOMACOES };
  const liteRec = { active:true, extensionProductId:PRODUCT_LITE };
  assert.equal(keyBelongsTo(fullRec, fullKey, PRODUCT_AUTOMACOES), true);
  assert.equal(keyBelongsTo(liteRec, liteKey, PRODUCT_LITE), true);
  assert.equal(keyBelongsTo(liteRec, liteKey, PRODUCT_AUTOMACOES), false);
  assert.equal(keyBelongsTo(fullRec, fullKey, PRODUCT_LITE), false);
  assert.equal(productOfKeyRecord(liteRec, fullKey), null);
  assert.equal(productOfKeyRecord(fullRec, liteKey), null);
  assert.equal(productOfKeyRecord({ active:true }, fullKey), null);
  assert.equal(productOfKeyRecord({ active:true }, liteKey), null);
  assert.equal(productOfKeyRecord({ extensionProductId:'unknown' }, fullKey), null);
  assert.equal(productOfKeyRecord({extensionProductId:null}, 'zv-abcde-abcde-abcde'), null);
  assert.equal(productOfKeyRecord({extensionProductId:undefined}, 'zv-abcde-abcde-abcde'), null);
  assert.equal(productOfKeyRecord({ extensionProductId:PRODUCT_LITE }, liteKey.slice(0,-1)+'0'), null);
  assert.equal(productOfKeyRecord(null, liteKey), null);
  assert.equal(productOfKeyRecord([], liteKey), null);
});

test('server has product admission before phone slots and covers key, account, refresh and V3', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const keyAuth = server.match(/async function authorizeExtensionKeySession\([\s\S]*?(?=\nasync function refreshExtensionSession)/)?.[0] || '';
  assert.match(keyAuth, /keyBelongsTo\(keyRecord, keyCode, PRODUCT_AUTOMACOES\)/);
  assert.ok(keyAuth.indexOf('keyBelongsTo(') < keyAuth.indexOf('claimPhoneSlot'), 'product must be checked BEFORE allocating a phone slot');
  const account = server.match(/async function resolveExtensionAccountEntitlement\([\s\S]*?(?=\nasync function authenticateExtensionAccount)/)?.[0] || '';
  assert.match(account, /license_product_mismatch/);
  const refresh = server.match(/async function refreshExtensionSession\([\s\S]*?(?=\n\/\/ Reset tokens)/)?.[0] || '';
  assert.match(refresh, /keyBelongsTo\(keyRecord, doc\.licenseKeyCode, PRODUCT_AUTOMACOES\)/);
  assert.match(refresh, /revokeExtensionSession/);
  assert.match(server, /reason: 'product_mismatch'/);
  assert.match(server, /active: false, reason: 'product_mismatch'/);
  assert.match(server, /lite_build_authority_required/);
  assert.match(server, /cakto_extension_product_conflict/);
  assert.match(server, /cakto_portal_product_conflict/);
});

test('admin UI exposes mandatory product selection, product filter and honest pending status', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /id="nproduct" required/);
  assert.match(server, /value="zvm_automacoes"/);
  assert.match(server, /value="zvm_lite"/);
  assert.match(server, /id="filter-product"/);
  assert.match(server, /active: extensionProductId === PRODUCT_AUTOMACOES/);
  assert.match(server, /extensionProductId,/);
  assert.match(server, /activationPending: extensionProductId === PRODUCT_LITE/);
  assert.match(server, /async function insertNewAdminKeyStrict/);
  const insertion = server.match(/async function insertNewAdminKeyStrict[\s\S]*?(?=\n\/\/ No painel Admin)/)?.[0] || '';
  assert.match(insertion, /\$exists: false/);
  assert.match(insertion, /upsert: false/);
  assert.doesNotMatch(insertion, /upsert: true/);
  assert.match(server, /await insertNewAdminKeyStrict\(code, createdKey\)/);
  const clientFile = 'zvm-admin-dashboard.2757c76a8405.js';
  const client = fs.readFileSync(path.join(__dirname, '..', 'assets', clientFile), 'utf8');
  assert.match(client, /productId=\(get\('nproduct'\)/);
  assert.match(client, /const baseBody=\{maxUses,productId\}/);
  assert.match(client, /'zvm_lite'/);
  assert.match(client, /INATIVA/);
  const hash = crypto.createHash('sha256').update(client).digest('hex');
  assert.equal(hash, '2757c76a8405a16c1a610f9872146f950d82ec66bd98049dd57bbf77e52f010a');
  assert.ok(server.includes("'/assets/"+clientFile+"':"));
});

test('actual V4 key authorization refuses LITE before claiming any phone slot', async () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const code = server.match(/async function authorizeExtensionKeySession[\s\S]*?(?=\nasync function refreshExtensionSession)/)?.[0];
  assert.ok(code, 'real V4 authorization function must be extractable');
  const context = {
    sanitizeId: (value, length) => String(value || '').toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,length),
    normalizePhone: value => String(value || '').replace(/\D/g,''),
    safeScalar: (value,length) => String(value || '').slice(0,length),
    isFreeAuthKey: () => false,
    extensionAuthFailure: (errorCode,status,extra={}) => ({ok:false,errorCode,status,...extra}),
    extensionLicenseIsUsable: () => true,
    keyBelongsTo,
    PRODUCT_AUTOMACOES,
    MAX_USES: 3,
    MAX_PHONES_GLOBAL: 100,
    keys: {},
    extensionNow: () => new Date(),
    extensionSubject: (type,id) => ({type,id}),
    buildExtensionEntitlement: ({keyCode}) => ({ entitlementRevision:'test-only', keyCode }),
    extensionDevAccessAllowed: () => false,
  };
  const authorize = vm.runInNewContext('('+code+')', context);
  let claimed = 0;
  const common = {
    ensureKeyLoadedEx: async () => ({ found: true, dbError: false }),
    claimPhoneSlot: async () => { claimed++; return {status:'claimed'}; },
  };
  const lite = generateLicenseKey(PRODUCT_LITE);
  const liteResult = await authorize({authKey:lite, phoneNumber:'5538999999999', deviceId:'test-device'},
    {...common, keyStore: { [lite]:{active:true,extensionProductId:PRODUCT_LITE,phones:[],maxUses:3} }});
  assert.equal(liteResult.ok,false);
  assert.equal(liteResult.errorCode,'license_product_mismatch');
  assert.equal(liteResult.status,403);
  assert.equal(claimed,0,'a LITE license must never claim a full-product phone slot');

  const fullKey = generateLicenseKey(PRODUCT_AUTOMACOES);
  const fullResult = await authorize({authKey:fullKey, phoneNumber:'5538999999999', deviceId:'test-device'},
    {...common, keyStore: { [fullKey]:{active:true,extensionProductId:PRODUCT_AUTOMACOES,phones:[],maxUses:3} }});
  assert.equal(fullResult.ok,true);
  assert.equal(claimed,1,'a valid full license must reach the expected slot code');
});
