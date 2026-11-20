const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 for(const [i,tree] of process.argv.slice(2).entries()){
  const data=fs.readFileSync(path.join(tree,'app/background/authority/offscreen-options-data.js'),'utf8');
  const engine=fs.readFileSync(path.join(tree,'app/content/features/followup/engine.js'),'utf8');
  const env={extError:(code,msg)=>Object.assign(Error(msg),{code}),contactKey:x=>x.key,contactPhone:()=>'',contactName:()=>'',uid:()=>String(Math.random()),
    currentColumn:crms=>({exists:true,items:crms}),triggerKind:()=>'enter',emit(){}};
  const take=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
  vm.runInNewContext(take(data,'function safe(value','function digits')+take(data,'function followMembership','function followStatusTerminal')+
    take(engine,engine.includes('function pendingFor')?'function pendingFor':'function enqueue(','function isTickCurrent'),env);
  const rule={id:'qa',active:true,source:{crmId:'c',columnId:'x'}},contacts=Array.from({length:250},(_,n)=>({key:'fixture-'+n,contact:{}}));
  const first={rules:{}},previous=[];
  await env.syncMembership([rule],contacts,previous,first,1,'a'.repeat(64));
  const saved=env.followMembership(first),count=Object.keys(saved.rules.qa.members).length;
  const last=previous.map(x=>({...x,status:'sent'}));
  await env.syncMembership([rule],contacts,last,saved,2,'a'.repeat(64));
  assert.equal(count,i?250:200);assert.equal(last.filter(r=>r.status==='pending').length,i?0:50);
  if(i){
   const legacy=structuredClone(first);delete legacy.rules.qa.membersVersion;
   legacy.rules.qa.members=Object.fromEntries(Object.entries(legacy.rules.qa.members).slice(0,200));
   const history=previous.map(x=>({...x,status:'sent'}));
   await env.syncMembership([rule],contacts,history,legacy,3,'a'.repeat(64));
   assert.equal(history.filter(r=>r.status==='pending').length,0);assert.equal(history.filter(r=>r.durableReviewRequired).length,50);
   await env.syncMembership([rule],contacts,history,legacy,4,'a'.repeat(64));
   assert.equal(history.length,300);
  }
  console.log(JSON.stringify({version:i?'candidate':'base',membersPersisted:count,duplicatePending:last.filter(r=>r.status==='pending').length,legacyHeld:i?50:undefined}));
 }
})().catch(e=>{console.error(e);process.exitCode=1});
