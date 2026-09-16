'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { verifyDevBuildAttestation } = require('./dev-build-signing');

function parseBuildMap(raw) {
  const out = new Map();
  const add = (version, fp) => {
    version = String(version || '').trim();
    fp = String(fp || '').trim().toLowerCase();
    if (!/^\d+(?:\.\d+){2,3}$/.test(version) || !/^[a-f0-9]{64}$/.test(fp)) return;
    if (!out.has(version)) out.set(version, new Set());
    out.get(version).add(fp);
  };

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const source = raw.builds && typeof raw.builds === 'object' ? raw.builds : raw;
    for (const [version, value] of Object.entries(source || {})) {
      if (Array.isArray(value)) value.forEach(fp => add(version, fp));
      else add(version, value);
    }
    return out;
  }

  raw = String(raw || '').trim();
  if (!raw) return out;
  if (raw.startsWith('{')) {
    try { return parseBuildMap(JSON.parse(raw)); } catch (_) { /* fall through */ }
  }
  for (const item of raw.split(/[;,\n]+/)) {
    const match = item.trim().match(/^(\d+(?:\.\d+){2,3})\s*[:@=]\s*([a-fA-F0-9]{64})$/);
    if (match) add(match[1], match[2]);
  }
  return out;
}

function mergeBuildMaps(target, source) {
  for (const [version, set] of source || []) {
    if (!target.has(version)) target.set(version, new Set());
    for (const fp of set || []) target.get(version).add(fp);
  }
  return target;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value == null ? '' : value), 'utf8').digest('hex');
}

function hashSet(raw) {
  const out = new Set();
  String(raw || '').split(/[;,\n\s]+/).forEach(value => {
    const normalized = String(value || '').trim().toLowerCase();
    if (/^[a-f0-9]{64}$/.test(normalized)) out.add(normalized);
  });
  return out;
}


const REGISTRY_V2_ENTRY_KEYS = Object.freeze([
  'buildFingerprint',
  'buildId',
  'channel',
  'createdAt',
  'extensionIds',
  'extensionVersion',
  'profile',
  'securityProtocol',
  'sourceRevision',
  'sourceTreeSha256',
  'status',
]);

function normalizeRegistryV2Entry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('BUILD_REGISTRY_V2_ENTRY_INVALID');
  const keys = Object.keys(raw).sort();
  if (keys.length !== REGISTRY_V2_ENTRY_KEYS.length || keys.some((key, index) => key !== REGISTRY_V2_ENTRY_KEYS[index])) {
    throw new Error('BUILD_REGISTRY_V2_ENTRY_INVALID');
  }

  const buildId = String(raw.buildId || '').trim().toLowerCase();
  const channel = String(raw.channel || '').trim().toLowerCase();
  const profile = String(raw.profile || '').trim().toLowerCase();
  const extensionVersion = String(raw.extensionVersion || '').trim();
  const buildFingerprint = String(raw.buildFingerprint || '').trim().toLowerCase();
  const sourceTreeSha256 = String(raw.sourceTreeSha256 || '').trim().toLowerCase();
  const sourceRevision = raw.sourceRevision == null ? null : String(raw.sourceRevision).trim().toLowerCase();
  const createdAt = String(raw.createdAt || '').trim();
  const status = String(raw.status || '').trim().toLowerCase();
  const extensionIds = Array.isArray(raw.extensionIds)
    ? raw.extensionIds.map(value => String(value || '').trim().toLowerCase())
    : null;

  const validChannel = ['dev', 'beta', 'production'].includes(channel);
  const validProfile = ['dev', 'release'].includes(profile);
  const validPair = (channel === 'dev' && profile === 'dev') || ((channel === 'beta' || channel === 'production') && profile === 'release');
  const validVersion = /^\d+(?:\.\d+){2,3}$/.test(extensionVersion);
  const validSource = /^[a-f0-9]{64}$/.test(sourceTreeSha256);
  const expectedBuildId = validChannel && validVersion && validSource
    ? `zvm-${channel}-${extensionVersion}-s${sourceTreeSha256.slice(0, 12)}`
    : '';
  const validCreatedAt = createdAt && !Number.isNaN(Date.parse(createdAt)) && new Date(createdAt).toISOString() === createdAt;
  const validRevision = sourceRevision === null || /^[a-f0-9]{7,64}$/.test(sourceRevision);
  const validExtensionIds = extensionIds && extensionIds.length > 0 &&
    extensionIds.every(id => /^[a-p]{32}$/.test(id)) && new Set(extensionIds).size === extensionIds.length;

  if (
    raw.securityProtocol !== 2 || !validChannel || !validProfile || !validPair || !validVersion ||
    !/^[a-f0-9]{64}$/.test(buildFingerprint) || !validSource || buildId !== expectedBuildId ||
    !validExtensionIds || !validRevision || !validCreatedAt || !['active', 'revoked'].includes(status)
  ) {
    throw new Error('BUILD_REGISTRY_V2_ENTRY_INVALID');
  }

  return Object.freeze({
    buildId,
    channel,
    profile,
    extensionVersion,
    buildFingerprint,
    extensionIds: Object.freeze(extensionIds.slice()),
    securityProtocol: 2,
    sourceTreeSha256,
    sourceRevision,
    createdAt,
    status,
  });
}

