'use strict';

const crypto = require('node:crypto');

const DEFAULT_DEV_BUILD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const BUILD_ID_RE = /^zvm-dev-(\d+(?:\.\d+){2,3})-s([a-f0-9]{12})$/;
const EXTENSION_ID_RE = /^[a-p]{32}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const KEY_ID_RE = /^[A-Za-z0-9._:-]{3,64}$/;
const SIGNATURE_RE = /^[A-Za-z0-9_-]{80,96}$/;

function exactIso(value, code) {
  const raw = String(value || '').trim();
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== raw) throw new Error(code);
  return raw;
}

function positiveInteger(value, code, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(code);
  return n;
}

function canonicalDevBuildDescriptor(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('DEV_BUILD_DESCRIPTOR_INVALID');
  const schema = Number(raw.schema);
  const securityProtocol = Number(raw.securityProtocol);
  const buildId = String(raw.buildId || '').trim().toLowerCase();
  const channel = String(raw.channel || '').trim().toLowerCase();
  const profile = String(raw.profile || '').trim().toLowerCase();
  const extensionVersion = String(raw.extensionVersion || '').trim();
  const extensionId = String(raw.extensionId || '').trim().toLowerCase();
  const sourceTreeSha256 = String(raw.sourceTreeSha256 || '').trim().toLowerCase();
  const buildFingerprint = String(raw.buildFingerprint || '').trim().toLowerCase();
  const protectedFiles = positiveInteger(raw.protectedFiles, 'DEV_PROTECTED_FILES_INVALID', 10000);
  const createdAt = exactIso(raw.createdAt, 'DEV_BUILD_CREATED_AT_INVALID');

  if (schema !== 1 || securityProtocol !== 2 || channel !== 'dev' || profile !== 'dev') {
    throw new Error('DEV_BUILD_DESCRIPTOR_INVALID');
  }
  if (!/^\d+(?:\.\d+){2,3}$/.test(extensionVersion)) throw new Error('DEV_EXTENSION_VERSION_INVALID');
  if (!EXTENSION_ID_RE.test(extensionId)) throw new Error('DEV_EXTENSION_ID_INVALID');
  const expectedExtensionId = String(options.expectedExtensionId || '').trim().toLowerCase();
  if (expectedExtensionId && extensionId !== expectedExtensionId) throw new Error('DEV_EXTENSION_ID_NOT_ALLOWED');
  if (!SHA256_RE.test(sourceTreeSha256)) throw new Error('DEV_SOURCE_TREE_SHA256_INVALID');
  if (!SHA256_RE.test(buildFingerprint)) throw new Error('DEV_BUILD_FINGERPRINT_INVALID');

  const buildMatch = BUILD_ID_RE.exec(buildId);
  if (!buildMatch) throw new Error('DEV_BUILD_ID_INVALID');
  if (buildMatch[1] !== extensionVersion) throw new Error('DEV_BUILD_ID_VERSION_MISMATCH');
  if (buildMatch[2] !== sourceTreeSha256.slice(0, 12)) throw new Error('DEV_BUILD_ID_SOURCE_MISMATCH');

  return JSON.stringify({
    schema: 1,
    securityProtocol: 2,
    buildId,
    channel: 'dev',
    profile: 'dev',
    extensionVersion,
    extensionId,
    sourceTreeSha256,
    buildFingerprint,
    protectedFiles,
    createdAt,
  });
}

function normalizePrivateKey(key) {
  if (key && typeof key === 'object' && key.type === 'private') return key;
  if (Buffer.isBuffer(key) || typeof key === 'string') {
    try { return crypto.createPrivateKey(key); } catch (_) {}
  }
  throw new Error('DEV_SIGNING_PRIVATE_KEY_INVALID');
}

function normalizePublicKey(key) {
  if (key && typeof key === 'object' && key.type === 'public') return key;
  if (Buffer.isBuffer(key) || typeof key === 'string') {
    try { return crypto.createPublicKey(key); } catch (_) {}
  }
  throw new Error('DEV_SIGNING_PUBLIC_KEY_INVALID');
}

function importEd25519PrivateKeyB64(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('DEV_SIGNING_PRIVATE_KEY_REQUIRED');
  try {
    return crypto.createPrivateKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'pkcs8' });
  } catch (error) {
    const wrapped = new Error('DEV_SIGNING_PRIVATE_KEY_INVALID');
    wrapped.cause = error;
    throw wrapped;
  }
}

function importEd25519PublicKeyB64(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('DEV_SIGNING_PUBLIC_KEY_REQUIRED');
  try {
    return crypto.createPublicKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'spki' });
  } catch (error) {
    const wrapped = new Error('DEV_SIGNING_PUBLIC_KEY_INVALID');
    wrapped.cause = error;
    throw wrapped;
  }
}

