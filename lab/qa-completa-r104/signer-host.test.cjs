'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const script=path.join(__dirname,'../signing-r104/preparar.py');
function attempt(host) {
  return spawnSync('python3',[script,'/this-file-must-not-exist-r105.zip','--qa-host',host],
    {encoding:'utf8',timeout:10000});
}
for (const host of ['zvm.onrender.com','zvm-lite-homolog-20261118.onrender.com',
  'zvm-cloud-piloto-privado.onrender.com','zvm-r25-verification.onrender.com',
  'outside.example.com']) {
  test('offline signer refuses non-COMPLETA QA backend '+host,()=>{
    const r=attempt(host);
    if(r.error)throw r.error;
    assert.equal(r.status,2);
    assert.match(r.stderr,/hostname EXCLUSIVO/);
  });
}
test('offline signer accepts only a dedicated QA hostname format (file still required)',()=>{
  const r=attempt('zvm-completa-qa-r104.onrender.com');
  if(r.error)throw r.error;
  assert.notEqual(r.status,0);
  assert.doesNotMatch(r.stderr,/hostname EXCLUSIVO/);
  assert.match(r.stderr,/(FileNotFoundError|No such file or directory)/);
});