function parseRegistryV2Document(raw, sourceName = 'registry') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schema !== 2 || !Array.isArray(raw.builds)) {
    throw new Error('BUILD_REGISTRY_V2_INVALID');
  }
  const out = new Map();
  for (const item of raw.builds) {
    const entry = normalizeRegistryV2Entry(item);
    if (out.has(entry.buildId)) throw new Error(`BUILD_REGISTRY_V2_DUPLICATE_BUILD_ID:${sourceName}`);
    out.set(entry.buildId, entry);
  }
  return out;
}

function loadRegistryV2(filePath, envJson = '') {
  let fileDoc;
  try {
    fileDoc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const wrapped = new Error('BUILD_REGISTRY_V2_INVALID');
    wrapped.cause = error;
    throw wrapped;
  }
  const out = parseRegistryV2Document(fileDoc, 'file');
  const extra = String(envJson || '').trim();
  if (!extra) return out;

  let envDoc;
  try { envDoc = JSON.parse(extra); }
  catch (error) {
    const wrapped = new Error('BUILD_REGISTRY_V2_INVALID');
    wrapped.cause = error;
    throw wrapped;
  }
  const emergency = parseRegistryV2Document(envDoc, 'env');
  for (const [buildId, incoming] of emergency) {
    const current = out.get(buildId);
    if (!current) {
      out.set(buildId, incoming);
      continue;
    }
    if (current.status === 'revoked') continue;
    if (incoming.status === 'revoked') {
      out.set(buildId, incoming);
      continue;
    }
    throw new Error('BUILD_REGISTRY_V2_DUPLICATE_BUILD_ID:merge');
  }
  return out;
}

function countBuilds(map) {
  let count = 0;
  for (const set of map?.values?.() || []) count += set.size;
  return count;
}

