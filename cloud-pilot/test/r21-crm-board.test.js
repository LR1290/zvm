'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {changeCrmBoard,checkCrmLinks,MAX_COLUMNS}=require('../crm-board-domain');
const {createServer}=require('../server');
const {createMemoryStore}=require('../store');

const contact={id:'c_ana',name:'Ana',phone:'5531999887766'};
function fixture(){
 return [{id:'crm1',name:'Vendas',columns:[
  {id:'stage_new',title:'Entrada',items:[{id:'legacy_1',contact:{name:'Bruna',phoneNumber:'5531999776655'},notes:'Preservar'}]},
  {id:'stage_done',title:'Fechado',items:[]}
 ]}];
}
const action=(a,opts={})=>({pipelineId:'crm1',action:a,...opts});
test('R21 CRM: move preserves imported card, source and ID without touching input',()=>{
 const input=fixture();
 const result=changeCrmBoard(input,[contact],action('move-card',{fromIndex:0,toIndex:1,itemIndex:0}));
 assert.equal(input[0].columns[0].items.length,1);
 assert.equal(result.records[0].columns[0].items.length,0);
 assert.deepEqual(result.records[0].columns[1].items,[input[0].columns[0].items[0]]);
 assert.equal(result.records[0].columns[1].items[0].notes,'Preservar');
 assert.equal(result.cards,1);
});
test('R21 CRM: add, rename and remove empty columns only',()=>{
 let rows=fixture();
 let r=changeCrmBoard(rows,[],action('add-column',{title:' Propostas '}));rows=r.records;
 assert.equal(rows[0].columns[2].title,'Propostas');
 assert.match(rows[0].columns[2].id,/^cloud_col_/);
 rows=changeCrmBoard(rows,[],action('rename-column',{columnIndex:2,title:'Negociação'})).records;
 assert.equal(rows[0].columns[2].title,'Negociação');
 assert.throws(()=>changeCrmBoard(rows,[],action('remove-column',{columnIndex:0})),/crm_column_not_empty/);
 rows=changeCrmBoard(rows,[],action('remove-column',{columnIndex:2})).records;
 assert.equal(rows[0].columns.length,2);
});
test('R21 CRM: assign existing contact and preserve its canonical phone',()=>{
 let rows=fixture();
 rows=changeCrmBoard(rows,[contact],action('add-contact',{columnIndex:0,contactId:contact.id})).records;
 const card=rows[0].columns[0].items[1];
 assert.match(card.id,/^cloud_card_/);
 assert.equal(card.contactId,contact.id);
 assert.equal(card.contact.phoneNumber,contact.phone);
 assert.throws(()=>changeCrmBoard(rows,[contact],action('add-contact',{columnIndex:1,contactId:contact.id})),/crm_contact_already_assigned/);
});
test('R21 CRM: duplicate phone in legacy imported CRM is not assigned twice',()=>{
 assert.throws(()=>changeCrmBoard(fixture(),[{id:'c2',name:'Bruna',phone:'55 31 99977-6655'}],
  action('add-contact',{columnIndex:1,contactId:'c2'})),/crm_contact_already_assigned/);
});
test('R21 CRM: missing contact, invalid stage, bad title and unsupported actions fail closed',()=>{
 for(const [a,opts,reason] of [
  ['add-contact',{columnIndex:0,contactId:'other'},/crm_contact_not_found/],
  ['move-card',{fromIndex:0,toIndex:2,itemIndex:0},/invalid_column_index/],
  ['move-card',{fromIndex:0,toIndex:0,itemIndex:0},/crm_same_column/],
  ['unlink-card',{columnIndex:0,itemIndex:8},/invalid_card_index/],
  ['add-column',{title:''},/invalid_column_title/],
  ['delete-all',{},/unknown_crm_action/],
 ]){
  assert.throws(()=>changeCrmBoard(fixture(),[contact],action(a,opts)),reason);
 }
});
test('R21 CRM: removing card never deletes canonical contact',()=>{
 const contacts=[contact],rows=fixture();
 const result=changeCrmBoard(rows,contacts,action('unlink-card',{columnIndex:0,itemIndex:0}));
 assert.equal(result.records[0].columns[0].items.length,0);
 assert.deepEqual(contacts,[contact]);
});
test('R21 CRM: legacy column without ID can still be operated on by revision-scoped index',()=>{
 const data=[{id:'crm1',name:'legado',columns:[{title:'Novos',items:[]}]}];
 const result=changeCrmBoard(data,[contact],action('add-contact',{columnIndex:0,contactId:contact.id}));
 assert.equal(result.records[0].columns[0].items.length,1);
 assert.equal(result.records[0].columns[0].id,undefined);
});
test('R21 CRM: column count limit is enforced',()=>{
 const rows=[{id:'crm1',name:'Grande',columns:Array.from({length:MAX_COLUMNS},(_,i)=>({title:'Etapa '+i,items:[]}))}];
 assert.throws(()=>changeCrmBoard(rows,[],action('add-column',{title:'Extra'})),/crm_column_limit/);
});
test('R21 CRM: cannot delete a Cloud contact referenced by a card',()=>{
 const rows=changeCrmBoard(fixture(),[contact],action('add-contact',{columnIndex:1,contactId:contact.id})).records;
 assert.throws(()=>checkCrmLinks(rows,[]),/crm_contact_in_use/);
 assert.doesNotThrow(()=>checkCrmLinks(rows,[contact]));
 assert.doesNotThrow(()=>checkCrmLinks(fixture(),[])); // legacy snapshots need not have Cloud contactId
});
function harness(){
 const store=createMemoryStore(),key='zv-test-dev',hash=crypto.createHash('sha256').update(key).digest('hex');
 const ids={a:crypto.createHash('sha256').update('a').digest('hex'),b:crypto.createHash('sha256').update('b').digest('hex')};
 const server=createServer({store,resolvePortal:async req=>{
  const m=/zv_portal=([ab])/.exec(String(req.headers.cookie||''));if(!m)return null;
  return {email:m[1]+'@example.org',sessionId:ids[m[1]],expiresAt:Date.now()+3600000};
 },verifyDevKey:async(email,code,stored)=>{
  if(code===key)return {keyHash:hash};
  return code===null&&stored===hash;
 }});
 return {store,server,key};
}
test('R21 CRM HTTP: DEV gate, CAS, cross-tenant isolation and no sending',async()=>{
 const {store,server,key}=harness();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const root='http://127.0.0.1:'+server.address().port;
 async function call(who,route,method='GET',data,origin=root){
  const response=await fetch(root+route,{method,headers:{Cookie:'zv_portal='+who,...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'})},...(method==='GET'?{}:{body:JSON.stringify(data||{})})});
  return {status:response.status,body:await response.json()};
 }
 try{
  const p=action('add-column',{revision:0,title:'Entrada'});
  assert.equal((await call('a','/api/crm/board','POST',p)).status,403);
  assert.equal((await call('a','/api/dev/activate','POST',{key})).status,200);
  assert.equal((await call('b','/api/dev/activate','POST',{key})).status,200);
  let r=await call('a','/api/workspace/crm','PUT',{revision:0,records:[{id:'crm1',name:'Vendas',columns:[]}]});
  assert.equal(r.status,200);
  r=await call('a','/api/workspace/contacts','PUT',{revision:1,records:[contact]});
  assert.equal(r.status,200);
  r=await call('a','/api/crm/board','POST',action('add-column',{revision:2,title:'Novos'}));
  assert.equal(r.status,200);assert.equal(r.body.revision,3);assert.equal(r.body.sending,false);
  assert.equal((await call('a','/api/crm/board','POST',action('add-column',{revision:2,title:'Antigo'}))).status,409);
  assert.equal((await call('a','/api/crm/board','POST',action('add-contact',{revision:3,columnIndex:0,contactId:'other'}))).status,422);
  assert.equal((await call('a','/api/crm/board','POST',action('add-contact',{revision:3,columnIndex:0,contactId:contact.id}))).status,200);
  assert.equal((await call('a','/api/crm/board','POST',action('add-column',{revision:4,title:'Invasão'}),'https://evil.example')).status,403);
  assert.equal((await call('a','/api/workspace/contacts','PUT',{revision:4,records:[]})).status,422);
  assert.equal((await call('b','/api/workspace/crm')).body.records.length,0);
  assert.equal((await call('b','/api/crm/board','POST',action('add-column',{revision:0,title:'Espião'}))).status,422);
  assert.equal((await call('a','/api/workspace/crm')).body.records[0].columns[0].items.length,1);
  assert.equal((await store.readWorkspace('a@example.org')).revision,4);
  assert.equal((await store.readWorkspace('b@example.org')).revision,0);
  assert.equal((await call('a','/api/send','POST',{})).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
