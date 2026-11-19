'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  PRODUCT_AUTOMACOES, PRODUCT_LITE, generateLicenseKey, keyBelongsTo,
} = require('../src/license-product-v2');
const {
  normalizePortalLicenseKey, portalLicenseSlot, linkedPortalKeyForProduct,
  portalLicenseConflictQuery,
} = require('../src/portal-license-slots');

const {liteKeyUsable}=require('../src/lite-license-authority');
const full = generateLicenseKey(PRODUCT_AUTOMACOES);
const lite = generateLicenseKey(PRODUCT_LITE);
const legacy = 'zv-abcde-abcde-abcde';
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('57-character V2 keys remain intact; invalid and oversized input fails closed', () => {
  assert.equal(full.length, 57);
  assert.equal(lite.length, 57);
  assert.equal(normalizePortalLicenseKey('  ' + lite.toUpperCase() + '  '), lite);
  assert.equal(normalizePortalLicenseKey(full), full);
  assert.equal(normalizePortalLicenseKey(legacy), legacy);
  assert.equal(normalizePortalLicenseKey(lite + 'trailer'), '');
  assert.equal(normalizePortalLicenseKey(lite + '!'), '');
  assert.equal(normalizePortalLicenseKey(lite.slice(0, -1)), '');
  assert.equal(normalizePortalLicenseKey('zv2l-' + '0'.repeat(52)), '');
  assert.equal(normalizePortalLicenseKey('zv2l-' + 'a'.repeat(53)), '');
  assert.equal(normalizePortalLicenseKey(null), '');
  assert.equal(normalizePortalLicenseKey({toString:()=>lite}), '');
});

test('only LITE V2 key records may occupy the independent LITE slot', () => {
  const fullRec = {extensionProductId:PRODUCT_AUTOMACOES};
  const liteRec = {extensionProductId:PRODUCT_LITE};
  assert.equal(portalLicenseSlot(fullRec, full), 'keyCode');
  assert.equal(portalLicenseSlot(liteRec, lite), 'liteKeyCode');
  assert.equal(portalLicenseSlot({}, legacy), 'keyCode');
  assert.equal(portalLicenseSlot(fullRec, lite), null);
  assert.equal(portalLicenseSlot(liteRec, full), null);
  assert.equal(portalLicenseSlot(liteRec, legacy), null);
  assert.equal(portalLicenseSlot(null, lite), null);
  assert.equal(keyBelongsTo(liteRec, lite, PRODUCT_AUTOMACOES), false);
});

test('portal account can independently own one license of each product', () => {
  const user = {keyCode:full,liteKeyCode:lite};
  assert.equal(linkedPortalKeyForProduct(user, PRODUCT_AUTOMACOES), full);
  assert.equal(linkedPortalKeyForProduct(user, PRODUCT_LITE), lite);
  assert.equal(linkedPortalKeyForProduct(user, 'unrecognized'), '');
  assert.equal(linkedPortalKeyForProduct({keyCode:full}, PRODUCT_LITE), '');
  assert.equal(linkedPortalKeyForProduct({liteKeyCode:lite}, PRODUCT_AUTOMACOES), '');
  const q=portalLicenseConflictQuery(lite,'client@example.com');
  assert.deepEqual(q, {
    _id:{$ne:'client@example.com'},
    $or:[{keyCode:lite},{liteKeyCode:lite}]
  });
  assert.throws(()=>portalLicenseConflictQuery('not a key'),/invalid_portal_license_key/);
});

test('real account entitlement reads the product-specific portal field', async () => {
  const source = server.match(/async function resolveExtensionAccountEntitlement\([\s\S]*?(?=\nasync function authenticateExtensionAccount)/)?.[0];
  assert.ok(source, 'must inspect the real account entitlement implementation');
  const keys = {
    [full]: {active:true, extensionProductId:PRODUCT_AUTOMACOES, planId:'ZV_PRO'},
    [lite]: {active:true, extensionProductId:PRODUCT_LITE, provisioningStatus:'issued', planId:'LITE_DEV', maxUses:3, phones:[], expiresAt:null}
  };
  const ctx = {
    PRODUCT_AUTOMACOES, PRODUCT_LITE, keys, linkedPortalKeyForProduct, keyBelongsTo, liteKeyUsable,
    extensionNow:()=>new Date('2026-11-18T16:00:00.000Z'),
    ensureKeyLoadedEx:async code=>({found:!!keys[code],dbError:false}),
    extensionAuthFailure:(errorCode,status)=>({ok:false,errorCode,status}),
    extensionLicenseIsUsable:rec=>Boolean(rec?.active),
    extensionDevAccessAllowed:()=>false,
    buildExtensionEntitlement:({productId,keyCode})=>({productId,keyCode}),
  };
  const run=vm.runInNewContext('('+source+')',ctx);
  const u={keyCode:full,liteKeyCode:lite};
  const fullSession=await run(u,{expectedProductId:PRODUCT_AUTOMACOES});
  const liteSession=await run(u,{expectedProductId:PRODUCT_LITE,db:{},readLiteLicenseSnapshot:async(_db,code)=>keys[code]||null});
  assert.equal(fullSession.ok,true);assert.equal(fullSession.keyCode,full);
  assert.equal(liteSession.ok,true);assert.equal(liteSession.keyCode,lite);
  assert.equal(fullSession.entitlement.productId,PRODUCT_AUTOMACOES);
  assert.equal(liteSession.entitlement.productId,PRODUCT_LITE);
  const liteMissing=await run({keyCode:full},{expectedProductId:PRODUCT_LITE});
  assert.equal(liteMissing.ok,false);
  assert.equal(liteMissing.errorCode,'lite_license_required');
  const cross=await run({liteKeyCode:full},{expectedProductId:PRODUCT_LITE,db:{},readLiteLicenseSnapshot:async(_db,code)=>keys[code]||null});
  assert.equal(cross.errorCode,'license_product_mismatch');
});

test('server registration and linking preserve independent key slots and never truncate V2', () => {
  assert.match(server, /id="reg-keycode"[^>]*maxlength="64"/);
  assert.match(server, /id="link-keycode"[^>]*maxlength="64"/);
  const reg=server.split("if (p === '/cliente/registro' && req.method === 'POST')")[1]?.split("if (p === '/cliente/logout')")[0];
  const link=server.split("if (p === '/cliente/vincular')")[1]?.split("if ((p === '/cliente/desvincular'")[0];
  assert.ok(reg && link);
  for (const part of [reg,link]) {
    assert.match(part,/normalizePortalLicenseKey\(/);
    assert.match(part,/portalLicenseSlot\(/);
    assert.match(part,/portalLicenseConflictQuery\(/);
    assert.doesNotMatch(part,/\.slice\(0,30\)/);
  }
  assert.match(reg,/liteKeyCode: keycode/);
  assert.match(link,/\$set: \{ \[portalSlot\]: keycode \}/);
  assert.match(server,/p === '\/cliente\/lite\/desvincular' \? 'liteKeyCode' : 'keyCode'/);
  assert.match(server,/linkedPortalKeyForProduct\(user, PRODUCT_LITE\)/);
  assert.match(server,/renderStandalonePortalDashboard\(user, keyData, _dashMsg, _dashDeviceMsg, liteKeyData\)/);
});
