'use strict';
const crypto = require('node:crypto');

// One active authenticated portal session per account, scoped by Mongo _id.
// Store only a domain-separated digest of the opaque, random cookie token.
function readPortalToken(req) {
  const cookie = String(req?.headers?.cookie || '');
  const values = cookie.split(';').map(p => p.trim()).filter(p => p.startsWith('zv_portal=')).map(p => p.slice('zv_portal='.length));
  if (values.length !== 1) return '';
  return /^[a-f0-9]{64}$/.test(values[0]) ? values[0] : '';
}
function portalTokenHash(token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) throw new Error('portal_session_token_invalid');
  return crypto.createHash('sha256').update('zvm-portal-session-v1\0' + token).digest('hex');
}
function portalSessionLive(session, now = Date.now()) {
  if (!session) return false;
  const expires = Date.parse(String(session.expiresAt || ''));
  return Number.isFinite(expires) && now < expires;
}
async function activatePortalSession(db, email, token) {
  const result = await db.collection('portal_users').updateOne(
    { _id: String(email) },
    { $set: { portalActiveSessionHash: portalTokenHash(token), portalActiveSince: new Date() } }
  );
  if (result.matchedCount !== 1) throw new Error('portal_user_missing_at_session_activation');
}
async function isPortalSessionCurrent(db, email, token) {
  const found = await db.collection('portal_users').findOne(
    { _id: String(email), portalActiveSessionHash: portalTokenHash(token) },
    { projection: { _id: 1 } }
  );
  return !!found;
}
async function revokePortalSessionInDb(db, email, token) {
  return db.collection('portal_users').updateOne(
    { _id: String(email), portalActiveSessionHash: portalTokenHash(token) },
    { $unset: { portalActiveSessionHash: '', portalActiveSince: '' } }
  );
}
module.exports = { readPortalToken, portalTokenHash, portalSessionLive, activatePortalSession, isPortalSessionCurrent, revokePortalSessionInDb };
