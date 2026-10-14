'use strict';
const assert=require('node:assert/strict');
const {nativeLicenseHtml,THEMES}=require('../src/email-native-html');
const {buildKeyDeliveryEmail,prepareKeyDeliveryArtwork}=require('../mailer');
(async()=>{
 const cases=[['padrao',3,'start'],['pro',5,'pro'],['empresarial',10,'enterprise'],['start_v2',1,'start'],['pro_v2',3,'pro'],['enterprise_v2',10,'enterprise']];
 for(const [planId,maxUses,tone] of cases){
  const opts={planId,maxUses,code:'ZV-DEMO-0000-0000',expiresAt:'2026-11-12T03:00:00Z',baseUrl:'https://zvm.onrender.com',ctaPath:'/cliente'};
  const built=buildKeyDeliveryEmail(opts);
  assert.equal(built.artwork?.tone,tone);
  assert.equal(built.artwork?.native,true);
  assert.equal(built.artwork.validity,'12/11/2026');
  assert(built.html.includes('data-zvm-native-mail="1"'));
  assert(built.html.includes('ZV-DEMO-0000-0000'));
  assert(built.html.includes('PORTAL DO CLIENTE'));
  assert(built.html.includes('TOQUE E SEGURE A CHAVE ACIMA'));
  for(const field of ['key','plan','validity'])assert(built.html.includes('data-zvm-live="'+field+'"'));
  assert(!/<\s*(?:img|svg|script)\b|(?:cid:|data:image\/|__ZVM_SLICE_)/i.test(built.html),'no image, SVG, scripting or art slice');
  assert(!built.html.includes('cliente?copy=1'),'no deceptive portal action disguised as copy');
  assert(!built.html.includes('COPIAR CHAVE</a>'),'no fake Gmail clipboard button');
  assert(Buffer.byteLength(built.html,'utf8')<50000,'email stays under Resend size cap');
  const preview=await prepareKeyDeliveryArtwork(built,{preview:true});
  const outbound=await prepareKeyDeliveryArtwork(built,{preview:false});
  assert.deepEqual(preview,outbound,'Analytics and recipient see the same HTML');
  assert.deepEqual(outbound.attachments,[],'no attachments whatsoever');
  assert(!outbound.html.includes('https://zvm.onrender.com/assets/zvm-email-art'));
 }
 const renewal=buildKeyDeliveryEmail({planId:'pro',maxUses:5,code:'LIVE-TEST-123',expiresAt:'2026-11-15T03:00:00Z',renewed:true});
 assert.equal(renewal.subject,'ZVM — Renovação confirmada');
 assert(renewal.html.includes('RENOVAÇÃO CONFIRMADA'));
 assert(!renewal.html.includes('BEM-VINDO(A) AO'));
 const injected=buildKeyDeliveryEmail({planId:'padrao',maxUses:3,code:'<img src=x onerror=alert(1)>'});
 assert(!injected.html.includes('<img')&&injected.html.includes('&lt;img'),'injected markup escaped');
 await assert.rejects(prepareKeyDeliveryArtwork({html:'<img src=x>',artwork:{native:true,tone:'pro'}}),/native_license_html_invalid/);
 await assert.rejects(prepareKeyDeliveryArtwork({html:'<body data-zvm-native-mail="1"><svg></svg></body>',artwork:{native:true,tone:'pro'}}),/native_license_html_invalid/);
 assert.equal(Object.keys(THEMES).length,3);
 assert.throws(()=>nativeLicenseHtml({tone:'start',code:'',plan:'START',validity:'12/11/2026'}),/native_license_field_required/);
 console.log('R46.72 native selectable HTML / 0 images / 0 attachments / preview parity / XSS PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
