'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {reconcile,validOzProfile,statuses}=require('../src/hobbies/ssx/reconciliation-core.cjs');
const url='https://docs.google.com/spreadsheets/d/1SAk84oy05R0UK3JJ_JWJTskSqxj4GpGJkdRqfSmnx2I/edit';
const capturedAt='2026-11-09T18:00:00.000Z';
const sheet=r=>({kind:'google_sheets',sourceUrl:url,capturedAt,records:r});
const oz=p=>({kind:'ozmonet',sourceUrl:'https://ssx.ozmonet.com/',capturedAt,players:p});
const row=(v={})=>({recordId:'sheet-1',eventId:'red-light',trackId:'red-light',platform:'xbox360',mode:'board',variant:'standard',position:1,value:'01:35.99',riderName:'Jake',playerId:'186243498',proofUrl:'https://youtu.be/example',...v});
const profile=(v={})=>({playerId:'186243498',gamertag:'Jake',profileUrl:'https://ssx.ozmonet.com/user/186243498',...v});
// Synthetic examples only: no claim that any real profile/record belongs to this name.
test('exact numeric ID matches the supplied Ozmonet profile without changing a score',()=>{
  const report=reconcile(sheet([row()]),oz([profile()]));
  assert.equal(report.rows[0].status,statuses.confirmed);
  assert.equal(report.safeguards.changesApplied,0);
  assert.equal(report.totalSheetsRecords,1);
  assert.equal(report.rows[0].profileUrl,'https://ssx.ozmonet.com/user/186243498');
});
test('different name for the same exact ID yields candidate for review only',()=>{
  const report=reconcile(sheet([row({riderName:'J4ke'})]),oz([profile()]));
  assert.equal(report.rows[0].status,statuses.review);
  assert.equal(report.rows[0].originalRiderName,'J4ke');
  assert.equal(report.rows[0].ozmonetName,'Jake');
  assert.equal(report.manualReviewCandidates,1);
  assert.equal(report.safeguards.automaticRenames,false);
});
test('without ID there is no fuzzy nickname matching',()=>{
  const report=reconcile(sheet([row({playerId:null,riderName:'JAKE'})]),oz([profile()]));
  assert.equal(report.rows[0].status,statuses.noId);
  assert.equal(report.rows[0].ozmonetName,null);
});
test('ID missing in Ozmonet is unresolved',()=>{
  assert.equal(reconcile(sheet([row({playerId:'999'})]),oz([profile()])).rows[0].status,statuses.notFound);
});
test('conflicting gamertags under one Ozmonet ID block identity resolution',()=>{
  const report=reconcile(sheet([row()]),oz([profile(),profile({gamertag:'other'})]));
  assert.equal(report.rows[0].status,statuses.conflicting);
});
test('source URL must match the numeric ID, host and HTTPS scheme',()=>{
  assert.equal(validOzProfile(profile({profileUrl:'https://evil.example/user/186243498'})),false);
  const report=reconcile(sheet([row()]),oz([profile({profileUrl:'https://evil.example/user/186243498'})]));
  assert.equal(report.invalidOzmonetProfiles.length,1);
  assert.equal(report.rows[0].status,statuses.notFound);
});
test('invalid Sheets ID cannot be used for a rename',()=>{
  assert.equal(reconcile(sheet([row({playerId:'x-186243498'})]),oz([profile()])).rows[0].status,statuses.invalid);
});
test('separates Android, low-level and DEV records from standard event',()=>{
  const records=[row(),row({recordId:'sheet-2',platform:'android',mode:'android',variant:'low-level',eventId:'red-light-low',value:'01:23.45'}),row({recordId:'sheet-3',mode:'dev',variant:'test',eventId:'test-rail',trackId:'test-rail'})];
  const report=reconcile(sheet(records),oz([profile()]));
  assert.equal(report.eventPositionCollisions.length,0);
  assert.equal(new Set(report.rows.map(x=>x.eventKey)).size,3);
});
test('same position and category is flagged as a collision rather than overwritten',()=>{
  const report=reconcile(sheet([row(),row({recordId:'sheet-2',riderName:'J4ke'})]),oz([profile()]));
  assert.equal(report.totalSheetsRecords,2);
  assert.equal(report.eventPositionCollisions.length,1);
  assert.deepEqual(report.eventPositionCollisions[0].recordIds,['sheet-1','sheet-2']);
});
test('different sheet nicknames associated with one ID get flagged',()=>{
  const report=reconcile(sheet([row(),row({recordId:'sheet-2',trackId:'corkscrew',eventId:'corkscrew',riderName:'Jake2'})]),oz([profile()]));
  assert.equal(report.sameIdMultipleSheetNames.length,1);
  assert.deepEqual(report.sameIdMultipleSheetNames[0].names,['Jake','Jake2']);
});
test('snapshots stay unchanged and output is deterministic with evidence hashes',()=>{
  const sheets=sheet([row()]),profiles=oz([profile()]);
  const before=JSON.stringify([sheets,profiles]);
  const a=reconcile(sheets,profiles),b=reconcile(sheets,profiles);
  assert.deepEqual(a,b);
  assert.equal(JSON.stringify([sheets,profiles]),before);
  assert.match(a.snapshots.googleSheets.sha256,/^[a-f0-9]{64}$/);
});
test('reject false origins, dates and non-HTTPS sources',()=>{
  assert.throws(()=>reconcile({...sheet([]),sourceUrl:'https://evil.example/sheet'},oz([])),/Google Sheets/);
  assert.throws(()=>reconcile(sheet([]),{...oz([]),capturedAt:''}),/capturedAt/);
  assert.throws(()=>reconcile(sheet([]),{...oz([]),sourceUrl:'http://ssx.ozmonet.com/'}),/HTTPS/);
});
test('missing track or unsupported category is invalid and never becomes a leader',()=>{
  const report=reconcile(sheet([row({mode:'unknown-mode'}),row({recordId:'sheet-2',eventId:''})]),oz([profile()]));
  assert.equal(report.summary.INVALID_EVIDENCE,2);
});
test('event keys do not conflate literal separator text with percent-escaped text',()=>{
  const report=reconcile(sheet([
    row({recordId:'pipe',eventId:'race|one'}),
    row({recordId:'encoded',eventId:'race%7Cone'})
  ]),oz([profile()]));
  assert.equal(report.eventPositionCollisions.length,0);
  assert.notEqual(report.rows[0].eventKey,report.rows[1].eventKey);
});
test('duplicate stable source record IDs are exposed even across different events',()=>{
  const report=reconcile(sheet([
    row({recordId:'repeated'}),
    row({recordId:'repeated',eventId:'another-event',trackId:'another-track'})
  ]),oz([profile()]));
  assert.deepEqual(report.duplicateRecordIds,[{recordId:'repeated',indices:[0,1]}]);
  assert.equal(report.eventPositionCollisions.length,0);
  assert.equal(report.safeguards.changesApplied,0);
});

