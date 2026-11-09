#!/usr/bin/env node
'use strict';
/** Print evidence reconciliation to stdout; never modify input or write files. */
const fs=require('node:fs');
const path=require('node:path');
const {reconcile}=require('../src/hobbies/ssx/reconciliation-core.cjs');
const {groupCoverage}=require('../src/hobbies/ssx/coverage-audit.cjs');
function readJson(file){
  const info=fs.statSync(file);
  if(!info.isFile()||info.size>128*1024*1024)throw new Error('snapshot must be a JSON file under 128 MiB');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function main(args){
  if(args.length!==2&&args.length!==3){
    process.stderr.write('Usage: node tools/ssx-reconcile-readonly.cjs <google-sheets-snapshot.json> <ozmonet-profiles-snapshot.json> [expected-categories.json]\n');
    return 2;
  }
  const [sheets,oz]=args.slice(0,2).map(file=>readJson(path.resolve(file)));
  const manifest=args[2]?readJson(path.resolve(args[2])):[];
  if(!Array.isArray(manifest))throw new Error('Expected categories manifest must be a JSON array');
  const identities=reconcile(sheets,oz);
  const coverage=groupCoverage(sheets,oz,manifest);
  const result={kind:'ssx-source-reconciliation-report',identities,coverage};
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  return !coverage.safeguards.canCertifyLeaders||
    !coverage.safeguards.canCertifyRiderNames?3:0;
}
if(require.main===module){
  try{process.exitCode=main(process.argv.slice(2));}
  catch(error){process.stderr.write('SSX reconciliation refused: '+error.message+'\n');process.exitCode=2;}
}
module.exports={main};
