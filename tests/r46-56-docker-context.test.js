'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function checkDockerfile(contents, readFile = rel => fs.existsSync(path.join(root, rel))) {
  const errors = [];
  // Normalize Dockerfile line continuations before inspecting COPY sources.
  const normalized = contents.replace(/\\\r?\n\s*/g, ' ');
  const copies = [...normalized.matchAll(/^COPY --chown=node:node\s+([^\n]+)$/gm)]
    .map(m => m[1].trim().split(/\s+/).slice(0, -1)).flat();
  const included = new Set(copies);
  const required = [
    'server.js', 'mailer.js', 'build-authority.js', 'client-ip-policy.js',
    'dev-build-signing.js', 'extension-origin-policy.js', 'legacy-v3-shield.js',
    'runtime-config.js', 'zvm-official-builds.json', 'zvm-build-registry-v2.json',
    'src', 'assets', 'security',
  ];
  for (const name of required) {
    if (!included.has(name)) errors.push('runtime_path_not_copied:' + name);
    if (!readFile(name)) errors.push('runtime_path_absent_from_repository:' + name);
  }
  if (!/^COPY package\.json package-lock\.json \.\/$/m.test(normalized))
    errors.push('locked_dependencies_not_copied');
  if (!normalized.includes('RUN npm ci --omit=dev'))
    errors.push('npm_ci_not_enforced');
  if (!/^FROM node:24\.21\.0-alpine$/m.test(normalized))
    errors.push('unexpected_node_runtime');
  if (!/^USER node$/m.test(normalized))
    errors.push('nonroot_execution_missing');
  if (/^COPY\s+(?:\.|\.\/)(?:\s|$)/m.test(normalized))
    errors.push('unbounded_context_copy');
  return {ok: errors.length === 0, required: required.length, errors};
}
if (require.main === module) {
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const result = checkDockerfile(dockerfile);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(checkDockerfile(dockerfile.replace('COPY --chown=node:node assets ./assets', '# no assets')).ok, false);
  assert.equal(checkDockerfile(dockerfile.replace('    runtime-config.js ', '    ')).ok, false);
  assert.equal(checkDockerfile(dockerfile.replace('USER node', 'USER root')).ok, false);
  assert.equal(checkDockerfile(dockerfile.replace('RUN npm ci', 'RUN npm install')).ok, false);
  assert.equal(checkDockerfile(dockerfile.replace('FROM node:24.21.0-alpine', 'FROM node:26-alpine')).ok, false);
  console.log('R46.56 Docker runtime context contract: 6 scenarios PASS (no container built)');
}
module.exports = {checkDockerfile};
