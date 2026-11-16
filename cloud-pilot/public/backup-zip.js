'use strict';
// ZIP reader for user-selected ZVM backups. Extracts ONLY a bounded JSON manifest,
// validates CRC32 and paths, and never uploads other entries or raw archives.
// No external library, no ZIP64, encryption, multipart, symlinks or executable input.
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else Object.defineProperty(root,'ZVMCloudZip',{value:api,writable:false,configurable:false});
})(typeof self!=='undefined'?self:globalThis,function(){
 // ZIP32 is indexed without reading whole archives into memory. Individual
 // media restoration remains bounded by the R24 account/file quotas.
 const MAX_ARCHIVE=2200*1024*1024,MAX_JSON=32*1024*1024,
  MAX_CENTRAL=4*1024*1024,MAX_ENTRIES=5000,MAX_ASSET=32*1024*1024;
 const TOKEN=/^asset-[a-z0-9]+$/,REF=/^extapp-zip-asset:(asset-[a-z0-9]+)$/;
 const RESTORABLE=new Set(['image/jpeg','image/png','image/webp','application/pdf','audio/mpeg','audio/ogg','video/mp4']);
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
 async function entryBytes(file,entry,limit){
  if(entry.size>limit||entry.packed>limit)throw invalid('zip_entry_too_large');
  if(entry.packed&&entry.size/entry.packed>150)throw invalid('zip_expansion_ratio');
  const data=await localData(file,entry);
  let stream=data.stream();
  if(entry.method===8){
   if(typeof DecompressionStream!=='function')throw invalid('zip_deflate_unsupported');
   try{stream=stream.pipeThrough(new DecompressionStream('deflate-raw'));}
   catch{throw invalid('zip_deflate_unsupported');}
  }else if(entry.packed!==entry.size)throw invalid('zip_stored_length_mismatch');
  const reader=stream.getReader(),parts=[];let size=0,crc=0xffffffff;
  try{
   for(;;){
    const {value,done}=await reader.read();if(done)break;
    size+=value.byteLength;
    if(size>entry.size||size>limit)throw invalid('zip_expansion_overflow');
    crc=crc32(value,crc);parts.push(value);
   }
  }finally{try{await reader.cancel();}catch{}reader.releaseLock();}
  if(size!==entry.size||((crc^0xffffffff)>>>0)!==(entry.crc>>>0))throw invalid('zip_crc_or_size_mismatch');
  const bytes=new Uint8Array(size);
  let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  return bytes;
 }
 async function jsonText(file,entry){
  if(entry.size>MAX_JSON||entry.packed>MAX_JSON)throw invalid('zip_json_too_large');
  return new TextDecoder('utf-8',{fatal:true}).decode(await entryBytes(file,entry,MAX_JSON));
 }
 function validMime(bytes,mime){
  const char=(off,n)=>String.fromCharCode(...bytes.subarray(off,off+n));
  if(mime==='image/png')return bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>v===bytes[i]);
  if(mime==='image/jpeg')return bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(mime==='image/webp')return bytes.length>=12&&char(0,4)==='RIFF'&&char(8,4)==='WEBP';
  if(mime==='application/pdf')return bytes.length>=5&&char(0,5)==='%PDF-';
  if(mime==='audio/mpeg')return bytes.length>=3&&(char(0,3)==='ID3'||(bytes[0]===255&&(bytes[1]&224)===224));
  if(mime==='audio/ogg')return bytes.length>=4&&char(0,4)==='OggS';
  if(mime==='video/mp4')return bytes.length>=12&&char(4,4)==='ftyp';
  return false;
 }
 function manifestAssets(backup,entries,selected){
  const declared=backup.binaryAssets;
  if(declared===undefined||declared===null){
   if(backup.assetEncoding==='external')throw invalid('zip_asset_manifest_missing');
   return [];
  }
  if(!Array.isArray(declared)||declared.length>MAX_ENTRIES)throw invalid('zip_asset_manifest_invalid');
  const byPath=new Map(entries.map(e=>[e.name,e]));
  const assets=backup.assets&&typeof backup.assets==='object'&&!Array.isArray(backup.assets)?backup.assets:{};
  const sourceMap=new Map(),tokenOwners=new Map();
  for(const [sourceId,value] of Object.entries(assets)){
   if(['__proto__','prototype','constructor'].includes(sourceId))throw invalid('zip_asset_source_invalid');
   if(typeof value!=='string')continue;
   const match=REF.exec(value);
   if(!match)continue;
   const owners=tokenOwners.get(match[1])||[];
   owners.push(sourceId);tokenOwners.set(match[1],owners);
  }
  const tokens=new Set(),paths=new Set(),out=[];
  for(const meta of declared){
   if(!meta||typeof meta!=='object'||Array.isArray(meta))throw invalid('zip_asset_manifest_invalid');
   const id=String(meta.id||''),p=String(meta.path||''),mime=String(meta.mimeType||'').toLowerCase().trim();
   const size=meta.sizeBytes;
   if(!TOKEN.test(id)||tokens.has(id)||!safePath(p)||!p.startsWith('assets/')||paths.has(p)||
     !Number.isSafeInteger(size)||size<=0||size>MAX_ARCHIVE)throw invalid('zip_asset_manifest_invalid');
   tokens.add(id);paths.add(p);
   const entry=byPath.get(p);
   if(!entry||entry.name.endsWith('/')||entry.size!==size)throw invalid('zip_asset_entry_mismatch');
   const owners=tokenOwners.get(id)||[];
   if(owners.length>1)throw invalid('zip_asset_ambiguous_owner');
   out.push({id,path:p,name:String(meta.fileName||p.split('/').pop()).slice(0,120),
     mime,sizeBytes:size,sourceId:owners[0]||null,
     eligible:RESTORABLE.has(mime)&&size<=MAX_ASSET,
     reason:!RESTORABLE.has(mime)?'unsupported_mime':size>MAX_ASSET?'asset_over_32mb':owners.length===0?'unlinked_source':null});
  }
  // R17's ZIP writer includes exactly the declared binary assets.
  if(backup.assetEncoding==='external'){
   for(const entry of entries){
    if(entry.name===selected||entry.name.endsWith('/'))continue;
    if(!paths.has(entry.name))throw invalid('zip_unexpected_asset');
   }
   if([...tokenOwners.keys()].some(id=>!tokens.has(id)))throw invalid('zip_asset_reference_missing');
  }
  return out;
 }
 async function readAsset(file,inspection,id){
  if(!inspection||!Array.isArray(inspection.assets)||!TOKEN.test(String(id||'')))
   throw invalid('zip_asset_not_selected');
  const item=inspection.assets.find(a=>a.id===id);
  if(!item||!item.eligible)throw invalid('zip_asset_not_restorable');
  const entry=(inspection._entries||[]).find(e=>e.name===item.path);
  if(!entry||entry.size!==item.sizeBytes)throw invalid('zip_asset_entry_mismatch');
  const bytes=await entryBytes(file,entry,MAX_ASSET);
  if(!validMime(bytes,item.mime))throw invalid('zip_asset_signature_mismatch');
  return new Blob([bytes],{type:item.mime});
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
  const assets=manifestAssets(backup,entries,selected[0].name);
  return {backup,manifest:selected[0].name,entries:entries.length,
   mediaEntries:entries.filter(e=>!e.name.endsWith('/')&&e!==selected[0]).length,
   totalUncompressed:entries.reduce((n,e)=>n+e.size,0),assets,
   _entries:entries.map(e=>({name:e.name,flags:e.flags,method:e.method,size:e.size,
    packed:e.packed,offset:e.offset,crc:e.crc}))};
 }
 return Object.freeze({inspect,readAsset,safePath});
});