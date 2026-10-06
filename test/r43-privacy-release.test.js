'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const reg=JSON.parse(fs.readFileSync(path.join(__dirname,'..','zvm-build-registry-v2.json'),'utf8'));
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');

test('R43 production 0.8.749 exact CWS identity is active',()=>{
 const b=reg.builds.find(x=>x.buildId==='zvm-production-0.8.749-s7879bafe3cda');
 assert.ok(b);
 assert.equal(b.channel,'production');
 assert.equal(b.profile,'release');
 assert.equal(b.extensionVersion,'0.8.749');
 assert.equal(b.buildFingerprint,'25469c0c715052fd54cbc81a965d9816a56a1cf1eaab5384d2e19b7a64dc83c3');
 assert.equal(b.sourceTreeSha256,'7879bafe3cda147c76c8b76dc164bd2b764fc095de59d7fe9770c17fca654990');
 assert.deepEqual(b.extensionIds,['bdhnikgcdccjabkmbfcakgjkkgdlmgja']);
 assert.equal(b.status,'active');
});
test('R43 privacy page explicitly denies behavioral telemetry and advertising tracking',()=>{
 assert.match(source,/não usa telemetria comportamental/i);
 assert.match(source,/não utiliza cookies de publicidade/i);
 assert.match(source,/não coleta histórico de navegação/i);
});
test('R43 runtime build id advances from R42',()=>{
 assert.match(source,/const ZVM_BUILD_ID = '2026-10-06-privacy-oauth-release-r43';/);
});
