'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {buildKeyDeliveryEmail,prepareKeyDeliveryArtwork}=require('../mailer');
(async()=>{
 const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 for(const token of ['lab-sale-pane','lab-email-pane','lab-mail-plan','lab-mail-kind','lab_plan_template_mismatch','lab_explicit_plan_required'])assert(server.includes(token),token);
 for(const {planId,maxUses,tone} of [{planId:'padrao',maxUses:3,tone:'start'},{planId:'pro',maxUses:5,tone:'pro'},{planId:'empresarial',maxUses:10,tone:'enterprise'}]){
  const code='ZV-TEST-KEY-47';
  const mail=buildKeyDeliveryEmail({planId,maxUses,code,expiresAt:'2026-11-20T03:00:00Z',baseUrl:'https://zvm.onrender.com',ctaPath:'/cliente'});
  assert.equal(mail.artwork?.tone,tone);
  for(const [field,value] of [['key',code],['plan',mail.artwork.plan],['validity','20/11/2026']]){
   assert(mail.html.includes('data-zvm-live="'+field+'"'));
   assert(mail.html.includes(value));
  }
  assert(mail.html.includes('COPIAR CHAVE NO PORTAL'));
  assert(mail.html.includes('href="https://zvm.onrender.com/cliente#copy-license-key"'));
  assert(!mail.html.includes('font-size:43px'),'no legacy image-only license');
  const preview=await prepareKeyDeliveryArtwork(mail,{preview:true});
  const outgoing=await prepareKeyDeliveryArtwork(mail,{preview:false});
  assert.equal(outgoing.attachments.length,2,'header and footer only');
  assert(!outgoing.attachments.some(a=>a.filename.includes('licenca')),'never attach full personalized license');
  assert(outgoing.html.includes(code),'key is live HTML in outgoing message');
  assert(outgoing.html.includes('20/11/2026'));
  assert(!outgoing.html.includes('data:image/jpeg;base64,'));
  for(let i=0;i<2;i++){
   const cid=outgoing.attachments[i].content_id;
   assert(outgoing.html.includes('cid:'+cid));
   const image=Buffer.from(outgoing.attachments[i].content,'base64');
   const uri=/data:image\/jpeg;base64,([a-zA-Z0-9+/=]+)/g;
   const extracted=Array.from(preview.html.matchAll(uri));
   assert.equal(extracted.length,2);
   assert.equal(crypto.createHash('sha256').update(image).digest('hex'),crypto.createHash('sha256').update(Buffer.from(extracted[i][1],'base64')).digest('hex'));
  }
 }
 const malicious=buildKeyDeliveryEmail({planId:'padrao',maxUses:3,code:'<img src=x onerror=alert(1)>',expiresAt:'2026-11-20T03:00:00Z'});
 assert(!malicious.html.includes('<img src=x onerror=alert(1)>'));
 assert(malicious.html.includes('&lt;img'));
 console.log('R46.68: HTML selectable fields, visual art parity, strict Lab selectors PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
