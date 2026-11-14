'use strict';
// R46.98: offline accessibility contract, asset authority and cleanup validation.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Module=require('node:module');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'server.js'),'utf8');
const assetNames=[
 'zvm-analytics-dashboard.95454273c23e.js',
 'zvm-analytics-lab.e6a44a6e8392.js',
 'zvm-analytics-premium.e8ce624836b1.css',
];
for(const file of assetNames){
 const content=fs.readFileSync(path.join(root,'assets',file));
 const hash=crypto.createHash('sha256').update(content).digest('hex');
 assert.equal(file.match(/\.([a-f0-9]{12})\./)[1],hash.slice(0,12),'asset fingerprint '+file);
 assert(source.includes("sha256: '"+hash+"'"),'unregistered hash '+file);
 assert(source.includes('/assets/'+file),'HTML/asset registry missing '+file);
}
for(const file of [
 'zvm-analytics-dashboard.5977bc6ce33f.js',
 'zvm-analytics-lab.889fc1e2fb48.js',
 'zvm-analytics-premium.75b34337c294.css',
]){
 assert(!source.includes(file),'old asset still referenced '+file);
 assert(!fs.existsSync(path.join(root,'assets',file)),'dead asset remains '+file);
}
const css=fs.readFileSync(path.join(root,'assets',assetNames[2]),'utf8');
assert(!css.includes('!important'),'new CSS specificity debt');
assert(css.includes('.analytics-skip:focus')&&css.includes('.analytics-visually-hidden'),'focus/readability rules missing');
assert(css.includes('@media(max-width:370px)'),'320px fallback missing');
const dashboardJs=fs.readFileSync(path.join(root,'assets',assetNames[0]),'utf8');
const labJs=fs.readFileSync(path.join(root,'assets',assetNames[1]),'utf8');
for(const key of ['ArrowLeft','ArrowRight','Home','End'])assert(labJs.includes("'"+key+"'"),'tab keyboard '+key);
assert(dashboardJs.includes('analytics-filter-status'),'payment status missing');
assert(dashboardJs.includes("setAttribute('aria-pressed'"),'toggle pressed state missing');
assert(dashboardJs.includes("setAttribute('aria-expanded'"),'laboratory disclosure state missing');
assert(dashboardJs.includes("mode!==purgeCurrentMode()"),'purge async preview guard missing');

process.env.RENDER='true';process.env.ADMIN_USER='r4698-test-admin';
process.env.ADMIN_PASS='offline-test-password';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/r4698_offline';
const load=Module._load;let api;
try{
 Module._load=function(id,...args){
  if(id==='mongodb')return{MongoClient:class OfflineMongoFixture{}};
  return load.call(this,id,...args);
 };
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=load}
(async()=>{
 const hour=[{_id:'14',count:3},{_id:'10',count:5},{_id:'18',count:1}];
 const order=hour.map(x=>x._id).join(',');
 const stats={
  total:2,uniqueClients:2,revenueTotal:149.8,revenueLast30:149.8,returningClients:0,
  retentionRate:0,last7:2,last30:2,byDay:[],byProduct:[],byHour:hour,
  byMethod:[],topClients:[],expiredKeys:0,churnedKeys:0,churnRate:0,
 };
 const html=await api.renderAnalyticsDashboard({stats,payments:[]});
 assert.equal(hour.map(x=>x._id).join(','),order,'server sort mutated payment aggregate');
 assert(html.includes('<a class="analytics-skip" href="#analytics-main">'),'missing skip link');
 assert(html.includes('<main id="analytics-main" tabindex="-1">'),'missing accessible main');
 assert(html.includes('aria-controls="lab-body" aria-expanded="false"'),'lab disclosure semantically incomplete');
 for(const id of ['lab-tab-sale','lab-tab-email','lab-sale-pane','lab-email-pane'])assert(html.includes('id="'+id+'"'),'missing '+id);
 assert(html.includes('aria-controls="lab-sale-pane"')&&html.includes('aria-labelledby="lab-tab-sale"'));
 assert(html.includes('id="analytics-filter-status" role="status" aria-live="polite"'),'no screen reader feedback');
 assert(html.includes('role="group" aria-label="Tipo de pagamento"'),'missing payment group label');
 assert(html.includes('role="group" aria-label="Periodo de pagamentos"'),'missing period group label');
 assert(html.includes('<table><caption>Vendas e receita dos ultimos 30 dias</caption>'),'chart alt table missing');
 assert((html.match(/<th scope="row">20\d\d-\d\d-\d\d<\/th>/g)||[]).length===30,'chart must contain 30 daily data rows');
 assert(html.includes('Historico de pagamentos</caption>'),'payments table unnamed');
 assert(html.includes('id="purge-dialog"')&&html.includes('id="purge-exec-btn"'),'destructive confirmation fence removed');
 assert(html.includes('id="lab-sec"')&&html.includes('id="lab-mail-send-btn"'),'lab workflow removed');
 assert(html.includes('Horário de Pico'),'peak hour UI removed');
 assert(html.includes('5 vendas neste horário'),'peak hour count incorrect');
 console.log('R46.98 PASS: assets, 30-day chart table, labels/filters, keyboard contracts, non-mutating stats, isolated purge');
})().catch(err=>{console.error(err);process.exitCode=1});
