'use strict';
// R89: independent, local-only backup/restore receipt.
// A real backup archive is REQUIRED before production copy; this file never writes MongoDB.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const FORMAT='zvm-mongo-local-restore-proof-v1';
const REQUIRED_COLLECTIONS=20;
const REQUIRED_INDEXES=49;
function fail(code){const e=new Error('ZVM_DB_BACKUP_'+code);e.code='ZVM_DB_BACKUP_'+code;throw e;}
function readJson(file) {
  if(typeof file!=='string'||!file.trim())fail('PATH_REQUIRED');
  const filePath=path.resolve(file);
  const st=fs.lstatSync(filePath);
  if(!st.isFile()||st.isSymbolicLink()||st.size>65536)fail('INVALID_JSON_FILE');
  return JSON.parse(fs.readFileSync(filePath,'utf8'));
}
function archivePathFromManifest(manifestPath,manifest) {
  const n=String(manifest.archiveFile||'');
  if(!n||n==='.'||n==='..'||path.basename(n)!==n||!n.endsWith('.archive.gz'))fail('ARCHIVE_FILENAME_INVALID');
  const f=path.resolve(path.dirname(path.resolve(manifestPath)),n);
  const st=fs.lstatSync(f);
  if(!st.isFile()||st.isSymbolicLink()||st.size<128)fail('ARCHIVE_INVALID');
  if(!Number.isSafeInteger(manifest.sizeBytes)||st.size!==manifest.sizeBytes)fail('ARCHIVE_SIZE_MISMATCH');
  return f;
}
async function fileSha256(filename) {
  const h=crypto.createHash('sha256');
  for await(const chunk of fs.createReadStream(filename))h.update(chunk);
  return h.digest('hex');
}
async function validatedBackup(manifestPath,{pauseRequired=true}={}) {
  const manifest=readJson(manifestPath);
  if(manifest.sourceDatabase!=='zapvoice'||manifest.dryRunVerified!==true)fail('MANIFEST_NOT_VERIFIED');
  if(pauseRequired&&manifest.writersReportedPaused!==true)fail('WRITERS_NOT_DECLARED_PAUSED');
  if(!/^[a-f0-9]{64}$/i.test(String(manifest.sha256||'')))fail('MANIFEST_HASH_INVALID');
  const archive=archivePathFromManifest(manifestPath,manifest);
  const actual=await fileSha256(archive);
  if(actual.toLowerCase()!==manifest.sha256.toLowerCase())fail('ARCHIVE_HASH_MISMATCH');
  return {manifest,archive,sha256:actual};
}
function validateRestoreProof(proof,sha256) {
  if(!proof||proof.format!==FORMAT||proof.sourceDatabase!=='zapvoice')fail('RESTORE_PROOF_INVALID');
  if(proof.archiveSha256!==sha256||proof.cleanupConfirmed!==true||proof.localOnly!==true)fail('RESTORE_PROOF_MISMATCH');
  if(!/^[a-f0-9]{64}$/.test(String(proof.sourceChecksum||'')))fail('RESTORE_SOURCE_CHECKSUM_INVALID');
  if(!Number.isSafeInteger(proof.collections)||proof.collections<REQUIRED_COLLECTIONS)fail('RESTORE_COLLECTIONS_INCOMPLETE');
  if(!Number.isSafeInteger(proof.indexes)||proof.indexes<REQUIRED_INDEXES)fail('RESTORE_INDEXES_INCOMPLETE');
  for(const field of ['legacyOrOfficialKeyCount','portalUserCount','paymentCount']){
    if(!Number.isSafeInteger(proof[field])||proof[field]<1)fail('RESTORE_CRITICAL_RECORDS_MISSING');
  }
  const verified=Date.parse(proof.verifiedAtUtc);
  if(!Number.isFinite(verified)||verified<=0||verified>Date.now()+300000)fail('RESTORE_TIME_INVALID');
  return true;
}
async function validateBackupGate(env=process.env) {
  const manifestPath=String(env.ZVM_MONGO_BACKUP_MANIFEST||'');
  const proofPath=String(env.ZVM_MONGO_RESTORE_PROOF||'');
  const {sha256}=await validatedBackup(manifestPath,{pauseRequired:true});
  const proof=readJson(proofPath);
  validateRestoreProof(proof,sha256);
  return {verified:true,sha256,sourceChecksum:proof.sourceChecksum};
}
function localUri(raw) {
  const str=String(raw||'mongodb://127.0.0.1:27017');
  let parsed;
  try{parsed=new URL(str);}catch{fail('LOCAL_RESTORE_URI_INVALID');}
  if(parsed.protocol!=='mongodb:'||!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)||
    parsed.username||parsed.password||parsed.search||parsed.hash||
    (parsed.pathname!==''&&parsed.pathname!=='/')||str.includes(',')) {
    fail('LOCAL_RESTORE_NOT_LOOPBACK');
  }
  return str;
}
module.exports={FORMAT,REQUIRED_COLLECTIONS,REQUIRED_INDEXES,readJson,archivePathFromManifest,
  fileSha256,validatedBackup,validateRestoreProof,validateBackupGate,localUri};
