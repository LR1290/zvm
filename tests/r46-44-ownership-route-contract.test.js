'use strict';
// Static ownership wiring guard for the R46.44 integration. Complements the
// HTTP fixture and fake Mongo stress suite; no network or production state.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'server.js'),'utf8');
let passed=0;
function contains(text,label){assert.ok(source.includes(text),label);passed++}
function absent(text,label){assert.ok(!source.includes(text),label);passed++}
contains("const portalLicenseOwner = require('./src/portal-license-owner');",'canonical source wired');
contains("await portalLicenseOwner.register(db,",'register from atomic owner');
contains("await portalLicenseOwner.bind(db, sess.email, keycode)",'explicit link from atomic owner');
contains("await portalLicenseOwner.unbind(db, sess.email, owner.keyCode)",'CAS unlink');
contains("await portalLicenseOwner.transferEmail(db, mongoSession, sess.email, newemail,",'email transfer within session');
contains("await portalLicenseOwner.bind(db, email, keyCode)",'Cakto default adapter');
contains("portalLicenseOwner.transferEmail(db, mongoSession, sess.email, newemail,\n            (latest, target) => preparePortalUserForEmailChange(latest, sess.email, target))",'AAD-bound TOTP secrets');
absent("const alreadyLinked = await db.collection('portal_users').findOne({ keyCode: keycode",'unsafe findOne-then-write removed');
absent("await db.collection('portal_users').updateOne({ _id: sess.email }, { $set: { keyCode: keycode } })",'unsafe direct update removed');
contains("if (getPortalUser(req) !== sess || !sess.pending2fa)",'2FA promotion revalidation');
contains("const phone = normalizePhone(form.get('phone'))",'stable device reference');
contains("await mutateAdminKeyRecordStrict(user.keyCode, draft =>",'device CAS');
contains("caktoNoteHasExactMarker(note, marker)",'exact Cakto transaction marker');
assert.equal((source.match(/if \(p === '\/cliente\/vincular'\)/g)||[]).length,1,'single bind handler');passed++;
assert.equal((source.match(/if \(p === '\/cliente\/registro' && req.method === 'POST'\)/g)||[]).length,1,'single registration handler');passed++;
console.log('R46.44 central authorization HTTP wiring invariant: PASS '+passed+' checks');
