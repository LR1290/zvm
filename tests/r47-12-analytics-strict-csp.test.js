'use strict';
// R47.12 security regression, synthetic Analytics only; no provider calls or live data changes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const Module=require('node:module'),root=path.resolve(__dirname,'..');
process.env.RENDER='true';process.env.NODE_ENV='test';
process.env.ADMIN_USER='qa-admin-only';process.env.ADMIN_PASS='qa-password-only';
process.env.MONGODB_URI='mongodb://127.0.0.1:1/qa';
const original=Module._load;let api;
try{
 Module._load=function(id,...args){if(id==='mongodb')return{MongoClient:class FakeMongo{}};return original.call(this,id,...args)};
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=original;}
assert.equal(typeof api.renderAnalyticsDashboard,'function');
const stats=new Proxy({byDay:[],byProduct:[],byHour:[],byMethod:[],topClients:[],uniqueClients:0,returningClients:0},
 {get(target,key){return Object.prototype.hasOwnProperty.call(target,key)?target[key]:0;}});
const injected='" onmouseover="window.analyticsXss=true';
const fake={clientName:injected,clientEmail:'qa@example.test',productName:'ZVM QA',
 keyCode:'zv-qa',amount:0,approved:true,testMode:true,paidAt:'2026-11-15T10:00:00.000Z',tracking:{}};
(async()=>{
 const html=await api.renderAnalyticsDashboard({stats,payments:[fake]});
 assert(html.includes('data-zvm-analytics-click='),'static analytics delegated events');
 assert(html.includes('data-zvm-analytics-dynamic="purgeOpen"'),'action hub migrated');
 assert.equal((html.match(/\son(?:click|change|input|keydown|submit)=/g)||[]).length,0,'no inline Analytics events');
 assert(!/<script\b(?![^>]*\bsrc=)[^>]*>/.test(html),'no inline Analytics scripts');
 assert(!html.includes('onmouseover="window.analyticsXss=true"'),'customer name cannot inject handler');
 const filename=(html.match(/<script src="\/assets\/(zvm-analytics-dashboard\.[a-f0-9]{12}\.js)" defer><\/script>/)||[])[1];
 assert(filename,'versioned Analytics script');
 const code=fs.readFileSync(path.join(root,'assets',filename),'utf8');
 const digest=crypto.createHash('sha256').update(code).digest('hex');
 assert(filename.includes(digest.slice(0,12)),'filename content hash');
 new vm.Script(code);
 assert(code.includes('const _zvmAnalyticsActions=Object.freeze('),'fixed analytics action map');
 assert(code.includes('data-zvm-analytics-dynamic="labExecute"'),'lab action externalized');
 assert(!code.includes('onclick="labExecute()"'));
 const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
 assert(server.includes('isAdminPage || isAnalyticsPage'),'privileged CSP covers Analytics');
 assert(server.includes('script-src \x27self\x27; style-src \x27self\x27 \x27unsafe-inline\x27'));
 console.log('R47.12 PASS: Analytics fully delegated events, zero inline scripts, no stored XSS, strict script-src');
})().catch(error=>{console.error(error);process.exitCode=1});
