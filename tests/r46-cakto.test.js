'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.RENDER = 'true';
process.env.ADMIN_USER = 'test-admin';
process.env.ADMIN_PASS = 'test-password';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test';
process.env.CAKTO_WEBHOOK_SECRET = 'test-webhook-secret';

const serverPath = path.join(__dirname, '..', 'server.js');
const envPath = path.join(__dirname, '..', 'zvm.env.example');
const src = fs.readFileSync(serverPath, 'utf8');
const env = fs.readFileSync(envPath, 'utf8');
const Module = require('node:module');
// No Mongo connection is needed for this pure contract test. Restrict the test
// double to module import, then restore the real loader before assertions.
const actualLoad = Module._load;
let testSurface;
try {
  Module._load = function(moduleId, ...args) {
    if (moduleId === 'mongodb') return { MongoClient: class NoConnectionTestDouble {} };
    return actualLoad.call(this, moduleId, ...args);
  };
  testSurface = require(serverPath).__test;
} finally {
  Module._load = actualLoad;
}
const {
  ZVM_PLANS,
  normalizeCaktoPurchases,
  isCaktoPaidEntitlementEvent,
  selectCaktoCommercialPurchase,
  validateCaktoPayload,
  verifyCaktoSignature,
  validateCaktoCommercialIntegrity,
  caktoEventKey,
  processCommercialSale,
} = testSurface;

function payload(event, txId = 'order-001', extraData = {}) {
  const plan = ZVM_PLANS.padrao;
  return {
    secret: 'test-webhook-secret',
    event,
    data: {
      id: txId,
      status: 'paid',
      amount: plan.price,
      baseAmount: plan.price,
      offer_type: 'main',
      checkoutUrl: plan.checkoutUrl,
      paymentMethod: 'credit_card',
      paidAt: '2026-10-08T12:00:00.000Z',
      customer: { name: 'Cliente Teste', email: 'cliente@example.com', phone: '+5511999999999' },
      product: { id: plan.productId || '', short_id: 'padrao', name: plan.name },
      offer: { id: plan.offerId || '', name: plan.name, price: plan.price, currency: 'BRL' },
      ...extraData,
    },
  };
}

