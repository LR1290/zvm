'use strict';
// No mutation API is called by this tool. Use a Mongo account with read-only roles.
// The result intentionally contains no emails, raw license codes or record IDs.
const { audit: auditDuplicates } = require('./r46-39-ownership-census');
const { MongoClient } = (() => { try { return require('mongodb'); } catch { return {}; } })();

function eligibleNonEmptyKeyFilter(filter) {
  if (!filter || typeof filter !== 'object') return false;
  const parts = Array.isArray(filter.$and) ? filter.$and : [filter];
  // A missing, null, blank or non-string key must never participate in the unique constraint.
  // Be conservative: don't claim readiness for unrelated/unknown partial filter shapes.
  const constraints = parts.map(part => part && part.keyCode).filter(Boolean);
  const typed = constraints.some(value => value.$type === 'string');
  const nonBlank = constraints.some(value => value.$gt === '');
  return typed && nonBlank;
}

function describeIndex(index) {
  const exactKey = index && Object.keys(index.key || {}).length === 1 && index.key.keyCode === 1;
  if (!exactKey) return null;
  const filter = index.partialFilterExpression || null;
  return {
    unique: index.unique === true,
    sparse: index.sparse === true,
    partial: !!filter,
    // Report presence, not raw arbitrary metadata supplied by the database.
    nameClass: index.name === 'keyCode_1' ? 'legacy_default' : 'custom',
    partialExcludesEmpty: eligibleNonEmptyKeyFilter(filter),
  };
}

async function inspect(db, opts={}) {
  if (!db || typeof db.collection !== 'function') throw Error('db_readonly_required');
  const coll=db.collection('portal_users');
  const [dupes, indexes, activeEmailChanges, boundAccounts] = await Promise.all([
    auditDuplicates(db),
    coll.listIndexes({maxTimeMS:8000}).toArray(),
    coll.countDocuments({emailChangeOp:{$exists:true}},{maxTimeMS:8000}),
    coll.countDocuments({keyCode:{$type:'string',$ne:''}},{maxTimeMS:8000}),
  ]);
  const keyIndexes=indexes.map(describeIndex).filter(Boolean);
  const hasUniqueExcludingEmpty=keyIndexes.some(x=>x.unique && x.partial && x.partialExcludesEmpty);
  return {
    status:'read_only',
    scanned: true,
    duplicateGroupCount:dupes.duplicateGroups,
    duplicateGroupListTruncated:!dupes.complete,
    // No identifying hashes leave this report. Aggregates only.
    largestOwnerGroup:dupes.duplicates.reduce((max,row)=>Math.max(max,row.holders),0),
    activeEmailChanges:Number(activeEmailChanges),
    boundAccounts:Number(boundAccounts),
    ownerIndexes:keyIndexes,
    bindingIndexUniquePartial:hasUniqueExcludingEmpty,
    indexNameCollision:keyIndexes.some(x=>x.nameClass==='legacy_default' && !x.unique),
    migrationBlockers:[
      ...(!dupes.complete?['duplicate_scan_truncated']:[]),
      ...(dupes.duplicateGroups?['duplicate_bindings']:[]),
      ...(activeEmailChanges?['email_change_in_progress']:[]),
      ...(!hasUniqueExcludingEmpty?['unique_partial_index_missing']:[]),
    ],
    // The application email-change/Cakto flows need transaction and compatibility tests.
    safeToDeploy: false,
    remediationRequiresManualReview: true,
  };
}

async function main(argv=process.argv.slice(2),env=process.env){
  if(argv.length!==1||argv[0]!=='--audit'||env.ZVM_AUDIT_READONLY!=='1'||!env.ZVM_AUDIT_MONGODB_URI||!env.ZVM_AUDIT_DB_NAME){
    throw Object.assign(new Error('audit_configuration_missing'),{code:'audit_configuration_missing'});
  }
  if(typeof MongoClient!=='function') throw Object.assign(new Error('mongodb_dependency_unavailable'),{code:'mongodb_dependency_unavailable'});
  const conn=new MongoClient(env.ZVM_AUDIT_MONGODB_URI,{serverSelectionTimeoutMS:5000,connectTimeoutMS:5000,maxPoolSize:1});
  try{await conn.connect();console.log(JSON.stringify(await inspect(conn.db(env.ZVM_AUDIT_DB_NAME))));}
  finally{await conn.close()}
}
if(require.main===module)main().catch(err=>{console.error('[R46.39] ownership read-only audit error:',String(err?.code||'audit_failed').slice(0,50));process.exitCode=1});
module.exports={describeIndex,eligibleNonEmptyKeyFilter,inspect};
