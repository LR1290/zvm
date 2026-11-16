'use strict';
// ZIP reader for user-selected ZVM backups. Extracts ONLY a bounded JSON manifest,
// validates CRC32 and paths, and never uploads other entries or raw archives.
// No external library, no ZIP64, encryption, multipart, symlinks or executable input.
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else Object.defineProperty(root,'ZVMCloudZip',{value:api,writable:false,configurable:false});
})(typeof self!=='undefined'?self:globalThis,function(){
 const MAX_ARCHIVE=512*1024*1024,MAX_JSON=20*1024*1024,MAX_CENTRAL=2*1024*1024,MAX_ENTRIES=4000;
 const crcTable=new Uint32Array(256);
 for(let n=0;n<256;n++){let c=n;for(let i=0;i<8;i++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);crcTable[n]=c>>>0;}
 function crc32(bytes,initial=0xffffffff){let c=initial;for(const x of bytes)c=crcTable[(c^x)&255]^(c>>>8);return c>>>0;}
 function invalid(code){const err=new Error(code);err.code=code;return err;}
 function u16(v,o){return v.getUint16(o,true);}
 function u32(v,o){return v.getUint32(o,true);}
 function safePath(name){
  if(!name||name.length>320||name.includes('\\')||name.startsWith('/')||/^[A-Za-z]:/.test(name))return false;
  const clean=name.endsWith('/')?name.slice(0,-1):name;
  return clean.split('/').every(part=>part.length>0&&part!=='.'&&part!=='..');
 }
 function metaEntry(file,v,p,end){
  if(p+46>end||u32(v,p)!==0x02014b50)throw invalid('zip_bad_directory');
  const flags=u16(v,p+8),method=u16(v,p+10),nameLen=u16(v,p+28),extraLen=u16(v,p+30),commentLen=u16(v,p+32);
  const tail=p+46+nameLen+extraLen+commentLen;
  if(tail>end||flags&1||flags&0x40||![0,8].includes(method)||u16(v,p+34)!==0)throw invalid('zip_unsupported_feature');
  const size=u32(v,p+24),packed=u32(v,p+20),offset=u32(v,p+42);
  if(size===0xffffffff||packed===0xffffffff||offset===0xffffffff)throw invalid('zip64_unsupported');
  const name=new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(v.buffer,v.byteOffset+p+46,nameLen));
  if(!safePath(name))throw invalid('zip_unsafe_path');
  const madeBy=u16(v,p+4),external=u32(v,p+38);
  if((madeBy>>>8)===3){
   const unixMode=(external>>>16)&0xffff;
   if(unixMode&&((unixMode&0xf000)===0xa000||((unixMode&0xf000)!==0x8000&&(unixMode&0xf000)!==0x4000)))throw invalid('zip_symlink_or_special');
  }
  if(name.endsWith('/')&&(size||packed))throw invalid('zip_nonempty_directory');
  return {name,flags,method,size,packed,offset,crc:u32(v,p+16),next:tail};
 }
 async function localData(file,item){
  if(item.offset+30>file.size)throw invalid('zip_bad_local_header');
  const header=new DataView(await file.slice(item.offset,item.offset+30).arrayBuffer());
  if(u32(header,0)!==0x04034b50||u16(header,6)!==item.flags||u16(header,8)!==item.method)throw invalid('zip_local_mismatch');
  const n=u16(header,26),x=u16(header,28);
  const start=item.offset+30,end=start+n;
  if(end>file.size)throw invalid('zip_bad_local_header');
  const name=new TextDecoder('utf-8',{fatal:true}).decode(await file.slice(start,end).arrayBuffer());
  if(name!==item.name)throw invalid('zip_local_name_mismatch');
  const dataStart=end+x;
  if(dataStart+item.packed>file.size)throw invalid('zip_truncated');
  return file.slice(dataStart,dataStart+item.packed);
 }
 async function jsonText(file,entry){
  if(entry.size>MAX_JSON||entry.packed>MAX_JSON)throw invalid('zip_json_too_large');
  if(entry.packed&&entry.size/entry.packed>150)throw invalid('zip_expansion_ratio');
  const data=await localData(file,entry);
  let stream=data.stream();
  if(entry.method===8){
   if(typeof DecompressionStream!=='function')throw invalid('zip_deflate_unsupported');
   try{stream=stream.pipeThrough(new DecompressionStream('deflate-raw'));}catch{throw invalid('zip_deflate_unsupported');}
  }else if(entry.packed!==entry.size)throw invalid('zip_stored_length_mismatch');
  const reader=stream.getReader(),parts=[];let size=0,crc=0xffffffff;
  try{
   for(;;){
    const {value,done}=await reader.read();if(done)break;
    size+=value.byteLength;
    if(size>entry.size||size>MAX_JSON)throw invalid('zip_expansion_overflow');
    crc=crc32(value,crc);parts.push(value);
   }
  }finally{try{await reader.cancel();}catch{}reader.releaseLock();}
  if(size!==entry.size||((crc^0xffffffff)>>>0)!==(entry.crc>>>0))throw invalid('zip_crc_or_size_mismatch');
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 }
 async function inspect(file){
  if(!file||typeof file.slice!=='function'||!Number.isFinite(file.size)||file.size<22||file.size>MAX_ARCHIVE)throw invalid('zip_size_unsupported');
  const tailSize=Math.min(file.size,65557),tailStart=file.size-tailSize;
  const tail=new DataView(await file.slice(tailStart).arrayBuffer());let pos=-1;
  for(let i=tail.byteLength-22;i>=0;i--)if(u32(tail,i)===0x06054b50&&i+22+u16(tail,i+20)===tail.byteLength){pos=i;break;}
  if(pos<0)throw invalid('zip_eocd_missing');
  const count=u16(tail,pos+10),centralSize=u32(tail,pos+12),centralOffset=u32(tail,pos+16);
  if(u16(tail,pos+4)!==0||u16(tail,pos+6)!==0||u16(tail,pos+8)!==count)throw invalid('zip_multipart_unsupported');
  if(count<1||count>MAX_ENTRIES||centralSize>MAX_CENTRAL||centralOffset===0xffffffff||centralSize===0xffffffff)throw invalid('zip_index_too_large');
  const absoluteEocd=tailStart+pos;
  if(centralOffset+centralSize>absoluteEocd)throw invalid('zip_directory_out_of_bounds');
  const central=new DataView(await file.slice(centralOffset,centralOffset+centralSize).arrayBuffer());
  const entries=[];const unique=new Set();let cursor=0;
  for(let i=0;i<count;i++){
   const entry=metaEntry(file,central,cursor,central.byteLength);
   const lower=entry.name.toLowerCase();
   if(unique.has(lower))throw invalid('zip_duplicate_names');unique.add(lower);
   entries.push(entry);cursor=entry.next;
  }
  if(cursor!==central.byteLength)throw invalid('zip_directory_trailing_data');
  let selected=entries.filter(e=>e.name==='backup.json');
  if(selected.length!==1){
   selected=entries.filter(e=>!e.name.endsWith('/')&&/\.json$/i.test(e.name));
   if(selected.length!==1)throw invalid(selected.length?'zip_ambiguous_manifest':'zip_json_manifest_missing');
  }
  const text=await jsonText(file,selected[0]);
  let backup;try{backup=JSON.parse(text);}catch{throw invalid('zip_invalid_json');}
  if(!backup||typeof backup!=='object'||Array.isArray(backup))throw invalid('zip_invalid_manifest');
  return {backup,manifest:selected[0].name,entries:entries.length,
   mediaEntries:entries.filter(e=>!e.name.endsWith('/')&&e!==selected[0]).length,
   totalUncompressed:entries.reduce((n,e)=>n+e.size,0)};
 }
 return Object.freeze({inspect,safePath});
});