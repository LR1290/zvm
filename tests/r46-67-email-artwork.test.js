'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const sharp=require('sharp');
const {buildKeyDeliveryEmail,prepareKeyDeliveryArtwork}=require('../mailer');
const {rasterizeLicenseArtwork,PLAN,PLACEHOLDER}=require('../src/email-license-artwork');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const expected=Object.freeze({
 start:'db2f32248d60f41e78ae0f7cf8675d25a550402671068f6311dc5efa0404a7fa',
 pro:'4d65c25a0fabc310a5bde547cac4c7ac8a515124fdac853cce2661c815a074f8',
 enterprise:'31cf12d11dc7890c2ae36586c7bb940b6938d445131b56f0f3dab0858864f040'
});
(async()=>{
 for(const {planId,uses,tone} of [
  {planId:'padrao',uses:3,tone:'start'},
  {planId:'pro',uses:5,tone:'pro'},
  {planId:'empresarial',uses:10,tone:'enterprise'},
  {planId:'start_v2',uses:1,tone:'start'},
  {planId:'pro_v2',uses:3,tone:'pro'},
  {planId:'enterprise_v2',uses:10,tone:'enterprise'}
 ]){
  const original=fs.readFileSync(path.join(__dirname,'../assets/email-licenses',PLAN[tone].file));
  assert.equal(digest(original),expected[tone],'source must be exact uploaded artwork');
  const built=buildKeyDeliveryEmail({planId,maxUses:uses,code:'ZV-DEMO-4567-8901',expiresAt:'2026-11-14T03:00:00.000Z',baseUrl:'https://zvm.onrender.com',ctaPath:'/cliente'});
  assert.equal(built.artwork?.tone,tone);
  assert.equal(built.artwork?.validity,'14/11/2026');
  assert.equal(built.artwork?.code,'ZV-DEMO-4567-8901');
  assert(built.text?.includes('ZV-DEMO-4567-8901'),'plaintext fallback must keep key copyable');
  assert(built.html.includes(PLACEHOLDER),'approved image is mandatory');
  assert(!built.html.includes('font-size:43px'),'old HTML template must not be returned');
  const preview=await prepareKeyDeliveryArtwork(built,{preview:true});
  const delivery=await prepareKeyDeliveryArtwork(built,{preview:false});
  const dataUri=/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/.exec(preview.html);
  assert(dataUri,'preview contains raster of approved original');
  const jpeg=Buffer.from(dataUri[1],'base64');
  const meta=await sharp(jpeg).metadata();
  assert.equal(meta.width,1024);assert.equal(meta.height,1536);assert.equal(meta.format,'jpeg');
  assert.equal(delivery.attachments.length,1);
  assert(delivery.html.includes('cid:'+delivery.attachments[0].content_id));
  assert.equal(digest(Buffer.from(delivery.attachments[0].content,'base64')),digest(jpeg),'same composed image preview and email');
  assert(!delivery.html.includes('data:image/jpeg;base64,'));
 }
 await assert.rejects(rasterizeLicenseArtwork({tone:'unknown',code:'x',plan:'x',validity:'x'}),/artwork_tone_invalid/);
 await assert.rejects(prepareKeyDeliveryArtwork({html:'<p>old mail</p>',artwork:{tone:'start'}}),/approved_license_artwork_slot_missing/);
 const safe=buildKeyDeliveryEmail({planId:'padrao',maxUses:3,code:'<script>alert(1)</script>',expiresAt:'2026-11-14T03:00:00.000Z'});
 assert(!safe.html.includes('<script>'),'XSS in template denied');
 assert(safe.html.includes('&lt;script&gt;'),'alt must escape user input');
 const plain=await prepareKeyDeliveryArtwork({html:'<p>Reset password</p>'});
 assert.equal(plain.html,'<p>Reset password</p>');assert.equal(plain.attachments.length,0);
 console.log('R46.67 original-art SHA256 + preview/CID parity + no-old-fallback checks PASS');
})().catch(err=>{console.error(err);process.exitCode=1;});
