'use strict';
const assert=require('assert');
const fs=require('fs');
const crypto=require('crypto');
const server=fs.readFileSync('server.js','utf8');
const assets=[
  ['zvm-r46-auth.286cb26442a2.css','286cb26442a26e5ee52f0a59066aadab9d1a58db8ab11ee2c3fb2c209b776021'],
  ['zvm-r46-client-workspace.6dbf0f685e67.css','6dbf0f685e67e16999a9821bd4fab3cdf4ad3c2697a94940c22ab8b5048db92a'],
  ['zvm-r46-client-dashboard.64213392bec3.css','64213392bec3c85c01e4688e83b30f32d8e808d168e97d88a026d4d4487a5e83'],
];
for(const [file,sha] of assets){
  const body=fs.readFileSync('assets/'+file);
  assert.strictEqual(crypto.createHash('sha256').update(body).digest('hex'),sha,file+' sha');
  assert(server.includes('/assets/'+file),file+' registry');
  assert.strictEqual(sha.slice(0,12),file.match(/\.([0-9a-f]{12})\.css$/)[1],file+' content address');
}
for(const old of ['zvm-auth.bac89a57e419.css','zvm-client-workspace.5c15da462a9b.css','zvm-client-dashboard.0069cdb7515f.css']) assert(!server.includes(old),old+' removed');
const auth=fs.readFileSync('assets/zvm-r46-auth.286cb26442a2.css','utf8');
const workspace=fs.readFileSync('assets/zvm-r46-client-workspace.6dbf0f685e67.css','utf8');
const dashboard=fs.readFileSync('assets/zvm-r46-client-dashboard.64213392bec3.css','utf8');
for(const css of [auth,workspace,dashboard]){
  for(const token of ['prefers-reduced-motion','focus-visible']) assert(css.includes(token),token);
  assert(/system-ui/.test(css),'system font stack');
}
assert(auth.includes('min-height:52px'),'auth controls comfortable');
assert(workspace.includes('min-height:44px'),'workspace controls comfortable');
assert(dashboard.includes('min-height:44px'),'dashboard controls comfortable');
for(const txt of ['Gerencie sua ZVM <em>sem complicação.</em>','Crie sua conta <em>ZVM.</em>','Licença, dispositivos, pagamentos e segurança em um só lugar.']) assert(server.includes(txt),txt);
assert(server.includes('class="portal-skip"'),'portal skip link');
assert(server.includes('id="main-content" class="client-main"'),'portal main target');
assert(server.includes('/cliente/planos'),'internal portal plans route');
assert(server.includes('Disponível na Chrome Web Store'),'Chrome Web Store badge PT-BR');
assert(server.includes('ZVM - Automações</strong><span>Extensão oficial'),'Chrome Web Store badge names product');
assert(server.includes('Chrome Web Store'),'Chrome Web Store official CTA');
assert(server.includes("renderClientPortalRail('overview')"),'overview uses shared portal rail');
assert(server.includes("renderClientPortalRail('plans')"),'plans use shared portal rail');
assert(dashboard.includes('max-width:none!important'),'portal rail no centered max-width shell');
assert(dashboard.includes('height:100dvh'),'portal app viewport shell');
assert(server.includes('client-plans-public-style'),'internal portal plans use public /planos visual structure');
assert(server.includes('class="pricing-grid" aria-label="Planos ZVM"'),'internal plans use canonical pricing-grid');
assert(server.includes('Compra vinculada à conta'),'checkout modal shows buyer identity only when needed');
assert(server.includes('data-buy-plan'),'internal plans preserve checkout confirmation flow');
assert(dashboard.includes('.client-nav-icon svg'),'vector portal nav icons');
assert(dashboard.includes('.client-tool-icon svg'),'vector portal tool icons');
// Existing backend contracts must remain exactly wired.
for(const route of ['/cliente/login','/cliente/registro','/cliente/2fa/verificar','/cliente/vincular','/cliente/senha','/cliente/email','/cliente/dispositivos/remover']) assert(server.includes(route),route);
for(const field of ['name="email"','name="pass"','name="pass2"','name="code"','name="keycode"']) assert(server.includes(field),field);
// Auth/portal visual surfaces no longer need Google Fonts.
const portalBlock=server.slice(server.indexOf('function renderPortalPage'),server.indexOf('// ──────────── fim portal do cliente'));
assert(!portalBlock.includes('${_GFONTS}'),'portal/auth does not load Google Fonts');
assert(auth.includes('outline:none!important'),'auth field focus avoids double outline');
assert(dashboard.includes('background:linear-gradient(135deg,#171c1a'),'Chrome Store banner is neutral gray/dark');
console.log('R46.15 auth + client portal contract: PASS');
