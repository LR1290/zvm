'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {groupCoverage,categoryKey}=require('../src/hobbies/ssx/coverage-audit.cjs');
const capturedAt='2026-11-09T18:00:00.000Z';
// Fictional IDs and events for deterministic testing, not assertions about real riders.
const sheets=records=>({kind:'google_sheets',sourceUrl:'https://docs.google.com/spreadsheets/d/1SAk84oy05R0UK3JJ_JWJTskSqxj4GpGJkdRqfSmnx2I/edit',capturedAt,records});
const oz=players=>({kind:'ozmonet',sourceUrl:'https://ssx.ozmonet.com/',capturedAt,players});
const p={playerId:'123456',gamertag:'TestRider',profileUrl:'https://ssx.ozmonet.com/user/123456'};
const row=(patch={})=>({recordId:'r1',eventId:'race-01',trackId:'track-01',platform:'xbox360',mode:'board',variant:'standard',position:1,value:'00:48.30',riderName:'TestRider',playerId:'123456',proofUrl:'https://youtu.be/abc123',...patch});
const required=(patch={})=>({platform:'xbox360',mode:'board',variant:'standard',recordCount:1,
  tracks:[{eventId:'race-01',trackId:'track-01',recordCount:1}],...patch});
test('reports independent categories and full 1st-place counts on different platforms',()=>{
  const records=[
    row(),row({recordId:'r2',eventId:'race-02',trackId:'track-02',value:'00:40.20'}),
    row({recordId:'r3',platform:'android',eventId:'race-01',mode:'android',trackId:'track-01'}),
    row({recordId:'r4',platform:'xbox360',mode:'dev',eventId:'test-rail',trackId:'test-rail'})
  ];
  const report=groupCoverage(sheets(records),oz([p]));
  assert.equal(report.totals.sheetRecords,4);
  assert.equal(report.totals.categories,3);
  assert.equal(report.totals.firstPlaces,4);
  const board=report.categories.find(x=>x.mode==='board');
  assert.equal(board.records,2);
  assert.equal(board.uniqueTracks,2);
  assert.equal(board.firstPlaceTracks,2);
  assert.equal(board.withProof,2);
  assert.equal(report.safeguards.changesApplied,0);
});
test('missing expected Level 9, Android and DEV are reported, never fabricated',()=>{
  const expected=[required(),required({platform:'android',mode:'android'}),
    required({mode:'level9'}),required({mode:'dev',variant:'test'})];
  const report=groupCoverage(sheets([row()]),oz([p]),expected);
  assert.equal(report.totals.missingExpectedCategories,3);
  assert.deepEqual(report.missingExpected.map(c=>c.mode),['android','level9','dev']);
  assert.equal(report.safeguards.canCertifyLeaders,false);
});
test('no gear and no wings remain separate variants and never silently merge',()=>{
  const report=groupCoverage(sheets([
    row(),row({recordId:'r2',variant:'no_gear',trackId:'track-01',eventId:'race-01'}),
    row({recordId:'r3',variant:'no_wings',trackId:'track-01',eventId:'race-01'})
  ]),oz([p]));
  assert.deepEqual(report.categories.map(c=>c.variant),['no_gear','no_wings','standard']);
  assert.equal(report.totals.categories,3);
  assert.equal(report.eventPositionCollisions.length,0);
});
test('duplicate #1 for same event/track/variant is flagged and blocks certification',()=>{
  const report=groupCoverage(sheets([row(),row({recordId:'r2',riderName:'AnotherRider'})]),oz([p]));
  assert.equal(report.totals.ambiguousEventPositions,1);
  assert.equal(report.safeguards.canCertifyLeaders,false);
});
test('non-numeric or missing player IDs block name certification',()=>{
  const report=groupCoverage(sheets([row({playerId:null})]),oz([p]));
  assert.equal(report.totals.identitiesUnresolved,1);
  assert.equal(report.safeguards.canCertifyRiderNames,false);
});
test('an exact confirmed ID does not certify a wrong record or arbitrary categories',()=>{
  const report=groupCoverage(sheets([row({position:0})]),oz([p]),[{platform:'xbox360',mode:'bogus',variant:'standard'}]);
  assert.equal(report.totals.invalidCategoryRows,0);
  assert.equal(report.categories[0].invalidRecords,1);
  assert.equal(report.safeguards.canCertifyLeaders,false);
  assert.deepEqual(report.invalidExpectations,[0]);
});
test('cross-mode scores are not compared as raw times',()=>{
  const report=groupCoverage(sheets([row(),row({recordId:'r2',mode:'wings',value:'00:18.00'})]),oz([p]));
  assert.equal(report.totals.categories,2);
  assert.equal(report.safeguards.crossTrackTimeRanking,false);
});
test('all category keys are stable and explicit',()=>{
  assert.equal(categoryKey({platform:'android',mode:'android',variant:'no_gear'}),'["android","android","no_gear"]');
  const original=sheets([row()]);
  const before=JSON.stringify(original);
  const a=groupCoverage(original,oz([p]),[required()]);
  assert.equal(JSON.stringify(original),before);
  assert.equal(a.totals.missingExpectedCategories,0);
  assert.equal(a.safeguards.canCertifyLeaders,true);
  assert.equal(a.safeguards.canCertifyRiderNames,true);
});

