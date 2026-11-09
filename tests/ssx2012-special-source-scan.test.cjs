'use strict';
// Deterministic, read-only special-category inventory for SHA-pinned v36.
// No executing source scripts, no remote reads, no automated identity changes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {gunzipSync}=require('node:zlib');
const {createHash}=require('node:crypto');
const {SHA256}=require('../src/hobbies/ssx/route');
const root=join(__dirname,'../src/hobbies/ssx/packed');
const archive=gunzipSync(Buffer.concat(Array.from({length:10},(_,i)=>
  readFileSync(join(root,'ssx2012.html.gz.part'+String(i).padStart(2,'0'))))));
assert.equal(createHash('sha256').update(archive).digest('hex'),SHA256);
const html=archive.toString('utf8');
const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)]
  .map(match=>match[1]).sort((a,b)=>b.length-a.length)[0]||'';
function literal(name){
  const m=new RegExp('(?:let|const|var)\\s+'+name+'\\s*=').exec(script);
  if(!m)throw new Error('Source literal absent: '+name);
  let offset=m.index+m[0].length;
  while(/\s/.test(script[offset]))offset++;
  const open=script[offset],close=open==='['?']':open==='{'?'}':null;
  if(!close)throw new Error('Non-JSON source literal: '+name);
  let depth=0,quoted=false,escaped=false,end=offset;
  for(;end<script.length;end++){
    const chr=script[end];
    if(quoted){
      if(escaped)escaped=false;
      else if(chr==='\\')escaped=true;
      else if(chr==='"')quoted=false;
      continue;
    }
    if(chr==='"'){quoted=true;continue;}
    if(chr===open)depth++;
    if(chr===close&&--depth===0)break;
  }
  return JSON.parse(script.slice(offset,end+1));
}
test('archive special-category source data remains signed, complete and separated',()=>{
  const meta=literal('META'),tracks=literal('TRACKS'),g=literal('G'),sng=literal('SNG');
  assert.equal(meta.snapshot,'2026-08-22','This is an archive, not the current online sheet');
  assert.equal(tracks.length,83);
  assert.equal(meta.tracks,83);
  assert.equal(g.length,5887);
  assert.equal(sng.length,137);
  assert.equal(g.length+sng.length,meta.googleRecords);
  assert.ok(sng.every(row=>row[3]===5));
  const expected=new Map([
    ['Global Top 16',3819],['No Boost',29],
    ['Level 1',638],['Level 3',132],['Level 6',801],
    ['Level 7',169],['Level 8',17],['Level 9',224],
    ['Android',48],['DEV Tracks',10]
  ]);
  const counts=new Map();
  for(const row of g){
    assert.ok(Array.isArray(row)&&row.length>=11);
    assert.ok(Number.isInteger(row[1])&&row[1]>=0&&row[1]<83);
    counts.set(row[0],(counts.get(row[0])||0)+1);
  }
  assert.deepEqual([...counts].sort(),[...expected].sort());
  const examples=[
    ['Level 9',2,0,'01:26.45'],
    ['Android',16,2,'4.460432E7'],
    ['DEV Tracks',79,0,'00:34.79'],
    ['No Boost',2,0,'1:42.83']
  ];
  for(const [category,trackId,mode,score] of examples){
    assert.ok(g.some(row=>row[0]===category&&row[1]===trackId&&row[3]===mode&&row[5]===score));
  }
  assert.ok(sng.some(row=>row[1]===8&&row[3]===5&&row[5]==='10,787,35m'));
  assert.equal([...counts].filter(([name])=>name!=='Global Top 16').reduce((n,[,c])=>n+c,0)+sng.length,2205);
  console.log('SSX_VERIFIED_ARCHIVE_CATEGORIES '+JSON.stringify({
    snapshot:meta.snapshot,trackObjects:tracks.length,
    archivedSheetsRows:g.length,specialSurviveRows:sng.length,
    specialCategoryRows:2205,categories:Object.fromEntries(counts),
    mode5:'Survive No Gear/Wings/Rewinds — combined source grouping only'
  }));
});
