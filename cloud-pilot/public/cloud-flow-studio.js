'use strict';
/* ZVM Cloud R29 — editor visual do grafo R17. Rascunhos apenas:
 * sem WhatsApp, schedulers, runtime ou alteração implícita de nós avançados. */
(()=>{
 const mount=document.getElementById('cloudFlowStudio');if(!mount)return;
 const base=new URL(document.currentScript.src).pathname.replace(/\/cloud-flow-studio\.js$/,'');
 let flows=[],revision=0,selected='',selectedNode='',locked=true,busy=false,notice='',bad=false,search='';
 const names={start:'Início',sendText:'Mensagem',end:'Fim',endHuman:'Transferir para humano',
  sendAudio:'Áudio',sendImage:'Imagem',sendVideo:'Vídeo',sendSticker:'Figurinha',
  sendDocument:'Documento',sendQuickResponse:'Resposta rápida',sendPix:'PIX',
  sendList:'Lista',sendContact:'Contato',sendSignature:'Assinatura',sendMedia:'Mídia',
  delay:'Aguardar',intervalo:'Intervalo',userInput:'Esperar resposta',
  condition:'Condição',randomizer:'Aleatorizar',moveToColumn:'Mover no CRM',
  aiGenerate:'IA de escrita',aiAgent:'Agente IA'};
 const editable=new Set(['start','sendText','end']);
 const el=(tag,cls='',value=null)=>{
  const x=document.createElement(tag);if(cls)x.className=cls;
  if(value!==null)x.textContent=String(value);
  return x;
 };
 const option=(value,label)=>{const x=el('option','',label);x.value=String(value);return x;};
 function button(label,callback,cls=''){
  const x=el('button',cls,label);x.type='button';x.disabled=busy||locked;
  x.addEventListener('click',callback);return x;
 }
 const field=(label,control)=>{
  const box=el('label','zvm-flow-field');box.append(el('span','',label),control);return box;
 };
 const input=(value='',max=120)=>{
  const x=el('input');x.type='text';x.maxLength=max;x.value=String(value||'');return x;
 };
 const textarea=(value='',max=2000)=>{
  const x=el('textarea');x.rows=4;x.maxLength=max;x.value=String(value||'');return x;
 };
 async function api(route,options={}){
  const response=await fetch(base+route,{credentials:'same-origin',cache:'no-store',...options});
  const body=await response.json().catch(()=>({}));
  if(!response.ok){const err=new Error(body.error||'cloud_request_failed');err.status=response.status;throw err;}
  return body;
 }
 const current=()=>flows.find(x=>x?.id===selected)||null;
 const selectedEntry=()=>current()?.nodes?.find(x=>x.id===selectedNode)||null;
 const array=x=>Array.isArray(x)?x:[];
 const outgoing=node=>{
  const targets=[];
  for(const id of array(node?.nextNodeIds))if(id)targets.push(id);
  for(const key of ['nextNodeIdOnExpiration','nextNodeIdOnDifferentAnswer','nextNodeIdOnConditionFalse'])
   if(node?.[key])targets.push(node[key]);
  for(const w of array(node?.data?.weights))if(w?.nextNodeId)targets.push(w.nextNodeId);
  for(const key of ['expected','different','expiration'])
   for(const id of array(node?.data?.fanout?.[key]))if(id)targets.push(id);
  return [...new Set(targets)];
 };
 function notify(message,error=false){notice=message;bad=error;const box=mount.querySelector('.zvm-flow-status');
  if(box){box.textContent=message;box.classList.toggle('is-error',error);}}
 const words={workspace_conflict:'Os dados da Cloud mudaram em outra aba. Recarreguei o Fluxo; confira antes de repetir a edição.',
  flow_name_taken:'Já existe um Fluxo com este nome.',
  flow_node_has_incoming:'Esta etapa está conectada a outra. Remova a ligação antes de excluí-la.',
  flow_node_grouped:'A etapa pertence a um grupo da extensão. Desagrupe na extensão antes de excluir.',
  flow_node_type_readonly:'Tipo avançado preservado. A edição deste tipo ainda exige a extensão.',
  flow_cycle_disallowed:'Esta ligação criaria um ciclo no grafo.',
  flow_connection_readonly:'Esta etapa possui saídas avançadas. Edite essas conexões na extensão.',
  flow_node_missing:'A etapa não foi encontrada. Atualize o editor.'};
 async function reload(keep=true){
  const data=await api('/api/workspace/flows');
  flows=Array.isArray(data.records)?data.records:[];
  revision=data.revision;
  if(!keep||!flows.some(x=>x.id===selected)){selected=flows[0]?.id||'';selectedNode='';}
  if(selectedNode&&!array(current()?.nodes).some(x=>x.id===selectedNode))selectedNode='';
  render();
 }
 async function act(action,extra={}){
  if(locked||busy)return;
  busy=true;render();
  try{
   const response=await api('/api/workspace/flows/graph',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({revision,flowId:selected,action,...extra})
   });
   revision=response.revision;
   const updated=response.flow;
   if(action==='create')flows.push(updated);
   else flows=flows.map(f=>f.id===updated.id?updated:f);
   selected=updated.id;
   if(action==='add')selectedNode=updated.nodes[updated.nodes.length-1]?.id||'';
   else if(action==='delete')selectedNode='';
   notify('Alterações salvas na sua Cloud. Nenhum fluxo foi executado.');
   window.dispatchEvent(new CustomEvent('zvm-cloud-flow-changed',{detail:{flowId:selected}}));
  }catch(error){
   const reason=words[error.message]||('Alteração recusada: '+error.message);
   notice=reason;bad=true;
   if(error.status===409)await reload(true).catch(()=>{});
  }finally{busy=false;render();}
 }
 function svgLine(layer,x1,y1,x2,y2,advanced=false){
  const p=document.createElementNS('http://www.w3.org/2000/svg','path');
  const mid=Math.max(40,Math.min(130,(x2-x1)*0.4));
  p.setAttribute('d','M'+x1+' '+y1+' C'+(x1+mid)+' '+y1+' '+(x2-mid)+' '+y2+' '+x2+' '+y2);
  p.setAttribute('class','zvm-flow-wire'+(advanced?' is-advanced':''));
  layer.append(p);
 }
 function canvas(flow){
  const shell=el('div','zvm-flow-canvas-scroll');shell.tabIndex=0;
  shell.setAttribute('role','region');shell.setAttribute('aria-label','Mapa visual do Fluxo; use as teclas de seta no inspetor para mover etapas');
  const nodes=array(flow.nodes);
  if(!nodes.length){shell.append(el('p','zvm-flow-empty','Não há nós neste Fluxo. O arquivo original permanece preservado.'));return shell;}
  const positions=nodes.map((n,i)=>({id:n.id,x:Number.isFinite(n.position?.x)?n.position.x:i*240,
   y:Number.isFinite(n.position?.y)?n.position.y:0}));
  const minX=Math.min(...positions.map(p=>p.x),0),minY=Math.min(...positions.map(p=>p.y),0);
  const at=new Map(positions.map(p=>[p.id,{x:p.x-minX+28,y:p.y-minY+38}]));
  const maxX=Math.max(...[...at.values()].map(p=>p.x)),maxY=Math.max(...[...at.values()].map(p=>p.y));
  const surface=el('div','zvm-flow-surface');
  surface.style.width=Math.max(690,maxX+250)+'px';
  surface.style.height=Math.max(340,maxY+145)+'px';
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('class','zvm-flow-connections');
  svg.setAttribute('width',String(Math.max(690,maxX+250)));
  svg.setAttribute('height',String(Math.max(340,maxY+145)));
  for(const node of nodes)for(const target of outgoing(node)){
   const from=at.get(node.id),to=at.get(target);
   if(from&&to)svgLine(svg,from.x+184,from.y+46,to.x,to.y+46,!editable.has(node.type));
  }
  surface.append(svg);
  for(const node of nodes){
   const p=at.get(node.id);
   const card=button('','zvm-flow-node',()=>{selectedNode=node.id;render();});
   // Button labels are populated via text nodes, not HTML strings.
   card.textContent='';
   card.style.left=p.x+'px';card.style.top=p.y+'px';
   card.classList.toggle('is-selected',node.id===selectedNode);
   card.classList.toggle('is-advanced',!editable.has(node.type));
   card.setAttribute('aria-label',(names[node.type]||node.type)+' · '+(node.data?.label||node.data?.text||node.id).slice(0,70));
   card.append(el('small','zvm-flow-node-type',names[node.type]||'Etapa avançada'),
    el('strong','',node.type==='sendText'?String(node.data?.text||'Mensagem vazia').slice(0,75):
     String(node.data?.label||node.id).slice(0,65)));
   if(node.id===flow.startNodeId)card.append(el('small','zvm-flow-node-start','INÍCIO'));
   surface.append(card);
  }
  shell.append(surface);return shell;
 }
 function inspector(flow){
  const panel=el('aside','zvm-flow-inspector');
  panel.append(el('h3','','Propriedades'));
  const node=selectedEntry();
  if(!node){
   panel.append(el('p','zvm-flow-hint','Selecione uma etapa no mapa para editar as opções compatíveis com a R17.'));
   const meta=el('form','zvm-flow-form');
   const name=input(flow.name,120),description=textarea(flow.description||'',300),color=input(flow.color||'#10b981',7);
   meta.append(field('Nome do Fluxo',name),field('Descrição',description),field('Cor hexadecimal (#rrggbb)',color));
   meta.append(button('Salvar informações',()=>act('rename',{name:name.value,description:description.value,color:color.value}),'primary'));
   panel.append(meta);
   const triggerType=el('select');triggerType.append(option('manual','Manual'),option('keyword','Palavra-chave'));
   triggerType.value=['manual','keyword'].includes(flow.trigger?.type)?flow.trigger.type:'manual';
   const keywords=textarea(array(flow.trigger?.keywordRules?.[0]?.keywords).join(', '),500);
   const ct=el('input');ct.type='checkbox';ct.checked=flow.trigger?.sendToContacts!==false;
   const grp=el('input');grp.type='checkbox';grp.checked=flow.trigger?.sendToGroups===true;
   panel.append(el('h4','','Gatilho de entrada'),field('Tipo de gatilho',triggerType),
    field('Palavras-chave separadas por vírgula',keywords),
    field('Permitir contatos individuais',ct),field('Permitir grupos',grp));
   if(!['manual','keyword'].includes(flow.trigger?.type||'manual'))panel.append(el('p','zvm-flow-warning','Gatilho avançado importado: modo somente leitura. Revise na extensão.'));
   else panel.append(button('Salvar gatilho',()=>act('trigger',{type:triggerType.value,
    keywords:keywords.value,sendToContacts:ct.checked,sendToGroups:grp.checked}),'secondary'));
   return panel;
  }
  panel.append(el('p','zvm-flow-hint',names[node.type]||'Tipo de nó preservado da extensão'));
  panel.append(el('small','zvm-flow-node-id','ID: '+node.id));
  const move=el('div','zvm-flow-move');
  for(const [label,dx,dy] of [['↑',0,-40],['←',-40,0],['→',40,0],['↓',0,40]])
   move.append(button(label,()=>act('position',{nodeId:node.id,x:(Number(node.position?.x)||0)+dx,
    y:(Number(node.position?.y)||0)+dy}),'secondary'));
  panel.append(el('p','zvm-flow-hint','Organizar posição'),move);
  if(!editable.has(node.type)){
   panel.append(el('p','zvm-flow-warning','Esta etapa usa um tipo avançado da extensão. As conexões e os dados internos ficam preservados; aqui apenas a posição pode ser ajustada.'));
  }else{
   if(node.type==='sendText'){
    const message=textarea(node.data?.text||'',2000);
    const preview=el('div','zvm-flow-text-preview',message.value||'Prévia da mensagem');
    message.addEventListener('input',()=>{preview.textContent=message.value||'Prévia da mensagem';});
    panel.append(field('Texto da mensagem',message),el('small','','Prévia abaixo do campo'),preview,
     button('Salvar mensagem',()=>act('text',{nodeId:node.id,text:message.value}),'primary'));
   }
   if(node.type==='start'||node.type==='sendText'){
    const targets=el('select');
    targets.append(option('','Sem ligação de saída'));
    for(const candidate of flow.nodes.filter(x=>x.id!==node.id&&x.type!=='start'))
     targets.append(option(candidate.id,(names[candidate.type]||candidate.type)+' · '+candidate.id.slice(0,8)));
    const previous=array(node.nextNodeIds)[0]||'';
    targets.value=previous;
    panel.append(field('Próxima etapa',targets));
    const row=el('div','zvm-flow-inspector-actions');
    row.append(button('Conectar',()=>act('link',{nodeId:node.id,targetId:targets.value}),'primary'));
    row.append(button('Desconectar',()=>act('unlink',{nodeId:node.id}),'secondary'));
    panel.append(row);
   }
   if(node.type!=='start')panel.append(button('Excluir etapa',()=>{
    if(confirm('Excluir esta etapa? Ela só pode ser excluída se não possuir ligações de entrada ou grupo.'))
     act('delete',{nodeId:node.id});
   },'zvm-flow-danger'));
  }
  panel.append(button('Voltar ao Fluxo',()=>{selectedNode='';render();},'secondary'));
  return panel;
 }
 function render(){
  mount.replaceChildren();
  const toolbar=el('div','zvm-flow-toolbar');
  toolbar.append(el('h2','','Fluxos • Editor visual R17'));
  toolbar.append(el('small','','Rascunhos privados · execução desativada'));
  mount.append(toolbar);
  const layout=el('div','zvm-flow-layout'),side=el('aside','zvm-flow-sidebar');
  side.append(el('h3','','Meus Fluxos'));
  const find=input(search,120);find.type='search';find.placeholder='Buscar fluxo...';find.setAttribute('aria-label','Pesquisar fluxos');
  find.addEventListener('input',()=>{search=find.value;drawFlowList(list);});
  side.append(find);
  const list=el('div','zvm-flow-list');side.append(list);
  const newFlow=el('form','zvm-flow-create');
  const newName=input('',120);newName.placeholder='Novo Fluxo';newName.required=true;newName.setAttribute('aria-label','Nome do novo Fluxo');
  const create=el('button','primary','Criar Fluxo');create.type='submit';create.disabled=busy||locked;
  newFlow.append(newName,create);
  newFlow.addEventListener('submit',event=>{event.preventDefault();if(newName.value.trim())act('create',{name:newName.value});});
  side.append(newFlow);
  const main=el('section','zvm-flow-main');
  const flow=current();
  if(!flow)main.append(el('p','zvm-flow-empty','Crie ou selecione um Fluxo para visualizar suas etapas.'));
  else{
   const top=el('div','zvm-flow-map-head');
   top.append(el('h3','',flow.name));
   const buttons=el('div','zvm-flow-node-actions');
   buttons.append(button('+ Mensagem',()=>act('add',{type:'sendText'}),'secondary'),
    button('+ Fim',()=>act('add',{type:'end'}),'secondary'));
   top.append(buttons);main.append(top,canvas(flow));
   const detail=el('div','zvm-flow-review');
   const issues=diagnose(flow);
   detail.append(el('strong','','Análise do Fluxo: '+issues.length+' observação(ões)'));
   for(const issue of issues.slice(0,8))detail.append(el('p','',issue));
   if(issues.length>8)detail.append(el('small','','Mais '+(issues.length-8)+' observações não exibidas.'));
   main.append(detail);
  }
  layout.append(side,main);
  if(flow)layout.append(inspector(flow));
  else layout.append(el('aside','zvm-flow-inspector','Nenhum Fluxo selecionado.'));
  mount.append(layout);
  const feedback=el('p','zvm-flow-status'+(bad?' is-error':''),notice);
  feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');mount.append(feedback);
  drawFlowList(list);
 }
 function diagnose(flow){
  const nodes=array(flow.nodes),byId=new Map(nodes.map(x=>[x.id,x])),issues=[];
  if(!byId.get(flow.startNodeId)||byId.get(flow.startNodeId)?.type!=='start')
   issues.push('Início ausente ou incompatível; revise antes de utilizar na extensão.');
  for(const node of nodes){
   if(!Object.hasOwn(names,node.type))issues.push('Tipo avançado preservado: '+String(node.type).slice(0,50));
   for(const id of outgoing(node))if(!byId.has(id))
    issues.push('Ligação ausente na etapa '+String(node.id).slice(0,10));
  }
  if(!issues.length)issues.push('Estrutura consistente no editor. Isso não significa que o motor esteja habilitado.');
  return issues;
 }
 function drawFlowList(list){
  list.replaceChildren();
  const visible=flows.filter(f=>String(f.name||'').toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  if(!visible.length)list.append(el('p','zvm-flow-hint','Nenhum Fluxo encontrado.'));
  for(const item of visible){
   const n=button(item.name||'Sem título',()=>{selected=item.id;selectedNode='';render();},'zvm-flow-list-item');
   n.classList.toggle('is-selected',item.id===selected);
   n.append(el('small','',array(item.nodes).length+' etapas · '+(item.isActive?'Ativo na configuração original':'Inativo')));
   list.append(n);
  }
 }
 async function ready(){
  locked=false;try{await reload(false);notice='Fluxos carregados. Nenhuma automação é executada na Cloud.';}
  catch{notice='Não foi possível carregar os Fluxos. Confira a sessão do Portal.';bad=true;render();}
 }
 function lock(){locked=true;flows=[];revision=0;selected='';selectedNode='';search='';notice='';render();}
 window.addEventListener('zvm-cloud-ready',ready);
 window.addEventListener('zvm-cloud-locked',lock);
 window.addEventListener('zvm-cloud-flow-changed',()=>{if(!locked)reload(true).catch(()=>{});});
 render();
})();
