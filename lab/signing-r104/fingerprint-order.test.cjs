'use strict';
// Regression fixture for R106: placing mode before sha256/size gave a
// valid Ed25519 signature over a fingerprint rejected by the MV3 runtime.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
function sha(x) {return createHash('sha256').update(x).digest('hex')}
const normal={path:'app/background/service-worker.js',sha256:'a'.repeat(64),size:123};
const manifest={path:'manifest.json',sha256:'b'.repeat(64),size:321,mode:'manifest-json-v1'};
const mv3Files=[normal,manifest];
const declared=sha(JSON.stringify({extensionVersion:'0.9.305',files:mv3Files}));
test('Python canonical fingerprint matches exact browser JSON field order',()=>{
  const fixture=[
    'import json,hashlib',
    "normal={'path':'app/background/service-worker.js','sha256':'a'*64,'size':123}",
    "manifest={'path':'manifest.json','sha256':'b'*64,'size':321,'mode':'manifest-json-v1'}",
    "data={'extensionVersion':'0.9.305','files':[normal,manifest]}",
    "print(hashlib.sha256(json.dumps(data,separators=(',',':'),ensure_ascii=False).encode()).hexdigest())"
  ].join('\n');
  const result=spawnSync('python3',['-c',fixture],{encoding:'utf8'});
  if(result.error)throw result.error;
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout.trim(),declared);
});
test('R106 wrong insertion order MUST produce a different fingerprint',()=>{
  const broken={path:'manifest.json',mode:'manifest-json-v1',sha256:'b'.repeat(64),size:321};
  const incorrect=sha(JSON.stringify({extensionVersion:'0.9.305',files:[normal,broken]}));
  assert.notEqual(incorrect,declared);
});
test('only manifest entry carries mode and it appears after size',()=>{
  assert.deepEqual(Object.keys(manifest),['path','sha256','size','mode']);
  assert.deepEqual(Object.keys(normal),['path','sha256','size']);
});
