'use strict';
// R24 large-file chunk protocol. No plaintext credentials or WhatsApp transport.
const crypto=require('node:crypto');
const Media=require('./media-domain');
const CHUNK_BYTES=256*1024;
const MAX_FILE=32*1024*1024,MAX_ACCOUNT=128*1024*1024,MAX_ITEMS=60;
const TTL_MS=24*60*60*1000;
const MIME_TYPES=new Set(['image/jpeg','image/png','image/webp','application/pdf','audio/mpeg','audio/ogg','video/mp4']);
const DIGEST=/^[a-f0-9]{64}$/,UPLOAD=/^[a-f0-9]{32}$/,FILE_ID=/^m_[a-f0-9]{40}$/;
function fail(code){const e=new Error(code);e.code=code;throw e;}
function sha(data){return crypto.createHash('sha256').update(data).digest('hex');}
function ownerId(email){return sha('zvm-cloud-large-media-v1:'+String(email||'').trim().toLowerCase());}
function isSupportedMime(mime){return MIME_TYPES.has(mime);}
function specOf(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('invalid_upload');
 const name=String(input.name||'').trim();
 if(!name||name.length>120||/[/\\\x00-\x1f\x7f]/.test(name))fail('invalid_media_name');
 const mime=String(input.mime||'').trim().toLowerCase();
 if(!MIME_TYPES.has(mime))fail('media_type_denied');
 if(!Number.isSafeInteger(input.size)||input.size<=0||input.size>MAX_FILE)fail('large_media_limit');
 const digest=String(input.sha256||'').toLowerCase();
 if(!DIGEST.test(digest))fail('media_digest_invalid');
 return {name,mime,size:input.size,sha256:digest,id:'m_'+digest.slice(0,40),
  chunkBytes:CHUNK_BYTES,chunks:Math.ceil(input.size/CHUNK_BYTES)};
}
function expectedSize(spec,index){
 if(!Number.isSafeInteger(index)||index<0||index>=spec.chunks)fail('invalid_chunk_index');
 return Math.min(CHUNK_BYTES,spec.size-index*CHUNK_BYTES);
}
function validateChunk(spec,index,bytes,hash){
 if(!Buffer.isBuffer(bytes)||bytes.length!==expectedSize(spec,index))fail('invalid_chunk_size');
 if(typeof hash!=='string'||!DIGEST.test(hash.toLowerCase())||sha(bytes)!==hash.toLowerCase())fail('chunk_integrity_failed');
 return {size:bytes.length,sha256:hash.toLowerCase()};
}
function validateWhole(spec,segments){
 let count=0,length=0,first=null;
 const digest=crypto.createHash('sha256');
 for(const chunk of segments){
  const bytes=Buffer.from(chunk);
  const expected=expectedSize(spec,count);
  if(bytes.length!==expected)fail('large_media_corrupt_chunk');
  if(!first)first=bytes.subarray(0,Math.min(bytes.length,32));
  digest.update(bytes);length+=bytes.length;count++;
 }
 if(count!==spec.chunks||length!==spec.size||digest.digest('hex')!==spec.sha256)fail('large_media_digest_mismatch');
 if(!Media.mimeDetected(first,spec.mime))fail('media_signature_invalid');
 return true;
}
function publicFile(file){
 const {id,name,mime,size,sha256,uploadedAt}=file;
 return {id,name,mime,size,sha256,uploadedAt,storage:'chunked'};
}
function publicUpload(u){
 if(!u)return null;
 return {uploadId:u.uploadId||u._id||u.id,name:u.name,mime:u.mime,size:u.size,sha256:u.sha256,
  receivedBytes:u.receivedBytes||0,nextIndex:u.nextIndex||0,totalChunks:u.chunks,chunkBytes:CHUNK_BYTES,expiresAt:u.expiresAt};
}
function combined(legacy,large){
 const native=Media.output(legacy);
 const chunks=large||[];
 return {...native,usedBytes:native.usedBytes+chunks.reduce((n,r)=>n+r.size,0),
  quotaBytes:MAX_ACCOUNT,maxFileBytes:MAX_FILE,maxItems:MAX_ITEMS,
  items:[...native.items,...chunks.map(publicFile)],chunkUploadSupported:true,chunkBytes:CHUNK_BYTES,
  note:'Até 32 MB por arquivo e 128 MB por conta nesta fase de QA; backup de 1 GB ainda não suportado.'};
}
module.exports={CHUNK_BYTES,MAX_FILE,MAX_ACCOUNT,MAX_ITEMS,TTL_MS,DIGEST,UPLOAD,FILE_ID,isSupportedMime,
 specOf,expectedSize,validateChunk,validateWhole,publicFile,publicUpload,combined,ownerId,sha,fail};
