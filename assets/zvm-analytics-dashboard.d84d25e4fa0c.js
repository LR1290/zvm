const _ANALYTICS_ROOT=document.documentElement.dataset.analyticsRoot||'/analytics';

// Gráficos são renderizados no servidor para funcionar com CSP estrita e sem CDN.

// Um único ponto que aplica busca + período + filtro real/teste — os três
// filtros escreviam direto em row.style.display cada um por conta própria
// (o segundo clique sempre apagava o efeito do primeiro). Unificado aqui
// pra combinar as três condições sem uma sobrescrever a outra.
let _periodCutoff=null,_testFilter='all';
function applyFilters(){
  const q=(document.getElementById('search').value||'').trim().toLocaleLowerCase('pt-BR');
  let visible=0,total=0;
  document.querySelectorAll('#payments-body tr[data-row]').forEach(r=>{
    total++;
    const okSearch=!q||r.dataset.row.includes(q);
    const okPeriod=!_periodCutoff||r.dataset.paid>=_periodCutoff;
    const okTest=_testFilter==='all'||(_testFilter==='test'?r.dataset.test==='1':r.dataset.test==='0');
    const show=okSearch&&okPeriod&&okTest;
    r.style.display=show?'':'none';
    if(show)visible++;
  });
  const count=document.getElementById('analytics-filter-status');
  if(count)count.textContent=visible+' de '+total+' pagamentos exibidos.';
}
function filterTable(){applyFilters();}
function selectFilterButton(btn){
  btn.parentElement.querySelectorAll('.pb').forEach(b=>{
    const active=b===btn;
    b.classList.toggle('active',active);
    b.setAttribute('aria-pressed',String(active));
  });
}
function setPeriod(days,btn){selectFilterButton(btn);_periodCutoff=days?new Date(Date.now()-days*86400000).toISOString():null;applyFilters();}
function setTestFilter(mode,btn){selectFilterButton(btn);_testFilter=mode;applyFilters();}

// ── Laboratório de Testes ────────────────────────────────────────────
function toggleLab(){
  const panel=document.getElementById('lab-body');
  const open=panel.classList.toggle('open');
  const toggle=document.getElementById('lab-toggle');
  if(toggle)toggle.setAttribute('aria-expanded',String(open));
}

function labFormData(){
  return {
    planId: document.getElementById('lab-plan').value,
    type: document.getElementById('lab-type').value,
    name: document.getElementById('lab-name').value,
    email: document.getElementById('lab-email').value,
    phone: document.getElementById('lab-phone').value,
    method: document.getElementById('lab-method').value,
  };
}

// Traduz status HTTP + payload de erro numa frase que o admin entende sem
// precisar ler stack trace nenhuma. "reason" (quando existe) é sempre uma
// string já sanitizada pelo servidor (mensagem do Resend, "RESEND_API_KEY
// não configurado", erro de rede) — nunca contém a API key nem outro segredo,
// mas fica escondida atrás de "Detalhes técnicos" mesmo assim, por hábito.
function labErrorMessage(status,data){
  if(status===401) return {short:'❌ Sessão expirada — atualize a página e entre de novo.',detail:null};
  if(status===403) return {short:'❌ Requisição bloqueada por segurança (origem inválida) — atualize a página.',detail:null};
  if(status===429){const sec=Math.max(1,Math.min(3600,Number(data&&data.retryAfterSeconds)||60));const wait=sec<60?sec+' segundos':Math.ceil(sec/60)+' minuto(s)';return {short:'⏳ Limite temporário da operação. Aguarde '+wait+' e tente novamente.',detail:null};}
  const code=(data&&data.error)||'';
  if(code==='invalid_email') return {short:'❌ Endereço de e-mail inválido.',detail:null};
  if(code==='invalid_plan') return {short:'❌ Plano inválido.',detail:null};
  if(code==='invalid_template') return {short:'❌ Template de e-mail inválido.',detail:null};
  if(status>=500) return {short:'❌ Falha interna do servidor.',detail:(data&&data.error)||null};
  return {short:'❌ Não foi possível concluir a operação.',detail:(data&&(data.reason||data.error))||null};
}

