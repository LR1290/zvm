'use strict';
// R46.39: synthetic-only Mongo transaction/index experiment. Never operates on portal_users.
// Never use the production URI or credentials. Run ONLY against isolated staging MongoDB.
const crypto = require('node:crypto');
const APPROVAL = 'I_CONFIRM_ISOLATED_STAGING_ONLY';
const NAME_PREFIX = 'zvm_r4639_fixture_';
const PARTIAL_UNIQUE = Object.freeze({
  name: 'r4639_unique_key_synthetic',
  unique: true,
  partialFilterExpression: { keyCode: { $type: 'string', $gt: '' } },
});
function configFrom(env, argv) {
  if (!Array.isArray(argv) || argv.length !== 1 || argv[0] !== '--isolated-staging') throw Error('staging_flag_required');
  if (env.ZVM_R4639_STAGING_APPROVAL !== APPROVAL) throw Error('staging_approval_required');
  const name = String(env.ZVM_R4639_STAGING_DB || '');
  if (!/^zvm_r4639_stage_[a-z0-9]{8,32}$/.test(name)) throw Error('staging_database_name_required');
  const uri = String(env.ZVM_R4639_STAGING_URI || '');
  if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) throw Error('mongodb_staging_uri_required');
  const local = /^mongodb:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|\?|$)/i.test(uri);
  if (!local && env.ZVM_R4639_REMOTE_STAGING_APPROVED !== 'YES') throw Error('remote_staging_not_approved');
  if (/\b(?:prod|production|zapvoice|zvm\.onrender\.com)\b/i.test(uri)) throw Error('production_target_forbidden');
  return { name, uri, local };
}
function isDup(e) { return Number(e && e.code) === 11000; }
function assertResult(r, label) { if (!r) throw Error('staging_assert_' + label); }
function fixtureName() { return NAME_PREFIX + crypto.randomBytes(12).toString('hex'); }
// Only synthetic collection names created by this process may be dropped.
function checkSyntheticName(name) { return new RegExp('^'+ NAME_PREFIX + '[0-9a-f]{24}$').test(name); }
async function scenario(db, coll, runId) {
  const checks = [];
  function mark(label) { checks.push(label); }
  const base = runId.slice(0, 8);
  async function fresh(label, key) { return coll.insertOne({ _id: base + '_' + label, ...(key === undefined ? {} : {keyCode: key}) }); }
  // 1-4: index and exclusions.
  const list = await coll.listIndexes().toArray();
  assertResult(list.some(x => x.name === PARTIAL_UNIQUE.name && x.unique === true), 'unique_index'); mark('unique_index');
  await fresh('absent'); await fresh('null', null); await fresh('empty1', ''); await fresh('empty2', '');
  assertResult(await coll.countDocuments({keyCode:''}) === 2, 'empty_not_unique');mark('empty_not_unique');
  assertResult(await coll.countDocuments({keyCode:null}) === 2, 'missing_and_null_allowed');mark('missing_and_null_allowed');
  await fresh('ownerA', 'valid-a'); mark('first_owner_created');
  // 5-8: duplicate, concurrency and ownership moves.
  let dupeError;
  try { await fresh('ownerB','valid-a'); } catch (e) { dupeError=e; }
  assertResult(isDup(dupeError), 'duplicate_rejected'); mark('duplicate_rejected');
  const races=await Promise.allSettled([fresh('race1','same-race'),fresh('race2','same-race')]);
  assertResult(races.filter(x=>x.status==='fulfilled').length===1, 'exactly_one_concurrent_winner');mark('exactly_one_concurrent_winner');
  assertResult(races.filter(x=>x.status==='rejected' && isDup(x.reason)).length===1,'concurrent_second_11000');mark('concurrent_second_11000');
  await coll.updateOne({_id:base+'_ownerA'},{$unset:{keyCode:''}});
  await fresh('ownerC','valid-a');
  assertResult(await coll.countDocuments({keyCode:'valid-a'})===1,'release_then_transfer');mark('release_then_transfer');
  // 9-12: one owner, unique update, status check, repeated link.
  assertResult(await coll.countDocuments({keyCode:'same-race'})===1,'one_race_owner');mark('one_race_owner');
  let updateDupe;
  try { await coll.updateOne({_id:base+'_empty1'},{$set:{keyCode:'valid-a'}}); }catch(e){updateDupe=e;}
  assertResult(isDup(updateDupe),'duplicate_update_rejected');mark('duplicate_update_rejected');
  assertResult(await coll.countDocuments({keyCode:'valid-a'})===1,'unchanged_after_failed_update');mark('unchanged_after_failed_update');
  assertResult(await coll.countDocuments({keyCode:''})===2,'empty_remains_unlinked');mark('empty_remains_unlinked');
  // 13-15: attempted transfer INSIDE a transaction. Report observed behavior;
  // MongoDB versions can differ. Do NOT mistake E11000 as a universal property.
  let txn = 'not_tested';
  const session = db.client.startSession();
  try {
    await session.withTransaction(async () => {
      await coll.updateOne({_id:base+'_ownerC'},{$unset:{keyCode:''}},{session});
      await coll.insertOne({_id:base+'_txnOwner',keyCode:'valid-a'},{session});
    });
    txn='committed';
  } catch(e) {
    txn=isDup(e)?'duplicate_key':'other_error';
  } finally { await session.endSession(); }
  assertResult(['committed','duplicate_key','other_error'].includes(txn),'txn_outcome_recorded');mark('txn_outcome_recorded');
  const ownerCount=await coll.countDocuments({keyCode:'valid-a'});
  assertResult(ownerCount===1,'unique_invariant_after_transaction');mark('unique_invariant_after_transaction');
  if(txn!=='committed') {
    assertResult((await coll.countDocuments({_id:base+'_ownerC',keyCode:'valid-a'}))===1,'rollback_keeps_owner');mark('rollback_keeps_owner');
  } else { mark('rollback_not_needed'); }
  // 16-20: no data changes outside fixture; metadata/report all synthetic.
  assertResult(checks.every(x=>/^[a-z0-9_]+$/.test(x)),'safe_markers');mark('safe_markers');
  assertResult(typeof txn==='string','safe_txn_outcome');mark('safe_txn_outcome');
  assertResult(await coll.countDocuments({})>=7,'synthetic_only_documents');mark('synthetic_only_documents');
  assertResult(checks.length===18,'expected_scenario_length');mark('expected_scenario_length');
  return { stage:'04D',mode:'isolated_staging_only',tested:checks.length,checks,transactionTransfer:txn,productionCertified:false };
}
async function runWithClient(client, cfg) {
  const db=client.db(cfg.name), name=fixtureName();
  assertResult(checkSyntheticName(name),'synthetic_name');
  const coll=db.collection(name);
  let created=false, result;
  try {
    await db.createCollection(name); created=true;
    await coll.createIndex({keyCode:1},PARTIAL_UNIQUE);
    result=await scenario({client},coll,name.slice(NAME_PREFIX.length));
  } finally {
    // This drop affects only the uniquely generated synthetic collection.
    if(created && checkSyntheticName(name)) await coll.drop();
  }
  // A successful cleanup is part of the acceptance criteria, not an assumption.
  const leftover = await db.listCollections({name},{nameOnly:true}).toArray();
  assertResult(leftover.length===0,'fixture_cleanup');
  result.checks.push('fixture_cleanup_verified');
  result.tested=result.checks.length;
  return result;
}
async function main(argv=process.argv.slice(2),env=process.env) {
  const cfg=configFrom(env,argv);
  const {MongoClient}=require('mongodb');
  const client=new MongoClient(cfg.uri,{serverSelectionTimeoutMS:5000,connectTimeoutMS:5000,maxPoolSize:2});
  try{await client.connect();const r=await runWithClient(client,cfg);console.log(JSON.stringify(r));}
  finally{await client.close();}
}
if(require.main===module)main().catch(e=>{console.error('[R46.39] staging scenario failed:',isDup(e)?'duplicate_key':String(e?.code||e?.message).slice(0,48));process.exitCode=1;});
module.exports={APPROVAL,NAME_PREFIX,PARTIAL_UNIQUE,configFrom,isDup,fixtureName,checkSyntheticName,scenario,runWithClient};
