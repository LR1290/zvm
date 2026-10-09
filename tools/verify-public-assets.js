'use strict';
// R46.46 — offline-only preflight. Reads repository files; never contacts Atlas,
// Render, Cakto, or customers. Intended to fail before deploying broken assets.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const refPattern = /\/assets\/[A-Za-z0-9._/-]+\.(?:css|js|png|svg|webp|jpe?g|ico)/g;
function inspectAssetContract(source) {
  if (typeof source !== 'string') throw Error('asset_contract_source_required');
  const start = source.indexOf('const _PUBLIC_ASSETS = Object.freeze({');
  if (start < 0) throw Error('asset_manifest_missing');
  const end = source.indexOf('\n});', start);
  if (end < 0) throw Error('asset_manifest_unterminated');
  const body = source.slice(start, end);
  const re = /^\s*'(\/assets\/[A-Za-z0-9._/-]+)': Object\.freeze\(\{([\s\S]*?)^\s{2}\}\),/gm;
  const entries = [];
  const errors = [];
  const routes = new Set();
  for (const match of body.matchAll(re)) {
    const [unused, route, metadata] = match;
    const file = metadata.match(/^\s*file:\s*path\.join\(__dirname,\s*'assets',\s*'([^']+)'\)/m)?.[1];
    const hash = metadata.match(/^\s*sha256:\s*'([a-f0-9]{64})'/m)?.[1];
    const mime = metadata.match(/^\s*type:\s*'([^']+)'/m)?.[1];
    if (routes.has(route)) errors.push('asset_duplicate_route:' + route);
    routes.add(route);
    if (!file || !hash || !mime) errors.push('asset_metadata_missing:' + route);
    else entries.push({route, file, hash, mime});
  }
  if (!entries.length) errors.push('asset_manifest_empty_or_unparseable');
  // A public asset is intentionally published only if it is in the immutable
  // hash-checked allowlist. Referenced but unlisted paths produce HTTP 404.
  const references = new Set(source.match(refPattern) || []);
  for (const route of references) {
    if (!routes.has(route)) errors.push('asset_reference_not_allowlisted:' + route);
  }
  return {entries, references: [...references], errors};
}

function auditPublicAssets(root) {
  const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const contract = inspectAssetContract(source);
  const errors = [...contract.errors];
  for (const asset of contract.entries) {
    if (asset.route !== '/assets/' + asset.file ||
        asset.file !== path.basename(asset.file) ||
        asset.file.includes('..')) {
      errors.push('asset_route_file_mismatch:' + asset.route);
      continue;
    }
    const ext = path.extname(asset.file).toLowerCase();
    const expectedMime = {'.css':'text/css','.js':['application/javascript','text/javascript'],'.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/'};
    if (!expectedMime[ext] || !(Array.isArray(expectedMime[ext]) ? expectedMime[ext] : [expectedMime[ext]]).some(type => asset.mime.startsWith(type)))
      errors.push('asset_mime_invalid:' + asset.route);
    const fingerprint = asset.file.match(/\.([a-f0-9]{12})\.[a-z0-9]+$/)?.[1];
    if (!fingerprint || !asset.hash.startsWith(fingerprint))
      errors.push('asset_filename_hash_invalid:' + asset.route);
    const filename = path.join(root, 'assets', asset.file);
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      errors.push('asset_file_missing:' + asset.route);
      continue;
    }
    const actual = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
    if (actual !== asset.hash) errors.push('asset_sha256_mismatch:' + asset.route);
  }
  return {
    ok: errors.length === 0,
    declared: contract.entries.length,
    referenced: contract.references.length,
    errors
  };
}
if (require.main === module) {
  const result = auditPublicAssets(path.resolve(__dirname, '..'));
  // No customer data, credentials, environment variables or database contents.
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
module.exports = {inspectAssetContract, auditPublicAssets};
