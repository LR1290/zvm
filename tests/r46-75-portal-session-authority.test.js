'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readPortalToken, portalTokenHash, portalSessionLive, activatePortalSession, isPortalSessionCurrent, revokePortalSessionInDb } =
  require('../src/portal-session-authority');

const firstToken = 'a'.repeat(64), secondToken = 'b'.repeat(64);
const firstPasswordHash = '1'.repeat(128), newPasswordHash = '2'.repeat(128);
function mockDb() {
  const rows = new Map([['a@example.test', { _id:'a@example.test', passwordHash:firstPasswordHash }]]);
  const col = {
    async findOne(filter) {
      const row = rows.get(filter._id);
      return row && Object.entries(filter).every(([k,v])=>row[k]===v) ? {...row} : null;
    },
    async updateOne(filter, changes) {
      const row=rows.get(filter._id);
      if (!row || Object.entries(filter).some(([k,v])=>row[k]!==v)) return { matchedCount:0 };
      Object.assign(row, changes.$set || {});
      for (const k of Object.keys(changes.$unset||{})) delete row[k];
      return { matchedCount:1 };
    }
  };
  return { collection:name => { assert.equal(name,'portal_users'); return col; }, rows };
}

(async()=>{
  assert.equal(readPortalToken({headers:{cookie:'x=1; zv_portal='+firstToken+'; y=2'}}),firstToken);
  assert.equal(readPortalToken({headers:{cookie:'zv_portal='+firstToken+'; zv_portal='+secondToken}}),'');
  assert.equal(readPortalToken({headers:{cookie:'zv_portal=invalid'}}),'');
  assert.equal(readPortalToken({headers:{}}),'');
  assert.notEqual(portalTokenHash(firstToken),firstToken);
  assert.notEqual(portalTokenHash(firstToken),portalTokenHash(secondToken));
  assert(!portalSessionLive({expiresAt:new Date(Date.now()-1000).toISOString()}));
  assert(portalSessionLive({expiresAt:new Date(Date.now()+1000).toISOString()}));
  assert(!portalSessionLive({expiresAt:'invalid'}));
  assert(!portalSessionLive({pending2fa:true,expiresAt:new Date(Date.now()-1000).toISOString()}));
  const db=mockDb();
  await assert.rejects(activatePortalSession(db,'a@example.test',firstToken),/portal_auth_proof_required/);
  await activatePortalSession(db,'a@example.test',firstToken,firstPasswordHash);
  assert(await isPortalSessionCurrent(db,'a@example.test',firstToken));
  await activatePortalSession(db,'a@example.test',secondToken,firstPasswordHash);
  assert(!(await isPortalSessionCurrent(db,'a@example.test',firstToken)),'second device revokes earlier token');
  assert(await isPortalSessionCurrent(db,'a@example.test',secondToken));
  await revokePortalSessionInDb(db,'a@example.test',firstToken);
  assert(await isPortalSessionCurrent(db,'a@example.test',secondToken),'old logout cannot revoke latest session');
  // The slow login MUST fail if credentials change between password verification
  // and session activation. This is an atomic MongoDB match on passwordHash.
  db.rows.get('a@example.test').passwordHash = newPasswordHash;
  await assert.rejects(activatePortalSession(db,'a@example.test',firstToken,firstPasswordHash),/portal_credential_changed_or_user_missing/);
  assert(await isPortalSessionCurrent(db,'a@example.test',secondToken),'stale login must not replace latest token');
  await revokePortalSessionInDb(db,'a@example.test',secondToken);
  assert(!(await isPortalSessionCurrent(db,'a@example.test',secondToken)));
  await assert.rejects(activatePortalSession(db,'unknown@example.test',firstToken,firstPasswordHash));
  const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  for (const marker of [
    'activatePortalSession(db, email, token, verifiedUser.passwordHash)',
    'activatePortalSession(db, sess.email, newToken, sess.authPasswordHash)',
    'isPortalSessionCurrent(db, active.email, rawToken)',
    'portalSessionLive(s)',
    'portalActiveSessionHash: portalTokenHash(token)',
    'revokePortalSessionInDb(db, sess.email, token)',
    'user.passwordHash !== sess.authPasswordHash',
    'await maybeRehashPortalPassword(db, email, pass, user)',
    '{ _id: email, passwordHash: user.passwordHash }',
    'portalActiveSessionHash: portalTokenHash(newToken)',
    'req.zvmPortalSessionRevoked = true'
  ]) {
    assert(server.includes(marker),'missing R46.75 route integration: '+marker);
  }
  assert(!server.includes('if (m) portalSessions[m[1]] = { email: sess.email'),'2FA must never reuse the pending cookie');
  console.log('R46.75: two device single-session, 2FA token rotation/expiry, password reset race, conditional logout, stale-cookie UX PASS');
})().catch(error=>{console.error(error); process.exitCode=1;});
