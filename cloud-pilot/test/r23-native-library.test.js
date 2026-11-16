'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {planLegacy,moduleCheck}=require('../workspace-domain');
const {KINDS,checkLibraryRecords}=require('../library-domain');
const {createServer}=require('../server');
const {createMemoryStore}=require('../store');
const root=path.join(__dirname,'..'),src=path=>fs.readFileSync(require('node:path').join(root,path),'utf8');
const state=(field,list)=>JSON.stringify({state:{[field]:list}});
function backup(){
 return {format:'EXTAPP_BACKUP',data:{
  'EXTUI:textMessageStore':state('textMessageList',[{id:'same',name:'Boas-vindas',favorite:true},{id:'no_text',name:'Ainda sem texto'}]),
  'same':JSON.stringify({data:'Oi, {{nome}}!'}),
  'EXTUI:audioStore':state('audioList',[{id:'same',name:'Áudio original'}]),
  'EXTUI:mediaStore':state('mediaList',[{id:'foto',name:'Imagem',mime:'image/jpeg'},{id:'filme',name:'Vídeo',mime:'video/mp4'}]),
  'EXTUI:stickerStore':state('stickerList',[{id:'stk',name:'Figurinha'}]),
  'EXTUI:documentStore':state('documentList',[{id:'doc',name:'Proposta PDF'}]),
  'EXTUI:pixStore':state('pixList',[{id:'pix',name:'PIX',text:'Instruções da chave'}]),
  'EXTUI:interactiveListStore':state('interactiveListList',[{id:'lista',name:'Cardápio',properties:{sections:[{title:'Categoria 1'}]}}]),
  'EXTUI:contactCardStore':state('contactList',[{id:'card',name:'Contato',properties:{displayName:'Atendimento'}}]),
  'EXTUI:signaturesStore':state('list',[{id:'signature',name:'Assinatura',text:'Equipe ZVM'}]),
  'EXTUI:licenseSecret':'DO_NOT_IMPORT',
 }};
}
test('R23: R17 nine Biblioteca stores survive in one merged Library (no silent overwrite)',()=>{
 const plan=planLegacy(backup());
 assert.equal(plan.counts.library,11);
 assert.equal(plan.modules.library.length,11);
 assert.equal(new Set(plan.modules.library.map(x=>x.originStore)).size,9);
 const [message,empty,audio]=plan.modules.library;
 assert.equal(message.id,'same');assert.equal(message.favorite,true);
 assert.equal(message.kind,'message');assert.equal(message.contentStatus,'ready');
 assert.equal(message.text,'Oi, {{nome}}!');
 assert.equal(empty.contentStatus,'missing_source');
 assert.equal(audio.kind,'audio');assert.equal(audio.contentStatus,'missing_source');
 assert.equal(audio.text,'','media must not inherit same-ID text from an unrelated message');
 assert.notEqual(audio.id,message.id);assert.equal(audio.sourceId,'same');
 assert.match(audio.id,/^r17_[a-f0-9]{20}$/);
 assert.equal(plan.modules.library.find(x=>x.name==='Imagem').kind,'image');
 assert.equal(plan.modules.library.find(x=>x.name==='Vídeo').kind,'video');
 assert.equal(plan.modules.library.find(x=>x.name==='Assinatura').contentStatus,'ready');
 assert.equal(plan.modules.library.find(x=>x.name==='Cardápio').contentStatus,'needs_review');
 assert.equal(plan.modules.library.find(x=>x.name==='PIX').contentStatus,'needs_review');
 assert.equal(JSON.stringify(plan.modules).includes('DO_NOT_IMPORT'),false);
 assert.match(plan.warnings.join(' '),/restauração manual da mídia/);
 assert.deepEqual(planLegacy(backup()).modules.library,plan.modules.library,'import must be deterministic');
});
test('R23: plain signature arrays and removed local-media markers never become ready content',()=>{
 const p=planLegacy({data:{
  'EXTUI:signaturesStore':JSON.stringify([{id:'s1',name:'Assinatura simples',text:'Equipe ZVM'}]),
  'EXTUI:textMessageStore':state('textMessageList',[
   {id:'m1',name:'Mídia removida',text:'[MÍDIA_LOCAL_NÃO_IMPORTADA]'},
   {id:'m2',name:'Referência da extensão',text:'extapp-item:media-vault-42'},
   {id:'m3',name:'Mensagem real',text:'Olá'}
  ])
 }});
 assert.equal(p.counts.library,4);
 assert.equal(p.modules.library.find(x=>x.id==='s1').contentStatus,'ready');
 assert.equal(p.modules.library.find(x=>x.id==='m1').contentStatus,'missing_source');
 assert.equal(p.modules.library.find(x=>x.id==='m2').contentStatus,'missing_source');
 assert.equal(p.modules.library.find(x=>x.id==='m3').contentStatus,'ready');
 assert.equal(p.modules.library.find(x=>x.id==='m2').text,'');
});
test('R23: private Library media MIME and content-status integrity',()=>{
 assert.equal(Object.keys(KINDS).length,11);
 const png={id:'m_'+'a'.repeat(40),mime:'image/png'};
 const pdf={id:'m_'+'b'.repeat(40),mime:'application/pdf'};
 const record=(kind,mediaId,status='ready')=>({id:'r',name:'R',kind,contentStatus:status,...(mediaId?{mediaId}:{})});
 assert.doesNotThrow(()=>checkLibraryRecords([record('image',png.id)],[png,pdf]));
 assert.doesNotThrow(()=>checkLibraryRecords([record('document',pdf.id)],[png,pdf]));
 assert.doesNotThrow(()=>checkLibraryRecords([{id:'s',name:'Oi',kind:'message',text:'Olá',contentStatus:'ready'}],[]));
 assert.doesNotThrow(()=>checkLibraryRecords([{id:'x',name:'A',kind:'audio',contentStatus:'missing_source'}],[]));
 assert.doesNotThrow(()=>checkLibraryRecords([{id:'p',name:'PIX',kind:'pix',text:'Revisar',contentStatus:'needs_review'}],[]));
 assert.throws(()=>checkLibraryRecords([record('image',pdf.id)],[png,pdf]),/library_media_kind_mismatch/);
 assert.throws(()=>checkLibraryRecords([record('image',png.id)],[pdf]),/unknown_library_media/);
 assert.throws(()=>checkLibraryRecords([record('image')],[]),/library_media_required/);
 assert.throws(()=>checkLibraryRecords([record('interactive-list')],[]),/library_structured_review_required/);
 assert.throws(()=>checkLibraryRecords([{id:'r',name:'Oi',kind:'message',contentStatus:'ready'}]),/library_text_required/);
 assert.throws(()=>checkLibraryRecords([{id:'r',name:'Oi',kind:'unknown',contentStatus:'ready'}]),/invalid_library_kind/);
 assert.throws(()=>checkLibraryRecords([{id:'r',name:'Oi',kind:'message',favorite:'yes'}]),/invalid_library_favorite/);
 assert.throws(()=>moduleCheck('library',[{id:'x',name:'M',text:'data:image/png;base64,aaaa'}]),/binary_reference_not_importable/);
});
function fixture(){
 const store=createMemoryStore(),key='r23-test-dev',keyHash=crypto.createHash('sha256').update(key).digest('hex');
 const server=createServer({store,
  resolvePortal:async req=>{
   const who=/zv_portal=([ab])/.exec(String(req.headers.cookie||''))?.[1];
   return who?{email:who+'@example.org',sessionId:who.repeat(64),expiresAt:Date.now()+3600000}:null;
  },
  verifyDevKey:async(email,raw,fingerprint)=>{
   if(!['a@example.org','b@example.org'].includes(email))return false;
   return raw===key?{keyHash}:raw===null&&fingerprint===keyHash;
  }
 });
 return {store,key,server};
}
async function start(server){await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;}
function request(root,who='a'){
 return async(route,method='GET',data)=>{
  const r=await fetch(root+route,{method,headers:{Cookie:'zv_portal='+who,...(method==='GET'?{}:{Origin:root,'Content-Type':'application/json'})},
   ...(method==='GET'?{}:{body:JSON.stringify(data??{})})});
  return {status:r.status,data:await r.json()};
 };
}
test('R23: actual HTTP Library CAS, legacy multi-store import and cross-account isolation',async()=>{
 const f=fixture(),root=await start(f.server),a=request(root),b=request(root,'b');
 try{
  assert.equal((await a('/api/workspace/library')).status,403);
  assert.equal((await a('/api/dev/activate','POST',{key:f.key})).status,200);
  assert.equal((await b('/api/dev/activate','POST',{key:f.key})).status,200);
  let r=await a('/api/workspace/library','PUT',{revision:0,records:[{id:'msg',name:'Olá',kind:'message',text:'Oi!',contentStatus:'ready'}]});
  assert.equal(r.status,200);assert.equal(r.data.revision,1);
  r=await a('/api/workspace/library','PUT',{revision:0,records:[]});assert.equal(r.status,409);
  r=await a('/api/workspace/library','PUT',{revision:1,records:[{id:'bogus',name:'Foto',kind:'image',text:'Legenda',contentStatus:'ready'}]});
  assert.equal(r.status,422);assert.equal(r.data.error,'library_media_required');
  r=await a('/api/workspace/library','PUT',{revision:1,records:[{id:'bogus',name:'Foto',kind:'image',mediaId:'m_'+'f'.repeat(40),contentStatus:'ready'}]});
  assert.equal(r.status,422);assert.equal(r.data.error,'unknown_library_media');
  r=await b('/api/workspace/library');assert.equal(r.data.records.length,0);
  const input={backup:backup()};
  const preview=await a('/api/import/preview','POST',input);
  assert.equal(preview.status,200);assert.equal(preview.data.counts.library,11);
  r=await a('/api/import/commit','POST',{...input,mode:'merge',revision:1,digest:preview.data.digest});
  assert.equal(r.status,200);assert.equal(r.data.revision,2);
  r=await a('/api/workspace/library');assert.equal(r.status,200);
  assert.equal(r.data.records.length,12); // previous Cloud item + 11 R17 items
  assert.equal(new Set(r.data.records.map(x=>x.id)).size,12);
  assert.equal(r.data.records.find(x=>x.kind==='audio').contentStatus,'missing_source');
  assert.equal((await b('/api/workspace/library')).data.records.length,0);
  assert.equal((await a('/api/send','POST',{})).status,404);
 }finally{await new Promise(r=>f.server.close(r));}
});
test('R23: own-origin Biblioteca Studio assets and true filtered UI, no fake sends',()=>{
 const server=src('server.js'),html=src('public/index.html'),ui=src('public/cloud-library.js'),css=src('public/cloud-library.css'),workspace=src('public/workspace.js');
 assert.match(server,/\/cloud-library\.js/);assert.match(server,/\/cloud-library\.css/);
 assert.match(html,/id="cloudLibraryStudio"/);assert.match(html,/cloud-library\.js/);assert.match(html,/cloud-library\.css/);
 assert.doesNotMatch(html,/id="cloud-list-library"/);
 assert.match(ui,/\['interactive-list','Listas'/);
 assert.match(ui,/\['pix','PIX'/);
 assert.match(ui,/zvm-cloud-library-changed/);
 assert.match(ui,/\/api\/workspace\/library/);assert.match(ui,/workspace_conflict/);
 assert.match(ui,/Prévia abaixo do campo de mensagem/);
 assert.match(ui,/media\.mime/);
 assert.match(workspace,/EXTUI:signaturesStore/);
 assert.doesNotMatch(ui,/sendMessage|wppconnect|whatsapp\.send/);
 assert.doesNotMatch(css,/!important/);
});
