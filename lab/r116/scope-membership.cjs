const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 for(const [i,tree] of process.argv.slice(2).entries()){
  const src=fs.readFileSync(path.join(tree,'app/content/features/followup/engine.js'),'utf8');
  const calls=[];
  const scope='a'.repeat(64);
  const env={contactKey:row=>row.contact.key,contactPhone:()=>'',contactName:row=>row.contact.name,
    currentColumn:crms=>({exists:true,items:crms}),uid:()=>'id',triggerKind:()=>'enter',emit(){},resolveTarget:async()=> 'fixture',
    actionsForRule:async()=>['fixture'],allowsGroup:()=>true,window:{__extFunnelActionWhatsappIdentity:{currentScope:async()=>scope},
      __extActionExecutor:{execute:async(_,ctx)=>{calls.push(ctx.whatsappScope);return {status:'success'}}}}};
  vm.runInNewContext(src.slice(src.indexOf('async function dispatch'),src.indexOf('function isTickCurrent')),env);
  const rule={id:'r',active:true,source:{crmId:'c',columnId:'x'}},contacts=[{contact:{key:'qa',name:'fixture'}}],membership={rules:{}},queue=[];
  await env.syncMembership([rule],contacts,queue,membership,1,scope);
  let stableWrites=0;
  for(let t=2;t<=1001;t++){if((await env.syncMembership([rule],contacts,queue,membership,t,scope)).membershipChanged)stableWrites++;}
  contacts[0].contact.name='changed';assert((await env.syncMembership([rule],contacts,queue,membership,1002,scope)).membershipChanged);
  assert.equal(queue.length,1);
  await env.dispatch(rule,queue[0]);const before=calls.length;
  env.window.__extFunnelActionWhatsappIdentity.currentScope=async()=>'b'.repeat(64);
  const code=await env.dispatch(rule,queue[0]).then(()=>null,e=>e.code);
  if(i){
   assert.equal(calls[0],scope);assert.equal(code,'FOLLOWUP_SENDER_SCOPE_CHANGED');
   await assert.rejects(env.dispatch(rule,{id:'legacy'}),{code:'FOLLOWUP_SENDER_SCOPE_UNBOUND'});
  }
  assert.equal(calls.length-before,i?0:1);assert.equal(stableWrites,i?0:1000);
  console.log(JSON.stringify({version:i?'candidate':'base',stableMembershipWriteRequests:stableWrites,afterSwitch:calls.length-before,legacyHeld:!!i}));
 }
})().catch(e=>{console.error(e);process.exitCode=1});
