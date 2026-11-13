'use strict';
const { dictionaries } = require('./i18n-copy');
const allowed = new Set(['pt-BR','pt-PT','en']);
// SVG icons do not depend on OS emoji fonts (Windows may render regional indicators as BR/PT/US).
function languageFlagSvg(locale) {
  const shapes = {
    'pt-BR':'<rect width="24" height="16" fill="#129447"/><path d="M12 1.4 22.1 8 12 14.6 1.9 8Z" fill="#FFDF39"/><circle cx="12" cy="8" r="4.1" fill="#1649A4"/><path d="M8.2 7.3Q12.2 5.5 15.7 8.9" stroke="white" stroke-width=".9" fill="none"/>',
    'pt-PT':'<rect width="24" height="16" fill="#E12635"/><rect width="9.8" height="16" fill="#066C48"/><circle cx="9.8" cy="8" r="4.3" fill="#F6D34D"/><circle cx="9.8" cy="8" r="3.1" fill="#FFF"/><path d="M7.7 5.5h4.2v3.7c0 1.5-1.3 2.3-2.1 2.8-.8-.5-2.1-1.3-2.1-2.8z" fill="#CC2439"/>',
    en:'<rect width="24" height="16" fill="#FFF"/>'+Array.from({length:7},(_,i)=>`<rect x="0" y="${(i*2.46).toFixed(2)}" width="24" height="1.22" fill="#BA2541"/>`).join('')+'<rect width="10.6" height="8.7" fill="#283A79"/><g fill="white"><circle cx="2.4" cy="2" r=".55"/><circle cx="5.3" cy="2" r=".55"/><circle cx="8.2" cy="2" r=".55"/><circle cx="2.4" cy="4.4" r=".55"/><circle cx="5.3" cy="4.4" r=".55"/><circle cx="8.2" cy="4.4" r=".55"/><circle cx="2.4" cy="6.8" r=".55"/><circle cx="5.3" cy="6.8" r=".55"/><circle cx="8.2" cy="6.8" r=".55"/></g>'
  };
  return `<svg viewBox="0 0 24 16" width="24" height="16" focusable="false" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" role="presentation">${shapes[locale]||shapes['pt-BR']}</svg>`;
}
const languageNames = Object.freeze({
 'pt-BR':{'pt-BR':'Português (Brasil)','pt-PT':'Português (Portugal)',en:'Inglês'},
 'pt-PT':{'pt-BR':'Português (Brasil)','pt-PT':'Português (Portugal)',en:'Inglês'},
 en:{'pt-BR':'Portuguese (Brazil)','pt-PT':'Portuguese (Portugal)',en:'English'}
});
function parseLocale(raw) {
  const tag=String(raw||'').trim().replace(/_/g,'-').toLowerCase();
  if(tag === 'pt-pt')return 'pt-PT';
  if(tag === 'pt-br' || tag === 'pt')return 'pt-BR';
  if(tag === 'en' || tag.startsWith('en-'))return 'en';
  return null;
}
function resolvePublicLocale(req={}) {
  const url=new URL(String(req.url||'/'),'https://zvm.invalid');
  const query=url.searchParams.get('lang');
  // Explicit query must use one of the supported language codes; invalid codes are ignored.
  if(query && allowed.has(query))return {locale:query,persist:true};
  const cookie=String(req.headers?.cookie||'').match(/(?:^|;\s*)zvm_lang=(pt-BR|pt-PT|en)(?:;|$)/);
  if(cookie)return {locale:cookie[1],persist:false};
  const list=String(req.headers?.['accept-language']||'').split(',').slice(0,20).map((item,index)=>{
    const [language,...params]=item.trim().split(';');
    const found=params.join(';').match(/(?:^|;)\s*q\s*=\s*(0(?:\.\d+)?|1(?:\.0+)?)/i);
    return {locale:parseLocale(language),q:found?Number(found[1]):1,index};
  }).filter(x=>x.locale&&x.q>0).sort((a,b)=>b.q-a.q||a.index-b.index);
  return {locale:list[0]?.locale||'pt-BR',persist:false};
}
function languageOptionsMarkup(locale,path='/') {
  const url=new URL(String(path||'/'),'https://zvm.invalid');
  const safePath=/^\/(?:[a-z0-9/_-]{0,80})$/i.test(url.pathname)?url.pathname:'/';
  // Preserve the public login/register return path without carrying arbitrary query parameters.
  const redirect=url.searchParams.get('redir');
  const resetToken=url.searchParams.get('token');
  const suffix=safePath==='/cliente/redefinir' && resetToken && /^[a-f0-9]{32,64}$/.test(resetToken)
    ? '&amp;token='+resetToken
    : safePath.startsWith('/cliente') && redirect && /^\/(?:[a-z0-9/_-]{0,100})$/i.test(redirect)
    ? '&amp;redir='+encodeURIComponent(redirect):'';
  const label = locale === 'en' ? 'Choose language' : 'Escolher idioma';
  const current=allowed.has(locale)?locale:'pt-BR';
  const names=languageNames[current];
  const choices = [...allowed].map(lang => `<a href="${safePath}?lang=${lang}${suffix}" hreflang="${lang}" lang="${lang}"${lang===current?' aria-current="true"':''}><span aria-hidden="true" class="zvm-language-flag">${languageFlagSvg(lang)}</span><span>${names[lang]}</span></a>`).join('');
  return `<details class="zvm-language" data-zvm-language><summary aria-label="${label}" title="${names[current]}"><span class="zvm-language-flag" aria-hidden="true">${languageFlagSvg(current)}</span><span aria-hidden="true">⌄</span></summary><div class="zvm-language-list">${choices}</div></details>`;
}
// Replace only whole visible text nodes, never scripts, styles, HTML attributes, or dynamic customer/payment data.
// This is a transitional integration for server templates; long-term content moves to keyed renderers.
function translateDynamicLabel(value,locale) {
  // R47.00 FAQ counts are dynamic. Translate only the numeric UI labels,
  // never the license/product records or HTML attributes.
  const available=value.match(/^(\d+) perguntas disponíveis\.$/);
  if(available && locale==='en')return available[1]+' questions available.';
  const matching=value.match(/^(\d+) de (\d+) perguntas encontradas\.$/);
  if(matching && locale==='en')return matching[1]+' of '+matching[2]+' questions found.';
  const topic=value.match(/^(\d+) perguntas$/);
  if(topic && locale==='en')return topic[1]+' questions';
  const answers=value.match(/^(\d+) respostas$/);
  if(answers && locale==='en')return answers[1]+' answers';
  const count=value.match(/^(\d+) (número|números) de WhatsApp$/);
  if(count && locale==='en')return `${count[1]} WhatsApp ${Number(count[1])===1?'number':'numbers'}`;
  const cost=value.match(/^(R\$ [\d.,]+) por número$/);
  if(cost && locale==='en')return `${cost[1]} per number`;
  const days=value.match(/^(\d+) dias de acesso$/);
  if(days && locale==='en')return `${days[1]} days of access`;
  if(value.startsWith('Última atualização: ') && locale!=='pt-BR') {
    const formatted=new Intl.DateTimeFormat(locale==='en'?'en-US':'pt-PT',{month:'long',year:'numeric'}).format(new Date());
    return (locale==='en'?'Last updated: ':'Última atualização: ')+formatted;
  }
  if(value==='🔒 Entre para comprar')return locale==='en'?'🔒 Sign in to buy':locale==='pt-PT'?'🔒 Inicie sessão para comprar':value;
  return null;
}
function localizeVisibleText(html,locale) {
  const dict=dictionaries[locale]||dictionaries['pt-BR'];
  const attr=(tag) => tag.replace(/\b(aria-label|alt|title|placeholder)="([^"]+)"/g,(full,name,value)=>{
    const translation=dict.get(value);
    return translation?`${name}="${translation.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"`:full;
  });
  return String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<[^>]*>|[^<]+/gi, token=>{
    if(token.startsWith('<'))return token.startsWith('<script')||token.startsWith('<style')?token:attr(token);
    const normalized=token.trim();
    const alert=normalized.match(/^([⚠✅]\s*)(.+)$/);
    const translated=dict.get(normalized)||translateDynamicLabel(normalized,locale)|| (alert && dict.get(alert[2]) ? alert[1]+dict.get(alert[2]) : null);
    return translated?token.replace(normalized,translated):token;
  });
}
const metaDescriptions = Object.freeze({
  '/': {
    'pt-BR':'Organize clientes, mensagens e tarefas no WhatsApp Web com a ZVM - Automações.',
    'pt-PT':'Organize clientes, mensagens e tarefas no WhatsApp Web com a ZVM - Automações.',
    en:'Organize customers, messages, and daily tasks on WhatsApp Web with ZVM.'
  },
  '/planos': {
    'pt-BR':'Compare os planos da ZVM para 1, 3, 5 ou 10 números de WhatsApp. Instalação gratuita e ativação com licença.',
    'pt-PT':'Compare os planos ZVM para 1, 3, 5 ou 10 números de WhatsApp. Instalação gratuita e ativação com licença.',
    en:'Compare ZVM plans for 1, 3, 5, or 10 WhatsApp numbers. Free installation; a license is required to activate.'
  },
  '/privacidade': {
    'pt-BR':'Saiba como a ZVM trata dados de conta, licenciamento e segurança e respeita a sua privacidade.',
    'pt-PT':'Saiba como a ZVM trata dados da conta, licença e segurança e protege a sua privacidade.',
    en:'Learn how ZVM handles account, licensing, and security data and protects your privacy.'
  },
  '/termos': {
    'pt-BR':'Termos de Serviço da ZVM - Automações: licenças, pagamentos, automações, privacidade e integrações.',
    'pt-PT':'Termos de Serviço da ZVM - Automações: licenças, pagamentos, utilização responsável, privacidade e integrações.',
    en:'ZVM - Automações Terms of Service covering licenses, payments, responsible use, privacy, and integrations.'
  },
  '/faq': {
    'pt-BR':'Tire suas dúvidas sobre instalação, planos, licenças e suporte da ZVM.',
    'pt-PT':'Esclareça dúvidas sobre instalação, planos, licenças e apoio da ZVM.',
    en:'Find answers about ZVM installation, plans, licenses, and support.'
  }
});
function localizePublicHtml(raw,locale,{path='/'}={}) {
  const lang=allowed.has(locale)?locale:'pt-BR';
  let html=localizeVisibleText(raw,lang);
  html=html.replace(/<html lang="[^"]*"/i,`<html lang="${lang}"`);
  if(path==='/planos' && lang!=='pt-BR') {
    const note=lang==='en'?'Prices are shown in Brazilian reais (BRL).':'Os preços são apresentados em reais brasileiros (BRL).';
    html=html.replace(/(<section class="pricing-grid"[^>]*>[\s\S]*?<\/section>)/, '$1<p class="zvm-currency-note">'+note+'</p>');
  }
  if(path==='/privacidade' && lang==='en')html=html.replace('<h1>Privacy <span class="privacy-accent">Privacy</span></h1>','<h1>Privacy <span class="privacy-accent">Policy</span></h1>');
  const desc=metaDescriptions[path]?.[lang];
  if(desc)html=html.replace(/(<meta\s+name="description"\s+content=")[^"]*(")/i,(_,before,after)=>before+desc+after);
  // Nav uses the same source renderer on public pages. Do not insert a second menu.
  const picker=languageOptionsMarkup(lang,path);
  html=html.replace(/(<nav\s+class="znav[^"]*"[^>]*>[\s\S]*?)<\/nav>/i, (_,nav)=>nav+picker+'</nav>');
  html=html.replace('</head>','<link rel="stylesheet" href="/assets/zvm-i18n-public.5c4469481130.css"></head>');
  return html;
}
function localizeAuthHtml(raw,locale,{path='/cliente'}={}) {
  const lang=allowed.has(locale)?locale:'pt-BR';
  let html=localizeVisibleText(raw,lang);
  html=html.replace(/<html lang="[^"]*"/i,`<html lang="${lang}"`);
  const picker=languageOptionsMarkup(lang,path);
  html=html.replace(/<body([^>]*)>/i,(_,attrs)=>`<body${attrs}><div class="zvm-auth-language">${picker}</div>`);
  html=html.replace('</head>','<link rel="stylesheet" href="/assets/zvm-i18n-public.5c4469481130.css"></head>');
  return html;
}
function setLanguageCookie(res,locale,secure) {
  if(!allowed.has(locale))return;
  const value='zvm_lang='+locale+'; Path=/; Max-Age=31536000; SameSite=Lax'+(secure?'; Secure':'');
  const previous=res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie',previous?([].concat(previous,value)):value);
}
module.exports={resolvePublicLocale,localizePublicHtml,localizeAuthHtml,languageOptionsMarkup,setLanguageCookie};
