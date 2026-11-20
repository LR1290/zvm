'use strict';
// R106: actual MongoDB 8 transactions with synthetic ZVM V4 sessions.
// CI-only ephemeral localhost. No real users, cookies, tokens, Atlas or Render.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {MongoClient}=require('mongodb');
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
function extract(start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert(a>=0&&b>a,'server function boundaries must be present');
  return source.slice(a,b);
}
const realCode=[
  extract('async function readExtensionSession(','function getExtensionBearerToken('),
  extract('function extensionAccountAbsoluteExpiryMs(','// Reset tokens atuais')
].join('\n');
const URI='mongodb://127.0.0.1:27020';
const SESSION_TOKEN='a'.repeat(64),TOKEN_HASH='r106-synthetic-hash';
const NOW=new Date('2026-11-19T20:00:00.000Z'),DAY=86400000;
let passed=0;
function ok(condition,label){assert.ok(condition,label);passed++;}
function createRuntime(db,resolveEntitlement){
  const context={Date,Math,Number,Promise,Object,String,Array,RegExp,Error,
    EXTENSION_SESSION_COLLECTION:'extension_sessions',
    EXTENSION_ACCOUNT_SESSION_IDLE_TTL_MS:7*DAY,
    EXTENSION_ACCOUNT_SESSION_ABSOLUTE_TTL_MS:30*DAY,
    ZVM_EXTENSION_AUTH_DB_TIMEOUT_MS:3200,
    extensionNow:deps=>deps.now||NOW,
    hashExtensionSessionToken:()=>TOKEN_HASH,
    getMongoDb:async()=>db,
    zvmSecurityStoredSessionDecision:()=>({ok:true}),
    zvmSecurityClientErrorStatus:()=>403,
    extensionAuthFailure:(errorCode,status,extra={})=>({ok:false,errorCode,status,...extra}),
    resolveExtensionAccountEntitlement:resolveEntitlement||
      (async()=>({ok:true,keyCode:null,devAccess:false,
        entitlement:{tier:'free',entitlementRevision:'r106-1'}})),
    crypto:require('node:crypto')
  };
  vm.runInNewContext(realCode,context,{filename:'zvm-r106-real-server-extract.js',timeout:5000});
  return context;
}
function fixture({createdDaysAgo=2,expiresDaysFromNow=3,absoluteDaysFromCreated,
  authMethod='password',signedDev=false}={}){
  const createdAt=new Date(+NOW-createdDaysAgo*DAY);
  return {_id:TOKEN_HASH,sessionId:'r106-fake',authMethod,signedDev,
    accountEmail:'synthetic@example.invalid',subject:{type:'account',id:'synthetic'},
    createdAt,expiresAt:new Date(+NOW+expiresDaysFromNow*DAY),revokedAt:null,
    ...(absoluteDaysFromCreated===undefined?{}:{absoluteExpiresAt:
      new Date(+createdAt+absoluteDaysFromCreated*DAY)})};
}
async function main(){
  if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||
    process.env.ZVM_R106_EPHEMERAL_ACK!=='private-mongo-only'||
    process.env.MONGODB_URI||process.env.ZVM_QA_MONGODB_URI)
    throw Error('R106 refuses to connect outside isolated CI');
  const client=new MongoClient(URI,{maxPoolSize:3,serverSelectionTimeoutMS:12000});
  await client.connect();
  const db=client.db('zvm_r106_v4_test');
  try{
    const seen=(await client.db('admin').admin().listDatabases({nameOnly:true})).databases;
    ok(!seen.some(row=>row.name==='zvm_r106_v4_test'),'lab namespace initially absent');
    await db.createCollection('extension_sessions');
    await db.createCollection('portal_users');
    await db.collection('portal_users').insertOne({_id:'synthetic@example.invalid'});
    const sessions=db.collection('extension_sessions');
    const ctx=createRuntime(db);
    async function seed(doc){await sessions.deleteMany({});await sessions.insertOne(doc);}
    async function read(){return ctx.readExtensionSession(SESSION_TOKEN,{db,now:NOW});}
    async function refresh(){return ctx.refreshExtensionSession(SESSION_TOKEN,{db,now:NOW});}

    await seed(fixture());
    ok((await read()).ok,'recent valid session accepted by real MongoDB read');
    let result=await refresh();
    ok(result.ok===true,'real MongoDB renewal works');
    let saved=await sessions.findOne({_id:TOKEN_HASH});
    ok(+saved.expiresAt===+NOW+7*DAY,'7-day idle renewal persisted as BSON Date');

    await seed(fixture({createdDaysAgo:29,expiresDaysFromNow:15}));
    ok((await read()).ok,'late account still valid until 30-day cap');
    result=await refresh();
    ok(result.ok===true,'late session refresh granted only remaining day');
    saved=await sessions.findOne({_id:TOKEN_HASH});
    ok(+saved.expiresAt===+NOW+DAY,'overlong expiry clamped to absolute cutoff in DB');

    await seed(fixture({createdDaysAgo:31,expiresDaysFromNow:8}));
    ok((await read()).errorCode==='session_expired','old session rejected before MongoDB update');
    result=await refresh();
    ok(!result.ok&&result.errorCode==='session_expired','old session refresh returns 401');
    saved=await sessions.findOne({_id:TOKEN_HASH});
    ok(+saved.expiresAt===+NOW+8*DAY,'denied session not silently renewed');

    await seed(fixture({createdDaysAgo:29,expiresDaysFromNow:12,absoluteDaysFromCreated:120}));
    result=await refresh();
    ok(result.ok,'forged extended cutoff cannot block legitimate early refresh');
    saved=await sessions.findOne({_id:TOKEN_HASH});
    ok(+saved.expiresAt===+NOW+DAY,'forged absolute cutoff capped to original creation+30d');

    await seed({...fixture(),expiresAt:'corrupt-date'});
    ok((await read()).errorCode==='session_expired','malformed MongoDB date fails closed');
    await seed({...fixture(),createdAt:'corrupt-date'});
    ok((await read()).errorCode==='session_expired','malformed original creation fails closed');
    await seed(fixture({authMethod:'license_key',createdDaysAgo:40}));
    ok((await read()).ok,'commercial key session retains independent TTL');
    await seed(fixture({signedDev:true,createdDaysAgo:40}));
    ok((await read()).ok,'signed DEV session retains independent TTL');

    // Read/refresh race with logout: pause after reading valid token, revoke
    // in a second operation, and confirm stale renewal cannot commit.
    await seed(fixture());
    let releaseLookup,signalLookup;
    const paused=new Promise(resolve=>{signalLookup=resolve;});
    const blocker=new Promise(resolve=>{releaseLookup=resolve;});
    const racing=createRuntime(db,async()=>{
      signalLookup();await blocker;
      return {ok:true,keyCode:null,devAccess:false,
        entitlement:{tier:'free',entitlementRevision:'r106-race'}};
    });
    const inFlight=racing.refreshExtensionSession(SESSION_TOKEN,{db,now:NOW});
    await paused;
    const revoked=await ctx.revokeExtensionSession(SESSION_TOKEN,{db,now:NOW});
    ok(revoked.revoked===true,'real MongoDB revokes token during refresh');
    releaseLookup();
    const raceResult=await inFlight;
    ok(!raceResult.ok&&raceResult.errorCode==='session_revoked',
      'CAS race prevents successful refresh after logout');
    saved=await sessions.findOne({_id:TOKEN_HASH});
    ok(saved.revokedAt instanceof Date,'revocation persisted as BSON date');
    ok(+saved.expiresAt===+NOW+3*DAY,'revoked session expiry not extended');
    ok((await read()).errorCode==='session_revoked','later reads deny revoked token');
    console.log('R106 V4 MongoDB 8 real session+logout race PASS: '+passed+' controls');
  }finally{
    await db.dropDatabase();
    const names=(await client.db('admin').admin().listDatabases({nameOnly:true})).databases;
    assert(!names.some(x=>x.name==='zvm_r106_v4_test'),'test data removed');
    await client.close();
  }
}
main().catch(error=>{
  console.error('R106_V4_MONGO_FAILED:',String(error.code||error.message||'unknown').slice(0,180));
  process.exitCode=1;
});
