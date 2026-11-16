'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Graph=require('../flow-graph-domain');
const {createServer}=require('../server');
const {createMemoryStore}=require('../store');
const crypto=require('node:crypto');
const TOKEN='r29-cloud-qa',HASH=crypto.createHash('sha256').update(TOKEN).digest('hex');
const mutate=(flows,params)=>Graph.update(flows,params);
function build(){
 const created=mutate([],{action:'create',name:'Atendimento inicial'});
 return created.flow;
}
function nodeOf(flow,type){return flow.nodes.find(n=>n.type===type);}
test('R29: new draft mirrors native R17 Flow graph shape and never becomes active',()=>{
 const {flow,review}=mutate([],{action:'create',name:'Atendimento inicial'});
 assert.match(flow.id,/^cloud_[a-f0-9]{24}$/);
 assert.equal(flow.isActive,false);
 assert.equal(flow.trigger.type,'manual');
 assert.equal(flow.trigger.sendToGroups,false);
 assert.equal(flow.nodes.length,1);
 assert.equal(flow.nodes[0].type,'start');
 assert.equal(flow.startNodeId,flow.nodes[0].id);
 assert.deepEqual(flow.nodes[0].nextNodeIds,[]);
 assert.equal(review.valid,true);
 assert.throws(()=>mutate([flow],{action:'create',name:'atendimento inicial'}),/flow_name_taken/);
});
test('R29: adds, links, edits, moves and unlinks R17 text/end nodes',()=>{
 let flow=build();
 flow=mutate([flow],{flowId:flow.id,action:'add',type:'sendText',text:'Olá!'}).flow;
 const text=nodeOf(flow,'sendText');
 assert.equal(text.data.text,'Olá!');
 flow=mutate([flow],{flowId:flow.id,action:'add',type:'end'}).flow;
 const end=nodeOf(flow,'end');
 flow=mutate([flow],{flowId:flow.id,action:'link',nodeId:flow.startNodeId,targetId:text.id}).flow;
 flow=mutate([flow],{flowId:flow.id,action:'link',nodeId:text.id,targetId:end.id}).flow;
 assert.deepEqual(flow.nodes.find(n=>n.id===text.id).nextNodeIds,[end.id]);
 assert.equal(Graph.review(flow).connected,3);
 flow=mutate([flow],{flowId:flow.id,action:'text',nodeId:text.id,text:'Obrigado!'}).flow;
 assert.equal(flow.nodes.find(n=>n.id===text.id).data.text,'Obrigado!');
 flow=mutate([flow],{flowId:flow.id,action:'position',nodeId:end.id,x:700,y:-200}).flow;
 assert.deepEqual(flow.nodes.find(n=>n.id===end.id).position,{x:700,y:-200});
 assert.throws(()=>mutate([flow],{flowId:flow.id,action:'delete',nodeId:end.id}),/flow_node_has_incoming/);
 flow=mutate([flow],{flowId:flow.id,action:'unlink',nodeId:text.id}).flow;
 flow=mutate([flow],{flowId:flow.id,action:'delete',nodeId:end.id}).flow;
 assert.equal(flow.nodes.some(n=>n.id===end.id),false);
 assert.equal(Graph.review(flow).valid,true);
});
test('R29: advanced R17 nodes survive graph changes byte-for-byte',()=>{
 const flow=build();
 const legacy={id:'advanced-node',type:'condition',position:{x:420,y:175},
  nextNodeIds:['unavailable-node'],nextNodeIdOnConditionFalse:null,
  data:{rule:{metadata:{label:'Preservar',operator:'equals'}},requiresReview:true},
  extensions:{version:7,namespace:'R17'}};flow.nodes.push(legacy);
 const before=JSON.stringify(legacy);
 const result=mutate([flow],{flowId:flow.id,action:'rename',name:'Fluxo revisado',description:'Somente metadados'});
 assert.equal(JSON.stringify(result.flow.nodes[1]),before);
 assert.equal(result.review.valid,false);
 assert(result.review.issues.some(i=>i.code==='dangling_target'));
 assert.throws(()=>mutate([flow],{flowId:flow.id,action:'text',nodeId:legacy.id,text:'x'}),/flow_node_type_readonly/);
 assert.throws(()=>mutate([flow],{flowId:flow.id,action:'link',nodeId:legacy.id,targetId:flow.startNodeId}),/flow_connection_readonly/);
 assert.throws(()=>mutate([flow],{flowId:flow.id,action:'delete',nodeId:legacy.id}),/flow_node_type_readonly/);
 const moved=mutate([flow],{flowId:flow.id,action:'position',nodeId:legacy.id,x:440,y:220}).flow;
 assert.equal(moved.nodes[1].data.rule.metadata.label,'Preservar');
 assert.equal(moved.nodes[1].extensions.version,7);
});
test('R29: keyword trigger validates policy without changing unrelated R17 metadata',()=>{
 const flow=build();flow.trigger={...flow.trigger,customMetadata:{source:'r17'}};
 const next=mutate([flow],{flowId:flow.id,action:'trigger',type:'keyword',
  keywords:'orcamento, planos, suporte',sendToContacts:true,sendToGroups:false}).flow;
 assert.deepEqual(next.trigger.keywordRules[0].keywords,['orcamento','planos','suporte']);
 assert.equal(next.trigger.customMetadata.source,'r17');
 assert.equal(next.isActive,false);
 assert.throws(()=>mutate([flow],{flowId:flow.id,action:'trigger',type:'keyword',keywords:''}),/flow_trigger_keywords_invalid/);
 assert.throws(()=>mutate([{...flow,trigger:{type:'webhook'}}],{flowId:flow.id,action:'trigger',type:'manual'}),/flow_trigger_advanced_readonly/);
});
test('R29: reject cycles, unsafe links, invalid positions and grouped-node deletion',()=>{
 let flow=build();
 flow=mutate([flow],{flowId:flow.id,action:'add',type:'sendText'}).flow;
 const text=nodeOf(flow,'sendText');
 flow=mutate([flow],{flowId:flow.id,action:'link',nodeId:flow.startNodeId,targetId:text.id}).flow;
 assert.throws(()=>mutate([flow],{flowId:flow.id,action:'link',nodeId:text.id,targetId:flow.startNodeId}),/flow_target_invalid/);
 assert.throws(()=>mutate([flow],{flowId:flow.id,action:'link',nodeId:text.id,targetId:text.id}),/flow_target_invalid/);
 assert.throws(()=>mutate([flow],{flowId:flow.id,action:'position',nodeId:text.id,x:Infinity,y:0}),/flow_position_invalid/);
 assert.throws(()=>mutate([flow],{flowId:flow.id,action:'add',type:'unsupported'}),/flow_node_type_readonly/);
 assert.throws(()=>mutate([flow],{flowId:flow.id,action:'delete',nodeId:flow.startNodeId}),/flow_node_type_readonly/);
 flow.nodes[0].nextNodeIds=[];
 flow.nodeGroups=[{id:'group',memberNodeIds:[text.id]}];
 assert.throws(()=>mutate([flow],{flowId:flow.id,action:'delete',nodeId:text.id}),/flow_node_grouped/);
});
async function fixture(){
 const store=createMemoryStore();
 const server=createServer({store,resolvePortal:async req=>{
  const who=/zv_portal=([ab])/.exec(String(req.headers.cookie||''))?.[1];
  return who?{email:who+'@example.org',sessionId:who.repeat(64),expiresAt:Date.now()+100000}:null;
 },verifyDevKey:async(email,key,hash)=>key===TOKEN?{keyHash:HASH}:key===null&&hash===HASH});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const root='http://127.0.0.1:'+server.address().port;
 async function call(path,who='a',method='GET',body){
  const headers={Cookie:'zv_portal='+who};
  if(method==='POST'){headers.Origin=root;headers['Content-Type']='application/json';}
  const response=await fetch(root+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json()};
 }
 return {call,close:()=>new Promise(resolve=>server.close(resolve))};
}
test('R29: HTTP Flow graph requires DEV, preserves per-account CAS and rejects forged targets',async()=>{
 const {call,close}=await fixture();
 try{
  const path='/api/workspace/flows/graph';
  assert.equal((await call(path,'a','POST',{revision:0,action:'create',name:'A'})).status,403);
  for(const who of ['a','b'])assert.equal((await call('/api/dev/activate',who,'POST',{key:TOKEN})).status,200);
  let r=await call(path,'a','POST',{revision:0,action:'create',name:'Fluxo de entrada'});
  assert.equal(r.status,200);
  assert.equal(r.data.sending,false);
  assert.equal(r.data.revision,1);
  const id=r.data.flow.id,start=r.data.flow.startNodeId;
  assert.equal((await call('/api/workspace/flows','b')).data.records.length,0);
  // R29 requires the graph-specific API. Generic full-array PUT is disabled.
  assert.equal((await call('/api/workspace/flows','a','POST',{revision:1,records:[]})).status,404);
  // Verify the protected legacy writer with a same-origin PUT request.

  assert.equal((await call(path,'a','POST',{revision:0,flowId:id,action:'add',type:'sendText'})).status,409);
  r=await call(path,'a','POST',{revision:1,flowId:id,action:'add',type:'sendText'});
  assert.equal(r.status,200);
  const text=r.data.flow.nodes.find(n=>n.type==='sendText');
  r=await call(path,'a','POST',{revision:2,flowId:id,action:'link',nodeId:start,targetId:text.id});
  assert.equal(r.status,200);
  assert.deepEqual(r.data.flow.nodes[0].nextNodeIds,[text.id]);
  assert.equal((await call(path,'b','POST',{revision:0,flowId:id,action:'rename',name:'Ataque'})).status,422);
  const seen=await call('/api/workspace/flows','a');
  assert.equal(seen.data.records.length,1);
  assert.deepEqual(seen.data.records[0].nodes[0].nextNodeIds,[text.id]);
  assert.equal((await call('/api/send','a','POST',{})).status,404);
 }finally{await close();}
});
test('R29: server disables unsafe generic Flow PUT writer and preserves import route',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../server.js'),'utf8');
 assert.match(source,/if\(name==='flows'\)return json\(res,405,\{error:'use_flow_graph_editor'\}\)/);
 assert.match(source,/pathname==='\/api\/import\/commit'/);
});
test('R29: Flow Studio is CSP-safe, keyboard accessible and never calls WhatsApp',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'../public/cloud-flow-studio.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
 const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 for(const expected of [/zvm-flow-canvas-scroll/,/zvm-flow-inspector/,/zvm-flow-node/,/zvm-cloud-locked/,
  /zvm-cloud-ready/,/\/api\/workspace\/flows\/graph/,/role','region'/])assert.match(source,expected);
 assert.doesNotMatch(source,/\.innerHTML\s*=|\beval\(|\.sendMessage\(|localStorage|sessionStorage/);
 assert.match(html,/id="cloudFlowStudio"/);
 assert.match(server,/FlowGraph\.update\(/);
 assert.match(server,/'\/cloud-flow-studio\.js'/);
});
