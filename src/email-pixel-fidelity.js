'use strict';
const fs=require('node:fs');
const path=require('node:path');
const sharp=require('sharp');
const DIR=path.join(__dirname,'..','assets','email-licenses');
// Exact 1024x1536 originals. Only the three blank fields become HTML text.
const GEOMETRY=Object.freeze({
 start:{ink:'#13f7ae',bg:'#071b13',key:[232,830,699,727],details:[232,487,632,886,832,855],cta:[896,954,513]},
 pro:{ink:'#073b2a',bg:'#eef8f4',key:[233,834,662,691],details:[230,490,635,885,790,814],cta:[856,917,516]},
 enterprise:{ink:'#ffe7a6',bg:'#070705',key:[231,831,682,712],details:[231,488,634,885,812,844],cta:[877,940,516]}
});
const cache=new Map();
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function safeLink(s){try{const u=new URL(String(s));return u.protocol==='https:'?u.toString():'https://zvm.onrender.com/cliente';}catch{return 'https://zvm.onrender.com/cliente';}}
function piece(name,x,y,w,h){return {name,x,y,w,h};}
function regions(tone){
 const g=GEOMETRY[tone];if(!g)throw new Error('approved_tone_required');
 const [a,b,c,d]=g.key,[e,f,h,i,j,k]=g.details,[m,n,z]=g.cta;
 if(!(c>0&&d>c&&j>d&&k>j&&m>k&&n>m&&n<1536))throw new Error('invalid_art_geometry');
 return [piece('hero',0,0,1024,c),piece('key-left',0,c,a,d-c),piece('key-bg',a,c,b-a,d-c),piece('key-right',b,c,1024-b,d-c),piece('bridge',0,d,1024,j-d),piece('plan-left',0,j,e,k-j),piece('plan-bg',e,j,f-e,k-j),piece('plan-middle',f,j,h-f,k-j),piece('valid-bg',h,j,i-h,k-j),piece('plan-right',i,j,1024-i,k-j),piece('guide-head',0,k,1024,m-k),piece('copy-button',0,m,z,n-m),piece('portal-button',z,m,1024-z,n-m),piece('rest',0,n,1024,1536-n)];
}
async function decorativeSlices(tone){
 if(!GEOMETRY[tone])throw new Error('approved_tone_required');
 if(!cache.has(tone))cache.set(tone,(async()=>{
  const filename=path.join(DIR,tone+'.jpg');
  if(!fs.existsSync(filename))throw new Error('original_art_missing');
  const meta=await sharp(filename).metadata();
  if(meta.width!==1024||meta.height!==1536)throw new Error('original_art_geometry_mismatch');
  // Keep all 14 original URLs alive: previously delivered emails reference
  // them. Newly composed emails consume one additional seamless "details"
  // strip instead of the five fragile adjacent IMG / TD slices.
  const [, , , , top, bottom]=GEOMETRY[tone].details;
  const current=regions(tone);
  const segments=await Promise.all([...current,piece('details',0,top,1024,bottom-top)].map(async a=>({...a,buffer:await sharp(filename).extract({left:a.x,top:a.y,width:a.w,height:a.h}).jpeg({quality:94,mozjpeg:true}).toBuffer()})));
  return Object.fromEntries(segments.map(s=>[s.name,s]));
 })().catch(e=>{cache.delete(tone);throw e;}));
 return cache.get(tone);
}
function image(name,a,alt=''){
 return '<img src="__ZVM_SLICE_'+name+'__" width="'+a.w+'" height="'+a.h+'" alt="'+esc(alt)+'" style="display:block;border:0;width:100%;height:auto;max-width:none">';
}
function imageCell(name,a,tone){
 // Gmail Android shows white fallback strips around ultra-short image cells
 // unless their own TD supplies explicit bgcolor + inline background-color.
 const fallback=tone==='pro'?'#e8eeeb':tone==='enterprise'?'#020200':'#000802';
 // Short 20-32px strips fail as IMG on Gmail Android and become bright
 // broken-image placeholders. Use the original as optional CSS/HTML
 // background on a native dark/white cell; when blocked, the cell stays
 // correctly colored without ever displaying a broken-image widget.
 const shortGap=(name==='plan-middle'||name==='plan-right');
 const token='__ZVM_SLICE_'+name+'__';
 return '<td width="'+a.w+'" bgcolor="'+fallback+'"'+(shortGap?' background="'+token+'"':'')+' style="padding:0;font-size:0;line-height:0;vertical-align:middle;width:'+(a.w/1024*100).toFixed(5)+'%;background-color:'+fallback+(shortGap?';background-image:url('+token+');background-repeat:no-repeat;background-size:100% 100%':'')+'">'+(shortGap?'':image(name,a))+'</td>';
}
function liveCell(field,content,tone,a){
 const c=GEOMETRY[tone],token='__ZVM_SLICE_'+a.name+'__';
 return '<td width="'+a.w+'" valign="middle" align="center" background="'+token+'" style="padding:0;width:'+(a.w/1024*100).toFixed(5)+'%;background-color:'+c.bg+';background-image:url('+token+');background-position:center;background-repeat:no-repeat;background-size:100% 100%;vertical-align:middle">'
 +'<span class="zvm-'+field+'" data-zvm-live="'+field+'" style="display:block;color:'+c.ink+';font-family:'+(field==='key'?'Consolas,Menlo,monospace':'Arial,Helvetica,sans-serif')+';font-size:'+(field==='key'?'16':'14')+'px;line-height:1;font-weight:800;text-align:center;overflow-wrap:anywhere">'+esc(content)+'</span></td>';
}
// Gmail Android: the previous 5-column 20–32px IMG composition produced
// white horizontal bands, including when images were otherwise loaded.
// One full-width source-art background is now the ONLY visual surface.
// A single inline row holds transparent text columns; no decorative TDs,
// overlapping images, absolute positioning or rasterized license values.
// Source artwork remains byte-for-byte unchanged.
function detailsBlock(tone,plan,validity){
 const c=GEOMETRY[tone];if(!c)throw new Error('approved_tone_required');
 const [planLeft,planRight,validLeft,validRight]=c.details;
 const token='__ZVM_SLICE_details__';
 const bg=tone==='pro'?'#e8eeeb':tone==='enterprise'?'#020200':'#000802';
 const pct=w=>(w*100/1024).toFixed(5)+'%';
 const gap=w=>'<span aria-hidden="true" style="display:inline-block;width:'+pct(w)+';font-size:0;line-height:0;vertical-align:middle"></span>';
 const live=(field,value,w)=>{
  const pad=tone==='enterprise'?'padding:3px 0;':'';
  return '<span style="display:inline-block;width:'+pct(w)+';font-size:0;line-height:0;vertical-align:middle;overflow:hidden">'
   +'<span class="zvm-'+field+'" data-zvm-live="'+field+'" style="display:block;color:'+c.ink+';font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.05;font-weight:800;text-align:center;white-space:nowrap;'+pad+'">'
   +esc(value)+'</span></span>';
 };
 const row=gap(planLeft)+live('plan',plan,planRight-planLeft)+gap(validLeft-planRight)
  +live('validity',validity,validRight-validLeft)+gap(1024-validRight);
 return '<tr><td width="1024" bgcolor="'+bg+'" background="'+token+'"'
  +' style="padding:0;font-size:0;line-height:0;vertical-align:middle;background-color:'+bg+';background-image:url('+token+');background-repeat:no-repeat;background-size:100% 100%">'
  +'<div style="margin:0;padding:0;line-height:0;font-size:0;white-space:nowrap">'+row+'</div></td></tr>';
}
function strip(content){return '<tr><td bgcolor="#080e0b" style="padding:0;font-size:0;line-height:0;background-color:#080e0b"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#080e0b" style="table-layout:fixed;border-collapse:collapse;border-spacing:0;width:100%;background-color:#080e0b"><tr>'+content+'</tr></table></td></tr>';}
function createPixelPerfectEmail({subject,tone,code,plan,validity,portal,renewed}={}){
 if(!GEOMETRY[tone])throw new Error('approved_tone_required');
 const t=Object.fromEntries(regions(tone).map(x=>[x.name,x]));
 const url=safeLink(portal),copy=safeLink(url.split('#')[0].split('?')[0]+'?copy=1');
 const header='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(subject)+'</title><style type="text/css">@media screen and (max-width:520px){.zvm-key{font-size:10px!important}.zvm-plan,.zvm-validity{font-size:9px!important}}</style></head><body style="margin:0;padding:0;background:#080e0b">';
 const table='<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#080e0b"><tr><td align="center"><table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;max-width:640px;table-layout:fixed">';
 const full=name=>'<tr><td style="padding:0;line-height:0">'+image(name,t[name],name==='hero'?'ZVM '+esc(plan)+' — '+(renewed?'Renovação':'Pagamento aprovado'):'')+'</td></tr>';
 const key=strip(imageCell('key-left',t['key-left'],tone)+liveCell('key',code,tone,t['key-bg'])+imageCell('key-right',t['key-right'],tone));
 const details=detailsBlock(tone,plan,validity);
 const buttons=strip(['copy-button','portal-button'].map((name,i)=>{const a=t[name];return '<td width="'+a.w+'" style="padding:0;line-height:0;width:'+(a.w/1024*100).toFixed(5)+'%"><a href="'+esc(i?url:copy)+'" title="'+(i?'Acessar painel':'Copiar chave no Portal')+'" style="display:block;text-decoration:none">'+image(name,a,i?'ACESSAR PAINEL':'COPIAR CHAVE')+'</a></td>';}).join(''));
 return header+table+full('hero')+key+full('bridge')+details+full('guide-head')+buttons+full('rest')+'</table></td></tr></table></body></html>';
}
async function prepareKeyDeliveryArtwork(built,{preview=false}={}){
 if(!built||typeof built.html!=='string')throw new Error('invalid_license_email');
 if(!built.artwork)return {html:built.html,attachments:[]};
 if(built.artwork.backgroundOriginal===true){
  // Original artwork is an external CSS/HTML background, not an attachment
  // or IMG tag. Do not silently regress to attached slices or generic HTML.
  const expected='https://zvm.onrender.com/assets/zvm-email-art/r46-73/'+built.artwork.tone+'/original.jpg';
  if(!built.html.includes('data-zvm-whole-art="1"') ||
    built.html.split(expected).length<3 ||
    /<\s*(?:img|svg|script)\b|cid:|data:image\/|__ZVM_SLICE_/i.test(built.html))
    throw new Error('approved_original_background_invalid');
  return {html:built.html,attachments:[]};
 }
 if(built.artwork.native===true){
  // Fail closed: if a future change reintroduces image/cid/svg or scripts,
  // stop both the Analytics test and a live commercial message.
  if(!built.html.includes('data-zvm-native-mail="1"')||/<\s*(?:img|svg|script)\b|cid:|data:image\/|__ZVM_SLICE_/i.test(built.html))
   throw new Error('native_license_html_invalid');
  return {html:built.html,attachments:[]};
 }
 const tone=built.artwork.tone;
 if(!built.html.includes('__ZVM_SLICE_hero__')||!built.html.includes('__ZVM_SLICE_rest__')
    ||!built.html.includes('__ZVM_SLICE_details__'))throw new Error('approved_artwork_slice_missing');
 // Analytics gets self-contained preview data. Customer emails use immutable
 // first-party HTTPS art URLs instead of attachments. The 14 historical slices
 // stay accessible for already-delivered mail; new mail uses the full details
 // background and never assembles that strip from individual JPEG cells.
 // No personalized license data is placed in an image URL, cache key or file.
 const pieces=await decorativeSlices(tone);let html=built.html;
 for(const [name,p] of Object.entries(pieces)){
  const token='__ZVM_SLICE_'+name+'__';
  // Historical resources remain served to old mail, but are not embedded
  // into new messages that only reference the single details slice.
  if(!html.includes(token))continue;
  const remote='https://zvm.onrender.com/assets/zvm-email-art/r46-69/'+tone+'/'+name+'.jpg';
  html=html.split(token).join(preview?'data:image/jpeg;base64,'+p.buffer.toString('base64'):remote);
 }
 if(/__ZVM_SLICE_[a-z-]+__/.test(html))throw new Error('unresolved_approved_artwork_slice');
 return {html,attachments:[]};
}
module.exports={GEOMETRY,createPixelPerfectEmail,prepareKeyDeliveryArtwork,decorativeSlices,regions};
