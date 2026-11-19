const _RA=document.documentElement.dataset.adminRoot||'';

function toast(msg,ok=true){
  const t=document.getElementById('toast');
  if(!t){console.warn('[ADMIN] feedback:',msg);return;}
  t.textContent=msg;
  if(ok){t.style.background='var(--g-bg)';t.style.color='var(--g)';t.style.borderColor='var(--g-brd)';}
  else{t.style.background='var(--red-bg)';t.style.color='var(--red)';t.style.borderColor='var(--red-brd)';}
  t.style.display='block';
  clearTimeout(t._tid);t._tid=setTimeout(()=>t.style.display='none',3400);
}


function adminErrorMessage(data,status){
  const code=String(data&&data.error||'');
  if(status===401)return 'Sua sessão administrativa expirou. Entre novamente.';
  if(status===403)return 'Operação não autorizada. Atualize a página e entre novamente.';
  if(code==='self_ip_block_forbidden')return 'Para evitar perder acesso ao Admin, você não pode bloquear seu próprio IP.';
  if(code==='ip_blacklist_limit')return 'A lista de IPs atingiu o limite de segurança. Remova um IP antes de adicionar outro.';
  if(code==='ip_blacklist_conflict')return 'A lista de IPs mudou durante a operação. Atualize a aba Segurança antes de tentar novamente.';
  if(code==='admin_ip_blacklist_unavailable')return 'Não foi possível confirmar o estado dos IPs no MongoDB. Consulte novamente antes de repetir a ação.';
  if(status===409||code==='key_write_conflict')return 'Esta chave foi alterada por outra operação. Atualize o painel antes de tentar novamente.';
  if(status===503||code==='db_unavailable'||code==='admin_data_unavailable')return 'Banco de dados temporariamente indisponível. Atualize a lista para confirmar o resultado antes de repetir a ação.';
  if(code==='max_uses_below_linked_devices')return 'Existem '+Number(data.linkedCount||0)+' números vinculados. Remova os excedentes antes de reduzir o limite.';
  if(code==='invalid_max_uses')return 'Limite inválido. Informe 1 a 10000 ou escolha Ilimitado.';
  if(code==='invalid_validity_date')return 'Data de validade inválida. Escolha uma data futura.';
  if(code==='invalid_validity_mode')return 'Escolha uma operação de validade válida.';
  if(code==='cannot_remove_time')return 'Não foi possível remover: essa chave não possui validade suficiente ou houve outra alteração. Atualize antes de tentar novamente.';
  if(status===429)return 'Muitas operações simultâneas. Aguarde o tempo informado pelo servidor.';
  return code?'Não foi possível concluir: '+code:'Não foi possível concluir a operação (HTTP '+status+').';
}
async function adminJsonRequest(url, options) {
  const response = await fetch(url, options);
  let data;
  try { data = await response.json(); }
  catch (_) { data = { error: 'invalid_server_response' }; }
  return { response, data };
}
function adminUnconfirmedMutationMessage() {
  return 'Sem confirmação do servidor. Atualize a lista e confira o resultado antes de repetir a operação.';
}
let _adminRefreshIssued = 0, _adminRefreshApplied = 0, _adminLastFreshAt = 0;
function adminRefreshIndicator(fresh, reason) {
  const el = document.getElementById('last-refresh');
  if (!el) return;
  if (fresh) {
    _adminLastFreshAt = Date.now();
    el.textContent = 'Atualizado ' + new Date(_adminLastFreshAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    el.title = 'Última confirmação do banco de dados';
    el.style.color = '';
    el.dataset.stale = '0';
  } else {
    el.textContent = '⚠ Dados não atualizados';
    el.title = (reason || 'A atualização falhou') + (_adminLastFreshAt ? ' · última confirmação: ' + new Date(_adminLastFreshAt).toLocaleTimeString('pt-BR') : ' · atualize o painel');
    el.style.color = 'var(--orange)';
    el.dataset.stale = '1';
  }
}
function toggleKeyActionMenu(button){
 const menu=document.getElementById(button.getAttribute('aria-controls'));if(!menu)return;
 const open=menu.matches(':popover-open')||menu.dataset.fallbackOpen==='1';
 if(open){if(typeof menu.hidePopover==='function'&&menu.matches(':popover-open'))menu.hidePopover();
  else{menu.hidden=true;menu.dataset.fallbackOpen='0';}
  button.setAttribute('aria-expanded','false');return;}
 document.querySelectorAll('.key-actions-popover').forEach(item=>{
  if(typeof item.hidePopover==='function'&&item.matches(':popover-open'))item.hidePopover();
  else{item.hidden=true;item.dataset.fallbackOpen='0';}
 });
 if(typeof menu.showPopover==='function')menu.showPopover();
 else{menu.hidden=false;menu.dataset.fallbackOpen='1';}
 const r=button.getBoundingClientRect(),width=Math.min(250,window.innerWidth-20);
 menu.style.position='fixed';menu.style.inset='auto';menu.style.margin='0';menu.style.width=width+'px';
 menu.style.left=Math.max(10,Math.min(window.innerWidth-width-10,r.right-width))+'px';
 const h=Math.min(350,menu.scrollHeight||260);
 menu.style.top=(r.bottom+h+8>window.innerHeight?Math.max(10,r.top-h-8):r.bottom+8)+'px';
 button.setAttribute('aria-expanded','true');
}
// R47.10: license actions dispatch through explicit names, never executable HTML attributes.
const _zvmLicenseActions=Object.freeze({
 renew:(button,row)=>openRenew(row.dataset.code,row.dataset.clientName),
 uses:(button,row)=>openEditUses(row.dataset.code,row.dataset.clientName,Number(row.dataset.maxUses)),
 more:(button)=>{if(button.nextElementSibling)button.nextElementSibling.hidden=false;toggleKeyActionMenu(button);},
 toggle:(button,row)=>toggleKey(row.dataset.code),
 rename:(button,row)=>openRename(row.dataset.code,row.dataset.clientName),
 phones:(button,row)=>openPhones(row.dataset.code,row.dataset.clientName),
 delete:(button,row)=>deleteKey(row.dataset.code),
 'clear-suspect':(button,row)=>clearSuspect(row.dataset.code),
 details:(button)=>toggleKeyDetails(button)
});
document.addEventListener('click',event=>{
 const button=event.target?.closest?.('[data-zvm-key-action]');
 if(!button||!button.closest('.keys-table'))return;
 const row=button.closest('tr.key-record'),name=button.dataset.zvmKeyAction;
 if(!row||!Object.prototype.hasOwnProperty.call(_zvmLicenseActions,name))return;
 _zvmLicenseActions[name](button,row);
});
document.addEventListener('change',event=>{
 const input=event.target;
 if(!input?.matches?.('input[data-zvm-key-action="dev-toggle"]'))return;
 const row=input.closest('tr.key-record');
 if(row)toggleDevAccess(row.dataset.code,input.checked,input);
});
document.addEventListener('toggle',event=>{
 const menu=event.target;if(!menu?.classList?.contains('key-actions-popover'))return;
 const button=document.querySelector('.key-more-trigger[aria-controls="'+menu.id+'"]');
 if(button)button.setAttribute('aria-expanded',menu.matches(':popover-open')?'true':'false');
},true);
function toggleKeyDetails(button){
  const row=button&&button.closest('tr.key-record');if(!row)return;
  const expanded=row.classList.toggle('key-expanded');
  button.setAttribute('aria-expanded',String(expanded));
  button.textContent=expanded?'Ocultar detalhes':'Detalhes';
}
function filterKeys(){
  const q=(document.getElementById('search-input').value||'').toLowerCase();
  const st=document.getElementById('filter-status').value;
  const fp=(document.getElementById('filter-plan')||{}).value||'';
  const product=(document.getElementById('filter-product')||{}).value||'';
  const isSuspectFilter=st==='suspect';
  let shown=0,total=0;
  document.querySelectorAll('#kb tr[data-label]').forEach(row=>{
    total++;
    const label=(row.dataset.label||'').toLowerCase();
    const phone=(row.dataset.phone||'').toLowerCase();
    const status=(row.dataset.status||'').toLowerCase();
    const code=(row.dataset.code||'').toLowerCase();
    const plan=(row.dataset.plan||'').toLowerCase();
    const rowProduct=(row.dataset.product||'').toLowerCase();
    const ip=(row.cells[6]||{}).textContent||'';
    const matchQ=!q||label.includes(q)||phone.includes(q)||code.includes(q)||ip.toLowerCase().includes(q);
    const matchSt=!st||(isSuspectFilter?row.dataset.suspect==='1':status===st);
    const matchPlan=!fp||plan===fp;
    const visible=matchQ&&matchSt&&matchPlan&&(!product||product===rowProduct);
    row.style.display=visible?'':'none';
    if(!visible){const cb=row.querySelector('.key-cb');if(cb)cb.checked=false;}
    if(visible)shown++;
  });
  const fc=document.getElementById('keys-filter-count');
  if(fc)fc.textContent=(st||q||fp||product)?(shown+' de '+total+' chave(s) exibida(s)'):(total+' chave(s)');
  updateBatchUI();
}

let _sortCol=null,_sortDir=1;
function sortKeys(col){
  const tbody=document.getElementById('kb');
  const rows=Array.from(tbody.querySelectorAll('tr[data-label]'));
  if(!rows.length)return;
  if(_sortCol===col)_sortDir*=-1;else{_sortCol=col;_sortDir=1;}
  document.querySelectorAll('th[id^="th-"]').forEach(th=>th.classList.remove('asc','desc'));
  const th=document.getElementById('th-'+col);if(th)th.classList.add(_sortDir===1?'asc':'desc');
  rows.sort((a,b)=>{
    let va,vb;
    if(col==='uses'){va=parseInt(a.dataset.uses||0,10);vb=parseInt(b.dataset.uses||0,10);}
    else if(col==='validity'){va=parseFloat(a.dataset.validity||0);vb=parseFloat(b.dataset.validity||0);}
    else if(col==='code'){va=(a.dataset.code||'').toLowerCase();vb=(b.dataset.code||'').toLowerCase();}
    else if(col==='created'||col==='lastused'){va=a.dataset[col]||'';vb=b.dataset[col]||'';}
    else if(col==='phone'){va=a.dataset.phone||'';vb=b.dataset.phone||'';}
    else if(col==='status'){va=a.dataset.status||'';vb=b.dataset.status||'';}
    else{va=(a.dataset[col]||'').toLowerCase();vb=(b.dataset[col]||'').toLowerCase();}
    if(typeof va==='number'&&typeof vb==='number'){if(va<vb)return -1*_sortDir;if(va>vb)return 1*_sortDir;return 0;}
    if(va<vb)return -1*_sortDir;if(va>vb)return 1*_sortDir;return 0;
  });
  rows.forEach(r=>tbody.appendChild(r));
}

let _adminGeneratingKeys = false;
async function generateKey(){
  if (_adminGeneratingKeys) return;
  const get=id=>document.getElementById(id);
  const label=get('nlabel').value.trim();
  const productId=(get('nproduct')||{}).value||'';
  if(!['zvm_automacoes','zvm_lite'].includes(productId)){toast('Selecione a ferramenta antes de gerar a chave.',false);return;}
  const parseWhole=(v, fallback)=>{const x=String(v).trim();return x===''?fallback:/^-?\d+$/.test(x)?Number(x):NaN;};
  const days=parseWhole(get('ndays').value,0);
  const hours=parseWhole(get('nhours').value,0);
  const mins=parseWhole(get('nmins').value,0);
  const maxUses=parseWhole(get('nuses').value,3);
  const qty=parseWhole(get('batch-qty')?.value||'1',1);
  if(!label){toast('Informe o nome do cliente',false);return;}
  if(![days,hours,mins].every(n=>Number.isSafeInteger(n)&&n>=0) ||
     !Number.isSafeInteger(maxUses)||maxUses<-1 ||
     !Number.isSafeInteger(qty)||qty<1||qty>50) {
    toast('Informe valores inteiros válidos (quantidade de 1 a 50; usos a partir de -1).',false);
    return;
  }
  const def=get('ndeferred');
  const btn=get('admin-generate-key-btn');
  const summary=get('admin-create-status');
  const status=(text,warning)=>{
    if(!summary)return;
    summary.hidden=false;
    summary.style.display='block';
    summary.style.color=warning?'var(--orange)':'var(--g)';
    summary.textContent=text;
  };
  const csvCell=v=>{
    const raw=String(v).replace(/^[\s]*[=+\-@]/,match=>"'"+match);
    return '"'+raw.replace(/"/g,'""')+'"';
  };
  const baseBody={maxUses,productId};
  if(days>0)baseBody.expireDays=days;
  if(hours>0)baseBody.expireHours=hours;
  if(mins>0)baseBody.expireMinutes=mins;
  if(def&&def.checked)baseBody.deferred=true;
  const generated=[];
  let failed='', uncertain=false, expiredSession=false;
  _adminGeneratingKeys=true;
  if(btn){btn.disabled=true;btn.textContent='Gerando 0/'+qty+'…';}
  try {
    for(let i=0;i<qty;i++){
      if(btn)btn.textContent='Gerando '+(i+1)+'/'+qty+'…';
      const name=qty>1?label+' #'+(i+1):label;
      let reply;
      try {
        reply=await adminJsonRequest(_RA+'/api/keys',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({...baseBody,label:name})
        });
      } catch(e) {
        uncertain=true;failed='Não foi possível confirmar a tentativa '+(i+1)+'.';
        break; // Sem reenvio: o servidor pode ter persistido esta tentativa.
      }
      const {response,data}=reply;
      if(response.status===401){expiredSession=true;failed='Sessão expirada.';break;}
      if(!response.ok||data.ok!==true||typeof data.key!=='string'||!data.key){
        uncertain=!!response.ok;
        failed='Tentativa '+(i+1)+': '+adminErrorMessage(data,response.status);
        break;
      }
      generated.push({label:name,code:data.key,productId:data.productId,activationPending:data.activationPending===true});
    }
    if(generated.length && qty>1){
      const csv='\uFEFFCliente,Chave\n'+generated.map(c=>csvCell(c.label)+','+csvCell(c.code)).join('\n');
      const a=document.createElement('a');
      a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
      a.download='chaves_confirmadas_'+new Date().toISOString().slice(0,10)+'.csv';
      document.body.appendChild(a);
      try{a.click();}finally{document.body.removeChild(a);}
    }
    const complete=generated.length===qty&&!failed;
    if(complete){
      const pending=productId==='zvm_lite';
      const text=qty===1?(pending?'Chave LITE reservada e INATIVA: ':'Chave criada: ')+generated[0].code:qty+' chaves '+(pending?'LITE reservadas, ainda inativas.':'confirmadas;')+' CSV gerado.';
      status(text,pending);toast((pending?'⚠️ ':'✅ ')+text);
      ['nlabel','ndays','nhours','nmins','nuses'].forEach(id=>{const el=get(id);if(el)el.value='';});
      if(def)def.checked=false;
      if(get('batch-qty'))get('batch-qty').value='1';
    } else {
      const text=generated.length+' de '+qty+' chave(s) confirmada(s). '+(failed||'Lote interrompido.')+
        (uncertain?' A última tentativa pode ter sido gravada.':'')+
        ' Confira o painel antes de repetir; não reenvie o lote completo.';
      status(text,true);toast(text,false);
    }
    if(expiredSession)toast('Sua sessão expirou; faça login antes de continuar.',false);
    await doRefresh(false);
  }catch(e){
    status(generated.length+' chave(s) confirmada(s). Falha de processamento; confira o painel antes de tentar de novo.',true);
    toast(adminUnconfirmedMutationMessage(),false);
    await doRefresh(false);
  }finally{
    _adminGeneratingKeys=false;
    if(btn){btn.disabled=false;btn.textContent='+ Gerar Chave(s)';}
  }
}
async function doRefresh(manual){
  const requestSeq=++_adminRefreshIssued;
  try{
    const r=await fetch(_RA+'/api/data');
    if(r.status===401){toast('⏱ Sessão expirada — redirecionando...',false);setTimeout(()=>location.href=_RA,1800);return;}
    const d=await r.json();
    if(requestSeq < _adminRefreshApplied)return; // Uma resposta antiga nunca sobrescreve outra mais nova.
    if(!r.ok||d.error){
      adminRefreshIndicator(false,adminErrorMessage(d,r.status));
      if(manual)toast(adminErrorMessage(d,r.status),false);
      return;
    }
    _adminRefreshApplied=requestSeq;
    document.getElementById('s-total').textContent=d.totalKeys||0;
    document.getElementById('s-active').textContent=d.activeKeys||0;
    const se=document.getElementById('s-expired');
    if(se){
      se.textContent=d.expiredKeys||0;
      se.style.color=(d.expiredKeys||0)>0?'var(--red)':'';
      const seCard=se.closest('.sc');
      if(seCard)seCard.classList.toggle('expired-card',(d.expiredKeys||0)>0);
    }
    document.getElementById('s-logs').textContent=d.totalLogs||0;
    const sw=document.getElementById('s-warn');sw.textContent=d.warnKeys||0;sw.style.color=d.warnKeys>0?'var(--orange)':'var(--green)';sw.closest('.sc').classList.toggle('warn-card',d.warnKeys>0);
    const sbl=document.getElementById('s-blocked');if(sbl)sbl.textContent=d.blockedKeys||0;
    const sdf=document.getElementById('s-deferred');if(sdf)sdf.textContent=d.deferredKeys||0;
    const ssp=document.getElementById('s-suspect');if(ssp){ssp.textContent=d.suspectKeys||0;ssp.style.color=(d.suspectKeys||0)>0?'var(--red)':'';};const _hm=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};_hm('hero-admin-active',d.activeKeys||0);_hm('hero-admin-expired',d.expiredKeys||0);_hm('hero-admin-suspect',d.suspectKeys||0);
    const alert=document.getElementById('urgent-alert'),alertTxt=document.getElementById('urgent-alert-text');
    if(alert&&alertTxt){
      const parts=[];
      if((d.expiredKeys||0)>0)parts.push('<strong>'+d.expiredKeys+' expirada(s)</strong>');
      if((d.warnKeys||0)>0)parts.push('<strong>'+d.warnKeys+' expirando em breve</strong>');
      alert.style.display=parts.length?'flex':'none';
      alertTxt.innerHTML=parts.join(' · ');
    }
    document.getElementById('kb').innerHTML=d.keysHtml||'';
    document.getElementById('lb').innerHTML=d.logsHtml||'';
    adminRefreshIndicator(true);
    // Badge de chaves suspeitas no header
    const suspN=d.suspectKeys||0;
    const sb=document.getElementById('hdr-suspect-badge'),sbn=document.getElementById('hdr-suspect-num');
    if(sb&&sbn){sbn.textContent=suspN;sb.style.opacity=suspN>0?'1':'0.45';sb.style.pointerEvents=suspN>0?'auto':'none';}
    filterKeys();
    const usersPanel=document.querySelector('.sec-panel[data-panel="users"]');
    if(usersPanel&&usersPanel.classList.contains('active'))await loadUsers(true);
    if(manual)toast('Painel atualizado');
  }catch(e){
    console.error('Refresh error',e);
    if(requestSeq >= _adminRefreshApplied)adminRefreshIndicator(false,'Falha de conexão ou resposta do servidor');
    if(manual)toast('Não foi possível atualizar os dados. O painel pode estar desatualizado.',false);
  }
}
setInterval(()=>{if(!document.hidden)doRefresh(false);},120000);document.addEventListener('visibilitychange',function(){if(!document.hidden)doRefresh(false);});

