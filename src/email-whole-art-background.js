'use strict';
/**
 * R46.73: original user-approved art — ONE UNMODIFIED background resource.
 * No <img>, CID, inline image, remote image <a>, or attachment. The licensed
 * values are accessible/selectable HTML text over the blank fields.
 *
 * Important engineering limit: a bitmap-perfect recreation with zero image
 * resources is impossible. This uses a JPEG as a CSS/HTML background only.
 * Gmail typically renders it; clients blocking backgrounds get a readable
 * plain-color accessible layout. Do not claim 100% clients/pixel parity.
 */
const ART=Object.freeze({
 start:{bg:'#020a07',ink:'#20f5b4',key:[232,830,699,727],plan:[232,487,832,855],valid:[632,886,832,855],cta:[896,954],hit:[122,503,523,907]},
 pro:{bg:'#e8f4ee',ink:'#123c2c',key:[233,834,662,691],plan:[230,490,790,814],valid:[635,885,790,814],cta:[856,917],hit:[86,458,480,861]},
 enterprise:{bg:'#030201',ink:'#ffdfa2',key:[231,831,682,712],plan:[231,488,812,844],valid:[634,885,812,844],cta:[877,940],hit:[115,514,535,908]}
});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=n=>(100*n/1024).toFixed(5)+'%';
const scaled=n=>Math.round(n*640/1024);
function urlSafe(url){try{const u=new URL(String(url));return u.protocol==='https:'?u.href:'https://zvm.onrender.com/cliente';}catch{return 'https://zvm.onrender.com/cliente';}}
function cell(inner,css='',attr=''){return '<td '+attr+' style="'+css+'">'+inner+'</td>';}
function row(inner){return '<tr>'+inner+'</tr>';}
function tbl(inner,css='',attr=''){return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '+attr+' style="border-collapse:collapse;border-spacing:0;'+css+'">'+inner+'</table>';}
function spacer(w){return cell('&nbsp;','width:'+pct(w)+';font-size:0;line-height:0;padding:0;vertical-align:middle;','width="'+scaled(w)+'"');}
function textSlot(value,field,width,ink,size){
 return cell('<span data-zvm-live="'+field+'" style="display:block;margin:0;padding:0;font-family:'+(field==='key'?'Consolas,Monaco,monospace':'Arial,Helvetica,sans-serif')+';font-size:'+size+'px;line-height:1.05;font-weight:900;text-align:center;color:'+ink+';white-space:nowrap;-webkit-user-select:text;user-select:text;word-break:normal;">'+esc(value)+'</span>',
  'width:'+pct(width)+';padding:0;vertical-align:middle;','width="'+scaled(width)+'" align="center" valign="middle"');
}
function blankSegment(height){
 return row(cell('&nbsp;','height:'+scaled(height)+'px;min-height:'+scaled(height)+'px;padding:0;font-size:0;line-height:0;','height="'+scaled(height)+'"'));
}
function fieldSegment(g,from,to,widths,values,tone){
 let parts='',last=0;
 for(let i=0;i<widths.length;i++){
  const [x1,x2]=widths[i];if(x1<last||x2<=x1)throw new Error('art_geometry_invalid');
  if(x1>last)parts+=spacer(x1-last);
  parts+=textSlot(values[i],i===0?'key':'plan',x2-x1,g.ink,tone==='enterprise'?13:14);
  last=x2;
 }
 if(last<1024)parts+=spacer(1024-last);
 return row(cell(tbl(row(parts),'width:100%;table-layout:fixed;','width="640"'),
 'padding:0;height:'+scaled(to-from)+'px;line-height:0;vertical-align:middle;','height="'+scaled(to-from)+'"'));
}
function singleField(g,box,value,name,tone){
 const [x1,x2,top,bottom]=box;const w=x2-x1,parts=spacer(x1)+textSlot(value,name,w,g.ink,name==='key'?15:13)+spacer(1024-x2);
 return row(cell(tbl(row(parts),'width:100%;table-layout:fixed;','width="640"'),
 'height:'+scaled(bottom-top)+'px;padding:0;vertical-align:middle;','height="'+scaled(bottom-top)+'"'));
}
function detailSegment(g,plan,validity){
 const [p1,p2,top,bottom]=g.plan,[v1,v2]=g.valid;
 const parts=spacer(p1)+textSlot(plan,'plan',p2-p1,g.ink,13)+spacer(v1-p2)+textSlot(validity,'validity',v2-v1,g.ink,13)+spacer(1024-v2);
 return row(cell(tbl(row(parts),'width:100%;table-layout:fixed;', 'width="640"'),
 'height:'+scaled(bottom-top)+'px;padding:0;vertical-align:middle;','height="'+scaled(bottom-top)+'"'));
}
function ctaSegment(g,portal){
 const [left1,right1,left2,right2]=g.hit;
 const portalLink='<a href="'+esc(portal)+'" title="Portal do Cliente" aria-label="Abrir Portal do Cliente" style="display:block;padding:0;margin:0;text-decoration:none;color:transparent;background:transparent;-webkit-tap-highlight-color:transparent">'
  +'<span style="display:block;height:'+scaled(g.cta[1]-g.cta[0])+'px;font-size:0;line-height:0;overflow:hidden">&nbsp;</span></a>';
 // The baked 'COPIAR CHAVE' artwork is not made an in-email action: email clients
 // block JS/clipboard. Instead put selectable text inside the license key.
 const parts=spacer(left1)+spacer(right1-left1)+spacer(left2-right1)
  +cell(portalLink,'width:'+pct(right2-left2)+';padding:0;vertical-align:middle;', 'width="'+scaled(right2-left2)+'"')
  +spacer(1024-right2);
 return row(cell(tbl(row(parts),'width:100%;table-layout:fixed;','width="640"'),
 'padding:0;height:'+scaled(g.cta[1]-g.cta[0])+'px;','height="'+scaled(g.cta[1]-g.cta[0])+'"'));
}
function originalBackgroundHtml({subject,tone,code,plan,validity,portal,renewed}={}){
 const g=ART[tone];if(!g)throw new Error('original_art_tone_required');
 if(!String(code??'').trim()||!String(plan??'').trim()||!String(validity??'').trim())throw new Error('original_art_field_required');
 const target=urlSafe(portal);
 // Public decorative JPEG has absolutely no customer/key information.
 const art='https://zvm.onrender.com/assets/zvm-email-art/r46-73/'+tone+'/original.jpg';
 let y=0,rs='';
 const blankTo=(next)=>{if(next<y)throw new Error('art_geometry_overlap');if(next>y)rs+=blankSegment(next-y);y=next;};
 blankTo(g.key[2]);rs+=singleField(g,g.key,code,'key',tone);y=g.key[3];
 blankTo(g.plan[2]);rs+=detailSegment(g,plan,validity);y=g.plan[3];
 blankTo(g.cta[0]);rs+=ctaSegment(g,target);y=g.cta[1];
 blankTo(1536);
 // Background is ONE entire original image; not an email image attachment.
 const background='background-color:'+g.bg+';background-image:url('+art+');background-repeat:no-repeat;background-position:center top;background-size:100% 100%;';
 const master=tbl(rs,'width:640px;height:960px;table-layout:fixed;'+background,'class="zvm-whole-original" width="640" height="960" bgcolor="'+g.bg+'" background="'+art+'"');
 return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(subject||'ZVM — Sua licença está pronta')+'</title>'
  +'<style type="text/css">@media screen and (max-width:600px){.zvm-whole-original{zoom:.90!important}}'
  +'@media screen and (max-width:540px){.zvm-whole-original{zoom:.80!important}}'
  +'@media screen and (max-width:480px){.zvm-whole-original{zoom:.72!important}}'
  +'@media screen and (max-width:440px){.zvm-whole-original{zoom:.65!important}}'
  +'@media screen and (max-width:400px){.zvm-whole-original{zoom:.59!important}}'
  +'@media screen and (max-width:375px){.zvm-whole-original{zoom:.55!important}}'
  +'@media screen and (max-width:340px){.zvm-whole-original{zoom:.49!important}}</style>'
  +'</head><body data-zvm-whole-art="1" style="margin:0;padding:0;background:'+g.bg+'">'
  +tbl(row(cell(master,'padding:0;vertical-align:top;text-align:center;','align="center"')),
      'width:100%;','width="100%"')
  +'<p style="font-family:Arial,Helvetica,sans-serif;color:'+g.ink+';font-size:12px;line-height:1.6;text-align:center;margin:14px auto;max-width:640px;padding:0 12px;">'
  +'A chave exibida acima é texto selecionável. Para copiar no Gmail, selecione a chave e use Copiar. '
  +'<a href="'+esc(target)+'" style="color:'+g.ink+';text-decoration:underline;font-weight:700;">PORTAL DO CLIENTE</a>'
  +'</p></body></html>';
}
module.exports={originalBackgroundHtml,ART};