function labRenderStatus(el,msg){
  el.innerHTML='';
  const p=document.createElement('div');
  p.textContent=msg.short;
  el.appendChild(p);
  if(msg.detail){
    const d=document.createElement('details');
    d.style.marginTop='6px';
    const s=document.createElement('summary');
    s.textContent='Detalhes técnicos';
    s.style.cursor='pointer';
    const pre=document.createElement('div');
    pre.textContent=msg.detail;
    pre.style.cssText='margin-top:4px;font-family:monospace;font-size:11.5px;color:var(--muted);white-space:pre-wrap;word-break:break-word';
    d.appendChild(s);d.appendChild(pre);
    el.appendChild(d);
  }
}

function labMaskEmail(email){
  const m=String(email||'').match(/^(.)(.*)(@.*)$/);
  return m?(m[1]+'***'+m[3]):'***';
}

const _planLabels={solo:'Solo',padrao:'Padrão',pro:'Pro',empresarial:'Empresarial'};

function renderLabResult(d,executed){
  const box=document.getElementById('lab-result');
  const modeLabel=d.wouldRenew?'Renovação':'Nova licença';
  let html='<div class="lab-result"><h4>'+(executed?'✅ SIMULAÇÃO EXECUTADA':'👁 PREVIEW — nada foi gravado')+'</h4>';
  html+='<div class="row"><span>Plano</span><span>'+(_planLabels[d.planId]||d.planId)+'</span></div>';
  html+='<div class="row"><span>Valor</span><span>R$ '+d.price.toFixed(2).replace('.',',')+'</span></div>';
  html+='<div class="row"><span>Dispositivos</span><span>'+d.maxUses+'</span></div>';
  html+='<div class="row"><span>Duração</span><span>'+d.durationDays+' dias</span></div>';
  html+='<div class="row"><span>Modo</span><span>'+modeLabel+'</span></div>';
  html+='<div class="row"><span>Expira em</span><span>'+new Date(d.expiresAt).toLocaleDateString('pt-BR')+'</span></div>';
  if(executed){
    const emailRow = d.emailRequested
      ? (d.emailSent ? '✅ enviado para '+labMaskEmail(d.email) : '❌ não foi possível enviar (veja o console do servidor)')
      : '— (checkbox desmarcado)';
    html+='<div class="row"><span>E-mail</span><span>'+emailRow+'</span></div>';
  } else {
    html+='<div class="row"><span>E-mail</span><span>—</span></div>';
  }
  html+='<div class="row"><span>Persistência</span><span>'+(d.persisted?'teste (testMode:true)':'preview (nada salvo)')+'</span></div>';
  if(d.txId) html+='<div class="row"><span>Tx</span><span>'+d.txId+'</span></div>';
  if(!executed){
    const willSend=document.getElementById('lab-send-email').checked;
    const label=willSend?'▶ Executar e enviar e-mail de teste (grava testMode:true)':'▶ Executar sem enviar e-mail (grava testMode:true)';
    html+='<div class="lab-actions" style="margin-top:12px"><button class="btn blab-exec" id="lab-btn-exec" data-zvm-analytics-dynamic="labExecute">'+label+'</button></div>';
  }
  html+='</div>';
  box.innerHTML=html;
}

