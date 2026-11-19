'use strict';
// REAL MongoDB integration test. Never uses credentials, production databases,
// Render or a remote connection. The CI container is local and ephemeral.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const { generateLicenseKey, PRODUCT_LITE, PRODUCT_AUTOMACOES } = require('../src/license-product-v2');
const { readLiteLicenseSnapshot, claimLitePhoneSlotAtomic, liteKeyUsable, activateLiteDeferredKeyAtomic } = require('../src/lite-license-authority');
const { ensureLitePortalLicenseUniqueIndex, revokePortalLitePasswordSessions, revokeLiteLicenseSessions } = require('../src/portal-license-slots');

const uri=process.env.ZVM_LITE_TEST_MONGO_URI;
if (!uri || !/^mongodb:\/\/(?:127\.0\.0\.1|localhost):27017\/?(?:\?.*)?$/.test(uri)) {
  throw new Error('R57_NEEDS_LOCAL_EPHEMERAL_MONGO_ON_127_0_0_1:27017');
}
const full=generateLicenseKey(PRODUCT_AUTOMACOES);
const lite=generateLicenseKey(PRODUCT_LITE);
const second=generateLicenseKey(PRODUCT_LITE);
const deferred=generateLicenseKey(PRODUCT_LITE);
const issuedByAdmin=generateLicenseKey(PRODUCT_LITE);
const invalidZeroLimit=generateLicenseKey(PRODUCT_LITE);
const phoneA='5538999112233',phoneB='5538999112244',phoneC='5538999112255';
const base = (extras={}) => ({
  active:true,extensionProductId:PRODUCT_LITE,provisioningStatus:'issued',
  planId:'LITE_DEV',planName:'ZVM LITE',maxUses:1,
  phones:[],expiresAt:null,expireDuration:null,
  ...extras,
});

