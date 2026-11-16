'use strict';
// Pilot-safe Mongo document media vault (not suitable for large production media).
const crypto=require('node:crypto');
const MAX_FILE=1024*1024,MAX_USER=6*1024*1024,MAX_ITEMS=24;
const MIMES=new Set(['image/jpeg','image/png','image/webp','application/pdf','audio/mpeg','audio/ogg','video/mp4']);
function fail(code){const e=new Error(code);e.code=code;throw e;}
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function mimeDetected(buffer,mime){
 if(!MIMES.has(mime))return false;
 const b=buffer;
 if(mime==='image/png')return b.length>=8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mime==='image/jpeg')return b.length>=4&&b[0]===255&&b[1]===216&&b[2]===255;
 if(mime==='image/webp')return b.length>=12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';
 if(mime==='application/pdf')return b.length>=5&&b.toString('ascii',0,5)==='%PDF-';
 if(mime==='audio/ogg')return b.length>=4&&b.toString('ascii',0,4)==='OggS';
 if(mime==='audio/mpeg')return b.length>=3&&(b.toString('ascii',0,3)==='ID3'||(b[0]===255&&(b[1]&224)===224));
 if(mime==='video/mp4')return b.length>=12&&b.toString('ascii',4,8)==='ftyp';
 return false;
}
function decode(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('invalid_media');
 const name=String(input.name||'').trim();
 if(!name||name.length>120||/[/\\\x00-\x1f\x7f]/.test(name))fail('invalid_media_name');
 const mime=String(input.mime||'').trim().toLowerCase();
 if(!MIMES.has(mime))fail('media_type_denied');
 const content=String(input.base64||'');
 if(!content||content.length>Math.ceil(MAX_FILE*4/3)+16||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content))fail('media_encoding_denied');
 const bytes=Buffer.from(content,'base64');
 if(!bytes.length||bytes.length>MAX_FILE||bytes.toString('base64')!==content)fail('media_encoding_denied');
 if(!mimeDetected(bytes,mime))fail('media_signature_invalid');
 const digest=sha(bytes);
 if(typeof input.sha256!=='string'||input.sha256.toLowerCase()!==digest)fail('media_digest_mismatch');
 return {id:'m_'+digest.slice(0,40),name,mime,size:bytes.length,sha256:digest,uploadedAt:new Date().toISOString(),bytes};
}
function getBytes(row){
 if(Buffer.isBuffer(row.bytes))return row.bytes;
 if(row.bytes?.buffer)return Buffer.from(row.bytes.buffer);
 return Buffer.from(row.bytes||[]);
}
function output(doc){
 return {revision:doc.revision||0,usedBytes:(doc.items||[]).reduce((v,x)=>v+x.size,0),
  quotaBytes:MAX_USER,maxFileBytes:MAX_FILE,maxItems:MAX_ITEMS,
  items:(doc.items||[]).map(({id,name,mime,size,sha256,uploadedAt})=>({id,name,mime,size,sha256,uploadedAt}))};
}
function add(current,item,rev){
 if(!Number.isSafeInteger(rev)||rev<0||rev!==current.revision)fail('media_revision_conflict');
 const rows=current.items||[];
 const existing=rows.find(x=>x.id===item.id);
 if(existing){
  if(existing.sha256!==item.sha256||existing.mime!==item.mime)fail('media_id_collision');
  return {next:current,duplicate:true};
 }
 if(rows.length>=MAX_ITEMS)fail('media_item_quota');
 const size=rows.reduce((n,r)=>n+r.size,0)+item.size;
 if(size>MAX_USER)fail('media_storage_quota');
 return {next:{revision:rev+1,items:[...rows,item]},duplicate:false};
}
function remove(current,id,rev){
 if(!Number.isSafeInteger(rev)||rev<0||rev!==current.revision)fail('media_revision_conflict');
 if(!/^m_[a-f0-9]{40}$/.test(id))fail('invalid_media_id');
 const rows=current.items||[];
 if(!rows.some(x=>x.id===id))fail('media_not_found');
 return {revision:rev+1,items:rows.filter(x=>x.id!==id)};
}
module.exports={decode,sha,mimeDetected,getBytes,output,add,remove,MAX_FILE,MAX_USER,MAX_ITEMS};