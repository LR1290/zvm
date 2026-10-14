'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {buildKeyDeliveryEmail}=require('../mailer');
for(const [planId,maxUses,tone] of [['padrao',3,'start'],['pro',5,'pro'],['empresarial',10,'enterprise']]){
 const built=buildKeyDeliveryEmail({planId,maxUses,code:'ZV-DEMO-0000-0000',expiresAt:'2026-11-12T03:00:00Z',baseUrl:'https://zvm.onrender.com',ctaPath:'/cliente'});
 assert.equal(built.artwork?.tone,tone);
 assert.equal(built.artwork?.native,true);
 assert(!/<\s*(?:img|svg|script)\b|cid:|data:image|__ZVM_SLICE_/.test(built.html));
 for(const field of ['key','plan','validity'])assert(built.html.includes('data-zvm-live="'+field+'"'));
 assert(built.html.includes('ZV-DEMO-0000-0000'),'key directly selectable from Gmail');
 assert(built.html.includes('TOQUE E SEGURE A CHAVE ACIMA'),'do not claim that Gmail can copy via JS');
 assert(built.html.includes('PORTAL DO CLIENTE'),'clearly label genuine navigational CTA');
 assert(!built.html.includes('COPIAR CHAVE</a>'),'no deceptive copy-action hyperlink');
 assert(!built.html.includes('cliente?copy=1'),'no portal redirect disguised as an inbox copy');
 assert(!built.html.includes('<img'),'no previous image band can cause Gmail Android white gaps');
}
const source=fs.readFileSync('server.js','utf8');
const name='zvm-client-copy-intent.632eafe6c467.js';
const asset=fs.readFileSync('assets/'+name);
assert.equal(crypto.createHash('sha256').update(asset).digest('hex').slice(0,12),'632eafe6c467');
assert(source.includes(name),'existing authenticated portal copy behavior preserved');
console.log('R46.72 Gmail no-images, honest copy semantics and portal copy regression PASS');
