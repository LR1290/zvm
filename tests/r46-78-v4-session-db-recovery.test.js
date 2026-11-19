'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PRODUCT_AUTOMACOES, PRODUCT_LITE } = require('../src/license-product-v2');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function region(from, until) {
  const start = source.indexOf(from);
  const end = source.indexOf(until, start + from.length);
  assert.ok(start >= 0 && end > start, 'source region exists: ' + from);
  return source.slice(start, end);
}
function context(script, vars) {
  const sandbox = Object.assign({ Promise, setTimeout, clearTimeout, Date, console: {
    log() {}, warn() {}, error() {}
  } }, vars);
  vm.runInNewContext(script, sandbox, { filename: 'server-source-snippet.js', timeout: 3000 });
  return sandbox;
}
const mongoRegion = region('async function getMongoDb() {', '\n// Health check periódico');
const prelude = 'let _mongoClient = null; let _mongoDb = null; let _mongoConnectPromise = null;\n';

async function mongoTests() {
  let connects = 0, closes = 0, shouldFail = false;
  const healthyDb = { collection: () => ({}) };
  class Client {
    async connect() {
      connects++;
      await new Promise(resolve => setTimeout(resolve, 12));
      if (shouldFail) throw new Error('MongoServerSelectionError: timed out');
    }
    db() { return healthyDb; }
    async close() { closes++; }
  }
  const s = context(prelude + mongoRegion +
    '\nglobalThis.invoke = getMongoDb; globalThis.invalidate = zvmInvalidateMongoOnNetworkError;\n' +
    'globalThis.getDb = () => _mongoDb;', {
    MongoClient: Client, MONGODB_URI: 'mongodb+srv://example.invalid', MONGODB_DB: 'fake'
  });
  const same = await Promise.all(Array.from({length:30}, () => s.invoke()));
  assert.equal(connects, 1, '30 simultaneous callers share one Mongo connection');
  assert.ok(same.every(v => v === healthyDb));
  assert.equal(s.invalidate(new Error('invalid_credentials'), healthyDb), false);
  assert.equal(s.getDb(), healthyDb, 'credential rejection never clears DB');
  assert.equal(s.invalidate(new Error('connection timed out'), { fake:true }), false);
  assert.equal(s.getDb(), healthyDb, 'stale failure cannot close newer pool');
  assert.equal(s.invalidate(new Error('connection timed out'), healthyDb), true);
  assert.equal(s.getDb(), null);
  shouldFail = true;
  const broken = await Promise.allSettled(Array.from({length:20}, () => s.invoke()));
  assert.equal(connects, 2, '20 concurrent failed calls share a single attempt');
  assert.ok(broken.every(v => v.status === 'rejected'));
  shouldFail = false;
  assert.equal(await s.invoke(), healthyDb, 'later retry reconnects');
  assert.equal(connects, 3);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(closes >= 2, 'stale and failed clients are closed');
}

async function securityTests() {
  const replayCode = region('async function zvmSecurityConsumeRequestIdSharedImpl(', '\nconst ZVM_BUILD_AUTHORITY = ');
  let timeout = null, count = 0, invalidations = 0, err = null;
  const db = { collection(name) {
    assert.equal(name, 'extension_security_replay');
    return {async insertOne(doc,opts) {
      assert.ok(doc._id);
      timeout = opts.timeoutMS;
      count++;
      if (err) throw err;
    }};
  }};
  const s = context('const ZVM_SECURITY_REQUEST_TTL_MS = 20000;\n' +
    'const ZVM_EXTENSION_AUTH_DB_TIMEOUT_MS = 3200;\n' +
    'function zvmInvalidateMongoOnNetworkError() { globalThis.invalidations++; }\n' +
    replayCode + '\nglobalThis.replay = zvmSecurityConsumeRequestIdSharedImpl;', {
    invalidations, safeScalar: (x) => String(x),
  });
  assert.equal((await s.replay('id-1',Date.now(),{db})).ok,true);
  assert.equal(timeout, 3200, 'anti-replay has a bounded MongoDB timeout');
  err = Object.assign(new Error('duplicate'),{code:11000});
  assert.equal((await s.replay('id-1',Date.now(),{db})).code,'SECURITY_REPLAY_REJECTED');
  err = new Error('connection timed out');
  assert.equal((await s.replay('id-2',Date.now(),{db})).code,'SECURITY_REPLAY_UNAVAILABLE');
  assert.equal(s.invalidations, 1, 'database failure invalidates pool');
  assert.equal(count, 3);
}

