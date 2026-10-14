'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {buildKeyDeliveryEmail,prepareKeyDeliveryArtwork}=require('../mailer');
const h=x=>crypto.createHash('sha256').update(x).digest('hex');
const approved={start:'db2f32248d60f41e78ae0f7cf8675d25a550402671068f6311dc5efa0404a7fa',pro:'4d65c25a0fabc310a5bde547cac4c7ac8a515124fdac853cce2661c815a074f8',enterprise:'31cf12d11dc7890c2ae36586c7bb940b6938d445131b56f0f3dab0858864f040'};
(async()=>{
 for(const [tone,id,uses] of [['start','padrao',3],['pro','pro',5],['enterprise','empresarial',10],['start','start_v2',1],['pro','pro_v2',3],['enterprise','enterprise_v2',10]]){
  assert.equal(h(fs.readFileSync(path.join(__dirname,'../assets/email-licenses',tone+'.jpg'))),approved[tone],'original file must be byte-for-byte approved');
  const built=buildKeyDeliveryEmail({planId:id,maxUses:uses,code:'ZV-DEMO-4567-8901',expiresAt:'2026-11-14T03:00:00Z',baseUrl:'https://zvm.onrender.com',ctaPath:'/cliente'});
  assert.equal(built.artwork?.tone,tone);
  assert.equal(built.artwork?.backgroundOriginal,true);
  assert.equal(built.artwork?.validity,'14/11/2026');
  assert(built.html.includes('data-zvm-whole-art="1"'));
  for(const field of ['key','plan','validity'])assert(built.html.includes('data-zvm-live="'+field+'"'));
  const bg='https://zvm.onrender.com/assets/zvm-email-art/r46-73/'+tone+'/original.jpg';
  assert(built.html.includes('background="'+bg+'"')&&built.html.includes('background-image:url('+bg+')'),'original complete image only as CSS/HTML background');
  assert(!/<\s*(?:img|svg|script)\b|cid:|data:image|__ZVM_SLICE_/i.test(built.html),'no inline images or attachments');
  const preview=await prepareKeyDeliveryArtwork(built,{preview:true});
  const deliver=await prepareKeyDeliveryArtwork(built,{preview:false});
  assert.equal(preview.html,deliver.html);
  assert.deepEqual(deliver.attachments,[]);
  assert(built.text.includes('ZV-DEMO-4567-8901'));
 }
 await assert.rejects(prepareKeyDeliveryArtwork({html:'<body data-zvm-whole-art="1"><img src="evil"></body>',artwork:{tone:'start',backgroundOriginal:true}}),/approved_original_background_invalid/);
 const hostile=buildKeyDeliveryEmail({planId:'pro',maxUses:5,code:'<script>alert(1)</script>'});
 assert(!hostile.html.includes('<script>')&&hostile.html.includes('&lt;script&gt;'),'dynamic key HTML escaped');
 console.log('R46.73 exact originals preserved + single background + preview/send parity PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
