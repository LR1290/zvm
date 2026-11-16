'use strict';
// R47.07 Admin keys: read-only fixtures. Never touch production sessions or licenses.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'server.js'),'utf8');
const jsPath=(source.match(/<script src="\/assets\/(zvm-admin-dashboard\.[a-f0-9]{12}\.js)" defer><\/script>/)||[])[1];
const cssPath=(source.match(/<link rel="stylesheet" href="\/assets\/(zvm-admin-dashboard\.[a-f0-9]{12}\.css)">/)||[])[1];
assert(jsPath&&cssPath,'active Admin assets need immutable fingerprint');
for(const file of [jsPath,cssPath]){
 const bytes=fs.readFileSync(path.join(root,'assets',file));
 const digest=crypto.createHash('sha256').update(bytes).digest('hex');
 assert(file.includes(digest.slice(0,12)),'asset filename digest');
 assert(source.includes("sha256: '"+digest+"'"),'asset allowlist must pin digest');
}
const js=fs.readFileSync(path.join(root,'assets',jsPath),'utf8');
const css=fs.readFileSync(path.join(root,'assets',cssPath),'utf8');
new vm.Script(js,{filename:jsPath});
assert(js.includes("row.cells[6]"),'IP search must use the correct column');
assert(js.includes("function toggleKeyDetails("),'mobile details disclosure');
assert(js.includes("editUsesUnlimited"),'explicit unlimited checkbox');
assert(js.includes("mode==='date'")&&js.includes("mode==='never'"),'validity modes');
assert(css.includes('.keys-table tbody tr.key-record'),'mobile key cards');
assert(css.includes('.keys-table tbody tr.key-record.key-expanded'),'expandable details');
assert(!css.slice(css.indexOf('R47.07:')).includes('!important'),'new CSS has no !important');
assert(source.includes('class="keys-table"')&&source.includes('class="key-record"'),'responsive HTML');
assert(source.includes('class="key-actions-more"'),'collapsible secondary actions');
assert(source.includes('data-field="Último IP"'),'IP field preserved');
assert(source.includes('data-phones-count='),'linked devices summary');
assert(source.includes("max_uses_below_linked_devices"),'protect enrolled devices on reduction');
assert(source.includes('Number.isSafeInteger(maxUses)'),'reject fractions and invalid max uses');
assert(source.includes('draft.expireDuration=null'),'remove deferred expiry when setting validity');
process.env.RENDER='true';
process.env.ADMIN_USER='qa-admin';
process.env.ADMIN_PASS='qa-password-not-live';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/qa';
const original=Module._load;
let api;
try{
 Module._load=function(id,...args){if(id==='mongodb')return{MongoClient:class OfflineMongo{}};return original.call(this,id,...args)};
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=original;}
const now=Date.parse('2026-11-16T00:00:00.000Z');
assert.equal(api.parseAdminValidityChange({mode:'never'},now).expiresAt,null);
assert.equal(api.parseAdminValidityChange({mode:'date',expiresAt:'2026-11-18T00:00:00.000Z'},now).ok,true);
assert.equal(api.parseAdminValidityChange({mode:'date',expiresAt:'2026-11-15T00:00:00.000Z'},now).ok,false);
assert.equal(api.parseAdminValidityChange({mode:'date',expiresAt:'2026-02-30T00:00:00.000Z'},now).ok,false);
assert.equal(api.parseAdminValidityChange({mode:'never',expiresAt:'wrong'},now).ok,false);
const sample={label:'Conta fictícia',active:true,phones:['5511999887766'],createdAt:'2026-11-01T00:00:00.000Z',maxUses:-1,expiresAt:null,expireDuration:null};
const html=api.renderAdminDashboard({keysSnapshot:{'zv-qa-license':sample},portalUsers:[],portalUserCount:0});
assert(html.includes('aria-label="Licenças ZVM"'));
assert(html.includes('class="key-mobile-details" aria-expanded="false"'));
assert(html.includes('data-phones-count="1"'));
assert(html.includes('id="renewMode"'));
assert(html.includes('id="editUsesUnlimited"'));
assert(html.includes('Sem expiração (ilimitado)'));
const begin=source.indexOf("  const codeValidity = extractCode(");
const end=source.indexOf("  const codeLabel = extractCode(",begin);
assert(begin>0&&end>begin,'isolated key-edit route');
const execute=new Function('req','res','deps','with(deps){return (async function(){'+source.slice(begin,end)+'})();}');
const state=new Map([['qa',{label:'Fictício',active:true,phones:['111','222'],maxUses:3,expiresAt:'2026-12-30T00:00:00.000Z',expireDuration:86400000}]]);
let writes=0;
const deps={
 R_ADMIN:'/qa-admin',RA:'/qa-admin',p:'',
 parseAdminValidityChange:api.parseAdminValidityChange,
 extractCode:re=>(deps.p.match(re)||[])[1]||null,
 isAdminSession:req=>req.auth!==false,
 parseBody:async req=>req.body,
 adminGetKey:async code=>state.get(code)||null,
 mutateAdminKeyRecordStrict:async(code,mutator)=>{
  const current=state.get(code);if(!current)return null;
  const draft={...current,phones:[...current.phones]};mutator(draft);
  state.set(code,draft);writes++;return draft;
 },
 sendJson:(res,body,status=200)=>{res.reply={status,body}},
 sendAdminKeyPersistFailure:(res,error)=>{res.reply={status:503,body:{error:error.code||'db_unavailable'}}},
 addAdminAuditLog:()=>Promise.resolve()
};
async function post(route,body,auth=true){
 deps.p='/qa-admin/api/keys/qa/'+route;
 const res={};await execute({method:'POST',body,auth},res,deps);
 return res.reply;
}
(async()=>{
 let before=writes;assert.equal((await post('max-uses',{maxUses:1})).status,409);assert.equal(writes,before);
 assert.equal((await post('max-uses',{maxUses:-1})).status,200);assert.equal(state.get('qa').maxUses,-1);
 for(const invalid of [0,2.4,'2bad',10001]){before=writes;assert.equal((await post('max-uses',{maxUses:invalid})).status,400);assert.equal(writes,before)}
 assert.equal((await post('max-uses',{maxUses:2})).status,200);
 const expiry=new Date(Date.now()+2*86400000).toISOString();
 assert.equal((await post('validity',{mode:'date',expiresAt:expiry})).status,200);
 assert.equal(state.get('qa').expiresAt,expiry);assert.equal(state.get('qa').expireDuration,null);
 assert.equal((await post('validity',{mode:'never'})).status,200);
 assert.equal(state.get('qa').expiresAt,null);
 before=writes;assert.equal((await post('validity',{mode:'date',expiresAt:'2020-01-01T00:00:00.000Z'})).status,400);assert.equal(writes,before);
 assert.equal((await post('validity',{mode:'never'},false)).status,401);
 console.log('R47.07 PASS: assets, display, parser, 11 operation scenarios, no production writes');
})().catch(e=>{console.error(e);process.exitCode=1});
