'use strict';
/* Cloud R21 — CRM board for authorized drafts, not a WhatsApp sender.
 * Uses existing tenant-scoped workspace revision; never constructs HTML from records. */
(()=>{
 const root=document.getElementById('cloudCrmBoard');
 if(!root)return;
 const base=new URL(document.currentScript.src).pathname.replace(/\/cloud-crm-board\.js$/,'');
 let state={revision:0,crm:[],contacts:[]},selected='',busy=false,lastStatus='',lastStatusError=false;
 const node=(tag,text,cls)=>{
  const e=document.createElement(tag);
  if(text!==undefined&&text!==null)e.textContent=String(text);
  if(cls)e.className=cls;
  return e;
 };
 const button=(label,handler,cls='secondary')=>{
  const b=node('button',label,cls);b.type='button';b.disabled=busy;
  b.addEventListener('click',handler);return b;
 };
 function status(text,isError=false){
  let el=root.querySelector('.cloud-crm-status');
  if(!el){el=node('p','','cloud-crm-status');el.setAttribute('role','status');el.setAttribute('aria-live','polite');root.prepend(el);}
  lastStatus=text||'';lastStatusError=!!isError;
  el.textContent=lastStatus;el.classList.toggle('error',lastStatusError);
 }
 async function api(route,opts={}){
  const response=await fetch(base+route,{credentials:'same-origin',cache:'no-store',...opts});
  let data={};try{data=await response.json();}catch{}
  if(!response.ok){const err=new Error(data.error||'cloud_connection_failed');err.status=response.status;throw err;}
  return data;
 }
 async function reload(){
  const data=await api('/api/workspace');
  state={revision:data.revision,crm:Array.isArray(data.data?.crm)?data.data.crm:[],contacts:Array.isArray(data.data?.contacts)?data.data.contacts:[]};
  if(!state.crm.some(p=>p.id===selected))selected=state.crm[0]?.id||'';
  render();
  window.dispatchEvent(new Event('zvm-cloud-crm-changed'));
 }
 async function act(payload){
  if(busy||!selected)return;
  busy=true;status('Salvando com controle de revisão...');
  try{
   await api('/api/crm/board',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({revision:state.revision,pipelineId:selected,...payload})});
   try{
    await reload();status('Atualizado na sua conta. Nenhuma mensagem enviada.');
   }catch{
    status('Gravação confirmada, mas a atualização da tela falhou. Use Atualizar quadro antes de editar novamente.',true);
   }
  }catch(error){
   if(error.status===409){
    try{await reload();}catch{}
    status('Outro dispositivo atualizou seu CRM. Revise os dados recarregados antes de repetir.',true);
   }else{
    const readable={
     crm_contact_already_assigned:'Este contato já pertence a uma etapa deste CRM.',
     crm_contact_not_found:'O contato não existe mais nesta conta.',
     crm_column_not_empty:'Mova ou desvincule os contatos antes de excluir a coluna.',
     crm_card_limit:'Limite de cartões atingido.',crm_column_limit:'Limite de colunas atingido.',
     unknown_crm_action:'Ação não autorizada.',dev_key_required:'Sua chave DEV precisa ser revalidada.'
    };
    status(readable[error.message]||'Não foi possível salvar: '+error.message,true);
   }
  }finally{busy=false;render();}
 }
 function form(label,placeholder,onSubmit,value=''){
  const f=node('form',null,'cloud-crm-inline');
  const input=node('input');input.type='text';input.maxLength=80;
  input.required=true;input.placeholder=placeholder;input.value=value;
  input.setAttribute('aria-label',placeholder);
  const submit=node('button',label,'primary');submit.type='submit';
  f.append(input,submit);
  f.addEventListener('submit',event=>{
   event.preventDefault();if(!input.value.trim())return;
   onSubmit(input.value.trim());
  });
  return f;
 }
 function card(cardValue,colIndex,itemIndex,columns){
  const e=node('article',null,'cloud-crm-card');
  if(!cardValue||typeof cardValue!=='object'||Array.isArray(cardValue)){
   e.append(node('p','Cartão importado inválido; preserve o backup e revise este CRM.','cloud-crm-empty'));return e;
  }
  const contact=state.contacts.find(c=>c.id===cardValue.contactId);
  const name=contact?.name||cardValue.contact?.name||cardValue.contact?.pushname||cardValue.name||'Contato importado';
  const phone=contact?.phone||cardValue.contact?.phoneNumber||cardValue.contact?.phone||cardValue.phone||'Telefone não encontrado';
  e.append(node('strong',name),node('small',phone));
  if(cardValue.notes)e.append(node('p',String(cardValue.notes).slice(0,120),'cloud-crm-card-notes'));
  const actions=node('div',null,'cloud-crm-card-actions');
  if(columns.length>1){
   const select=node('select');select.setAttribute('aria-label','Mover '+name+' para outra etapa');
   for(let n=0;n<columns.length;n++){
    if(n===colIndex)continue;
    const opt=node('option',columns[n].title||columns[n].name||'Etapa '+(n+1));opt.value=String(n);select.append(opt);
   }
   actions.append(select,button('Mover',()=>act({action:'move-card',fromIndex:colIndex,toIndex:Number(select.value),itemIndex})));
  }
  actions.append(button('Desvincular',()=>{
   if(confirm('Retirar este cartão da etapa? O contato será mantido na sua base.'))
    act({action:'unlink-card',columnIndex:colIndex,itemIndex});
  }));
  e.append(actions);return e;
 }
 function column(col,i,columns){
  const wrap=node('section',null,'cloud-crm-column');
  if(!col||typeof col!=='object'||Array.isArray(col)||!Array.isArray(col.items)){
   wrap.append(node('p','Etapa legada com dados incompatíveis. Nada será alterado.','cloud-crm-empty'));return wrap;
  }
  const head=node('div',null,'cloud-crm-column-head');
  head.append(node('h4',col.title||col.name||'Etapa '+(i+1)));
  const items=Array.isArray(col.items)?col.items:[];
  head.append(node('span',items.length,'cloud-crm-count'));wrap.append(head);
  const admin=node('div',null,'cloud-crm-column-tools');
  const edit=button('Renomear',()=>{
   const previous=wrap.querySelector('.cloud-crm-rename');if(previous){previous.remove();return;}
   const f=form('Salvar','Nome da etapa',name=>act({action:'rename-column',columnIndex:i,title:name}),col.title||col.name||'');
   f.classList.add('cloud-crm-rename');admin.after(f);f.querySelector('input').focus();
  });
  admin.append(edit);
  admin.append(button('Excluir etapa',()=>{
   if(items.length){status('A etapa contém contatos. Mova os cartões antes de excluir.',true);return;}
   if(confirm('Excluir esta etapa vazia?'))act({action:'remove-column',columnIndex:i});
  }));
  wrap.append(admin);
  const cards=node('div',null,'cloud-crm-cards');
  if(items.length)items.forEach((c,j)=>cards.append(card(c,i,j,columns)));
  else cards.append(node('p','Nenhum cartão nesta etapa.','cloud-crm-empty'));
  wrap.append(cards);
  const assign=node('form',null,'cloud-crm-assign');
  const select=node('select');select.setAttribute('aria-label','Selecionar contato para '+(col.title||'etapa'));
  const placeholder=node('option','Escolha um contato existente');placeholder.value='';select.append(placeholder);
  for(const c of state.contacts){
   const option=node('option',(c.name||c.phone)+' · '+c.phone);option.value=c.id;select.append(option);
  }
  const add=node('button','Vincular contato','secondary');add.type='submit';
  select.required=true;add.disabled=!state.contacts.length||busy;
  assign.append(select,add);
  assign.addEventListener('submit',event=>{
   event.preventDefault();if(select.value)act({action:'add-contact',columnIndex:i,contactId:select.value});
  });
  if(!state.contacts.length)assign.append(node('small','Cadastre contatos na aba Contatos para vinculá-los.'));
  wrap.append(assign);
  return wrap;
 }
 function render(){
  root.replaceChildren();
  const title=node('h3','Quadro de etapas · CRM','cloud-crm-title');root.append(title);
  const explain=node('p','Cartões e colunas reais do workspace. Alterações não executam mensagens ou fluxos.','muted');root.append(explain);
  const feedback=node('p',lastStatus,'cloud-crm-status');feedback.classList.toggle('error',lastStatusError);feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');root.append(feedback);
  if(!state.crm.length){
   root.append(node('p','Crie um pipeline no formulário acima ou importe o CRM da extensão para abrir o quadro.','cloud-crm-empty'));
   return;
  }
  if(!state.crm.some(p=>p?.id===selected))selected=state.crm[0]?.id||'';
  const toolbar=node('div',null,'cloud-crm-toolbar');
  const picker=node('select');picker.setAttribute('aria-label','Selecionar pipeline CRM');
  for(const pipeline of state.crm){const opt=node('option',pipeline.name);opt.value=pipeline.id;opt.selected=pipeline.id===selected;picker.append(opt);}
  picker.addEventListener('change',()=>{selected=picker.value;render();});
  toolbar.append(picker,button('Atualizar quadro',()=>reload().catch(()=>status('Falha ao consultar o CRM.',true))));
  root.append(toolbar);
  const pipeline=state.crm.find(p=>p?.id===selected);
  if(!pipeline||!Array.isArray(pipeline.columns)){
   root.append(node('p','O formato deste CRM importado exige revisão. Nenhum dado foi alterado.','cloud-crm-empty'));return;
  }
  const addForm=form('Criar etapa','Nome da nova etapa',title=>act({action:'add-column',title}));
  addForm.classList.add('cloud-crm-add-stage');
  root.append(addForm);
  if(!pipeline.columns.length)root.append(node('p','Este CRM ainda não possui etapas. Crie a primeira coluna acima.','cloud-crm-empty'));
  const board=node('div',null,'cloud-crm-board');board.setAttribute('role','region');board.setAttribute('aria-label','Etapas do CRM');board.tabIndex=0;
  pipeline.columns.forEach((col,i)=>board.append(column(col,i,pipeline.columns)));
  root.append(board);
 }
 window.addEventListener('zvm-cloud-data',event=>{
  const detail=event.detail||{};
  if(!Array.isArray(detail.crm)||!Array.isArray(detail.contacts))return;
  state={revision:detail.revision,crm:detail.crm,contacts:detail.contacts};
  if(!state.crm.some(p=>p.id===selected))selected=state.crm[0]?.id||'';
  busy=false;render();
 });
 window.addEventListener('zvm-cloud-locked',()=>{
  state={revision:0,crm:[],contacts:[]};selected='';busy=false;lastStatus='';lastStatusError=false;root.replaceChildren();
 });
})();
