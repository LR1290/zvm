#!/usr/bin/env node
'use strict';
/** Print evidence reconciliation to stdout; never modify input or write files. */
const fs=require('node:fs');
const path=require('node:path');
const {reconcile}=require('../src/hobbies/ssx/reconciliation-core.cjs');
function readJson(file){
  const info=fs.statSync(file);
  if(!info.isFile()||info.size>128*1024*1024)throw new Error('snapshot must be a JSON file under 128 MiB');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function main(args){
  if(args.length!==2){
    process.stderr.write('Usage: node tools/ssx-reconcile-readonly.cjs <google-sheets-snapshot.json> <ozmonet-profiles-snapshot.json>\n');
    return 2;
  }
  const [sheets,oz]=args.map(file=>readJson(path.resolve(file)));
  const result=reconcile(sheets,oz);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  return result.summary.INVALID_EVIDENCE||result.summary.ID_CONFLICT_IN_OZMONET?3:0;
}
if(require.main===module){
  try{process.exitCode=main(process.argv.slice(2));}
  catch(error){process.stderr.write('SSX reconciliation refused: '+error.message+'\n');process.exitCode=2;}
}
module.exports={main};