test('empty Sheets capture never certifies leaders or identities',()=>{
  const report=groupCoverage(sheets([]),oz([p]));
  assert.equal(report.totals.sheetRecords,0);
  assert.equal(report.safeguards.canCertifyLeaders,false);
  assert.equal(report.safeguards.canCertifyRiderNames,false);
});
test('missing explicit #1 in even one present track blocks certification',()=>{
  const report=groupCoverage(sheets([
    row(),row({recordId:'r2',eventId:'race-02',trackId:'track-02',position:2})
  ]),oz([p]));
  assert.equal(report.totals.tracksWithoutFirstPlace,1);
  assert.equal(report.safeguards.canCertifyLeaders,false);
});
test('invalid expected-category schema blocks certification rather than being silently skipped',()=>{
  const report=groupCoverage(sheets([row()]),oz([p]),[{platform:'xbox360',mode:'not-a-mode'}]);
  assert.deepEqual(report.invalidExpectations,[0]);
  assert.equal(report.safeguards.canCertifyLeaders,false);
});
test('duplicated stable record IDs block leader and identity certification',()=>{
  const report=groupCoverage(sheets([
    row({recordId:'same'}),
    row({recordId:'same',eventId:'race-02',trackId:'track-02'})
  ]),oz([p]));
  assert.equal(report.totals.duplicateRecordIds,1);
  assert.equal(report.safeguards.canCertifyLeaders,false);
  assert.equal(report.safeguards.canCertifyRiderNames,false);
});
test('a malformed Ozmonet profile cannot lead to whole-capture identity certification',()=>{
  const report=groupCoverage(sheets([row()]),oz([p,{...p,playerId:'malformed'}]),[required()]);
  assert.equal(report.safeguards.canCertifyLeaders,true);
  assert.equal(report.safeguards.canCertifyRiderNames,false);
});

test('a subset of valid #1 results never certifies without an explicit manifest',()=>{
  const report=groupCoverage(sheets([row()]),oz([p]));
  assert.equal(report.totals.sheetRecords,1);
  assert.equal(report.totals.firstPlaces,1);
  assert.equal(report.safeguards.coverageManifestMatchesSnapshot,false);
  assert.equal(report.safeguards.canCertifyLeaders,false);
  assert.equal(report.safeguards.canCertifyRiderNames,false);
});
test('an independently provided per-track manifest can certify complete synthetic evidence',()=>{
  const report=groupCoverage(sheets([row()]),oz([p]),[required()]);
  assert.equal(report.safeguards.coverageManifestMatchesSnapshot,true);
  assert.equal(report.safeguards.canCertifyLeaders,true);
  assert.equal(report.safeguards.canCertifyRiderNames,true);
});
test('missing known tracks fail closed even when all included records are valid #1',()=>{
  const manifest=required({recordCount:2,tracks:[
    {eventId:'race-01',trackId:'track-01',recordCount:1},
    {eventId:'race-02',trackId:'track-02',recordCount:1}
  ]});
  const report=groupCoverage(sheets([row()]),oz([p]),[manifest]);
  assert.equal(report.safeguards.coverageManifestMatchesSnapshot,false);
  assert.deepEqual(report.mismatchedExpected[0].missingTracks,['["race-02","track-02"]']);
  assert.equal(report.safeguards.canCertifyLeaders,false);
});
test('record rows omitted from a known track cannot be certified',()=>{
  const report=groupCoverage(sheets([row()]),oz([p]),[required({
    recordCount:2,tracks:[{eventId:'race-01',trackId:'track-01',recordCount:2}]
  })]);
  assert.equal(report.mismatchedExpected[0].wrongTrackCounts[0].observedRecords,1);
  assert.equal(report.safeguards.canCertifyLeaders,false);
});
test('unlisted categories and duplicated expected categories invalidate certification',()=>{
  const actual=sheets([row(),row({recordId:'r2',platform:'android',mode:'android'})]);
  const unlisted=groupCoverage(actual,oz([p]),[required()]);
  assert.equal(unlisted.unexpectedCategories.length,1);
  assert.equal(unlisted.safeguards.canCertifyLeaders,false);
  const duplicate=groupCoverage(sheets([row()]),oz([p]),[required(),required()]);
  assert.deepEqual(duplicate.invalidExpectations,[1]);
  assert.equal(duplicate.safeguards.canCertifyLeaders,false);
});
test('malformed track requirements or self-contradictory totals are invalid evidence',()=>{
  const repeated=groupCoverage(sheets([row()]),oz([p]),[required({recordCount:2,
    tracks:[{eventId:'race-01',trackId:'track-01',recordCount:1},
      {eventId:'race-01',trackId:'track-01',recordCount:1}]
  })]);
  assert.deepEqual(repeated.invalidExpectations,[0]);
  const inconsistent=groupCoverage(sheets([row()]),oz([p]),[required({recordCount:5})]);
  assert.deepEqual(inconsistent.invalidExpectations,[0]);
  assert.equal(inconsistent.safeguards.canCertifyRiderNames,false);
});
test('duplicate first places also block rider-name certification with valid IDs',()=>{
  const report=groupCoverage(sheets([row(),row({recordId:'r2'})]),oz([p]),[required({
    recordCount:2,tracks:[{eventId:'race-01',trackId:'track-01',recordCount:2}]
  })]);
  assert.equal(report.eventPositionCollisions.length,1);
  assert.equal(report.safeguards.canCertifyRiderNames,false);
});
