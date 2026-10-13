'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {buildKeyDeliveryEmail,prepareKeyDeliveryArtwork}=require('../mailer');
(async()=>{
 const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 for(const token of ['lab-sale-pane','lab-email-pane','lab-mail-plan','lab-mail-kind','lab_plan_template_mismatch','lab_explicit_plan_required'])
  assert(server.includes(token),'Analytics lab hardening '+token);
 for(const [planId,uses,tone] of [['padrao',3,'start'],['pro',5,'pro'],['empresarial',10,'enterprise']]){
  const mail=buildKeyDeliveryEmail({planId,maxUses:uses,code:'ZV-TEST-KEY-47',expiresAt:'2026-11-20T03:00:00Z',baseUrl:'https://zvm.onrender.com',ctaPath:'/cliente'});
  assert.equal(mail.artwork?.tone,tone);
  for(const [field,v] of [['key','ZV-TEST-KEY-47'],['plan',mail.artwork.plan],['validity','20/11/2026']]){
   assert(mail.html.includes('data-zvm-live="'+field+'"')&&mail.html.includes(v),'selectable '+field);
  }
  const preview=await prepareKeyDeliveryArtwork(mail,{preview:true});
  const delivery=await prepareKeyDeliveryArtwork(mail,{preview:false});
  assert.equal(delivery.attachments.length,14);
  assert(!delivery.attachments.some(p=>p.filename.includes('licenca')));
  assert(delivery.html.includes('ZV-TEST-KEY-47'),'key live after rendering');
  assert(preview.html.includes('data:image/jpeg;base64,'));
  assert(delivery.html.includes('cid:zvm-art-'+tone+'-copy-button'),'copy control points to portal');
  assert(mail.html.includes('href="https://zvm.onrender.com/cliente#copy-license-key"'));
 }
 const injected=buildKeyDeliveryEmail({planId:'padrao',maxUses:3,code:'<script>alert(1)</script>'});
 assert(!injected.html.includes('<script>')&&injected.html.includes('&lt;script&gt;'));
 console.log('R46.68 Analytics isolation with R46.69 original-art selectable mail PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
