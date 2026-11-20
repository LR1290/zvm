'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const root=process.env.ZVM_LAB_SOURCE;
function code(rel){return fs.readFileSync(path.join(root,rel),'utf8')}
test('native rail command-state hang fails closed and is rate-limited in logs',async()=>{
 const codeText=code('app/sidebar/native-whatsapp-rail.js');
 const body=codeText.slice(codeText.indexOf('var railStateTimeoutReported='),codeText.indexOf('function refreshStates()'));
 const reports=[];
 const ctx={Object,Promise,Date,Error,clearTimeout,setTimeout:(fn)=>setTimeout(fn,8),report:(...a)=>reports.push(a)};
 vm.createContext(ctx);vm.runInContext(body,ctx,{timeout:1500});
 const bus={state:()=>new Promise(()=>{})};
 const a=await ctx.boundedRailState(bus,'flow.open');
 assert.equal(a.registered,true);assert.equal(a.enabled,false);
 const b=await ctx.boundedRailState(bus,'flow.open');
 assert.equal(b.enabled,false);assert.equal(reports.length,1);
 assert.equal(reports[0][0],'NATIVE_WA_RAIL_STATE_TIMEOUT');
});
test('sidebar state hang exits deadline and records exactly one timeout',async()=>{
 const source=code('app/sidebar/lifecycle.js');
 const body=source.slice(source.indexOf('var sidebarStateTimeoutReported='),source.indexOf('async function readCommandStates('));
 const reports=[];const ctx={Object,Promise,Date,Error,clearTimeout,setTimeout:(fn)=>setTimeout(fn,8),
  root:{ExtensionUI:{commands:{state:()=>new Promise(()=>{})}},__extReportRuntimeError:(...a)=>reports.push(a)}};
 vm.createContext(ctx);vm.runInContext(body,ctx,{timeout:1500});
 for(let i=0;i<2;i++)await assert.rejects(()=>ctx.boundedSidebarState('broadcast.open'),x=>x.code==='COMMAND_STATE_TIMEOUT');
 assert.equal(reports.length,1);assert.equal(reports[0][0],'SIDEBAR_COMMAND_STATE_TIMEOUT');
});
test('native event storms are throttled and stale results no longer discarded',()=>{
 const s=code('app/sidebar/native-whatsapp-rail.js');
 assert.match(s,/refreshMinIntervalMs=250/);
 assert.match(s,/requestStateRefresh\(80\)/);
 assert.doesNotMatch(s,/generation!==refreshGeneration\|\|refreshPending\|\|!host\.isConnected/);
 assert.match(s,/if\(refreshPending\)\{refreshPending=false;requestStateRefresh\(0\);\}/);
});
test('popup observer targets popup, not entire WhatsApp document subtree',()=>{
 const s=code('app/sidebar/lifecycle.js');
 assert.match(s,/observer\.observe\(node,\{childList:true,subtree:true,attributes:true/);
 assert.match(s,/observer\.observe\(popupAncestor,\{childList:true,attributes:true/);
 assert.doesNotMatch(s,/observer\.observe\(document\.body\|\|document\.documentElement,\{childList:true,subtree:true,attributes:true/);
});
test('broker ignores ZVM-owned UI before scanning descendants',()=>{
 const s=code('app/content/core/whatsapp-structure-broker.js');
 const start=s.indexOf('function scanNode(node,removed)');
 const own=s.indexOf('if(isOwned(node))return;',start);
 const relevant=s.indexOf('var relevant=false;',start);
 assert(own>start&&relevant>own);
});
test('official extension name and QA-only origin retained after optimization',()=>{
 const m=JSON.parse(code('manifest.json'));
 assert.equal(m.name,'ZVM Automações');
 assert.equal(m.version,'0.9.305');
 assert.match(m.version_name,/R112-DEEP-FORENSIC-PERF/);
 assert(m.host_permissions.includes('https://zvm-completa-qa-r104.onrender.com/*'));
 assert(!m.host_permissions.includes('https://zvm.onrender.com/*'));
 const files=[...new Set(m.content_scripts.flatMap(x=>x.js||[]))];
 for(const f of files)assert(fs.existsSync(path.join(root,f)),f);
 assert.equal(files.length,86);
});