// Click-to-copy nas chaves da tabela
document.addEventListener('click',function(e){
  const kc=e.target.closest('.kc');
  if(!kc)return;
  const code=kc.textContent.trim();
  if(!code)return;
  navigator.clipboard.writeText(code).then(function(){
    const prev=kc.textContent;
    kc.textContent='✓ Copiada!';
    kc.style.color='var(--g)';
    setTimeout(function(){kc.textContent=prev;kc.style.color='';},1400);
  }).catch(function(){});
});

// Aviso de sessão expirando
fetch(_RA+'/api/session-info').then(function(r){return r.ok?r.json():null;}).then(function(d){
  if(!d||!d.expiresAt)return;
  var _sessExp=d.expiresAt;
  var checkExpiry=function(){
    var msLeft=new Date(_sessExp)-Date.now();
    var warn=document.getElementById('hdr-session-warn'),wmin=document.getElementById('hdr-session-min');
    if(!warn||!wmin)return;
    if(msLeft<=600000&&msLeft>0){warn.style.display='inline-flex';wmin.textContent=Math.ceil(msLeft/60000);}
    else{warn.style.display='none';}
  };
  checkExpiry();
  setInterval(checkExpiry,30000);
}).catch(function(){});

// IP Blacklist
let _adminBlacklistReadGeneration=0, _adminBlacklistWriteBusy=false;
async function loadBlacklist(){
  const generation=++_adminBlacklistReadGeneration;
  const tb=document.getElementById('ip-bl-tb');
  try{
    const {response,data}=await adminJsonRequest(_RA+'/api/ip-blacklist');
    if(generation!==_adminBlacklistReadGeneration)return;
    if(!response.ok||!Array.isArray(data.ips)){
      if(tb)tb.textContent='Não foi possível confirmar a lista de IPs no banco. Abra novamente a aba Segurança para atualizar.';
      toast(adminErrorMessage(data,response.status),false);return;
    }
    if(!tb)return;
    if(!data.ips.length){
      tb.innerHTML='<tr><td colspan="2" class="empty">Nenhum IP bloqueado</td></tr>';
      return;
    }
    tb.textContent='';
    data.ips.forEach(ip=>{
      if(typeof ip!=='string')return;
      const tr=document.createElement('tr');
      const td1=document.createElement('td');
      td1.style.cssText='font-family:monospace;font-size:13px';
      td1.textContent=ip;
      const td2=document.createElement('td');
      td2.style.textAlign='center';
      const btn=document.createElement('button');
      btn.className='bs bd';
      btn.style.cssText='font-size:11px;padding:3px 8px';
      btn.textContent='Remover';
      btn.disabled=_adminBlacklistWriteBusy;
      btn.onclick=()=>removeFromBlacklist(ip);
      td2.appendChild(btn);tr.appendChild(td1);tr.appendChild(td2);tb.appendChild(tr);
    });
  }catch(e){
    if(generation!==_adminBlacklistReadGeneration)return;
    if(tb)tb.textContent='Falha de conexão. Nenhum estado de bloqueio foi confirmado.';
    toast('Falha de rede ao consultar IPs. Confira a lista novamente.',false);
  }
}
async function adminEditBlacklist(operation,ip){
  if(_adminBlacklistWriteBusy)return false;
  _adminBlacklistWriteBusy=true;
  try{
    const {response,data}=await adminJsonRequest(_RA+'/api/ip-blacklist/'+operation,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ip})
    });
    if(response.ok&&data.ok===true){
      toast(operation==='add'?'IP bloqueado e confirmado no MongoDB':'IP desbloqueado e confirmado no MongoDB');
      return true;
    }
    toast(adminErrorMessage(data,response.status),false);
    return false;
  }catch(e){
    toast(adminUnconfirmedMutationMessage(),false);
    return false;
  }finally{
    _adminBlacklistWriteBusy=false;
    await loadBlacklist(); // Somente GET; não repete o POST mesmo após perda de ACK.
  }
}
async function addToBlacklist(){
  if(_adminBlacklistWriteBusy)return;
  const inp=document.getElementById('ip-bl-input');
  const ip=(inp?.value||'').trim();
  if(!ip){toast('Informe um IP válido.',false);return;}
  const saved=await adminEditBlacklist('add',ip);
  if(saved&&inp)inp.value='';
}
async function removeFromBlacklist(ip){
  if(_adminBlacklistWriteBusy)return;
  if(!confirm('Desbloquear o IP '+ip+'?'))return;
  await adminEditBlacklist('remove',ip);
}