function canonicalAttestationPayload(attestation, options = {}) {
  if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) throw new Error('DEV_BUILD_ATTESTATION_INVALID');
  if (Number(attestation.schema) !== 1 || String(attestation.algorithm || '') !== 'Ed25519') throw new Error('DEV_BUILD_ATTESTATION_INVALID');
  const keyId = String(attestation.keyId || '').trim();
  if (!KEY_ID_RE.test(keyId)) throw new Error('DEV_BUILD_ATTESTATION_INVALID');
  const descriptorJson = canonicalDevBuildDescriptor(attestation.descriptor, options);
  const descriptor = JSON.parse(descriptorJson);
  const signedAt = exactIso(attestation.signedAt, 'DEV_BUILD_ATTESTATION_INVALID');
  const expiresAt = exactIso(attestation.expiresAt, 'DEV_BUILD_ATTESTATION_INVALID');
  return JSON.stringify({ schema: 1, algorithm: 'Ed25519', keyId, descriptor, signedAt, expiresAt });
}

function createDevBuildAttestation(rawDescriptor, options = {}) {
  const maxBuildAgeMs = positiveInteger(options.maxBuildAgeMs || DEFAULT_DEV_BUILD_MAX_AGE_MS, 'DEV_BUILD_MAX_AGE_INVALID', 30 * 24 * 60 * 60 * 1000);
  const clockSkewMs = positiveInteger(options.clockSkewMs || DEFAULT_CLOCK_SKEW_MS, 'DEV_CLOCK_SKEW_INVALID', 60 * 60 * 1000);
  const nowMs = Number(options.nowMs == null ? Date.now() : options.nowMs);
  if (!Number.isFinite(nowMs)) throw new Error('DEV_SIGNING_TIME_INVALID');
  const keyId = String(options.keyId || '').trim();
  if (!KEY_ID_RE.test(keyId)) throw new Error('DEV_SIGNING_KEY_ID_INVALID');
  const privateKey = normalizePrivateKey(options.privateKey);

  const descriptor = JSON.parse(canonicalDevBuildDescriptor(rawDescriptor, options));
  const createdMs = Date.parse(descriptor.createdAt);
  if (createdMs > nowMs + clockSkewMs) throw new Error('DEV_BUILD_CREATED_AT_FUTURE');
  const expiryMs = createdMs + maxBuildAgeMs;
  if (expiryMs <= nowMs) throw new Error('DEV_BUILD_TOO_OLD');

  const unsigned = {
    schema: 1,
    algorithm: 'Ed25519',
    keyId,
    descriptor,
    signedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(expiryMs).toISOString(),
  };
  const payload = Buffer.from(canonicalAttestationPayload(unsigned, options), 'utf8');
  const signature = crypto.sign(null, payload, privateKey).toString('base64url');
  return Object.freeze({ ...unsigned, signature });
}

function verifyDevBuildAttestation(attestation, options = {}) {
  try {
    if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) return { ok: false, code: 'DEV_BUILD_ATTESTATION_INVALID' };
    const signature = String(attestation.signature || '').trim();
    if (!SIGNATURE_RE.test(signature)) return { ok: false, code: 'DEV_BUILD_ATTESTATION_INVALID' };
    const payloadText = canonicalAttestationPayload(attestation, options);
    const parsed = JSON.parse(payloadText);
    const nowMs = Number(options.nowMs == null ? Date.now() : options.nowMs);
    if (!Number.isFinite(nowMs)) return { ok: false, code: 'DEV_BUILD_ATTESTATION_INVALID' };
    const clockSkewMs = Number(options.clockSkewMs || DEFAULT_CLOCK_SKEW_MS);
    const maxBuildAgeMs = Number(options.maxBuildAgeMs || DEFAULT_DEV_BUILD_MAX_AGE_MS);
    if (!Number.isFinite(clockSkewMs) || clockSkewMs < 0 || !Number.isFinite(maxBuildAgeMs) || maxBuildAgeMs <= 0) {
      return { ok: false, code: 'DEV_BUILD_ATTESTATION_INVALID' };
    }
    const signedMs = Date.parse(parsed.signedAt);
    const createdMs = Date.parse(parsed.descriptor.createdAt);
    const expiresMs = Date.parse(parsed.expiresAt);
    if (signedMs > nowMs + clockSkewMs || createdMs > signedMs + clockSkewMs || expiresMs > createdMs + maxBuildAgeMs || expiresMs <= signedMs) {
      return { ok: false, code: 'DEV_BUILD_ATTESTATION_INVALID' };
    }
    if (nowMs >= expiresMs) return { ok: false, code: 'DEV_BUILD_EXPIRED' };

    const keyId = parsed.keyId;
    const keys = options.publicKeys instanceof Map ? options.publicKeys : new Map();
    const key = keys.get(keyId);
    if (!key) return { ok: false, code: 'DEV_BUILD_ATTESTATION_INVALID' };
    const publicKey = normalizePublicKey(key);
    const valid = crypto.verify(null, Buffer.from(payloadText, 'utf8'), publicKey, Buffer.from(signature, 'base64url'));
    if (!valid) return { ok: false, code: 'DEV_BUILD_ATTESTATION_INVALID' };
    return {
      ok: true,
      keyId,
      descriptor: parsed.descriptor,
      signedAt: parsed.signedAt,
      expiresAt: parsed.expiresAt,
      signature,
    };
  } catch (_) {
    return { ok: false, code: 'DEV_BUILD_ATTESTATION_INVALID' };
  }
}

