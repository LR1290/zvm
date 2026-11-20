'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
function measure(tree,count){
 const source=fs.readFileSync(path.join(tree,'app/shared/core/theme-system.js'),'utf8');
 const start=source.indexOf('function scheduleAutoThemeRefresh()'),end=source.indexOf('var startAutoThemeFallback',start);
 assert(start>=0 && end>start);
 let now=0, allocations=0,first=null, refreshes=0, next=0, app={}, notify;
 const timers=new Map(), observers=[];
 function advance(t){
   for(const [id,event] of timers)if(event.at<=t){now=event.at;timers.delete(id);event.fn();}
   now=t;
 }
 class Observer{constructor(){this.nodes=new Set();observers.push(this)} observe(n){this.nodes.add(n)}disconnect(){this.nodes.clear()}}
 const root={MutationObserver:Observer,document:{documentElement:{},body:{},getElementById:()=>app},__extWhatsAppStructureBroker:{subscribe:(_,fn)=>{notify=fn}}};
 const env={root,MutationObserver:Observer,_autoThemeTimer:0,refreshAutoTheme(){first??=now;refreshes++},setTimeout(fn,ms){allocations++;timers.set(++next,{at:now+ms,fn});return next},clearTimeout(id){timers.delete(id)}};
 vm.runInNewContext(source.slice(start,end),env);
 for(let i=0;i<count;i++){advance(i*10);app={};notify();}
 advance(count*10+120);
 assert.equal(timers.size,0);
 assert(observers.some(o=>o.nodes.has(root.document.body))&&observers.some(o=>o.nodes.has(app)));
 return {allocations,first,refreshes,observedTargets:observers.reduce((n,o)=>n+o.nodes.size,0)};
}
for(const [i,tree] of process.argv.slice(2).entries()){
 for(const count of [1,10,100,1000,10000]){
  const result=measure(tree,count);
  console.log(JSON.stringify({revision:['R112','R113','R114','candidate'][i],count,...result}));
  if(i){assert(result.first<=120);assert.equal(result.observedTargets,3);}
 }
}
