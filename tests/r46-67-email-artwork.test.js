'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sharp=require('sharp');
const {buildKeyDeliveryEmail,prepareKeyDeliveryArtwork}=require('../mailer');
const {GEOMETRY,regions,decorativeSlices}=require('../src/email-pixel-fidelity');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const expected={start:'db2f32248d60f41e78ae0f7cf8675d25a550402671068f6311dc5efa0404a7fa',pro:'4d65c25a0fabc310a5bde547cac4c7ac8a515124fdac853cce2661c815a074f8',enterprise:'31cf12d11dc7890c2ae36586c7bb940b6938d445131b56f0f3dab0858864f040'};
(async()=>{
 for(const [tone,planId,uses] of [['start','padrao',3],['pro','pro',5],['enterprise','empresarial',10],['start','start_v2',1],['pro','pro_v2',3],['enterprise','enterprise_v2',10]]){
  const original=fs.readFileSync(path.join(__dirname,'../assets/email-licenses',tone+'.jpg'));
  assert.equal(digest(original),expected[tone],'must retain original user-approved art');
  const b=buildKeyDeliveryEmail({code:'ZV-DEMO-4567-8901',planId,maxUses:uses,expiresAt:'2026-11-14T03:00:00Z',baseUrl:'https://zvm.onrender.com',ctaPath:'/cliente'});
  assert.equal(b.artwork?.tone,tone);assert.equal(b.artwork?.validity,'14/11/2026');
  assert.match(b.html,/__ZVM_SLICE_hero__/);
  assert.match(b.html,/__ZVM_SLICE_rest__/);
  assert(!b.html.includes('ZVM_ART_HEADER'),'no old split-art renderer');
  assert(!b.html.includes('__ZVM_APPROVED_LICENSE_ARTWORK__'));
  for(const [field,value] of [['key','ZV-DEMO-4567-8901'],['plan',b.artwork.plan],['validity','14/11/2026']]){
   assert(b.html.includes('data-zvm-live="'+field+'"'));
   assert(b.html.includes(value),'literal selectable '+field);
  }
  assert.match(b.html,/href="https:\/\/zvm.onrender.com\/cliente#copy-license-key"/);
  const parts=regions(tone); assert.equal(parts.length,14);
  const originalArea=parts.reduce((total,p)=>total+(p.w*p.h),0);
  assert.equal(originalArea,1024*1536,'artwork portions must have 100% coverage with no missing pixels');
  const a=await decorativeSlices(tone);assert.equal(Object.keys(a).length,14);
  for(const piece of Object.values(a)){
   const m=await sharp(piece.buffer).metadata();
   assert.equal(m.width,piece.w);assert.equal(m.height,piece.h);
  }
  const preview=await prepareKeyDeliveryArtwork(b,{preview:true});
  const outgoing=await prepareKeyDeliveryArtwork(b,{preview:false});
  assert.equal(outgoing.attachments.length,0,'first-party HTTPS artwork must not create mail attachments');
  assert(outgoing.html.includes('data-zvm-live="key"')&&outgoing.html.includes('ZV-DEMO-4567-8901'));
  assert(!outgoing.html.includes('data:image/jpeg;base64,'));
  for(const p of Object.values(a)){
   const url='https://zvm.onrender.com/assets/zvm-email-art/r46-69/'+tone+'/'+p.name+'.jpg';
   assert(outgoing.html.includes(url),'send artwork from first-party immutable URL');
   assert(preview.html.includes('data:image/jpeg;base64,'+p.buffer.toString('base64')),'preview must use exactly the same original art');
  }
  assert.equal(GEOMETRY[tone].key.length,4);
 }
 const xss=buildKeyDeliveryEmail({planId:'padrao',maxUses:3,code:'<img src=x onerror=alert(1)>',expiresAt:'2026-11-14T03:00:00Z'});
 assert(!xss.html.includes('<img src=x onerror=alert(1)>'));
 assert(xss.html.includes('&lt;img'));
 const neutral=await prepareKeyDeliveryArtwork({html:'<p>Reset password</p>'});
 assert.equal(neutral.html,'<p>Reset password</p>');assert.equal(neutral.attachments.length,0);
 console.log('R46.69 original-art SHA256, 100% geometric coverage, selectable live fields, link and HTTPS artwork parity PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
