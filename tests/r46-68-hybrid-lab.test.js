'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {buildKeyDeliveryEmail,prepareKeyDeliveryArtwork}=require('../mailer');
(async()=>{
 const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 for(const marker of ['lab-sale-pane','lab-email-pane','lab-mail-plan','lab-mail-kind','lab_plan_template_mismatch','lab_explicit_plan_required'])
  assert(server.includes(marker),'Analytics lab isolation '+marker);
 assert(server.includes('r46-73')&&server.includes('original[.]jpg'),'one-whole-background serve endpoint');
 assert(server.includes('r46-69'),'legacy mail art URL compatibility');
 for(const [id,uses,tone] of [['padrao',3,'start'],['pro',5,'pro'],['empresarial',10,'enterprise']]){
  const built=buildKeyDeliveryEmail({planId:id,maxUses:uses,code:'DEMO-ZV-KEY-47',expiresAt:'2026-11-20T03:00:00Z',baseUrl:'https://zvm.onrender.com'});
  assert.equal(built.artwork?.tone,tone);
  for(const [key,value] of [['key','DEMO-ZV-KEY-47'],['plan',built.artwork.plan],['validity','20/11/2026']])
   assert(built.html.includes('data-zvm-live="'+key+'"')&&built.html.includes(value),'selectable '+key);
  const a=await prepareKeyDeliveryArtwork(built,{preview:true});
  const b=await prepareKeyDeliveryArtwork(built,{preview:false});
  assert.deepEqual(a,b,'Analytics visual equals delivered email');
  assert.deepEqual(b.attachments,[]);
 }
 console.log('R46.73 Analytics preview/delivery parity + plan/template lab isolation PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
