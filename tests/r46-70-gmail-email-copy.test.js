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
  const match=built.html.match(/<td[^>]*background="__ZVM_SLICE_details__"[^>]*>(.*?)<\/td>/s);
 assert(match,'details uses exactly one full-width cell and approved single-piece background');
 assert(!match[1].includes('<img'),'details contains selectable HTML only, no child image cells');
 assert.equal((built.html.match(/__ZVM_SLICE_details__/g)||[]).length,2,'details token is present as background attribute and CSS only');
 for(const obsolete of ['plan-left','plan-bg','plan-middle','valid-bg','plan-right'])
  assert(!built.html.includes('__ZVM_SLICE_'+obsolete+'__'),'no obsolete 5-piece strips');
 assert.equal((match[1].match(/data-zvm-live="(plan|validity)"/g)||[]).length,2,'plan and validity are real text inside one background');
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
