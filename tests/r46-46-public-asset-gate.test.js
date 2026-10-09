'use strict';
// Standalone fixtures: intentionally offline and database-free.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {inspectAssetContract, auditPublicAssets} = require('../tools/verify-public-assets');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zvm-asset-preflight-'));
const assetDir = path.join(root, 'assets');
fs.mkdirSync(assetDir);
const content = 'body{color:#00ff87}\n';
const hash = crypto.createHash('sha256').update(content).digest('hex');
const file = 'unit-' + hash.slice(0, 12) + '.css';
const route = '/assets/' + file;
function manifest({url=route,name=file,sha=hash,mime='text/css; charset=utf-8'} = {}) {
  return [
    'const _PUBLIC_ASSETS = Object.freeze({',
    "  '" + url + "': Object.freeze({",
    "    type: '" + mime + "',",
    "    file: path.join(__dirname, 'assets', '" + name + "'),",
    "    sha256: '" + sha + "',",
    '    compressible: true,',
    '  }),',
    '});',
    "const _TEST_CSS = '<link rel=\"stylesheet\" href=\"" + route + "\">';"
  ].join('\n');
}
try {
  fs.writeFileSync(path.join(assetDir, file), content);
  fs.writeFileSync(path.join(root, 'server.js'), manifest());
  const pass = auditPublicAssets(root);
  assert.equal(pass.ok, true, JSON.stringify(pass.errors));
  assert.equal(pass.declared, 1);
  assert.equal(pass.referenced, 1);

  const missingRoute = route.replace('/assets/', '/assets/not-in-manifest-');
  const unlisted = inspectAssetContract(manifest() + '\nconst missing="' + missingRoute + '";');
  assert.equal(unlisted.errors.some(x => x.startsWith('asset_reference_not_allowlisted:')), true);

  fs.writeFileSync(path.join(assetDir, file), 'tampered content');
  const tampered = auditPublicAssets(root);
  assert.equal(tampered.errors.includes('asset_sha256_mismatch:' + route), true);

  fs.unlinkSync(path.join(assetDir, file));
  const missing = auditPublicAssets(root);
  assert.equal(missing.errors.includes('asset_file_missing:' + route), true);

  fs.writeFileSync(path.join(assetDir, file), content);
  fs.writeFileSync(path.join(root, 'server.js'), manifest({sha:'a'.repeat(64)}));
  assert.equal(auditPublicAssets(root).errors.some(x=>x.startsWith('asset_filename_hash_invalid:')), true);

  fs.writeFileSync(path.join(root, 'server.js'), manifest({mime:'application/javascript'}));
  assert.equal(auditPublicAssets(root).errors.some(x=>x.startsWith('asset_mime_invalid:')), true);

  fs.writeFileSync(path.join(root, 'server.js'), manifest({name:'../outside.css'}));
  assert.equal(auditPublicAssets(root).errors.some(x=>x.startsWith('asset_route_file_mismatch:')), true);

  assert.throws(()=>inspectAssetContract('const nothing = 1'),/asset_manifest_missing/);
  console.log('R46.46 public asset preflight: 8 scenarios PASS, zero network/DB writes');
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
