'use strict';
const sharp=require('sharp');
const fs=require('node:fs');
const path=require('node:path');
const DIR=path.join(__dirname,'..','assets','email-licenses');
const HEADER='__ZVM_ART_HEADER__',FOOTER='__ZVM_ART_FOOTER__';
// The user-approved originals are immutable sources. Key/plan/date are NOT
// painted on images anymore: only decorative regions are cropped once per tone.
const PLAN=Object.freeze({
 start:{file:'start.jpg',headerBottom:598,footerTop:963},
 pro:{file:'pro.jpg',headerBottom:579,footerTop:948},
 enterprise:{file:'enterprise.jpg',headerBottom:580,footerTop:944}
});
const cache=new Map();
async function fragments(tone){
 if(!PLAN[tone])throw new Error('approved_artwork_tone_invalid');
 if(!cache.has(tone))cache.set(tone,(async()=>{
  const {file,headerBottom,footerTop}=PLAN[tone];
  const filename=path.join(DIR,file);
  if(!fs.existsSync(filename))throw new Error('approved_artwork_missing');
  const options={limitInputPixels:3000000};
  const top=await sharp(filename,options).extract({left:0,top:0,width:1024,height:headerBottom}).jpeg({quality:89}).toBuffer();
  const bottom=await sharp(filename,options).extract({left:0,top:footerTop,width:1024,height:1536-footerTop}).jpeg({quality:89}).toBuffer();
  return [top,bottom];
 })().catch(error=>{cache.delete(tone);throw error;}));
 return cache.get(tone);
}
async function prepareKeyDeliveryArtwork(built,{preview=false}={}){
 if(!built||typeof built.html!=='string')throw new Error('invalid_license_email');
 if(!built.artwork)return {html:built.html,attachments:[]};
 const tone=built.artwork.tone;
 if(!built.html.includes(HEADER)||!built.html.includes(FOOTER))throw new Error('approved_artwork_slot_missing');
 const [top,bottom]=await fragments(tone);
 const segments=[{slot:HEADER,buffer:top,id:'zvm-approved-header-'+tone,filename:'zvm-arte-cabecalho.jpg'},
                 {slot:FOOTER,buffer:bottom,id:'zvm-approved-footer-'+tone,filename:'zvm-arte-rodape.jpg'}];
 let html=built.html;
 for(const item of segments)html=html.replace(item.slot,preview?'data:image/jpeg;base64,'+item.buffer.toString('base64'):'cid:'+item.id);
 return {html,attachments:preview?[]:segments.map(a=>({content:a.buffer.toString('base64'),filename:a.filename,content_type:'image/jpeg',content_id:a.id}))};
}
module.exports={PLAN,HEADER,FOOTER,prepareKeyDeliveryArtwork};
