import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {auditLiteSource} from '../tools/audit-lite-source.mjs';
const at=Date.parse('2026-11-19T17:00:00.000Z');
const created='2026-11-19T16:00:00.000Z',signed='2026-11-19T16:00:01.000Z',expires='2026-11-20T17:00:00.000Z';
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const canon=v=>Array.isArray(v)?'['+v.map(canon).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}':JSON.stringify(v);
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'zvm-lite-fixture-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),ed=crypto.generateKeyPairSync('ed25519');
  const rsaDer=rsa.publicKey.export({format:'der',type:'spki'});
  const bytes=crypto.createHash('sha256').update(rsaDer).digest().subarray(0,16);
  const extensionId=Array.from(bytes).map(b=>String.fromCharCode(97+(b>>4),97+(b&15))).join('');
  const ver='0.1.81',source=sha('fictitious source R81'),buildId='zvm-lite-dev-'+ver+'-s'+source.slice(0,12);
  const manifest={manifest_version:3,name:'R81 fixture only',version:ver,version_name:'0.1.81-dev+TEST',key:rsaDer.toString('base64')};
  const identity={schema:1,securityProtocol:2,buildId,channel:'dev',profile:'dev',extensionVersion:ver,sourceTreeSha256:source};
  const publicKey=ed.publicKey.export({format:'der',type:'spki'}).toString('base64');
  const content={
    'manifest.json':JSON.stringify(manifest),
    'app/security/build-identity.json':JSON.stringify(identity),
    'app/shared/core/lite-dev-identity.js':"var devExtensionId='"+extensionId+"';\nvar devPublicKeyId='lite-r81-fixture';\nvar devPublicKeySpkiBase64='"+publicKey+"';"
  };
  for(let i=0;i<8;i++)content['app/fake/asset'+i+'.js']='// test-only asset '+i+'\n'+('x'.repeat(i*9+2));
  const entries=Object.entries(content).map(([n,v])=>{
    const bytes=n==='manifest.json'?Buffer.from(canon(Object.fromEntries(Object.entries(manifest).filter(([k])=>k!=='key')))):Buffer.from(v);
    return {path:n,sha256:sha(bytes),size:bytes.length,...(n==='manifest.json'?{mode:'manifest-json-v1'}:{})};
  }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const fingerprint=sha(Buffer.from(JSON.stringify({extensionVersion:ver,files:entries})));
  const desc={schema:1,securityProtocol:2,buildId,channel:'dev',profile:'dev',extensionVersion:ver,extensionId,sourceTreeSha256:source,buildFingerprint:fingerprint,protectedFiles:entries.length,createdAt:created};
  const attBody={schema:1,algorithm:'Ed25519',keyId:'lite-r81-fixture',descriptor:desc,signedAt:signed,expiresAt:expires};
  const att={...attBody,signature:crypto.sign(null,Buffer.from(JSON.stringify(attBody)),ed.privateKey).toString('base64url')};
  content['app/security/integrity.json']=JSON.stringify({format:'EXTAPP_INTEGRITY_V1',schemaVersion:1,extensionVersion:ver,buildFingerprint:fingerprint,files:entries,devAttestation:att});
  const payload={schema:'zvm-lite-build-v1',audience:'zvm-lite-v4-server',productId:'zvm_lite',channel:'dev',extensionId,buildId,sha256:fingerprint,keyId:'lite-r81-fixture',issuedAt:created,expiresAt:expires};
  content['app/security/lite-v4-signed-build.json']=JSON.stringify({payload,signatureBase64:crypto.sign(null,Buffer.from(JSON.stringify(payload)),ed.privateKey).toString('base64')});
  for(const [name,value] of Object.entries(content)){const loc=path.join(root,name);fs.mkdirSync(path.dirname(loc),{recursive:true});fs.writeFileSync(loc,value);}
  return {root};
}
const audit=state=>auditLiteSource(state.root,at);
test('R81: valid synthetic Ed25519 LITE tree passes',t=>{
  const a=fixture(t),r=audit(a);assert.equal(r.ok,true,JSON.stringify(r.issues));assert.equal(r.protectedFiles,11);
});
test('R81: stale hash fails even while both old Ed25519 signatures remain valid',t=>{
  const a=fixture(t);fs.appendFileSync(path.join(a.root,'app/fake/asset1.js'),'tampered');
  const r=audit(a);assert.equal(r.ok,false);assert(r.issues.some(x=>x.code==='FILE_SHA256_MISMATCH'));
});
test('R81: newly added runtime file is not silently accepted unsigned',t=>{
  const a=fixture(t);fs.writeFileSync(path.join(a.root,'app/fake/unsigned.js'),'// untracked');
  const r=audit(a);assert.equal(r.ok,false);assert(r.issues.some(x=>x.code==='UNPROTECTED_SOURCE'));
});
test('R81: deleted protected file is detected',t=>{
  const a=fixture(t);fs.unlinkSync(path.join(a.root,'app/fake/asset2.js'));
  const r=audit(a);assert(r.issues.some(x=>x.code==='PROTECTED_FILE_MISSING'));
});
test('R81: forged V4 signature is rejected',t=>{
  const a=fixture(t),p=path.join(a.root,'app/security/lite-v4-signed-build.json');
  const v=JSON.parse(fs.readFileSync(p));v.signatureBase64='A'.repeat(88);fs.writeFileSync(p,JSON.stringify(v));
  const r=audit(a);assert(r.issues.some(x=>x.code==='V4_SIGNATURE_INVALID'));
});
test('R81: expired attestation and descriptor fail closed',t=>{
  const a=fixture(t),r=auditLiteSource(a.root,Date.parse('2026-11-22T00:00:00.000Z'));
  assert(r.issues.some(x=>x.code==='ATTESTATION_EXPIRED'));
  assert(r.issues.some(x=>x.code==='V4_DESCRIPTOR_EXPIRED'));
});
test('R81: source symlinks are not followed',t=>{
  const a=fixture(t);fs.symlinkSync(path.join(a.root,'manifest.json'),path.join(a.root,'app/fake/link.js'));
  assert.throws(()=>audit(a),/UNSAFE_SOURCE_TREE/);
});
