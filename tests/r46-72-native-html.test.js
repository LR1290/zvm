'use strict';
// Earlier R46.72 prevented email images but lost approved design.
// This regression enforces that its fix does not erase the original art again.
const assert=require('node:assert/strict');
const {buildKeyDeliveryEmail,prepareKeyDeliveryArtwork}=require('../mailer');
(async()=>{
 for(const [id,uses,tone] of [['padrao',3,'start'],['pro',5,'pro'],['empresarial',10,'enterprise'],['start_v2',1,'start'],['pro_v2',3,'pro'],['enterprise_v2',10,'enterprise']]){
  const b=buildKeyDeliveryEmail({planId:id,maxUses:uses,code:'ZV-DEMO-0000-0000',expiresAt:'2026-11-12T03:00:00Z',baseUrl:'https://zvm.onrender.com'});
  assert.equal(b.artwork?.tone,tone);
  assert.equal(b.artwork?.backgroundOriginal,true);
  assert(!b.html.includes('data-zvm-native-mail="1"'),'generic HTML design not approved');
  assert(b.html.includes('r46-73/'+tone+'/original.jpg'),'entire original artwork, unchanged');
  assert(!/<img\b|<svg\b|<script\b|cid:|data:image|__ZVM_SLICE_/.test(b.html));
  const p=await prepareKeyDeliveryArtwork(b,{preview:true}),m=await prepareKeyDeliveryArtwork(b,{preview:false});
  assert.deepEqual(p,m);
  assert.deepEqual(m.attachments,[]);
 }
 const renew=buildKeyDeliveryEmail({planId:'pro',maxUses:5,code:'ZV-DEMO-0000-0000',renewed:true,expiresAt:'2026-11-12T03:00:00Z'});
 assert.equal(renew.subject,'ZVM — Renovação confirmada');
 await assert.rejects(prepareKeyDeliveryArtwork({html:'<img src=x>',artwork:{tone:'pro',backgroundOriginal:true}}),/approved_original_background_invalid/);
 console.log('R46.73 never regress to generic HTML / no attachments PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
