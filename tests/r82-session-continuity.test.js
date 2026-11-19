'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');

const realSource=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
function part(from,to){
  const i=realSource.indexOf(from), j=realSource.indexOf(to,i+from.length);
  assert.ok(i>=0&&j>i,'real source boundary: '+from);
  return realSource.slice(i,j);
}
const accountTtl=7*24*60*60*1000, absoluteTtl=30*24*60*60*1000, keyTtl=24*60*60*1000;
const script=[
 part('async function createExtensionSession(','async function readExtensionSession('),
 part('function extensionRenewedAccountExpiry(','// Reset tokens atuais'),
].join('\n');
const clock=new Date('2026-11-19T13:00:00.000Z');
const expiry=(ms)=>new Date(clock.getTime()+ms);

function runtime(overrides={}){
  let created=null,updated=null,match=1,revocations=0;
  const existing=overrides.doc||{
    _id:'sha256-token',sessionId:'id',subject:{type:'account',id:'user'},
    authMethod:'password',accountEmail:'synthetic@example.invalid',
    securityProtocol:1,createdAt:expiry(-23*60*60*1000),
    expiresAt:expiry(1*60*60*1000),revokedAt:null,entitlementRevision:'r0',
  };
  const db={collection(name){
    if(name==='extension_sessions')return{
      async insertOne(doc){created=doc;},
      async updateOne(query,update,options){updated={query,update,options};return{matchedCount:match};}
    };
    if(name==='portal_users')return{async findOne(){return{_id:'synthetic@example.invalid'};}};
    throw Error('unexpected collection '+name);
  }};
  const sandbox={
    crypto,Date,Promise,Math,Number,String,Object,Array,RegExp,Error,
    EXTENSION_SESSION_COLLECTION:'extension_sessions',
    EXTENSION_SESSION_TTL_MS:keyTtl,
    EXTENSION_ACCOUNT_SESSION_IDLE_TTL_MS:accountTtl,
    EXTENSION_ACCOUNT_SESSION_ABSOLUTE_TTL_MS:absoluteTtl,
    ZVM_EXTENSION_AUTH_DB_TIMEOUT_MS:3200,
    ZVM_DEV_SIGNING_CONFIG:{sessionTtlMs:12*60*60*1000},
    getMongoDb:async()=>db,
    extensionNow:deps=>new Date(deps?.now||clock),
    ensureExtensionSessionIndexes:async()=>{},
    generateToken:()=> 'a'.repeat(64),
    hashExtensionSessionToken:v=>v,
    normalizePhone:()=>null,
    safeScalar:v=>String(v),
    publicExtensionSession:(doc,token)=>({token,expiresAt:new Date(doc.expiresAt).toISOString()}),
    readExtensionSession:async()=>({ok:true,doc:existing}),
    zvmSecurityStoredSessionDecision:()=>({ok:true}),
    zvmSecurityClientErrorStatus:()=>403,
    revokeExtensionSession:async()=>{revocations++;return{ok:true};},
    extensionAuthFailure:(errorCode,status,extra={})=>({ok:false,errorCode,status,...extra}),
    resolveExtensionAccountEntitlement:async()=>({ok:true,keyCode:null,devAccess:true,entitlement:{tier:'paid',entitlementRevision:'r1'}}),
    extensionLicenseIsUsable:()=>true,
    extensionDevAccessAllowed:()=>true,
    buildExtensionEntitlement:()=>({tier:'paid',entitlementRevision:'r1'}),
    keys:{},
    ...overrides.sandbox,
  };
  vm.runInNewContext(script,sandbox,{filename:'server-v4-real-region.js',timeout:5000});
  return{
    sandbox,db,existing,
    get created(){return created;},
    get updated(){return updated;},
    get revocations(){return revocations;},
    failRace(){match=0;},
  };
}
async function testIssue(){
  const t=runtime();
  const subject={type:'account',id:'user'};
  const descriptor={subject,authMethod:'password',accountEmail:'synthetic@example.invalid',securityProtocol:1,entitlementRevision:'r1'};
  await t.sandbox.createExtensionSession(descriptor,{db:t.db,now:clock});
  assert.equal(+t.created.expiresAt-clock,accountTtl);
  assert.equal(+t.created.absoluteExpiresAt-clock,absoluteTtl);
  const k=runtime();
  await k.sandbox.createExtensionSession({...descriptor,authMethod:'license_key'}, {db:k.db,now:clock});
  assert.equal(+k.created.expiresAt-clock,keyTtl);
  assert.equal(k.created.absoluteExpiresAt,null);
  const d=runtime();
  await d.sandbox.createExtensionSession({...descriptor,signedDev:true,channel:'dev',securityProtocol:2,devAttestation:{expiresAt:expiry(2*60*60*1000).toISOString()}},{db:d.db,now:clock});
  assert.equal(+d.created.expiresAt-clock,2*60*60*1000);
  console.log('R82 account issue: 7-day idle / 30-day absolute; key and signed DEV unchanged');
}
async function testRefresh(){
  const t=runtime();
  const refreshed=await t.sandbox.refreshExtensionSession('a'.repeat(64),{
    db:t.db,now:clock,storedSessionDecision:()=>({ok:true})
  });
  assert.equal(refreshed.ok,true);
  assert.equal(+refreshed.sessionDoc.expiresAt-clock,accountTtl);
  assert.equal(+t.updated.update.$set.expiresAt-clock,accountTtl);
  assert.equal(t.updated.query.revokedAt,null);
  assert.ok(t.updated.query.expiresAt.$gt instanceof Date);
  assert.equal(t.updated.options.timeoutMS,3200);
  const legacy=runtime({doc:{...t.existing,createdAt:expiry(-29*24*60*60*1000)}});
  const older=await legacy.sandbox.refreshExtensionSession('a'.repeat(64),{db:legacy.db,now:clock,storedSessionDecision:()=>({ok:true})});
  assert.equal(+older.sessionDoc.expiresAt-clock,24*60*60*1000,'must stop at 30-day absolute cutoff');
  console.log('R82 refresh: 7 days idle, 30 days maximum incl. historical sessions');
}
async function testRevocationRace(){
  const t=runtime();t.failRace();
  const denied=await t.sandbox.refreshExtensionSession('a'.repeat(64),{db:t.db,now:clock,storedSessionDecision:()=>({ok:true})});
  assert.equal(denied.ok,false);assert.equal(denied.errorCode,'session_revoked');assert.equal(denied.status,401);
  const outside=runtime({doc:{...t.existing,createdAt:expiry(-31*24*60*60*1000)}});
  const expired=await outside.sandbox.refreshExtensionSession('a'.repeat(64),{db:outside.db,now:clock,storedSessionDecision:()=>({ok:true})});
  assert.equal(expired.errorCode,'session_expired');assert.equal(outside.revocations,1);
  console.log('R82 refresh: rejects races with logout and 30-day absolute expiry');
}
async function testOtherSessionTypes(){
  const t=runtime();
  const key={...t.existing,authMethod:'license_key',signedDev:false,expiresAt:expiry(2*60*60*1000)};
  const dev={...t.existing,authMethod:'password',signedDev:true,expiresAt:expiry(1*60*60*1000)};
  assert.equal(+t.sandbox.extensionRenewedAccountExpiry(key,clock),+key.expiresAt);
  assert.equal(+t.sandbox.extensionRenewedAccountExpiry(dev,clock),+dev.expiresAt);
  console.log('R82 does not extend key or signed development sessions');
}
(async()=>{await testIssue();await testRefresh();await testRevocationRace();await testOtherSessionTypes();})().catch(e=>{console.error(e);process.exitCode=1;});
