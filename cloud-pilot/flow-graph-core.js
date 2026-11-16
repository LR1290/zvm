'use strict';
// Shared between Cloud HTTP validation and visual Flow Studio. Mirrors R17 node
// outputs including branches, randomizer weights and fanout; no runtime or sends.
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else Object.defineProperty(root,'ZVMCloudFlowCore',{value:api,writable:false,configurable:false});
})(typeof self!=='undefined'?self:globalThis,function(){
 const MAX_NODES=600;
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

 const array=x=>Array.isArray(x)?x:[];
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

 return Object.freeze({TYPES,MAX_NODES,targets,review});
});
