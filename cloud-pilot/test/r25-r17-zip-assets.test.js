'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const {Blob}=require('node:buffer');
const ZIP=require('../public/backup-zip');
function crc32(bytes){
 let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;}
 return (c^0xffffffff)>>>0;
}
function zip(entries){
 const locals=[],centrals=[];let offset=0;
 for(const {name,content,method=0,wrongCrc=false} of entries){
  const data=Buffer.from(content),n=Buffer.from(name,'utf8');
  const packed=method===8?zlib.deflateRawSync(data):data,crc=(crc32(data)+(wrongCrc?1:0))>>>0;
  const l=Buffer.alloc(30);
  l.writeUInt32LE(0x04034b50,0);l.writeUInt16LE(20,4);l.writeUInt16LE(method,8);
  l.writeUInt32LE(crc,14);l.writeUInt32LE(packed.length,18);
  l.writeUInt32LE(data.length,22);l.writeUInt16LE(n.length,26);
  locals.push(l,n,packed);
  const c=Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);
  c.writeUInt16LE(method,10);c.writeUInt32LE(crc,16);
  c.writeUInt32LE(packed.length,20);c.writeUInt32LE(data.length,24);
  c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
  centrals.push(c,n);offset+=l.length+n.length+packed.length;
 }
 const central=Buffer.concat(centrals),end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);
 end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);
 end.writeUInt32LE(offset,16);
 return new Blob([...locals,central,end]);
}
const png=Buffer.from('89504e470d0a1a0a0000000d4948445200000001','hex');
const id='asset-1',assetPath='assets/images/asset-1__foto.png';
function manifest(overrides={}){
 return {format:'EXTAPP_BACKUP',version:6,assetEncoding:'external',
  assets:{'image-original-id':'extapp-zip-asset:asset-1'},
  data:{'EXTUI:mediaStore':JSON.stringify({state:{mediaList:[{id:'image-original-id',name:'Foto',mediaKind:'image'}]}})},
  binaryAssets:[{id,path:assetPath,mimeType:'image/png',fileName:'foto.png',sizeBytes:png.length,kind:'image'}],
  ...overrides};
}
function archive(model=manifest(),extra=[]){
 return zip([{name:assetPath,content:png},{name:'backup.json',content:JSON.stringify(model)},...extra]);
}
test('R25: source R17 binaryAssets token resolves to a single safe verified media',async()=>{
 const file=archive(),plan=await ZIP.inspect(file);
 assert.equal(plan.mediaEntries,1);
 assert.equal(plan.assets.length,1);
 const asset=plan.assets[0];
 assert.equal(asset.sourceId,'image-original-id');
 assert.equal(asset.path,assetPath);
 assert.equal(asset.eligible,true);
 assert.equal(asset.reason,null);
 assert.equal(asset.mime,'image/png');
 const blob=await ZIP.readAsset(file,plan,asset.id);
 assert.equal(blob.type,'image/png');
 assert.deepEqual(Buffer.from(await blob.arrayBuffer()),png);
});
test('R25: rejects mismatched manifest, path traversal, orphan ZIP entries and duplicate tokens',async()=>{
 await assert.rejects(()=>ZIP.inspect(archive(manifest({binaryAssets:[]}))),/zip_unexpected_asset/);
 await assert.rejects(()=>ZIP.inspect(archive(manifest({binaryAssets:[{id,path:assetPath,mimeType:'image/png',sizeBytes:123}]}))),/zip_asset_entry_mismatch/);
 await assert.rejects(()=>ZIP.inspect(archive(manifest({binaryAssets:[
  {id,path:assetPath,mimeType:'image/png',sizeBytes:png.length},
  {id,path:'assets/images/another.png',mimeType:'image/png',sizeBytes:png.length}
 ]}))),/zip_asset_manifest_invalid/);
 await assert.rejects(()=>ZIP.inspect(archive(manifest(),[{name:'evil.exe',content:'bad'}])),/zip_unexpected_asset/);
 await assert.rejects(()=>ZIP.inspect(zip([{name:'assets/../hack',content:png},{name:'backup.json',content:JSON.stringify(manifest())}])),/zip_unsafe_path/);
 await assert.rejects(()=>ZIP.inspect(archive(manifest({assets:{
  one:'extapp-zip-asset:asset-1',two:'extapp-zip-asset:asset-1'
 }}))),/zip_asset_ambiguous_owner/);
 await assert.rejects(()=>ZIP.inspect(archive(manifest({assets:{one:'extapp-zip-asset:asset-unknown'}}))),/zip_asset_reference_missing/);
});
test('R25: checksum and magic-byte mismatch fail CLOSED before a file is uploaded',async()=>{
 const file=zip([{name:assetPath,content:png,wrongCrc:true},
  {name:'backup.json',content:JSON.stringify(manifest())}]);
 const plan=await ZIP.inspect(file);
 await assert.rejects(()=>ZIP.readAsset(file,plan,'asset-1'),/zip_crc_or_size_mismatch/);
 const invalid=Buffer.alloc(png.length,0x42);
 const fake=zip([{name:assetPath,content:invalid},{name:'backup.json',content:JSON.stringify(manifest())}]);
 const p2=await ZIP.inspect(fake);
 await assert.rejects(()=>ZIP.readAsset(fake,p2,'asset-1'),/zip_asset_signature_mismatch/);
});
test('R25: unsupported MIME and missing physical origin never trigger automatic restoration',async()=>{
 const m=manifest();
 m.binaryAssets[0].mimeType='image/svg+xml';
 let p=await ZIP.inspect(archive(m));
 assert.equal(p.assets[0].eligible,false);
 assert.equal(p.assets[0].reason,'unsupported_mime');
 await assert.rejects(()=>ZIP.readAsset(archive(m),p,'asset-1'),/zip_asset_not_restorable/);
 m.binaryAssets[0].mimeType='image/png';m.assets={};
 p=await ZIP.inspect(archive(m));
 assert.equal(p.assets[0].eligible,false);
 assert.equal(p.assets[0].reason,'unlinked_source');
});
test('R25: ZIP import frontend uses one verified uploader and CAS for account-specific record linking',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const ui=fs.readFileSync(path.join(__dirname,'../public/workspace.js'),'utf8');
 assert.match(ui,/window\.ZVMCloudZip\.readAsset\(file,extracted,asset\.id\)/);
 assert.match(ui,/uploadMedia\(media,\{throwOnError:true\}\)/);
 assert.match(ui,/RESTORABLE_LIBRARY_KINDS/);
 assert.match(ui,/same\.length!==1\|\|same\[0\]\.mediaId/);
 assert.match(ui,/revision:latest\.revision,records/);
 assert.match(ui,/sem vínculo confirmado/);
 assert.match(ui,/Mídias do ZIP ainda precisam de restauração seletiva/);
 assert.doesNotMatch(ui,/sendMessage\(|sendBroadcast\(/);
});
