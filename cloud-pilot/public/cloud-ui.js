'use strict';
/* ZVM Cloud R20 — interface de trabalho baseada na navegação da extensão R17.
 * Não transporta APIs de WhatsApp Web nem simula execução ou envio. */
(()=>{
 const $=id=>document.getElementById(id);
 const PAGES=Object.freeze({
  summary:['Painel de controle','Visão dos dados reais guardados na sua conta.','VISÃO GERAL','layout-dashboard'],
  campaigns:['Disparos','Monte sua audiência e revise a mensagem antes de salvar.','AUTOMAÇÕES','send'],
  flows:['Fluxos','Organize seus fluxos importados e suas definições.','AUTOMAÇÕES','workflow'],
  funnels:['Funis','Estruture as etapas do atendimento.','AUTOMAÇÕES','git-branch'],
  crm:['CRM','Seus pipelines, colunas e contatos importados.','GESTÃO','columns'],
  labels:['Etiquetas','Identifique e organize os registros da sua conta.','GESTÃO','tag'],
  contacts:['Contatos','Gerencie a sua base de contatos e números.','GESTÃO','users'],
  library:['Biblioteca','Conteúdos salvos e seus anexos vinculados.','CONTEÚDO','library'],
  quickReplies:['Respostas rápidas','Mensagens reutilizáveis organizadas.','CONTEÚDO','message-square'],
  agenda:['Agenda','Consulte seus planejamentos sem execução automática.','CONTEÚDO','calendar'],
  migration:['Importação','Analise backups da extensão antes de confirmar.','SISTEMA','download'],
  integration:['WhatsApp oficial','Estado da integração empresarial e das permissões.','SISTEMA','link'],
  settings:['Configurações','Preferências do espaço de trabalho.','SISTEMA','settings']
 });
 const ICONS=Object.freeze({
  'layout-dashboard':'M4 4h7v7H4z M14 4h6v4h-6z M14 11h6v9h-6z M4 14h7v6H4z',
  send:'M3 11 21 3 13 21 10 14 3 11z M10 14 21 3',
  workflow:'M6 3v6 M18 15v6 M6 9h12v6 M3 3h6v6H3z M15 15h6v6h-6z',
  'git-branch':'M6 3v12a6 6 0 0 0 6 6h3 M6 6h10v6 M3 3h6v6H3z M13 9h6v6h-6z',
  columns:'M4 4h7v16H4z M14 4h6v16h-6z',
  tag:'M20 13 13 20 3 10V4h6z M7.5 7.5h.01',
  users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 11a4 4 0 0 0 0-8 M22 21v-2a4 4 0 0 0-3-3.87',
  library:'M4 3h5v18H4z M11 3h5v18h-5z M18 6l3 1-3 14-3-1z',
  'message-square':'M4 4h16v13H8l-4 4z M8 9h8 M8 13h5',
  calendar:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16',
  download:'M12 3v12 M7 10l5 5 5-5 M4 18v3h16v-3',
  link:'M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2',
  settings:'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.2 2.2 M16.2 16.2l2.2 2.2 M18.4 5.6l-2.2 2.2 M7.8 16.2l-2.2 2.2 M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8'
 });
 const ICON_NS='http://www.w3.org/2000/svg';
 function icon(key){
  const svg=document.createElementNS(ICON_NS,'svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');
  svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');
  svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
  svg.setAttribute('aria-hidden','true');svg.classList.add('cloud-nav-icon');
  const path=document.createElementNS(ICON_NS,'path');path.setAttribute('d',ICONS[key]||ICONS['layout-dashboard']);svg.append(path);
  return svg;
 }
 function select(page){
  if(!Object.hasOwn(PAGES,page))return;
  const [title,subtitle,category]=PAGES[page];
  if($('cloudPageTitle'))$('cloudPageTitle').textContent=title;
  if($('cloudPageSubtitle'))$('cloudPageSubtitle').textContent=subtitle;
  if($('cloudPageCategory'))$('cloudPageCategory').textContent=category+' • ZVM CLOUD';
  document.querySelectorAll('.tabs button[data-page]').forEach(b=>{
   if(b.dataset.page===page)b.setAttribute('aria-current','page');
   else b.removeAttribute('aria-current');
  });
  if(location.hash!=='#'+page)history.replaceState(null,'','#'+page);
  document.title=title+' • ZVM Cloud';
 }
 function open(page){
  const button=document.querySelector('.tabs button[data-page="'+page+'"]');
  if(!button||$('app').hidden)return;
  button.click();select(page);
 }
 function countText(value){return Number.isSafeInteger(value)&&value>=0?value.toLocaleString('pt-BR'):'—';}
 function updateSummary(data){
  if(!data||typeof data!=='object')return;
  const totals={cloudContacts:data.contacts,cloudLibrary:data.library,cloudAutomations:(data.flows||0)+(data.funnels||0)};
  for(const [id,value] of Object.entries(totals))if($(id))$(id).textContent=countText(value);
  const overview=$('cloudModulesOverview');if(!overview)return;
  overview.replaceChildren();
  for(const page of ['campaigns','flows','funnels','crm','labels','library','quickReplies','contacts','agenda']){
   const [title,subtitle,,iconKey]=PAGES[page];
   const link=document.createElement('button');link.type='button';link.className='cloud-launch-card';
   link.append(icon(iconKey));
   const body=document.createElement('span');body.className='cloud-launch-copy';
   const name=document.createElement('strong');name.textContent=title;
   const helper=document.createElement('small');helper.textContent=subtitle;
   body.append(name,helper);link.append(body);
   const total=document.createElement('span');total.className='cloud-launch-count';total.textContent=countText(data[page]);link.append(total);
   link.addEventListener('click',()=>open(page));
   overview.append(link);
  }
 }
 function dialog(opened){
  const overlay=$('cloudCommandDialog');if(!overlay)return;
  overlay.hidden=!opened;
  document.body.classList.toggle('cloud-command-open',opened);
  if(opened){$('cloudCommandInput').value='';filterCommands();$('cloudCommandInput').focus();}
  else if(document.body.classList.contains('cloud-workspace'))$('cloudCommandButton')?.focus();
 }
 function filterCommands(){
  const list=$('cloudCommandResults');const term=$('cloudCommandInput').value.trim().toLocaleLowerCase('pt-BR');
  list.replaceChildren();
  let shown=0;
  for(const [page,meta] of Object.entries(PAGES)){
   const hay=(meta[0]+' '+meta[1]+' '+meta[2]).toLocaleLowerCase('pt-BR');
   if(!hay.includes(term))continue;
   shown++;
   const b=document.createElement('button');b.type='button';b.className='cloud-command-result';
   b.append(icon(meta[3]));
   const t=document.createElement('span');const title=document.createElement('strong');title.textContent=meta[0];
   const small=document.createElement('small');small.textContent=meta[2];
   t.append(title,small);b.append(t);
   b.addEventListener('click',()=>{dialog(false);open(page);});
   list.append(b);
  }
  if(!shown){const p=document.createElement('p');p.className='muted';p.textContent='Nenhum módulo encontrado.';list.append(p);}
 }
 function init(){
  const nav=document.querySelector('.tabs');
  if(!nav||!$('app'))return;
  for(const button of nav.querySelectorAll('button[data-page]')){
   const page=button.dataset.page;
   if(!Object.hasOwn(PAGES,page))continue;
   const label=document.createElement('span');
   label.className='cloud-nav-label';
   label.textContent=PAGES[page][0];
   button.replaceChildren(icon(PAGES[page][3]),label);
   button.setAttribute('title',PAGES[page][0]);
   button.addEventListener('click',()=>select(page));
  }
  const sidebarToggle=$('cloudSidebarToggle');
  let collapsed=false;
  try{collapsed=localStorage.getItem('zvm-cloud-sidebar-collapsed')==='1';}catch{}
  const setCollapsed=value=>{
   collapsed=!!value;
   document.body.classList.toggle('cloud-menu-collapsed',collapsed);
   if(sidebarToggle){
    sidebarToggle.setAttribute('aria-expanded',String(!collapsed));
    sidebarToggle.setAttribute('aria-label',collapsed?'Expandir menu lateral':'Recolher menu lateral');
    sidebarToggle.setAttribute('title',collapsed?'Expandir menu lateral':'Recolher menu lateral');
   }
   try{localStorage.setItem('zvm-cloud-sidebar-collapsed',collapsed?'1':'0');}catch{}
  };
  setCollapsed(collapsed);
  sidebarToggle?.addEventListener('click',()=>setCollapsed(!collapsed));
  $('cloudCommandButton')?.addEventListener('click',()=>dialog(true));
  $('cloudCommandClose')?.addEventListener('click',()=>dialog(false));
  $('cloudCommandInput')?.addEventListener('input',filterCommands);
  $('cloudCommandDialog')?.addEventListener('click',event=>{
   if(event.target===$('cloudCommandDialog'))dialog(false);
  });
  document.addEventListener('keydown',event=>{
   if(event.key==='Escape'&&!$('cloudCommandDialog').hidden){event.preventDefault();dialog(false);return;}
   if(!document.body.classList.contains('cloud-workspace'))return;
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){
    event.preventDefault();dialog($('cloudCommandDialog').hidden);
   }else if(event.key==='Enter'&&!$('cloudCommandDialog').hidden&&event.target===$('cloudCommandInput')){
    event.preventDefault();$('cloudCommandResults')?.querySelector('button')?.click();
   }
  });
  window.addEventListener('zvm-cloud-ready',()=>{
   document.body.classList.add('cloud-workspace');
   const deepLink=location.hash.slice(1);
   open(Object.hasOwn(PAGES,deepLink)?deepLink:'summary');
  });
  window.addEventListener('zvm-cloud-locked',()=>{
   document.body.classList.remove('cloud-workspace');dialog(false);
  });
  window.addEventListener('zvm-cloud-data',event=>updateSummary(event.detail?.counts));
  window.addEventListener('hashchange',()=>{const page=location.hash.slice(1);if(Object.hasOwn(PAGES,page))open(page);});
 }
 init();
})();
