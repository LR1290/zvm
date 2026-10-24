#!/usr/bin/env node
/**
 * Offline security gate for an unpacked Chrome Web Store RELEASE.
 * No network access, writes or changes to customer data.
 */
import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const arr = value => Array.isArray(value) ? value : [];
const broad = /^(?:\*|https?|wss?):\/\/\*\/\*$/i;
async function readOptional(path) {
  try { return await readFile(path, 'utf8'); }
  catch (e) { if (e?.code === 'ENOENT') return null; throw e; }
}
export async function auditRelease(dir) {
  const root = resolve(dir), errors = [], observations = [];
  const add = (id, message) => errors.push({id, message});
  let manifest;
  try { manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')); }
  catch { return {ok:false, root, errors:[{id:'INVALID_MANIFEST',message:'Manifesto ausente ou inválido'}], observations}; }
  if (manifest.manifest_version !== 3) add('NOT_MV3', 'Manifest V3 obrigatório');
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(String(manifest.version || ''))) add('INVALID_VERSION', 'Versão inválida');
  if (Object.hasOwn(manifest, 'key')) add('DEV_KEY_IN_RELEASE', 'Manifest.key DEV não permitido na RELEASE');
  if (/(?:dev|debug|qa|lab)/i.test(String(manifest.version_name || ''))) add('DEV_SUFFIX_IN_RELEASE', 'Sufixo de versão DEV');
  const permissions = [...arr(manifest.permissions),...arr(manifest.optional_permissions)];
  if (permissions.includes('webRequest') || permissions.includes('webRequestBlocking')) add('NETWORK_DIAGNOSTIC_PERMISSION', 'webRequest não aprovado para RELEASE');
  const hosts = [...arr(manifest.host_permissions),...arr(manifest.optional_host_permissions)];
  for(const h of hosts) if(broad.test(h) || h === '<all_urls>') add('BROAD_HOST_PERMISSION', 'Origem ampla: ' + h);
  if (/'unsafe-eval'/.test(String(manifest.content_security_policy?.extension_pages || ''))) add('UNSAFE_EVAL', 'unsafe-eval na CSP');
  try {
    if ((await stat(join(root, 'app/background/authority/dev-csp-probe.js'))).isFile())
      add('DEV_PROBE_PACKAGED', 'dev-csp-probe.js empacotado na RELEASE');
  } catch(e) { if (e?.code !== 'ENOENT') throw e; }
  const workerFile = manifest.background?.service_worker || 'app/background/service-worker.js';
  const worker = await readOptional(join(root, workerFile));
  if (worker?.includes('dev-csp-probe.js')) add('DEV_PROBE_IMPORTED', 'Service worker importa dev-csp-probe.js');
  observations.push({id:'VERSION',value:String(manifest.version || '')},{id:'PERMISSIONS',value:permissions.length},{id:'HOSTS',value:hosts.length});
  return {ok:errors.length===0,root,errors,observations};
}
if(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if(!process.argv[2]) { console.error('Uso: node tools/audit-extension-release.mjs <pasta-extraida>'); process.exitCode=2; }
  else {
    try { const result=await auditRelease(process.argv[2]); console.log(JSON.stringify(result,null,2)); if(!result.ok) process.exitCode=1; }
    catch(e) { console.error('ERRO_AUDITORIA:',e?.code || e?.name || 'UNKNOWN'); process.exitCode=2; }
  }
}
