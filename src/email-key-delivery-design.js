'use strict';
const {displayLicensePlan}=require('./commercial-plan-labels');
const {createPixelPerfectEmail}=require('./email-pixel-fidelity');
function esc(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function httpsLink(base,path){
 try{const u=new URL(String(base));if(u.protocol!=='https:')return 'https://zvm.onrender.com/cliente';const p=String(path||'/cliente');return u.origin+(p.startsWith('/')&&!p.startsWith('//')?p:'/cliente');}catch(_){return 'https://zvm.onrender.com/cliente';}
}
function expiryPtBr(value){
 if(!value)return 'Consulte no Portal do Cliente';
 const d=new Date(value);if(!Number.isFinite(d.getTime()))return 'Consulte no Portal do Cliente';
 return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'}).format(d);
}
// Image fragments preserve the original artwork's visual identity, while all
// customer-specific data is actual, selectable HTML. No personalized raster.
// The client-approved ORIGINAL art stays pixel-faithful outside the three
// tiny blank input fields. Those fields are REAL selectable HTML, not raster.
function approvedArtworkHtml({subject,tone,code,plan,validity,portal,renewed}){
 return createPixelPerfectEmail({subject,tone,code,plan,validity,portal,renewed});
}

function buildKeyDeliveryDesign({code,planId,planLabel,maxUses,expiresAt,renewed,baseUrl,ctaPath,extensionUrl}={}){
 const info=displayLicensePlan({planId,planLabel,maxUses});
 const tone=info.tone;
 const light=tone==='pro',gold=tone==='enterprise',accent=gold?'#ffc857':'#00e98b';
 const base=light?'#eff3f0':'#050d0b',panel=light?'#ffffff':'#091713',text=light?'#11241d':'#f7fcf9',muted=light?'#536961':'#bacbc2';
 const headline=renewed?'RENOVAÇÃO CONFIRMADA':'PAGAMENTO APROVADO';
 const prehead=renewed?'Sua licença ZVM continua ativa':'Sua automação está pronta';
 const label=esc(info.label),validity=esc(expiryPtBr(expiresAt)),key=esc(String(code||'').trim().slice(0,80));
 const uses=Number(maxUses);
 const count=Number.isInteger(uses)&&uses>=1?' · '+uses+' acesso(s)':'';
 const portal=httpsLink(baseUrl,ctaPath);
 const extension=(()=>{try{const u=new URL(extensionUrl);return u.protocol==='https:'?u.toString():portal;}catch(_){return portal;}})();
 const cta='<a href="'+esc(portal)+'" style="display:inline-block;background:'+accent+';color:#03140c;font-family:Arial,sans-serif;font-weight:800;font-size:14px;padding:16px 26px;text-decoration:none;border-radius:9px;">ACESSAR MEU PAINEL &rarr;</a>';
 const secondary='<a href="'+esc(extension)+'" style="display:inline-block;color:'+accent+';font-family:Arial,sans-serif;font-weight:700;font-size:12px;text-decoration:underline;">Instalar ZVM</a>';
 const subject=renewed?'ZVM — Renovação confirmada':'ZVM — Sua licença está pronta';
 // Zero legacy HTML fallbacks for START/PRO/ENTERPRISE: the approved raster
 // is mandatory. SOLO has no artwork supplied and retains its independent
 // existing transactional email until an approved SOLO artwork is provided.
 if(!info.ambiguous && ['start','pro','enterprise'].includes(tone)){
  const art={tone,code:String(code||'').trim().slice(0,80),plan:info.label,validity:expiryPtBr(expiresAt)};
  const plainText='ZVM — '+(renewed?'Renovação confirmada':'Sua licença está pronta')+'\n\nChave: '+art.code+'\nPlano: '+art.plan+'\nValidade: '+art.validity+'\nPortal: '+portal+'\nInstalar: '+extension;
  return {subject,html:approvedArtworkHtml({subject,tone,...art,portal,extension,renewed,maxUses}),text:plainText,artwork:art,classification:info};
 }
 const html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
 +'<title>'+esc(subject)+'</title></head><body style="margin:0;padding:0;background:'+base+';font-family:Arial,Helvetica,sans-serif;">'
 +'<div style="display:none;max-height:0;overflow:hidden;opacity:0;">'+esc(prehead)+'</div>'
 +'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:'+base+';border-collapse:collapse;"><tr><td align="center" style="padding:20px 10px 38px;">'
 +'<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;border-collapse:separate;border-spacing:0;background:'+panel+';border:1px solid '+accent+';border-radius:18px;">'
 +'<tr><td style="background:'+ (light?'#07140f':'#020806') +';padding:30px 22px;text-align:center;border-bottom:3px solid '+accent+';">'
 +'<p style="color:'+accent+';font-size:30px;letter-spacing:3px;font-weight:900;margin:0;">&#8635; ZVM</p>'
 +'<p style="color:#e6eee9;font-size:12px;letter-spacing:1.4px;margin:8px 0 0;">AUTOMAÇÕES QUE TRABALHAM <strong style="color:'+accent+';">POR VOCÊ.</strong></p>'
 +'</td></tr><tr><td style="padding:30px 25px 20px;text-align:center;">'
 +'<p style="display:inline-block;background:'+accent+';color:#032015;border-radius:24px;font-size:12px;letter-spacing:1px;font-weight:900;padding:10px 16px;margin:0;">&#10003; '+headline+'</p>'
 +'<h1 style="color:'+text+';font-size:31px;line-height:1.2;margin:23px 0 8px;">'+(renewed?'Sua ZVM foi renovada!':'BEM-VINDO(A) AO')+'</h1>'
 +'<p style="font-weight:900;font-size:43px;letter-spacing:1px;color:'+accent+';margin:0 0 12px;">ZVM '+esc(info.tone==='neutral'?'':tone==='enterprise'?'ENTERPRISE':tone.toUpperCase())+'</p>'
 +'<p style="color:'+muted+';font-size:14px;line-height:1.7;margin:0 0 25px;">'+(renewed?'Seu pagamento foi confirmado e a validade abaixo reflete o estado registrado da sua licença.':'Sua compra foi aprovada. A chave de ativação e sua validade estão abaixo.')+'</p>'
 +'<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;border-spacing:0;border:1px solid '+accent+';border-radius:12px;background:'+ (light?'#f6fbf7':'#03110c') +';"><tr><td style="padding:15px 18px;">'
 +'<p style="font-size:12px;font-weight:800;letter-spacing:.8px;color:'+muted+';margin:0 0 10px;text-align:left;">&#128273; CHAVE DE ATIVAÇÃO</p>'
 +'<p style="font-family:Consolas,monospace;font-weight:800;font-size:20px;line-height:1.7;letter-spacing:.4px;overflow-wrap:anywhere;word-break:break-word;color:'+ (light?'#032c1b':accent)+';margin:0;text-align:center;">'+key+'</p>'
 +'<p style="font-size:11px;color:'+muted+';margin:8px 0 0;">Selecione e copie sua chave para ativar a extensão.</p>'
 +'</td></tr></table>'
 +'<table role="presentation" cellpadding="0" cellspacing="8" width="100%" style="margin:14px 0 20px;"><tr><td width="50%" style="background:'+base+';border:1px solid '+accent+';border-radius:10px;padding:15px 12px;text-align:left;vertical-align:top;">'
 +'<p style="font-size:11px;letter-spacing:1px;color:'+muted+';margin:0 0 6px;">PLANO</p><p style="color:'+text+';font-size:17px;font-weight:900;margin:0;overflow-wrap:anywhere;">'+label+esc(count)+'</p>'
 +'</td><td width="50%" style="background:'+base+';border:1px solid '+accent+';border-radius:10px;padding:15px 12px;text-align:left;vertical-align:top;">'
 +'<p style="font-size:11px;letter-spacing:1px;color:'+muted+';margin:0 0 6px;">VALIDADE</p><p style="color:'+text+';font-size:17px;font-weight:900;margin:0;">'+validity+'</p>'
 +'</td></tr></table>'+cta+'<p style="margin:15px 0 25px;">'+secondary+'</p>'
 +'<div style="border-top:1px solid '+accent+';padding-top:20px;text-align:left;">'
 +'<p style="color:'+accent+';font-weight:900;font-size:15px;margin:0 0 12px;">// COMO COMEÇAR</p>'
 +'<p style="color:'+text+';font-size:13px;line-height:1.9;margin:0;">1. Instale a ZVM pelo link oficial.<br>2. Entre no Portal do Cliente com o e-mail da compra.<br>3. Se necessário, vincule a chave no portal.</p>'
 +'<p style="color:'+accent+';font-weight:900;font-size:15px;margin:22px 0 10px;">// GERENCIE SUA LICENÇA</p>'
 +'<p style="color:'+text+';font-size:13px;line-height:1.8;margin:0;">Consulte a validade, veja os dispositivos conectados e acompanhe sua renovação pelo portal.</p>'
 +'</div></td></tr><tr><td style="background:'+ (light?'#dcebe2':'#020806')+';padding:20px;text-align:center;border-top:1px solid '+accent+';">'
 +'<p style="color:'+ (light?'#134a2d':'#d3e8da')+';font-size:12px;line-height:1.7;margin:0;">ZVM • AUTOMAÇÕES QUE TRABALHAM POR VOCÊ.<br>Mensagem transacional. Não compartilhe sua chave publicamente.</p>'
 +'</td></tr></table></td></tr></table></body></html>';
 return {subject,html,classification:info};
}
module.exports={buildKeyDeliveryDesign,expiryPtBr};
