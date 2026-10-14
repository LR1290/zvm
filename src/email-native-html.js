'use strict';
// R46.72: transactional email intentionally contains NO image, SVG, CID,
// attachment, JS or remote artwork. All typography, frames and information
// are real HTML/CSS. This is not a bitmap reproduction of the original art.
const THEMES=Object.freeze({
 start:{a:'#00f0a0',a2:'#54ffd0',paper:'#06140f',panel:'#091e16',surface:'#03110c',fg:'#f2fff8',muted:'#b3d1c3',line:'#19b57d',ink:'#032117',gradient:'linear-gradient(130deg,#052519,#020a07 55%,#09291a)',button:'#00e99b',soft:'#bfffe4',tag:'#02190f',label:'START'},
 pro:{a:'#04b878',a2:'#16f4a1',paper:'#eefaf4',panel:'#ffffff',surface:'#f2fbf7',fg:'#0c2519',muted:'#345a4c',line:'#20ae7c',ink:'#052c1b',gradient:'linear-gradient(130deg,#ffffff,#e6fff1 55%,#d4f9e5)',button:'#00e99b',soft:'#094c31',tag:'#061b12',label:'PRO'},
 enterprise:{a:'#f7c455',a2:'#ffe6a3',paper:'#0c0a07',panel:'#151106',surface:'#080702',fg:'#fff4d4',muted:'#dec69b',line:'#a98337',ink:'#221600',gradient:'linear-gradient(130deg,#161003,#030302 53%,#211a08)',button:'#edba4d',soft:'#ffdf9c',tag:'#080701',label:'ENTERPRISE'}
});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function validHttps(input){try{const x=new URL(String(input));return x.protocol==='https:'?x.href:'https://zvm.onrender.com/cliente';}catch{return 'https://zvm.onrender.com/cliente';}}
function tcell(body,style='',attrs=''){return '<td '+attrs+' style="'+style+'">'+body+'</td>';}
function tr(body){return '<tr>'+body+'</tr>';}
function table(rows,style='',attrs=''){return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '+attrs+' style="border-collapse:collapse;'+style+'">'+rows+'</table>';}
function p(text,style){return '<p style="margin:0;'+style+'">'+text+'</p>';}
function full(content,css=''){return tr(tcell(content,css));}
function box(body,theme,extra=''){return table(full(body,'padding:18px 20px;'), 'width:100%;border:1px solid '+theme.line+';border-radius:11px;background-color:'+theme.surface+';'+extra,'width="100%"');}
function nativeLicenseHtml({subject,tone,code,plan,validity,portal,extension,renewed=false}={}){
 const c=THEMES[tone];if(!c)throw new Error('native_license_tone_required');
 const key=String(code??'').trim(),label=String(plan??'').trim(),date=String(validity??'').trim();
 if(!key||!label||!date||key.length>100)throw new Error('native_license_field_required');
 const go=validHttps(portal),install=validHttps(extension||go);
 const isRenewal=!!renewed,flag=isRenewal?'RENOVAÇÃO CONFIRMADA':'PAGAMENTO APROVADO';
 const muted='color:'+c.muted+';font-family:Arial,Helvetica,sans-serif;';
 const mono='font-family:Consolas,Menlo,Monaco,monospace;';
 const prehead='ZVM '+label+' · '+flag+' · Sua chave está disponível para seleção e cópia.';
 const features=table(tr(tcell('⚡ RÁPIDO','color:'+c.a2+';font-weight:700;font-size:10px;padding:0 7px 0 0;')
   +tcell('◇ SEGURO','color:'+c.a2+';font-weight:700;font-size:10px;padding:0 7px;')
   +tcell('◈ ESTÁVEL','color:'+c.a2+';font-weight:700;font-size:10px;padding-left:7px;')),'margin:7px auto 0;');
 const header=table(
  tr(tcell(
   p('MAIS TEMPO PARA O QUE IMPORTA.','font-size:9px;line-height:1.55;font-weight:800;letter-spacing:1.2px;color:'+c.a2+';max-width:130px;')
   ,'width:22%;border-left:3px solid '+c.a+';padding:8px 0 8px 13px;vertical-align:middle;','width="22%"')
  +tcell(
    p('◉ ZVM','font-size:43px;line-height:1;font-weight:900;letter-spacing:-2px;color:'+c.a2+';text-shadow:0 0 13px '+c.line+';text-align:center;')
   +p('AUTOMAÇÕES QUE TRABALHAM','font-size:9px;line-height:1.5;letter-spacing:1.4px;font-weight:800;color:'+c.fg+';text-align:center;padding-top:5px;')
   +p('POR VOCÊ.','font-size:18px;line-height:1.15;font-style:italic;font-weight:900;color:'+c.a2+';text-align:center;')
   ,'width:56%;text-align:center;vertical-align:middle;','width="56%"')
  +tcell(features,'width:22%;vertical-align:middle;text-align:center;','width="22%"')),
 'width:100%;','width="100%"');
 const paid=table(full('✓ &nbsp;'+flag,
  'background-color:'+c.button+';color:'+c.ink+';padding:12px 17px;text-align:center;font-size:13px;font-weight:900;letter-spacing:.8px;border:2px solid '+c.line+';border-radius:9px;'),
  'width:72%;margin:0 auto;','width="72%"');
 const heading=p(isRenewal?'SUA AUTOMAÇÃO CONTINUA.':'BEM-VINDO(A) AO',
  'font-size:30px;line-height:1.12;font-style:italic;font-weight:900;text-align:center;color:'+c.fg+';letter-spacing:-.8px;')
 +p('ZVM '+esc(c.label),'font-size:55px;line-height:1.14;font-style:italic;font-weight:900;letter-spacing:-1.8px;text-align:center;color:'+c.a2+';text-shadow:0 0 14px '+c.line+';')
 +p(isRenewal?'Seu pagamento foi confirmado. Confira abaixo a validade atualizada.':'Sua compra foi aprovada. Agora você pode usar sua automação e levar seus projetos a outro nível.',
 'font-size:13px;line-height:1.7;text-align:center;padding:13px 22px 0;'+muted);
 const keyBox=box(
   p('◆ &nbsp;CHAVE DE ATIVAÇÃO','font-size:13px;letter-spacing:.5px;font-weight:900;color:'+c.fg+';padding:0 0 12px;')
  +p('<code id="zvm-license-key" data-zvm-live="key" style="font-family:Consolas,Menlo,Monaco,monospace;font-size:21px;font-weight:900;line-height:1.5;color:'+c.a2+';word-break:break-all;overflow-wrap:anywhere;-webkit-user-select:text;user-select:text;">'+esc(key)+'</code>',
   'margin:0;padding:12px 6px;border:1px dashed '+c.a+';border-radius:8px;text-align:center;background-color:'+c.panel+';')
  +p('TOQUE E SEGURE A CHAVE ACIMA PARA SELECIONAR E COPIAR','font-size:10px;line-height:1.6;letter-spacing:.25px;text-align:center;padding-top:11px;font-weight:700;'+muted),
  c);
 function field(caption,field,val){return tcell(box(
  p(caption,'font-size:12px;letter-spacing:.7px;font-weight:900;color:'+c.fg+';padding-bottom:10px;')
  +p('<span data-zvm-live="'+field+'" style="font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:1.35;font-weight:900;color:'+c.a2+';word-break:break-word;-webkit-user-select:text;user-select:text">'+esc(val)+'</span>',
   'font-size:16px;text-align:center;background-color:'+c.panel+';border:1px dashed '+c.line+';border-radius:7px;padding:9px 3px;'),
  c),
  'width:50%;vertical-align:top;'+(field==='plan'?'padding-right:6px':'padding-left:6px'), 'width="50%"');}
 const details=table(tr(field('▣ &nbsp;PLANO','plan',label)+field('▦ &nbsp;VALIDADE','validity',date)),
 'width:100%;','width="100%"');
 const portalBtn=table(full('<a href="'+esc(go)+'" style="display:block;background-color:'+c.button+';color:'+c.ink+';border:1px solid '+c.a+';border-radius:10px;padding:15px 12px;text-align:center;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.2;font-weight:900;letter-spacing:.5px">▷ &nbsp; PORTAL DO CLIENTE</a>'),
 'width:100%;','width="100%"');
 const how=table(
  tr(tcell('01','font-size:22px;color:'+c.a2+';font-weight:900;width:33px;vertical-align:top;', 'width="33"')+tcell('Instale a ZVM pelo link oficial.','font-size:12px;line-height:1.6;color:'+c.fg+';padding:1px 10px 11px 5px;'))
 +tr(tcell('02','font-size:22px;color:'+c.a2+';font-weight:900;vertical-align:top;')+tcell('Entre com o mesmo e-mail da compra.','font-size:12px;line-height:1.6;color:'+c.fg+';padding:1px 10px 11px 5px;'))
 +tr(tcell('03','font-size:22px;color:'+c.a2+';font-weight:900;vertical-align:top;')+tcell('Se necessário, vincule a chave pelo Portal do Cliente.','font-size:12px;line-height:1.6;color:'+c.fg+';padding:1px 10px 4px 5px;')),
 'width:100%;','width="100%"');
 const guide=box(
  p('〽 COMO COMEÇAR','font-size:17px;font-style:italic;font-weight:900;letter-spacing:.5px;color:'+c.a2+';padding:0 0 14px;')
  +how
  +p('GERENCIE SUA LICENÇA','font-size:13px;letter-spacing:.4px;font-weight:900;color:'+c.a2+';padding:18px 0 7px;border-top:1px solid '+c.line+';')
  +p('Validade e status &nbsp; · &nbsp; Dispositivos conectados &nbsp; · &nbsp; Renovação','font-size:12px;line-height:1.7;'+muted),
  c);
 const html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(subject||'Licença ZVM')+'</title>'
  +'<style type="text/css">@media only screen and (max-width:480px){.zvm-mail-hero{font-size:36px!important}.zvm-mail-name{font-size:38px!important}.zvm-mail-pad{padding:22px 15px!important}}</style></head>'
  +'<body data-zvm-native-mail="1" style="margin:0;padding:0;background-color:'+c.paper+';font-family:Arial,Helvetica,sans-serif;color:'+c.fg+'">'
  +'<div style="display:none;max-height:0;overflow:hidden;opacity:0;">'+esc(prehead)+'</div>'
  +table(full(
   table(
    full(header,'padding:28px 20px 23px;border-top:5px solid '+c.a+';')
   +full(paid,'padding:12px 20px 18px;')
   +full(heading,'padding:22px 11px 24px;')
   +full(keyBox,'padding:0 24px 12px;')
   +full(details,'padding:0 24px 18px;')
   +full(portalBtn,'padding:0 24px 9px;')
   +full(p('A chave acima é texto selecionável. A função de cópia automática é exclusiva do Portal após autenticação.','font-size:11px;line-height:1.55;text-align:center;'+muted),'padding:0 20px 18px;')
   +full(guide,'padding:0 24px 18px;')
   +full('<a href="'+esc(install)+'" style="color:'+c.a2+';font-size:12px;line-height:1.5;text-decoration:underline;font-weight:700;">Instalar a extensão ZVM</a>','text-align:center;padding:0 24px 22px;')
   +full(
    p('ZVM  ·  AUTOMAÇÕES QUE TRABALHAM POR VOCÊ.','font-size:14px;letter-spacing:.6px;line-height:1.5;font-weight:900;text-align:center;color:'+c.a2+';')
    +p('Mensagem transacional · Não compartilhe sua chave publicamente.','font-size:11px;line-height:1.7;text-align:center;padding:9px 0 0;'+muted),
    'padding:23px 15px 32px;background-color:'+c.surface+';border-top:2px solid '+c.a+';'),
    'width:100%;max-width:640px;background-color:'+c.panel+';border:1px solid '+c.line+';background:'+c.gradient+';', 'width="640"')
   ,'padding:20px 10px 26px;text-align:center;'),
   'width:100%;background-color:'+c.paper+';', 'width="100%"')
  +'</body></html>';
 // The native template MUST NOT leak image requests, CID, inline SVG or scripts
 // into transactional emails. Reject accidental regressions before sending.
 if(/<\s*(?:img|svg|script)\b|(?:cid:|data:image\/|__ZVM_SLICE_)/i.test(html))throw new Error('native_license_artwork_regression');
 return html;
}
module.exports={nativeLicenseHtml,THEMES};
