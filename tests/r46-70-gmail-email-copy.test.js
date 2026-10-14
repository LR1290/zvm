'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),crypto=require('node:crypto');
const {buildKeyDeliveryEmail}=require('../mailer');
for(const [id,uses,tone] of [['padrao',3,'start'],['pro',5,'pro'],['empresarial',10,'enterprise']]){
 const b=buildKeyDeliveryEmail({planId:id,maxUses:uses,code:'ZV-DEMO-0000-0000',expiresAt:'2026-11-12T03:00:00Z',baseUrl:'https://zvm.onrender.com'});
 assert.equal(b.artwork?.tone,tone);
 assert(b.html.includes('data-zvm-whole-art="1"'));
 assert(!/<\s*(?:img|svg|script)\b|cid:|data:image|__ZVM_SLICE_/i.test(b.html),'no image attachments or sliced white bars');
 for(const f of ['key','plan','validity'])assert(b.html.includes('data-zvm-live="'+f+'"'));
 assert(b.html.includes('ZV-DEMO-0000-0000'));
 assert(b.html.includes('PORTAL DO CLIENTE'));
 assert(!b.html.includes('cliente?copy=1'),'no portal redirect masquerading as clipboard');
 assert(b.html.includes('Para copiar no Gmail, selecione a chave e use Copiar'),'truthful accessible copy instructions');
}
const server=fs.readFileSync('server.js','utf8');
const name='zvm-client-copy-intent.632eafe6c467.js';
const asset=fs.readFileSync('assets/'+name);
assert.equal(crypto.createHash('sha256').update(asset).digest('hex').slice(0,12),'632eafe6c467');
assert(server.includes(name),'portal copy intent maintained');
console.log('R46.73 Gmail copy semantics + one-piece original background PASS');