// TOTP Setup
const _adminToggleInFlight=new Set();
async function toggleKey(code){
  if(_adminToggleInFlight.has(code))return;
  _adminToggleInFlight.add(code);
  try{
    const {response,data}=await adminJsonRequest(_RA+'/api/keys/'+encodeURIComponent(code)+'/toggle',{method:'POST'});
    if(response.status===401){toast('Sessão expirada',false);return;}
    if(response.ok&&data.ok===true){
      toast(data.active?'Chave liberada!':'Chave bloqueada!');
      await doRefresh(false);
    }else if(response.status===409){
      toast('A chave foi alterada em outra sessão. Atualizando...',false);
      await doRefresh(false);
    }else toast(adminErrorMessage(data,response.status),false);
  }catch(e){toast(adminUnconfirmedMutationMessage(),false);await doRefresh(false);}
  finally{_adminToggleInFlight.delete(code);}
}
async function clearSuspect(code){
  if(!confirm('Limpar alerta de suspeita para a chave '+code+'?\n\nO alerta não voltará por 48h.'))return;
  try{
    const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/clear-suspect',{method:'POST'});
    if(r.status===401){toast('Sessão expirada',false);return;}
    const d=await r.json();
    if(d.ok){toast('Alerta de suspeita removido por 48h');await doRefresh();}
    else toast(adminErrorMessage(d,r.status),false);
  }catch(e){toast('Erro',false);}
}

