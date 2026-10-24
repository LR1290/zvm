import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { auditRelease } from '../tools/audit-extension-release.mjs';

async function fixture(manifest, worker='', probe=false) {
  const root=await mkdtemp(join(tmpdir(),'zvm-gate-'));
  await mkdir(join(root,'app/background/authority'),{recursive:true});
  await writeFile(join(root,'manifest.json'),JSON.stringify({manifest_version:3,version:'0.9.266',background:{service_worker:'app/background/service-worker.js'},...manifest}));
  await writeFile(join(root,'app/background/service-worker.js'),worker);
  if(probe) await writeFile(join(root,'app/background/authority/dev-csp-probe.js'),'// dev only');
  return root;
}
async function check(manifest,worker,probe,verify) {
  const root=await fixture(manifest,worker,probe);
  try { await verify(await auditRelease(root)); }
  finally { await rm(root,{recursive:true,force:true}); }
}
test('clean MV3 release passes', async ()=>{
  await check({permissions:['storage'],host_permissions:['https://web.whatsapp.com/*']},'',false,r=>assert.equal(r.ok,true));
});
test('webRequest and broad host permissions rejected',async()=>{
  await check({optional_permissions:['webRequest'],optional_host_permissions:['https://*/*']},'',false,r=>{
    assert.ok(r.errors.some(e=>e.id==='NETWORK_DIAGNOSTIC_PERMISSION'));
    assert.ok(r.errors.some(e=>e.id==='BROAD_HOST_PERMISSION'));
  });
});
test('DEV key, suffix and probe rejected',async()=>{
  await check({key:'DEV_KEY',version_name:'0.9.266-dev+R'},'importScripts("authority/dev-csp-probe.js")',true,r=>{
    for(const id of ['DEV_KEY_IN_RELEASE','DEV_SUFFIX_IN_RELEASE','DEV_PROBE_IMPORTED','DEV_PROBE_PACKAGED']) assert.ok(r.errors.some(e=>e.id===id));
  });
});
test('invalid manifest rejected',async()=>{
  const root=await mkdtemp(join(tmpdir(),'zvm-gate-'));
  try { assert.ok((await auditRelease(root)).errors.some(e=>e.id==='INVALID_MANIFEST')); }
  finally { await rm(root,{recursive:true,force:true}); }
});
