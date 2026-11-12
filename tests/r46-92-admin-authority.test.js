'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const cut = (s, a, b) => {
  const i = s.indexOf(a), j = s.indexOf(b, i + a.length);
  assert(i >= 0 && j > i, 'missing block: ' + a);
  return s.slice(i, j);
};
let passed = 0;

// Immutable asset must match both URL and SHA-256 allowlist.
const script = /<script src="\/assets\/(zvm-admin-dashboard\.([a-f0-9]{12})\.js)" defer><\/script>/.exec(server);
assert(script, 'admin must reference a fingerprinted JS asset');
const js = fs.readFileSync(path.join(root, 'assets', script[1]), 'utf8');
const fullDigest = crypto.createHash('sha256').update(js).digest('hex');
assert.equal(fullDigest.slice(0, 12), script[2]);
assert(server.includes("sha256: '" + fullDigest + "'"));
new vm.Script(js, { filename: script[1] });
passed++;

// Strict parser: no path injection, truncation, silent deletion or gigantic batch.
const parseSource = cut(server, 'function parseAdminBatchDeleteCodes(body)', '\n// Dashboard administrativo');
const parseBatch = new Function(parseSource + '\nreturn parseAdminBatchDeleteCodes;')();
assert.deepEqual(parseBatch({ codes: ['alpha', 'alpha', 'beta'] }).codes, ['alpha', 'beta']);
for (const codes of [[], ['ok', 'a.b'], ['ok', ''], ['ok', 123], ['x'.repeat(65)], Array(201).fill('x')]) {
  assert.equal(parseBatch({ codes }).ok, false);
}
passed++;

// MongoDB writes are scoped by existence predicates. No partial bulk deletion.
const deleteSource = cut(server, 'async function deleteKeyFromDb(code, deps = {})', '\nasync function activateDeferredKey(');
const keys = { alpha: { label: 'cached' }, beta: { label: 'cached' }, ghost: { label: 'stale' } };
const dbState = { alpha: { label: 'canonical' }, beta: { label: 'canonical' } };
const attempts = [];
let invalidations = 0;
const db = { collection(name) {
  if (name === 'portal_users') return { updateMany: async () => ({ modifiedCount: 0 }) };
  assert.equal(name, 'store');
  return { async updateOne(filter, update) {
    attempts.push({ filter: structuredClone(filter), update: structuredClone(update) });
    for (const [field, spec] of Object.entries(filter)) {
      if (field === '_id') continue;
      assert.deepEqual(spec, { $exists: true });
      if (!Object.hasOwn(dbState, field.slice(5))) return { matchedCount: 0 };
    }
    for (const field of Object.keys(update.$unset || {})) delete dbState[field.slice(5)];
    return { matchedCount: 1, modifiedCount: 1 };
  }};
}};
const deps = new Function('_saveDebounce', 'keys', 'invalidateKeysHtmlCache', 'getMongoDb',
  deleteSource + '\nreturn { deleteKeyFromDb, deleteKeysFromDbStrict };'
)(new Map(), keys, () => ++invalidations, async () => db);

