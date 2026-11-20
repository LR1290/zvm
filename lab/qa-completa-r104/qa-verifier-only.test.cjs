'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {loadQaVerifierConfig}=require('./qa-verifier-only.cjs');
const {DEV_EXTENSION_ID}=require('./preflight-qa.cjs');
const pair=crypto.generateKeyPairSync('ed25519');
const sample=Buffer.from('R105-QA-Ed25519-verification-only');
const signature=crypto.sign(null,sample,pair.privateKey);
const valid=()=>({
  ZVM_QA_SCOPE:'zvm-completa-r104',ZVM_QA_PUBLIC_HOSTNAME:'zvm-completa-qa-r104.onrender.com',
  RENDER_EXTERNAL_HOSTNAME:'zvm-completa-qa-r104.onrender.com',
  MONGODB_DB:'zvm_completa_qa_r103',ZVM_QA_ATLAS_HOST:'qa-r104.abcd1234.mongodb.net',
  MONGODB_URI:'mongodb+srv://zvm_completa_qa_runner:synthetic-fixture@qa-r104.abcd1234.mongodb.net/zvm_completa_qa_r103',
  ZVM_EXTENSION_IDS:DEV_EXTENSION_ID,ZVM_QA_FREE_SUBJECT:'a'.repeat(64),
  ADMIN_USER:'qa-admin',ADMIN_PASS:'synthetic-pass-12345',APP_SECRET:'x'.repeat(48),
  ZVM_QA_VERIFY_ONLY:'1',ZVM_DEV_SIGNED_BUILDS_ALLOW:'1',
  ZVM_DEV_EXTENSION_ID:DEV_EXTENSION_ID,ZVM_DEV_SIGNING_KEY_ID:'dev-2026-01',
  ZVM_DEV_SIGNING_PUBLIC_KEY_B64:pair.publicKey.export({format:'der',type:'spki'}).toString('base64'),
});
test('QA accepts public-only Ed25519 verification, without signing capability',()=>{
  const conf=loadQaVerifierConfig(valid());
  assert.equal(conf.enabled,true);
  assert.equal(conf.privateKey,null);
  assert.equal(conf.signingEnabled,false);
  assert.equal(conf.publicKeys.size,1);
  assert(crypto.verify(null,sample,conf.publicKeys.get('dev-2026-01'),signature));
  assert.equal(conf.agentTokenHash,'');
});
for(const [name,mutation,code] of [
  ['disabled', {ZVM_QA_VERIFY_ONLY:'0'}, 'QA_PUBLIC_VERIFIER_NOT_ENABLED'],
  ['server signer key injected',{ZVM_DEV_SIGNING_PRIVATE_KEY_B64:'SECRET'},'QA_PRIVATE_SIGNER_MUST_NOT_BE_ON_SERVER'],
  ['server agent hash injected',{ZVM_DEV_BUILD_AGENT_TOKEN_SHA256:'a'.repeat(64)},'QA_PRIVATE_SIGNER_MUST_NOT_BE_ON_SERVER'],
  ['wrong extension',{ZVM_DEV_EXTENSION_ID:'bdhnikgcdccjabkmbfcakgjkkgdlmgja'},'QA_DEV_IDENTITY_MISMATCH'],
  ['wrong key ID',{ZVM_DEV_SIGNING_KEY_ID:'dev-2026-02'},'QA_DEV_IDENTITY_MISMATCH'],
  ['invalid public key',{ZVM_DEV_SIGNING_PUBLIC_KEY_B64:'not-a-key'},'QA_PUBLIC_KEY_INVALID'],
  ['production origin',{ZVM_QA_PUBLIC_HOSTNAME:'zvm.onrender.com'},'QA_PUBLIC_HOST_NOT_EXCLUSIVE'],
]) test('verification fails closed: '+name,()=>assert.throws(()=>loadQaVerifierConfig({...valid(),...mutation}),{code}));
