'use strict';
/* Cloud R17 workspaces: create, review and edit DRAFTS only. No WhatsApp sending. */
(()=>{
 const base=new URL(document.currentScript.src).pathname.replace(/\/workspace\.js$/,'');
 const MODULES=Object.freeze({
  contacts:{title:'Contatos',fields:[['name','Nome'],['phone','Telefone'],['notes','Observações']]},
  crm:{title:'CRM',fields:[['name','Nome do pipeline'],['notes','Descrição']]},
  labels:{title:'Etiquetas',fields:[['name','Nome'],['color','Cor hexadecimal']]},
  library:{title:'Biblioteca',fields:[['name','Nome do item'],['text','Texto'],['kind','Tipo (message, audio, image etc.)']]},
  quickReplies:{title:'Respostas rápidas',fields:[['name','Nome'],['text','Resposta de exemplo']]},
  flows:{title:'Fluxos',fields:[['name','Nome do fluxo'],['description','Objetivo'],['text','Primeira mensagem (rascunho)']]},
  funnels:{title:'Funis',fields:[['name','Nome do funil'],['description','Objetivo'],['text','Primeira mensagem (rascunho)']]},
  campaigns:{title:'Disparos',fields:[['name','Nome da campanha'],['message','Mensagem'],['notes','Observações']]},
  agenda:{title:'Agenda',fields:[['name','Nome'],['when','Data e hora (AAAA-MM-DD HH:MM)'],['message','Mensagem de exemplo']]},
  settings:{title:'Configurações',fields:[['name','Preferência'],['value','Valor']]}
 });
 const cache=new Map(),uiMsg=new Map();
 let importPlan=null,enabled=false;
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
  if(name==='library')return record.contentStatus==='missing_source'?'Conteúdo original ausente; revise antes de usar':(record.kind||'message')+' · '+String(record.text||'').slice(0,90);
  if(name==='crm')return (record.columns?.length||0)+' etapas no CRM';
  if(name==='campaigns')return 'Destinatários escolhidos: '+(record.recipientIds?.length||0)+' · SEM ENVIO';
  if(name==='flows'||name==='funnels')return 'Definição em rascunho · Sem execução';
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
  mount.append(tools);
  if(!records.length){
   mount.append(tag('p','Nenhum item cadastrado. Crie um rascunho ou importe um backup compatível.', 'muted'));
   return;
  }
  const list=tag('div','','workspace-items');
  for(const record of records){
   const row=tag('article','','workspace-item');
   const info=tag('div','','workspace-item-info');
   info.append(tag('strong',record.name||'Sem título'));
   info.append(tag('small',summary(module,record)));
   const actions=tag('div','','workspace-item-actions');
   actions.append(btn('Editar',()=>editor(module,record)));
   actions.append(btn('Excluir',()=>remove(module,record),'secondary'));
   row.append(info,actions);list.append(row);
  }
  mount.append(list);
 }
 async function loadAll(){
  const snapshot=await api('/api/workspace');
  for(const name of Object.keys(MODULES)){
   cache.set(name,{module:name,revision:snapshot.revision,records:snapshot.data?.[name]||[]});
   render(name);
  }
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
  if(module==='campaigns'&&!cache.has('contacts'))await get('contacts').catch(()=>{});
  const mount=byId('cloud-list-'+module),previous=mount.querySelector('.workspace-editor');
  if(previous)previous.remove();
  const form=document.createElement('form');form.className='workspace-editor';
  form.append(tag('h3',record?'Editar '+MODULES[module].title:'Novo item · '+MODULES[module].title));
  for(const [name,label] of MODULES[module].fields)form.append(field(name,label,record?.[name]??''));
  if(module==='campaigns')form.append(audienceArea(form,record));
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
    if(module==='library'&&draft.text)draft.contentStatus='ready';
    if(module==='campaigns'){
     draft.recipientIds=[...form.querySelectorAll('input[name=recipientId]:checked')].map(x=>x.value);
     if(!draft.recipientIds.length&&!confirm('Salvar campanha sem destinatários selecionados?'))return;
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
  'EXTUI:extappQuickResponseStore','EXTUI:extappFlowStore',
  'EXTUI:extappFunnelStore','EXTUI:extappScheduleStore','EXTUI:disparosJourneys'
 ]);
 function scrubBackupValue(value,depth=0,counter={nodes:0}){
  if(depth>12||++counter.nodes>10000)throw Error('O arquivo é complexo demais para este importador.');
  if(value===null||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value==='string'){
   if(/^(?:data:(?:image|audio|video|application)\/|blob:|extapp-media:)/i.test(value))return '[MÍDIA_LOCAL_NÃO_IMPORTADA]';
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
        !/^(?:data:|blob:|extapp-media:)/i.test(content.data)){
      safe[id]={data:content.data};
     }
    }catch{}
   }
  }
  if(!Object.keys(safe).length)throw Error('O backup não contém categorias compatíveis para este piloto.');
  return {format:String(raw.format||'R17_STORAGE_DUMP').slice(0,80),data:safe};
 }
 async function inspectBackup(){
  const file=byId('backupFile').files?.[0],root=byId('backupReview');
  root.replaceChildren();importPlan=null;
  if(!file||!file.name.toLowerCase().endsWith('.json')){message(root,'Selecione um arquivo JSON da ZVM Desktop.',true);return;}
  if(file.size>20000000){message(root,'O JSON ultrapassa o limite seguro de leitura (20 MB). Exporte somente as categorias necessárias.',true);return;}
  try{
   const text=await file.text();
   const backup=prepareBackup(JSON.parse(text));
   if(new Blob([JSON.stringify(backup)]).size>2000000)throw Error('As categorias compatíveis excedem 2 MB; divida a migração.');
   const plan=await api('/api/import/preview',mutation('POST',{backup}));
   importPlan={backup,...plan};
   const card=tag('div','','workspace-import-review');
   card.append(tag('h3','Prévia — nada foi importado ainda'));
   card.append(tag('p','Formato: '+plan.sourceFormat+' · '+Object.entries(plan.counts).map(([m,n])=>m+': '+n).join(' · ')));
   for(const warning of plan.warnings.slice(0,20))card.append(tag('small','⚠ '+warning));
   if(plan.skipped.length)card.append(tag('p','Categorias não transferidas: '+plan.skipped.slice(0,12).join(', '),'muted'));
   const mode=tag('select');mode.id='backupMode';
   for(const [value,label] of [['merge','Mesclar com meus rascunhos'],['replace','Substituir somente categorias importadas']]){
    const option=document.createElement('option');option.value=value;option.textContent=label;mode.append(option);
   }
   card.append(tag('label','Modo de importação'),mode);
   card.append(btn('Confirmar importação',async()=>{
    if(!importPlan)return;
    if(!confirm('Confirmar a gravação dos dados compatíveis? Mídias locais NÃO serão restauradas.'))return;
    try{
     const result=await api('/api/import/commit',mutation('POST',{
      backup:importPlan.backup,digest:importPlan.digest,revision:importPlan.revision,mode:mode.value
     }));
     importPlan=null;
     card.replaceChildren(tag('p','Importação confirmada na revisão '+result.revision+'.'+
      ' Nenhuma mensagem foi enviada.','workspace-status'));
     cache.clear();
     await loadAll();
    }catch(error){message(card,error.message==='workspace_conflict'?'Os dados mudaram desde a prévia. Faça uma nova análise.':'Importação bloqueada: '+error.message,true);}
   },'primary'));
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
 function init(){
  const btnBackup=byId('inspectBackup');btnBackup?.addEventListener('click',inspectBackup);
  const section=byId('migration')?.querySelector('.section');
  section?.append(btn('Exportar meus rascunhos Cloud',exportData));
 }
 async function ready(){
  enabled=true;
  try{await loadAll();}catch(error){
   const mount=byId('cloud-list-contacts');
   if(mount)message(mount,'Não foi possível carregar os espaços de trabalho.',true);
  }
 }
 function locked(){enabled=false;cache.clear();importPlan=null;for(const module of Object.keys(MODULES)){const area=byId('cloud-list-'+module);if(area)area.replaceChildren();}}
 window.addEventListener('zvm-cloud-ready',ready);
 window.addEventListener('zvm-cloud-locked',locked);
 init();
})();
