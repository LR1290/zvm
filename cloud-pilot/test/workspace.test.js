'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createServer}=require('../server');
const {createMemoryStore}=require('../store');
const {MODULES,moduleCheck,checkAudience,planLegacy,mergeModules}=require('../workspace-domain');
const license='zv-test-dev-2026',fp=crypto.createHash('sha256').update(license).digest('hex');
function setup(){
 const store=createMemoryStore();
 const sessions=new Map([['a',{email:'a@example.org',id:crypto.createHash('sha256').update('A').digest('hex')}],
                         ['b',{email:'b@example.org',id:crypto.createHash('sha256').update('B').digest('hex')}]]);
 const server=createServer({
  store,
  resolvePortal:async req=>{
   const name=String(req.headers.cookie||'').match(/zv_portal=([ab])/);
   const s=sessions.get(name?.[1]);
   return s?{email:s.email,sessionId:s.id,expiresAt:Date.now()+3600000}:null;
  },
  verifyDevKey:async(email,code,hash)=>{
   if(code===license)return {keyHash:fp};
   if(code===null&&hash===fp)return true;
   return false;
  }
 });
 return {store,server};
}
async function listen(server){await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;}
function client(root,who='a'){
 const cookie='zv_portal='+who;
 return async(route,method='GET',body,origin=root)=>{
  const response=await fetch(root+route,{method,headers:{Cookie:cookie,...(method!=='GET'?{Origin:origin,'Content-Type':'application/json'}:{})},...(method==='GET'?{}:{body:JSON.stringify(body??{})})});
  let json={};try{json=await response.json();}catch{}
  return {status:response.status,body:json};
 };
}
test('R17 migration format, safe source allowlist and no binary pretending',()=>{
 assert.equal(Object.keys(MODULES).length,10);
 const backup={format:'EXTAPP_BACKUP',version:16,data:{
  'EXTUI:CrmStore':JSON.stringify({state:{crmList:[{id:'crm1',name:'Vendas',columns:[{id:'c1',title:'Novos leads',items:[{id:'m1',contact:{name:'Ana',phoneNumber:'5531999887766'}}]}]}]},version:1}),
  'EXTUI:textMessageStore':JSON.stringify({state:{textMessageList:[{id:'msg1',name:'Boas-vindas'},{id:'msg2',name:'Sem texto'}]},version:1}),
  msg1:JSON.stringify({data:'Olá, tudo bem?'}),
  'EXTUI:extappFlowStore':JSON.stringify({state:{flowList:[{id:'f1',name:'Atendimento',nodes:[]}]},version:1}),
  'EXTUI:extappFunnelStore':JSON.stringify({state:{funnelList:[{id:'u1',name:'Qualificação',steps:[]}]},version:1}),
  'EXTUI:licenseSecret':'should-never-be-imported',
  'EXTUI:extappFlowRunningStore':'sensitive runtime'
 }};
 const p=planLegacy(backup);
 assert.equal(p.counts.crm,1);assert.equal(p.counts.contacts,1);
 assert.equal(p.counts.library,2);assert.equal(p.counts.flows,1);assert.equal(p.counts.funnels,1);
 assert.equal(p.modules.contacts[0].phone,'5531999887766');
 assert.equal(p.modules.library[0].text,'Olá, tudo bem?');
 assert.equal(p.modules.library[1].contentStatus,'missing_source');
 assert.equal(JSON.stringify(p.modules).includes('should-never-be-imported'),false);
 assert.equal(JSON.stringify(p.modules).includes('sensitive runtime'),false);
 assert.equal(p.warnings.length,1);
 assert.throws(()=>moduleCheck('contacts',[{id:'a',name:'Invalid',phone:'123'}]),/invalid_phone/);
 assert.throws(()=>moduleCheck('library',[{id:'a',name:'Blob',text:'data:image/png;base64,AAA'}]),/binary_reference_not_importable/);
 assert.throws(()=>moduleCheck('settings',[JSON.parse('{"id":"s1","name":"x","__proto__":{"admin":true}}')]),/unsafe_or_secret_field/);
 const merged=mergeModules({contacts:[{id:'keep',name:'Keep',phone:'5531999771122'}]},p.modules,'merge');
 assert.equal(merged.contacts.length,2);
 return true;
});
test('Cloud workspace CRUD, CAS, import preview and atomic per-account isolation',async()=>{
 const {server,store}=setup(),root=await listen(server),a=client(root,'a'),b=client(root,'b');
 try{
  let r=await a('/api/workspace/contacts');assert.equal(r.status,403);
  r=await a('/api/dev/activate','POST',{key:license});assert.equal(r.status,200);
  r=await b('/api/dev/activate','POST',{key:license});assert.equal(r.status,200);
  r=await a('/api/workspace');assert.equal(r.status,200);assert.equal(r.body.revision,0);
  r=await a('/api/workspace/contacts','PUT',{revision:0,records:[{id:'a',name:'Ana',phone:'(31) 99988-7766'}]});
  assert.equal(r.status,200);assert.equal(r.body.revision,1);
  r=await a('/api/workspace/contacts');assert.equal(r.body.records[0].phone,'31999887766');
  r=await a('/api/workspace/contacts','PUT',{revision:0,records:[]});assert.equal(r.status,409);
  r=await b('/api/workspace/contacts');assert.equal(r.body.records.length,0);
  r=await a('/api/workspace/export');assert.equal(r.status,200);
  assert.equal(r.body.modules.contacts.length,1);
  assert.equal(JSON.stringify(r.body).includes(license),false);
  const backup={format:'EXTAPP_BACKUP',data:{
   'EXTUI:extappFlowStore':JSON.stringify({state:{flowList:[{id:'flow9',name:'Retorno',steps:[]}]}}),
   'EXTUI:textMessageStore':JSON.stringify({state:{textMessageList:[{id:'m9',name:'Oi'}]}}),
   m9:JSON.stringify({data:'Olá, cliente!'}),
   'EXTUI:licenseSecret':'DO_NOT_STORE'
  }};
  r=await a('/api/import/preview','POST',{backup});assert.equal(r.status,200);
  const preview=r.body;assert.equal(preview.revision,1);
  assert.equal(preview.counts.flows,1);assert.equal(preview.counts.library,1);
  r=await a('/api/import/commit','POST',{backup,digest:'wrong',revision:preview.revision,mode:'merge'});
  assert.equal(r.status,409);
  r=await a('/api/import/commit','POST',{backup,digest:preview.digest,revision:preview.revision,mode:'merge'});
  assert.equal(r.status,200);
  assert.equal(r.body.revision,2);
  r=await a('/api/workspace/flows');assert.equal(r.body.records[0].name,'Retorno');
  r=await a('/api/workspace/contacts');assert.equal(r.body.records[0].name,'Ana');
  r=await b('/api/workspace/flows');assert.equal(r.body.records.length,0);
  r=await a('/api/import/commit','POST',{backup,digest:preview.digest,revision:preview.revision,mode:'merge'});
  assert.equal(r.status,409);
  r=await a('/api/workspace/labels','PUT',{revision:2,records:[{id:'l1',name:'Lead'}]});
  assert.equal(r.status,200);assert.equal(r.body.revision,3);
  r=await a('/api/workspace/labels','PUT',{revision:3,records:[{id:'l2',name:'Forbidden',password:'test'}]});
  assert.equal(r.status,422);
  r=await a('/api/workspace/nope');assert.equal(r.status,404);
  r=await a('/api/workspace/flows','PUT',{revision:3,records:[]},'https://evil.example');assert.equal(r.status,403);
  r=await a('/api/send','POST',{});assert.equal(r.status,404);
  assert.equal((await store.readWorkspace('a@example.org')).revision,3);
  assert.equal((await store.readWorkspace('b@example.org')).revision,0);
 }finally{await new Promise(r=>server.close(r));}
});
test('module limits and legacy backup corrupt content fail closed',()=>{
 const example={id:'x',name:'N'};
 assert.throws(()=>moduleCheck('flows',Array.from({length:201},(_,i)=>({...example,id:'x'+i}))),/record_limit/);
 assert.throws(()=>moduleCheck('flows',[{id:'a',name:'A'},{id:'a',name:'B'}]),/duplicate_or_invalid_id/);
 assert.throws(()=>planLegacy({data:{'EXTUI:extappFlowStore':'{corrupt'}}),/legacy_flows_invalid/);
 assert.throws(()=>planLegacy({data:{'EXTUI:licenseSecret':'should-not-import'}}),/no_compatible_modules/);
});

