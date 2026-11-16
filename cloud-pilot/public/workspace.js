'use strict';
/* Cloud R17 workspaces: create, review and edit DRAFTS only. No WhatsApp sending. */
(()=>{
 const base=new URL(document.currentScript.src).pathname.replace(/\/workspace\.js$/,'');
 const MODULES=Object.freeze({
  contacts:{title:'Contatos',fields:[['name','Nome'],['phone','Telefone'],['notes','Observações']]},
  crm:{title:'CRM',fields:[['name','Nome do pipeline'],['notes','Descrição']]},
  labels:{title:'Etiquetas',fields:[['name','Nome'],['color','Cor hexadecimal']]},
  library:{title:'Biblioteca',fields:[]},
  quickReplies:{title:'Respostas rápidas',fields:[['name','Nome'],['text','Resposta de exemplo']]},
  flows:{title:'Fluxos',fields:[['name','Nome do fluxo'],['description','Objetivo'],['text','Primeira mensagem (rascunho)']]},
  funnels:{title:'Funis',fields:[['name','Nome do funil'],['description','Objetivo'],['text','Primeira mensagem (rascunho)']]},
  campaigns:{title:'Disparos',fields:[['name','Nome da campanha'],['message','Mensagem'],['notes','Observações']]},
  agenda:{title:'Agenda',fields:[['name','Nome'],['when','Data e hora (AAAA-MM-DD HH:MM)'],['message','Mensagem de exemplo']]},
  settings:{title:'Configurações',fields:[['name','Preferência'],['value','Valor']]}
 });
 const cache=new Map(),uiMsg=new Map();
 const EMPTY=Object.freeze({
  contacts:'Sua lista está vazia. Cadastre contatos com número válido ou importe os contatos do CRM.',
  crm:'Nenhum pipeline encontrado. Crie o seu CRM ou importe as etapas existentes da extensão.',
  labels:'Nenhuma etiqueta cadastrada. Organize seu atendimento com marcadores.',
  quickReplies:'Nenhuma resposta rápida. Cadastre mensagens que você reutiliza no atendimento.',
  flows:'Nenhum fluxo carregado. Importe suas definições ou crie um novo fluxo.',
  funnels:'Nenhum funil carregado. Importe suas etapas ou crie um novo funil.',
  campaigns:'Nenhuma campanha. Crie um Disparo com seleção explícita de destinatários.',
  agenda:'Nenhum planejamento salvo na Agenda.',
  settings:'Nenhuma preferência Cloud cadastrada.'
 });
 let importPlan=null,enabled=false,mediaSnapshot={revision:0,items:[]},pendingMediaUpload=null,mediaAbort=null,mediaBusy=false,mediaCancelling=false;
 const byId=id=>document.getElementById(id);
 function tag(name,text,className=''){
  const node=document.createElement(name);node.textContent=String(text??'');if(className)node.className=className;return node;
 }
 function btn(text,fn,style='secondary'){
  const node=tag('button',text,style);node.type='button';node.addEventListener('click',fn);return node;
 }
 async function api(route,opts={}){
  const response=await fetch(base+route,{credentials:'same-origin',cache:'no-store',...opts});
  let data={};try{data=await response.json();}catch{}
  if(!response.ok)throw Error(data.error||'network_error');
  return data;
 }
 const mutation=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 function message(root,text,bad=false){
  let node=root.querySelector('.workspace-status');
  if(!node){node=tag('p','', 'workspace-status');node.setAttribute('aria-live','polite');root.prepend(node);}
  node.textContent=text;node.classList.toggle('error',!!bad);
 }
 function summary(name,record){
  if(name==='contacts')return 'Telefone: '+(record.phone||'não definido');
  if(name==='crm')return (record.columns?.length||0)+' etapas no CRM';
  if(name==='campaigns')return 'Destinatários escolhidos: '+(record.recipientIds?.length||0)+' · SEM ENVIO';
  if(name==='flows'||name==='funnels')return (Array.isArray(record.nodes)?record.nodes.length:Array.isArray(record.steps)?record.steps.length:0)+' etapas/nós · '+(record.recipientIds?.length||0)+' destinatário(s) revisados · Sem execução';
  if(name==='quickReplies')return String(record.text||'Sequência importada').slice(0,100);
  if(name==='agenda')return String(record.when||'Sem horário')+' · Não agendado no servidor';
  return String(record.description||record.notes||record.value||'Rascunho de trabalho').slice(0,120);
 }
 async function get(module){
  const data=await api('/api/workspace/'+module);
  cache.set(module,data);
  return data;
 }
 function render(module){
  const mount=byId('cloud-list-'+module);if(!mount)return;
  mount.replaceChildren();
  const records=cache.get(module)?.records||[];
  const tools=tag('div','','workspace-actions');
  tools.append(btn('+ Novo '+MODULES[module].title,()=>editor(module,null),'primary'));
  tools.append(btn('Atualizar',()=>load(module)));
  let search=null;
  if(records.length){
   search=document.createElement('input');
   search.type='search';search.className='workspace-filter';
   search.setAttribute('aria-label','Buscar '+MODULES[module].title.toLowerCase());
   search.placeholder='Buscar nesta seção...';
   tools.append(search);
  }
  mount.append(tools);
  if(!records.length){
   mount.append(tag('p',EMPTY[module]||'Nenhum item cadastrado.', 'muted'));
   return;
  }
  const list=tag('div','','workspace-items');
  for(const record of records){
   const row=tag('article','','workspace-item');
   row.dataset.filter=(String(record.name||'')+' '+summary(module,record)+' '+String(record.phone||'')).toLocaleLowerCase('pt-BR');
   const info=tag('div','','workspace-item-info');
   info.append(tag('strong',record.name||'Sem título'));
   info.append(tag('small',summary(module,record)));
   if(module==='crm'&&Array.isArray(record.columns)&&record.columns.length){
    const pipeline=tag('div','','cloud-crm-preview');
    for(const col of record.columns.slice(0,12)){
     const count=Array.isArray(col.items)?col.items.length:0;
     const step=tag('span',(col.title||col.name||'Etapa')+' · '+count,'cloud-crm-step');
     pipeline.append(step);
    }
    info.append(pipeline);
   }
   const actions=tag('div','','workspace-item-actions');
   actions.append(btn('Editar',()=>editor(module,record)));
   actions.append(btn('Excluir',()=>remove(module,record),'secondary'));
   row.append(info,actions);list.append(row);
  }
  mount.append(list);
  if(search){
   const empty=tag('p','Nenhum registro corresponde à busca.','muted');empty.hidden=true;
   mount.append(empty);
   search.addEventListener('input',()=>{
    const q=search.value.trim().toLocaleLowerCase('pt-BR');
    let shown=0;
    for(const row of list.children){row.hidden=!!q&&!row.dataset.filter.includes(q);if(!row.hidden)shown++;}
    empty.hidden=shown>0;
   });
  }
 }
 async function loadAll(){
  const snapshot=await api('/api/workspace');
  for(const name of Object.keys(MODULES)){
   cache.set(name,{module:name,revision:snapshot.revision,records:snapshot.data?.[name]||[]});
   render(name);
  }
  window.dispatchEvent(new CustomEvent('zvm-cloud-data',{detail:{counts:snapshot.counts||{},revision:snapshot.revision,crm:snapshot.data?.crm||[],contacts:snapshot.data?.contacts||[],library:snapshot.data?.library||[]}}));
 }
 async function load(module){
  const mount=byId('cloud-list-'+module);
  if(!mount||!enabled)return;
  try{await get(module);render(module);}
  catch(error){message(mount,error.message==='dev_key_required'?'Chave DEV precisa ser revalidada. Reabra a página.':'Não foi possível carregar os dados.',true);}
 }
 function field(name,label,initial){
  const wrapper=tag('div','','workspace-field');
  const id='workspace-input-'+name;
  const lab=tag('label',label);lab.htmlFor=id;
  const node=(name==='message'||name==='text'||name==='notes'||name==='description')?document.createElement('textarea'):document.createElement('input');
  node.id=id;node.name=name;node.value=String(initial??'');node.maxLength=(name==='text'||name==='message')?2000:200;
  if(node.tagName==='TEXTAREA')node.rows=3;else node.type='text';
  if(name==='name'){node.required=true;node.maxLength=120;}
  if(name==='phone')node.inputMode='tel';
  wrapper.append(lab,node);return wrapper;
 }
 function audienceArea(form,existing){
  const wrap=tag('div','','workspace-audience');
  wrap.append(tag('h3','Destinatários selecionados'));
  wrap.append(tag('p','Confira nome e telefone antes de salvar. Esta campanha não será executada.', 'muted'));
  const contacts=cache.get('contacts')?.records||[];
  if(!contacts.length){wrap.append(tag('small','Cadastre contatos antes de montar a audiência.'));return wrap;}
  const selected=new Set(Array.isArray(existing?.recipientIds)?existing.recipientIds:[]);
  for(const item of contacts){
   const lab=tag('label','','workspace-contact-check');
   const input=document.createElement('input');input.type='checkbox';input.name='recipientId';input.value=item.id;input.checked=selected.has(item.id);
   lab.append(input,tag('span',item.name+' · '+item.phone));
   wrap.append(lab);
  }
  return wrap;
 }
 async function editor(module,record){
  if(!enabled)return;
  if(['campaigns','flows','funnels'].includes(module)&&!cache.has('contacts'))await get('contacts').catch(()=>{});
  const mount=byId('cloud-list-'+module),previous=mount.querySelector('.workspace-editor');
  if(previous)previous.remove();
  const form=document.createElement('form');form.className='workspace-editor';
  form.append(tag('h3',record?'Editar '+MODULES[module].title:'Novo item · '+MODULES[module].title));
  for(const [name,label] of MODULES[module].fields)form.append(field(name,label,record?.[name]??''));
  if(['campaigns','flows','funnels'].includes(module))form.append(audienceArea(form,record));
  /* Biblioteca usa editor próprio Cloud Library Studio. */
  const actions=tag('div','','workspace-actions');
  const save=document.createElement('button');save.type='submit';save.className='primary';save.textContent='Salvar na Cloud';
  actions.append(save,btn('Cancelar',()=>form.remove()));
  form.append(actions);mount.prepend(form);
  form.scrollIntoView({block:'nearest',behavior:'smooth'});
  form.addEventListener('submit',async(event)=>{
   event.preventDefault();save.disabled=true;
   try{
    const draft={...(record||{})};
    draft.id=record?.id||('cloud_'+crypto.randomUUID());
    for(const [name] of MODULES[module].fields)draft[name]=String(form.elements[name]?.value||'').trim();
    if(!draft.name)throw Error('Preencha o nome do item.');
    
    if(['campaigns','flows','funnels'].includes(module)){
     draft.recipientIds=[...form.querySelectorAll('input[name=recipientId]:checked')].map(x=>x.value);
     if(!draft.recipientIds.length&&!confirm('Salvar sem destinatários? O item ficará somente como rascunho.'))return;
    }
    if((module==='flows'||module==='funnels'||module==='quickReplies')&&!record&&draft.text){
     draft.steps=[{id:'step_1',type:'txt',properties:{mensagem:draft.text}}];
    }
    const loaded=cache.get(module)||await get(module),newRecords=[...loaded.records||[]];
    const index=newRecords.findIndex(x=>x.id===draft.id);
    if(index<0)newRecords.push(draft);else newRecords[index]=draft;
    const saved=await api('/api/workspace/'+module,mutation('PUT',{records:newRecords,revision:loaded.revision}));
    form.remove();await loadAll();message(mount,'Salvo com segurança na Cloud (revisão '+saved.revision+').');
   }catch(error){
    message(mount,error.message==='workspace_conflict'?'Outro salvamento ocorreu. Atualize antes de editar.':error.message,true);
    if(error.message==='workspace_conflict')await load(module);
   }finally{save.disabled=false;}
  });
 }
 async function remove(module,record){
  if(!confirm('Excluir "'+(record.name||'item')+'" dos rascunhos Cloud? Esta ação não afeta a ZVM Desktop.'))return;
  const mount=byId('cloud-list-'+module);
  try{
   const current=cache.get(module)||await get(module);
   await api('/api/workspace/'+module,mutation('PUT',{records:current.records.filter(x=>x.id!==record.id),revision:current.revision}));
   await loadAll();message(mount,'Item excluído somente da Cloud.');
  }catch(error){message(mount,error.message==='workspace_conflict'?'Dados atualizados em outra sessão. Atualize e revise.':'Não foi possível excluir.',true);}
 }
 // Never POST whole ZVM Desktop backups: filter sensitive storage locally first.
 const IMPORT_KEYS=Object.freeze([
  'EXTUI:CrmStore','EXTUI:labelStore','EXTUI:textMessageStore',
  'EXTUI:audioStore','EXTUI:mediaStore','EXTUI:stickerStore','EXTUI:documentStore',
  'EXTUI:pixStore','EXTUI:interactiveListStore','EXTUI:contactCardStore','EXTUI:signaturesStore',
  'EXTUI:extappQuickResponseStore','EXTUI:extappFlowStore',
  'EXTUI:extappFunnelStore','EXTUI:extappScheduleStore','EXTUI:disparosJourneys'
 ]);
 function scrubBackupValue(value,depth=0,counter={nodes:0}){
  if(depth>12||++counter.nodes>10000)throw Error('O arquivo é complexo demais para este importador.');
  if(value===null||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value==='string'){
   if(/^(?:data:|blob:|extapp-media:|extapp-item:)/i.test(value))return '[MÍDIA_LOCAL_NÃO_IMPORTADA]';
   return value.slice(0,50000);
  }
  if(Array.isArray(value)){
   if(value.length>1500)throw Error('O arquivo contém listas maiores que o limite seguro.');
   return value.map(v=>scrubBackupValue(v,depth+1,counter));
  }
  if(!value||typeof value!=='object')return null;
  const result={};
  for(const [key,item] of Object.entries(value)){
   if(key==='__proto__'||key==='prototype'||key==='constructor')continue;
   if(/password|passwd|token|secret|cookie|authkey|apikey|privatekey|license|credential|session|webhook/i.test(key))continue;
   result[key]=scrubBackupValue(item,depth+1,counter);
  }
  return result;
 }
 function prepareBackup(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Backup JSON inválido.');
  const data=raw.data&&typeof raw.data==='object'&&!Array.isArray(raw.data)?raw.data:raw;
  const safe={};
  for(const key of IMPORT_KEYS){
   if(!Object.prototype.hasOwnProperty.call(data,key))continue;
   let value=data[key];
   if(typeof value==='string'){
    let parsed;try{parsed=JSON.parse(value);}catch{throw Error('Dados corrompidos em '+key);}
    value=JSON.stringify(scrubBackupValue(parsed));
   }else value=scrubBackupValue(value);
   safe[key]=value;
  }
  // R17 text content is stored separately under each message ID.
  if(Object.prototype.hasOwnProperty.call(safe,'EXTUI:textMessageStore')){
   let state=safe['EXTUI:textMessageStore'];
   for(let n=0;n<3&&typeof state==='string';n++){try{state=JSON.parse(state);}catch{state=null;break;}}
   const list=(state?.state||state)?.textMessageList||[];
   for(const item of Array.isArray(list)?list:[]){
    const id=String(item?.id||'');
    if(!id||id.length>100||!Object.prototype.hasOwnProperty.call(data,id))continue;
    let content=data[id];
    try{
     for(let n=0;n<3&&typeof content==='string';n++)content=JSON.parse(content);
     if(typeof content?.data==='string'&&content.data.length<=16000&&
        !/^(?:data:|blob:|extapp-media:|extapp-item:)/i.test(content.data)){
      safe[id]={data:content.data};
     }
    }catch{}
   }
  }
  if(!Object.keys(safe).length)throw Error('O backup não contém categorias compatíveis para este piloto.');
  return {format:String(raw.format||'R17_STORAGE_DUMP').slice(0,80),data:safe};
 }

 function mediaStatus(text,isError=false){
  const element=byId('cloudMediaStatus');if(!element)return;
  element.textContent=text;element.classList.toggle('error',!!isError);
 }
 const hex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
 const sha=async data=>hex(await crypto.subtle.digest('SHA-256',data));
 const knownMime=file=>{
  if(file.type)return file.type.toLowerCase().split(';')[0].trim();
  const ext=String(file.name).split('.').pop().toLowerCase();
  return ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',
   pdf:'application/pdf',mp3:'audio/mpeg',ogg:'audio/ogg',mp4:'video/mp4'})[ext]||'';
 };
 function progressMedia(value){
  const bar=byId('cloudMediaProgress');if(!bar)return;
  bar.hidden=false;bar.value=Math.max(0,Math.min(100,Math.round(value)));
 }
 function updatePending(){
  const info=byId('cloudMediaResumeInfo'),cancel=byId('cloudMediaCancel');
  if(info)info.textContent=pendingMediaUpload?
   'Transferência pendente: '+pendingMediaUpload.name+' · '+Math.round(100*pendingMediaUpload.receivedBytes/pendingMediaUpload.size)+'% enviado. Selecione o mesmo arquivo e clique Enviar para retomar. Prazo de retomada: 24 horas.':'';
  if(cancel)cancel.hidden=!pendingMediaUpload&&!mediaBusy;
 }
 async function loadMedia(){
  if(!enabled)return;
  try{
   mediaSnapshot=await api('/api/media');
   const state=await api('/api/media/uploads');
   pendingMediaUpload=state.upload||null;
   renderMedia();updatePending();
   window.dispatchEvent(new CustomEvent('zvm-cloud-media-data',{detail:{items:mediaSnapshot.items||[]}}));
  }catch{mediaStatus('Falha ao consultar o cofre; os arquivos antigos permanecem no servidor.',true);}
 }
 function renderMedia(){
  const target=byId('cloudMediaItems');if(!target)return;
  target.replaceChildren();
  const used=Number(mediaSnapshot.usedBytes||0),max=Number(mediaSnapshot.quotaBytes||0);
  target.append(tag('p','Espaço utilizado: '+(used/1048576).toFixed(2)+' de '+(max/1048576).toFixed(0)+' MB · '+(mediaSnapshot.items?.length||0)+' arquivo(s)','muted'));
  for(const item of mediaSnapshot.items||[]){
   const row=tag('div','','workspace-item');
   const info=tag('div','','workspace-item-info');
   info.append(tag('strong',item.name),tag('small',item.mime+' · '+Math.ceil(item.size/1024)+' KB · SHA-256 verificado'+(item.storage==='chunked'?' · Blocos privados':'')));
   const actions=tag('div','','workspace-item-actions');
   actions.append(btn('Baixar',()=>downloadMedia(item)));
   actions.append(btn('Excluir',()=>deleteMedia(item)));
   row.append(info,actions);target.append(row);
  }
 }
 async function downloadMedia(item){
  try{
   const response=await fetch(base+'/api/media/'+item.id,{credentials:'same-origin',cache:'no-store'});
   if(!response.ok)throw Error('Erro ao baixar anexo');
   const blob=await response.blob();
   const href=URL.createObjectURL(blob);
   const a=document.createElement('a');a.href=href;a.download=item.name;a.click();
   setTimeout(()=>URL.revokeObjectURL(href),30000);
  }catch{mediaStatus('O servidor não confirmou a transferência do anexo.',true);}
 }
 async function uploadMedia(overrideFile=null,{throwOnError=false}={}){
  if(!enabled||mediaBusy)throw Error('upload_busy');
  const input=byId('cloudMediaFile'),file=overrideFile||input?.files?.[0];
  if(!file){mediaStatus('Selecione um arquivo para guardar.',true);return;}
  if(!file.size||file.size>32*1024*1024){
   mediaStatus('Aceitamos arquivos entre 1 byte e 32 MB nesta fase de QA.',true);return;
  }
  const button=byId('cloudMediaUpload');button.disabled=true;
  mediaBusy=true;mediaCancelling=false;mediaAbort=new AbortController();
  updatePending();
  try{
   const mime=knownMime(file);
   mediaStatus('Verificando a integridade SHA-256 do arquivo...');
   progressMedia(0);
   const sha256=await sha(await file.arrayBuffer());
   if(mediaCancelling)throw Error('upload_cancelled');
   if(pendingMediaUpload&&pendingMediaUpload.sha256!==sha256)
    throw Error('upload_already_active');
   const started=await api('/api/media/uploads',mutation('POST',{name:file.name,mime,size:file.size,sha256}));
   if(started.duplicate){
    mediaStatus('Arquivo já está no Cofre e continua íntegro.');
    pendingMediaUpload=null;if(!overrideFile&&input)input.value='';await loadMedia();return {mediaId:started.file.id,duplicate:true};
   }
   const upload=started.upload;
   if(!upload||!upload.uploadId||!Number.isSafeInteger(upload.nextIndex))throw Error('upload_session_invalid');
   if(mediaCancelling||mediaAbort.signal.aborted){
    await api('/api/media/uploads/'+upload.uploadId,{method:'DELETE'}).catch(()=>{});
    throw Error('upload_cancelled');
   }
   pendingMediaUpload=upload;updatePending();
   for(let i=upload.nextIndex;i<upload.totalChunks;i++){
    if(mediaCancelling)throw Error('upload_cancelled');
    const begin=i*upload.chunkBytes,end=Math.min(file.size,begin+upload.chunkBytes);
    const bytes=await file.slice(begin,end).arrayBuffer();
    const chunkSha=await sha(bytes);
    const response=await api('/api/media/uploads/'+upload.uploadId+'/'+i,{
     method:'PUT',headers:{'Content-Type':'application/octet-stream','X-Chunk-Sha256':chunkSha},
     body:bytes,signal:mediaAbort.signal
    });
    if(mediaCancelling)throw Error('upload_cancelled');
    pendingMediaUpload=response.upload;
    progressMedia(100*pendingMediaUpload.receivedBytes/file.size);
    mediaStatus('Enviando bloco '+(i+1)+' de '+upload.totalChunks+' · '+Math.round(100*pendingMediaUpload.receivedBytes/file.size)+'%');
   }
   if(mediaCancelling)throw Error('upload_cancelled');
   mediaStatus('Conferindo SHA-256 completo no servidor...');
   const finished=await api('/api/media/uploads/'+upload.uploadId+'/complete',{method:'POST'});
   pendingMediaUpload=null;if(!overrideFile&&input)input.value='';progressMedia(100);
   await loadMedia();
   mediaStatus('Arquivo validado integralmente e guardado na sua conta. Nenhum envio ao WhatsApp foi realizado.');
   return {mediaId:finished.mediaId,duplicate:finished.duplicate===true};
  }catch(error){
   const cancelled=mediaCancelling||error.name==='AbortError'||error.message==='upload_cancelled';
   mediaStatus(cancelled?'Transferência interrompida. Uma tentativa de cancelamento foi enviada ao servidor.':
    error.message==='upload_already_active'?'Já existe uma transferência pendente de outro arquivo. Retome o mesmo arquivo ou cancele a anterior.':
    error.message==='media_storage_quota'?'Espaço de armazenamento da conta insuficiente.':
    error.message==='media_signature_invalid'?'O conteúdo não corresponde ao tipo do arquivo.':
    'Transferência não concluída: '+error.message+'. Selecione novamente o mesmo arquivo para retomar.',true);
   await loadMedia().catch(()=>{});
   if(throwOnError)throw error;
  }finally{
   mediaBusy=false;mediaAbort=null;mediaCancelling=false;button.disabled=false;updatePending();
   if(byId('cloudMediaProgress')&&!pendingMediaUpload)byId('cloudMediaProgress').hidden=true;
  }
 }
 async function cancelMediaUpload(){
  if(mediaCancelling)return;
  const id=pendingMediaUpload?.uploadId;
  mediaCancelling=true;
  if(mediaAbort)mediaAbort.abort();
  if(!id){
   mediaStatus('Transferência cancelada antes de iniciar. Nenhum arquivo foi armazenado.');
   updatePending();return;
  }
  try{
   await api('/api/media/uploads/'+id,{method:'DELETE'});
   pendingMediaUpload=null;
   mediaStatus('Transferência cancelada. Os blocos temporários foram descartados.');
   await loadMedia();
  }catch{
   mediaStatus('Não foi possível confirmar o cancelamento. Atualize o cofre e tente novamente.',true);
  }finally{if(!mediaBusy)mediaCancelling=false;updatePending();}
 }
 async function deleteMedia(item){
  if(!confirm('Excluir este anexo do seu cofre Cloud? Itens da Biblioteca vinculados precisam ser desvinculados antes.'))return;
  try{
   await api('/api/media/'+item.id,mutation('DELETE',{revision:mediaSnapshot.revision}));
   await loadMedia();mediaStatus('Arquivo excluído do cofre Cloud.');
  }catch(error){mediaStatus(error.message==='media_still_linked_to_library'?'Desvincule o anexo da Biblioteca antes de excluir.':'Exclusão não confirmada: '+error.message,true);}
 }
 const RESTORABLE_LIBRARY_KINDS=new Set(['audio','image','video','media','sticker','document']);
 async function restoreZipAssets(file,extracted,view){
  if(!enabled||!extracted||!Array.isArray(extracted.assets))return;
  const candidates=extracted.assets.filter(x=>x.eligible&&x.sourceId);
  if(!candidates.length){message(view,'Não há mídias vinculadas e compatíveis de até 32 MB neste ZIP.',true);return;}
  if(!confirm('Restaurar até '+candidates.length+' mídias compatíveis? Cada arquivo será validado e enviado individualmente. O processo pode parar na cota de 128 MB e não ativa envios ao WhatsApp.'))return;
  const buttons=[...view.querySelectorAll('button')];buttons.forEach(x=>x.disabled=true);
  const progress=tag('p','','workspace-status');
  progress.setAttribute('aria-live','polite');view.append(progress);
  const report={linked:0,already:0,unmapped:0,blocked:0,failed:0,orphans:0};
  try{
   for(const asset of candidates.slice(0,60)){
    if(!enabled)throw Error('site_login_required');
    progress.textContent='Restaurando '+(report.linked+report.already+report.unmapped+report.blocked+report.failed+report.orphans+1)+' de '+Math.min(candidates.length,60)+': '+asset.name;
    const current=await api('/api/workspace/library');
    const linked=(current.records||[]).filter(row=>
     RESTORABLE_LIBRARY_KINDS.has(row.kind)&&String(row.sourceId||row.id)===asset.sourceId);
    if(linked.length!==1){report.unmapped++;continue;}
    const record=linked[0];
    if(record.mediaId&&record.contentStatus==='ready'){report.already++;continue;}
    if(record.mediaId){report.blocked++;continue;}
    let saved;
    try{
     const blob=await window.ZVMCloudZip.readAsset(file,extracted,asset.id);
     const media=new File([blob],asset.name,{type:asset.mime});
     saved=await uploadMedia(media,{throwOnError:true});
     if(!saved||!/^m_[a-f0-9]{40}$/.test(saved.mediaId))throw Error('upload_not_verified');
    }catch(error){
     report.failed++;
     progress.textContent='Mídia '+asset.name+' não restaurada: '+error.message;
     if(['media_storage_quota','upload_already_active','upload_cancelled','site_login_required'].includes(error.message))break;
     continue;
    }
    // Do not trust a stale preview after a lengthy upload. CAS and account checks
    // are repeated immediately before changing the Library record.
    try{
     const latest=await api('/api/workspace/library');
     const same=(latest.records||[]).filter(row=>row.id===record.id&&
      String(row.sourceId||row.id)===asset.sourceId&&RESTORABLE_LIBRARY_KINDS.has(row.kind));
     if(same.length!==1||same[0].mediaId){report.orphans++;continue;}
     const records=latest.records.map(row=>row.id===record.id?
      {...row,mediaId:saved.mediaId,contentStatus:'ready'}:row);
     await api('/api/workspace/library',mutation('PUT',{revision:latest.revision,records}));
     report.linked++;
    }catch(error){
     // The asset remains safely in the private vault for manual recovery;
     // never delete an asset automatically after an ambiguous network/CAS failure.
     report.orphans++;
     progress.textContent='Mídia armazenada, mas vínculo não confirmado ('+error.message+').';
    }
   }
   await loadAll().catch(()=>{});
   await loadMedia().catch(()=>{});
   progress.textContent='Restauração seletiva concluída: '+report.linked+' vinculados, '+report.already+
    ' já existentes, '+report.unmapped+' sem vínculo inequívoco, '+report.blocked+
    ' com vínculo anterior, '+report.failed+' não enviados, '+report.orphans+
    ' salvos no Cofre sem vínculo confirmado.'+
    (candidates.length>60?' Limite de 60 itens por execução; itens restantes não processados.':'');
   progress.classList.toggle('error',report.failed>0||report.orphans>0);
  }catch(error){
   progress.textContent='Restauração interrompida: '+error.message+'. Arquivos confirmados anteriormente permanecem na conta.';
   progress.classList.add('error');
  }finally{buttons.forEach(x=>x.disabled=false);}
 }
 async function inspectBackup(){
  const file=byId('backupFile').files?.[0],root=byId('backupReview');
  root.replaceChildren();importPlan=null;
  const zip=!!file&&/\.zip$/i.test(file.name);
  if(!file||(!zip&&!/\.json$/i.test(file.name))){message(root,'Use JSON ou ZIP. Backups .extbackup criptografados devem ser abertos na extensão original.',true);return;}
  if(file.size>(zip?2200*1024*1024:20*1024*1024)){message(root,'Arquivo acima do limite seguro deste importador.',true);return;}
  try{
   const extracted=zip?await window.ZVMCloudZip.inspect(file):null;
   const backup=prepareBackup(extracted?extracted.backup:JSON.parse(await file.text()));
   if(new Blob([JSON.stringify(backup)]).size>2000000)throw Error('As categorias compatíveis excedem 2 MB; divida a migração.');
   const plan=await api('/api/import/preview',mutation('POST',{backup}));
   importPlan={backup,...plan};
   const card=tag('div','','workspace-import-review');
   card.append(tag('h3','Prévia — nada foi importado ainda'));
   if(extracted){
    card.append(tag('p','ZIP verificado: '+extracted.entries+' entradas; manifesto '+extracted.manifest+'.','muted'));
    if(extracted.mediaEntries){
     const eligible=(extracted.assets||[]).filter(x=>x.eligible).length;
     const unsupported=(extracted.assets||[]).filter(x=>!x.eligible).length;
     card.append(tag('small','ZIP R17: '+extracted.mediaEntries+' entradas de mídia; '+eligible+
      ' elegíveis à restauração seletiva de até 32 MB, '+unsupported+
      ' sem vínculo suportado ou acima do limite. Nenhum arquivo será enviado antes da confirmação.'));
     if(extracted.mediaEntries!==extracted.assets.length)
      card.append(tag('small','O manifesto não descreve todos os arquivos. As mídias não identificadas não serão importadas.','error'));
    }
   }
   card.append(tag('p','Formato: '+plan.sourceFormat+' · '+Object.entries(plan.counts).map(([m,n])=>m+': '+n).join(' · ')));
   for(const warning of plan.warnings.slice(0,20))card.append(tag('small','⚠ '+warning));
   if(plan.skipped.length)card.append(tag('p','Categorias não transferidas: '+plan.skipped.slice(0,12).join(', '),'muted'));
   const mode=tag('select');mode.id='backupMode';
   for(const [value,label] of [['merge','Mesclar com meus rascunhos'],['replace','Substituir somente categorias importadas']]){
    const option=document.createElement('option');option.value=value;option.textContent=label;mode.append(option);
   }
   card.append(tag('label','Modo de importação'),mode);
   const confirmImport=btn('Confirmar importação de dados',async()=>{
    if(!importPlan)return;
    if(!confirm('Confirmar a gravação das categorias compatíveis? Nenhuma mídia será transferida sem aprovação adicional.'))return;
    confirmImport.disabled=true;
    try{
     const result=await api('/api/import/commit',mutation('POST',{
      backup:importPlan.backup,digest:importPlan.digest,revision:importPlan.revision,mode:mode.value
     }));
     importPlan=null;
     card.replaceChildren(tag('p','Dados importados na revisão '+result.revision+
      '. Mídias do ZIP ainda precisam de restauração seletiva. Nenhuma mensagem foi enviada.','workspace-status'));
     cache.clear();
     await loadAll();
     const eligible=extracted?.assets?.filter(x=>x.eligible&&x.sourceId)||[];
     if(eligible.length){
      card.append(tag('p','Há '+eligible.length+' mídias com referência original identificada. A restauração é separada, com confirmação e limites por conta.','muted'));
      card.append(btn('Restaurar mídias compatíveis do ZIP',()=>restoreZipAssets(file,extracted,card),'primary'));
     }else if(extracted?.mediaEntries){
      card.append(tag('p','As mídias deste ZIP não podem ser vinculadas automaticamente. Use o Cofre e selecione os arquivos originais manualmente.','muted'));
     }
    }catch(error){
     message(card,error.message==='workspace_conflict'?'Os dados mudaram desde a prévia. Faça uma nova análise.':'Importação bloqueada: '+error.message,true);
     confirmImport.disabled=false;
    }
   },'primary');
   card.append(confirmImport);
   root.append(card);
  }catch(error){message(root,'Arquivo inválido ou incompatível: '+error.message,true);}
 }
 async function exportData(){
  try{
   const data=await api('/api/workspace/export');
   const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
   const link=document.createElement('a');link.href=URL.createObjectURL(blob);
   link.download='ZVM_CLOUD_RASCUNHOS_'+new Date().toISOString().slice(0,10)+'.json';
   link.click();
   setTimeout(()=>URL.revokeObjectURL(link.href),30000);
  }catch{alert('Não foi possível exportar os rascunhos Cloud.');}
 }
 async function checkMeta(){
  const diag=byId('cloudMetaDiagnostic');if(!diag||!enabled)return;
  diag.textContent='Consultando configuração oficial...';
  try{
   const r=await api('/api/meta/status');
   diag.textContent=r.webhookReady?
     'Webhook da Meta configurado e limitado à conta autorizada. Envio de mensagens ainda exige homologação e permanece desativado.':
     'A integração com a Meta ainda não possui credenciais e número empresarial homologados. Envios desligados; não há cobrança de mensagens pela Cloud.';
  }catch{diag.textContent='Não foi possível verificar a integração; nenhum envio está habilitado.';}
 }
 function init(){
  const btnBackup=byId('inspectBackup');btnBackup?.addEventListener('click',inspectBackup);
  byId('cloudMediaUpload')?.addEventListener('click',()=>uploadMedia());
  byId('cloudMediaRefresh')?.addEventListener('click',loadMedia);
  byId('cloudMediaCancel')?.addEventListener('click',cancelMediaUpload);
  byId('cloudMetaRefresh')?.addEventListener('click',checkMeta);
  const section=byId('migration')?.querySelector('.section');
  section?.append(btn('Exportar meus rascunhos Cloud',exportData));
 }
 async function ready(){
  enabled=true;
  try{await loadAll();await loadMedia();await checkMeta();}catch(error){
   const mount=byId('cloud-list-contacts');
   if(mount)message(mount,'Não foi possível carregar os espaços de trabalho.',true);
  }
 }
 function locked(){enabled=false;if(mediaAbort)mediaAbort.abort();pendingMediaUpload=null;mediaBusy=false;mediaCancelling=false;byId('cloudMediaProgress')&&(byId('cloudMediaProgress').hidden=true);updatePending();cache.clear();importPlan=null;mediaSnapshot={revision:0,items:[]};byId('cloudMediaItems')?.replaceChildren();for(const module of Object.keys(MODULES)){const area=byId('cloud-list-'+module);if(area)area.replaceChildren();}}
 window.addEventListener('zvm-cloud-crm-changed',()=>{if(enabled)loadAll().catch(()=>{});});
 window.addEventListener('zvm-cloud-library-changed',()=>{if(enabled)loadAll().catch(()=>{});});
 window.addEventListener('zvm-cloud-ready',ready);
 window.addEventListener('zvm-cloud-locked',locked);
 init();
})();