async function indexTests() {
  const indexCode = region('async function ensureExtensionSessionIndexes(db) {', '\nfunction publicExtensionSession(');
  let creates=0, fail=false;
  const db = { collection(name) {
    assert.equal(name,'extension_sessions');
    return { async createIndex(spec,opts) {
      creates++;
      assert.equal(opts.timeoutMS,3200);
      await Promise.resolve();
      if (fail) { fail=false; throw Error('Mongo index unavailable'); }
    }};
  }};
  const runtime=context('const EXTENSION_SESSION_COLLECTION="extension_sessions";\n' +
    'const ZVM_EXTENSION_AUTH_DB_TIMEOUT_MS=3200;\n' +
    'const _extensionSessionIndexedDbs=new WeakSet();\n' +
    'const _extensionSessionIndexPending=new WeakMap();\n' +
    indexCode + '\nglobalThis.ensure = ensureExtensionSessionIndexes;');
  await Promise.all(Array.from({length:25},()=>runtime.ensure(db)));
  assert.equal(creates,2,'25 logins create only 2 indexes, once each');
  await runtime.ensure(db);
  assert.equal(creates,2,'indexes memoized after success');
  const second = { collection:db.collection };
  fail=true;
  await assert.rejects(runtime.ensure(second));
  await runtime.ensure(second);
  assert.equal(creates,5,'failed setup is retried, not cached as success');
}

async function loginTests() {
  const loginCode = region('async function authenticateExtensionAccount(', '\nasync function authorizeExtensionKeySession(');
  let capturedTimeout = null, user = { _id: 'test@example.invalid' }, passwordValid = true, totpValid = true;
  let hasMfa = false;
  const db = { collection(name) {
    assert.equal(name,'portal_users');
    return { async findOne(query, opts) {
      assert.equal(query._id,'test@example.invalid');
      capturedTimeout=opts.timeoutMS;
      return user;
    }};
  }};
  const s = context(
    'const ZVM_EXTENSION_AUTH_DB_TIMEOUT_MS = 3200;\n' +
    'function extensionAuthFailure(errorCode,status,extra) { return {ok:false,errorCode,status,...extra}; }\n' +
    loginCode + '\nglobalThis.login = authenticateExtensionAccount;', {
    PRODUCT_AUTOMACOES, PRODUCT_LITE,
    getMongoDb: async()=>db,
    verifyPortalPassword: async()=>passwordValid,
    portalTotpHasSecret: ()=>hasMfa,
    portalTotpReadSecret: ()=>'test-secret',
    verifyTOTP: ()=>totpValid,
    maybeRehashPortalPassword: async()=>{},
    extensionSubject:(_type,_email,productId)=>({type:'account',id:productId}),
    resolveExtensionAccountEntitlement: async()=>({
      ok:true,keyCode:null,devAccess:false,entitlement:{tier:'free'}
    })
  });
  const input = {email:'test@example.invalid',password:'safe-test-password'};
  const defaultLogin = await s.login(input,{db});
  assert.equal(defaultLogin.ok,true);
  assert.equal(defaultLogin.subject.id,PRODUCT_AUTOMACOES,'unmarked legacy account login defaults to the complete product');
  const liteLogin = await s.login(input,{db,expectedProductId:PRODUCT_LITE});
  assert.equal(liteLogin.ok,true,'isolated fixture preserves caller-specified product');
  assert.equal(liteLogin.subject.id,PRODUCT_LITE,'LITE account subject does not inherit full-product namespace');
  assert.equal(capturedTimeout,3200,'account read cannot hang for 30 seconds');
  passwordValid=false;
  assert.equal((await s.login(input,{db})).errorCode,'invalid_credentials');
  passwordValid=true; hasMfa=true;
  assert.equal((await s.login(input,{db})).errorCode,'mfa_required');
  totpValid=false;
  assert.equal((await s.login({...input,totpCode:'123456'},{db})).errorCode,'invalid_totp');
  totpValid=true;
  assert.equal((await s.login({...input,totpCode:'123456'},{db})).ok,true);
  user=null;
  assert.equal((await s.login(input,{db})).errorCode,'invalid_credentials');
}

(async function main() {
  await mongoTests();
  await securityTests();
  await indexTests();
  await loginTests();
  console.log('R46.78: Mongo reconnect, replay, password and 2FA passed');
})().catch(error => { console.error(error); process.exitCode=1; });
