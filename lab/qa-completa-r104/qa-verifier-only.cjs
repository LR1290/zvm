'use strict';
// QA only: verify Ed25519 attestations with the public key. The owner keeps
// the private signing key offline. Deliberately no signing capability here.
const crypto = require('node:crypto');
const {checkQaEnvironment, DEV_EXTENSION_ID} = require('./preflight-qa.cjs');
function refusal(code) {const e=Error(code);e.code=code;throw e;}
function loadQaVerifierConfig(env=process.env) {
  checkQaEnvironment(env);
  if (env.ZVM_QA_VERIFY_ONLY !== '1' || env.ZVM_DEV_SIGNED_BUILDS_ALLOW !== '1')
    refusal('QA_PUBLIC_VERIFIER_NOT_ENABLED');
  if (env.ZVM_DEV_EXTENSION_ID !== DEV_EXTENSION_ID ||
      env.ZVM_DEV_SIGNING_KEY_ID !== 'dev-2026-01') refusal('QA_DEV_IDENTITY_MISMATCH');
  if (String(env.ZVM_DEV_SIGNING_PRIVATE_KEY_B64 || '').trim() ||
      String(env.ZVM_DEV_BUILD_AGENT_TOKEN_SHA256 || '').trim())
    refusal('QA_PRIVATE_SIGNER_MUST_NOT_BE_ON_SERVER');
  const raw=String(env.ZVM_DEV_SIGNING_PUBLIC_KEY_B64 || '').trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) refusal('QA_PUBLIC_KEY_INVALID');
  let publicKey;
  try {
    publicKey=crypto.createPublicKey({key:Buffer.from(raw,'base64'),format:'der',type:'spki'});
  } catch (_) {refusal('QA_PUBLIC_KEY_INVALID');}
  if (publicKey.asymmetricKeyType !== 'ed25519') refusal('QA_PUBLIC_KEY_NOT_ED25519');
  return Object.freeze({
    enabled:true, signingEnabled:false, keyId:'dev-2026-01', privateKey:null,
    publicKeys:new Map([['dev-2026-01',publicKey]]),
    expectedExtensionId:DEV_EXTENSION_ID, agentTokenHash:'',
    maxBuildAgeMs:7*24*60*60*1000, sessionTtlMs:12*60*60*1000,
  });
}
module.exports={loadQaVerifierConfig};