function envTrue(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function boundedEnvNumber(value, fallback, min, max, code) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(code);
  return n;
}

function loadDevBuildSigningConfig(env = {}) {
  const enabled = envTrue(env.ZVM_DEV_SIGNED_BUILDS_ALLOW);
  if (!enabled) {
    return Object.freeze({
      enabled: false,
      keyId: '',
      privateKey: null,
      publicKeys: new Map(),
      expectedExtensionId: '',
      agentTokenHash: '',
      maxBuildAgeMs: DEFAULT_DEV_BUILD_MAX_AGE_MS,
      sessionTtlMs: 12 * 60 * 60 * 1000,
    });
  }

  const keyId = String(env.ZVM_DEV_SIGNING_KEY_ID || '').trim();
  if (!KEY_ID_RE.test(keyId)) throw new Error('DEV_SIGNING_KEY_ID_INVALID');
  const expectedExtensionId = String(env.ZVM_DEV_EXTENSION_ID || '').trim().toLowerCase();
  if (!EXTENSION_ID_RE.test(expectedExtensionId)) throw new Error('DEV_EXTENSION_ID_INVALID');
  const agentTokenHash = String(env.ZVM_DEV_BUILD_AGENT_TOKEN_SHA256 || '').trim().toLowerCase();
  if (!SHA256_RE.test(agentTokenHash)) throw new Error('DEV_BUILD_AGENT_TOKEN_HASH_INVALID');

  const privateKey = importEd25519PrivateKeyB64(env.ZVM_DEV_SIGNING_PRIVATE_KEY_B64);
  const publicKey = importEd25519PublicKeyB64(env.ZVM_DEV_SIGNING_PUBLIC_KEY_B64);
  const probe = Buffer.from('zvm-dev-signing-key-pair-check-v1', 'utf8');
  const proof = crypto.sign(null, probe, privateKey);
  if (!crypto.verify(null, probe, publicKey, proof)) throw new Error('DEV_SIGNING_KEY_PAIR_MISMATCH');

  const maxAgeDays = boundedEnvNumber(env.ZVM_DEV_BUILD_MAX_AGE_DAYS, 7, 1 / 24, 30, 'DEV_BUILD_MAX_AGE_INVALID');
  const sessionHours = boundedEnvNumber(env.ZVM_DEV_SESSION_TTL_HOURS, 12, 1 / 12, 24, 'DEV_SESSION_TTL_INVALID');
  const maxBuildAgeMs = Math.round(maxAgeDays * 24 * 60 * 60 * 1000);
  const sessionTtlMs = Math.round(sessionHours * 60 * 60 * 1000);

  return Object.freeze({
    enabled: true,
    keyId,
    privateKey,
    publicKeys: new Map([[keyId, publicKey]]),
    expectedExtensionId,
    agentTokenHash,
    maxBuildAgeMs,
    sessionTtlMs,
  });
}

function safeTokenHashMatches(rawToken, expectedHash) {
  const actual = crypto.createHash('sha256').update(String(rawToken || ''), 'utf8').digest();
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  if (expected.length !== 32) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function createDevBuildSigningService(config, deps = {}) {
  if (!config || config.enabled !== true || !config.privateKey || !(config.publicKeys instanceof Map)) {
    throw new Error('DEV_SIGNING_SERVICE_DISABLED');
  }
  const now = typeof deps.now === 'function' ? deps.now : Date.now;
  function sign(rawDescriptor, authorization) {
    const match = /^Bearer\s+([A-Za-z0-9._:-]{24,256})$/.exec(String(authorization || '').trim());
    if (!match || !safeTokenHashMatches(match[1], config.agentTokenHash)) {
      throw new Error('DEV_BUILD_AGENT_UNAUTHORIZED');
    }
    const attestation = createDevBuildAttestation(rawDescriptor, {
      privateKey: config.privateKey,
      keyId: config.keyId,
      expectedExtensionId: config.expectedExtensionId,
      maxBuildAgeMs: config.maxBuildAgeMs,
      nowMs: Number(now()),
    });
    return Object.freeze({ ok: true, attestation });
  }
  return Object.freeze({ sign });
}

module.exports = {
  DEFAULT_DEV_BUILD_MAX_AGE_MS,
  DEFAULT_CLOCK_SKEW_MS,
  canonicalDevBuildDescriptor,
  createDevBuildAttestation,
  verifyDevBuildAttestation,
  importEd25519PrivateKeyB64,
  importEd25519PublicKeyB64,
  loadDevBuildSigningConfig,
  createDevBuildSigningService,
};
