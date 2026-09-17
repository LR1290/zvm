import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SHA256 = /^[a-f0-9]{64}$/;
const MANIFEST_MODE = 'manifest-json-v1';
const BROWSER_ICON_MODE = 'browser-icon-v1';
const BROWSER_ICON_PATHS = new Set(['assets/icons/icon16.png','assets/icons/icon32.png','assets/icons/icon48.png','assets/icons/icon64.png','assets/icons/icon128.png','assets/icons/icon128-action.png']);
const TRUSTED_UPDATE_URL = 'https://clients2.google.com/service/update2/crx';
const BROWSER_MANAGED_TOP_LEVEL_FIELDS = new Set(['key','update_url']);
function fail(message) { throw new Error(`RELEASE_ASSET_INVALID:${message}`); }
function assert(condition, message) { if (!condition) fail(message); }
function sha256Bytes(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function sha256File(file) { return sha256Bytes(fs.readFileSync(file)); }
function asciiCompare(a,b){return a<b?-1:a>b?1:0;}
function run(command, args, options = {}) {
  const out = spawnSync(command, args, { encoding:'utf8', maxBuffer:32*1024*1024, ...options });
  if (out.error) fail(`${command}:${out.error.message}`);
  if (out.status !== 0) fail(`${command}:exit-${out.status}:${String(out.stderr || out.stdout || '').trim()}`);
  return out.stdout;
}
function safeZipPath(name) {
  if (!name || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  const parts = name.split('/');
  return parts.every(part => part && part !== '.' && part !== '..');
}
function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file,'utf8')); }
  catch (e) { fail(`${label}:${e.message}`); }
}
function normalizeManifest(value, depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { assert(Number.isFinite(value),'manifest-canonical:number'); return value; }
  if (Array.isArray(value)) return value.map(v => normalizeManifest(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort(asciiCompare)) {
      if (depth === 0 && key === 'key') { if (typeof value[key] !== 'string' || !value[key].trim()) fail('manifest:key-invalid'); continue; }
    if (depth === 0 && key === 'update_url') { if (value[key] !== TRUSTED_UPDATE_URL) fail('manifest:update-url-untrusted'); continue; }
      assert(value[key] !== undefined, 'manifest-canonical:undefined');
      out[key] = normalizeManifest(value[key], depth + 1);
    }
    return out;
  }
  fail('manifest-canonical:type');
}
function canonicalManifestBytes(manifest) { return Buffer.from(JSON.stringify(normalizeManifest(manifest)),'utf8'); }

function canonicalDevAttestationPayload(a) {
  assert(a && typeof a === 'object' && !Array.isArray(a), 'dev-attestation:shape');
  assert(a.schema === 1 && a.algorithm === 'Ed25519', 'dev-attestation:schema');
  const payload = { schema:1, algorithm:'Ed25519', keyId:String(a.keyId||''), descriptor:a.descriptor, signedAt:String(a.signedAt||''), expiresAt:String(a.expiresAt||'') };
  return JSON.stringify(payload);
}

