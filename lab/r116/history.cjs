const vm=require('node:vm'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
for(const [i,tree] of process.argv.slice(2).entries()){
 const s=fs.readFileSync(path.join(tree,'app/background/authority/offscreen-options-data.js'),'utf8');
 const env={FOLLOWUP_TERMINAL_MAX:300,FOLLOWUP_TERMINAL_MAX_AGE_MS:30*86400000,followQueueInput:r=>({...r})};
 vm.runInNewContext(s.slice(s.indexOf('function followStatusTerminal'),s.indexOf('function followReplace'))+s.slice(s.indexOf('function mergeFollowQueue'),s.indexOf('async function mutateFollowup')),env);
 const old={id:'review',followUpId:'r',status:'error',durableReviewRequired:true,enqueuedAtMs:1};
 const terminal=Array.from({length:301},(_,n)=>({id:'sent-'+n,followUpId:'r',status:'sent',firedAtMs:Date.now()}));
 const rows=env.compactFollowQueue([old,...terminal],Date.now());
 assert.equal(rows.some(r=>r.id===old.id),!!i);assert.equal(rows.filter(r=>r.status==='sent').length,300);
 const pending={id:'flight',followUpId:'removed',status:'sending',attemptToken:'attempt1'};
 const stale={...pending,status:'pending'};
 const hold=env.mergeFollowQueue([pending],[stale],new Set());
 assert.equal(hold.length,i?1:0);
 if(i){
  assert.equal(hold[0].status,'sending');
  const confirmed=env.mergeFollowQueue(hold,[{...pending,status:'error',lastAttemptToken:'attempt1',durableReviewRequired:true}],new Set());
  assert.equal(confirmed[0].status,'error');
  assert.equal(env.mergeFollowQueue(confirmed,[],new Set()).length,1);
 }
 console.log(JSON.stringify({version:i?'candidate':'base',uncertainKept:rows.some(r=>r.id===old.id),normalTerminal:300,detachedInFlight:hold.length}));
}