let _adminDeleteInFlight=false;
function adminDeleteLock(busy){
  _adminDeleteInFlight=!!busy;
  const btn=document.getElementById('btn-delete-batch');
  if(btn)btn.disabled=!!busy;
}
async function deleteKey(code){
  if(_adminDeleteInFlight)return;
  if(!confirm('Excluir chave '+code+'? Esta ação é irreversível.'))return;
  adminDeleteLock(true);
  try{
    const {response,data}=await adminJsonRequest(_RA+'/api/keys/'+encodeURIComponent(code),{method:'DELETE'});
    if(response.ok&&data.ok===true)toast('Chave excluída');
    else toast(adminErrorMessage(data,response.status),false);
  }catch(e){toast(adminUnconfirmedMutationMessage(),false);}
  finally{adminDeleteLock(false);await doRefresh(false);}
}
function toggleAllCheckboxes(checked){
  document.querySelectorAll('#kb .key-cb').forEach(cb=>{
    if(cb.closest('tr').style.display!=='none')cb.checked=checked;
  });
  updateBatchUI();
}
function updateBatchUI(){
  const checked=document.querySelectorAll('#kb .key-cb:checked').length;
  const btn=document.getElementById('btn-delete-batch');
  const cnt=document.getElementById('batch-count');
  if(btn){btn.style.display=checked>0?'':'none';}
  if(cnt)cnt.textContent=checked;
  const masterCb=document.getElementById('master-cb');
  if(masterCb){
    const all=document.querySelectorAll('#kb .key-cb:not([style*="display:none"])');
    const visibleAll=[...document.querySelectorAll('#kb tr[data-label]')].filter(r=>r.style.display!=='none').map(r=>r.querySelector('.key-cb')).filter(Boolean);
    const allChecked=visibleAll.length>0&&visibleAll.every(cb=>cb.checked);
    masterCb.checked=allChecked;
    masterCb.indeterminate=!allChecked&&checked>0;
  }
}
document.getElementById('kb').addEventListener('change',function(e){if(e.target.classList.contains('key-cb'))updateBatchUI();});

async function deleteBatchKeys(){
  if(_adminDeleteInFlight)return;
  const rows=[...document.querySelectorAll('#kb .key-cb:checked')]
    .map(cb=>cb.closest('tr')).filter(row=>row&&row.style.display!=='none');
  const codes=[...new Set(rows.map(row=>row.dataset.code).filter(code=>typeof code==='string'&&/^[a-z0-9_-]{1,64}$/i.test(code)))];
  if(!codes.length){toast('Selecione chaves visíveis antes de excluir.',false);return;}
  const labels=rows.map(r=>r.dataset.label||r.dataset.code).slice(0,8);
  const preview=labels.join('\n')+(codes.length>8?'\n… e mais '+(codes.length-8):'');
  if(!confirm('Excluir '+codes.length+' chave(s)? Esta ação é irreversível.\n\n'+preview))return;
  adminDeleteLock(true);
  try{
    const {response,data}=await adminJsonRequest(_RA+'/api/keys/batch',{
      method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({codes})
    });
    if(response.ok&&data.ok===true)toast('🗑 '+data.deleted+' chave(s) excluída(s)');
    else toast(adminErrorMessage(data,response.status),false);
  }catch(e){toast(adminUnconfirmedMutationMessage(),false);}
  finally{adminDeleteLock(false);await doRefresh(false);}
}
async function filterLog(){
  const date=document.getElementById('logDate').value;
  const q=(document.getElementById('logSearch').value||'').toLowerCase();
  if(!date&&!q)return doRefresh();
  try{
    const params=new URLSearchParams();
    if(date)params.set('date',date);if(q)params.set('q',q);
    const r=await fetch(_RA+'/api/logs?'+params.toString());
    if(r.status===401){return;}
    const d=await r.json();if(d.ok)document.getElementById('lb').innerHTML=d.logsHtml||'';
  }catch(e){toast('Erro ao filtrar',false);}
}
function clearFilters(){document.getElementById('logDate').value='';document.getElementById('logSearch').value='';doRefresh();}