export function verifyZipArtifact(zipPath, expected, options = {}) {
  assert(fs.existsSync(zipPath), `missing:${expected?.zipFile || path.basename(zipPath)}`);
  assert(SHA256.test(String(expected?.zipSha256 || '')), 'expected:zipSha256');
  assert(sha256File(zipPath) === expected.zipSha256, `${expected.zipFile}:zip-sha`);

  run('unzip', ['-tqq', zipPath]);
  const entries = run('unzip', ['-Z1', zipPath]).split(/\r?\n/).filter(Boolean);
  const files = entries.filter(name => !name.endsWith('/'));
  assert(files.length === expected.zipEntryCount, `${expected.zipFile}:entry-count:${files.length}`);
  assert(new Set(files).size === files.length, `${expected.zipFile}:duplicate-entry`);
  for (const name of files) assert(safeZipPath(name), `${expected.zipFile}:unsafe-path:${name}`);
  const listing = run('zipinfo', ['-l', zipPath]);
  const symlinks = listing.split(/\r?\n/).filter(line => /^l[rwx-]{9}\s/.test(line));
  assert(symlinks.length === 0, `${expected.zipFile}:symlink-entry`);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'zvm-release-asset-'));
  try {
    run('unzip', ['-qq','-o',zipPath,'-d',temp]);
    const manifest = readJson(path.join(temp,'manifest.json'), `${expected.zipFile}:manifest`);
    const identity = readJson(path.join(temp,'app','security','build-identity.json'), `${expected.zipFile}:identity`);
    const integrity = readJson(path.join(temp,'app','security','integrity.json'), `${expected.zipFile}:integrity`);

    assert(String(manifest.version || '') === expected.version, `${expected.zipFile}:manifest-version`);
    if (expected.manifestName) assert(String(manifest.name || '') === expected.manifestName, `${expected.zipFile}:manifest-name`);
    assert(identity.schema === 1, `${expected.zipFile}:identity-schema`);
    for (const field of ['buildId','channel','profile','extensionVersion','securityProtocol','sourceTreeSha256','sourceRevision','createdAt']) {
      const want = field === 'extensionVersion' ? expected.version : expected[field];
      assert(identity[field] === want, `${expected.zipFile}:identity-${field}`);
    }
    const expectedBuildId = `zvm-${expected.channel}-${expected.version}-s${expected.sourceTreeSha256.slice(0,12)}`;
    assert(identity.buildId === expectedBuildId, `${expected.zipFile}:derived-build-id`);

    assert(integrity.format === 'EXTAPP_INTEGRITY_V1' && integrity.schemaVersion === 1, `${expected.zipFile}:integrity-schema`);
    assert(integrity.extensionVersion === expected.version, `${expected.zipFile}:integrity-version`);
    assert(integrity.buildFingerprint === expected.buildFingerprint, `${expected.zipFile}:integrity-fingerprint-declared`);
    assert(Array.isArray(integrity.files) && integrity.files.length === expected.protectedFileCount, `${expected.zipFile}:protected-count`);

    const seen = new Set();
    const canonical = integrity.files.map((entry, index) => {
      const p = String(entry?.path || '');
      const digest = String(entry?.sha256 || '').toLowerCase();
      const size = Number(entry?.size);
      const mode = entry?.mode == null ? null : String(entry.mode);
      assert(safeZipPath(p), `${expected.zipFile}:integrity-path-${index}`);
      assert(!seen.has(p), `${expected.zipFile}:integrity-duplicate:${p}`); seen.add(p);
      assert(SHA256.test(digest), `${expected.zipFile}:integrity-sha:${p}`);
      assert(Number.isInteger(size) && size >= 0, `${expected.zipFile}:integrity-size:${p}`);
      if (mode !== null) assert((p === 'manifest.json' && mode === MANIFEST_MODE) || (BROWSER_ICON_PATHS.has(p) && mode === BROWSER_ICON_MODE), `${expected.zipFile}:integrity-mode:${p}`);
      const out = { path:p, sha256:digest, size };
      if (mode) out.mode = mode;
      return out;
    }).sort((a,b)=>asciiCompare(a.path,b.path));

    const fingerprint = sha256Bytes(Buffer.from(JSON.stringify({extensionVersion:expected.version,files:canonical}),'utf8'));
    assert(fingerprint === expected.buildFingerprint, `${expected.zipFile}:fingerprint-recomputed`);
    assert(integrity.buildFingerprint === fingerprint, `${expected.zipFile}:fingerprint-manifest`);

    for (const item of canonical) {
      const full = path.join(temp, ...item.path.split('/'));
      assert(fs.existsSync(full), `${expected.zipFile}:missing-protected:${item.path}`);
      const st = fs.lstatSync(full);
      assert(st.isFile() && !st.isSymbolicLink(), `${expected.zipFile}:protected-not-file:${item.path}`);
      if (item.mode === MANIFEST_MODE) {
        const bytes = canonicalManifestBytes(readJson(full,`${expected.zipFile}:canonical-manifest`));
        assert(bytes.length === item.size, `${expected.zipFile}:canonical-size:${item.path}`);
        assert(sha256Bytes(bytes) === item.sha256, `${expected.zipFile}:canonical-sha:${item.path}`);
      } else {
        assert(st.size === item.size, `${expected.zipFile}:size:${item.path}`);
        assert(sha256File(full) === item.sha256, `${expected.zipFile}:sha:${item.path}`);
      }
    }
    assert(seen.has('manifest.json'), `${expected.zipFile}:manifest-not-protected`);
    assert(seen.has('app/security/build-identity.json'), `${expected.zipFile}:identity-not-protected`);
    assert(!seen.has('app/security/integrity.json'), `${expected.zipFile}:integrity-self-reference`);
    const browserIconEntries = canonical.filter(x => x.mode === BROWSER_ICON_MODE);
    if (expected.runtimeSemanticIntegrityModes?.[BROWSER_ICON_MODE]) {
      const want=[...expected.runtimeSemanticIntegrityModes[BROWSER_ICON_MODE]].sort(asciiCompare);
      const got=browserIconEntries.map(x=>x.path).sort(asciiCompare);
      assert(JSON.stringify(got)===JSON.stringify(want), `${expected.zipFile}:browser-icon-mode-paths`);
    } else {
      assert(browserIconEntries.length===0, `${expected.zipFile}:unexpected-browser-icon-mode`);
    }

    if (expected.channel === 'dev' && expected.registryPreRegistrationRequired === false) {
      const authority = options.signingAuthority || {};
      const att = integrity.devAttestation;
      assert(att && typeof att === 'object' && !Array.isArray(att), `${expected.zipFile}:dev-attestation-missing`);
      assert(att.keyId === authority.keyId && att.algorithm === 'Ed25519' && att.schema === 1, `${expected.zipFile}:dev-attestation-key`);
      const descriptor = att.descriptor || {};
      const expectedDescriptor = {
        schema:1, securityProtocol:2, buildId:identity.buildId, channel:'dev', profile:'dev',
        extensionVersion:expected.version, extensionId:expected.extensionId, sourceTreeSha256:identity.sourceTreeSha256,
        buildFingerprint:fingerprint, protectedFiles:canonical.length, createdAt:identity.createdAt,
      };
      assert(JSON.stringify(descriptor) === JSON.stringify(expectedDescriptor), `${expected.zipFile}:dev-attestation-descriptor`);
      assert(att.signedAt === expected.devAttestation?.signedAt && att.expiresAt === expected.devAttestation?.expiresAt, `${expected.zipFile}:dev-attestation-time`);
      assert(String(att.signature||'').length >= 80, `${expected.zipFile}:dev-attestation-signature`);
      let publicKey;
      try { publicKey = crypto.createPublicKey({key:Buffer.from(String(authority.publicKeyB64||''),'base64'),format:'der',type:'spki'}); }
      catch { fail(`${expected.zipFile}:dev-public-key-invalid`); }
      const valid = crypto.verify(null, Buffer.from(canonicalDevAttestationPayload(att),'utf8'), publicKey, Buffer.from(String(att.signature||''),'base64url'));
      assert(valid, `${expected.zipFile}:dev-attestation-verify`);
    } else {
      assert(!Object.prototype.hasOwnProperty.call(integrity,'devAttestation'), `${expected.zipFile}:release-must-not-carry-dev-attestation`);
    }

    return { zipFile:expected.zipFile, zipSha256:expected.zipSha256, buildFingerprint:fingerprint, protectedFileCount:canonical.length, zipEntryCount:files.length };
  } finally {
    fs.rmSync(temp,{recursive:true,force:true});
  }
}

