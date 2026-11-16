'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Graph=require('../flow-graph-domain');
const Core=require('../flow-graph-core');
const script=fs.readFileSync(path.join(__dirname,'../public/cloud-flow-studio.js'),'utf8');

class Element{
 constructor(tag='div'){
  this.tagName=tag;this.children=[];this.listeners=new Map();this.style={};
  this.className='';this.attrs={};this.value='';this._text='';this.disabled=false;
  this.classList={toggle:(name,value)=>{
   const names=new Set(this.className.split(' ').filter(Boolean));
   const next=value===undefined?!names.has(name):value;
   if(next)names.add(name);else names.delete(name);
   this.className=[...names].join(' ');
  }};
 }
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(x=>x.textContent||'').join('');}
 append(...children){this.children.push(...children.filter(Boolean));}
 replaceChildren(...children){this.children=[...children];}
 setAttribute(name,value){this.attrs[name]=String(value);}
 addEventListener(name,handler){this.listeners.set(name,[...(this.listeners.get(name)||[]),handler]);}
 querySelector(selector){
  const cls=selector.slice(1);
  if(this.className.split(' ').includes(cls))return this;
  for(const child of this.children){const match=child.querySelector?.(selector);if(match)return match;}
  return null;
 }
 all(cls){
  const list=[];
  if(this.className.split(' ').includes(cls))list.push(this);
  for(const child of this.children)list.push(...(child.all?.(cls)||[]));
  return list;
 }
 byText(label){
  if(this.tagName==='button'&&this.textContent===label)return this;
  for(const child of this.children){const found=child.byText?.(label);if(found)return found;}
  return null;
 }
 fire(name,options={}){
  assert.equal(this.disabled,false,'cannot trigger a disabled '+this.tagName);
  for(const handler of this.listeners.get(name)||[])handler({preventDefault(){},...options});
 }
}
async function boot(){
 const root=new Element('div'),eventHandlers=new Map(),fetchCalls=[];
 let flows=[],revision=0;
 const document={
  currentScript:{src:'https://zvm.onrender.com/dev/cloud/cloud-flow-studio.js'},
  getElementById:id=>id==='cloudFlowStudio'?root:null,
  createElement:tag=>new Element(tag),
  createElementNS:(namespace,tag)=>new Element(tag)
 };
 const window={
  ZVMCloudFlowCore:Core,
  addEventListener(name,callback){eventHandlers.set(name,[...(eventHandlers.get(name)||[]),callback]);},
  dispatchEvent(event){for(const callback of eventHandlers.get(event.type)||[])callback(event);}
 };
 async function fetchMock(uri,options={}){
  const route=new URL(uri).pathname.replace('/dev/cloud','');
  fetchCalls.push({route,method:options.method||'GET'});
  if(route==='/api/workspace/flows')return {
   ok:true,status:200,json:async()=>({records:flows,revision})
  };
  if(route==='/api/workspace/flows/graph'){
   const payload=JSON.parse(options.body||'{}');
   if(payload.revision!==revision)return{
    ok:false,status:409,json:async()=>({error:'workspace_conflict'})
   };
   try{
    const result=Graph.update(flows,payload);flows=result.flows;revision++;
    return{ok:true,status:200,json:async()=>({flow:result.flow,review:result.review,revision})};
   }catch(error){return{ok:false,status:422,json:async()=>({error:error.code})};}
  }
  throw Error('unexpected_frontend_route: '+route);
 }
 vm.runInNewContext(script,{
  document,window,URL,fetch:fetchMock,
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
  confirm:()=>true,
 });
 async function settled(){await new Promise(resolve=>setImmediate(resolve));}
 window.dispatchEvent({type:'zvm-cloud-ready'});await settled();
 return {root,window,settled,fetchCalls,get flows(){return flows;},get revision(){return revision;}};
}
test('R29: browserlike DOM builds actual Flow board and persists create/add/text/link actions',async()=>{
 const app=await boot();
 const create=app.root.querySelector('.zvm-flow-create');
 assert(create,'creation form must be mounted after login');
 create.children[0].value='Meu fluxo';
 create.fire('submit');await app.settled();
 assert.equal(app.flows.length,1);
 assert.equal(app.flows[0].nodes[0].type,'start');
 assert(app.root.querySelector('.zvm-flow-node'),'start card must be visible');
 app.root.byText('+ Mensagem').fire('click');await app.settled();
 assert.equal(app.flows[0].nodes.length,2);
 assert(app.root.querySelector('.zvm-flow-text-preview'),'composer preview must render below the field');
 const panel=app.root.querySelector('.zvm-flow-inspector');
 const textField=panel.all('zvm-flow-field').find(x=>x.textContent.includes('Texto da mensagem'));
 assert(textField,'text editor must be present');
 textField.children[1].value='Olá, seja bem-vindo!';
 panel.byText('Salvar mensagem').fire('click');await app.settled();
 assert.equal(app.flows[0].nodes[1].data.text,'Olá, seja bem-vindo!');
 const startButton=app.root.all('zvm-flow-node').find(x=>x.textContent.includes('Início'));
 startButton.fire('click');await app.settled();
 const options=app.root.querySelector('.zvm-flow-inspector').all('zvm-flow-field');
 const link=options.find(x=>x.textContent.includes('Próxima etapa'));
 assert(link);
 link.children[1].value=app.flows[0].nodes[1].id;
 app.root.byText('Conectar').fire('click');await app.settled();
 assert.equal(app.flows[0].nodes[0].nextNodeIds[0],app.flows[0].nodes[1].id);
 assert.equal(app.flows[0].isActive,false);
 assert(app.fetchCalls.some(x=>x.route==='/api/workspace/flows/graph'));
});
test('R29: editor clears private graph when session is locked',async()=>{
 const app=await boot();app.window.dispatchEvent({type:'zvm-cloud-locked'});
 assert.equal(app.root.all('zvm-flow-node').length,0);
 assert.equal(app.root.textContent.includes('Meu fluxo'),false);
});
