'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const provision=path.join(__dirname,'..','tools','lite-provision-dev.js');
test('offline LITE provisioning creates separate keys and never prints private material',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'zvm-lite-r52-'));
  const dest=path.join(tmp,'identity');
  try {
    const run=spawnSync(process.execPath,[provision,'--out',dest],{encoding:'utf8',timeout:20000});
    assert.equal(run.status,0,(run.stderr||'')+(run.stdout||''));
    const files=fs.readdirSync(dest).sort();
    assert.deepEqual(files.sort(),[
      'lite-build-ed25519-private.pem',
      'lite-chrome-crx-private.pem',
      'lite-identity-PUBLIC.json',
      'lite-server-env-PUBLIC.txt',
    ].sort());
    assert.doesNotMatch(run.stdout,/BEGIN (?:PRIVATE|RSA PRIVATE) KEY/);
    const publicJson=JSON.parse(fs.readFileSync(path.join(dest,'lite-identity-PUBLIC.json'),'utf8'));
    assert.equal(publicJson.productId,'zvm_lite');
    assert.match(publicJson.devExtensionId,/^[a-p]{32}$/);
    assert.equal(publicJson.keyId,'lite-dev-ed25519-v1');
    const rsaPublic=crypto.createPublicKey({key:Buffer.from(publicJson.manifestKey,'base64'),type:'spki',format:'der'});
    const rsaPriv=crypto.createPrivateKey(fs.readFileSync(path.join(dest,'lite-chrome-crx-private.pem'),'utf8'));
    assert.equal(rsaPublic.asymmetricKeyType,'rsa');
    const proof=crypto.sign('sha256',Buffer.from('r52-local'),rsaPriv);
    assert.equal(crypto.verify('sha256',Buffer.from('r52-local'),rsaPublic,proof),true);
    const edPublic=crypto.createPublicKey({key:Buffer.from(publicJson.ed25519PublicSpkiBase64,'base64'),type:'spki',format:'der'});
    const edPrivate=crypto.createPrivateKey(fs.readFileSync(path.join(dest,'lite-build-ed25519-private.pem'),'utf8'));
    assert.equal(edPublic.asymmetricKeyType,'ed25519');
    const sig=crypto.sign(null,Buffer.from('lite-r52'),edPrivate);
    assert.equal(crypto.verify(null,Buffer.from('lite-r52'),edPublic,sig),true);
    const envText=fs.readFileSync(path.join(dest,'lite-server-env-PUBLIC.txt'),'utf8');
    assert.match(envText,/ZVM_LITE_V4_ENABLED=false/);
    assert.match(envText,new RegExp('ZVM_LITE_DEV_EXTENSION_ID='+publicJson.devExtensionId));
    assert.doesNotMatch(envText,/PRIVATE KEY|BEGIN PRIVATE|pkcs8/i);
    const second=spawnSync(process.execPath,[provision,'--out',dest],{encoding:'utf8'});
    assert.notEqual(second.status,0,'never overwrite existing identity');
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
test('offline provisioning refuses any target within source tree',()=>{
  const illegal=path.join(__dirname,'..','.zvm-private-scratch');
  const run=spawnSync(process.execPath,[provision,'--out',illegal],{encoding:'utf8'});
  assert.notEqual(run.status,0);
  assert.equal(fs.existsSync(illegal),false);
});
