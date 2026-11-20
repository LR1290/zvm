'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const patch=fs.readFileSync(path.join(__dirname,'r109-login-recovery-from-minified-r106.patch'),'utf8');
const additions=patch.split('\n').filter(x=>x.startsWith('+')&&!x.startsWith('+++')).map(x=>x.slice(1)).join('\n');
test('offline recovery offers key/account without granting authorization',()=>{
  assert.match(additions,/id":"extappOfflineUseKeyBtn/);
  const click=additions.match(/if\(recovery\)recovery\.addEventListener\("click",function\(\)\{([\s\S]*?)\n\}\);/);
  assert.ok(click,'recovery click handler missing');
  assert.match(click[1],/setAuthGateState\("login"\)/);
  assert.doesNotMatch(click[1],/setAuthGateState\("none"\)/);
  assert.doesNotMatch(click[1],/authorized\s*[:=]\s*true/);
});
test('integrity/context failures cannot expose manual auth action',()=>{
  assert.match(additions,/domain!=="INTEGRITY"/);
  assert.match(additions,/code!=="EXTENSION_CONTEXT_INVALIDATED"/);
  assert.match(additions,/EXTENSION_INTEGRITY_/);
  assert.match(additions,/recovery\.hidden=!allowed;recovery\.style\.display=allowed\?"":"none"/);
});
test('cached credential cannot trap reauthentication in retry-only UI',()=>{
  assert.match(additions,/_manualLoginRecovery&&recoveryLoginPermitted\(detail\)/);
  assert.match(additions,/_preferKeyOnLogin=true/);
  assert.match(additions,/keyButton\.click\(\)/);
});
test('network/session response errors are HOST errors, not boot failures',()=>{
  assert.match(additions,/SESSION_RESPONSE_INVALID\|SERVER_SESSION_RESPONSE_INVALID/);
  assert.match(additions,/SERVER_SESSION_TIMEOUT/);
});
