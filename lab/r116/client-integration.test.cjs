'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {executeV4FreeQuota:execute}=require('../../src/extension-v4-free-quota');
const src=fs.readFileSync(process.env.ZVM_LAB_SOURCE+'/app/background/authority/license-authority.js','utf8');
const snippet=src.slice(src.indexOf('// A single worker owns'),src.indexOf('function extLicenseStableValue(v){'));
function get(o,p){return p.split('.').reduce((x,k)=>x?.[k],o)}
function set(o,p,v){const a=p.split('.');let x=o;for(const k of a.slice(0,-1))x=x[k]||(x[k]={});x[a.at(-1)]=structuredClone(v)}
class DB{
  constructor(){this.docs=new Map();this.n=0}
  async insertOne(d){if(this.docs.has(d._id))throw Object.assign(Error('duplicate'),{code:11000});this.docs.set(d._id,structuredClone(d))}
  async findOne(f){return structuredClone(this.docs.get(f._id)||null)}
  async findOneAndUpdate(f,u){const d=this.docs.get(f._id);if(!d)return null;
    for(const [k,c] of Object.entries(f)){
      if(k==='_id')continue;const v=get(d,k);if(c&&typeof c==='object'&&('$exists'in c)&&((v!==undefined)!==c.$exists))return null;
      if(c&&typeof c==='object'&&('$lt'in c)&&!(v<c.$lt))return null;
      if((typeof c!=='object')&&v!==c)return null;
    }
    for(const[k,v]of Object.entries(u.$inc||{}))set(d,k,get(d,k)+v);
    for(const[k,v]of Object.entries(u.$set||{}))set(d,k,v);
    this.n++;return structuredClone(d)
  }
}
function setup(){
 const subject={type:'account',id:'a'.repeat(64)};
 const pub={authenticated:true,credentialPresent:true,authMethod:'password',serverSubjectId:subject.id,plan_id:'ZV_FREE'};
 const storage=new Map(),db=new DB(),calls=[];
 const sandbox={
  self:{extuiOpaqueV4Ensure:async()=>({authMethod:'password',subject,token:'b'.repeat(64),entitlement:{tier:'free'}})},
  _s05:'https://zvm.invalid',_s09:100000,chrome:{},crypto:webcrypto,AbortController,TextEncoder,Uint8Array,Date,Promise,setTimeout,clearTimeout,
  extLicenseOperationRevision:0,extPlanStateBg:async()=>({isFree:true,isPaid:false,license:pub}),
  extError:(code,message)=>Object.assign(Error(message),{code}),
  _s0q:async()=>({public:pub,secret:{}}),
  extStorageGetOne:async k=>storage.get(k),
  extStorageSetOne:async(k,v)=>{storage.set(k,structuredClone(v));return true},
  _s0ReadText:async r=>JSON.stringify(r.payload),
  fetch:async(url,opts)=>{
   assert.match(url,/\/extension\/v4\/free-usage$/);assert.equal(opts.headers.Authorization,'Bearer '+'b'.repeat(64));
   const request=JSON.parse(opts.body);calls.push(request);
   assert.equal('authKey'in request,false);assert.equal('phoneNumber'in request,false);assert.equal('messageId'in request,false);
   try {const payload=await execute({collection:db,subject,tier:'free',...request,now:new Date('2026-11-19T15:00:00Z')});return{status:200,payload};}
   catch(e){return{status:e.status||503,payload:{ok:false,status:false,errorCode:e.code||'temporarily_unavailable'}};}
  }
 };
 vm.runInNewContext(snippet,sandbox,{filename:'R99-license-authority.js'});
 return {sandbox,storage,db,calls,subject};
}
test('Free account can check quota without commercial key',async()=>{const x=setup();const r=await x.sandbox.extPlanUsageBg('check','message');assert.equal(r.limits.message.sent,0);assert.equal(x.calls[0].action,'check')});
test('reserve persists before sending and consumes only one',async()=>{const x=setup(),r=await x.sandbox.extPlanUsageBg('reserve','message');assert.match(r.operationId,/^[a-f0-9]{32}$/);assert.equal(x.db.n,1);assert.equal(x.storage.size,1);assert.equal([...x.storage.values()][0][r.operationId].status,'reserved')});
test('settle confirmed removes pending local record and does not charge again',async()=>{const x=setup(),r=await x.sandbox.extPlanUsageBg('reserve','message');const s=await x.sandbox.extPlanUsageBg('settle','message',undefined,{operationId:r.operationId,period:r.period,ack:'confirmed',messageIdHash:'d'.repeat(64)});assert.equal(s.operationStatus,'confirmed');assert.equal(x.db.n,2);assert.equal(Object.keys([...x.storage.values()][0]).length,0);assert.equal(x.calls.at(-1).messageIdHash,'d'.repeat(64))});
test('uncertain receipt remains in journal without retrying WhatsApp',async()=>{const x=setup(),r=await x.sandbox.extPlanUsageBg('reserve','message');await x.sandbox.extPlanUsageBg('settle','message',undefined,{operationId:r.operationId,period:r.period,ack:'uncertain'});assert.equal([...x.storage.values()][0][r.operationId].status,'uncertain');const c=await x.sandbox.extPlanUsageBg('reconcile','message',undefined,{operationId:r.operationId});assert.equal(c.operationStatus,'uncertain');assert.equal(x.calls.filter(c=>c.action==='reserve').length,1)});
test('server reserve missing response: no send is authorized',async()=>{const x=setup();x.sandbox.fetch=async()=>{throw Error('network down')};await assert.rejects(()=>x.sandbox.extPlanUsageBg('reserve','message'));assert.equal(x.storage.size,1);assert.equal(Object.values([...x.storage.values()][0])[0].status,'reservation_pending')});
test('wrong V4 subject blocks request before HTTP',async()=>{const x=setup();x.sandbox.self.extuiOpaqueV4Ensure=async()=>({authMethod:'password',subject:{type:'account',id:'c'.repeat(64)},token:'b'.repeat(64),entitlement:{tier:'free'}});await assert.rejects(()=>x.sandbox.extPlanUsageBg('reserve','message'),e=>e.code==='EXTAPP_FREE_QUOTA_SESSION_CHANGED');assert.equal(x.calls.length,0)});
test('schedule creation cannot fake authority from local count',async()=>{const x=setup();await assert.rejects(()=>x.sandbox.extPlanUsageBg('reserve','scheduleItem'),e=>e.code==='SCHEDULE_SERVER_AUTHORITY_REQUIRED');assert.equal(x.calls.length,0)});
test('paid operations bypass free reservation only after paid authorization',async()=>{const x=setup();x.sandbox.extPlanStateBg=async()=>({isFree:false,isPaid:true});x.sandbox.extServerAuthorityRequire=async()=>({authorized:true});const r=await x.sandbox.extPlanUsageBg('reserve','message');assert.equal(r.unlimited,true);assert.equal(x.calls.length,0)});
// Unit-test the ACTUAL guardedInteractiveSend code using the original source slice.
function guardedEnv({reserveFails=false,chatMismatch=false}={}){
 const items=fs.readFileSync(process.env.ZVM_LAB_SOURCE+'/app/content/features/items/items-panel.js','utf8');
 const begin=items.indexOf('    function guardedInteractiveSend(operation,target,task){');
 const part=items.slice(begin,items.indexOf('    var _extuiPresenceState =',begin));
 assert.match(part,/usageReserve\(_extuiQuotaType\)/);
 const events=[];
 const s={opts:{requireCurrentChat:true},chatId:'chat-1',_extuiFreeSend:true,_extuiQuotaType:'message',_extuiQuotaReservation:null,_extuiTransmissionAttempted:false,_extuiWAReceipt:null,
  window:{__extPlanGate:{usageReserve:async()=>{events.push('reserve');if(reserveFails)throw Error('quota offline');return{reserved:true,operationId:'1'.repeat(32),period:'2026-11-19'}}},__extEventBus:{resolveActiveChatId:async()=>chatMismatch?'chat-2':'chat-1'}},
  safeInteractiveSend:async(_name,_target,task)=>task(),events};
 vm.runInNewContext(part,s);return s;
}
test('real guarded send reserves before WA-JS task',async()=>{const s=guardedEnv();await s.guardedInteractiveSend('sendTxt','chat-1',()=>{s.events.push('wpp');return{id:'wa-msg-1',ack:1}});assert.deepEqual(s.events,['reserve','wpp']);assert.equal(s._extuiTransmissionAttempted,true)});
test('no reservation means NO WA-JS send',async()=>{const s=guardedEnv({reserveFails:true});await assert.rejects(()=>s.guardedInteractiveSend('sendTxt','chat-1',()=>{s.events.push('wpp')}));assert.deepEqual(s.events,['reserve']);assert.equal(s._extuiTransmissionAttempted,false)});
test('wrong active chat is rejected before consuming quota',async()=>{const s=guardedEnv({chatMismatch:true});await assert.rejects(()=>s.guardedInteractiveSend('sendTxt','chat-1',()=>{s.events.push('wpp')}));assert.deepEqual(s.events,[])});
test('send safety treats quota refusal as proven pre-dispatch, not uncertain WA-JS result',()=>{
 const src=fs.readFileSync(process.env.ZVM_LAB_SOURCE+'/app/content/core/send-safety.js','utf8');
 const start=src.indexOf('  function isRemoteConfirmationUncertain(err) {');
 const end=src.indexOf('  function recordFailure(err)',start);
 const env={};vm.runInNewContext(src.slice(start,end),env);
 assert.equal(env.isProvenPreDispatchFailure({code:'SEND_SAFETY_QUOTA_PREFLIGHT_REFUSED'}),true);
 assert.equal(env.isProvenPreDispatchFailure({code:'SEND_TASK_ACK_TIMEOUT'}),false);
 assert.equal(env.isRemoteConfirmationUncertain({code:'SEND_TASK_ACK_TIMEOUT'}),true);
});
test('WPP send watchdog releases waiting UI without replaying remote task',async()=>{
 const src=fs.readFileSync(process.env.ZVM_LAB_SOURCE+'/app/content/core/send-safety.js','utf8');
 const start=src.indexOf('function extBoundedSendTask(');
 const end=src.indexOf('  async function runJob(meta, task)',start);
 let calls=0;
 const env={Promise,clearTimeout,makeError:(code,msg,extra)=>Object.assign(Error(msg),{code,...extra}),setTimeout:(f)=>setTimeout(f,1)};
 vm.runInNewContext(src.slice(start,end),env);
 await assert.rejects(()=>env.extBoundedSendTask(()=>{calls++;return new Promise(()=>{})},'sendTxt',false),e=>e.code==='SEND_TASK_ACK_TIMEOUT'&&e.remoteEffectUncertain===true);
 assert.equal(calls,1);
 assert.equal(await env.extBoundedSendTask(async()=>{calls++;return 'OK'},'sendTxt',false),'OK');
 assert.equal(calls,2);
});
function gateEnv({noReply=false}={}){
 const src=fs.readFileSync(process.env.ZVM_LAB_SOURCE+'/app/content/security/session/plan-gate.js','utf8');
 const messages=[];
 const window={__extRuntimeConfig:{backendUrl:()=>'/planos'},ExtensionCore:{},__extRecordBootError:err=>{throw err}};
 const chrome={runtime:{id:'a'.repeat(32),sendMessage:(msg,callback)=>{messages.push(msg);if(noReply)return;if(msg.type==='EXTUI_PLAN_STATE')return callback({ok:true,result:{kind:'free',isFree:true,locked:false}});if(msg.type==='EXTUI_PLAN_USAGE')return callback({ok:true,result:msg.action==='reserve'?{reserved:true,operationId:'f'.repeat(32),period:'2026-11-19'}:{operationStatus:'confirmed'}});callback({ok:false});},lastError:null}};
 const env={window,chrome,document:{},setTimeout:(fn,ms)=>setTimeout(fn,noReply?1:ms),clearTimeout,Promise,Error,Set,Object,String,Number,console};
 vm.runInNewContext(src,env,{filename:'R99-plan-gate.js'});
 return{api:window.__extPlanGate,messages};
}
test('real plan-gate uses reserve and settle with an opaque operation id',async()=>{
 const x=gateEnv();const reserve=await x.api.usageReserve('message');assert.equal(reserve.reserved,true);
 const settled=await x.api.usageSettle('message',reserve,'confirmed','c'.repeat(64));assert.equal(settled.operationStatus,'confirmed');
 assert.deepEqual(x.messages.filter(m=>m.type==='EXTUI_PLAN_USAGE').map(m=>m.action),['reserve','settle']);
 for(const m of x.messages){assert.equal('authKey' in m,false);assert.equal('token' in m,false);assert.equal('phoneNumber' in m,false);}
});
test('real plan-gate treats missing worker reply as finite error',async()=>{
 const x=gateEnv({noReply:true});await assert.rejects(()=>x.api.usageReserve('message'),e=>['LICENSE_REQUIRED','EXTAPP_FREE_QUOTA_TIMEOUT'].includes(e.code));
});
test('Free schedule creation is blocked before mutating any schedule state',async()=>{
 const x=gateEnv();await assert.rejects(()=>x.api.requireScheduleCapacity(0),e=>e.code==='SCHEDULE_SERVER_AUTHORITY_REQUIRED');
});
test('duplicate server reservation never authorizes a new dispatch',async()=>{
  const x=setup(),fetch=x.sandbox.fetch;
  x.sandbox.fetch=async(url,opts)=>{
    const response=await fetch(url,opts);
    response.payload.duplicate=true;
    return response;
  };
  await assert.rejects(x.sandbox.extPlanUsageBg('reserve','message'),{code:'EXTAPP_FREE_QUOTA_INVALID_RESPONSE'});
});
test('journal collision preserves prior operation',async()=>{
  const x=setup();x.sandbox.extFreeQuotaOperationId=()=>'e'.repeat(32);
  await x.sandbox.extPlanUsageBg('reserve','audio');
  await assert.rejects(x.sandbox.extPlanUsageBg('reserve','document'),{code:'EXTAPP_FREE_OPERATION_EXISTS'});
  assert.equal(x.calls.length,1);
});
test('missing entitlement prevents Free quota HTTP request',async()=>{
  const x=setup();
  x.sandbox.self.extuiOpaqueV4Ensure=async()=>({authMethod:'password',subject:x.subject,token:'b'.repeat(64)});
  await assert.rejects(x.sandbox.extPlanUsageBg('reserve','message'),{code:'EXTAPP_FREE_QUOTA_SESSION_CHANGED'});
  assert.equal(x.calls.length,0);
});
