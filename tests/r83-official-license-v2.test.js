'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  PRODUCT_AUTOMACOES, PRODUCT_LITE, generateLicenseKey, productOfKeyRecord, keyBelongsTo
} = require('../src/license-product-v2');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function region(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'missing source region ' + start);
  return source.slice(a, b);
}
function check(condition, label) { assert.ok(condition, label); checks++; }
let checks = 0;
const full = generateLicenseKey(PRODUCT_AUTOMACOES);
const lite = generateLicenseKey(PRODUCT_LITE);
check(/^zv2a-[a-z2-7]{52}$/.test(full), 'official key: correct prefix/alphabet/length');
check(/^zv2l-[a-z2-7]{52}$/.test(lite), 'LITE key: independent prefix');
check(full.length === 57 && lite.length === 57, 'both V2 keys are 57 characters');
check(generateLicenseKey(PRODUCT_AUTOMACOES, () => Buffer.alloc(32)).endsWith('a'.repeat(52)), 'zero entropy vector');
check(generateLicenseKey(PRODUCT_AUTOMACOES, () => Buffer.alloc(32, 255)).endsWith('q'), 'all-ones vector');
check(new Set(Array.from({length: 128}, () => generateLicenseKey(PRODUCT_AUTOMACOES))).size === 128, '128 fresh keys are unique');
assert.throws(() => generateLicenseKey(PRODUCT_AUTOMACOES, () => Buffer.alloc(31)), /invalid_random_source/); checks++;
assert.throws(() => generateLicenseKey('unknown'), /invalid_extension_product/); checks++;
const officialV2 = { active:true, extensionProductId:PRODUCT_AUTOMACOES };
const liteV2 = { active:true, extensionProductId:PRODUCT_LITE };
check(keyBelongsTo(officialV2, full, PRODUCT_AUTOMACOES), 'V2 official requires persisted product authority');
check(!keyBelongsTo(liteV2, full, PRODUCT_AUTOMACOES), 'foreign product rejected');
check(!keyBelongsTo({active:true}, full, PRODUCT_AUTOMACOES), 'V2 official without product rejected');
check(!keyBelongsTo(officialV2, lite, PRODUCT_AUTOMACOES), 'V2 LITE never authenticates in official');
check(!keyBelongsTo(liteV2, lite, PRODUCT_AUTOMACOES), 'V2 LITE persisted record rejected in official');
check(productOfKeyRecord({active:true}, 'zv-abcde-12345-abcde')===PRODUCT_AUTOMACOES,'historical untyped key remains official');
check(!keyBelongsTo({extensionProductId:'invalid'}, 'zv-abcde-12345-abcde', PRODUCT_AUTOMACOES),'malformed product never downgraded');
const rIssue = region('function generateCode() {', 'function generateToken() {');
check(/function generateOfficialCode\(/.test(rIssue), 'gated official issuance helper');
check(/ZVM_OFFICIAL_KEYS_V2_ENABLED/.test(rIssue), 'explicit server rollout gate');
check(/generateLicenseKey\(PRODUCT_AUTOMACOES\)/.test(rIssue), 'official V2 uses shared secure generator');
const commercial = region('async function processCommercialSale(', '\n  // P0 — ordem importa pra recuperação');
check(/generateOfficialCode\(\)/.test(commercial), 'new Cakto sale uses gated generator');
check(/\.\.\.officialV2Metadata\(keyCode\)/.test(commercial), 'new commercial V2 records persist product authority');
const admin = region("if (p === R_ADMIN+'/api/keys' && req.method === 'POST')", 'const codeToggle =');
check(/generateOfficialCode\(\)/.test(admin), 'admin create uses gated generator');
check(/\.\.\.officialV2Metadata\(code\)/.test(admin), 'admin V2 record persists product authority');
check(/keyBelongsTo\(/.test(source), 'product boundary must be applied on authentication');
check(!/sanitizeId\((?:input\?|body|user\?)?\.?authKey,\s*32\)/.test(source), 'no 32-char authKey parser remains');
check(!source.includes('sanitizeId(input?.authKey, 32)'), 'V4 key auth accepts full 57 chars');
check(!source.includes('sanitizeId(body.authKey, 32)'), 'legacy key endpoints accept full 57 chars');
check(!source.includes("toLowerCase().slice(0, 32);"), 'usage no longer silently truncates license');
const register = region("if (p === '/cliente/registro'", "if (p === '/cliente/logout')");
check(/normalizeOfficialLicenseCode\(enteredKeyCode\)/.test(register), 'registration consumes exact code');
check(/Chave inválida/.test(register), 'invalid registration key rejected, not silently dropped');
const link = region("if (p === '/cliente/vincular')", "if (p === '/cliente/desvincular'");
check(/normalizeOfficialLicenseCode\(enteredKeyCode\)/.test(link), 'portal linkage uses exact code');
check(/keyBelongsTo\(keys\[keycode\],\s*keycode,\s*PRODUCT_AUTOMACOES\)/.test(link),'portal never links foreign product');
const publicKey = region("if (p === '/api/checkkey'", "if (req.method === 'GET' && p === '/')");
check(/normalizeOfficialLicenseCode\(/.test(publicKey),'public key check does not truncate');
check(/keyBelongsTo\(keys\[code\], code, PRODUCT_AUTOMACOES\)/.test(publicKey),'public key check respects product');
const clientStatus = region("if (p === '/client/status'", "if (p === '/politica'");
check(/keyBelongsTo\(/.test(clientStatus),'legacy client management rejects other products');
check(/normalizeOfficialLicenseCode\(/.test(clientStatus),'legacy client management accepts V2 shape');
check(source.includes('name="keycode" placeholder="zv-xxxxx-xxxxx-xxxxx" value="' ) && source.includes('maxlength="64"'), 'portal registration UI supports 57');

// Exercita os helpers reais extraídos do runtime, não um algoritmo replicado no teste.
const helpersSource = region('function officialV2IssuanceEnabled() {', 'function generateToken() {');
let legacyIssues = 0, v2Issues = 0;
const runtimeEnv = { env: {} };
const helpers = new Function('process','generateCode','generateLicenseKey','PRODUCT_AUTOMACOES',
  helpersSource + '\nreturn { officialV2IssuanceEnabled, generateOfficialCode, normalizeOfficialLicenseCode, officialV2Metadata };'
)(runtimeEnv,
  () => { legacyIssues++; return 'zv-abcde-12345-abcde'; },
  product => { assert.equal(product, PRODUCT_AUTOMACOES); v2Issues++; return full; },
  PRODUCT_AUTOMACOES);
check(helpers.generateOfficialCode() === 'zv-abcde-12345-abcde' && legacyIssues === 1 && v2Issues === 0,
  'without flag new keys remain legacy');
runtimeEnv.env.ZVM_OFFICIAL_KEYS_V2_ENABLED = 'false';
check(helpers.generateOfficialCode().startsWith('zv-') && v2Issues === 0, 'explicit false remains legacy');
runtimeEnv.env.ZVM_OFFICIAL_KEYS_V2_ENABLED = 'true';
check(helpers.generateOfficialCode() === full && v2Issues === 1, 'true enables full 256-bit V2');
check(helpers.normalizeOfficialLicenseCode(' ' + full.toUpperCase() + ' ') === full, 'normalize human-entered V2 safely');
check(helpers.normalizeOfficialLicenseCode(lite) === '', 'reject LITE key before any DB query');
check(helpers.normalizeOfficialLicenseCode('zv2a-' + 'a'.repeat(51)) === '', 'reject truncated V2');
check(helpers.normalizeOfficialLicenseCode(full + '-extra') === '', 'reject V2 with tail');
check(helpers.normalizeOfficialLicenseCode('zv2a-' + 'a'.repeat(51) + '
) === '', 'reject corrupt V2');
check(helpers.normalizeOfficialLicenseCode({code: full}) === '', 'reject NoSQL-like object');
check(helpers.normalizeOfficialLicenseCode(['zv-abcde-12345-abcde']) === '', 'reject arrays / parameter pollution');
check(helpers.officialV2Metadata(full).extensionProductId === PRODUCT_AUTOMACOES,'V2 saved with product');
check(Object.keys(helpers.officialV2Metadata('zv-abcde-12345-abcde')).length === 0,'existing keys retain legacy record shape');
const shield = fs.readFileSync(path.join(__dirname, '..', 'legacy-v3-shield.js'),'utf8');
check(shield.includes("String(row.keyCode || '').slice(0, 64)"),'V3 relogin cache does not truncate V2 identity');

console.log('R83 official keys V2 PASS: ' + checks + ' source/crypto/product controls');