export function verifyReleaseAssets(root, assetsDir) {
  const manifest = readJson(path.join(root,'release','ZVM_RELEASE_MANIFEST.json'),'release-manifest');
  const results = [];
  for (const key of ['dev','beta']) {
    const expected = manifest.extensions?.[key];
    assert(expected && typeof expected === 'object', `manifest:${key}`);
    results.push(verifyZipArtifact(path.join(assetsDir,expected.zipFile),expected,{signingAuthority:manifest.server?.devSigningAuthority}));
  }
  return results;
}

function argValue(argv, key, fallback) {
  const i=argv.indexOf(key); return i>=0 && argv[i+1] ? path.resolve(argv[i+1]) : fallback;
}
if (path.resolve(process.argv[1] || '') === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const scriptDir=path.dirname(fileURLToPath(import.meta.url));
    const root=argValue(process.argv.slice(2),'--root',path.resolve(scriptDir,'..'));
    const assetsDir=argValue(process.argv.slice(2),'--assets-dir',path.resolve(root,'release-assets'));
    const results=verifyReleaseAssets(root,assetsDir);
    for (const r of results) console.log(`RELEASE_ASSET_OK ${r.zipFile} sha256=${r.zipSha256} fingerprint=${r.buildFingerprint} protected=${r.protectedFileCount}`);
  } catch (error) {
    console.error(error?.message || String(error));
    process.exitCode=1;
  }
}