let _adminClearLogInFlight=false;
async function clearLog(){
  if(_adminClearLogInFlight)return;
  const date=document.getElementById('logDate').value;
  if(!confirm(date?'Limpar logs do dia '+date+'?':'Limpar TODO o log?'))return;
  _adminClearLogInFlight=true;
  try{
    const {response,data}=await adminJsonRequest(_RA+'/api/logs',{
      method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(date?{date}:{})
    });
    if(response.ok&&data.ok===true){toast(date?'Logs do dia removidos':'Log completo removido');clearFilters();}
    else toast(adminErrorMessage(data,response.status),false);
  }catch(e){toast(adminUnconfirmedMutationMessage(),false);}
  finally{_adminClearLogInFlight=false;await doRefresh(false);}
}
let _renewInFlight=false, _renewOperationId='', _renewSignature='';
function openRenew(code,label){
  _renewOperationId=''; _renewSignature=''; _renewInFlight=false;
  document.getElementById('renewKeyCode').value=code;
  document.getElementById('renewKeyLabel').textContent=label;
  ['renewDays','renewHours','renewMins'].forEach(id=>document.getElementById(id).value='');
  const row=document.querySelector('#kb tr[data-code="'+code+'"]');
  const current=row?.dataset.expiresAt||'';
  document.getElementById('renewMode').value='add';
  document.getElementById('renewPreview').textContent='';
  const exact=document.getElementById('renewExactDate');
  exact.value=current&&!isNaN(Date.parse(current))?toLocalAdminDatetime(new Date(current)):'';
  applyRenewMode();
  const expEl=document.getElementById('renewCurrentExpiry');
  if(row&&expEl){
    if(row.dataset.deferred==='1')expEl.textContent='Validade: ativa no 1º uso (contador ainda não iniciou)';
    else if(row.dataset.expiresAt){
      const d=new Date(row.dataset.expiresAt);
      const expired=Date.now()>d.getTime();
      expEl.textContent='Validade atual: '+d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+(expired?' (EXPIRADA)':'');
      expEl.style.color=expired?'var(--red)':row.dataset.expiresAt&&((d-Date.now())<48*3600000)?'var(--orange)':'var(--muted)';
    }else expEl.textContent='Validade: sem expiração definida';
  }
  document.getElementById('renewModal').classList.add('open');
  updateRenewPreview();
  document.getElementById('renewDays').focus();
}
function toLocalAdminDatetime(date){
  const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,16);
}
function adminFormatExpiry(d){return new Date(d).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});}
function adminRenewInput(){
 const raw=['renewDays','renewHours','renewMins'].map(id=>document.getElementById(id).value.trim());
 const n=raw.map(v=>v===''?0:/^-?\d+$/.test(v)?Number(v):NaN);
 if(!n.every(Number.isSafeInteger)||n.some(x=>x>0)&&n.some(x=>x<0))return {ok:false,error:'Informe números inteiros sem misturar sinais.'};
 const minutes=Math.abs(n[0])*1440+Math.abs(n[1])*60+Math.abs(n[2]);
 if(!Number.isSafeInteger(minutes)||minutes<1||minutes>5256000)return {ok:false,error:'Informe entre 1 minuto e 10 anos.'};
 const mode=document.getElementById('renewMode').value;
 return {ok:true,minutes,days:Math.abs(n[0]),hours:Math.abs(n[1]),mins:Math.abs(n[2]),
  direction:mode==='remove'||n.some(x=>x<0)?'remove':'add'};
}
function updateRenewPreview(){
 const el=document.getElementById('renewPreview');if(!el)return;
 const mode=document.getElementById('renewMode').value;
 const code=document.getElementById('renewKeyCode').value;
 const date=document.querySelector('#kb tr[data-code="'+code+'"]')?.dataset.expiresAt||'';
 const stamp=date?Date.parse(date):NaN;
 if(mode==='never'){el.textContent='Nova validade: sem expiração.';return;}
 if(mode==='date'){
  const d=new Date(document.getElementById('renewExactDate').value);
  el.textContent=Number.isFinite(d.getTime())?'Nova validade: '+adminFormatExpiry(d):'Selecione a data e a hora.';return;
 }
 const input=adminRenewInput();
 if(!input.ok){el.textContent=input.error;return;}
 if(input.direction==='remove'){
  const end=stamp-input.minutes*60000;
  el.textContent=!Number.isFinite(stamp)?'A chave não possui prazo definido para reduzir.':
   end<=Date.now()+60000?'O desconto supera o tempo restante.':'Nova validade: '+adminFormatExpiry(end);
 }else el.textContent='Nova validade estimada: '+adminFormatExpiry(Math.max(Date.now(),Number.isFinite(stamp)?stamp:0)+input.minutes*60000);
}
function applyRenewMode(){
 const mode=document.getElementById('renewMode').value,duration=document.getElementById('renewDurationFields');
 duration.hidden=!['add','remove'].includes(mode);duration.style.display=duration.hidden?'none':'flex';
 document.getElementById('renewExactFields').hidden=mode!=='date';
 document.getElementById('renewNeverInfo').hidden=mode!=='never';
 document.getElementById('renewSaveButton').textContent=mode==='add'?'Adicionar tempo':mode==='remove'?'Remover tempo':'Salvar validade';
 updateRenewPreview();
}
['renewDays','renewHours','renewMins','renewExactDate'].forEach(id=>document.getElementById(id)?.addEventListener('input',updateRenewPreview));
function closeRenew(){document.getElementById('renewModal').classList.remove('open');}
document.getElementById('renewModal').addEventListener('click',function(e){if(e.target===this)closeRenew();});
async function saveRenew(){
 if(_renewInFlight)return;
 const code=document.getElementById('renewKeyCode').value,mode=document.getElementById('renewMode').value;
 let url,payload,direction='add';
 if(mode==='add'||mode==='remove'){
  const v=adminRenewInput();if(!v.ok){toast(v.error,false);return;}
  direction=v.direction;
  if(direction==='remove'){
   const old=document.querySelector('#kb tr[data-code="'+code+'"]')?.dataset.expiresAt||'';
   const expiry=old?Date.parse(old):NaN,result=expiry-v.minutes*60000;
   if(!Number.isFinite(expiry)||result<=Date.now()+60000){toast('A chave não tem prazo suficiente para essa redução.',false);return;}
   if(!confirm('Remover '+v.minutes+' minuto(s)?\nValidade atual: '+adminFormatExpiry(expiry)+'\nNova validade: '+adminFormatExpiry(result)))return;
  }
  const signature=[code,direction,v.days,v.hours,v.mins].join('|');
  if(!_renewOperationId||signature!==_renewSignature){
   _renewSignature=signature;
   _renewOperationId=crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
  }
  url=_RA+'/api/keys/'+encodeURIComponent(code)+'/renew';
  payload={days:v.days,hours:v.hours,mins:v.mins,direction,operationId:_renewOperationId};
 }else if(mode==='date'){
  const input=document.getElementById('renewExactDate').value,target=new Date(input);
  if(!input||!Number.isFinite(target.getTime())||target.getTime()<Date.now()+60000){toast('Escolha uma data futura.',false);return;}
  const old=document.querySelector('#kb tr[data-code="'+code+'"]')?.dataset.expiresAt||'';
  if(old&&target.getTime()<Date.parse(old)&&!confirm('Confirmar redução da validade?'))return;
  url=_RA+'/api/keys/'+encodeURIComponent(code)+'/validity';payload={mode:'date',expiresAt:target.toISOString()};
 }else if(mode==='never'){
  if(!confirm('Remover todo o prazo de expiração?'))return;
  url=_RA+'/api/keys/'+encodeURIComponent(code)+'/validity';payload={mode:'never'};
 }else{toast('Operação inválida.',false);return;}
 const btn=document.getElementById('renewSaveButton');
 _renewInFlight=true;if(btn){btn.disabled=true;btn.textContent='Salvando…';}
 try{
  const {response,data}=await adminJsonRequest(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(response.ok&&data.ok===true){
   toast((data.replayed?'Operação confirmada':direction==='remove'?'Tempo removido':mode==='add'?'Tempo adicionado':'Validade alterada')+' · '+(data.expiresAt?adminFormatExpiry(data.expiresAt):'Sem expiração'));
   closeRenew();await doRefresh(false);
  }else toast(adminErrorMessage(data,response.status),false);
 }catch(e){toast(adminUnconfirmedMutationMessage(),false);await doRefresh(false);}
 finally{_renewInFlight=false;if(btn)btn.disabled=false;applyRenewMode();}
}
function openEditUses(code,label,current){
  document.getElementById('editUsesCode').value=code;
  document.getElementById('editUsesLabel').textContent=label;
  const unlimited=document.getElementById('editUsesUnlimited');
  unlimited.checked=current===-1;
  document.getElementById('editUsesValue').value=current===-1?'3':current;
  const row=document.querySelector('#kb tr[data-code="'+code+'"]');
  const linked=Number(row?.dataset.phonesCount||0);
  document.getElementById('editUsesLinked').textContent='Números atualmente vinculados: '+linked+
    '. Para reduzir abaixo desse total, desvincule primeiro os números excedentes.';
  applyUsesUnlimited();
  document.getElementById('editUsesModal').classList.add('open');
  setTimeout(()=>{if(!unlimited.checked){const field=document.getElementById('editUsesValue');field.focus();field.select();}},50);
}
function applyUsesUnlimited(){
  const unlimited=document.getElementById('editUsesUnlimited').checked;
  document.getElementById('editUsesValue').disabled=unlimited;
}
function closeEditUses(){document.getElementById('editUsesModal').classList.remove('open');}
document.getElementById('editUsesModal').addEventListener('click',function(e){if(e.target===this)closeEditUses();});
const _adminKeyEditsInFlight=new Set();
async function saveEditUses(){
  const code=document.getElementById('editUsesCode').value;
  const val=document.getElementById('editUsesValue').value.trim();
  const maxUses=document.getElementById('editUsesUnlimited').checked?-1:
    (/^\d{1,5}$/.test(val)?Number(val):NaN);
  if(!Number.isSafeInteger(maxUses)||!(maxUses===-1||(maxUses>=1&&maxUses<=10000))){
    toast('Escolha de 1 a 10000 dispositivos ou marque Ilimitado.',false);return;
  }
  const lock=code+':max-uses';
  if(_adminKeyEditsInFlight.has(lock))return;
  _adminKeyEditsInFlight.add(lock);
  try{
    const {response,data}=await adminJsonRequest(_RA+'/api/keys/'+encodeURIComponent(code)+'/max-uses',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({maxUses})
    });
    if(response.ok&&data.ok===true){toast('Limite: '+(maxUses===-1?'ilimitado':maxUses+' dispositivo(s)'));closeEditUses();await doRefresh(false);}
    else toast(adminErrorMessage(data,response.status),false);
  }catch(e){toast(adminUnconfirmedMutationMessage(),false);await doRefresh(false);}
  finally{_adminKeyEditsInFlight.delete(lock);}
}
function openRename(code,label){document.getElementById('renameCode').value=code;document.getElementById('renameValue').value=label;document.getElementById('renameModal').classList.add('open');setTimeout(()=>{const v=document.getElementById('renameValue');v.focus();v.select();},50);}
function closeRename(){document.getElementById('renameModal').classList.remove('open');}
document.getElementById('renameModal').addEventListener('click',function(e){if(e.target===this)closeRename();});
document.getElementById('renameValue').addEventListener('keydown',function(e){if(e.key==='Enter')saveRename();});
async function saveRename(){
  const code=document.getElementById('renameCode').value;
  const label=document.getElementById('renameValue').value.trim();
  if(!label){toast('Nome não pode ser vazio.',false);return;}
  const lock=code+':label';
  if(_adminKeyEditsInFlight.has(lock))return;
  _adminKeyEditsInFlight.add(lock);
  try{
    const {response,data}=await adminJsonRequest(_RA+'/api/keys/'+encodeURIComponent(code)+'/label',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label})
    });
    if(response.ok&&data.ok===true){toast('Renomeado: '+label);closeRename();await doRefresh(false);}
    else toast(adminErrorMessage(data,response.status),false);
  }catch(e){toast(adminUnconfirmedMutationMessage(),false);await doRefresh(false);}
  finally{_adminKeyEditsInFlight.delete(lock);}
}
let _phonesReadGeneration=0, _phonesMutationBusy=false;
function adminSetPhonesBusy(busy){
  _phonesMutationBusy=!!busy;
  const modal=document.getElementById('phonesModal');
  if(!modal)return;
  modal.querySelectorAll('#phonesList button,#removeAllBtn').forEach(b=>{b.disabled=!!busy;});
  modal.setAttribute('aria-busy',busy?'true':'false');
}
async function openPhones(code,label){
  if(_phonesMutationBusy){toast('Conclua a operação atual antes de abrir outra licença.',false);return;}
  const modal=document.getElementById('phonesModal');
  const list=document.getElementById('phonesList');
  const generation=++_phonesReadGeneration;
  modal.dataset.code=code;
  modal.dataset.phones='[]';
  document.getElementById('phonesLabel').textContent=label;
  document.getElementById('removeAllBtn').style.display='none';
  list.textContent='Carregando…';
  modal.classList.add('open');
  try{
    const {response,data}=await adminJsonRequest(_RA+'/api/keys/'+encodeURIComponent(code)+'/phones');
    if(generation!==_phonesReadGeneration || modal.dataset.code!==code || !modal.classList.contains('open'))return;
    if(!response.ok || !Array.isArray(data.phones)){
      list.textContent='Falha ao carregar os dispositivos. Feche e tente novamente.';
      toast(adminErrorMessage(data,response.status),false);
      return;
    }
    const phones=data.phones.filter(p=>typeof p==='string');
    modal.dataset.phones=JSON.stringify(phones);
    if(!phones.length){
      list.innerHTML='<em style="color:var(--muted);font-size:12px">Nenhum número cadastrado</em>';
      return;
    }
    const esc=v=>String(v).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
    document.getElementById('removeAllBtn').style.display='';
    list.innerHTML=phones.map((ph,i)=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-size:13px;font-family:monospace;color:var(--text)">'+esc(ph)+'</span><button class="bs bd" data-idx="'+i+'" data-zvm-dynamic-click="removePhone">Remover</button></div>').join('');
  }catch(e){
    if(generation!==_phonesReadGeneration || modal.dataset.code!==code)return;
    list.textContent='Erro de conexão ao carregar dispositivos.';
    toast('Falha de conexão. Nenhum número foi removido nesta tentativa.',false);
  }
}
function closePhones(){
  if(_phonesMutationBusy){toast('Operação em andamento; aguarde a confirmação.',false);return;}
  _phonesReadGeneration++;
  document.getElementById('phonesModal').classList.remove('open');
}
document.getElementById('phonesModal').addEventListener('click',function(e){if(e.target===this)closePhones();});
async function adminDeletePhones(code,body,successMessage){
  if(_phonesMutationBusy)return;
  const modal=document.getElementById('phonesModal');
  const label=document.getElementById('phonesLabel').textContent;
  let succeeded=false, refreshRead=false;
  adminSetPhonesBusy(true);
  try{
    const {response,data}=await adminJsonRequest(_RA+'/api/keys/'+encodeURIComponent(code)+'/phones',{
      method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
    });
    if(response.status===401){
      toast('Sua sessão administrativa expirou. Entre novamente.',false);
      refreshRead=true;
    }else if(response.ok&&data.ok===true){
      succeeded=true;toast(successMessage);
    }else{
      toast(adminErrorMessage(data,response.status),false);
      refreshRead=true;
    }
  }catch(e){
    toast(adminUnconfirmedMutationMessage(),false);
    refreshRead=true; // Confirma estado atual via leitura; nunca repetir o DELETE automaticamente.
  }finally{adminSetPhonesBusy(false);}
  if(succeeded){
    closePhones();await doRefresh(false);
  }else if(refreshRead && modal.classList.contains('open') && modal.dataset.code===code){
    await openPhones(code,label);
    await doRefresh(false);
  }
}
async function removePhone(btn){
  if(_phonesMutationBusy)return;
  const modal=document.getElementById('phonesModal'),code=modal.dataset.code;
  let phones=[];
  try{phones=JSON.parse(modal.dataset.phones||'[]');}catch(_){}
  const index=Number(btn?.dataset?.idx);
  if(!Number.isSafeInteger(index)||index<0||!Array.isArray(phones)||typeof phones[index]!=='string'){
    toast('Número não encontrado. Atualize a lista.',false);return;
  }
  const phone=phones[index];
  await adminDeletePhones(code,{phone},'Número removido: '+phone);
}
async function removeAllPhones(){
  if(_phonesMutationBusy)return;
  const modal=document.getElementById('phonesModal');
  let phones=[];try{phones=JSON.parse(modal.dataset.phones||'[]');}catch(_){}
  if(!Array.isArray(phones)||!phones.length){toast('Não há números para remover.',false);return;}
  const code=modal.dataset.code;
  if(!confirm('Remover TODOS os '+phones.length+' números desta chave?'))return;
  await adminDeletePhones(code,{all:true},'Todos os números foram removidos.');
}

function openNote(code,currentNote){document.getElementById('noteKeyCode').value=code;document.getElementById('noteKeyLabel').textContent=code;document.getElementById('noteText').value=currentNote||'';document.getElementById('noteModal').classList.add('open');setTimeout(()=>document.getElementById('noteText').focus(),100);}
function closeNote(){document.getElementById('noteModal').classList.remove('open');}
document.getElementById('noteModal').addEventListener('click',function(e){if(e.target===this)closeNote();});
document.getElementById('kb').addEventListener('click',function(e){const td=e.target.closest('.note-cell');if(!td)return;openNote(td.dataset.code||'',td.dataset.note||'');});
async function saveNote(){
  const code=document.getElementById('noteKeyCode').value,note=document.getElementById('noteText').value.trim();
  const lock=code+':note';
  if(_adminKeyEditsInFlight.has(lock))return;
  _adminKeyEditsInFlight.add(lock);
  try{
    const {response,data}=await adminJsonRequest(_RA+'/api/keys/'+encodeURIComponent(code)+'/note',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note})
    });
    if(response.ok&&data.ok===true){toast('Nota salva!');closeNote();await doRefresh(false);}
    else toast(adminErrorMessage(data,response.status),false);
  }catch(e){toast(adminUnconfirmedMutationMessage(),false);await doRefresh(false);}
  finally{_adminKeyEditsInFlight.delete(lock);}
}