function createBuildAuthority(config = {}, deps = {}) {
  const state = {
    securityProtocol: Number(config.securityProtocol || 1),
    buildEnforce: config.buildEnforce === true,
    legacyV3Allow: config.legacyV3Allow === true,
    extensionIds: config.extensionIds instanceof Set ? config.extensionIds : new Set(config.extensionIds || []),
    officialBuilds: config.officialBuilds instanceof Map ? config.officialBuilds : new Map(),
    deniedBuilds: config.deniedBuilds instanceof Map ? config.deniedBuilds : new Map(),
    registryV2: config.registryV2 instanceof Map ? config.registryV2 : new Map(),
    runtimeEnv: String(config.runtimeEnv || '').trim().toLowerCase(),
    devBuildAllow: config.devBuildAllow === true,
    devCohostAllow: config.devCohostAllow === true,
    devSignedBuildsAllow: config.devSignedBuildsAllow === true,
    devSigningPublicKeys: config.devSigningPublicKeys instanceof Map ? config.devSigningPublicKeys : new Map(),
    devExtensionId: String(config.devExtensionId || '').trim().toLowerCase(),
    devBuildMaxAgeMs: Number(config.devBuildMaxAgeMs || 7 * 24 * 60 * 60 * 1000),
    devBuildKeyHashes: config.devBuildKeyHashes instanceof Set ? config.devBuildKeyHashes : new Set(),
    devBuildDeviceHashes: config.devBuildDeviceHashes instanceof Set ? config.devBuildDeviceHashes : new Set(),
    clockSkewMs: Number(config.clockSkewMs || 15 * 60 * 1000),
    requestTtlMs: Number(config.requestTtlMs || 20 * 60 * 1000),
  };
  const now = typeof deps.now === 'function' ? deps.now : Date.now;
  const verifySignedDevAttestation = typeof deps.verifyDevBuildAttestation === 'function'
    ? deps.verifyDevBuildAttestation
    : verifyDevBuildAttestation;
  const seen = deps.seen instanceof Map ? deps.seen : new Map();

  function buildRecognized(version, fingerprint) {
    const set = state.officialBuilds.get(String(version || ''));
    return !!(set && set.has(String(fingerprint || '').toLowerCase()));
  }

  function buildDenied(version, fingerprint) {
    const set = state.deniedBuilds.get(String(version || ''));
    return !!(set && set.has(String(fingerprint || '').toLowerCase()));
  }

  function devBuildAllowed(keyCode, deviceId) {
    if (!state.devBuildAllow || !keyCode || !deviceId || !state.devBuildKeyHashes.size || !state.devBuildDeviceHashes.size) return false;
    return state.devBuildKeyHashes.has(sha256(String(keyCode))) && state.devBuildDeviceHashes.has(sha256(String(deviceId)));
  }

  function legacyV3Allowed() {
    return !state.buildEnforce || state.legacyV3Allow;
  }

  function normalizedVerifiedAttestation(verified) {
    return Object.freeze({
      schema: 1,
      algorithm: 'Ed25519',
      keyId: verified.keyId,
      descriptor: Object.freeze({ ...verified.descriptor }),
      signedAt: verified.signedAt,
      expiresAt: verified.expiresAt,
      signature: verified.signature,
    });
  }

  function signedDevIdentityDecision(identity, attestation, timestamp = Number(now())) {
    if (state.runtimeEnv !== 'production' || state.devCohostAllow !== true || state.devSignedBuildsAllow !== true) {
      return { ok: false, code: 'DEV_BUILD_NOT_AUTHORIZED' };
    }
    if (!attestation) return { ok: false, code: 'DEV_BUILD_ATTESTATION_REQUIRED' };
    if (!/^[a-p]{32}$/.test(state.devExtensionId) || !state.devSigningPublicKeys.size) {
      return { ok: false, code: 'DEV_BUILD_NOT_AUTHORIZED' };
    }
    const verified = verifySignedDevAttestation(attestation, {
      publicKeys: state.devSigningPublicKeys,
      expectedExtensionId: state.devExtensionId,
      nowMs: Number(timestamp),
      maxBuildAgeMs: state.devBuildMaxAgeMs,
      clockSkewMs: state.clockSkewMs,
    });
    if (!verified?.ok) return { ok: false, code: verified?.code || 'DEV_BUILD_ATTESTATION_INVALID' };
    const descriptor = verified.descriptor || {};
    const matches = descriptor.securityProtocol === 2 &&
      descriptor.buildId === String(identity.buildId || '').toLowerCase() &&
      descriptor.channel === 'dev' && String(identity.channel || '').toLowerCase() === 'dev' &&
      descriptor.profile === 'dev' && String(identity.profile || '').toLowerCase() === 'dev' &&
      descriptor.extensionVersion === String(identity.extensionVersion || '') &&
      descriptor.extensionId === String(identity.extensionId || '').toLowerCase() &&
      descriptor.buildFingerprint === String(identity.buildFingerprint || '').toLowerCase();
    if (!matches) return { ok: false, code: 'DEV_BUILD_ATTESTATION_INVALID' };
    return { ok: true, verified, attestation: normalizedVerifiedAttestation(verified) };
  }

  function storedSessionAllowed(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
    const extensionVersion = String(doc.extensionVersion || '').trim();
    const buildFingerprint = String(doc.buildFingerprint || '').trim().toLowerCase();
    const extensionId = String(doc.extensionId || '').trim().toLowerCase();

    if (Number(doc.securityProtocol || 1) === 2) {
      const buildId = String(doc.buildId || '').trim().toLowerCase();
      const channel = String(doc.channel || '').trim().toLowerCase();
      const profile = String(doc.profile || '').trim().toLowerCase();
      const installationIdHash = String(doc.installationIdHash || '').trim().toLowerCase();
      const licenseKeyCode = String(doc.licenseKeyCode || '').trim();
      if (!/^\d+(?:\.\d+){2,3}$/.test(extensionVersion) || !/^[a-f0-9]{64}$/.test(buildFingerprint) || !/^[a-p]{32}$/.test(extensionId)) return false;
      if (!/^zvm-(dev|beta|production)-\d+(?:\.\d+){2,3}-s[a-f0-9]{12}$/.test(buildId)) return false;
      if (state.extensionIds.size && !state.extensionIds.has(extensionId)) return false;
      if (buildDenied(extensionVersion, buildFingerprint)) return false;

      const entry = state.registryV2.get(buildId);
      if (entry) {
        if (entry.status === 'revoked') return false;
        if (entry.channel === 'dev' && state.runtimeEnv === 'production' && state.devCohostAllow !== true) return false;
        return entry.securityProtocol === 2 &&
          entry.extensionVersion === extensionVersion &&
          entry.channel === channel &&
          entry.profile === profile &&
          entry.buildFingerprint === buildFingerprint &&
          entry.extensionIds.includes(extensionId);
      }

      if (doc.signedDev === true) {
        return signedDevIdentityDecision({ buildId, channel, profile, extensionVersion, extensionId, buildFingerprint }, doc.devAttestation).ok;
      }

      if (doc.developmentAuthorized !== true) return false;
      return state.runtimeEnv === 'staging' &&
        state.buildEnforce === true &&
        state.devBuildAllow === true &&
        channel === 'dev' &&
        profile === 'dev' &&
        state.extensionIds.has(extensionId) &&
        /^[a-f0-9]{64}$/.test(installationIdHash) &&
        state.devBuildDeviceHashes.has(installationIdHash) &&
        !!licenseKeyCode &&
        state.devBuildKeyHashes.has(sha256(licenseKeyCode));
    }

    if (buildDenied(extensionVersion, buildFingerprint)) return false;
    if (!state.buildEnforce) return true;
    if (!/^\d+(?:\.\d+){2,3}$/.test(extensionVersion) || !/^[a-f0-9]{64}$/.test(buildFingerprint) || !/^[a-p]{32}$/.test(extensionId)) return false;
    if (state.extensionIds.size && !state.extensionIds.has(extensionId)) return false;
    if (buildRecognized(extensionVersion, buildFingerprint)) return true;
    return doc.developmentAuthorized === true && state.devBuildAllow === true;
  }

  function storedSessionDecision(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, code: 'BUILD_NOT_ALLOWED' };
    if (Number(doc.securityProtocol || 1) === 2) {
      const buildId = String(doc.buildId || '').trim().toLowerCase();
      const extensionVersion = String(doc.extensionVersion || '').trim();
      const buildFingerprint = String(doc.buildFingerprint || '').trim().toLowerCase();
      if (buildDenied(extensionVersion, buildFingerprint)) return { ok: false, code: 'BUILD_REVOKED' };
      const entry = state.registryV2.get(buildId);
      if (entry?.status === 'revoked') return { ok: false, code: 'BUILD_REVOKED' };
      if (!entry && doc.signedDev === true) {
        const signed = signedDevIdentityDecision({
          buildId,
          channel: doc.channel,
          profile: doc.profile,
          extensionVersion,
          extensionId: doc.extensionId,
          buildFingerprint,
        }, doc.devAttestation);
        if (!signed.ok) return { ok: false, code: signed.code || 'BUILD_NOT_ALLOWED' };
      }
    } else if (buildDenied(doc.extensionVersion, doc.buildFingerprint)) {
      return { ok: false, code: 'BUILD_REVOKED' };
    }
    return storedSessionAllowed(doc) ? { ok: true } : { ok: false, code: 'BUILD_NOT_ALLOWED' };
  }

  function cleanupSeen(timestamp) {
    if (seen.size < 1024) return;
    for (const [id, ts] of seen) if (timestamp - ts > state.requestTtlMs) seen.delete(id);
    while (seen.size > 4096) seen.delete(seen.keys().next().value);
  }

  function checkClientV1(raw, options, timestamp) {
    const extensionVersion = String(raw.extensionVersion || '').trim();
    const extensionId = String(raw.extensionId || '').trim().toLowerCase();
    const buildFingerprint = String(raw.buildFingerprint || '').trim().toLowerCase();
    const requestId = String(raw.requestId || '').trim();
    const sentAtMs = Number(raw.sentAtMs || 0);

    if (!/^\d+(?:\.\d+){2,3}$/.test(extensionVersion) || !/^[a-f0-9]{64}$/.test(buildFingerprint) || !/^[a-p]{32}$/.test(extensionId)) {
      return { ok: false, code: 'SECURITY_CLIENT_INVALID' };
    }
    if (buildDenied(extensionVersion, buildFingerprint)) {
      return { ok: false, code: 'BUILD_REVOKED', recognized: false, extensionVersion, extensionId, buildFingerprint };
    }
    if (state.extensionIds.size && !state.extensionIds.has(extensionId)) return { ok: false, code: 'EXTENSION_ID_NOT_ALLOWED' };
    if (!/^[A-Za-z0-9._:-]{8,96}$/.test(requestId) || !Number.isFinite(sentAtMs) || Math.abs(timestamp - sentAtMs) > state.clockSkewMs) {
      return { ok: false, code: 'SECURITY_REQUEST_STALE' };
    }

    cleanupSeen(timestamp);
    if (options.consume === true) {
      if (seen.has(requestId)) return { ok: false, code: 'SECURITY_REPLAY_REJECTED' };
      seen.set(requestId, timestamp);
    }

    const recognized = buildRecognized(extensionVersion, buildFingerprint);
    const allowUnrecognized = options.allowUnrecognized === true;
    const requireRecognized = options.requireRecognized !== false;
    if (state.buildEnforce && requireRecognized && !recognized && !allowUnrecognized) {
      return { ok: false, code: 'BUILD_NOT_ALLOWED', recognized: false, extensionVersion, extensionId, buildFingerprint };
    }
    return {
      ok: true,
      securityProtocol: 1,
      recognized,
      developmentAuthorized: !recognized && allowUnrecognized,
      extensionVersion,
      extensionId,
      buildFingerprint,
      requestId,
    };
  }

  function devV2Allowed({ extensionId, channel, profile, installationId }, options) {
    const licenseKey = String(options?.licenseKey || options?.keyCode || '').trim();
    if (state.runtimeEnv !== 'staging' || state.buildEnforce !== true || state.devBuildAllow !== true) return false;
    if (channel !== 'dev' || profile !== 'dev') return false;
    if (!state.extensionIds.size || !state.extensionIds.has(extensionId)) return false;
    if (!licenseKey || !state.devBuildKeyHashes.size || !state.devBuildKeyHashes.has(sha256(licenseKey))) return false;
    if (!installationId || !state.devBuildDeviceHashes.size || !state.devBuildDeviceHashes.has(sha256(installationId))) return false;
    return true;
  }

  function checkClientV2(raw, options, timestamp) {
    const extensionVersion = String(raw.extensionVersion || '').trim();
    const extensionId = String(raw.extensionId || '').trim().toLowerCase();
    const buildId = String(raw.buildId || '').trim().toLowerCase();
    const channel = String(raw.channel || '').trim().toLowerCase();
    const profile = String(raw.profile || '').trim().toLowerCase();
    const buildFingerprint = String(raw.buildFingerprint || '').trim().toLowerCase();
    const installationId = String(raw.installationId || '').trim();
    const requestId = String(raw.requestId || '').trim();
    const sentAtMs = Number(raw.sentAtMs || 0);

    // 1. shape/protocol
    if (!/^\d+(?:\.\d+){2,3}$/.test(extensionVersion) ||
        !/^[A-Za-z0-9._:-]{8,96}$/.test(requestId) ||
        !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(installationId) ||
        !Number.isFinite(sentAtMs)) {
      return { ok: false, code: 'SECURITY_CLIENT_INVALID' };
    }
    // 2. timestamp
    if (Math.abs(timestamp - sentAtMs) > state.clockSkewMs) return { ok: false, code: 'SECURITY_REQUEST_STALE' };
    // 3. Extension ID syntax + global allowlist
    if (!/^[a-p]{32}$/.test(extensionId)) return { ok: false, code: 'SECURITY_CLIENT_INVALID' };
    if (state.extensionIds.size && !state.extensionIds.has(extensionId)) return { ok: false, code: 'EXTENSION_ID_NOT_ALLOWED' };
    // 4. channel/profile pair
    if (!['dev', 'beta', 'production'].includes(channel) || !['dev', 'release'].includes(profile)) {
      return { ok: false, code: 'SECURITY_CLIENT_INVALID' };
    }
    if (channel === 'dev' && profile !== 'dev') return { ok: false, code: 'BUILD_PROFILE_MISMATCH' };
    if ((channel === 'beta' || channel === 'production') && profile !== 'release') return { ok: false, code: 'BUILD_PROFILE_MISMATCH' };
    if (channel === 'dev' && state.runtimeEnv !== 'staging' && !(state.runtimeEnv === 'production' && state.devCohostAllow === true)) {
      return { ok: false, code: 'DEV_BUILD_NOT_AUTHORIZED' };
    }
    // 5. Build ID syntax
    if (!/^zvm-(dev|beta|production)-\d+(?:\.\d+){2,3}-s[a-f0-9]{12}$/.test(buildId)) {
      return { ok: false, code: 'BUILD_ID_NOT_ALLOWED' };
    }
    // 6. fingerprint syntax
    if (!/^[a-f0-9]{64}$/.test(buildFingerprint)) return { ok: false, code: 'SECURITY_CLIENT_INVALID' };
    // 7. registry lookup / revocation. Fingerprint denylist always wins,
    // including for dynamically signed DEV builds.
    if (buildDenied(extensionVersion, buildFingerprint)) {
      return { ok: false, code: 'BUILD_REVOKED', recognized: false, buildId };
    }
    const entry = state.registryV2.get(buildId);
    let recognized = true;
    let developmentAuthorized = false;
    let signedDev = false;
    let normalizedDevAttestation = null;
    if (!entry) {
      if (channel !== 'dev') return { ok: false, code: 'BUILD_ID_NOT_ALLOWED' };
      if (state.runtimeEnv === 'production' && state.devCohostAllow === true && state.devSignedBuildsAllow === true) {
        const signed = signedDevIdentityDecision({ buildId, channel, profile, extensionVersion, extensionId, buildFingerprint }, raw.devAttestation, timestamp);
        if (!signed.ok) return { ok: false, code: signed.code || 'DEV_BUILD_ATTESTATION_INVALID' };
        recognized = false;
        developmentAuthorized = true;
        signedDev = true;
        normalizedDevAttestation = signed.attestation;
      } else {
        if (!devV2Allowed({ extensionId, channel, profile, installationId }, options)) {
          return { ok: false, code: 'DEV_BUILD_NOT_AUTHORIZED' };
        }
        recognized = false;
        developmentAuthorized = true;
      }
    } else {
      if (entry.status === 'revoked') return { ok: false, code: 'BUILD_REVOKED', recognized: false, buildId };
      if (entry.channel !== channel) return { ok: false, code: 'BUILD_CHANNEL_MISMATCH' };
      if (entry.profile !== profile) return { ok: false, code: 'BUILD_PROFILE_MISMATCH' };
      if (entry.extensionVersion !== extensionVersion || entry.buildFingerprint !== buildFingerprint || entry.securityProtocol !== 2) {
        return { ok: false, code: 'BUILD_NOT_ALLOWED', recognized: false, buildId };
      }
      if (!entry.extensionIds.includes(extensionId)) return { ok: false, code: 'EXTENSION_ID_NOT_ALLOWED' };
    }

    cleanupSeen(timestamp);
    if (options.consume === true) {
      if (seen.has(requestId)) return { ok: false, code: 'SECURITY_REPLAY_REJECTED' };
      seen.set(requestId, timestamp);
    }

    return {
      ok: true,
      securityProtocol: 2,
      recognized,
      developmentAuthorized,
      signedDev,
      devAttestation: normalizedDevAttestation,
      extensionVersion,
      extensionId,
      buildId,
      channel,
      profile,
      buildFingerprint,
      installationId,
      requestId,
    };
  }

  function checkClient(raw, options = {}) {
    options = options && typeof options === 'object' ? options : {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 'SECURITY_CLIENT_INVALID' };
    const protocol = Number(raw.protocol || 0);
    const timestamp = Number(now());
    if (protocol === 2) return checkClientV2(raw, options, timestamp);
    if (protocol === state.securityProtocol) return checkClientV1(raw, options, timestamp);
    return { ok: false, code: 'SECURITY_CLIENT_INVALID' };
  }

  async function consumeRequestIdShared(requestId, nowMs = Number(now()), sharedDeps = {}) {
    if (typeof deps.consumeRequestIdShared === 'function') {
      return deps.consumeRequestIdShared(requestId, nowMs, sharedDeps);
    }
    return { ok: false, code: 'SECURITY_REPLAY_UNAVAILABLE' };
  }

  async function checkClientShared(raw, options = {}, sharedDeps = {}) {
    const checked = checkClient(raw, { ...options, consume: false });
    if (!checked.ok) return checked;
    const consumed = await consumeRequestIdShared(checked.requestId, Number(now()), sharedDeps);
    if (!consumed.ok) return { ...checked, ok: false, code: consumed.code };
    return checked;
  }

  function clientErrorStatus(code) {
    if (['BUILD_NOT_ALLOWED','BUILD_ID_NOT_ALLOWED','BUILD_REVOKED','BUILD_CHANNEL_MISMATCH','BUILD_PROFILE_MISMATCH','EXTENSION_ID_NOT_ALLOWED','INSTALLATION_NOT_AUTHORIZED','DEV_BUILD_NOT_AUTHORIZED','DEV_BUILD_ATTESTATION_REQUIRED','DEV_BUILD_ATTESTATION_INVALID','DEV_BUILD_EXPIRED','DEV_ACCESS_REQUIRED'].includes(code)) return 403;
    if (code === 'SECURITY_REPLAY_UNAVAILABLE') return 503;
    return 400;
  }

  function describe() {
    return Object.freeze({
      protocol: state.securityProtocol,
      buildEnforce: state.buildEnforce,
      officialBuildCount: countBuilds(state.officialBuilds),
      registryV2ActiveCount: Array.from(state.registryV2.values()).filter(entry => entry.status === 'active').length,
      runtimeEnv: state.runtimeEnv,
      devBuildAllow: state.devBuildAllow,
      devCohostAllow: state.devCohostAllow,
      devSignedBuildsAllow: state.devSignedBuildsAllow,
      devSigningKeyCount: state.devSigningPublicKeys.size,
      legacyV3: legacyV3Allowed(),
    });
  }

  return Object.freeze({
    checkClient,
    checkClientShared,
    consumeRequestIdShared,
    storedSessionAllowed,
    storedSessionDecision,
    clientErrorStatus,
    legacyV3Allowed,
    describe,
    buildRecognized,
    buildDenied,
    devBuildAllowed,
  });
}

module.exports = {
  createBuildAuthority,
  parseBuildMap,
  mergeBuildMaps,
  sha256,
  hashSet,
  loadRegistryV2,
};
