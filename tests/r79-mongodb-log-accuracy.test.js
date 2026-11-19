'use strict';
// R79 — startup diagnostics must describe the DB selected by MONGODB_DB.
// Offline test: no MongoDB connections, writes or migrations.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
const first=src.indexOf('const MONGODB_DB = (() => {');
const last=src.indexOf('const MAX_USES =',first);
assert(first>=0 && last>first,'MongoDB namespace config boundary');
const selector=src.slice(first,last);
const resolve=(env)=>{
  const messages=[];
  const output={info:(...x)=>messages.push(x.join(' ')),warn:(...x)=>messages.push(x.join(' '))};
  const db=new Function('process','console',selector+'\nreturn MONGODB_DB;')({env},output);
  return {db,messages};
};
const prod=resolve({});
assert.equal(prod.db,'zapvoice','preserve legacy production default until approved migration');
assert.equal(prod.messages.length,0);
const staging=resolve({MONGODB_DB:' zvm_lite_staging_20261118 '});
assert.equal(staging.db,'zvm_lite_staging_20261118');
assert.equal(staging.messages.length,1);
assert.match(staging.messages[0],/zvm_lite_staging_20261118/);
assert(!staging.messages[0].includes('suas chaves estao em "zapvoice"'),
  'must not claim that all keys are held in another database');
const future=resolve({MONGODB_DB:'zvm'});
assert.equal(future.db,'zvm');
assert.equal(future.messages.length,1);
assert(src.includes('client.db(MONGODB_DB)'),'runtime must use configured namespace');
assert(src.includes('🍃 MongoDB: ${MONGODB_DB}.store | Chaves:'),
  'startup log must report selected DB namespace');
assert(!src.includes('🍃 MongoDB: zapvoice.store | Chaves:'),
  'hardcoded misleading DB name must not return');
console.log('R79 MONGODB LOG PASS: production default stable; staging DB logs accurate; no writes');