async function exportCSV(){
  try{
    const r=await fetch(_RA+'/api/export/csv',{credentials:'same-origin',headers:{Accept:'text/csv'}});
    if(r.status===401){toast('Sessão expirada',false);return;}
    const ct=String(r.headers.get('content-type')||'').toLowerCase();
    if(!r.ok||!ct.includes('text/csv')){
      let detail={};try{detail=await r.json();}catch(_){}
      toast(adminErrorMessage(detail,r.status),false);
      await doRefresh(false);return;
    }
    const blob=await r.blob();
    if(!blob.size){toast('Exportação vazia; nada foi baixado.',false);return;}
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download='zvm-chaves-'+new Date().toISOString().slice(0,10)+'.csv';
    document.body.appendChild(a);
    try{a.click();toast('CSV atualizado do MongoDB exportado!');}
    finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);}
  }catch(e){toast('Exportação falhou. Nenhum arquivo foi salvo.',false);}
}

async function toggleDevAccess(code,enabled,input){
  const desired=enabled===true;
  if(input)input.disabled=true;
  try{
    const {response,data}=await adminJsonRequest(_RA+'/api/keys/'+encodeURIComponent(code)+'/dev-access',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:desired})
    });
    if(response.ok&&data.ok===true)toast(data.devAccess?'Acesso DEV ativado':'Acesso DEV desativado');
    else{if(input)input.checked=!desired;toast(adminErrorMessage(data,response.status),false);}
  }catch(e){toast(adminUnconfirmedMutationMessage(),false);}
  finally{await doRefresh(false);if(input&&document.body.contains(input))input.disabled=false;}
}
const lr0=document.getElementById('last-refresh');if(lr0)lr0.textContent='Carregado '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
filterKeys();

