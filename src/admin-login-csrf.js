'use strict';
const crypto = require('node:crypto');

const CSRF_COOKIE = 'zv_admin_login_csrf';
const CSRF_TTL_SECONDS = 15 * 60;
const CSRF_TOKEN = /^[a-f0-9]{64}$/;

function createAdminLoginCsrf(res, adminPath) {
  if (!/^\/(?:[a-f0-9]{14}|admin)$/.test(String(adminPath || ''))) {
    throw new Error('invalid_admin_login_path');
  }
  const token = crypto.randomBytes(32).toString('hex');
  res.setHeader('Set-Cookie', `${CSRF_COOKIE}=${token}; Path=${adminPath}; Max-Age=${CSRF_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`);
  return token;
}

function canUseAdminLoginCsrfFallback(req) {
  const headers = req?.headers || {};
  const site = String(headers['sec-fetch-site'] || '').trim().toLowerCase();
  if (site && site !== 'same-origin' && site !== 'same-site' && site !== 'none') return false;
  // Never use a form token to override a known contradictory Origin/Referer.
  const origin = String(headers.origin || '').trim();
  if (origin && origin !== 'null') return false;
  if (String(headers.referer || '').trim()) return false;
  return true;
}

function verifyAdminLoginCsrf(req, submittedToken) {
  if (!canUseAdminLoginCsrfFallback(req)) return false;
  if (typeof submittedToken !== 'string' || !CSRF_TOKEN.test(submittedToken)) return false;
  const cookieHeader = String(req?.headers?.cookie || '');
  const matching = cookieHeader.split(';').map(part => part.trim()).filter(part => part.startsWith(CSRF_COOKIE + '='));
  if (matching.length !== 1) return false;
  const cookieToken = matching[0].slice(CSRF_COOKIE.length + 1);
  if (!CSRF_TOKEN.test(cookieToken)) return false;
  return crypto.timingSafeEqual(Buffer.from(submittedToken, 'hex'), Buffer.from(cookieToken, 'hex'));
}

module.exports = { createAdminLoginCsrf, canUseAdminLoginCsrfFallback, verifyAdminLoginCsrf };
