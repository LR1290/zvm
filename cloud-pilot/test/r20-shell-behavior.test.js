'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../public/cloud-ui.js'),'utf8');
const pages=['summary','campaigns','flows','funnels','crm','labels','contacts',
 'library','quickReplies','agenda','migration','integration','settings'];

function harness(){
 class Node{
  constructor(id='',dataset={}){this.id=id;this.dataset=dataset;this.children=[];this.handlers={};this.attributes={};
   this.hidden=false;this.value='';this.textContent='';this.className='';this.tagName='';
   const classes=new Set();
   this.classList={add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),
    toggle:(x,v)=>{if(v===undefined)v=!classes.has(x);if(v)classes.add(x);else classes.delete(x);return v;}};
  }
  addEventListener(type,fn){(this.handlers[type]??=[]).push(fn);}
  append(...nodes){this.children.push(...nodes);}
  prepend(...nodes){this.children.unshift(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(k,v){this.attributes[k]=v;}
  removeAttribute(k){delete this.attributes[k];}
  click(){for(const fn of this.handlers.click||[])fn({target:this});}
  focus(){}
  querySelector(s){return s==='button'?this.children.find(x=>x.tagName==='button'):null;}
  querySelectorAll(){return [];}
 }
 const ids=['app','cloudPageTitle','cloudPageSubtitle','cloudPageCategory','cloudCommandButton',
  'cloudCommandDialog','cloudCommandInput','cloudCommandResults','cloudCommandClose',
  'cloudContacts','cloudLibrary','cloudAutomations','cloudModulesOverview'];
 const nodes=Object.fromEntries(ids.map(id=>[id,new Node(id)]));
 nodes.app.hidden=true;nodes.cloudCommandDialog.hidden=true;
 const buttons=pages.map(page=>new Node('btn-'+page,{page}));
 const nav=new Node('nav');nav.querySelectorAll=()=>buttons;
 const document={body:new Node('body'),title:'',handlers:{},getElementById:id=>nodes[id]||null,
  querySelector:s=>s==='.tabs'?nav:s.startsWith('.tabs button[data-page=')?
   buttons.find(x=>x.dataset.page===s.match(/"([^"]+)"/)?.[1]):null,
  querySelectorAll:s=>s==='.tabs button[data-page]'?buttons:[],
  createElement:name=>{const n=new Node();n.tagName=name;return n;},
  createElementNS:(_ns,name)=>{const n=new Node();n.tagName=name;return n;},
  addEventListener(type,fn){this.handlers[type]=fn;}};
 const events={};const window={addEventListener:(type,fn)=>{events[type]=fn;}};
 const location={hash:'#crm'},history={replaceState:(_a,_b,hash)=>{location.hash=hash;}};
 vm.runInNewContext(code,{document,window,location,history},{timeout:1000});
 return {document,nodes,buttons,events,location};
}
test('R20 Cloud navigation, deep links, search and account-derived metrics',()=>{
 const r=harness();r.nodes.app.hidden=false;r.events['zvm-cloud-ready']();
 assert.equal(r.nodes.cloudPageTitle.textContent,'CRM');
 assert.equal(r.location.hash,'#crm');
 r.events['zvm-cloud-data']({detail:{counts:{contacts:12,library:7,flows:2,funnels:3,
  crm:1,labels:4,campaigns:5,quickReplies:3,agenda:1}}});
 assert.equal(r.nodes.cloudContacts.textContent,'12');
 assert.equal(r.nodes.cloudLibrary.textContent,'7');
 assert.equal(r.nodes.cloudAutomations.textContent,'5');
 assert.equal(r.nodes.cloudModulesOverview.children.length,9);
 r.buttons.find(x=>x.dataset.page==='campaigns').click();
 assert.equal(r.nodes.cloudPageTitle.textContent,'Disparos');assert.equal(r.location.hash,'#campaigns');
 r.nodes.cloudCommandButton.click();
 assert.equal(r.nodes.cloudCommandDialog.hidden,false);
 r.nodes.cloudCommandInput.value='biblio';
 r.nodes.cloudCommandInput.handlers.input[0]();
 assert.equal(r.nodes.cloudCommandResults.children.length,1);
 r.nodes.cloudCommandResults.children[0].click();
 assert.equal(r.nodes.cloudPageTitle.textContent,'Biblioteca');
 assert.equal(r.nodes.cloudCommandDialog.hidden,true);
 r.events['zvm-cloud-locked']();
 assert.equal(r.document.body.classList.contains('cloud-workspace'),false);
});
