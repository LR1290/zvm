'use strict';
// Product authority is the Mongo key record, NOT the browser's request body.
// Payment-provider product IDs are deliberately not interpreted here.
const crypto = require('crypto');
const PRODUCT_AUTOMACOES = 'zvm_automacoes';
const PRODUCT_LITE = 'zvm_lite';
const PRODUCTS = Object.freeze([PRODUCT_AUTOMACOES, PRODUCT_LITE]);
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

function selectAdminProduct(value, { legacyRequest = false } = {}) {
  if ((value === undefined || value === null) && legacyRequest) return PRODUCT_AUTOMACOES;
  return PRODUCTS.includes(value) ? value : null;
}

function encodeBase32(bytes) {
  let out = '';
  let bits = 0;
  let accumulator = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32[(accumulator >>> bits) & 31];
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits > 0) out += BASE32[(accumulator << (5 - bits)) & 31];
  return out;
}

// 32 CSPRNG bytes = 256 bits. Prefix is an aid to operators, not authentication.
function generateLicenseKey(productId, randomBytes = crypto.randomBytes) {
  if (!PRODUCTS.includes(productId)) throw new TypeError('invalid_extension_product');
  const bytes = randomBytes(32);
  if (!Buffer.isBuffer(bytes) || bytes.length !== 32) throw new TypeError('invalid_random_source');
  const prefix = productId === PRODUCT_LITE ? 'zv2l-' : 'zv2a-';
  const code = prefix + encodeBase32(bytes);
  if (!/^zv2[al]-[a-z2-7]{52}$/.test(code) || code.length > 64) throw new Error('license_encoding_failed');
  return code;
}

// Legacy keys without an explicit field belong only to the original product.
// New v2 keys require a matching persisted product field; fail closed otherwise.
// An unrecognised field never silently downgrades to the original product.
function productOfKeyRecord(keyRecord, keyCode) {
  if (!keyRecord || typeof keyRecord !== 'object' || Array.isArray(keyRecord)) return null;
  const code = String(keyCode || '').toLowerCase();
  const explicit = keyRecord.extensionProductId;
  // Null/undefined explicitly persisted are malformed; only ABSENT means legacy.
  const hasProduct = Object.prototype.hasOwnProperty.call(keyRecord, 'extensionProductId');
  const productId = hasProduct ? explicit : PRODUCT_AUTOMACOES;
  if (!PRODUCTS.includes(productId)) return null;
  // A record labelled LITE can never wrap a legacy/full-edition key.
  // Product identity comes from BOTH the persisted product and V2L syntax.
  if (productId === PRODUCT_LITE) {
    return hasProduct && /^zv2l-[a-z2-7]{52}$/.test(code) ? PRODUCT_LITE : null;
  }
  if (/^zv2[al]-/.test(code)) {
    if (!hasProduct) return null;
    if (code.startsWith('zv2a-') && productId !== PRODUCT_AUTOMACOES) return null;
    if (code.startsWith('zv2l-') && productId !== PRODUCT_LITE) return null;
    if (!/^zv2[al]-[a-z2-7]{52}$/.test(code)) return null;
  }
  return productId;
}

function keyBelongsTo(keyRecord, keyCode, expectedProduct) {
  return PRODUCTS.includes(expectedProduct) && productOfKeyRecord(keyRecord, keyCode) === expectedProduct;
}
// A LITE seat ceiling has one explicit unlimited sentinel (-1); zero is NEVER unlimited.
// Parse the complete admin input, not parseInt('3abc') / parseInt('1.5').
// The effective ceiling cannot exceed the server's global device cap.
function parseLiteMaxUses(value, defaultUses, globalLimit) {
  if (!Number.isSafeInteger(defaultUses) || defaultUses < 1 ||
      !Number.isSafeInteger(globalLimit) || globalLimit < 1) return null;
  const raw = value === undefined ? String(Math.min(defaultUses,globalLimit)) :
    (typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '');
  if (!/^(?:-1|[1-9]\d*)$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) && (number === -1 || number <= globalLimit) ? number : null;
}

module.exports = { PRODUCT_AUTOMACOES, PRODUCT_LITE, PRODUCTS, selectAdminProduct, generateLicenseKey, productOfKeyRecord, keyBelongsTo, parseLiteMaxUses };
