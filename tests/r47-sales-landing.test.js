'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { renderSalesPage, readApprovedTestimonials, campaignDeadline } = require('../src/web/public/landing/sales');
const ROOT = path.join(__dirname, '..');
const cssFile = 'zvm-sales-landing.66445dac266a.css';
const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'assets', cssFile))).digest('hex');
assert.equal(digest, '66445dac266a5c8c834bea47614692e59b1f57ac75c79c116437f47ef3928067');
const server = fs.readFileSync(path.join(ROOT,'server.js'),'utf8');
assert(server.includes("'/assets/" + cssFile + "'"), 'CSS is registered in the static allowlist');
assert(server.includes("if (p === '/vendas' && req.method === 'GET')"), 'public route is mounted');
assert(server.includes("salesPaused: ZVM_SALES_PAUSED"), 'commercial pause is preserved');
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const plans = {
  solo:{ id:'solo',shortName:'SOLO',price:39.9,maxUses:1 },
  padrao:{ id:'padrao',shortName:'START',price:59.9,maxUses:3 },
  pro:{ id:'pro',shortName:'PRO',price:94.9,maxUses:5 },
  enterprise_v2:{ id:'enterprise_v2',consult:true,maxUses:10 }
};
const fixture = {escHtml, favicon:'/favicon.svg',sharedCssLink:'',cssUrl:'/assets/' + cssFile,publicNav:()=>'<nav>Site ZVM</nav>',plans};
const paused = renderSalesPage({...fixture,salesPaused:true,campaignEndAt:'2099-11-15T18:00:00Z'});
assert.match(paused,/Seu dia não precisa estar/);
assert.match(paused,/Vendas temporariamente pausadas/);
assert.equal((paused.match(/class="zvs-plan"/g)||[]).length,3);
for(const id of ['solo','padrao','pro']) assert(paused.includes('/planos?plano='+id));
assert(!paused.includes('https://pay.cakto.com.br/'), 'no direct Cakto checkout on landing');
assert(!paused.includes('Condição comercial com prazo definido'), 'no urgency during pause');
assert(!paused.includes('zvs-testimonials'), 'no invented social proof');
assert.match(paused,/A extensão ZVM é voltada ao WhatsApp Web/);
assert.match(paused,/Nenhuma ferramenta pode garantir ausência de bloqueios/);
const invalid = readApprovedTestimonials(JSON.stringify([{approved:false,name:'Falso',quote:'Depoimento fictício com vinte caracteres',approvalId:'ABC123456'}]));
assert.equal(invalid.length,0,'unapproved testimony filtered');
const valid = readApprovedTestimonials(JSON.stringify([{approved:true,name:'Cliente & Equipe',quote:'Um relato autorizado de atendimento organizado e prático.',approvalId:'CONSENTID_2026',role:'Empresário'}]));
assert.equal(valid.length,1);
const live = renderSalesPage({...fixture,salesPaused:false,testimonialsJson:JSON.stringify([{approved:true,name:'Cliente & Equipe',quote:'Um relato autorizado de atendimento organizado e prático.',approvalId:'CONSENTID_2026',role:'Empresário'}])});
assert(live.includes('Cliente &amp; Equipe'));
assert(live.includes('O que clientes contam sobre a ZVM'));
assert(!live.includes('Vendas temporariamente pausadas'));
assert.match(live,/Escolher meu plano/);
assert.equal(campaignDeadline('2026-11-16T22:00:00Z',false,Date.parse('2026-11-15T12:00:00Z')).length>0,true);
assert.equal(campaignDeadline('2026-11-16T22:00:00Z',true,Date.parse('2026-11-15T12:00:00Z')),'');
assert.equal(campaignDeadline('2026-11-10T22:00:00Z',false,Date.parse('2026-11-15T12:00:00Z')),'');
assert(!/!important/.test(fs.readFileSync(path.join(ROOT,'assets',cssFile),'utf8')), 'no CSS specificity hacks');
console.log('Sales landing QA: approved testimonials, no fabricated urgency, responsive asset, plan routing and pause passed.');
