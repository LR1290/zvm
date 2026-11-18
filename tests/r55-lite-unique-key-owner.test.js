'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  PRODUCT_LITE, PRODUCT_AUTOMACOES,
  generateLicenseKey, keyBelongsTo, productOfKeyRecord,
} = require('../src/license-product-v2');
const { ensureLitePortalLicenseUniqueIndex } = require('../src/portal-license-slots');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('a forged LITE product field cannot convert a legacy or full-edition license', () => {
  const liteRecord = { extensionProductId: PRODUCT_LITE, active: true };
  const legacy = 'zv-abcde-abcde-abcde';
  const full = generateLicenseKey(PRODUCT_AUTOMACOES);
  const lite = generateLicenseKey(PRODUCT_LITE);
  for (const code of [legacy, full, 'zv2l-'+'a'.repeat(51), 'not-a-key']) {
    assert.equal(productOfKeyRecord(liteRecord, code), null);
    assert.equal(keyBelongsTo(liteRecord, code, PRODUCT_LITE), false);
  }
  assert.equal(keyBelongsTo(liteRecord, lite, PRODUCT_LITE), true);
  assert.equal(keyBelongsTo(liteRecord, lite, PRODUCT_AUTOMACOES), false);
  assert.equal(productOfKeyRecord({active:true},legacy), PRODUCT_AUTOMACOES);
});

test('MongoDB uniqueness is partial and restricted to LITE license string fields', async () => {
  let called=0;
  const db={collection(name){
    assert.equal(name,'portal_users');
    return {createIndex:async(keys,opts)=>{
      called++;
      assert.deepEqual(keys,{liteKeyCode:1});
      assert.equal(opts.unique,true);
      assert.equal(opts.name,'zvm_lite_license_owner_unique_v1');
      assert.deepEqual(opts.partialFilterExpression,{liteKeyCode:{$type:'string'}});
      return opts.name;
    }};
  }};
  const id=await ensureLitePortalLicenseUniqueIndex(db);
  assert.equal(id,'zvm_lite_license_owner_unique_v1');
  assert.equal(called,1);
});

test('LITE index installation fails closed when privileges or the index are invalid', async () => {
  await assert.rejects(ensureLitePortalLicenseUniqueIndex(null),/invalid_lite_portal_database/);
  const db={collection(){return {createIndex:async()=>{throw Object.assign(new Error('duplicate liteKeyCode detected'),{code:11000})}}}};
  await assert.rejects(ensureLitePortalLicenseUniqueIndex(db),/duplicate liteKeyCode detected/);
});

test('real portal registration and linking enforce uniqueness before a write',()=>{
  const reg=server.split("if (p === '/cliente/registro' && req.method === 'POST')")[1]?.split("if (p === '/cliente/logout')")[0];
  const link=server.split("if (p === '/cliente/vincular')")[1]?.split("if ((p === '/cliente/desvincular'")[0];
  assert.ok(reg&&link);
  assert.ok(reg.indexOf('ensureLitePortalLicenseUniqueIndex(db)')>=0);
  assert.ok(link.indexOf('ensureLitePortalLicenseUniqueIndex(db)')>=0);
  assert.ok(reg.indexOf('ensureLitePortalLicenseUniqueIndex(db)')<reg.indexOf("insertOne({ _id: email"));
  assert.ok(link.indexOf('ensureLitePortalLicenseUniqueIndex(db)')<link.indexOf("updateOne({ _id: sess.email }, { $set: { [portalSlot]: keycode } })"));
  assert.match(reg,/if \(portalSlot === 'liteKeyCode'\) await ensureLitePortalLicenseUniqueIndex\(db\)/);
  assert.match(link,/if \(portalSlot === 'liteKeyCode'\) await ensureLitePortalLicenseUniqueIndex\(db\)/);
});

test('LITE refresh cannot silently transfer a password session to a replacement license',()=>{
  const refresh=server.match(/async function refreshExtensionSession\([\s\S]*?(?=\n\/\/ Reset tokens atuais)/)?.[0];
  assert.ok(refresh);
  assert.match(refresh,/expectedProductId === PRODUCT_LITE && licenseKeyCode !== entitlementResult\.keyCode/);
  assert.match(refresh,/extensionAuthFailure\('lite_license_binding_changed',403\)/);
  const start=refresh.indexOf('if (expectedProductId === PRODUCT_LITE && licenseKeyCode !== entitlementResult.keyCode)');
  const revoke=refresh.indexOf('await revokeExtensionSession(rawToken',start);
  const replacement=refresh.indexOf('licenseKeyCode = entitlementResult.keyCode;',start);
  assert.ok(start>=0 && revoke>start && revoke<replacement);
});
