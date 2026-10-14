'use strict';
const assert=require('node:assert/strict');
const {buildKeyDeliveryEmail,prepareKeyDeliveryArtwork}=require('../mailer');
const {originalBackgroundHtml}=require('../src/email-whole-art-background');
(async()=>{
 const oldDrive='https://drive.google.com/file/d/LEGACY-DO-NOT-DELIVER/view?usp=sharing';
 for(const [planId,maxUses,tone] of [
  ['padrao',3,'start'],['pro',5,'pro'],['empresarial',10,'enterprise'],
  ['start_v2',1,'start'],['pro_v2',3,'pro'],['enterprise_v2',10,'enterprise']
 ]){
  const mail=buildKeyDeliveryEmail({planId,maxUses,
   code:'ZV-DEMO-0000-0000',expiresAt:'2026-11-12T03:00:00Z',
   baseUrl:'https://zvm.onrender.com',ctaPath:'/cliente',extensionUrl:oldDrive});
  assert.equal(mail.artwork?.tone,tone);
  assert.equal(mail.artwork?.backgroundOriginal,true);
  assert(mail.html.includes('align="center" class="zvm-whole-original"'),
   'inner art table must itself be align=center in Gmail desktop');
  assert(mail.html.includes('width:640px;height:960px;table-layout:fixed;margin-left:auto;margin-right:auto;'),
   'inner art uses CSS auto margins too');
  assert(mail.html.includes('align="center" width="100%"'),
   'outer wrapper uses native centered cell');
  assert(mail.html.includes('width:100%;margin:0 auto;text-align:center;'),
   'outer wrapper centers consistently when CSS is preserved');
  assert(mail.html.includes('r46-73/'+tone+'/original.jpg'),'original approved whole-art background');
  for(const field of ['key','plan','validity'])assert(mail.html.includes('data-zvm-live="'+field+'"'));
  assert(!mail.html.includes(oldDrive),'Drive download URL must never appear in HTML');
  assert(!mail.text.includes(oldDrive),'Drive download URL must never appear in plaintext');
  assert(!/Instalar:\s+https?:\/\//i.test(mail.text),'no installer link in plaintext');
  assert(!/<\s*(?:img|svg|script)\b|cid:|data:image|__ZVM_SLICE_/i.test(mail.html),
   'no image elements or CID attachments');
  assert(mail.html.includes('PORTAL DO CLIENTE'),'portal remains available');
  const preview=await prepareKeyDeliveryArtwork(mail,{preview:true});
  const sent=await prepareKeyDeliveryArtwork(mail,{preview:false});
  assert.deepEqual(preview,sent,'same template for Analytics preview and delivery');
  assert.deepEqual(sent.attachments,[],'no attached image');
 }
 // Previously contracted SOLO keeps its own email and must not retain old
 // installation links. Do not change its label, price or device limit.
 const solo=buildKeyDeliveryEmail({planId:'solo',maxUses:1,
  code:'ZV-DEMO-SOLO-0001',expiresAt:'2026-11-12T03:00:00Z',
  baseUrl:'https://zvm.onrender.com',extensionUrl:oldDrive});
 assert(!solo.artwork,'SOLO must remain its existing independent plan');
 assert(!solo.html.includes(oldDrive));
 assert(!solo.html.includes('>Instalar ZVM</a>'));
 assert(solo.html.includes('/cliente'),'SOLO retains portal access');
 const raw=originalBackgroundHtml({tone:'start',code:'ZV-DEMO-0000-0000',
  plan:'START',validity:'12/11/2026',portal:'https://zvm.onrender.com/cliente'});
 assert(raw.includes('align="center" class="zvm-whole-original"'));
 console.log('R46.74 email centered, no Drive/download URL, 6 commercial ids + SOLO, previews parity PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