test('boundary whitespace does not conceal a duplicate event position',()=>{
  const report=reconcile(sheet([
    row({recordId:'clean'}),
    row({recordId:'padded',platform:' xbox360 ',variant:' standard ',eventId:' red-light ',trackId:'red-light '})
  ]),oz([profile()]));
  assert.deepEqual(report.eventPositionCollisions,[{
    key:'["xbox360","board","standard","red-light","red-light",1]',
    recordIds:['clean','padded']
  }]);
  assert.equal(report.duplicateRecordIds.length,0);
  assert.equal(report.safeguards.changesApplied,0);
});
test('malformed optional variants cannot be laundered into standard records',()=>{
  const report=reconcile(sheet([
    row({recordId:'numeric',variant:42}),
    row({recordId:'whitespace',variant:'   ',eventId:'another',trackId:'another'}),
    row({recordId:'omitted',variant:undefined,eventId:'third',trackId:'third'}),
    row({recordId:'empty',variant:'',eventId:'fourth',trackId:'fourth'})
  ]),oz([profile()]));
  assert.equal(report.summary.INVALID_EVIDENCE,2);
  assert.equal(report.rows[0].status,statuses.invalid);
  assert.equal(report.rows[1].status,statuses.invalid);
  assert.equal(report.rows[2].status,statuses.confirmed);
  assert.equal(report.rows[3].status,statuses.confirmed);
});

test('noncanonical numeric IDs and non-string inputs never produce aliases',()=>{
  const {numericId}=require('../src/hobbies/ssx/reconciliation-core.cjs');
  assert.equal(numericId('12345678901234567890'),'12345678901234567890','20 digits remain lossless as text');
  for(const invalid of ['0','000','000123','01','1e3','1.0',123.5,Number.MAX_SAFE_INTEGER+1,[123],true,{id:123},null]){
    assert.equal(numericId(invalid),'','refuse ambiguous ID: '+String(invalid));
  }
  assert.equal(numericId(' 186243498 '),'186243498');
  const report=reconcile(sheet([row({playerId:'000186243498'})]),oz([profile()]));
  assert.equal(report.rows[0].status,statuses.invalid);
  assert.equal(report.safeguards.automaticRenames,false);
});
test('Ozmonet identity requires exact unadorned official profile paths',()=>{
  for(const suffix of ['?cache=1','#info']){
    assert.equal(validOzProfile(profile({profileUrl:'https://ssx.ozmonet.com/user/186243498'+suffix})),false);
  }
  for(const url of [
    'https://attacker@ssx.ozmonet.com/user/186243498',
    'https://ssx.ozmonet.com:444/user/186243498',
    'https://ssx.ozmonet.com/user/000186243498',
    'http://ssx.ozmonet.com/user/186243498'
  ])assert.equal(validOzProfile(profile({profileUrl:url})),false,url);
  assert.equal(validOzProfile(profile({profileUrl:'https://ssx.ozmonet.com/user/186243498/'})),true);
});
test('claimed capture date must be real, complete and timezone-qualified',()=>{
  for(const invalid of [
    '2026-02-30T18:00:00.000Z',
    '2025-02-29T18:00:00.000Z',
    '2026-11-09T25:00:00.000Z',
    '2026-11-09T18:00:00',
    '2026-11-09',
    'prefix-2026-11-09T18:00:00Z',
    '2026-11-09T18:00:00+14:30'
  ])assert.throws(()=>reconcile({...sheet([]),capturedAt:invalid},oz([])),/capturedAt/,invalid);
  assert.equal(reconcile({...sheet([]),capturedAt:'2024-02-29T18:00:00+03:00'},oz([])).totalSheetsRecords,0);
});
test('claimed source URLs reject credentials, fragments and nonstandard ports',()=>{
  const base=url;
  for(const invalid of [
    base+'#sheet',
    'https://someone@docs.google.com/spreadsheets/d/1SAk84oy05R0UK3JJ_JWJTskSqxj4GpGJkdRqfSmnx2I/edit',
    'https://docs.google.com:444/spreadsheets/d/1SAk84oy05R0UK3JJ_JWJTskSqxj4GpGJkdRqfSmnx2I/edit'
  ])assert.throws(()=>reconcile({...sheet([]),sourceUrl:invalid},oz([])));
});
