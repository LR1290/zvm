'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const srv=fs.readFileSync('server.js','utf8');
function asset(prefix, ext){const found=fs.readdirSync('assets').filter(x=>new RegExp('^'+prefix+'\\.[a-f0-9]{12}\\.'+ext+'$').test(x));if(prefix==='zvm-analytics-dashboard'&&ext==='js'){
  // Previously served version remains valid for cached HTML. Assert the one
  // active JS actually linked from the current Analytics page instead.
  const active=found.filter(x=>srv.includes('src="/assets/'+x+'" defer'));
  assert.equal(active.length,1,'exactly one active Analytics JS in generated HTML');
  return active[0];
 }
 assert.equal(found.length,1,`exactly one ${prefix}.${ext}`);return found[0];}
const system=fs.readFileSync('assets/'+asset('zvm-r46-system','css'),'utf8');
const analytics=fs.readFileSync('assets/'+asset('zvm-analytics-dashboard','css'),'utf8');
const js=fs.readFileSync('assets/'+asset('zvm-analytics-dashboard','js'),'utf8');
const animateSelector=system.match(/([^{}]+)\{transform-origin:center;animation:zvmIconFloat/);
assert(animateSelector,'shared icon animation declaration found');
assert(!animateSelector[1].includes('.analytics-nav a'),'never animate whole Analytics navigation links');
const navHover=analytics.match(/\.analytics-nav a:hover,\.analytics-nav a\.active\{([^}]*)\}/);
assert(navHover,'Analytics navigation hover rule found');
assert(!/transform\s*:\s*translateX/.test(navHover[1]),'navigation must not shift horizontally');
assert.match(js,/preventDefault\(\)/,'click handler stops fragment navigation');
assert.match(js,/scrollIntoView\(/,'navigation still scrolls to section');
assert.match(js,/history\.replaceState\(/,'recognized old hashes are removed without reloading or changing route');
assert.match(js,/aria-current/,'current section is announced to accessibility APIs');
for(const id of ['overview','performance','customers','payments'])assert(srv.includes('href="#'+id+'"'),'preserve keyboard-accessible anchor '+id);
for(const f of ['zvm-r46-system','zvm-analytics-dashboard'])for(const ext of ['css',...(f==='zvm-analytics-dashboard'?['js']:[])]){
 const name=asset(f,ext);const sha=crypto.createHash('sha256').update(fs.readFileSync('assets/'+name)).digest('hex');
 assert.equal(name.match(/\.([a-f0-9]{12})\./)[1],sha.slice(0,12));assert(srv.includes(name));assert(srv.includes("sha256: '"+sha+"'"));
}
// Execute just the navigation controller with a mock legacy fragment (no real account/session).
const vm=require('node:vm');
const handlers={};
const links=['overview','performance','customers','payments'].map(id=>({
 getAttribute:key=>key==='href'?'#'+id:null,
 setAttribute:(key,value)=>{if(key==='aria-current')handlers['current-'+id]=value;},
 removeAttribute:key=>{if(key==='aria-current')delete handlers['current-'+id];},
 classList:{toggle:()=>{}},
 addEventListener:(ev,fn)=>{handlers[id+'-'+ev]=fn;}
}));
const sections=new Map(['overview','performance','customers','payments'].map(id=>[id,{
 scrollIntoView:()=>{handlers['scroll-'+id]=(handlers['scroll-'+id]||0)+1;},
 getBoundingClientRect:()=>({top:100,bottom:240})
}]));
const win={location:{hash:'#performance',pathname:'/private-analytics',search:'?view=mine'},history:{state:{hello:'world'},replaceState:(state,unused,url)=>{handlers.legacyUrl=url;}},matchMedia:()=>({matches:true}),innerHeight:800};
const navStart=js.indexOf('// R46.30:');
const navEnd=js.indexOf('// Sync assistive status',navStart);
assert(navStart>=0&&navEnd>navStart,'Analytics navigation controller isolated from later delegated handlers');
vm.runInNewContext(js.slice(navStart,navEnd),{
 document:{querySelectorAll:()=>links,getElementById:id=>sections.get(id)},window:win,Map
});
assert.equal(handlers.legacyUrl,'/private-analytics?view=mine','clean only legacy fragment; preserve URL and query');
let prevented=false;
handlers['payments-click']({preventDefault:()=>{prevented=true;}});
assert(prevented,'prevent browser fragment navigation');
assert.equal(handlers['scroll-payments'],1,'target section still reached');
assert.equal(handlers['current-payments'],'location','active selection announced');

console.log('R46.30 Analytics navigation regression PASS');
