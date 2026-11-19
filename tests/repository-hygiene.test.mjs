import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadRegistryV2 } = require('../build-authority.js');
const STORE_ID = 'bdhnikgcdccjabkmbfcakgjkkgdlmgja';

function trackedFiles() {
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, 'Git tracked-files inventory must be available');
  return result.stdout.split('\0').filter(Boolean);
}

test('repository has no old ZIP/CRX or private signing materials', () => {
  const files = trackedFiles();
  const artifacts = files.filter(file => /\.(?:zip|crx|pem|p12|pfx|key)$/i.test(file));
  assert.deepEqual(artifacts, [], 'Build ZIPs and signing keys belong outside the active backend repository');
});

test('obsolete V740–V746 frozen release asset system does not return', () => {
  const files = trackedFiles();
  const forbidden = files.filter(file => file.startsWith('release-assets/') ||
    ['release/ZVM_RELEASE_MANIFEST.json', 'release/verify-release-assets.mjs',
      'release/verify-release-manifest.mjs', 'RELEASE_SHA256SUMS.txt',
      'R33_BUILD3_COMPAT_VALIDATION.txt', 'R34_V746_BUILD3_COMPAT_VALIDATION.txt',
      'V743_FINAL_VERIFICATION.txt'].includes(file));
  assert.deepEqual(forbidden, [], 'Do not restore retired release ZIPs or validators pinned to them');
});

test('removing archived binaries never removes commercially active Build Registry identities', () => {
  const registry = loadRegistryV2(resolve(root, 'zvm-build-registry-v2.json'));
  assert.ok(registry.size >= 3, 'Build Registry is not a disposable archive');
  for (const version of ['0.9.287', '0.9.288', '0.9.289']) {
    const entry = [...registry.values()].find(item => item.extensionVersion === version &&
      item.status === 'active' && item.channel === 'production' && item.profile === 'release' &&
      item.extensionIds.includes(STORE_ID));
    assert.ok(entry, version + ' commercial clients must not be orphaned');
  }
});
