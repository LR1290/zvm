'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {buildKeyDeliveryEmail,prepareKeyDeliveryArtwork}=require('../mailer');
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const expected={start:'db2f32248d60f41e78ae0f7cf8675d25a550402671068f6311dc5efa0404a7fa',pro:'4d65c25a0fabc310a5bde547cac4c7ac8a515124fdac853cce2661c815a074f8',enterprise:'31cf12d11dc7890c2ae36586c7bb940b6938d445131b56f0f3dab0858864f040'};
(async()=>{
 for(const [tone,id,uses] of [['start','padrao',3],['pro','pro',5],['enterprise','empresarial',10],['start','start_v2',1],['pro','pro_v2',3],['enterprise','enterprise_v2',10]]){
  // The previously approved raster assets remain unmodified to serve historic emails.
  assert.equal(digest(fs.readFileSync(path.join(__dirname,'../assets/email-licenses',tone+'.jpg'))),expected[tone]);
  const built=buildKeyDeliveryEmail({code:'ZV-DEMO-4567-8901',planId:id,maxUses:uses,expiresAt:'2026-11-14T03:00:00Z',baseUrl:'https://zvm.onrender.com',ctaPath:'/cliente'});
  assert.equal(built.artwork?.tone,tone);
  assert.equal(built.artwork?.native,true);
  assert.equal(built.artwork?.validity,'14/11/2026');
  assert(built.html.includes('data-zvm-native-mail="1"'));
  for(const field of ['key','plan','validity'])assert(built.html.includes('data-zvm-live="'+field+'"'),'live selectable '+field);
  assert(built.html.includes('ZV-DEMO-4567-8901'));
  assert(!/<\s*(?:img|svg|script)\b|cid:|data:image\/|__ZVM_SLICE_/i.test(built.html),'not a bitmap message');
  assert(!built.html.includes('?copy=1'),'copy does not misrepresent a portal redirect');
  assert(built.html.includes('PORTAL DO CLIENTE'));
  const preview=await prepareKeyDeliveryArtwork(built,{preview:true});
  const out=await prepareKeyDeliveryArtwork(built,{preview:false});
  assert.equal(preview.html,out.html,'preview exactly mirrors mail sent');
  assert.equal(out.attachments.length,0,'no files attached');
 }
 await assert.rejects(prepareKeyDeliveryArtwork({html:'<img src="bad">',artwork:{tone:'start',native:true}}),/native_license_html_invalid/);
 const xss=buildKeyDeliveryEmail({planId:'padrao',maxUses:3,code:'<script>alert(1)</script>'});
 assert(!xss.html.includes('<script>')&&xss.html.includes('&lt;script&gt;'));
 const neutral=await prepareKeyDeliveryArtwork({html:'<p>Reset password</p>'});
 assert.equal(neutral.html,'<p>Reset password</p>');
 console.log('R46.72: preserved historical original art + image-free real HTML + preview/mail parity PASS');
})().catch(err=>{console.error(err);process.exitCode=1;});
