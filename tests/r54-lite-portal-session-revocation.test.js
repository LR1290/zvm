'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { revokePortalLitePasswordSessions } = require('../src/portal-license-slots');

const server = fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const now = new Date('2026-11-18T16:00:00.000Z');

test('unlink/rebind revokes only LITE password sessions for the selected account',async()=>{
  const sessions = [
    {accountEmail:'a@example.com',extensionProductId:'zvm_lite',authMethod:'password',revokedAt:null},
    {accountEmail:'a@example.com',extensionProductId:'zvm_automacoes',authMethod:'password',revokedAt:null},
    {accountEmail:'a@example.com',extensionProductId:'zvm_lite',authMethod:'license_key',revokedAt:null},
    {accountEmail:'b@example.com',extensionProductId:'zvm_lite',authMethod:'password',revokedAt:null},
    {accountEmail:'a@example.com',extensionProductId:'zvm_lite',authMethod:'password',revokedAt:new Date(now.getTime()-1000)}
  ];
  const collections=[];
  const db={collection(name) {
    collections.push(name);
    assert.equal(name,'extension_sessions');
    return {async updateMany(query,change){
      assert.deepEqual(query,{accountEmail:'a@example.com',extensionProductId:'zvm_lite',authMethod:'password',revokedAt:null});
      assert.equal(change.$set.revokedAt.getTime(),now.getTime());
      assert.equal(change.$set.lastSeenAt.getTime(),now.getTime());
      let count=0;
      for(const s of sessions) {
        if(s.accountEmail===query.accountEmail&&s.extensionProductId===query.extensionProductId&&
          s.authMethod===query.authMethod&&s.revokedAt===null){
          Object.assign(s,change.$set);count++;
        }
      }
      return {acknowledged:true,modifiedCount:count,matchedCount:count};
    }};
  }};
  const result=await revokePortalLitePasswordSessions(db,'  A@Example.com ',{collectionName:'extension_sessions',now});
  assert.equal(result.modifiedCount,1);
  assert.equal(collections.length,1);
  assert.ok(sessions[0].revokedAt instanceof Date);
  assert.equal(sessions[1].revokedAt,null);
  assert.equal(sessions[2].revokedAt,null);
  assert.equal(sessions[3].revokedAt,null);
  assert.ok(sessions[4].revokedAt.getTime()<now.getTime());
});

test('revoke helper is fail-closed and never suppresses Mongo failures',async()=>{
  const db={collection(){return {updateMany:async()=>{throw new Error('MONGO_UNAVAILABLE');}};}};
  await assert.rejects(revokePortalLitePasswordSessions(db,'a@example.com',{collectionName:'extension_sessions'}),/MONGO_UNAVAILABLE/);
  await assert.rejects(revokePortalLitePasswordSessions(db,'bad-email',{collectionName:'extension_sessions'}),/invalid_lite_portal_revoke/);
  await assert.rejects(revokePortalLitePasswordSessions(db,'a@example.com',{collectionName:'$system'}),/invalid_lite_session_collection/);
  await assert.rejects(revokePortalLitePasswordSessions(db,'a@example.com',{collectionName:'extension_sessions',now:'not-a-date'}),/invalid_lite_revoke_time/);
});

test('portal relink and unlink invoke the real scoped revocation helper',()=>{
  const link=server.split("if (p === '/cliente/vincular')")[1]?.split("if ((p === '/cliente/desvincular'")[0];
  const unlink=server.split("if ((p === '/cliente/desvincular'")[1]?.split("if (p === '/cliente/dispositivos/remover'")[0];
  assert.ok(link && unlink);
  assert.match(link,/if \(portalSlot === 'liteKeyCode'\)[\s\S]*?revokePortalLitePasswordSessions\(db, sess\.email, \{ collectionName: EXTENSION_SESSION_COLLECTION \}\)/);
  assert.match(unlink,/if \(slot === 'liteKeyCode'\)[\s\S]*?revokePortalLitePasswordSessions\(db, sess\.email, \{ collectionName: EXTENSION_SESSION_COLLECTION \}\)/);
  assert.match(unlink,/sendJson\(res, \{ error: 'temporarily_unavailable' \}, 503\)/);
});

function refreshHarness(result,product='zvm_lite'){
  const source=server.match(/async function refreshExtensionSession\([\s\S]*?(?=\n\/\/ Reset tokens atuais)/)?.[0];
  assert.ok(source,'inspect the actual server-side V4 refresh function');
  const installationId='12345678-1234-4123-8123-123456789012';
  const doc={
    _id:'sha256-token', extensionProductId:product,authMethod:'password',
    extensionId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',extensionVersion:'0.1.42',
    buildId:'zvm-lite-dev-0.1.42-sabcabcabcabc',buildFingerprint:'b'.repeat(64),
    liteSignerKeyId:'owner-dev',installationIdHash:crypto.createHash('sha256').update(installationId).digest('hex'),
    accountEmail:'a@example.com',licenseKeyCode:'zv2l-test',revokedAt:null
  };
  const calls={revoked:0};
  const db={collection(name){assert.equal(name,'portal_users');return{findOne:async()=>({_id:'a@example.com'})};}};
  const ctx={
    extensionNow:()=>now,getMongoDb:async()=>db,readExtensionSession:async()=>({ok:true,doc}),
    ZVM_LITE_V4_CONFIG:{ready:true},PRODUCT_LITE:'zvm_lite',PRODUCT_AUTOMACOES:'zvm_automacoes',
    liteSessionAllowed:()=>true,crypto,
    revokeExtensionSession:async()=>{calls.revoked++;return {ok:true}},
    resolveExtensionAccountEntitlement:async()=>result,
    extensionAuthFailure:(errorCode,status)=>({ok:false,errorCode,status})
  };
  const fn=vm.runInNewContext('('+source+')',ctx);
  return {calls,run:()=>fn('a'.repeat(64),{db,expectedProductId:product,
    liteClientSecurity:{securityProtocol:2,extensionId:doc.extensionId,extensionVersion:doc.extensionVersion,
      buildId:doc.buildId,buildFingerprint:doc.buildFingerprint,signerKeyId:doc.liteSignerKeyId,installationId}})};
}

test('LITE refresh rejects and revokes a session after account license removal',async()=>{
  const h=refreshHarness({ok:false,errorCode:'lite_license_required',status:403});
  const denied=await h.run();
  assert.equal(denied.errorCode,'lite_license_required');
  assert.equal(h.calls.revoked,1);
});

test('LITE refresh preserves token when database outage is explicitly retryable',async()=>{
  const h=refreshHarness({ok:false,errorCode:'temporarily_unavailable',status:503,retryable:true});
  const denied=await h.run();
  assert.equal(denied.errorCode,'temporarily_unavailable');
  assert.equal(h.calls.revoked,0);
});
