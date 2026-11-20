'use strict';
// R105: real server function extraction. No production database or personal data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
function part(from,to){
 const i=server.indexOf(from),j=server.indexOf(to,i+from.length);
 assert(i>=0&&j>i,'R105 real source boundaries: '+from);
 return server.slice(i,j);
}
const real=[
 part('async function readExtensionSession(', 'async function revokeExtensionSession('),
 part('function extensionAccountAbsoluteExpiryMs(', '// A Chrome Web Store update')
].join('\n');
const clock=new Date('2026-11-19T19:00:00.000Z');
const day=24*60*60*1000;
let checks=0;
const pass=(condition,msg)=>{assert.ok(condition,msg);checks++;};
function run(doc){
 let reads=0;
 const sandbox={
  EXTENSION_SESSION_COLLECTION:'extension_sessions',
  EXTENSION_ACCOUNT_SESSION_IDLE_TTL_MS:7*day,
  EXTENSION_ACCOUNT_SESSION_ABSOLUTE_TTL_MS:30*day,
  extensionNow:()=>clock,
  hashExtensionSessionToken:()=> 'hashed-token',
  getMongoDb:async()=>{throw Error('mock must supply db')},
  Number,Date,Math,Promise,Object,
 };
 vm.runInNewContext(real,sandbox,{filename:'zvm-r105-real-server.js',timeout:5000});
 const db={collection(name){
  assert.equal(name,'extension_sessions');
  return {findOne:async({ _id })=>{assert.equal(_id,'hashed-token');reads++;return doc;}};
 }};
 return {methods:sandbox,db,get reads(){return reads}};
}
const valid={
 _id:'hashed-token',subject:{type:'account',id:'synthetic'},authMethod:'password',
 signedDev:false,createdAt:new Date(+clock-2*day),
 expiresAt:new Date(+clock+3*day),revokedAt:null
};
async function read(doc) {
 const f=run(doc);
 const r=await f.methods.readExtensionSession('a'.repeat(64),{db:f.db,now:clock});
 pass(f.reads===1,'read exactly once without external I/O');
 return r;
}
(async()=>{
 pass((await read(valid)).ok,'valid account continues');
 const old={...valid,createdAt:new Date(+clock-31*day),expiresAt:new Date(+clock+5*day)};
 pass((await read(old)).errorCode==='session_expired','expired legacy account denied despite future idle expiry');
 const near={...valid,createdAt:new Date(+clock-29*day),expiresAt:new Date(+clock+15*day)};
 const n=run(near);
 const renewal=n.methods.extensionRenewedAccountExpiry(near,clock);
 pass(+renewal===+near.createdAt+30*day,'old overlong expiresAt clipped to 30 day cap');
 pass((await read(near)).ok,'near-expiry account can renew for remaining day');
 const forged={...valid,absoluteExpiresAt:new Date(+clock+70*day),expiresAt:new Date(+clock+50*day)};
 const clipped=run(forged).methods.extensionRenewedAccountExpiry(forged,clock);
 pass(+clipped===+valid.createdAt+30*day,'forged recorded absolute cannot extend original 30d cap');
 const expiredForged={...old,absoluteExpiresAt:new Date(+clock+70*day)};
 pass((await read(expiredForged)).errorCode==='session_expired',
  'forged absolute cannot revive an older-than-30d session');
 const reduced={...valid,absoluteExpiresAt:new Date(+clock+1*day),expiresAt:new Date(+clock+5*day)};
 const reducedExpiry=run(reduced).methods.extensionRenewedAccountExpiry(reduced,clock);
 pass(+reducedExpiry===+clock+day,'strict earlier recorded absolute respected');
 const tooOld={...valid,createdAt:new Date(+clock-5*day),absoluteExpiresAt:new Date(+clock-day)};
 pass((await read(tooOld)).errorCode==='session_expired','earlier absolute deny');
 pass(run(tooOld).methods.extensionRenewedAccountExpiry(tooOld,clock)===null,
  'earlier absolute does not renew');
 const malformed=[undefined,'not-a-date',null,Number.NaN];
 for(const value of malformed) {
  const bad={...valid,expiresAt:value};
  pass((await read(bad)).errorCode==='session_expired','invalid idle expiry denies token read');
 }
 for(const value of [undefined,'invalid']){
  const bad={...valid,createdAt:value};
  pass((await read(bad)).errorCode==='session_expired','missing creation date denies account session');
 }
 pass((await read({...valid,absoluteExpiresAt:'nonsense'})).errorCode==='session_expired',
  'invalid absolute deadline denies token read');
 const key={...old,authMethod:'license_key'};
 pass((await read(key)).ok,'existing key sessions unchanged by account-only cap');
 pass(+run(key).methods.extensionRenewedAccountExpiry(key,clock)===+key.expiresAt,
  'key renewal remains unchanged');
 const dev={...old,signedDev:true};
 pass((await read(dev)).ok,'signed development session retains its own policy');
 pass(+run(dev).methods.extensionRenewedAccountExpiry(dev,clock)===+dev.expiresAt,
  'signed development renewal unchanged');
 pass((await read({...valid,revokedAt:new Date(clock)})).errorCode==='session_revoked',
  'logout revocation still wins');
 console.log('R105 V4 account lifetime hard-cap PASS: '+checks+' tests');
})().catch(e=>{console.error(e);process.exitCode=1;});
