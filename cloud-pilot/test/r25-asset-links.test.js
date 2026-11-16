'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Links=require('../public/backup-asset-links');
const asset={id:'asset-1',sourceId:'image-native-id',mime:'image/png',eligible:true};
const records=[{id:'cloud-image-id',sourceId:'image-native-id',name:'Foto',
 originStore:'EXTUI:mediaStore',kind:'image',contentStatus:'missing_source'}];
const resolve=(a=asset,rows=records,assets=[asset])=>Links.resolve(a,rows,assets);
test('R25: unique R17 native asset with same account metadata is eligible for linking',()=>{
 assert.deepEqual(resolve(),{status:'ready',recordId:'cloud-image-id'});
 assert.equal(resolve({...asset,mime:'video/mp4'}).status,'media_kind_mismatch');
 assert.equal(resolve({...asset,eligible:false}).status,'asset_not_eligible');
 assert.equal(resolve({...asset,sourceId:''}).status,'asset_not_eligible');
 assert.equal(resolve({...asset,sourceId:'missing'}).status,'library_item_not_found');
});
test('R25: fail-closed for duplicate ZIP token claims and ambiguous Library IDs',()=>{
 const twoAssets=[asset,{...asset,id:'asset-2'}];
 assert.equal(resolve(asset,records,twoAssets).status,'duplicate_asset_source');
 assert.equal(resolve(asset,[...records,{...records[0],id:'another-id'}]).status,'ambiguous_library_item');
 assert.equal(resolve(asset,[{...records[0],originStore:'EXTUI:textMessageStore'}]).status,'library_item_not_found');
 assert.equal(resolve(asset,[{...records[0],kind:'message'}]).status,'library_item_not_found');
});
test('R25: never overwrite an attachment or trust a falsely ready media record',()=>{
 assert.deepEqual(resolve(asset,[{...records[0],mediaId:'m_'+'a'.repeat(40)}]),
  {status:'already_linked',recordId:'cloud-image-id'});
 assert.equal(resolve(asset,[{...records[0],contentStatus:'ready'}]).status,'unexpected_ready_without_media');
 assert.equal(resolve(asset,[{...records[0],id:null}]).status,'invalid_library_id');
});
test('R25: MIME mapping matches Cloud library server constraints',()=>{
 const pairs=[['audio','audio/mpeg','EXTUI:audioStore'],
  ['video','video/mp4','EXTUI:mediaStore'],
  ['sticker','image/webp','EXTUI:stickerStore'],
  ['document','application/pdf','EXTUI:documentStore'],
  ['media','image/jpeg','EXTUI:mediaStore']];
 for(const [kind,mime,originStore] of pairs){
  const a={...asset,mime},row={...records[0],kind,originStore};
  assert.equal(resolve(a,[row],[a]).status,'ready',kind);
 }
});
test('R25: disabled action is structurally impossible on unsupported original records',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../public/workspace.js'),'utf8');
 assert.match(source,/ZVMCloudBackupLinks\.resolve\(asset,current\.records,extracted\.assets\)/);
 assert.match(source,/freshMapping\.status!=='ready'/);
 assert.match(source,/ZVMCloudZip\.readAsset\(file,extracted,asset\.id\)/);
 assert.match(source,/uploadMedia\(media,\{throwOnError:true\}\)/);
 assert.match(source,/workspace_conflict|revision:latest\.revision,records/);
});
