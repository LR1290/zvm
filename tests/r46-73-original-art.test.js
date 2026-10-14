'use strict';
const assert=require('node:assert/strict');
const {buildKeyDeliveryEmail,prepareKeyDeliveryArtwork}=require('../mailer');
const {ART}=require('../src/email-whole-art-background');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const originalSha={
 start:'db2f32248d60f41e78ae0f7cf8675d25a550402671068f6311dc5efa0404a7fa',
 pro:'4d65c25a0fabc310a5bde547cac4c7ac8a515124fdac853cce2661c815a074f8',
 enterprise:'31cf12d11dc7890c2ae36586c7bb940b6938d445131b56f0f3dab0858864f040'
};
(async()=>{
 for(const [planId,maxUses,tone] of [
 ['padrao',3,'start'],['pro',5,'pro'],['empresarial',10,'enterprise'],
 ['start_v2',1,'start'],['pro_v2',3,'pro'],['enterprise_v2',10,'enterprise']
 ]){
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../assets/email-licenses',tone+'.jpg'))).digest('hex'),originalSha[tone],'original artwork must be byte-for-byte unchanged');
  assert(ART[tone].key&&ART[tone].plan&&ART[tone].valid&&ART[tone].cta);
  const mail=buildKeyDeliveryEmail({planId,maxUses,code:'ZV-DEMO-0000-0000',expiresAt:'2026-11-12T03:00:00Z',baseUrl:'https://zvm.onrender.com',ctaPath:'/cliente'});
  assert.equal(mail.artwork?.tone,tone);
  assert.equal(mail.artwork?.backgroundOriginal,true,'original canvas mandatory');
  assert(mail.html.includes('data-zvm-whole-art="1"'));
  const art='https://zvm.onrender.com/assets/zvm-email-art/r46-73/'+tone+'/original.jpg';
  assert(mail.html.includes('background="'+art+'"'));
  assert(mail.html.includes('background-image:url('+art+')'));
  assert(!/<\s*(?:img|svg|script)\b|cid:|data:image\/|__ZVM_SLICE_/i.test(mail.html),'no attached or inline image elements');
  for(const field of ['key','plan','validity'])assert(mail.html.includes('data-zvm-live="'+field+'"'));
  assert(mail.html.includes('ZV-DEMO-0000-0000'));
  assert(mail.html.includes('12/11/2026'));
  assert(mail.html.includes('PORTAL DO CLIENTE'));
  assert(mail.html.includes('Para copiar no Gmail, selecione a chave e use Copiar'));
  assert(!mail.html.includes('cliente?copy=1'),'no false copy hyperlink');
  assert(mail.html.includes('@media screen and (max-width:400px)'),'mobile proportional art scaling');
  assert(mail.html.length<25000,'email lightweight');
  const preview=await prepareKeyDeliveryArtwork(mail,{preview:true});
  const send=await prepareKeyDeliveryArtwork(mail,{preview:false});
  assert.deepEqual(preview,send,'preview and real outbound HTML are identical');
  assert.deepEqual(send.attachments,[],'no file attachments');
  assert(mail.text.includes('ZV-DEMO-0000-0000'),'plaintext copy fallback');
 }
 const suspect=buildKeyDeliveryEmail({planId:'padrao',maxUses:3,code:'<svg onload=alert(1)>'});
 assert(!suspect.html.includes('<svg')&&suspect.html.includes('&lt;svg'),'dynamic key markup escaped');
 await assert.rejects(prepareKeyDeliveryArtwork({html:'<img src=x>',artwork:{backgroundOriginal:true,tone:'pro'}}),/approved_original_background_invalid/);
 const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 assert(server.includes('r46-73')&&server.includes('original[.]jpg'));
 assert(server.includes("r46-69"),'historical external assets retained');
 console.log('R46.73 exact full-art background, 6 plans, live fields, mobile scaling, no attachments, XSS and preview/send parity PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