(async () => {
  {
    await assert.rejects(deps.deleteKeyFromDb('ghost', { db }), e => e.code === 'key_write_conflict');
    assert.equal(keys.ghost.label, 'stale', 'never discard local cache after unconfirmed delete');
    assert.equal(invalidations, 0);
    assert.deepEqual(attempts.at(-1).filter['data.ghost'], { $exists: true });
    passed++;
  }
  {
    await assert.rejects(deps.deleteKeysFromDbStrict(['alpha', 'missing'], { db }),
      e => e.code === 'key_write_conflict');
    assert(dbState.alpha, 'atomic bulk delete must not delete alpha if missing is absent');
    assert.equal(invalidations, 0);
    passed++;
  }
  {
    const count = await deps.deleteKeysFromDbStrict(['alpha', 'beta', 'alpha'], { db });
    assert.equal(count, 2);
    assert.equal(dbState.alpha, undefined);
    assert.equal(dbState.beta, undefined);
    assert.equal(keys.alpha, undefined);
    assert.equal(keys.beta, undefined);
    assert.equal(invalidations, 1);
    assert.deepEqual(attempts.at(-1).filter['data.alpha'], { $exists: true });
    assert.deepEqual(attempts.at(-1).filter['data.beta'], { $exists: true });
    passed++;
  }
  // Backend routes: authenticated, same-origin, DB-authoritative, fail closed.
  const single = cut(server, "  const codeDelete = extractCode(", "\n  if (p === R_ADMIN+'/api/logs' && req.method === 'DELETE')");
  assert.match(single, /if \(!requireSameOriginPost\(req\)\)/);
  assert.match(single, /current = await readAdminKeySnapshot\(codeDelete\)/);
  assert.match(single, /if \(!current\) \{ sendJson\(res, \{ error:'not_found' \}, 404\)/);
  assert.match(single, /sendAdminKeyPersistFailure\(res, e, 'delete key'\)/);
  assert.doesNotMatch(single, /keys\[codeDelete\]/);
  passed++;

  const batch = cut(server, "  if (p === R_ADMIN+'/api/keys/batch' && req.method === 'DELETE')", "\n  const codeNote =");
  assert.match(batch, /await readAdminKeysSnapshot\(\)/);
  assert.match(batch, /batchInput\.codes\.filter\(code => !Object\.prototype\.hasOwnProperty\.call\(canonicalKeys, code\)\)/);
  assert.match(batch, /if \(missing\.length\)/);
  assert.match(batch, /sendAdminKeyPersistFailure\(res, e, 'batch delete'\)/);
  assert.doesNotMatch(batch, /keys\[c\]/);
  passed++;

  const csv = cut(server, "  if (p === R_ADMIN+'/api/export/csv' && req.method === 'GET')", "\n  if (p === R_ANALYTICS+'/login'");
  assert.match(csv, /snapshot = await readAdminKeysSnapshot\(\)/);
  assert.match(csv, /Object\.entries\(snapshot\)/);
  assert.match(csv, /error:'admin_data_unavailable'/);
  assert.match(csv, /'Cache-Control', 'no-store'/);
  assert.doesNotMatch(csv, /Object\.entries\(keys\)/);
  passed++;

  // UI: don't delete checked rows hidden under a filter; avoid double DELETEs.
  assert.match(js, /if\(!visible\)\{const cb=row\.querySelector\('\.key-cb'\)/);
  assert.match(js, /filter\(row=>row&&row\.style\.display!=='none'\)/);
  const deleteUi = cut(js, 'let _adminDeleteInFlight=false;', '\nfunction toggleAllCheckboxes(checked)');
  const batchUi = cut(js, 'async function deleteBatchKeys(){', '\nasync function filterLog(){');
  const uiSource = deleteUi + '\n' + batchUi;
  const rows = [{ dataset: {code:'a',label:'A'}, style:{display:''} },
                { dataset: {code:'b',label:'B'}, style:{display:'none'} }];
  const toasts=[],sent=[];
  const document = {
    querySelectorAll(sel){assert.equal(sel,'#kb .key-cb:checked');return rows.map(row=>({closest:()=>row}))},
    getElementById(){return {disabled:false}}
  };
  const ctx = vm.createContext({
    document,console,JSON,Set,encodeURIComponent,
    confirm:()=>true,toast:(msg)=>toasts.push(msg),
    adminJsonRequest:async(url,opts)=>{
      sent.push({url,opts});
      return {response:{status:200,ok:true},data:{ok:true,deleted:1}};
    },
    _RA:'/admin',doRefresh:async()=>{}
  });
  vm.runInContext(uiSource,ctx);
  await vm.runInContext('deleteBatchKeys()',ctx);
  assert.equal(sent.length,1);
  assert.deepEqual(JSON.parse(sent[0].opts.body).codes,['a']);
  passed++;

  // JSON/503 must not be treated as a CSV download, even with a valid session.
  const csvUi = cut(js, 'async function exportCSV(){', '\nasync function toggleDevAccess(');
  let blobReads=0,clicked=0;
  const csvCtx=vm.createContext({
    _RA:'/admin',Date,URL:{createObjectURL:()=>{throw Error('must not create blob URL')}},
    document:{},setTimeout(){},toast:msg=>toasts.push(msg),
    doRefresh:async()=>{},adminErrorMessage:()=> 'Dados indisponíveis',
    fetch:async()=>({status:503,ok:false,headers:{get:()=> 'application/json'},json:async()=>({error:'admin_data_unavailable'}),blob:async()=>{blobReads++;return {size:1}}})
  });
  vm.runInContext(csvUi,csvCtx);
  await vm.runInContext('exportCSV()',csvCtx);
  assert.equal(blobReads,0);
  assert.equal(clicked,0);
  assert(toasts.includes('Dados indisponíveis'));
  passed++;

  console.log('R46.92 PASS: '+passed+' admin authority/CSV/deletion regression groups, zero production writes');
})().catch(e => { console.error(e); process.exitCode = 1; });
