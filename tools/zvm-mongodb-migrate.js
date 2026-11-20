'use strict';

// ZVM: migração planejada zapvoice -> zvm. Nunca apaga o banco original.
// Executar exclusivamente após pausar TODOS os writers, inclusive Cakto/webhooks.
// Sem dependência de ambiente de produção nos testes: require('mongodb') é tardio.
const crypto = require('node:crypto');
const { validateBackupGate } = require('./zvm-mongodb-backup-proof');
const SOURCE_DB = 'zapvoice';
const TARGET_DB = 'zvm';
const COPY_ACK = 'zapvoice-to-zvm';
const PAUSE_ACK = 'writers-stopped';

function copyGuard(action, env = process.env) {
  if (action !== 'copy') return false;
  if (env.ZVM_MONGO_MIGRATION_ACK !== COPY_ACK ||
      env.ZVM_MONGO_WRITERS_PAUSED !== PAUSE_ACK) {
    throw new Error('migration_requires_explicit_ack_and_all_writers_paused');
  }
  if (SOURCE_DB === TARGET_DB) throw new Error('invalid_database_pair');
  return true;
}

function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}
function indexSpec(raw) {
  const allowed = [
    'key', 'name', 'unique', 'sparse', 'expireAfterSeconds', 'partialFilterExpression',
    'collation', 'hidden', 'wildcardProjection', 'weights', 'default_language',
    'language_override', 'textIndexVersion', '2dsphereIndexVersion', 'bits',
    'min', 'max', 'bucketSize'
  ];
  if (!raw || !raw.key || !raw.name) throw new Error('invalid_index_spec');
  const next = {};
  for (const k of allowed) if (raw[k] !== undefined) next[k] = raw[k];
  return next;
}
function indexSignatures(indexes) {
  // R92: compound-index FIELD ORDER is semantically significant in MongoDB.
  // Sorting the object recursively (as generic canonical() does) masks an
  // inverted compound index with the same name and index options.
  return indexes.map(indexSpec).map(spec => {
    const {key, ...options} = spec;
    if (!key || typeof key !== 'object' || Array.isArray(key) ||
        Object.keys(key).length === 0) throw new Error('invalid_index_keys');
    return canonical({orderedFields:Object.entries(key),options});
  }).sort();
}
function collectionOptionsSignature(row, EJSON) {
  // Options affect behavior even when BSON records/indexes match:
  // validators, validationAction/Level, collation, capped, clusteredIndex, etc.
  // Driver listCollections returns options without volatile collection UUIDs.
  const raw = row && row.options && typeof row.options === 'object' &&
    !Array.isArray(row.options) ? row.options : {};
  return canonical(EJSON.serialize(raw, {relaxed:false}));
}

function collectionOptionsByName(rows, EJSON) {
  const options = new Map();
  for (const row of rows) {
    if (options.has(row.name)) throw new Error('duplicate_collection_name');
    options.set(row.name, collectionOptionsSignature(row, EJSON));
  }
  return options;
}

function listCollectionNames(rows) {
  if (!Array.isArray(rows)) throw new Error('invalid_collection_list');
  const unexpected = rows.find(r => r.type !== 'collection' || !/^[a-zA-Z0-9_-]+$/.test(r.name));
  if (unexpected) throw new Error('unsupported_collection_type_or_name');
  return rows.map(r => r.name).sort();
}
async function collectionRows(db) {
  return db.listCollections({}, { nameOnly: false }).toArray();
}
async function describe(db) {
  const rows = await collectionRows(db);
  const cols = listCollectionNames(rows);
  const stats = [];
  for (const name of cols) {
    const collection = db.collection(name);
    const [documents, indexes] = await Promise.all([
      collection.countDocuments({}), collection.listIndexes().toArray()
    ]);
    stats.push({collection:name,documents,indexes:indexes.length});
  }
  return stats;
}

