const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../staging/app/content/core/send-safety.js'),'utf8');
const start=src.indexOf('  function extBoundedSendTask('),end=src.indexOf('  async function runJob(',start);
assert(start>=0&&end>start);
test('campaign timeout remains uncertain after late ACK and dispatches once',async()=>{
  let expire,finish,budget,calls=0;
  const env={setTimeout:(fn,ms)=>{expire=fn;budget=ms;return 1},clearTimeout:()=>{},makeError:(code,msg,extra)=>Object.assign(Error(msg),{code,...extra})};
  vm.runInNewContext(src.slice(start,end),env);
  const outcome=env.extBoundedSendTask(()=>{calls++;return new Promise(resolve=>{finish=resolve})},'sendTxt',true);
  await Promise.resolve();
  assert.equal(budget,240000);
  expire();
  await assert.rejects(outcome,e=>e.remoteEffectUncertain===true && e.code==='SEND_TASK_ACK_TIMEOUT');
  finish('ack'); await Promise.resolve();assert.equal(calls,1);
});
