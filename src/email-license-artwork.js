'use strict';
const fs=require('node:fs');
const path=require('node:path');
const sharp=require('sharp');

// Original, approved 1024x1536 JPEG files are committed bit-for-bit.
// Overlay ONLY the empty key/plan/validity fields, never redraw the illustration.
const ASSET_DIR=path.join(__dirname,'..','assets','email-licenses');
const PLACEHOLDER='__ZVM_APPROVED_LICENSE_ARTWORK__';
const PLAN=Object.freeze({
 start:{file:'start.jpg',ink:'#0affb0',key:[230,675,655,69],plan:[227,808,261,68],expiry:[631,808,258,68]},
 pro:{file:'pro.jpg',ink:'#073324',key:[229,640,662,71],plan:[227,772,264,67],expiry:[634,772,257,67]},
 enterprise:{file:'enterprise.jpg',ink:'#ffe1a0',key:[226,658,665,82],plan:[227,796,263,73],expiry:[631,796,262,73]},
});
function xml(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
function fitLines(value,box,size){
 const text=String(value??'').trim();
 if(!text||text.length>110)throw new Error('artwork_field_invalid');
 const perLine=Math.max(14,Math.floor(box[2]/(size*.56)));
 if(text.length<=perLine)return [text];
 const half=Math.ceil(text.length/2);
 const hyphen=text.lastIndexOf('-',half);
 const at=hyphen>=8&&hyphen<=text.length-8?hyphen+1:half;
 return [text.slice(0,at),text.slice(at)].filter(Boolean);
}
function overlayText(value,box,color,maxSize=28){
 const lines=fitLines(value,box,maxSize);
 const longest=Math.max(...lines.map(x=>x.length));
 const font=Math.max(14,Math.min(maxSize,Math.floor(box[2]/(longest*.60))));
 const x=box[0]+box[2]/2,cy=box[1]+box[3]/2;
 return lines.map((line,i)=>{
  const y=cy+(i-(lines.length-1)/2)*font*1.14;
  return '<text x="'+x+'" y="'+y+'" dominant-baseline="middle" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="'+font+'" font-weight="700" fill="'+color+'">'+xml(line)+'</text>';
 }).join('');
}
async function rasterizeLicenseArtwork({tone,code,plan,validity}={}){
 const spec=PLAN[tone];
 if(!spec)throw new Error('artwork_tone_invalid');
 const file=path.join(ASSET_DIR,spec.file);
 if(!fs.existsSync(file))throw new Error('approved_license_artwork_missing');
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536">'
  +overlayText(code,spec.key,spec.ink,29)
  +overlayText(plan,spec.plan,spec.ink,22)
  +overlayText(validity,spec.expiry,spec.ink,22)+'</svg>';
 return sharp(file,{limitInputPixels:3000000}).composite([{input:Buffer.from(svg)}]).jpeg({quality:91,mozjpeg:true}).toBuffer();
}
async function prepareKeyDeliveryArtwork(built,{preview=false}={}){
 if(!built||typeof built.html!=='string')throw new Error('invalid_license_email');
 if(!built.artwork)return {html:built.html,attachments:[]};
 if(!built.html.includes(PLACEHOLDER))throw new Error('approved_license_artwork_slot_missing');
 const jpeg=await rasterizeLicenseArtwork(built.artwork);
 const encoded=jpeg.toString('base64'),cid='zvm-approved-license-'+built.artwork.tone;
 return {
  html:built.html.replace(PLACEHOLDER,preview?'data:image/jpeg;base64,'+encoded:'cid:'+cid),
  attachments:preview?[]:[{content:encoded,filename:'zvm-'+built.artwork.tone+'-licenca.jpg',content_type:'image/jpeg',content_id:cid}],
 };
}
module.exports={PLACEHOLDER,PLAN,rasterizeLicenseArtwork,prepareKeyDeliveryArtwork};
