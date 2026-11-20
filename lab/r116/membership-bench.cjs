const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 for(const [i,tree] of process.argv.slice(2).entries()){
  const source=fs.readFileSync(path.join(tree,'app/content/features/followup/engine.js'),'utf8');
  const a=source.indexOf(source.includes('function pendingFor')?'function pendingFor':'function enqueue(');
  const b=source.indexOf('function isTickCurrent',a);
  for(const n of [1,10,100,1000,10000]){
   let lookups=0,serial=0;
   const env={contactKey:x=>{lookups++;return x.contact.key;},contactPhone:()=>'',contactName:()=>'',uid:()=>String(++serial),
    currentColumn:items=>({exists:true,items}),triggerKind:()=> 'enter',emit(){}};
   vm.runInNewContext(source.slice(a,b),env);
   const rule={id:'r',active:true,source:{crmId:'c',columnId:'x'}},items=Array.from({length:n},(_,k)=>({contact:{key:'fixture-'+k}}));
   const queue=[],mem={rules:{r:{members:{},initialized:true,membersVersion:2}}};
   const start=performance.now();const result=await env.syncMembership([rule],items,queue,mem,1,'a'.repeat(64));const ms=performance.now()-start;
   assert.equal(queue.length,n);assert.equal(new Set(queue.map(x=>x.contactKey)).size,n);assert(result.queueChanged);
   if(i)assert(lookups<=2*n);
   console.log(JSON.stringify({revision:i?'candidate':'base',n,lookups,ms,created:queue.length}));
  }
 }
})().catch(e=>{console.error(e);process.exitCode=1});
