'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const zlib=require('node:zlib');
const crypto=require('node:crypto');
const {readPinnedSnapshot}=require('../tools/ssx-audit-display-readonly.cjs');
const snapshot=require('../src/hobbies/ssx/sheet-r111.js');
const pinned=require('../src/hobbies/ssx/route.js');
test('R111 regional sources are exactly 11 read-only official Google tabs',()=>{
  assert.equal(snapshot.SHEETS.length,11);
  for(const tab of snapshot.SHEETS){
    const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../src/hobbies/ssx/sheet-snapshot-r111',tab+'.json'),'utf8'));
    assert.equal(data.sheet,tab);
    assert.equal(data.spreadsheetId,snapshot.SHEET_ID);
    assert.equal(data.capturedOn,'2026-11-20');
    assert.equal(data.source,'google_sheets_formatted_cells_read_only');
    assert.ok(data.cells.length>=350,'Source tab must not be a partial sample: '+tab);
    assert.doesNotThrow(()=>snapshot.cellSource(data));
  }
  assert.equal(snapshot.metric(0,'01:19.13').ok,true);
  assert.equal(snapshot.metric(0,'1').ok,false);
  assert.equal(snapshot.metric(2,'69,353,168').numeric,69353168);
  assert.equal(snapshot.metric(3,'247,099.67m').numeric,247099.67);
  assert.equal(snapshot.metric(3,'402,026,41m').numeric,402026.41);
});
test('R111 reconciles by official track/rank/mode and preserves historical extra categories',()=>{
  const archive=readPinnedSnapshot();
  const {records,summary}=snapshot.refresh(archive.G,archive.TRACKS);
  assert.equal(summary.spreadsheetId,snapshot.SHEET_ID);
  assert.equal(summary.regionCapture,'2026-11-20');
  assert.ok(summary.regionalGroupsUpdated>=60,'Most of the 11 official regional tabs must reconcile');
  assert.ok(summary.changedOrNewRows>=80,'The latest source must yield concrete refreshed records');
  assert.ok(summary.regionalRows>=3300,'Current regional capture must have near-complete coverage');
  assert.ok(summary.reviewRows<50,'Flag ambiguous rows instead of silently guessing');
  const a=(track,rank,mode)=>records.find(x=>x[0]==='Global Top 16'&&x[1]===track&&x[2]===rank&&x[3]===mode);
  assert.deepEqual(a(8,1,1).slice(4,6),['LR1290','00:43.69']);
  assert.deepEqual(a(44,1,1).slice(4,6),['LR1290','00:31.23']);
  assert.equal(a(4,1,3)[5],'402,026,41m');
  const sourceCount=archive.G.filter(x=>!snapshot.SHEETS.includes(x[9])).length;
  assert.equal(summary.unchangedOtherCategories,sourceCount);
  assert.deepEqual(records.filter(x=>!snapshot.SHEETS.includes(x[9])),
    archive.G.filter(x=>!snapshot.SHEETS.includes(x[9])),
    'Level/DEV/No Boost/Android must not be rewritten with an incompatible regional schema');
  const slots=new Set();
  for(const row of records.filter(x=>snapshot.SHEETS.includes(x[9]))){
    const key=JSON.stringify([row[9],row[1],row[2],row[3],row[0]]);
    assert.ok(!slots.has(key),'No duplicate record positions: '+key);
    slots.add(key);
    assert.ok(typeof row[4]==='string'&&row[4].trim(),'Rider must be present');
    assert.ok(typeof row[5]==='string'&&row[5].trim(),'Score must be present');
  }
});
test('R111 dynamically updates the public HTML but never modifies the SHA-pinned archive',()=>{
  const root=path.join(__dirname,'../src/hobbies/ssx/packed');
  const gz=Buffer.concat(Array.from({length:10},(_,i)=>
    fs.readFileSync(path.join(root,'ssx2012.html.gz.part'+String(i).padStart(2,'0')))));
  const original=zlib.gunzipSync(gz);
  assert.equal(crypto.createHash('sha256').update(original).digest('hex'),pinned.SHA256);
  const out=snapshot.updateHtml(original.toString('utf8'));
  assert.ok(out.html.length>7_000_000);
  assert.ok(out.summary.changedOrNewRows>=80);
  assert.match(out.html,/"regionalCapture":"2026-11-20"/);
  assert.match(out.html,/"regionalSource":"1SAk84oy05R0UK3JJ_JWJTskSqxj4GpGJkdRqfSmnx2I"/);
  assert.equal(crypto.createHash('sha256').update(original).digest('hex'),pinned.SHA256,
    'Original v36 archive remains byte-exact');
});
