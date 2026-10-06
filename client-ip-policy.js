'use strict';

function resolveClientIp({
  headers = {},
  remoteAddress = '',
  trustProxyHeaders = false,
  isRender = false,
  normalize,
} = {}) {
  if (typeof normalize !== 'function') throw new TypeError('normalize_required');
  const socketIp = normalize(remoteAddress) || 'N/A';
  if (!trustProxyHeaders) return socketIp;

  if (isRender) {
    // On Render the edge-owned Cloudflare header is the only proxy identity
    // accepted for security/rate-limit purposes. Caller-supplied XFF/X-Real-IP
    // are intentionally ignored.
    return normalize(headers['cf-connecting-ip']) || socketIp;
  }

  // Outside Render, trusting proxy headers is an explicit operator choice.
  // Accept only single-hop identity headers; X-Forwarded-For is deliberately
  // excluded because its chain trust is ambiguous and its left-most value may
  // be supplied by the client.
  return normalize(headers['x-real-ip']) ||
    normalize(headers['cf-connecting-ip']) ||
    socketIp;
}

module.exports = Object.freeze({ resolveClientIp });
