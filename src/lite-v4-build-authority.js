'use strict';
// ZVM LITE — independent Ed25519 DEV signer, Chrome identity and build registry.
// The server owns all expected values. A browser-provided productId or public key
// can never authorize a build. This is a build-descriptor gate, NOT remote
// attestation of the actual extension files on a customer's disk.
const crypto = require('node:crypto');
const FIELDS = Object.freeze(['schema','audience','productId','channel','extensionId','buildId','sha256','keyId','issuedAt','expiresAt']);
const CHROME_ID = /^[a-p]{32}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const BUILD_ID = /^zvm-lite-dev-[A-Za-z0-9_-]{3,96}$/;
const KEY_ID = /^[a-zA-Z0-9._-]{3,100}$/;
const VERSION = /^\d+(?:\.\d+){2,3}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BUILD_AGE = 7 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW = 5 * 60 * 1000;
const SESSION_TTL = 12 * 60 * 60 * 1000;
const has = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
function exactObject(o, fields) {
  return o && typeof o === 'object' && !Array.isArray(o) &&
    (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null) &&
    Object.keys(o).length === fields.length &&
    fields.every(k => has(o,k)) && Object.keys(o).every(k => fields.includes(k)) &&
    Object.getOwnPropertySymbols(o).length === 0;
}
function exactDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)) return NaN;
  const n = Date.parse(v);
  return Number.isFinite(n) && new Date(n).toISOString() === v ? n : NaN;
}
function denied(code, status = 403) { return { ok:false, code, status }; }
function readLiteConfig(env = {}, fullExtensionIds = new Set()) {
  const enabled = /^(1|true|yes|on)$/i.test(String(env.ZVM_LITE_V4_ENABLED || ''));
  if (!enabled) return Object.freeze({ enabled:false, ready:false, reason:'LITE_BUILD_AUTHORITY_UNCONFIGURED' });
  const extensionId = String(env.ZVM_LITE_DEV_EXTENSION_ID || '').trim().toLowerCase();
  const keyId = String(env.ZVM_LITE_DEV_KEY_ID || '').trim();
  const buildId = String(env.ZVM_LITE_DEV_BUILD_ID || '').trim();
  const sha256 = String(env.ZVM_LITE_DEV_BUILD_SHA256 || '').trim().toLowerCase();
  const version = String(env.ZVM_LITE_DEV_VERSION || '').trim();
  const publicB64 = String(env.ZVM_LITE_DEV_PUBLIC_KEY_SPKI_B64 || '').trim();
  if (!CHROME_ID.test(extensionId) || fullExtensionIds.has(extensionId) ||
      extensionId === String(env.ZVM_DEV_EXTENSION_ID || '').toLowerCase() ||
      !KEY_ID.test(keyId) || keyId === String(env.ZVM_DEV_SIGNING_KEY_ID || '') ||
      !BUILD_ID.test(buildId) || !HEX64.test(sha256) || !VERSION.test(version) ||
      !/^[A-Za-z0-9+/]{45,300}={0,2}$/.test(publicB64) ||
      publicB64 === String(env.ZVM_DEV_SIGNING_PUBLIC_KEY_B64 || '').trim()) {
    return Object.freeze({enabled:true,ready:false,reason:'LITE_BUILD_AUTHORITY_INVALID'});
  }
  try {
    const der = Buffer.from(publicB64,'base64');
    if (der.toString('base64') !== publicB64) throw new Error('noncanonical-public-key');
    const publicKey = crypto.createPublicKey({key:der,format:'der',type:'spki'});
    if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('wrong-algorithm');
    return Object.freeze({enabled:true,ready:true,extensionId,keyId,buildId,sha256,version,publicKey});
  } catch {
    return Object.freeze({enabled:true,ready:false,reason:'LITE_BUILD_AUTHORITY_INVALID'});
  }
}
function liteOriginAllowed(origin, config) {
  return config?.ready === true && String(origin || '') === 'chrome-extension://' + config.extensionId;
}
function inspectLiteClient(config, client, signed, origin, nowMs=Date.now()) {
  if (!config?.ready) return denied('LITE_BUILD_AUTHORITY_UNCONFIGURED',503);
  if (!liteOriginAllowed(origin,config)) return denied('LITE_EXTENSION_ORIGIN_REQUIRED');
  if (!client || typeof client !== 'object' || Array.isArray(client) ||
      Number(client.protocol)!==2 || client.channel!=='dev' || client.profile!=='dev' ||
      client.extensionId!==config.extensionId || client.extensionVersion!==config.version ||
      client.buildId!==config.buildId || client.buildFingerprint!==config.sha256 ||
      !UUID.test(String(client.installationId || '')) ||
      !/^[A-Za-z0-9._:-]{8,96}$/.test(String(client.requestId || '')) ||
      !Number.isSafeInteger(client.sentAtMs) || Math.abs(nowMs-client.sentAtMs)>CLOCK_SKEW) {
    return denied('LITE_CLIENT_IDENTITY_INVALID',400);
  }
  if (!exactObject(signed,['payload','signatureBase64']) || !exactObject(signed.payload,FIELDS)) {
    return denied('LITE_SIGNED_BUILD_INVALID');
  }
  const p=signed.payload;
  if (p.schema!=='zvm-lite-build-v1' || p.audience!=='zvm-lite-v4-server' ||
      p.productId!=='zvm_lite' || p.channel!=='dev' ||
      p.extensionId!==config.extensionId || p.buildId!==config.buildId ||
      p.sha256!==config.sha256 || p.keyId!==config.keyId) {
    return denied('LITE_SIGNED_BUILD_MISMATCH');
  }
  const issued=exactDate(p.issuedAt), expires=exactDate(p.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires<=issued ||
      expires-issued>MAX_BUILD_AGE || issued>nowMs+CLOCK_SKEW || expires<=nowMs) {
    return denied('LITE_SIGNED_BUILD_EXPIRED');
  }
  const b64=signed.signatureBase64;
  if (typeof b64!=='string' || !/^[A-Za-z0-9+/]{86}==$/.test(b64)) return denied('LITE_SIGNATURE_INVALID');
  const signature=Buffer.from(b64,'base64');
  if (signature.length!==64 || signature.toString('base64')!==b64) return denied('LITE_SIGNATURE_INVALID');
  const canonical=Buffer.from(JSON.stringify(Object.fromEntries(FIELDS.map(k=>[k,p[k]]))),'utf8');
  if (!crypto.verify(null,canonical,config.publicKey,signature)) return denied('LITE_SIGNATURE_INVALID');
  // Do not include any caller-controlled entitlement or license metadata.
  return Object.freeze({
    ok:true,
    securityProtocol:2, extensionVersion:config.version, extensionId:config.extensionId,
    buildId:config.buildId, buildFingerprint:config.sha256, channel:'dev', profile:'dev',
    installationId:client.installationId, requestId:client.requestId, signedDev:true,
    signedExpiresAt:p.expiresAt, signerKeyId:config.keyId,
    developmentAuthorized:true, recognized:false
  });
}
function liteSessionAllowed(config, sessionDoc, nowMs=Date.now()) {
  return config?.ready===true && sessionDoc?.extensionProductId==='zvm_lite' &&
    sessionDoc.securityProtocol===2 && sessionDoc.channel==='dev' &&
    sessionDoc.profile==='dev' && sessionDoc.extensionId===config.extensionId &&
    sessionDoc.extensionVersion===config.version &&
    sessionDoc.buildId===config.buildId && sessionDoc.buildFingerprint===config.sha256 &&
    sessionDoc.liteSignerKeyId===config.keyId &&
    Number.isFinite(Date.parse(String(sessionDoc.liteSignedExpiresAt||''))) &&
    Date.parse(sessionDoc.liteSignedExpiresAt)>nowMs;
}
module.exports=Object.freeze({
  readLiteConfig,inspectLiteClient,liteOriginAllowed,liteSessionAllowed,
  FIELDS,MAX_BUILD_AGE,SESSION_TTL
});
