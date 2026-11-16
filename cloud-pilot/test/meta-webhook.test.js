'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const Meta=require('../meta-webhook'),{createServer}=require('../server'),{createMemoryStore}=require('../store');
const ENV={CLOUD_META_WEBHOOK_ENABLED:'1',CLOUD_META_VERIFY_TOKEN:'verification-token-1234567890-abc',CLOUD_META_APP_SECRET:'app-secret-1234567890-abcd-xyz',CLOUD_META_OWNER_EMAIL:'owner@example.org',CLOUD_META_PHONE_NUMBER_ID:'123456789012345'};
const payload={object:'whatsapp_business_account',entry:[{id:'waba-1',changes:[{field:'messages',value:{metadata:{phone_number_id:ENV.CLOUD_META_PHONE_NUMBER_ID},messages:[{id:'wamid.sensitive',from:'5531111222233',text:{body:'not stored'}}],statuses:[{id:'wamid.something',status:'delivered'}]}}]}]};
function signature(bytes){return 'sha256='+crypto.createHmac('sha256',ENV.CLOUD_META_APP_SECRET).update(bytes).digest('hex');}
test('Meta readiness, handshake, signature and sanitized summary',()=>{
 const store=createMemoryStore();
 assert.equal(Meta.readiness({},store).configured,false);
 assert.equal(Meta.readiness(ENV,store).configured,true);
 assert.equal(Meta.readiness(ENV,store).sendEnabled,false);
 const url=new URL('https://example.com/?hub.mode=subscribe&hub.verify_token='+ENV.CLOUD_META_VERIFY_TOKEN+'&hub.challenge=CHALLENGE123');
 assert.equal(Meta.handshake(url,ENV.CLOUD_META_VERIFY_TOKEN),'CHALLENGE123');
 url.searchParams.set('hub.verify_token','wrong');assert.equal(Meta.handshake(url,ENV.CLOUD_META_VERIFY_TOKEN),null);
 const data=Buffer.from(JSON.stringify(payload));
 assert.equal(Meta.signed(data,signature(data),ENV.CLOUD_META_APP_SECRET),true);
 assert.equal(Meta.signed(data,'sha256='+'a'.repeat(64),ENV.CLOUD_META_APP_SECRET),false);
 const summary=Meta.eventSummary(payload);
 assert.equal(summary.incomingCount,1);assert.equal(summary.statusCount,1);
 assert.equal(JSON.stringify(summary).includes('5531111'),false);
 assert.equal(JSON.stringify(summary).includes('not stored'),false);
});
test('Meta webhook HTTP stores only signed metadata with idempotency',async()=>{
 const previous={};for(const [key,value] of Object.entries(ENV)){previous[key]=process.env[key];process.env[key]=value;}
 const store=createMemoryStore(),server=createServer({store});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const root='http://127.0.0.1:'+server.address().port,url=root+'/meta/webhook';
 const raw=Buffer.from(JSON.stringify(payload));
 try{
  let res=await fetch(url+'?hub.mode=subscribe&hub.verify_token='+ENV.CLOUD_META_VERIFY_TOKEN+'&hub.challenge=VALID123');
  assert.equal(res.status,200);assert.equal(await res.text(),'VALID123');
  res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':'sha256='+'0'.repeat(64)},body:raw});
  assert.equal(res.status,401);
  const opts={method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':signature(raw)},body:raw};
  res=await fetch(url,opts);assert.equal(res.status,200);assert.equal(await res.text(),'EVENT_ACCEPTED');
  res=await fetch(url,opts);assert.equal(res.status,200);
  const other=JSON.parse(JSON.stringify(payload));other.entry[0].changes[0].value.metadata.phone_number_id='999999999';
  const bytes=Buffer.from(JSON.stringify(other));
  res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':signature(bytes)},body:bytes});
  assert.equal(res.status,403);
  res=await fetch(root+'/api/meta/status');assert.equal(res.status,401);
 }finally{
  await new Promise(r=>server.close(r));
  for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});
test('Meta event admission rejects oversized and invalid webhook object',()=>{
 assert.throws(()=>Meta.eventSummary({object:'other',entry:[]}),/webhook_invalid_shape/);
 assert.throws(()=>Meta.eventSummary({object:'whatsapp_business_account',entry:[{changes:Array(50).fill({})}]}),/webhook_invalid_changes/);
 assert.equal(Meta.readiness({...ENV,CLOUD_META_PHONE_NUMBER_ID:''},createMemoryStore()).configured,false);
});
