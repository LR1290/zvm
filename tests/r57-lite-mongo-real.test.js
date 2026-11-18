'use strict';
// REAL MongoDB integration test. Never uses credentials, production databases,
// Render or a remote connection. The CI container is local and ephemeral.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');
const { generateLicenseKey, PRODUCT_LITE, PRODUCT_AUTOMACOES } = require('../src/license-product-v2');
const { readLiteLicenseSnapshot, claimLitePhoneSlotAtomic, liteKeyUsable, activateLiteDeferredKeyAtomic } = require('../src/lite-license-authority');
const { ensureLitePortalLicenseUniqueIndex, revokePortalLitePasswordSessions } = require('../src/portal-license-slots');

const uri=process.env.ZVM_LITE_TEST_MONGO_URI;
if (!uri || !/^mongodb:\/\/(?:127\.0\.0\.1|localhost):27017\/?(?:\?.*)?$/.test(uri)) {
  throw new Error('R57_NEEDS_LOCAL_EPHEMERAL_MONGO_ON_127_0_0_1:27017');
}
const full=generateLicenseKey(PRODUCT_AUTOMACOES);
const lite=generateLicenseKey(PRODUCT_LITE);
const second=generateLicenseKey(PRODUCT_LITE);
const deferred=generateLicenseKey(PRODUCT_LITE);
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
    [deferred]:base({maxUses:2,phones:[phoneC],expireDuration:3600_000}),
    [full]:{active:true,extensionProductId:PRODUCT_AUTOMACOES,phones:[],maxUses:1,planId:'ZV_PRO'},
  }});

  await t.test('only a matching LITE key is accepted from the persisted store',async()=>{
    assert.equal((await readLiteLicenseSnapshot(db,lite)).extensionProductId,PRODUCT_LITE);
    assert.equal(await readLiteLicenseSnapshot(db,full),null);
    assert.equal(await readLiteLicenseSnapshot(db,'zv2l-not-valid'),null);
    const record=await readLiteLicenseSnapshot(db,second);
    assert.equal(liteKeyUsable(record,second),false);
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

  await t.test('account unlink revokes only LITE password sessions',async()=>{
    const data=[
      {accountEmail:'one@example.com',extensionProductId:PRODUCT_LITE,authMethod:'password',revokedAt:null},
      {accountEmail:'one@example.com',extensionProductId:PRODUCT_LITE,authMethod:'license_key',revokedAt:null},
      {accountEmail:'one@example.com',extensionProductId:PRODUCT_AUTOMACOES,authMethod:'password',revokedAt:null},
      {accountEmail:'two@example.com',extensionProductId:PRODUCT_LITE,authMethod:'password',revokedAt:null}
    ];
    await db.collection('extension_sessions').insertMany(data);
    const result=await revokePortalLitePasswordSessions(db,'ONE@example.com',{collectionName:'extension_sessions'});
    assert.equal(result.modifiedCount,1);
    const docs=await db.collection('extension_sessions').find({}, {projection:{_id:0}}).toArray();
    assert.ok(docs[0].revokedAt instanceof Date);
    assert.equal(docs[1].revokedAt,null);
    assert.equal(docs[2].revokedAt,null);
    assert.equal(docs[3].revokedAt,null);
  });
});