async function digestCollection(collection, EJSON) {
  const hash = crypto.createHash('sha256');
  // Deterministic order and canonical EJSON preserve BSON types, including Date,
  // ObjectId, Decimal128, and binary, without leaking private records to logs.
  const cursor = collection.find({}, {sort:{_id:1}});
  for await (const doc of cursor) {
    hash.update(canonical(EJSON.serialize(doc, {relaxed:false})));
    hash.update('\n');
  }
  return hash.digest('hex');
}

// R88: immutable in-memory receipt for the frozen origin. Checks every source
// collection, document and index twice. The receipt is never persisted to
// MongoDB or emitted as customer-derived hashes in public logs.
async function snapshotDatabase(db, EJSON) {
  const rows = await collectionRows(db);
  const names = listCollectionNames(rows);
  const optionSignatures = collectionOptionsByName(rows, EJSON);
  const sections = [];
  for (const name of names) {
    const collection = db.collection(name);
    const [count, indexes, digest] = await Promise.all([
      collection.countDocuments({}),
      collection.listIndexes().toArray(),
      digestCollection(collection, EJSON)
    ]);
    sections.push({name, count, options:optionSignatures.get(name), indexes: indexSignatures(indexes), digest});
  }
  const checksum = crypto.createHash('sha256').update(canonical(sections)).digest('hex');
  return {sections, checksum};
}

async function compareDatabases(source, target, EJSON) {
  const sourceRows = await collectionRows(source);
  const targetRows = await collectionRows(target);
  const sourceNames = listCollectionNames(sourceRows);
  const targetNames = listCollectionNames(targetRows);
  if (canonical(sourceNames) !== canonical(targetNames)) {
    throw new Error('collection_sets_differ');
  }
  const sourceOptions = collectionOptionsByName(sourceRows, EJSON);
  const targetOptions = collectionOptionsByName(targetRows, EJSON);
  // R91: do not accept data-equal databases with different validation behavior.
  // Check before costly BSON scans and before switching any production config.
  for (const name of sourceNames) {
    if (sourceOptions.get(name) !== targetOptions.get(name)) {
      throw new Error('collection_options_mismatch:' + name);
    }
  }
  let totalDocuments = 0, totalIndexes = 0;
  const results = [];
  for (const name of sourceNames) {
    const a = source.collection(name), b = target.collection(name);
    const [ac,bc,ai,bi,ah,bh] = await Promise.all([
      a.countDocuments({}), b.countDocuments({}),
      a.listIndexes().toArray(), b.listIndexes().toArray(),
      digestCollection(a,EJSON), digestCollection(b,EJSON)
    ]);
    if (ac !== bc || ah !== bh || canonical(indexSignatures(ai)) !== canonical(indexSignatures(bi))) {
      throw new Error('database_mismatch:' + name);
    }
    totalDocuments += ac; totalIndexes += ai.length;
    results.push({collection:name,documents:ac,indexes:ai.length,verified:true});
  }
  // Licenses, accounts and payments are within the comprehensive BSON hashes.
  return {collections:results.length,documents:totalDocuments,indexes:totalIndexes,verified:true,results};
}

