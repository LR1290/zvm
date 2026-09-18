'use strict';

const EXTENSION_ID_RE = /^[a-p]{32}$/;

function parseChromeExtensionOrigin(origin) {
  if (!origin) return null;
  try {
    const u = new URL(String(origin));
    if (u.protocol !== 'chrome-extension:') return null;
    if (u.username || u.password || u.port) return null;
    const id = String(u.hostname || '').toLowerCase();
    if (!EXTENSION_ID_RE.test(id)) return null;
    return Object.freeze({ id, origin: `chrome-extension://${id}` });
  } catch (_) {
    return null;
  }
}

function isLegacyV3UnpackedCompatPath(pathname, extensionRoot = '/extension') {
  const root = String(extensionRoot || '/extension').replace(/\/$/, '');
  return pathname === `${root}/v3/key` || pathname === `${root}/v3/check-status`;
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
  const listed = ids.size === 0 || ids.has(parsed.id);
  if (listed) return parsed.origin;

  const legacyUnpackedCompat = legacyV3Allow === true &&
    isLegacyV3UnpackedCompatPath(String(pathname || ''), extensionRoot);

  return legacyUnpackedCompat ? parsed.origin : null;
}

module.exports = Object.freeze({
  EXTENSION_ID_RE,
  parseChromeExtensionOrigin,
  isLegacyV3UnpackedCompatPath,
  resolveExtensionCorsOrigin,
});
