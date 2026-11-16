'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const zlib=require('node:zlib');
const {Blob}=require('node:buffer');
const ZIP=require('../public/backup-zip');
const Media=require('../media-domain');
function zip(entries){
 const locals=[],centrals=[];let offset=0;
 function crc32(bytes){
  let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;}
  return (c^0xffffffff)>>>0;
 }
 for(const {name,content,method=8,wrongCrc=false} of entries){
  const data=Buffer.from(content),n=Buffer.from(name,'utf8'),packed=method===8?zlib.deflateRawSync(data):data,crc=(crc32(data)+(wrongCrc?1:0))>>>0;
  const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50,0);l.writeUInt16LE(20,4);l.writeUInt16LE(method,8);l.writeUInt32LE(crc,14);l.writeUInt32LE(packed.length,18);l.writeUInt32LE(data.length,22);l.writeUInt16LE(n.length,26);
  locals.push(l,n,packed);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(method,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
  centrals.push(c,n);offset+=l.length+n.length+packed.length;
 }
 const central=Buffer.concat(centrals),end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
 return new Blob([...locals,central,end]);
}
const backup={format:'EXTAPP_BACKUP',data:{'EXTUI:extappFlowStore':'{"state":{"flowList":[{"id":"a","name":"Flow"}]}}'}};
test('client ZIP manifest: local extraction, CRC, no media upload',async()=>{
 let result=await ZIP.inspect(zip([{name:'assets/banner.png',content:Buffer.from([137,80,78,71])},{name:'backup.json',content:JSON.stringify(backup)}]));
 assert.equal(result.manifest,'backup.json');assert.equal(result.mediaEntries,1);assert.equal(result.backup.format,'EXTAPP_BACKUP');
 result=await ZIP.inspect(zip([{name:'backup-2026.json',content:JSON.stringify(backup),method:0}]));
 assert.equal(result.entries,1);assert.equal(result.backup.data['EXTUI:extappFlowStore'].includes('Flow'),true);
});
test('client ZIP rejects traversal, corrupted CRC and ambiguous manifests',async()=>{
 await assert.rejects(()=>ZIP.inspect(zip([{name:'../backup.json',content:'{}'}])),/zip_unsafe_path/);
 await assert.rejects(()=>ZIP.inspect(zip([{name:'backup.json',content:'{}',wrongCrc:true}])),/zip_crc_or_size_mismatch/);
 await assert.rejects(()=>ZIP.inspect(zip([{name:'a.json',content:'{}'},{name:'b.json',content:'{}'}])),/zip_ambiguous_manifest/);
 await assert.rejects(()=>ZIP.inspect(zip([{name:'hello.txt',content:'{}'}])),/zip_json_manifest_missing/);
});
test('media vault detects magic bytes, digest mismatch and quota',()=>{
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB','base64');
 const input={name:'foto.png',mime:'image/png',base64:bytes.toString('base64'),sha256:Media.sha(bytes)};
 const m=Media.decode(input);
 assert.match(m.id,/^m_[a-f0-9]{40}$/);assert.equal(m.size,bytes.length);
 const added=Media.add({revision:0,items:[]},m,0);assert.equal(added.next.revision,1);
 assert.equal(Media.add(added.next,m,1).duplicate,true);
 assert.throws(()=>Media.add(added.next,m,0),/media_revision_conflict/);
 assert.equal(Media.remove(added.next,m.id,1).items.length,0);
 assert.throws(()=>Media.decode({...input,sha256:'f'.repeat(64)}),/media_digest_mismatch/);
 assert.throws(()=>Media.decode({...input,mime:'image/svg+xml'}),/media_type_denied/);
 assert.throws(()=>Media.decode({...input,name:'../../secret'}),/invalid_media_name/);
 const oversized=Buffer.concat([bytes,Buffer.alloc(1024*1024)]);
 assert.throws(()=>Media.decode({...input,sha256:Media.sha(oversized),base64:oversized.toString('base64')}),/media_encoding_denied/);
});
