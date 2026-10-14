'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readPortalToken, portalTokenHash, portalSessionLive, activatePortalSession, isPortalSessionCurrent, revokePortalSessionInDb } =
  require('../src/portal-session-authority');
const t1='a'.repeat(64), t2='b'.repeat(64);
function mockDb() {
  const rows = new Map([['a@example.test', {_id:'a@example.test'}]]);
  const col = {
    async findOne(filter) { const row=rows.get(filter._id); return row && Object.entries(filter).every(([k,v])=>row[k]===v) ? {...row} : null; },
    async updateOne(filter, changes) {
      const row=rows.get(filter._id);
      if (!row || !Object.entries(filter).every(([k,v])=>row[k]===v)) return {matchedCount:0};
      Object.assign(row, changes.$set || {});
      for(const k of Object.keys(changes.$unset||{})) delete row[k];
      return {matchedCount:1};
    }
  };
  return {collection: name => {assert.equal(name,'portal_users');return col;}, rows};
}
(async()=>{
  const db=mockDb();
  assert.equal(readPortalToken({headers:{cookie:'x=1; zv_portal='+t1+'; y=2'}}),t1);
  assert.equal(readPortalToken({headers:{cookie:'zv_portal='+t1+'; zv_portal='+t2}}),'','duplicated cookie rejected');
  assert.equal(readPortalToken({headers:{cookie:'zv_portal=notvalid'}}),'');
  assert.equal(readPortalToken({headers:{}}),'');
  assert.notEqual(portalTokenHash(t1),t1,'Mongo never receives raw session cookie');
  assert(!portalSessionLive({expiresAt:new Date(Date.now()-1e3).toISOString()}));
  assert(portalSessionLive({expiresAt:new Date(Date.now()+1e3).toISOString()}));
  assert(!portalSessionLive({expiresAt:'invalid'}));
  await activatePortalSession(db,'a@example.test',t1);
  assert(await isPortalSessionCurrent(db,'a@example.test',t1));
  await activatePortalSession(db,'a@example.test',t2);
  assert(!(await isPortalSessionCurrent(db,'a@example.test',t1)),'second login revokes first across workers');
  assert(await isPortalSessionCurrent(db,'a@example.test',t2));
  await revokePortalSessionInDb(db,'a@example.test',t1);
  assert(await isPortalSessionCurrent(db,'a@example.test',t2),'old logout cannot revoke new session');
  await revokePortalSessionInDb(db,'a@example.test',t2);
  assert(!(await isPortalSessionCurrent(db,'a@example.test',t2)));
  await assert.rejects(activatePortalSession(db,'missing@example.test',t1));
  const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  for(const marker of ['activatePortalSession(db, email, token)','isPortalSessionCurrent(db, active.email, rawToken)','const newToken = generateToken();','portalSessionLive(s)','portalActiveSessionHash: portalTokenHash(token)','revokePortalSessionInDb(db, sess.email, token)']){
    assert(server.includes(marker),'missing session authority integration: '+marker);
  }
  console.log('R46.75 Portal single active session/2FA expiry/token rotation/conditional logout: PASS');
})().catch(e=>{console.error(e); process.exitCode=1;});
