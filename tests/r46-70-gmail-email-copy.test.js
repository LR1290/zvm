'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {buildKeyDeliveryEmail}=require('../mailer');
for(const [planId,maxUses,tone,color] of [
 ['padrao',3,'start','#000802'],
 ['pro',5,'pro','#e8eeeb'],
 ['empresarial',10,'enterprise','#020200']
]){
 const built=buildKeyDeliveryEmail({
  planId,maxUses,code:'ZV-DEMO-0000-0000',expiresAt:'2026-11-12T03:00:00Z',
  baseUrl:'https://zvm.onrender.com',ctaPath:'/cliente'
 });
 assert.equal(built.artwork?.tone,tone);
 for(const name of ['plan-middle','plan-right']){
  const match=built.html.match(new RegExp('<td[^>]*background="__ZVM_SLICE_'+name+'__"[^>]*>([\\s\\S]*?)<\\/td>'));
  assert(match,'short Gmail slice '+name+' uses optional CSS background');
  assert(!match[1].includes('<img'),'short Gmail slice '+name+' may not render a broken image widget');
 }
 for(const type of ['key','plan','validity'])assert(built.html.includes('data-zvm-live="'+type+'"'));
 assert.match(built.html,/bgcolor="#080e0b"/,'black native table fallback for Gmail Android');
 assert(built.html.includes('bgcolor="'+color+'"'),'plan-row cells have tone-aware native background');
 assert(built.html.includes('href="https://zvm.onrender.com/cliente?copy=1"'),
  'copy CTA must request secure portal copy action');
 assert(!built.html.includes('href="https://zvm.onrender.com/cliente#copy-license-key"'),
  'old nonfunctional anchor CTA must not be used');
 assert(!built.html.includes('ZV-DEMO-0000-0000?'),'key must not be inserted as URL query');
 assert(built.html.includes('ZV-DEMO-0000-0000'),'key must remain selectable live HTML');
}
const source=fs.readFileSync('server.js','utf8');
assert(source.includes("url.searchParams.get('copy') === '1' ? '/cliente?copy=1'"),'login must preserve copy intent');
const name='zvm-client-copy-intent.632eafe6c467.js';
const asset=fs.readFileSync('assets/'+name);
assert.equal(crypto.createHash('sha256').update(asset).digest('hex').slice(0,12),'632eafe6c467');
assert(source.includes(name),'copy intent script is served by the CSP-safe asset registry');
const script=asset.toString('utf8');
assert(script.includes('navigator.clipboard.writeText(key)'),'permission-aware copy attempt');
assert(script.includes("button.scrollIntoView"),'manual copy must be immediately discoverable');
assert(!script.includes('location.hash.slice'),'never put a license key in URL fragment');
console.log('R46.70 Gmail Android strips + secure copy intent PASS');
