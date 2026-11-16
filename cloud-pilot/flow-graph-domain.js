'use strict';
// ZVM R29: a lossless, draft-only graph editor for the R17 Flow schema.
// Only edits explicitly-supported nodes; imported advanced nodes remain intact.
const crypto=require('node:crypto');
const MAX_NODES=600,MAX_TEXT=2000,MAX_COORD=20000;
const TYPES=Object.freeze({
 start:'Início',sendText:'Mensagem',end:'Fim',endHuman:'Transferir para humano',
 sendAudio:'Áudio salvo',sendImage:'Imagem salva',sendVideo:'Vídeo salvo',
 sendDocument:'Documento salvo',sendSticker:'Figurinha salva',
 sendQuickResponse:'Resposta rápida',sendPix:'PIX',sendList:'Lista',
 sendContact:'Contato',sendSignature:'Assinatura',sendMedia:'Mídia',
 delay:'Aguardar',intervalo:'Intervalo',condition:'Condição',
 userInput:'Esperar resposta',randomizer:'Aleatorizar',moveToColumn:'Mover no CRM',
 aiGenerate:'IA de escrita',aiAgent:'Agente IA'
});
function fail(code){const e=new Error(code);e.code=code;throw e;}
const str=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
function id(){return 'cloud_'+crypto.randomBytes(12).toString('hex');}
function clone(x){return JSON.parse(JSON.stringify(x));}
function array(x){return Array.isArray(x)?x:[];}
function targets(node){
 const out=[];
 for(const value of array(node?.nextNodeIds))if(typeof value==='string'&&value)out.push(value);
 for(const key of ['nextNodeIdOnExpiration','nextNodeIdOnDifferentAnswer','nextNodeIdOnConditionFalse']){
  if(typeof node?.[key]==='string'&&node[key])out.push(node[key]);
 }
 for(const weight of array(node?.data?.weights))if(typeof weight?.nextNodeId==='string'&&weight.nextNodeId)out.push(weight.nextNodeId);
 for(const branch of ['expected','different','expiration']){
  for(const value of array(node?.data?.fanout?.[branch]))if(typeof value==='string'&&value)out.push(value);
 }
 if(typeof node?.data?.errorFallbackNodeId==='string'&&node.data.errorFallbackNodeId)out.push(node.data.errorFallbackNodeId);
 return [...new Set(out)];
}
function review(flow){
 const nodes=array(flow?.nodes),byId=new Map(),issues=[],reached=new Set();
 if(nodes.length>MAX_NODES)issues.push({code:'flow_too_large',severity:'error',text:'Fluxo excede 600 etapas'});
 for(const node of nodes){
  if(!node||typeof node!=='object'||typeof node.id!=='string'||!node.id){
   issues.push({code:'invalid_node',severity:'error',text:'Etapa sem identificador'});continue;
  }
  if(byId.has(node.id))issues.push({code:'duplicate_node',severity:'error',nodeId:node.id,text:'Etapa duplicada'});
  byId.set(node.id,node);
  if(!Object.hasOwn(TYPES,node.type))issues.push({code:'unsupported_node',severity:'warning',nodeId:node.id,text:'Tipo avançado preservado: '+String(node.type||'desconhecido').slice(0,45)});
  if(node.data?.requiresReview===true)issues.push({code:'import_requires_review',severity:'warning',nodeId:node.id,text:'Etapa importada precisa de revisão na extensão'});
 }
 const start=byId.get(flow?.startNodeId);
 if(!start||start.type!=='start')issues.push({code:'missing_start',severity:'error',text:'Início não encontrado'});
 for(const node of nodes){
  if(!node?.id)continue;
  for(const next of targets(node))if(!byId.has(next))issues.push({code:'dangling_target',severity:'error',nodeId:node.id,text:'Conexão aponta para uma etapa ausente'});
  if(['sendAudio','sendImage','sendVideo','sendDocument','sendSticker','sendQuickResponse','sendPix','sendList','sendContact','sendSignature','sendMedia'].includes(node.type)&&!node.data?.itemId)
   issues.push({code:'missing_saved_item',severity:'warning',nodeId:node.id,text:'Etapa precisa de item salvo na Biblioteca'});
 }
 if(start){
  const queue=[start.id];reached.add(start.id);
  while(queue.length){
   const current=byId.get(queue.shift());
   for(const next of targets(current))if(byId.has(next)&&!reached.has(next)){reached.add(next);queue.push(next);}
  }
 }
 for(const node of nodes)if(node?.id&&!reached.has(node.id))
  issues.push({code:'unreachable',severity:'warning',nodeId:node.id,text:'Etapa fora do caminho iniciado'});
 return {nodeCount:nodes.length,connected:reached.size,issues,valid:!issues.some(x=>x.severity==='error')};
}
function freshFlow(payload){
 const name=str(payload.name,120);
 if(!name)fail('flow_name_required');
 const startId=id(),now=Date.now();
 return {id:id(),name,description:str(payload.description,300),color:'#10b981',
  isActive:false,favorite:false,createdAtInMs:now,updatedAtInMs:now,
  startNodeId:startId,trigger:{type:'manual',activationTypes:['manual'],
   keywordRules:[],sendToContacts:true,sendToGroups:false},
  nodes:[{id:startId,type:'start',position:{x:100,y:200},data:{},
   nextNodeIds:[],nextNodeIdOnExpiration:null,nextNodeIdOnDifferentAnswer:null,
   expirationTimeoutInMs:null}],nodeGroups:[]};
}
function update(flows,payload){
 if(!Array.isArray(flows)||flows.length>100)fail('flow_list_invalid');
 if(!payload||typeof payload!=='object'||Array.isArray(payload))fail('invalid_graph_action');
 const action=str(payload.action,40);
 const existing=flows.find(x=>x?.id===payload.flowId);
 const taken=(name,ignore)=>flows.some(f=>f?.id!==ignore&&
  String(f?.name||'').toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR'));
 if(action==='create'){
  if(flows.length>=100)fail('flow_list_full');
  const created=freshFlow(payload);
  if(taken(created.name))fail('flow_name_taken');
  return {flows:[...flows,created],flow:created,review:review(created)};
 }
 if(!existing)fail('flow_not_found');
 if(!Array.isArray(existing.nodes)||existing.nodes.length>MAX_NODES)fail('flow_graph_invalid');
 const copyFlow=clone(existing);
 const nodes=copyFlow.nodes;
 const node=nodes.find(x=>x?.id===payload.nodeId);
 const allowed=['rename','trigger','add','text','position','link','unlink','delete'];
 if(!allowed.includes(action))fail('unsupported_graph_action');
 if(action==='rename'){
  const name=str(payload.name,120);if(!name)fail('flow_name_required');
  if(taken(name,copyFlow.id))fail('flow_name_taken');
  copyFlow.name=name;
  copyFlow.description=str(payload.description,300);
  if(/^#[a-f0-9]{6}$/i.test(String(payload.color||'')))copyFlow.color=payload.color;
 }else if(action==='trigger'){
  const type=payload.type==='keyword'?'keyword':payload.type==='manual'?'manual':null;
  if(!type)fail('flow_trigger_invalid');
  if(!['manual','keyword'].includes(copyFlow.trigger?.type||'manual'))fail('flow_trigger_advanced_readonly');
  const words=type==='keyword'?str(payload.keywords,500).split(',').map(x=>x.trim()).filter(Boolean):[];
  if(type==='keyword'&&(!words.length||words.length>20))fail('flow_trigger_keywords_invalid');
  copyFlow.trigger={...copyFlow.trigger,type,activationTypes:[type],
   keywordRules:type==='keyword'?[{type:'contains',keywords:words}]:[],
   sendToContacts:payload.sendToContacts!==false,sendToGroups:payload.sendToGroups===true};
 }else if(action==='add'){
  const type=payload.type;
  if(!['sendText','end'].includes(type))fail('flow_node_type_readonly');
  if(nodes.length>=MAX_NODES)fail('flow_node_limit');
  const data=type==='sendText'?{text:str(payload.text||'Escreva sua mensagem',MAX_TEXT)}:{label:'Fim'};
  const next={id:id(),type,data,position:{x:Math.min(19000,180+nodes.length*170),y:200},
   nextNodeIds:[],nextNodeIdOnExpiration:null,nextNodeIdOnDifferentAnswer:null};
  nodes.push(next);
 }else{
  if(!node)fail('flow_node_missing');
  if(action==='position'){
   const x=Number(payload.x),y=Number(payload.y);
   if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>MAX_COORD||Math.abs(y)>MAX_COORD)
    fail('flow_position_invalid');
   node.position={x:Math.round(x),y:Math.round(y)};
  }else if(action==='text'){
   if(node.type!=='sendText')fail('flow_node_type_readonly');
   const text=str(payload.text,MAX_TEXT);if(!text)fail('flow_text_required');
   node.data={...node.data,text};
  }else if(action==='link'||action==='unlink'){
   if(!['start','sendText'].includes(node.type))fail('flow_connection_readonly');
   if(action==='link'){
    const target=nodes.find(x=>x?.id===payload.targetId);
    if(!target||target.type==='start'||target.id===node.id)fail('flow_target_invalid');
    if(targets(target).includes(node.id))fail('flow_cycle_disallowed');
    // Only direct, single-output nodes are edited. Never rewrite branch
    // outputs, fanout or imported advanced graph metadata.
    if(targets(node).some(x=>!array(node.nextNodeIds).includes(x)))fail('flow_connection_readonly');
    const queue=[target.id],seen=new Set();
    while(queue.length){
     const current=queue.shift();if(seen.has(current))continue;
     if(current===node.id)fail('flow_cycle_disallowed');
     seen.add(current);
     for(const next of targets(nodes.find(x=>x?.id===current)))queue.push(next);
    }
    node.nextNodeIds=[target.id];
   }else{
    if(targets(node).some(x=>!array(node.nextNodeIds).includes(x)))fail('flow_connection_readonly');
    node.nextNodeIds=[];
   }
  }else if(action==='delete'){
   if(!['sendText','end'].includes(node.type))fail('flow_node_type_readonly');
   if(nodes.some(other=>other?.id!==node.id&&targets(other).includes(node.id)))fail('flow_node_has_incoming');
   if([...array(copyFlow.nodeGroups),...array(copyFlow.groups)].some(g=>array(g?.memberNodeIds).includes(node.id)))fail('flow_node_grouped');
   nodes.splice(nodes.indexOf(node),1);
  }
 }
 copyFlow.updatedAtInMs=Date.now();
 const updated=flows.map(row=>row?.id===copyFlow.id?copyFlow:row);
 return {flows:updated,flow:copyFlow,review:review(copyFlow)};
}
module.exports={TYPES,MAX_NODES,review,update,targets};
