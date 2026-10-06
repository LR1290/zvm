'use strict';

const EXTENSION_ID_RE = /^[a-p]{32}$/;
const LEGACY_V3_UNPACKED_COMPAT_SUFFIXES = Object.freeze([
  '/v3/key',
  '/v3/check-status',
  '/v3/usage',
  '/v3/get-usage',
  '/v3/sync-usage',
]);

function parseChromeExtensionOrigin(origin) {
  if (!origin) return null;
  try {
    const u = new URL(String(origin));
    if (u.protocol !== 'chrome-extension:') return null;
    // R41: CORS Origin must be the bare extension origin. Reject path/query/hash
    // instead of silently canonicalizing chrome-extension://<id>/anything.
    if (u.username || u.password || u.port || (u.pathname && u.pathname !== '/') || u.search || u.hash) return null;
    const id = String(u.hostname || '').toLowerCase();
    if (!EXTENSION_ID_RE.test(id)) return null;
    return Object.freeze({ id, origin: `chrome-extension://${id}` });
  } catch (_) {
    return null;
  }
}

function isLegacyV3UnpackedCompatPath(pathname, extensionRoot = '/extension') {
  const root = String(extensionRoot || '/extension').replace(/\/$/, '');
  return LEGACY_V3_UNPACKED_COMPAT_SUFFIXES.some(suffix => pathname === `${root}${suffix}`);
}

function resolveExtensionCorsOrigin({
  origin,
  pathname,
  extensionIds,
  extensionRoot = '/extension',
  legacyV3Allow = false,
} = {}) {
  const parsed = parseChromeExtensionOrigin(origin);
  if (!parsed) return null;

  const ids = extensionIds instanceof Set ? extensionIds : new Set(extensionIds || []);
  if (ids.has(parsed.id)) return parsed.origin;

  // R41: Build 3 (0.2.7/0.2.8) is unpacked and therefore has a variable extension
  // ID. Preserve only the five V3 endpoints its historical contract actually
  // uses. V4, Meta, admin and every other path remain strict.
  const legacyUnpackedCompat = legacyV3Allow === true &&
    isLegacyV3UnpackedCompatPath(String(pathname || ''), extensionRoot);
  return legacyUnpackedCompat ? parsed.origin : null;
}

module.exports = Object.freeze({
  EXTENSION_ID_RE,
  LEGACY_V3_UNPACKED_COMPAT_SUFFIXES,
  parseChromeExtensionOrigin,
  isLegacyV3UnpackedCompatPath,
  resolveExtensionCorsOrigin,
});
