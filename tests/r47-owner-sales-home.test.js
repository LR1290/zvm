'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const { renderOwnerSalesLanding } = require('../src/web/public/landing/owner');
const cssName = 'zvm-sales-owner.a610cb96b94d.css';
const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'assets',cssName))).digest('hex');
assert.equal(digest, 'a610cb96b94de78e36d8cf6241b6497c319c228c2df0ae34c219a0ef5bf4e98c');
const template = fs.readFileSync(path.join(root,'src/web/public/landing/owner-template.html'),'utf8');
const server = fs.readFileSync(path.join(root,'server.js'),'utf8');
assert(template.includes('{{ZVM_OWNER_CSS}}'), 'CSS is rendered through the canonical owner module');
assert(template.includes('{{ZVM_PUBLIC_NAV}}'), 'shared nav render point');
assert(template.includes('/assets/zvm-shared.6dac16eb7b5b.css'));
assert(template.includes('/assets/zvm-standalone.d6d2222fe00a.css'));
assert(!/<style[\s>]|<script[\s>]| onerror=| style=/.test(template), 'strict CSP compatible markup');
assert(template.includes('Pare de perder vendas') && template.includes('Cada conversa parada é uma venda'));
assert(server.includes("if (req.method === 'GET' && p === '/')"), 'public homepage remains defined');
assert(server.includes('sendPublicHtml(res, renderOwnerSalesLanding({'), 'owner HTML mounted at root');
assert(server.includes("sha256: '"+digest+"'"), 'CSS registered with digest');
assert(server.includes("salesPaused: ZVM_SALES_PAUSED"), 'server controls storefront pause');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plans={
 solo:{id:'solo',price:39.9,maxUses:1,enabled:true},
 padrao:{id:'padrao',price:59.9,maxUses:3,enabled:true},
 pro:{id:'pro',price:94.9,maxUses:5,enabled:true},
 enterprise_v2:{id:'enterprise_v2',maxUses:10,consult:true}
};
const supportUrl = 'https://wa.me/5521996771552?text=LR%20Preciso%20de%20ajuda';
const publicNavHtml='<a class="skip-link" href="#main-content">Pular</a><nav class="znav standalone-nav" aria-label="Navegação principal"><a href="/">ZVM</a><a href="/cliente">Entrar</a><a href="/privacidade">Privacidade</a></nav>';
const paused=renderOwnerSalesLanding({plans,salesPaused:true,escHtml:esc,supportUrl,publicNavHtml});
assert(!paused.includes('{{ZVM_'));
assert.match(paused, /id="aviso" role="status"><strong>Vendas temporariamente suspensas/);
assert.match(paused,/id="nota-planos">Compra indisponível/);
assert.match(paused,/class="btn ghost plan-btn" data-nome="PRO"/);
assert(!/https:\/\/pay\.cakto\.com\.br\//.test(paused), 'no bypass to payment');
assert(!paused.includes('zvm-testimonials'), 'no fabricated endorsements');
assert.equal((paused.match(/class="card plan"/g)||[]).length,4);
const live=renderOwnerSalesLanding({plans,salesPaused:false,escHtml:esc,supportUrl,publicNavHtml});
assert.match(live,/id="aviso" hidden role="status"/);
assert.match(live,/id="nota-planos" hidden/);
assert.match(live,/class="btn  plan-btn" data-nome="PRO" href="\/planos\?plano=pro">Assinar PRO<\/a>/);
const testimonials=JSON.stringify([
 {approved:false,approvalId:'REJECT_001',name:'Falso',quote:'Este texto não pode aparecer pois não foi aprovado.'},
 {approved:true,approvalId:'VALID_001',name:'Ana & Equipe',quote:'Relato aprovado de exemplo com marcação <script> que não pode executar.',role:'Empreendedora'}
]);
const approved=renderOwnerSalesLanding({plans,salesPaused:true,escHtml:esc,testimonialsJson:testimonials,supportUrl,publicNavHtml});
assert(approved.includes('Ana &amp; Equipe'));
assert(approved.includes('&lt;script&gt;'));
assert(!approved.includes('Falso'));
assert(!approved.includes('Relato aprovado de exemplo com marcação <script>'));
assert(approved.includes('href="/faq"') && approved.includes('href="/cliente"'));
assert(approved.includes('chromewebstore.google.com'));
assert(paused.includes('href="https://wa.me/5521996771552?text=LR%20Preciso%20de%20ajuda"'));
assert(paused.includes('class="znav standalone-nav"'));
assert(!paused.includes('owner-mobile-menu'));
assert(paused.includes('/assets/zvm-sales-owner.a610cb96b94d.css'));
assert(paused.includes('class="zvm-public-premium zvm-owner-landing"'));
assert.equal((paused.match(/class="znav standalone-nav"/g)||[]).length,1);
assert(paused.includes('href="/cliente"') && paused.includes('href="/privacidade"'));
assert(paused.includes('id="main-content"'));
assert(paused.includes('Ver todas as perguntas frequentes'));
assert(!paused.includes('https://wa.me/5521996771552?text=Preciso%20de%20ajuda'));
assert(!paused.includes('href="/?sec=produto"'));
console.log('ZVM owner sales home: template, server pause, canonical plans, consent-gated social proof and CSP OK');
