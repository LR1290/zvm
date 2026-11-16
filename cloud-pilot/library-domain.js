'use strict';
// R23 Biblioteca: integrity rules for drafts and explicitly uploaded, private media.
// No WhatsApp delivery and no automatic restore of extension-local blobs.
const KINDS=Object.freeze({
 message:'Mensagem',audio:'Áudio',image:'Imagem',video:'Vídeo',media:'Mídia',
 sticker:'Figurinha',document:'Documento',pix:'PIX',
 'interactive-list':'Lista interativa',contact:'Contato',signature:'Assinatura'
});
const KIND_MIMES=Object.freeze({
 audio:['audio/mpeg','audio/ogg'],
 image:['image/jpeg','image/png','image/webp'],
 video:['video/mp4'],
 media:['image/jpeg','image/png','image/webp','audio/mpeg','audio/ogg','video/mp4','application/pdf'],
 sticker:['image/webp','image/png'],
 document:['application/pdf']
});
function fail(code){const e=new Error(code);e.code=code;throw e;}
function isPlain(value){return !!value&&typeof value==='object'&&!Array.isArray(value);}
function checkLibraryRecords(records,mediaItems=[]){
 if(!Array.isArray(records)||!Array.isArray(mediaItems))fail('invalid_library');
 const assets=new Map(mediaItems.map(row=>[row.id,row]));
 for(const row of records){
  if(!isPlain(row))fail('invalid_library_record');
  const kind=row.kind||'message';
  if(!Object.hasOwn(KINDS,kind))fail('invalid_library_kind');
  if(row.favorite!==undefined&&typeof row.favorite!=='boolean')fail('invalid_library_favorite');
  if(row.showInQuickMenu!==undefined&&typeof row.showInQuickMenu!=='boolean')fail('invalid_library_quick_menu');
  const status=row.contentStatus||'missing_source';
  if(!['ready','needs_review','missing_source'].includes(status))fail('invalid_library_status');
  const text=typeof row.text==='string'?row.text.trim():'';
  if(row.text!==undefined&&typeof row.text!=='string')fail('invalid_library_text');
  if(row.mediaId!==undefined&&row.mediaId!==null){
   if(typeof row.mediaId!=='string'||!/^m_[a-f0-9]{40}$/.test(row.mediaId))fail('invalid_library_media');
   const media=assets.get(row.mediaId);
   if(!media)fail('unknown_library_media');
   if(Object.hasOwn(KIND_MIMES,kind)&&!KIND_MIMES[kind].includes(media.mime))fail('library_media_kind_mismatch');
   if(!Object.hasOwn(KIND_MIMES,kind))fail('library_media_kind_mismatch');
  }
  if(status==='ready'){
   if(Object.hasOwn(KIND_MIMES,kind)){
    if(!row.mediaId)fail('library_media_required');
   }else if(['interactive-list','contact'].includes(kind)){
    // R17 structures can be imported and reviewed, but no recipient-ready
    // semantics until these structured formats have full schema support.
    fail('library_structured_review_required');
   }else if(!text)fail('library_text_required');
  }
  // Never claim a media item is usable solely on the basis of a caption.
  if(Object.hasOwn(KIND_MIMES,kind)&&status==='ready'&&!row.mediaId)fail('library_media_required');
 }
 return records;
}
module.exports={KINDS,KIND_MIMES,checkLibraryRecords};
