import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const ext = path.join(root, 'extension');
const manifest = JSON.parse(readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
function walk(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
const files = walk(ext);
function check(condition, detail) { if (!condition) throw new Error(`VERIFICATION_FAILED: ${detail}`); }
check(manifest.manifest_version === 3, 'Manifest V3');
check(JSON.stringify(manifest.permissions) === '["storage"]', 'Permissões não mínimas');
check(!manifest.host_permissions && !manifest.externally_connectable, 'Host/external access inesperado');
check(!manifest.key && !manifest.update_url, 'Identidade ou canal legado herdado');
check(manifest.background.type === 'module', 'Worker ES module');
for (const f of [manifest.background.service_worker,manifest.action.default_popup,...manifest.content_scripts.flatMap((e)=>e.js)]) {
  check(files.includes(path.join(ext,f)), `Recurso ausente: ${f}`);
}
for (const file of files) {
  if (file.endsWith('.js')) execFileSync('node', ['--check', file]);
  if (/\.(js|html|css|json)$/.test(file)) {
    const content = readFileSync(file, 'utf8');
    check(!/\b(?:eval\s*\(|new\s+Function\s*\(|importScripts\s*\()/.test(content), `Execução dinâmica: ${file}`);
    check(!/zapvoice|zapsaver|wsm|watidy/i.test(content), `Indicador legado: ${file}`);
  }
}
console.log(`VERIFY_OK: ${files.length} arquivos de extensão, manifesto MV3 e sintaxe conferidos`);
