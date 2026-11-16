'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const code=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');

function run(status,failed=false){
 const nodes=new Map(),calls=[],events=[];
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{
   id,hidden:id!=='loading',textContent:'',value:'',disabled:false,dataset:{},classList:{toggle(){}},
   addEventListener(){},querySelector(){return {disabled:false};}
  });
  return nodes.get(id);
 };
 for(const id of ['loading','login','devGate','unavailable','app','devForm','devError','devKey','leaveDev','retry','ping','response','accountLabel'])node(id);
 const tabs=['summary','contacts'].map(page=>({...node('tab-'+page),dataset:{page}}));
 const views=['summary','contacts'].map(id=>({...node('view-'+id),id}));
 const document={
  currentScript:{src:'https://zvm.onrender.com/dev/cloud/app.js'},
  getElementById:node,
  querySelectorAll:selector=>selector==='.tabs button'?tabs:selector==='.view'?views:[]
 };
 const fetch=async url=>{
  calls.push(url);
  if(failed)throw Error('network_error');
  return {ok:true,json:async()=>status};
 };
 const context={document,window:{dispatchEvent:event=>events.push(event.type)},fetch,URL,
  Event:class Event{constructor(type){this.type=type;}},console};
 vm.runInNewContext(code,context,{timeout:1000});
 return {nodes,calls,events};
}
const settled=()=>new Promise(resolve=>setImmediate(resolve));
test('R19 all Cloud shell DOM references exist and page has visible no-JS fallback',()=>{
 assert.match(html,/<section id="loading" class="panel login">/);
 assert.match(html,/href="\/dev\/cloud\/"/);
 for(const match of code.matchAll(/el\('([^']+)'\)/g))
  assert.ok(html.includes('id="'+match[1]+'"'),'Missing element: '+match[1]);
 assert.doesNotMatch(code,/el\('(name|message|saved|save|clear|preview)'\)/);
});
test('R19 unauthenticated Cloud displays login, never blank screen',async()=>{
 const r=run({loggedIn:false,persistence:true,devAuthorized:false});
 await settled();
 assert.equal(r.nodes.get('login').hidden,false);
 assert.equal(r.nodes.get('loading').hidden,true);
 assert.equal(r.calls.length,1);
 assert.equal(r.calls[0],'/dev/cloud/api/session');
});
test('R19 authenticated Cloud displays DEV challenge',async()=>{
 const r=run({loggedIn:true,persistence:true,devAuthorized:false,email:'qa@example.org'});
 await settled();
 assert.equal(r.nodes.get('devGate').hidden,false);
 assert.equal(r.nodes.get('accountLabel').textContent,'qa@example.org');
});
test('R19 authorized Cloud opens workspace and announces ready',async()=>{
 const r=run({loggedIn:true,persistence:true,devAuthorized:true,email:'qa@example.org'});
 await settled();
 assert.equal(r.nodes.get('app').hidden,false);
 assert.ok(r.events.includes('zvm-cloud-ready'));
 assert.equal(r.calls.length,1);
});
test('R19 failure displays recoverable error panel',async()=>{
 const r=run(null,true);
 await settled();
 assert.equal(r.nodes.get('unavailable').hidden,false);
});