async function copyDatabase(client, EJSON, env = process.env, expectedSourceChecksum = null) {
  copyGuard('copy',env);
  const source = client.db(SOURCE_DB), target = client.db(TARGET_DB);
  const sourceRows = await collectionRows(source);
  const sourceNames = listCollectionNames(sourceRows);
  if (!sourceNames.includes('store') || !sourceNames.includes('portal_users') ||
      !sourceNames.includes('payments')) throw new Error('source_missing_critical_collections');
  if ((await collectionRows(target)).length !== 0) {
    // Never replace, drop, merge or resume an unknown target automatically.
    throw new Error('target_not_empty_manual_review_required');
  }
  const baseline = await snapshotDatabase(source, EJSON);
  if(expectedSourceChecksum !== null && baseline.checksum !== expectedSourceChecksum) {
    // Valid restore proof, but production has changed since archive creation:
    // refuse cutover before writing ANY target collection.
    throw new Error('backup_source_checksum_mismatch');
  }
  if (canonical(baseline.sections.map(s => s.name)) !== canonical(sourceNames)) {
    throw new Error('source_collection_set_changed_before_copy');
  }
  for (const item of sourceRows.sort((a,b)=>a.name.localeCompare(b.name))) {
    const name = item.name;
    const sourceColl = source.collection(name);
    const originalIndexes = await sourceColl.listIndexes().toArray();
    const targetColl = await target.createCollection(name, item.options || {});
    const secondary = originalIndexes.filter(idx => idx.name !== '_id_').map(indexSpec);
    if (secondary.length) await targetColl.createIndexes(secondary);
    // Server-side BSON copy: no PII or license strings are brought into process logs.
    // The existing target collection's index definitions are retained by $out.
    const cursor = sourceColl.aggregate([{$out:{db:TARGET_DB,coll:name}}], {allowDiskUse:true});
    await cursor.toArray();
  }
  const checked = await compareDatabases(source, target, EJSON);
  const after = await snapshotDatabase(source, EJSON);
  if (baseline.checksum !== after.checksum) {
    throw new Error('source_changed_during_migration');
  }
  return { ...checked, sourceStable: true };
}

async function execute(action, env = process.env) {
  if (!['audit','verify','copy'].includes(action)) throw new Error('usage: audit | verify | copy');
  let backupGate = null;
  if (action === 'copy') {
    copyGuard(action,env);
    // R89: an actual archive, its SHA-256, an isolated RESTORE test and a
    // paused-writers receipt are mandatory. Flags alone cannot unlock copy.
    backupGate = await validateBackupGate(env);
  }
  const uri = String(env.MONGODB_URI || '').trim();
  if (!uri) throw new Error('MONGODB_URI_required');
  const {MongoClient,BSON} = require('mongodb');
  const EJSON = BSON?.EJSON || require('bson').EJSON;
  const client = new MongoClient(uri, {maxPoolSize:3,serverSelectionTimeoutMS:10000});
  await client.connect();
  try {
    if (action === 'audit') {
      const [source,target] = await Promise.all([
        describe(client.db(SOURCE_DB)),describe(client.db(TARGET_DB))
      ]);
      return {mode:'audit',sourceDatabase:SOURCE_DB,targetDatabase:TARGET_DB,
        source, target, mutating:false};
    }
    if (action === 'verify') return {mode:'verify', ...await compareDatabases(
      client.db(SOURCE_DB),client.db(TARGET_DB),EJSON
    ),mutating:false};
    const result = await copyDatabase(client,EJSON,env,backupGate.sourceChecksum);
    return {mode:'copy', ...result, sourceRetained:true};
  } finally {
    await client.close();
  }
}
if (require.main === module) {
  execute(process.argv[2] || 'audit').then(result => {
    // No document values, customer PII, keys, or Mongo URI in printed summary.
    if (result.mode === 'audit') {
      console.log(JSON.stringify(result,null,2));
    } else {
      console.log(JSON.stringify({mode:result.mode,collections:result.collections,
        documents:result.documents,indexes:result.indexes,verified:result.verified,
        sourceRetained:result.sourceRetained ?? true},null,2));
    }
  }).catch(error => {
    console.error('ZVM_DB_MIGRATION_FAILED:',String(error?.message||'unknown').slice(0,200));
    process.exitCode=1;
  });
}
module.exports = {
  SOURCE_DB,TARGET_DB,COPY_ACK,PAUSE_ACK,copyGuard,canonical,indexSpec,indexSignatures,
  listCollectionNames,collectionOptionsSignature,collectionOptionsByName,
  describe,digestCollection,snapshotDatabase,compareDatabases,copyDatabase,execute
};
