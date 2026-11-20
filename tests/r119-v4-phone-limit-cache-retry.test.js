'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const a = source.indexOf('async function authorizeExtensionKeySession(');
const b = source.indexOf('\nasync function refreshExtensionSession(', a);
assert(a > 0 && b > a, 'V4 key authorization region exists');
const section = source.slice(a, b);
function makeRunner(record, claim) {
  const store = Object.create(null);
  store['zv-synthetic-key'] = record;
  const sandbox = {
    MAX_USES: 3,
    MAX_PHONES_GLOBAL: 50,
    Date, Promise,
    isFreeAuthKey: value => String(value||'').toLowerCase()==='free',
    sanitizeId: value => String(value || ''),
    normalizePhone: value => String(value || '').replace(/\D/g, ''),
    safeScalar: value => String(value || ''),
    keys: store,
    extensionNow: () => Date.now(),
    extensionAuthFailure: (errorCode, status, extra={}) => ({ok:false,errorCode,status,...extra}),
    extensionLicenseIsUsable: x => !!x && x.active === true && x.expiresAt > Date.now(),
    extensionDevAccessAllowed: () => true,
    extensionSubject: () => ({id:'synthetic'}),
    buildExtensionEntitlement: ({keyRecord}) => ({tier:'paid',accessLimit:keyRecord.maxUses}),
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(section + '\nglobalThis.auth = authorizeExtensionKeySession;', context, {timeout:1500});
  let calls = 0;
  const deps = {
    keyStore:store,
    ensureKeyLoadedEx:async()=>({found:true,dbError:false}),
    claimPhoneSlot:async (...args)=> { calls++;return claim({record,args,store,calls}); },
  };
  return {
    auth: phone => context.auth({authKey:'zv-synthetic-key',phoneNumber:phone,deviceId:'fake-device-id'}, deps),
    calls:()=>calls,
  };
}
(async () => {
  const exp=Date.now()+86400000;
  let r={active:true,expiresAt:exp,maxUses:3,phones:['55110001','55110002','55110003']};
  let t=makeRunner(r,({calls}) => {
    if(calls===1){r.maxUses=4;return {status:'limit_reached'};}
    r.phones.push('55110004');return {status:'claimed'};
  });
  assert.equal((await t.auth('55110004')).ok,true,'increased limit retried once');
  assert.equal(t.calls(),2,'one extra atomic claim only');
  r={active:true,expiresAt:exp,maxUses:3,phones:['55110001','55110002','55110003']};
  t=makeRunner(r,()=>({status:'limit_reached'}));
  const denied=await t.auth('55110004');
  assert.equal(denied.errorCode,'phone_limit','unchanged plan limit is enforced');
  assert.equal(t.calls(),1);
  r={active:true,expiresAt:exp,maxUses:3,phones:['55110001','55110002','55110003']};
  t=makeRunner(r,()=>{r.maxUses=4;r.active=false;return {status:'limit_reached'};});
  assert.equal((await t.auth('55110004')).ok,false,'revoked key cannot retry');
  assert.equal(t.calls(),1);
  r={active:true,expiresAt:exp,maxUses:3,phones:['55110001','55110002','55110003']};
  t=makeRunner(r,()=>{r.maxUses=4;r.expiresAt=Date.now()-1000;return {status:'limit_reached'};});
  assert.equal((await t.auth('55110004')).ok,false,'expired key cannot retry');
  assert.equal(t.calls(),1);
  r={active:true,expiresAt:exp,maxUses:3,phones:['55110001','55110002','55110003']};
  t=makeRunner(r,({calls})=>{if(calls===1){r.maxUses=-1;return {status:'limit_reached'};}return {status:'claimed'};});
  assert.equal((await t.auth('55110004')).ok,true,'admin-authorized unlimited policy is honored');
  assert.equal(t.calls(),2);
  r={active:true,expiresAt:exp,maxUses:3,phones:['55110001','55110002','55110003']};
  t=makeRunner(r,()=>({status:'already_member'}));
  assert.equal((await t.auth('55110001')).ok,true,'relogin of an existing phone allowed at limit');
  assert.equal(t.calls(),1);
  r={active:true,expiresAt:exp,maxUses:4,phones:['55110001','55110002','55110003','55110004']};
  t=makeRunner(r,()=>({status:'limit_reached'}));
  assert.equal((await t.auth('55110005')).errorCode,'phone_limit','expanded but full license still denied');
  assert.equal(t.calls(),1);
  r={active:true,expiresAt:exp,maxUses:3,phones:['55110001','55110002','55110003']};
  t=makeRunner(r,()=>{r.maxUses=4;r.phones.push('55110004');return {status:'limit_reached'};});
  assert.equal((await t.auth('55110005')).errorCode,'phone_limit','concurrent occupant wins the last slot');
  assert.equal(t.calls(),1);
  r={active:true,expiresAt:exp,maxUses:3,phones:['55110001','55110002','55110003']};
  t=makeRunner(r,()=>{r.maxUses=4;return {status:'limit_reached'};});
  assert.equal((await t.auth('55110004')).errorCode,'phone_limit','second failed atomic claim stays denied');
  assert.equal(t.calls(),2);
  console.log('R119 V4: 9 server phone-slot cases PASS; no global bypass, retry bounded.');
})().catch(err=>{console.error(err);process.exitCode=1});
