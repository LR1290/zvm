'use strict';
// R46.99: guest purchase requires no ZVM login; only provider accepts payment.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),src=fs.readFileSync(path.join(root,'server.js'),'utf8');
process.env.ZVM_SALES_PAUSED='0';process.env.RENDER='true';
process.env.ADMIN_USER='r4699-guest-qa';process.env.ADMIN_PASS='qa-only-dummy';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/zvm_r4699_guest_fixture';
let api;const original=Module._load;
try{
 Module._load=function(id,...rest){if(id==='mongodb')return {MongoClient:class MockMongo{}};return original.call(this,id,...rest)};
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=original}
const user={name:'Fictitious Buyer',email:'qa@example.invalid',keyCode:'zv-fixture-key'};
const guest=api.renderPlanosPage(null),member=api.renderPlanosPage(user),home=api.renderStandaloneLandingPage(null);
assert(guest.includes('data-buy-plan="solo"')&&guest.includes('data-buy-plan="padrao"'),'guest plans must have buy buttons');
assert(!guest.includes('data-login-plan=')&&!guest.includes('Entre para comprar')&&!guest.includes('Faça login antes de comprar'),'mandatory login must be gone');
assert(guest.includes('data-checkout="https://pay.cakto.com.br/'),'guest checkout must link to official provider');
assert(guest.includes('Não precisa criar conta para comprar')&&guest.includes('/cliente/vincular'),'guest key linking guidance missing');
assert(guest.includes('class="checkout-dialog"'),'guest checkout confirmation modal required');
assert(guest.includes('Continuar para pagamento'),'guest continue action missing');
assert(!guest.includes('sales-paused-alert'),'guest commerce unexpectedly paused');
assert(member.includes('class="buyer-box"'),'member identity confirmation missing');
assert(member.includes('qa@example.invalid'),'member email missing');
assert(member.includes('data-buy-plan="solo"'),'member checkout blocked');
assert(member.includes('sck=')||member.includes('data-checkout="https://pay.cakto.com.br/'),'member checkout not rendered');
assert(!home.includes('r466-sales-paused"'),'home pause banner should be absent');
assert(home.includes('/assets/zvm-sales-state.1422fd551ff5.css'),'sales notice stylesheet missing');
assert(src.includes("if (p === '/cakto/webhook' && req.method === 'POST')"),'production fulfillment callback removed');
const scriptName='zvm-plans.3d82262649b9.js';
const script=fs.readFileSync(path.join(root,'assets',scriptName));
const digest=crypto.createHash('sha256').update(script).digest('hex');
assert.equal(digest,'3d82262649b9e75c7943b07f6f39088f66810346fdd142023afd3cbe8b9bccad');
assert(src.includes("sha256: '"+digest+"'"));
assert(!script.toString().includes('data-login-plan'),'obsolete login gate remains in checkout handler');
assert(api.renderStandaloneFaqPage(null).includes('Não. Quando as vendas estiverem abertas'),'public guidance should match guest checkout');
console.log('R46.99 GUEST PASS: 4 enabled plans, direct Cakto links, account linking notice, member binding, no old login gate');
