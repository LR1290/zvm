'use strict';
// R47.03: customer-facing pause clarity, keyboard semantics, no payment behavior changes.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'server.js'),'utf8');
process.env.ZVM_SALES_PAUSED='1';
process.env.RENDER='true';
process.env.ADMIN_USER='r4703-admin-qa';
process.env.ADMIN_PASS='r4703-offline-only';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/zvm_r4703_qa';
const saved=Module._load;
let api;
try{
 Module._load=function(id,...args){
  if(id==='mongodb')return{MongoClient:class OfflineMongo{}};
  return saved.call(this,id,...args);
 };
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=saved}
const user={name:'Pessoa QA',_id:'qa@example.invalid',email:'qa@example.invalid',verified:true};
const expired={
 label:'Chave teste',code:'qa-zvm-r4703',planId:'solo',active:false,
 maxUses:3,phones:['551100000001'],createdAt:'2026-01-01T00:00:00.000Z',
 expiresAt:'2026-02-01T00:00:00.000Z'
};
const portal=api.renderPortalDashboard(user,expired,'Operação validada','');
assert.match(portal,/<a href="\/cliente" class="active" aria-current="page">/,'dashboard active location is not announced');
assert.match(portal,/<a href="\/cliente\/planos" class="">/,'inactive link incorrectly marked');
assert.equal((portal.match(/aria-current="page"/g)||[]).length,1,'only active portal link should be current');
assert.match(portal,/Vendas e renovações temporariamente suspensas\./,'expiry banner hides sales pause');
assert.match(portal,/class="expiry-alert-cta">Consultar planos<\/a>/,'expired license falsely promises instant renewal');
assert.doesNotMatch(portal,/class="expiry-alert-cta">Renovar agora<\/a>/,'paused renewal CTA leaked');
assert.doesNotMatch(portal,/>Renovar \/ mudar plano<\/a>/,'account card incorrectly advertises a paused sale');
assert.match(portal,/class="client-ok-banner" role="status" aria-live="polite"/,'success feedback inaccessible');
const plans=api.renderPortalPlans(user,expired);
assert.match(plans,/<a href="\/cliente\/planos" class="active" aria-current="page">/,'plans link not announced as current');
assert.match(plans,/Vendas e renovações temporariamente suspensas\./);
assert.doesNotMatch(plans,/data-buy-plan=/,'disabled sales must not expose checkout');
assert.doesNotMatch(plans,/https:\/\/pay\.cakto\.com\.br\//,'payment link exposed while paused');
const admin=api.renderAdminDashboard({keysSnapshot:{'qa-zvm-r4703':expired},portalUsers:[],portalUserCount:0});
assert.match(admin,/<button type="button" id="hdr-suspect-badge"/,'suspect filter must be keyboard operable');
assert.match(admin,/id="hdr-suspect-badge"[^>]*onclick="[^"]*filterKeys\(\)/,'filter action disconnected');
assert.doesNotMatch(admin,/<span id="hdr-suspect-badge"/,'non-focusable suspect filter returned');
assert(src.includes("if (p === '/cakto/webhook' && req.method === 'POST')"),'previous paid order delivery hook missing');
console.log('R47.03 PASS: paused renewal clarity, active portal navigation, accessible Admin filter and existing payment protections');
