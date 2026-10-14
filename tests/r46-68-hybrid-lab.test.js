'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {buildKeyDeliveryEmail,prepareKeyDeliveryArtwork}=require('../mailer');
(async()=>{
 const s=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 for(const token of ['lab-sale-pane','lab-email-pane','lab-mail-plan','lab-mail-kind','lab_plan_template_mismatch','lab_explicit_plan_required'])
  assert(s.includes(token),'Analytics lab isolation preserved: '+token);
 assert(s.includes('zvmEmailArtSlices')&&s.includes('zvm-email-art/r46-69'),'historical image URLs remain valid');
 for(const [planId,uses,tone] of [['padrao',3,'start'],['pro',5,'pro'],['empresarial',10,'enterprise']]){
  const b=buildKeyDeliveryEmail({planId,maxUses:uses,code:'ZV-TEST-KEY-47',expiresAt:'2026-11-20T03:00:00Z',baseUrl:'https://zvm.onrender.com',ctaPath:'/cliente'});
  assert.equal(b.artwork?.tone,tone);
  assert.equal(b.artwork?.native,true);
  for(const [field,val] of [['key','ZV-TEST-KEY-47'],['plan',b.artwork.plan],['validity','20/11/2026']])
   assert(b.html.includes('data-zvm-live="'+field+'"')&&b.html.includes(val),'selectable '+field);
  const preview=await prepareKeyDeliveryArtwork(b,{preview:true});
  const delivered=await prepareKeyDeliveryArtwork(b,{preview:false});
  assert.equal(preview.html,delivered.html,'same rendering in the lab and delivery');
  assert.equal(delivered.attachments.length,0);
  assert(!delivered.html.includes('/assets/zvm-email-art/'));
 }
 console.log('R46.72 Analytics preview/delivery parity and isolation PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
