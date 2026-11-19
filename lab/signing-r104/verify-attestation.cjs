const fs=require('node:fs');
const verifier=require('../../dev-build-signing');
const att=JSON.parse(fs.readFileSync(0,'utf8'));
const pub=verifier.importEd25519PublicKeyB64(fs.readFileSync(__dirname+'/dev-public.spki.b64','utf8'));
const result=verifier.verifyDevBuildAttestation(att,{publicKeys:new Map([['dev-2026-01',pub]]),expectedExtensionId:'ckbffcbmanboelbihfkhiahgafnimcho'});
if(!result.ok)throw Error(result.code);
