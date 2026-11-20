const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 for(const [i,tree] of process.argv.slice(2).entries()){
  const src=fs.readFileSync(path.join(tree,'app/content/features/followup/engine.js'),'utf8');
  const queue=['one','two'].map(id=>({id,trigger:'enter',status:'pending',followUpId:'r'}));
  let sends=0;const stored=new Map();
  const env={started:true,pageSuspended:false,lifecycleEpoch:1,cancelledFollowupIds:new Set(),window:{__extDataMutationClient:{followup:async(_,payload)=>{
   if(payload.id==='two')throw Object.assign(Error('lost connection'),{code:'OFFLINE'});
   stored.set(payload.id,'sending');return {item:{id:payload.id,status:'sending',attemptToken:payload.attemptToken}};
  }}},dispatch:async()=>{sends++;return {status:'success',remoteEffectSucceeded:true};}};
  const a=src.indexOf('function isTickCurrent(');vm.runInNewContext(src.slice(a,src.indexOf('async function publishFollowUpOutcomes',a)),env);
  await assert.rejects(env.fireDue([{active:true,id:'r'}],queue,1,null,1,[],'scope',async o=>{stored.set(o.item.id,o.item.status)}),{code:'OFFLINE'});
  assert.equal(sends,1);assert.equal(stored.get('one'),i?'sent':'sending');
  console.log(JSON.stringify({revision:i?'candidate':'base',first:stored.get('one'),sends,secondClaim:'offline'}));
 }
})().catch(e=>{console.error(e);process.exitCode=1});