test('recipient review: reject missing, duplicates and R17 account-bound IDs',()=>{
 const contacts=moduleCheck('contacts',[{id:'p1',name:'Ana',phone:'5531999887766'}]);
 assert.throws(()=>moduleCheck('contacts',[{id:'p1',name:'Ana',phone:'5531999887766'},{id:'p2',name:'Duplicada',phone:'55 (31) 99988-7766'}]),/duplicate_phone/);
 assert.doesNotThrow(()=>checkAudience('flows',[{id:'f',recipientIds:['p1']}],contacts));
 assert.throws(()=>checkAudience('campaigns',[{id:'c',recipientIds:['missing']}],contacts),/unknown_audience_contact/);
 assert.throws(()=>checkAudience('funnels',[{id:'f',recipientIds:['p1','p1']}],contacts),/invalid_audience/);
 const source={data:{'EXTUI:extappFlowStore':JSON.stringify({state:{flowList:[{id:'f2',name:'Flow',recipientIds:['local-wa-contact-42']}]}})}};
 const plan=planLegacy(source);
 assert.equal(plan.modules.flows[0].recipientIds,undefined);
 assert.equal(plan.modules.flows[0].audienceReviewRequired,true);
 assert.match(plan.warnings.join(' '),/selecionados novamente/);
});
