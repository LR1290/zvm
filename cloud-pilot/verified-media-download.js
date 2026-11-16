'use strict';
// R28: verify the exact bytes that will be served. Once a request owns a
// validated snapshot, deleting/replacing a DB object cannot truncate it.
// Pilot ceiling is 32 MiB/object; at most two concurrent snapshots per worker.
const crypto=require('node:crypto');
const Media=require('./media-domain');
const Large=require('./large-media-domain');
function reject(code){const e=new Error(code);e.code=code;throw e;}
function createDownloadGate({maxConcurrent=2,maxPerAccount=1}={}){
 if(!Number.isSafeInteger(maxConcurrent)||maxConcurrent<1||
    !Number.isSafeInteger(maxPerAccount)||maxPerAccount<1)throw Error('invalid_download_gate');
 let active=0;const owners=new Map();
 function acquire(email){
  const key=Large.ownerId(email);
  const count=owners.get(key)||0;
  if(active>=maxConcurrent||count>=maxPerAccount)reject('download_busy');
  active++;owners.set(key,count+1);
  let released=false;
  return ()=>{
   if(released)return;
   released=true;active--;
   const outstanding=(owners.get(key)||1)-1;
   if(outstanding>0)owners.set(key,outstanding);else owners.delete(key);
  };
 }
 return Object.freeze({acquire,stats:()=>({active,maxConcurrent,activeAccounts:owners.size})});
}
async function verifiedSnapshot(store,email,file,{cancelled=()=>false,signal=null}={}){
 if(!file||!Large.FILE_ID.test(file.id)||!Large.DIGEST.test(file.sha256)||
    !Number.isSafeInteger(file.size)||file.size<=0||file.size>Large.MAX_FILE||
    !Large.isSupportedMime(file.mime))
  reject('large_media_metadata_invalid');
 if(!store?.large||typeof store.large.chunks!=='function')reject('large_media_storage_unavailable');
 const aborted=()=>cancelled()||signal?.aborted===true;
 if(aborted())reject('download_aborted');
 const chunks=[],digest=crypto.createHash('sha256');
 const expectedChunks=Math.ceil(file.size/Large.CHUNK_BYTES);
 let count=0,total=0,first=null;
 for await(const source of store.large.chunks(email,file.id,{signal})){
  if(aborted())reject('download_aborted');
  if(count>=expectedChunks)reject('large_media_corrupt_chunk');
  const part=Buffer.isBuffer(source)?source:Buffer.from(source);
  const expected=Math.min(Large.CHUNK_BYTES,file.size-total);
  if(part.length!==expected)reject('large_media_corrupt_chunk');
  const copy=Buffer.from(part);
  if(!first)first=copy.subarray(0,32);
  total+=copy.length;count++;digest.update(copy);chunks.push(copy);
 }
 if(aborted())reject('download_aborted');
 if(count!==expectedChunks||total!==file.size||digest.digest('hex')!==file.sha256||
    !Media.mimeDetected(first,file.mime))reject('large_media_integrity_failed');
 // Snapshot becomes independent from Mongo cursor/pages and future deletions.
 return Buffer.concat(chunks,total);
}
module.exports={createDownloadGate,verifiedSnapshot};
