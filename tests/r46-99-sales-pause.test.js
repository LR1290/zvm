'use strict';
// R46.99: sales paused, no public checkout, but Cakto fulfillment remains operational.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),src=fs.readFileSync(path.join(root,'server.js'),'utf8');
process.env.ZVM_SALES_PAUSED='1';process.env.RENDER='true';
process.env.ADMIN_USER='r4699-pause-qa';process.env.ADMIN_PASS='qa-dummy-only';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/zvm_r4699_pause_fixture';
let api;const load=Module._load;
try{
 Module._load=function(id,...rest){if(id==='mongodb')return{MongoClient:class MockMongo{}};return load.call(this,id,...rest)};
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=load}
const user={email:'buyer@example.invalid',name:'QA Buyer',keyCode:'zv-test-key'};
const pages=[
 ['home',api.renderStandaloneLandingPage(null)],
 ['guest-plans',api.renderPlanosPage(null)],
 ['member-plans',api.renderPlanosPage(user)],
 ['portal-renewal',api.renderPortalPlans(user,{planId:'solo',maxUses:1,expiresAt:'2030-01-01T00:00:00.000Z'})],
];
for(const [name,html] of pages){
 assert(html.includes('temporariamente'),'missing pause notice on '+name);
 assert(!html.includes('data-buy-plan='),'active checkout leaked on '+name);
 assert(!html.includes('data-checkout='),'checkout URL leaked on '+name);
 assert(!html.includes('https://pay.cakto.com.br/'),'provider checkout leaked on '+name);
}
assert(!pages[1][1].includes('data-login-plan='),'old login gate still rendered');
assert(!pages[1][1].includes('class="checkout-dialog"'),'blocked modal must not be created on public plans');
assert(!pages[3][1].includes('Renovar meu contrato atual</a>'),'historic renewal link must be paused');
assert(src.includes("if (p === '/cakto/webhook' && req.method === 'POST')"),'existing paid events and delivery must continue');
assert(!src.includes('if (ZVM_SALES_PAUSED) await handleCaktoWebhook'),'pause must not reject previously paid callbacks');
const file='zvm-sales-state.1422fd551ff5.css';
const css=fs.readFileSync(path.join(root,'assets',file));
const digest=crypto.createHash('sha256').update(css).digest('hex');
assert.equal(digest,'1422fd551ff5c1548fc1f7641a22263662755331d928eaaa0ff29f25f30931f9');
assert(src.includes("sha256: '"+digest+"'"));
assert(!css.toString().includes('!important'),'avoid new CSS specificity debt');
console.log('R46.99 PAUSE PASS: 4 routes, no checkout links, no login gate, webhook delivery preserved, valid CSS digest');
