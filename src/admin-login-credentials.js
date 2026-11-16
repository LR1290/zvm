'use strict';
const crypto = require('node:crypto');

// Only the administrator identifier is normalized for mobile keyboard and
// password-manager compatibility. Passwords remain exact, byte-for-byte.
function normalizeAdminIdentifier(value) {
  return String(value == null ? '' : value).normalize('NFC').trim().toLowerCase();
}

function checkAdminLoginCredentials({ user, pass, expectedUser, expectedHash, salt }) {
  const normalizedUser = normalizeAdminIdentifier(user);
  const normalizedExpected = normalizeAdminIdentifier(expectedUser);
  const provided = Buffer.from(normalizedUser, 'utf8');
  const expected = Buffer.from(normalizedExpected, 'utf8');
  const userMatches = provided.length > 0 && expected.length > 0 &&
    provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
  let passMatches = false;
  let derivationFailed = false;
  try {
    if (typeof pass === 'string' && Buffer.isBuffer(expectedHash) && Buffer.isBuffer(salt)) {
      const submittedHash = crypto.scryptSync(pass, salt, expectedHash.length, { N: 16384, r: 8, p: 1 });
      passMatches = crypto.timingSafeEqual(submittedHash, expectedHash);
    }
  } catch (_) {
    derivationFailed = true;
  }
  return {
    accepted: userMatches && passMatches,
    userMatches,
    passMatches,
    derivationFailed,
  };
}

module.exports = { normalizeAdminIdentifier, checkAdminLoginCredentials };