async function labPreview(){
  const body=labFormData();
  if(!body.email){alert('Informe um e-mail de teste.');return;}
  const btn=document.getElementById('lab-btn-sim');
  if(btn.disabled)return; // guarda contra duplo clique
  btn.disabled=true;const originalLabel=btn.textContent;btn.textContent='Processando...';
  try{
    const r=await fetch(_ANALYTICS_ROOT+'/api/lab/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(!r.ok){const msg=labErrorMessage(r.status,d);labRenderStatus(document.getElementById('lab-result'),msg);return;}
    renderLabResult(d,false);
  }catch(e){labRenderStatus(document.getElementById('lab-result'),{short:'❌ Erro de conexão com o servidor.',detail:null});}
  finally{btn.disabled=false;btn.textContent=originalLabel;}
}

async function labExecute(){
  const sendEmailChecked=document.getElementById('lab-send-email').checked;
  const confirmMsg='Isso grava um pagamento de TESTE (testMode:true) e uma chave sandbox. Nunca toca em cliente real.'
    +(sendEmailChecked?' Um e-mail de teste REAL será enviado.':' Nenhum e-mail será enviado.')+' Confirma?';
  if(!confirm(confirmMsg))return;
  const btn=document.getElementById('lab-btn-exec');
  if(!btn||btn.disabled)return; // guarda contra duplo clique (também cobre o caso do botão já ter sumido)
  btn.disabled=true;const originalLabel=btn.textContent;btn.textContent='Processando...';
  const body=labFormData();
  body.sendRealEmail=sendEmailChecked;
  try{
    const r=await fetch(_ANALYTICS_ROOT+'/api/lab/simulate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(!r.ok){const msg=labErrorMessage(r.status,d);labRenderStatus(document.getElementById('lab-result'),msg);return;}
    d.emailRequested=sendEmailChecked;
    renderLabResult(d,true);
  }catch(e){labRenderStatus(document.getElementById('lab-result'),{short:'❌ Erro de conexão com o servidor.',detail:null});}
  finally{if(btn.isConnected){btn.disabled=false;btn.textContent=originalLabel;}}
}

function labCancel(){
  document.getElementById('lab-result').innerHTML='';
  document.getElementById('lab-name').value='Cliente Teste';
  document.getElementById('lab-email').value='';
  document.getElementById('lab-phone').value='';
  document.getElementById('lab-send-email').checked=false;
}

async function labEmailPreview(btn){
  const status=document.getElementById('lab-email-status'),frame=document.getElementById('lab-iframe');
  if(btn){if(btn.disabled)return;btn.disabled=true;}
  status.textContent='Processando...';
  try{
    const r=await fetch(_ANALYTICS_ROOT+'/api/lab/email-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({template:document.getElementById('lab-tpl').value})});
    const d=await r.json();
    if(!r.ok){labRenderStatus(status,labErrorMessage(r.status,d));return;}
    frame.srcdoc=d.html;frame.style.display='block';
    status.textContent='✅ Preview gerado. Assunto: '+d.subject;
  }catch(e){labRenderStatus(status,{short:'❌ Erro de conexão com o servidor.',detail:null});}
  finally{if(btn)btn.disabled=false;}
}

async function labEmailSend(btn){
  const status=document.getElementById('lab-email-status');
  const email=document.getElementById('lab-tpl-email').value;
  if(!email){alert('Informe o destinatário.');return;}
  if(!confirm('Enviar e-mail de TESTE real para '+email+'?'))return;
  if(btn){if(btn.disabled)return;btn.disabled=true;}
  status.textContent='Processando...';
  try{
    const r=await fetch(_ANALYTICS_ROOT+'/api/lab/email-send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({template:document.getElementById('lab-tpl').value,email})});
    const d=await r.json();
    if(r.ok&&d.ok){status.textContent='✅ E-mail enviado para '+labMaskEmail(email)+'.';}
    else{labRenderStatus(status,d.reason?{short:'❌ Erro retornado pelo serviço de e-mail.',detail:d.reason}:labErrorMessage(r.status,d));}
  }catch(e){labRenderStatus(status,{short:'❌ Erro de conexão com o servidor.',detail:null});}
  finally{if(btn)btn.disabled=false;}
}

// ── Limpeza de histórico do Analytics ────────────────────────────────
const PURGE_CONFIRM_PHRASE='APAGAR HISTORICO';
let _purgeLastPreview=null; // { mode, scoped, testRecords, realRecords, totalRecords }

function purgeCurrentMode(){
  const el=document.querySelector('input[name="purge-mode"]:checked');
  return el?el.value:'test';
}

function purgeOpen(){
  const d=document.getElementById('purge-dialog');
  if(d.showModal)d.showModal();else d.setAttribute('open','');
  purgeModeChanged();
}

function purgeCancel(){
  document.getElementById('purge-dialog').close();
}

function purgeModeChanged(){
  const mode=purgeCurrentMode();
  document.querySelectorAll('.purge-opt').forEach(function(el){el.classList.toggle('selected',el.dataset.mode===mode);});
  const warn=document.getElementById('purge-warn'),confirmWrap=document.getElementById('purge-confirm-wrap'),
    confirmInput=document.getElementById('purge-confirm-input'),btn=document.getElementById('purge-exec-btn'),
    result=document.getElementById('purge-result');
  result.innerHTML='';
  confirmInput.value='';
  if(mode==='test'){
    warn.style.display='none';
    confirmWrap.style.display='none';
    btn.disabled=true; // reabilitado quando o preview carregar (não instantâneo — evita clique antes de saber quantos registros existem)
  } else {
    warn.style.display='block';
    confirmWrap.style.display='block';
    btn.disabled=true;
  }
  purgeFetchPreview(mode);
}

function purgeConfirmInputChanged(){
  const mode=purgeCurrentMode();
  if(mode==='test')return; // botão já é liberado só pelo preview nesse modo
  const ok=document.getElementById('purge-confirm-input').value===PURGE_CONFIRM_PHRASE;
  document.getElementById('purge-exec-btn').disabled=!ok||!_purgeLastPreview||_purgeLastPreview.mode!==mode;
}

async function purgeFetchPreview(mode){
  const box=document.getElementById('purge-preview');
  box.textContent='Carregando prévia...';
  _purgeLastPreview=null;
  document.getElementById('purge-exec-btn').disabled=true;
  try{
    const r=await fetch(_ANALYTICS_ROOT+'/api/purge/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:mode})});
    const d=await r.json();
    if(mode!==purgeCurrentMode()||!document.getElementById('purge-dialog').open)return;
    if(!r.ok){labRenderStatus(box,labErrorMessage(r.status,d));return;}
    _purgeLastPreview=d;
    const label={test:'de teste',real:'reais',all:'no total (testes + reais)'}[mode]||'';
    box.innerHTML='Serão removidos <strong>'+d.scoped+'</strong> registro'+(d.scoped===1?'':'s')+' '+label+'.'
      +'<br><span style="color:var(--muted);font-size:12px">payments: '+d.totalRecords+' no total · '+d.testRecords+' de teste · '+d.realRecords+' reais</span>';
    if(mode==='test'){
      document.getElementById('purge-exec-btn').disabled=d.scoped===0;
    } else {
      purgeConfirmInputChanged();
    }
  }catch(e){labRenderStatus(box,{short:'❌ Erro de conexão com o servidor.',detail:null});}
}

async function purgeExecute(){
  const mode=purgeCurrentMode();
  const btn=document.getElementById('purge-exec-btn');
  if(btn.disabled)return; // guarda contra duplo clique
  if(!_purgeLastPreview||_purgeLastPreview.mode!==mode){alert('Prévia desatualizada — feche e abra a ferramenta de novo.');return;}
  const body={mode:mode,expectedCount:_purgeLastPreview.scoped};
  if(mode!=='test')body.confirmText=document.getElementById('purge-confirm-input').value;
  btn.disabled=true;const originalLabel=btn.textContent;btn.textContent='Processando...';
  const result=document.getElementById('purge-result');
  result.innerHTML='';
  try{
    const r=await fetch(_ANALYTICS_ROOT+'/api/purge/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(!r.ok){
      if(d.error==='count_changed'){
        labRenderStatus(result,{short:'❌ A contagem mudou desde a prévia — atualizando...',detail:null});
        result.className='purge-result err';
        setTimeout(function(){purgeFetchPreview(mode);},1200);
      } else {
        labRenderStatus(result,labErrorMessage(r.status,d));
        result.className='purge-result err';
      }
      return;
    }
    result.className='purge-result ok';
    result.textContent='✅ '+d.totalDeleted+' registro'+(d.totalDeleted===1?'':'s')+' removido'+(d.totalDeleted===1?'':'s')+'. Atualizando o painel...';
    document.querySelectorAll('.purge-opt input,#purge-confirm-input,.purge-cancel').forEach(function(el){el.disabled=true;});
    setTimeout(function(){ window.location.href=_ANALYTICS_ROOT+''; },1600);
  }catch(e){
    labRenderStatus(result,{short:'❌ Erro de conexão com o servidor.',detail:null});
    result.className='purge-result err';
  }finally{
    if(btn.isConnected&&!result.classList.contains('ok')){btn.disabled=false;btn.textContent=originalLabel;}
  }
}

// R46.30: navigate within the authenticated Analytics without writing fragments into its login URL.
(function(){
  var links=[].slice.call(document.querySelectorAll('.analytics-nav a[href^="#"]'));
  if(!links.length)return;
  var map=new Map(links.map(function(a){return [a.getAttribute('href').slice(1),a]}));
  var selectedByClick=null;
  function select(link){links.forEach(function(a){
    var current=a===link;
    a.classList.toggle('active',current);
    if(current)a.setAttribute('aria-current','location');
    else a.removeAttribute('aria-current');
  });}
  links.forEach(function(link){link.addEventListener('click',function(event){
    event.preventDefault();
    var section=document.getElementById(link.getAttribute('href').slice(1));
    if(!section)return;
    selectedByClick=link.getAttribute('href').slice(1);
    select(link);
    var reduced=window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({behavior:reduced?'auto':'smooth',block:'start'});
  });});
  // Clean up old '#performance' URLs from previous builds, without touching query/session state.
  if(window.location.hash && map.has(window.location.hash.slice(1))){
    window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);
  }
  select(map.get('overview'));
  if(!('IntersectionObserver'in window))return;
  var io=new IntersectionObserver(function(entries){
    var visible=entries.filter(function(e){return e.isIntersecting}).sort(function(a,b){return b.intersectionRatio-a.intersectionRatio})[0];
    if(selectedByClick){
      var selectedSection=document.getElementById(selectedByClick);
      var bounds=selectedSection && selectedSection.getBoundingClientRect();
      if(bounds && bounds.top<window.innerHeight && bounds.bottom>0)return;
      selectedByClick=null;
    }
    if(visible)select(map.get(visible.target.id));
  },{rootMargin:'-18% 0px -65% 0px',threshold:[0,.1,.35]});
  map.forEach(function(link,id){var section=document.getElementById(id);if(section)io.observe(section);});
})();

// Sync assistive status with the default unfiltered payment table.
if(document.getElementById('analytics-filter-status'))applyFilters();

/* R47.12: compile Analytics first-party handlers in external JS. */
const _zvmAnalyticsActions=Object.freeze({"click":Object.freeze({"a0":function(event){toggleLab()},
"a1":function(event){labPreview()},
"a2":function(event){labCancel()},
"a5":function(event){purgeCancel()},
"a6":function(event){purgeExecute()},
"a8":function(event){setTestFilter('all',this)},
"a9":function(event){setTestFilter('real',this)},
"aa":function(event){setTestFilter('test',this)},
"ab":function(event){setPeriod(7,this)},
"ac":function(event){setPeriod(30,this)},
"ad":function(event){setPeriod(90,this)},
"ae":function(event){setPeriod(0,this)}}),
"change":Object.freeze({"a3":function(event){purgeModeChanged()}}),
"input":Object.freeze({"a4":function(event){purgeConfirmInputChanged()},
"a7":function(event){filterTable()}})});
for(const type of ['click','change','input','keydown']){
 document.addEventListener(type,event=>{
  const element=event.target?.closest?.('[data-zvm-analytics-'+type+']');
  if(!element)return;
  const id=element.getAttribute('data-zvm-analytics-'+type);
  const call=_zvmAnalyticsActions[type]?.[id];
  if(typeof call==='function'){
   const result=call.call(element,event);
   if(result===false)event.preventDefault();
  }
 });
}
document.addEventListener('click',event=>{
 const item=event.target?.closest?.('[data-zvm-analytics-dynamic]');
 if(!item)return;
 const key=item.dataset.zvmAnalyticsDynamic;
 if(key==='purgeOpen')purgeOpen();
 else if(key==='labExecute')labExecute();
});
