const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const file=path.join(process.argv[2],'app/background/authority/offscreen-options-data.js');
 const code=fs.readFileSync(file,'utf8').split('\n').find(s=>s.startsWith('async function mutateFollowup('));
 let writes=0,reads=0,active=true,review=false,authorized=true;
 const scope='a'.repeat(48);
 const env={extError:(code,msg)=>Object.assign(Error(msg),{code}),
  extServerAuthorityRequire:async()=>{if(!authorized)throw Object.assign(Error('unavailable'),{code:'LICENSE_REQUIRED'})},
  extPlanRequirePaidBg:async()=>{},readFollowRules:async()=>{reads++;return{rows:[{id:'r',active}]};},
  readFollowQueue:async()=>({rows:[{id:'q',followUpId:'r',status:'pending',durableReviewRequired:review}]}),
  followRuleInput:x=>({...x}),followQueueInput:x=>({...x}),txt:String,writeFollowBatch:async()=>{writes++},
  FOLLOWUP_QUEUE_KEY:'q',followReplace:(_,__,rows)=>rows,compactFollowQueue:x=>x};
 vm.createContext(env);vm.runInContext(code,env);
 const claim=()=>env.mutateFollowup('queue_claim',{id:'q',attemptToken:'qa-attempt',expectedStatus:'pending',expectedAccountScope:scope},scope);
 await assert.rejects(env.mutateFollowup('queue_claim',{expectedAccountScope:'b'.repeat(48)},scope),{code:'ACCOUNT_SCOPE_CHANGED'});
 assert.equal(reads,0);
 authorized=false;await assert.rejects(claim(),{code:'LICENSE_REQUIRED'});
 authorized=true;review=true;await assert.rejects(claim(),{code:'FOLLOWUP_REVIEW_REQUIRED'});
 review=false;active=false;await assert.rejects(claim(),{code:'FOLLOWUP_RULE_INACTIVE'});
 assert.equal(writes,0);active=true;assert.equal((await claim()).item.status,'sending');assert.equal(writes,1);
 console.log('PASS switched account, authority denied, review pending, rule inactive: zero claim writes. Positive control: one write.');
})().catch(e=>{console.error(e);process.exitCode=1});