(async () => {
  assert.strictEqual(isCaktoPaidEntitlementEvent('purchase_approved'), true);
  assert.strictEqual(isCaktoPaidEntitlementEvent('subscription_renewed'), true);
  assert.strictEqual(isCaktoPaidEntitlementEvent('subscription_canceled'), false);

  for (const event of ['purchase_approved', 'subscription_renewed']) {
    const p = payload(event, `order-${event}`);
    const normalized = normalizeCaktoPurchases(p);
    assert.strictEqual(normalized.length, 1);
    const selected = selectCaktoCommercialPurchase(normalized);
    assert.strictEqual(selected.ok, true);
    assert.strictEqual(selected.purchase.event, event);
    assert.strictEqual(selected.plan.id, ZVM_PLANS.padrao.id);
    assert.deepStrictEqual(validateCaktoCommercialIntegrity(selected.purchase, selected.plan), { ok: true });
    const validated = validateCaktoPayload(p, 'test-webhook-secret');
    assert.strictEqual(validated.ok, true);
    assert.strictEqual(validated.purchase.event, event);
  }

  // V2: main + bump; only main may grant/renew entitlement.
  const main = payload('subscription_renewed', 'order-v2').data;
  const bump = JSON.parse(JSON.stringify(main));
  bump.id = 'order-v2-bump';
  bump.offer_type = 'order_bump';
  bump.offer = { id: 'other', name: 'Acessório', price: 9.9, currency: 'BRL' };
  bump.product = { id: 'other', short_id: 'other', name: 'Acessório' };
  const v2 = payload('subscription_renewed', 'ignored');
  v2.data = [main, bump];
  const selectedV2 = selectCaktoCommercialPurchase(normalizeCaktoPurchases(v2));
  assert.strictEqual(selectedV2.ok, true);
  assert.strictEqual(selectedV2.purchase.txId, 'order-v2');
  assert.strictEqual(selectedV2.ignoredItems, 1);

  // HMAC current contract: timestamp + raw body; comma-separated signatures supported.
  const sigPayload = payload('purchase_approved', 'sig-order');
  const raw = Buffer.from(JSON.stringify(sigPayload));
  const ts = '1791460800'; // 2026-10-08T12:00:00Z
  const nowMs = Number(ts) * 1000;
  const digest = crypto.createHmac('sha256', 'test-webhook-secret').update(`${ts}.`).update(raw).digest('hex');
  assert.strictEqual(verifyCaktoSignature(raw, ts, `v1=${digest}`, 'test-webhook-secret', nowMs).ok, true);
  assert.strictEqual(verifyCaktoSignature(raw, ts, `v0=${'0'.repeat(64)}, v1=${digest}`, 'test-webhook-secret', nowMs).ok, true);
  assert.strictEqual(verifyCaktoSignature(raw, ts, `v1=${digest}`, 'test-webhook-secret', nowMs + 301000).ok, false);

  // Same Cakto order identity must dedupe regardless of which paid event named it.
  assert.strictEqual(caktoEventKey('same-order'), caktoEventKey('same-order'));

  // Renewal math: active entitlement extends from current expiry, and replaying same tx is neutral.
  const keyStore = {};
  let portalKey = null;
  const commonDeps = {
    db: {},
    keyStore,
    disableCommercialLock: true,
    skipPaymentIdempotency: true,
    findPortalUser: async () => portalKey ? { keyCode: portalKey } : null,
    linkPortalUser: async (_email, keyCode) => { portalKey = keyCode; },
    persistKey: async () => {},
    savePayment: async () => {},
    sendKeyDeliveryEmail: async () => true,
  };
  const plan = ZVM_PLANS.padrao;
  const baseSale = {
    source: 'cakto', event: 'purchase_approved', txId: 'renew-order-1', refId: '',
    clientName: 'Cliente Teste', clientEmail: 'cliente@example.com', clientPhone: '',
    productName: plan.name, offerName: plan.name, amount: plan.price, paymentMethod: 'credit_card',
    paidAt: '2026-10-08T12:00:00.000Z', tracking: null,
  };
  const first = await processCommercialSale(baseSale, plan, { ...commonDeps, now: new Date('2026-10-08T12:00:00.000Z') });
  assert.strictEqual(first.renewed, false);
  assert.strictEqual(first.expiresAt, '2026-11-07T12:00:00.000Z');

  const renewalSale = { ...baseSale, event: 'subscription_renewed', txId: 'renew-order-2', paidAt: '2026-11-01T12:00:00.000Z' };
  const renewed = await processCommercialSale(renewalSale, plan, { ...commonDeps, now: new Date('2026-11-01T12:00:00.000Z') });
  assert.strictEqual(renewed.keyCode, first.keyCode);
  assert.strictEqual(renewed.renewed, true);
  assert.strictEqual(renewed.expiresAt, '2026-12-07T12:00:00.000Z');

  const replay = await processCommercialSale(renewalSale, plan, { ...commonDeps, now: new Date('2026-11-01T13:00:00.000Z') });
  assert.strictEqual(replay.expiresAt, '2026-12-07T12:00:00.000Z');


  // Legacy V3 must remain closed when its dedicated master switch is false,
  // even if modern build enforcement is intentionally disabled.
  const { createBuildAuthority } = require(path.join(__dirname, '..', 'build-authority.js'));
  const legacyClosed = createBuildAuthority({ buildEnforce: false, legacyV3Allow: false });
  const legacyOpen = createBuildAuthority({ buildEnforce: false, legacyV3Allow: true });
  assert.strictEqual(legacyClosed.legacyV3Allowed(), false);
  assert.strictEqual(legacyOpen.legacyV3Allowed(), true);
  assert(!fs.readFileSync(path.join(__dirname, '..', 'INICIAR_ZVM_SITE_LOCAL.bat'), 'utf8').includes('ZVM_LEGACY_V3_ALLOW=true'));

  assert(src.includes("2026-10-08-r46-16-cakto-queue-recovery"));
  assert(!src.includes('https://app.zapvoice.com.br'));
  assert(env.startsWith('# ZVM Server R46.16'));
  assert(/\nZVM_LEGACY_V3_ALLOW=false\n/.test(`\n${env}\n`));

  console.log('R46.17 Cakto paid-entitlement + renewal hardening (module-import double): PASS');
})().catch(err => { console.error(err); process.exit(1); });
