'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');

const cli=path.resolve(__dirname,'../tools/ssx-reconcile-readonly.cjs');
const capturedAt='2026-11-09T18:00:00.000Z';
const sheet={
  kind:'google_sheets',capturedAt,
  sourceUrl:'https://docs.google.com/spreadsheets/d/1SAk84oy05R0UK3JJ_JWJTskSqxj4GpGJkdRqfSmnx2I/edit',
  records:[{
    recordId:'synthetic-r1',eventId:'synthetic-event',trackId:'synthetic-track',
    platform:'xbox360',mode:'board',variant:'standard',position:1,
    value:'00:49.33',riderName:'SyntheticRider',playerId:'123456',
    proofUrl:'https://youtu.be/synthetic-proof'
  }]
};
const oz={
  kind:'ozmonet',capturedAt,sourceUrl:'https://ssx.ozmonet.com/',
  players:[{playerId:'123456',gamertag:'SyntheticRider',
    profileUrl:'https://ssx.ozmonet.com/user/123456'}]
};
const manifest=[{
  platform:'xbox360',mode:'board',variant:'standard',recordCount:1,
  tracks:[{eventId:'synthetic-event',trackId:'synthetic-track',recordCount:1}]
}];
function fixture(t,overrides={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ssx-r68-evidence-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const payloads={
    sheets:JSON.stringify(overrides.sheets??sheet,null,2)+'\n',
    ozmonet:JSON.stringify(overrides.ozmonet??oz,null,2)+'\n',
    manifest:JSON.stringify(overrides.manifest??manifest,null,2)+'\n'
  };
  const filenames={};
  for(const [key,payload] of Object.entries(payloads)){
    const name=path.join(dir,key+'.json');
    fs.writeFileSync(name,payload,'utf8');
    filenames[key]=name;
  }
  return {dir,filenames,payloads};
}
function invoke(filenames,hasManifest=true){
  return spawnSync(process.execPath,[
    cli,filenames.sheets,filenames.ozmonet,
    ...(hasManifest?[filenames.manifest]:[])
  ],{encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024});
}
const sha=buf=>crypto.createHash('sha256').update(buf).digest('hex');

test('CLI fingerprints exact source and independent manifest bytes without writing to inputs',t=>{
  const {filenames}=fixture(t);
  const before=Object.fromEntries(Object.entries(filenames).map(([key,file])=>[key,fs.readFileSync(file)]));
  const run=invoke(filenames);
  assert.equal(run.status,0,run.stderr);
  const result=JSON.parse(run.stdout);
  assert.equal(result.schemaVersion,2);
  for(const [key,fileKey] of [['googleSheets','sheets'],['ozmonet','ozmonet'],['expectedCategories','manifest']]){
    assert.equal(result.inputEvidence[key].sha256,sha(before[fileKey]));
    assert.equal(result.inputEvidence[key].sizeBytes,before[fileKey].length);
    assert.deepEqual(fs.readFileSync(filenames[fileKey]),before[fileKey]);
  }
  assert.equal(result.coverage.safeguards.canCertifyLeaders,true);
  assert.equal(result.coverage.safeguards.canCertifyRiderNames,true);
  assert.equal(result.verificationBoundary.onlineSourceCaptureVerified,false);
  assert.equal(result.verificationBoundary.manifestIndependenceIndependentlyVerified,false);
  assert.equal(result.verificationBoundary.externalRankingCertification,false);
  assert.equal(result.verificationBoundary.automaticNameChanges,false);
});
test('byte digest changes with whitespace even when normalized snapshot hash is identical',t=>{
  const {filenames}=fixture(t);
  const initial=invoke(filenames);
  assert.equal(initial.status,0,initial.stderr);
  const first=JSON.parse(initial.stdout);
  const original=fs.readFileSync(filenames.sheets,'utf8');
  fs.writeFileSync(filenames.sheets,original.replace('  "kind"', '    "kind"'),'utf8');
  const secondRun=invoke(filenames);
  assert.equal(secondRun.status,0,secondRun.stderr);
  const second=JSON.parse(secondRun.stdout);
  assert.notEqual(first.inputEvidence.googleSheets.sha256,second.inputEvidence.googleSheets.sha256);
  assert.equal(first.identities.snapshots.googleSheets.sha256,second.identities.snapshots.googleSheets.sha256);
  assert.equal(second.inputEvidence.googleSheets.sha256,sha(fs.readFileSync(filenames.sheets)));
});
test('missing independent manifest remains diagnostic only, not a certified capture',t=>{
  const {filenames}=fixture(t);
  const run=invoke(filenames,false);
  assert.equal(run.status,3,run.stderr);
  const result=JSON.parse(run.stdout);
  assert.equal(result.inputEvidence.expectedCategories,null);
  assert.equal(result.coverage.safeguards.canCertifyLeaders,false);
  assert.equal(result.coverage.safeguards.canCertifyRiderNames,false);
  assert.equal(result.verificationBoundary.externalRankingCertification,false);
});
test('a leading-zero profile ID cannot be used to approve a rider identity',t=>{
  const badOz=structuredClone(oz);
  badOz.players[0].playerId='000123456';
  badOz.players[0].profileUrl='https://ssx.ozmonet.com/user/000123456';
  const {filenames}=fixture(t,{ozmonet:badOz});
  const run=invoke(filenames);
  assert.equal(run.status,3,run.stderr);
  const result=JSON.parse(run.stdout);
  assert.equal(result.identities.invalidOzmonetProfiles.length,1);
  assert.equal(result.coverage.safeguards.canCertifyRiderNames,false);
  assert.equal(result.coverage.safeguards.canCertifyLeaders,true);
});
test('swapping source kinds is refused without emitting a misleading certified report',t=>{
  const {filenames}=fixture(t);
  const run=invoke({sheets:filenames.ozmonet,ozmonet:filenames.sheets,manifest:filenames.manifest});
  assert.equal(run.status,2);
  assert.match(run.stderr,/invalid kind/);
  assert.equal(run.stdout,'');
});
