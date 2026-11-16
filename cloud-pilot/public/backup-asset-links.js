'use strict';
// Pure, non-privileged mapping between R17 ZIP binaryAssets and imported Library.
// Never guess a source record or rewire an item that already has an attachment.
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else Object.defineProperty(root,'ZVMCloudBackupLinks',{value:api,writable:false,configurable:false});
})(typeof self!=='undefined'?self:globalThis,function(){
 const ORIGINS=new Set(['EXTUI:audioStore','EXTUI:mediaStore','EXTUI:documentStore','EXTUI:stickerStore']);
 const MIMES=Object.freeze({
  audio:['audio/mpeg','audio/ogg'],image:['image/jpeg','image/png','image/webp'],
  video:['video/mp4'],media:['image/jpeg','image/png','image/webp','audio/mpeg','audio/ogg','video/mp4','application/pdf'],
  document:['application/pdf'],sticker:['image/webp','image/png']
 });
 const result=(status,recordId=null)=>Object.freeze({status,recordId});
 function resolve(asset,records,assets){
  if(!asset||typeof asset!=='object'||!asset.eligible||typeof asset.sourceId!=='string'||!asset.sourceId)
   return result('asset_not_eligible');
  if(!Array.isArray(records)||!Array.isArray(assets))return result('invalid_mapping');
  // Never choose a random asset if two ZIP tokens claim the same physical item.
  if(assets.filter(item=>item.sourceId===asset.sourceId).length!==1)
   return result('duplicate_asset_source');
  const matched=records.filter(item=>item&&typeof item==='object'&&
   ORIGINS.has(item.originStore)&&Object.prototype.hasOwnProperty.call(MIMES,item.kind)&&
   String(item.sourceId||item.id)===asset.sourceId);
  if(matched.length!==1)return result(matched.length?'ambiguous_library_item':'library_item_not_found');
  const record=matched[0];
  if(typeof record.id!=='string'||!record.id.trim())return result('invalid_library_id');
  if(!MIMES[record.kind].includes(asset.mime))return result('media_kind_mismatch');
  if(record.mediaId)return result('already_linked',record.id);
  if(record.contentStatus==='ready')return result('unexpected_ready_without_media');
  return result('ready',record.id);
 }
 return Object.freeze({resolve});
});
