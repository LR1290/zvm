#!/usr/bin/env node
'use strict';
/** Print evidence reconciliation to stdout; never modify input or write files. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {reconcile}=require('../src/hobbies/ssx/reconciliation-core.cjs');
const {groupCoverage}=require('../src/hobbies/ssx/coverage-audit.cjs');
function readJson(file){
  const info=fs.statSync(file);
  const maxBytes=128*1024*1024;
  if(!info.isFile()||info.size>maxBytes)throw new Error('snapshot must be a JSON file under 128 MiB');
  // Hash the actual bytes used for parsing, not a reserialized approximation.
  // A post-read size check also catches files growing between stat and read.
  const raw=fs.readFileSync(file);
  if(raw.length>maxBytes)throw new Error('snapshot must be a JSON file under 128 MiB');
  return {
    value:JSON.parse(raw.toString('utf8')),
    rawSha256:crypto.createHash('sha256').update(raw).digest('hex'),
    sizeBytes:raw.length
  };
}
function main(args){
  if(args.length!==2&&args.length!==3){
    process.stderr.write('Usage: node tools/ssx-reconcile-readonly.cjs <google-sheets-snapshot.json> <ozmonet-profiles-snapshot.json> [expected-categories.json]\n');
    return 2;
  }
  const [sheetFile,ozFile]=args.slice(0,2).map(file=>readJson(path.resolve(file)));
  const manifestFile=args[2]?readJson(path.resolve(args[2])):null;
  const sheets=sheetFile.value,oz=ozFile.value;
  const manifest=manifestFile?manifestFile.value:[];
  if(!Array.isArray(manifest))throw new Error('Expected categories manifest must be a JSON array');
  const identities=reconcile(sheets,oz);
  const coverage=groupCoverage(sheets,oz,manifest);
  const digest=f=>f?{sha256:f.rawSha256,sizeBytes:f.sizeBytes}:null;
  const result={
    schemaVersion:2,kind:'ssx-source-reconciliation-report',
    inputEvidence:{
      googleSheets:digest(sheetFile),
      ozmonet:digest(ozFile),
      expectedCategories:digest(manifestFile)
    },
    verificationBoundary:{
      rawFileIntegrityFingerprinted:true,
      onlineSourceCaptureVerified:false,
      claimedCaptureTimestampsIndependentlyVerified:false,
      manifestIndependenceIndependentlyVerified:false,
      externalRankingCertification:false,
      automaticNameChanges:false,
      requiresHumanSourceReview:true
    },
    identities,coverage
  };
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  return !coverage.safeguards.canCertifyLeaders||
    !coverage.safeguards.canCertifyRiderNames?3:0;
}
if(require.main===module){
  try{process.exitCode=main(process.argv.slice(2));}
  catch(error){process.stderr.write('SSX reconciliation refused: '+error.message+'\n');process.exitCode=2;}
}
module.exports={main};
