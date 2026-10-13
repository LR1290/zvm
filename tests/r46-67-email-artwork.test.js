'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const sharp=require('sharp');
const {buildKeyDeliveryEmail,prepareKeyDeliveryArtwork}=require('../mailer');
const {PLAN,HEADER,FOOTER,prepareKeyDeliveryArtwork:prepare}=require('../src/email-license-artwork');
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
  assert(built.html.includes(HEADER)&&built.html.includes(FOOTER),'decorative art fragments are mandatory');
  assert(!built.html.includes('font-size:43px'),'old generic email must not reappear');
  for(const [field,val] of [['key','ZV-DEMO-4567-8901'],['plan',built.artwork.plan],['validity','14/11/2026']]){
    assert(built.html.includes('data-zvm-live="'+field+'"'),'must be live HTML field '+field);
    assert(built.html.includes(val),'must be copyable: '+field);
  }
  assert(built.html.includes('COPIAR CHAVE NO PORTAL'),'copy CTA is live HTML link');
  assert(!built.html.includes('<script'),'no scripts in emails');
  const preview=await prepareKeyDeliveryArtwork(built,{preview:true});
  const delivery=await prepareKeyDeliveryArtwork(built,{preview:false});
  const dataUris=Array.from(preview.html.matchAll(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/g));
  assert.equal(dataUris.length,2,'top and footer are the only inline art fragments');
  const widths=[];
  for(const match of dataUris){const buf=Buffer.from(match[1],'base64');const meta=await sharp(buf).metadata();widths.push(meta.width);assert(meta.height<1536,'no full license JPG');}
  assert.deepEqual(widths,[1024,1024]);
  assert.equal(delivery.attachments.length,2);
  for(let i=0;i<2;i++){
   assert(delivery.html.includes('cid:'+delivery.attachments[i].content_id));
   assert.equal(digest(Buffer.from(delivery.attachments[i].content,'base64')),digest(Buffer.from(dataUris[i][1],'base64')),'same art fragment preview and email');
  }
  assert(!delivery.html.includes('data:image/jpeg;base64,'));
  assert(!delivery.attachments.some(x=>x.filename.includes('licenca')),'do not send a rasterized license');
 }
 await assert.rejects(prepare({html:'<p>old mail</p>',artwork:{tone:'unknown'}}),/approved_artwork_slot_missing/);
 await assert.rejects(prepare({html:HEADER+FOOTER,artwork:{tone:'unknown'}}),/approved_artwork_tone_invalid/);
 const safe=buildKeyDeliveryEmail({planId:'padrao',maxUses:3,code:'<script>alert(1)</script>',expiresAt:'2026-11-14T03:00:00.000Z'});
 assert(!safe.html.includes('<script>'),'XSS in template denied');
 assert(safe.html.includes('&lt;script&gt;'),'alt must escape user input');
 const plain=await prepareKeyDeliveryArtwork({html:'<p>Reset password</p>'});
 assert.equal(plain.html,'<p>Reset password</p>');assert.equal(plain.attachments.length,0);
 console.log('R46.68 live HTML fields + original artwork fragments + preview/CID parity PASS');
})().catch(err=>{console.error(err);process.exitCode=1;});