test('R57 real local MongoDB: issued key, concurrent claims, revocation and portal ownership', {timeout:60_000},async t=>{
  const client = new MongoClient(uri,{serverSelectionTimeoutMS:5000});
  await client.connect();
  const db=client.db('zvm_lite_ci_'+crypto.randomBytes(8).toString('hex'));
  t.after(async()=>{try{await db.dropDatabase();}finally{await client.close();}});
  await db.collection('store').insertOne({_id:'keys',data:{
    [lite]:base(),
    [second]:base({active:false}),
    [invalidZeroLimit]:base({maxUses:0}),
    [deferred]:base({maxUses:2,phones:[phoneC],expireDuration:3600_000}),
    [full]:{active:true,extensionProductId:PRODUCT_AUTOMACOES,phones:[],maxUses:1,planId:'ZV_PRO'},
  }});

  await t.test('actual admin server function issues a pending LITE key without overwrite, then CAS activates it',async()=>{
    const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
    const source=(name)=>{
      const begin=server.indexOf('async function '+name+'(');
      assert.ok(begin>=0,'real server function '+name);
      const end=server.indexOf('\n}\n',begin);
      assert.ok(end>begin);
      return server.slice(begin,end+2).replace(/^async function [^(]+/,'async function');
    };
    const memoryKeys={};
    let updated=0;
    const context={
      keys:memoryKeys,
      cloneKeyRecordForCommit:record=>JSON.parse(JSON.stringify(record)),
      invalidateKeysHtmlCache:()=>{updated++;},
      zvmInvalidateMongoOnNetworkError:()=>{},
      getMongoDb:async()=>db,
      setTimeout,
    };
    context.readAdminKeySnapshot=vm.runInNewContext('('+source('readAdminKeySnapshot')+')',context);
    const insert=vm.runInNewContext('('+source('insertNewAdminKeyStrict')+')',context);
    const mutate=vm.runInNewContext('('+source('mutateAdminKeyRecordStrict')+')',context);
    const pending=base({active:false,provisioningStatus:'awaiting_lite_build_authority',maxUses:2});
    const stored=await insert(issuedByAdmin,pending,{db});
    assert.equal(stored.active,false);
    assert.equal(stored.provisioningStatus,'awaiting_lite_build_authority');
    assert.equal((await readLiteLicenseSnapshot(db,issuedByAdmin)).active,false);
    await assert.rejects(insert(issuedByAdmin,pending,{db}),/admin_key_conflict_or_store_unavailable/);
    assert.equal((await readLiteLicenseSnapshot(db,issuedByAdmin)).active,false);

    // Simulate the authenticated admin's transition ONLY in this disposable DB.
    // The real HTTP route separately requires ZVM_LITE_V4_CONFIG.ready.
    assert.match(server,/if \(!k\.active && productOfKeyRecord\(k, codeToggle\) === PRODUCT_LITE && !ZVM_LITE_V4_CONFIG\.ready\)/);
    const active=await mutate(issuedByAdmin,draft=>{
      assert.equal(draft.active,false);
      draft.provisioningStatus='issued';
      draft.active=true;
    },{db});
    assert.equal(active.active,true);
    assert.equal(active.provisioningStatus,'issued');
    assert.ok(updated>=2);
    assert.equal(liteKeyUsable(await readLiteLicenseSnapshot(db,issuedByAdmin),issuedByAdmin),true);
    const claimed=await claimLitePhoneSlotAtomic(db,issuedByAdmin,phoneA,{maxPhonesGlobal:100});
    assert.equal(claimed.status,'claimed');
    assert.deepEqual((await readLiteLicenseSnapshot(db,issuedByAdmin)).phones,[phoneA]);
  });

  await t.test('only a matching LITE key is accepted from the persisted store',async()=>{
    assert.equal((await readLiteLicenseSnapshot(db,lite)).extensionProductId,PRODUCT_LITE);
    assert.equal(await readLiteLicenseSnapshot(db,full),null);
    assert.equal(await readLiteLicenseSnapshot(db,'zv2l-not-valid'),null);
    const record=await readLiteLicenseSnapshot(db,second);
    assert.equal(liteKeyUsable(record,second),false);
  });

  await t.test('invalid zero-seat LITE key never claims a phone in real MongoDB',async()=>{
    const before=await readLiteLicenseSnapshot(db,invalidZeroLimit);
    assert.equal(before.maxUses,0);
    assert.equal(liteKeyUsable(before,invalidZeroLimit),false);
    const denied=await claimLitePhoneSlotAtomic(db,invalidZeroLimit,phoneA,{maxPhonesGlobal:100});
    assert.equal(denied.status,'entitlement_revoked');
    const after=await readLiteLicenseSnapshot(db,invalidZeroLimit);
    assert.deepEqual(after,before,'invalid key must remain unchanged in persistent store');
    assert.deepEqual(after.phones,[]);
  });

  await t.test('two simultaneous first-use claims never exceed maxUses=1',async()=>{
    const statuses=await Promise.all([phoneA,phoneB].map(phone=>
      claimLitePhoneSlotAtomic(db,lite,phone,{maxPhonesGlobal:100})
    ));
    const actual=await readLiteLicenseSnapshot(db,lite);
    assert.equal(actual.phones.length,1);
    assert.equal(statuses.filter(x=>x.status==='claimed').length,1);
    assert.equal(statuses.filter(x=>x.status==='limit_reached').length,1);
    assert.deepEqual(actual.phones,[statuses.find(x=>x.status==='claimed').record.phones[0]]);
    const repeat=await claimLitePhoneSlotAtomic(db,lite,actual.phones[0],{maxPhonesGlobal:100});
    assert.equal(repeat.status,'already_member');
    assert.equal((await readLiteLicenseSnapshot(db,lite)).phones.length,1);
  });

  await t.test('LITE first-use expiry activates exactly once on a persisted phone',async()=>{
    const results=await Promise.all([
      activateLiteDeferredKeyAtomic(db,deferred,phoneC),
      activateLiteDeferredKeyAtomic(db,deferred,phoneC),
    ]);
    assert.equal(results.filter(x=>x.status==='activated').length,1);
    assert.equal(results.filter(x=>x.status==='already_active').length,1);
    const stored=await readLiteLicenseSnapshot(db,deferred);
    assert.ok(stored.expiresAt);
    assert.ok(stored.activatedAt);
    const duration=Date.parse(stored.expiresAt)-Date.parse(stored.activatedAt);
    assert.equal(duration,3600_000);
    const again=await activateLiteDeferredKeyAtomic(db,deferred,phoneC);
    assert.equal(again.status,'already_active');
    const unknownPhone=await activateLiteDeferredKeyAtomic(db,deferred,phoneA);
    assert.equal(unknownPhone.status,'entitlement_revoked');
  });

  await t.test('deferred expiry cannot activate a disabled LITE license',async()=>{
    await db.collection('store').updateOne({_id:'keys'},{$set:{
      ['data.'+second+'.phones']:[phoneC],
      ['data.'+second+'.expireDuration']:3600_000,
    }});
    const result=await activateLiteDeferredKeyAtomic(db,second,phoneC);
    assert.equal(result.status,'entitlement_revoked');
    assert.equal((await readLiteLicenseSnapshot(db,second)).expiresAt,null);
  });

  await t.test('a key revocation prevents new phone claims but does not modify complete keys',async()=>{
    const fullBefore=await db.collection('store').findOne({_id:'keys'},{projection:{['data.'+full]:1,_id:0}});
    await db.collection('store').updateOne({_id:'keys'},{$set:{['data.'+lite+'.active']:false}});
    const denied=await claimLitePhoneSlotAtomic(db,lite,phoneC,{maxPhonesGlobal:100});
    assert.equal(denied.status,'entitlement_revoked');
    const fullAfter=await db.collection('store').findOne({_id:'keys'},{projection:{['data.'+full]:1,_id:0}});
    assert.deepEqual(fullAfter,fullBefore);
  });

  await t.test('unique partial LITE ownership index rejects a second account',async()=>{
    const index=await ensureLitePortalLicenseUniqueIndex(db);
    assert.equal(index,'zvm_lite_license_owner_unique_v1');
    await db.collection('portal_users').insertOne({_id:'one@example.com',liteKeyCode:lite});
    await assert.rejects(
      db.collection('portal_users').insertOne({_id:'two@example.com',liteKeyCode:lite}),
      e=>e.code===11000
    );
    await db.collection('portal_users').insertOne({_id:'three@example.com',keyCode:full});
    await db.collection('portal_users').insertOne({_id:'four@example.com',keyCode:full});
    assert.equal(await db.collection('portal_users').countDocuments({}),3);
  });

  await t.test('admin LITE block revokes both Lite session methods but never complete ZVM sessions',async()=>{
    const inserted=await db.collection('extension_sessions').insertMany([
      {licenseKeyCode:issuedByAdmin,extensionProductId:PRODUCT_LITE,authMethod:'password',revokedAt:null},
      {licenseKeyCode:issuedByAdmin,extensionProductId:PRODUCT_LITE,authMethod:'license_key',revokedAt:null},
      {licenseKeyCode:issuedByAdmin,extensionProductId:PRODUCT_AUTOMACOES,authMethod:'license_key',revokedAt:null},
      {licenseKeyCode:lite,extensionProductId:PRODUCT_LITE,authMethod:'license_key',revokedAt:null},
      {licenseKeyCode:full,extensionProductId:PRODUCT_AUTOMACOES,authMethod:'password',revokedAt:null}
    ]);
    const ids=Object.values(inserted.insertedIds);
    const revoked=await revokeLiteLicenseSessions(db,issuedByAdmin,{collectionName:'extension_sessions'});
    assert.equal(revoked.acknowledged,true);
    assert.equal(revoked.modifiedCount,2);
    const docs=await db.collection('extension_sessions').find({_id:{$in:ids}}).toArray();
    const map=new Map(docs.map(d=>[String(d._id),d]));
    for(let i=0;i<2;i++)assert.ok(map.get(String(ids[i])).revokedAt instanceof Date);
    for(let i=2;i<5;i++)assert.equal(map.get(String(ids[i])).revokedAt,null);
    const again=await revokeLiteLicenseSessions(db,issuedByAdmin,{collectionName:'extension_sessions'});
    assert.equal(again.modifiedCount,0,'double block/retry must be idempotent');
    await assert.rejects(revokeLiteLicenseSessions(db,full,{collectionName:'extension_sessions'}),/invalid_lite_license_revoke/);
  });

  await t.test('account unlink revokes only LITE password sessions',async()=>{
    const data=[
      {accountEmail:'one@example.com',extensionProductId:PRODUCT_LITE,authMethod:'password',revokedAt:null},
      {accountEmail:'one@example.com',extensionProductId:PRODUCT_LITE,authMethod:'license_key',revokedAt:null},
      {accountEmail:'one@example.com',extensionProductId:PRODUCT_AUTOMACOES,authMethod:'password',revokedAt:null},
      {accountEmail:'two@example.com',extensionProductId:PRODUCT_LITE,authMethod:'password',revokedAt:null}
    ];
    const inserted=await db.collection('extension_sessions').insertMany(data);
    const ids=Object.values(inserted.insertedIds);
    const result=await revokePortalLitePasswordSessions(db,'ONE@example.com',{collectionName:'extension_sessions'});
    assert.equal(result.modifiedCount,1);
    // Inspect ONLY the four documents created by this subtest, not sessions
    // inserted by the preceding admin-block regression.
    const docs=await Promise.all(ids.map(_id=>db.collection('extension_sessions').findOne({_id})));
    assert.ok(docs[0].revokedAt instanceof Date);
    assert.equal(docs[1].revokedAt,null);
    assert.equal(docs[2].revokedAt,null);
    assert.equal(docs[3].revokedAt,null);
  });
  await t.test('idempotent admin recovery revokes Lite sessions without enabling a disabled key',async()=>{
    const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
    const a=server.indexOf('  const codeLiteRevokeRetry = extractCode(');
    const b=server.indexOf('  const codeToggle = extractCode(',a);
    assert.ok(a>=0&&b>a);
    const run=new Function('req','res','deps','with(deps){return (async()=>{'+server.slice(a,b)+'})()}');
    await db.collection('store').updateOne({_id:'keys'},{$set:{['data.'+issuedByAdmin+'.active']:false}});
    const doc={licenseKeyCode:issuedByAdmin,extensionProductId:PRODUCT_LITE,
      authMethod:'license_key',revokedAt:null};
    const {insertedId}=await db.collection('extension_sessions').insertOne(doc);
    const rights=[];
    async function post(code,{originAllowed=true,admin=true}={}){
      const p='/admin/api/keys/'+code+'/revoke-lite-sessions';
      const req={method:'POST'};
      const res={};
      await run(req,res,{
        p,RA:'/admin',
        extractCode:re=>re.exec(p)?.[1]||null,
        isAdminSession:()=>admin,requireSameOriginPost:()=>originAllowed,
        getMongoDb:async()=>db,
        readAdminKeySnapshot:async code=>(await db.collection('store').findOne({_id:'keys'}))?.data?.[code]||null,
        productOfKeyRecord:require('../src/license-product-v2').productOfKeyRecord,
        PRODUCT_LITE,EXTENSION_SESSION_COLLECTION:'extension_sessions',
        revokeLiteLicenseSessions,
        addAdminAuditLog:async event=>{rights.push(event.action);},
        sendJson:(reply,body,status=200)=>{reply.reply={body,status};},
        console:{error(){}}
      });
      assert.ok(res.reply);
      return res.reply;
    }
    assert.equal((await post(issuedByAdmin,{admin:false})).status,401);
    assert.equal((await post(issuedByAdmin,{originAllowed:false})).status,403);
    const completed=await post(issuedByAdmin);
    assert.equal(completed.status,200);
    assert.equal(completed.body.active,false);
    assert.equal(completed.body.revokedCount,1);
    const stored=await db.collection('extension_sessions').findOne({_id:insertedId});
    assert.ok(stored.revokedAt instanceof Date);
    assert.equal((await post(issuedByAdmin)).body.revokedCount,0);
    assert.equal((await readLiteLicenseSnapshot(db,issuedByAdmin)).active,false);
    assert.equal((await post(deferred)).status,409,'active Lite key cannot invoke retry');
    assert.equal((await post(full)).status,404,'full-edition key is not accepted');
    assert.ok(rights.includes('lite_sessions_revoked'));
  });

});
