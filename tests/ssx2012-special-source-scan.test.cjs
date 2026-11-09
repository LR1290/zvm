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
const {calculate,platformKey}=require('../src/hobbies/ssx/special-leaders-core.js');
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

test('archived #1 and historical Top 3 coverage is reconstructed without cross-category mixing',()=>{
  const g=literal('G'),sng=literal('SNG'),tracks=literal('TRACKS');
  const rows=[...g.filter(row=>row[0]!=='Global Top 16'),...sng].map(row=>({
    category:row[3]===5?'Survive Special':row[0],
    trackId:row[1],track:tracks[row[1]][2],mode:row[3],
    position:row[2],rider:row[4],score:String(row[5]),
    platform:String(row[7]||''),proof:typeof row[8]==='string'?row[8]:''
  }));
  assert.equal(rows.length,2205);
  const groups=new Map();
  for(const row of rows){
    const platform=platformKey(row.platform),key=JSON.stringify([row.category,row.mode,platform]);
    if(!groups.has(key))groups.set(key,{category:row.category,mode:row.mode,platform});
  }
  let accounted=0,certifiedWinners=0,conflicts=0,missingFirst=0;
  const summary=[];
  for(const group of groups.values()){
    const report=calculate(rows,group.category,group.mode,group.platform);
    accounted+=report.sourceRows;
    certifiedWinners+=report.leaders.length;
    conflicts+=report.collisions.length;
    missingFirst+=report.withoutFirst.length;
    assert.equal(report.leaders.length,new Set(report.leaders.map(row=>row.trackId)).size);
    assert.ok(report.leaders.every(row=>row.position===1));
    assert.equal(report.podium.length<=3,true);
    assert.ok(report.podium.every(row=>row.wins>=1&&row.tracks.length===row.wins));
    assert.ok(report.podium.every((row,i)=>i===0||row.wins<=report.podium[i-1].wins));
    assert.equal(report.certifiedCurrent,false);
    assert.equal(report.identityStatus,'unverified-until-exact-ozmonet-player-id');
    summary.push({category:group.category,mode:group.mode,platform:group.platform,
      rows:report.sourceRows,leaders:report.leaderCount,
      conflictingFirsts:report.collisions.length,missingFirst:report.withoutFirst.length,
      podium:report.podium.map(p=>({wins:p.wins,proofs:p.proofs}))});
  }
  assert.equal(accounted,2205,'All special categories must remain independently accounted for');
  assert.ok(certifiedWinners>5,'Real archived #1 records must exist');
  assert.ok(summary.some(row=>row.category==='Android'&&row.platform==='Android'));
  assert.ok(summary.some(row=>row.category==='Survive Special'&&row.mode===5&&row.platform==='__unspecified__'));
  assert.ok(summary.some(row=>row.category==='Level 9'&&row.mode===1));
  assert.equal(groups.size,21,'Fixed SHA-pinned archive must retain its 21 category/mode/platform scopes');
  assert.equal(certifiedWinners,386,'Archive leaders must not silently disappear or multiply');
  assert.equal(conflicts,1,'Disputed #1 is kept out of the historical podium');
  assert.equal(missingFirst,0,'Missing explicit #1 must be investigated before any certification');
  console.log('SSX_ARCHIVED_LEADER_ACCOUNTING '+JSON.stringify({
    archivedRows:accounted,uniqueFirstPlaces:certifiedWinners,
    conflictingFirstPlaces:conflicts,tracksWithoutFirst:missingFirst,
    groups:summary
  }));
});


test('original archive country flags have verifiable direct rider mappings without invented nationalities',()=>{
  const g=literal('G'),sng=literal('SNG');
  const mapped=literal('RIDER_FLAGS'),codes=literal('FLAG_CODES');
  assert.equal(Object.keys(mapped).length,349,'The frozen v36 rider flag catalogue must not drift');
  assert.equal(Object.keys(codes).length,25);
  let available=0,unavailable=0;
  for(const source of [...g.filter(row=>row[0]!=='Global Top 16'),...sng]){
    const name=String(source[4]||'').trim().toLocaleLowerCase('en');
    const asset=mapped[name];
    if(asset){
      assert.match(asset,/^image[0-9]+\.png$/);
      assert.match(String(codes[asset]||''),/^[A-Z]{2}$/,'Country code absent for source asset '+asset);
      available++;
    }else unavailable++;
  }
  assert.equal(available,2150,'Only original mappings may yield a special-category flag');
  assert.equal(unavailable,55,'Unmapped riders must remain without an invented flag');
  assert.equal(available+unavailable,2205);
});