const _usersDataTpl=document.getElementById('zvm-admin-users-data');
let _usersData=(()=>{try{return JSON.parse(_usersDataTpl?.content?.textContent||'[]')}catch{return []}})();
function switchTab(t){
  const valid=['keys','logs','audit','users','security'];
  if(!valid.includes(t))t='keys'; // localStorage antigo nunca deixa o painel vazio.
  document.querySelectorAll('.rtab').forEach(b=>{
    const active=b.dataset.tab===t;
    b.classList.toggle('active',active);
    if(active)b.setAttribute('aria-current','page');
    else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('.sec-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===t));
  try{localStorage.setItem('zvmTab',t);}catch(e){}
  if(t==='users'){renderUsersTable(_usersData);loadUsers(true);}
  if(t==='security')loadBlacklist();
}
(function(){switchTab(localStorage.getItem('zvmTab')||'keys');})();

async function loadUsers(force){
  force=!!force;
  const tb=document.getElementById('users-tb');
  if(_usersData.length&&!force){renderUsersTable(_usersData);return;}
  if(tb&&!_usersData.length)tb.innerHTML='<tr><td colspan="8" class="empty">Carregando usuários...</td></tr>';
  try{
    const r=await fetch(_RA+'/api/portal-users',{credentials:'same-origin',headers:{'Accept':'application/json'}});
    if(r.status===401){toast('Sessão expirada',false);setTimeout(()=>location.reload(),900);return;}
    const raw=await r.text();
    let d={};try{d=raw?JSON.parse(raw):{};}catch(_e){throw new Error('Resposta inválida do servidor (HTTP '+r.status+')');}
    if(!r.ok||!d.ok){
      if(_usersData.length){renderUsersTable(_usersData);toast('Não foi possível atualizar agora; mantendo o último snapshot válido.',false);return;}
      if(tb)tb.innerHTML='<tr><td colspan="8" class="empty">Falha ao consultar usuários (HTTP '+r.status+'). <button class="btn bw" style="margin-left:8px" data-zvm-dynamic-click="retryUsers">Tentar novamente</button></td></tr>';
      toast(d.error==='db_error'?'Banco temporariamente indisponível':'Erro ao carregar usuários',false);return;
    }
    _usersData=d.users||[];
    renderUsersTable(_usersData);
    if(d.stale)toast('MongoDB oscilou: exibindo o último snapshot disponível.',false);
  }catch(e){
    console.error('portal-users',e);
    if(_usersData.length){renderUsersTable(_usersData);toast('Falha de rede ao atualizar; mantendo os dados já carregados.',false);return;}
    if(tb)tb.innerHTML='<tr><td colspan="8" class="empty">Não foi possível carregar os usuários. <button class="btn bw" style="margin-left:8px" data-zvm-dynamic-click="retryUsers">Tentar novamente</button></td></tr>';
  }
}
function renderUsersTable(list){
  const tb=document.getElementById('users-tb');
  if(!tb)return;
  const setCount=(n)=>{
    const pb=document.getElementById('users-panel-badge');
    const hb=document.getElementById('hdr-users-num');
    const hc=document.getElementById('hdr-users-count');
    const hp=document.getElementById('hero-admin-portal');
    if(pb){pb.textContent=n;pb.style.display=n>0?'inline':'none';}
    if(hb)hb.textContent=n;
    if(hc)hc.style.display=n>0?'inline-flex':'none';
    if(hp)hp.textContent=n;
  };
  if(!list.length){tb.innerHTML='<tr><td colspan="8" class="empty">Nenhum usuário corresponde ao filtro.</td></tr>';setCount(_usersData.length);return;}
  setCount(_usersData.length);
  tb.innerHTML=list.map(u=>{
    const created=u.createdAt?new Date(u.createdAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'-';
    const lastLogin=u.lastLogin?new Date(u.lastLogin).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'-';
    const _eu=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const name=_eu(u.name||u.displayName||'-');
    const email=_eu(u._id||u.email||'-');
    // _eu em TODOS os campos: u.plan pode vir de dados persistidos/controlados por usuários.
    // Sem escape, um label com HTML malicioso executaria no navegador administrativo.
    const phone=u.phone?'<span style="font-family:var(--mono);font-size:13px">'+_eu(u.phone)+'</span>':'<span style="color:var(--tx3)">—</span>';
    const key=u.keyCode?'<span class="kc" style="font-size:12px">'+_eu(u.keyCode)+'</span>':'<span style="color:var(--tx3)">—</span>';
    const plan=u.plan?'<span style="color:var(--g);font-weight:700;font-size:12px">'+_eu(String(u.plan).toUpperCase())+'</span>':'<span style="color:var(--tx3)">—</span>';
    const status=u.banned?'<span class="badge off">Banido</span>':u.verified===false?'<span class="badge" style="background:#ffa04020;color:var(--orange);border:1px solid #ffa04040">Pendente</span>':'<span class="badge on">Ativo</span>';
    return `<tr>
      <td style="font-weight:600">${name}</td>
      <td style="font-family:var(--mono);font-size:12px;color:var(--tx2)">${email}</td>
      <td>${phone}</td>
      <td>${key}</td>
      <td>${plan}</td>
      <td style="font-size:12px;color:var(--tx3)">${created}</td>
      <td style="font-size:12px;color:var(--tx3)">${lastLogin}</td>
      <td>${status}</td>
    </tr>`;
  }).join('');
}
function filterUsers(){
  const q=(document.getElementById('users-search').value||'').toLowerCase();
  if(!q){renderUsersTable(_usersData);return;}
  const filtered=_usersData.filter(u=>{
    const name=(u.name||u.displayName||'').toLowerCase();
    const email=(u._id||u.email||'').toLowerCase();
    const key=(u.keyCode||'').toLowerCase();
    const phone=(u.phone||'').toLowerCase();
    return name.includes(q)||email.includes(q)||key.includes(q)||phone.includes(q);
  });
  renderUsersTable(filtered);
}

async function clearSecurityAlerts(){
  try{
    const r=await fetch(_RA+'/api/security/alerts/clear',{method:'POST'});
    const d=await r.json();
    if(d.ok){
      const tb=document.getElementById('sec-alerts-tb');
      if(tb)tb.innerHTML='<tr><td colspan="4" class="empty">Nenhum alerta registrado — servidor limpo 🟢</td></tr>';
      toast('Logs de segurança limpos');
    }else toast('Erro ao limpar: '+(d.error||'?'),false);
  }catch(e){toast('Erro de rede',false);}
}
async function runPentest(){
  const _esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const btn=document.getElementById('pentest-btn');
  const tb=document.getElementById('pentest-tb');
  const al=document.getElementById('sec-alerts-tb');
  if(btn){btn.disabled=true;btn.textContent='⏳ Analisando...';}
  if(tb)tb.innerHTML='<tr><td class="empty" colspan="3" style="padding:18px">⏳ Executando varredura de segurança...</td></tr>';

  // Dispara pentest e fetch de alertas em paralelo
  try{
    const [rPen, rAl] = await Promise.all([
      fetch(_RA+'/api/pentest/run',{method:'POST'}),
      fetch(_RA+'/api/pentest/alerts'),
    ]);
    if(rPen.status===401){toast('Sessão expirada',false);return;}

    const dPen = await rPen.json();
    const dAl  = rAl.ok ? await rAl.json() : { alerts: [] };

    // ── Resultados do pentest ──
    if(!dPen.results||!dPen.results.length){
      if(tb)tb.innerHTML='<tr><td class="empty" colspan="3">Nenhum resultado retornado.</td></tr>';
    } else {
      const security = dPen.results.filter(x=>x.category!=='operational');
      const passed  = security.filter(x=>x.pass===true).length;
      const failed  = security.filter(x=>x.pass===false).length;
      const operationalWarnings = dPen.results.filter(x=>x.category==='operational' && x.pass!==true);
      const scored = security.filter(x=>x.pass!==null).length;
      const score   = scored ? Math.round((passed/scored)*100) : 0;
      const scoreColor = score===100?'var(--g)':score>=70?'var(--orange)':'var(--red)';

      // Cabeçalho de score
      const scoreHtml = `<tr><td colspan="3" style="padding:10px 14px;border-bottom:1px solid var(--brd)">
        <span style="font-family:'Outfit',sans-serif;font-size:13px;font-weight:700">
          Score de Segurança:&nbsp;
          <span style="color:${scoreColor};font-size:18px">${score}%</span>
          &nbsp;·&nbsp;
          <span style="color:var(--g)">🟢 ${passed} PASSED</span>
          &nbsp;·&nbsp;
          <span style="color:var(--red)">🔴 ${failed} FAILED</span>
          ${operationalWarnings.length?`&nbsp;·&nbsp;<span style="color:var(--orange)">⚠ ${operationalWarnings.length} INDISPONÍVEL (operação)</span>`:''}
        </span>
        <span style="float:right;font-size:11px;color:var(--tx3)">${dPen.ts ? new Date(dPen.ts).toLocaleTimeString('pt-BR') : ''}</span>
      </td></tr>`;

      const orderedResults=[...dPen.results].sort((a,b)=>Number(a.pass===true)-Number(b.pass===true));
      const rows = orderedResults.map(x=>{
        const pass=x.pass===true, fail=x.pass===false;
        const badge=pass
          ?'<span style="color:var(--g);font-weight:700;font-size:16px">🟢</span>&nbsp;<span style="color:var(--g);font-size:11px;font-family:Outfit,sans-serif">PASSED</span>'
          :fail
          ?'<span style="color:var(--red);font-weight:700;font-size:16px">🔴</span>&nbsp;<span style="color:var(--red);font-size:11px;font-family:Outfit,sans-serif">FAILED</span>'
          :'<span style="font-size:15px">⚠️</span>&nbsp;<span style="color:var(--orange);font-size:11px;font-family:Outfit,sans-serif">WARN</span>';
        const rowBg=fail?'background:#ff475708;border-left:2px solid #ff475740':'border-left:2px solid transparent';
        return `<tr style="${rowBg}">
          <td style="font-family:'Space Mono',monospace;font-size:12px;padding:5px 12px">${_esc(x.name)}</td>
          <td style="text-align:center;white-space:nowrap;padding:5px 10px">${badge}</td>
          <td style="font-size:12px;color:var(--tx2);font-family:'Space Mono',monospace;padding:5px 12px">${_esc(x.detail)}</td>
        </tr>`;
      }).join('');
      if(tb)tb.innerHTML=scoreHtml+rows;
    }

    // ── Alertas de segurança recentes ──
    if(al){
      const alerts=(dAl.alerts||[]).slice(0,30);
      if(!alerts.length){
        al.innerHTML='<tr><td colspan="4" class="empty">Nenhum alerta registrado — servidor limpo 🟢</td></tr>';
      } else {
        const catColor={BRUTE_FORCE:'var(--red)',RATE_LIMIT:'var(--orange)',OVERSIZED_PAYLOAD:'var(--orange)',WEBHOOK_INVALID_TOKEN:'var(--red)'};
        al.innerHTML=alerts.map(a=>{
          const ts=a.ts?new Date(a.ts).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'-';
          const cc=catColor[a.category]||'var(--muted)';
          return `<tr>
            <td style="font-size:12px;white-space:nowrap">${ts}</td>
            <td><span style="font-family:'Outfit',sans-serif;font-size:10px;font-weight:700;color:${cc};background:${cc}18;border:1px solid ${cc}40;border-radius:4px;padding:2px 7px">${_esc(a.category||'')}</span></td>
            <td style="font-size:12px;color:var(--muted);font-family:'Space Mono',monospace">${_esc(a.detail||'')}</td>
            <td style="font-size:12px;color:var(--muted)">${_esc(a.ip||'-')}</td>
          </tr>`;
        }).join('');
      }
    }

  }catch(e){
    if(tb)tb.innerHTML='<tr><td class="empty" colspan="3">Erro de rede ao executar auditoria.</td></tr>';
  }finally{
    if(btn){btn.disabled=false;btn.textContent='↻ Re-executar';}
  }
}

/* R47.11: static commands extracted from Admin markup; no inline execution in HTML. */
const _zvmAdminPageActions=Object.freeze({
"click":Object.freeze({"h0":function(event){document.getElementById('filter-status').value='suspect';switchTab('keys');filterKeys()},
"h1":function(event){doRefresh(true)},
"h2":function(event){switchTab('keys')},
"h3":function(event){switchTab('logs')},
"h4":function(event){switchTab('audit')},
"h5":function(event){switchTab('users')},
"h6":function(event){switchTab('security')},
"h8":function(event){document.getElementById('filter-status').value='ativo';filterKeys()},
"h9":function(event){document.getElementById('filter-status').value='bloqueado';filterKeys()},
"ha":function(event){document.getElementById('filter-status').value='aguardando';filterKeys()},
"hb":function(event){document.getElementById('filter-status').value='expirada';filterKeys()},
"hc":function(event){document.getElementById('filter-status').value='expirando';filterKeys()},
"hd":function(event){document.getElementById('filter-status').value='suspect';filterKeys()},
"he":function(event){generateKey()},
"hh":function(event){deleteBatchKeys()},
"hi":function(event){sortKeys('code')},
"hk":function(event){sortKeys('label')},
"hl":function(event){sortKeys('status')},
"hm":function(event){sortKeys('validity')},
"hn":function(event){sortKeys('uses')},
"ho":function(event){sortKeys('phone')},
"hp":function(event){sortKeys('lastused')},
"hq":function(event){sortKeys('created')},
"ht":function(event){clearFilters()},
"hu":function(event){doRefresh()},
"hv":function(event){clearLog()},
"hw":function(event){runPentest()},
"hx":function(event){clearSecurityAlerts()},
"hz":function(event){addToBlacklist()},
"h11":function(event){loadUsers(true)},
"h13":function(event){closeRenew()},
"h14":function(event){saveRenew()},
"h16":function(event){closeEditUses()},
"h17":function(event){saveEditUses()},
"h18":function(event){closeRename()},
"h19":function(event){saveRename()},
"h1a":function(event){closePhones()},
"h1b":function(event){removeAllPhones()},
"h1c":function(event){closeNote()},
"h1d":function(event){saveNote()}}),
"keydown":Object.freeze({"h7":function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}},
"hy":function(event){if(event.key==='Enter')addToBlacklist()}}),
"input":Object.freeze({"hf":function(event){filterKeys()},
"hs":function(event){filterLog()},
"h10":function(event){filterUsers()}}),
"change":Object.freeze({"hg":function(event){filterKeys()},
"hj":function(event){toggleAllCheckboxes(this.checked)},
"hr":function(event){filterLog()},
"h12":function(event){applyRenewMode()},
"h15":function(event){applyUsesUnlimited()}})
});
for(const type of ['click','change','input','keydown']){
 document.addEventListener(type,event=>{
  const element=event.target?.closest?.('[data-zvm-handler-'+type+']');
  if(!element)return;
  const id=element.getAttribute('data-zvm-handler-'+type);
  const callback=_zvmAdminPageActions[type]?.[id];
  if(typeof callback!=='function')return;
  const result=callback.call(element,event);
  if(result===false)event.preventDefault();
 });
}
document.addEventListener('click',event=>{
 const dynamic=event.target?.closest?.('[data-zvm-dynamic-click]');
 if(dynamic?.dataset.zvmDynamicClick==='removePhone')removePhone(dynamic);
 else if(dynamic?.dataset.zvmDynamicClick==='retryUsers')loadUsers(true);
 if(event.target?.closest?.('[data-zvm-handler-click="hExportCsv"]'))exportCSV();
});
