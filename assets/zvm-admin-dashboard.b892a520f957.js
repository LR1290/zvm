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
  if(status===409||code==='key_write_conflict')return 'Esta chave foi alterada por outra operação. Atualize o painel antes de tentar novamente.';
  if(status===503||code==='db_unavailable'||code==='admin_data_unavailable')return 'Banco de dados temporariamente indisponível. Atualize a lista para confirmar o resultado antes de repetir a ação.';
  if(status===429)return 'Muitas operações simultâneas. Aguarde o tempo informado pelo servidor.';
  return code?'Não foi possível concluir: '+code:'Não foi possível concluir a operação (HTTP '+status+').';
}
function filterKeys(){
  const q=(document.getElementById('search-input').value||'').toLowerCase();
  const st=document.getElementById('filter-status').value;
  const fp=(document.getElementById('filter-plan')||{}).value||'';
  const isSuspectFilter=st==='suspect';
  let shown=0,total=0;
  document.querySelectorAll('#kb tr[data-label]').forEach(row=>{
    total++;
    const label=(row.dataset.label||'').toLowerCase();
    const phone=(row.dataset.phone||'').toLowerCase();
    const status=(row.dataset.status||'').toLowerCase();
    const code=(row.dataset.code||'').toLowerCase();
    const plan=(row.dataset.plan||'').toLowerCase();
    const ip=(row.cells[7]||{}).textContent||'';
    const matchQ=!q||label.includes(q)||phone.includes(q)||code.includes(q)||ip.toLowerCase().includes(q);
    const matchSt=!st||(isSuspectFilter?row.dataset.suspect==='1':status===st);
    const matchPlan=!fp||plan===fp;
    const visible=matchQ&&matchSt&&matchPlan;
    row.style.display=visible?'':'none';
    if(visible)shown++;
  });
  const fc=document.getElementById('keys-filter-count');
  if(fc)fc.textContent=(st||q||fp)?(shown+' de '+total+' chave(s) exibida(s)'):(total+' chave(s)');
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

async function generateKey(){
  const label=document.getElementById('nlabel').value.trim();
  const days=parseInt(document.getElementById('ndays').value||0);
  const hours=parseInt(document.getElementById('nhours').value||0);
  const mins=parseInt(document.getElementById('nmins').value||0);
  const _u=document.getElementById('nuses').value.trim();
  const maxUses=_u===''?3:parseInt(_u);
  const qty=Math.min(50,Math.max(1,parseInt(document.getElementById('batch-qty')?.value||'1',10)));
  if(!label){toast('Informe o nome do cliente',false);return;}
  if(isNaN(maxUses)){toast('❌ Usos inválido',false);return;}
  const baseBody={maxUses};
  if(days>0)baseBody.expireDays=days;if(hours>0)baseBody.expireHours=hours;if(mins>0)baseBody.expireMinutes=mins;
  const def=document.getElementById('ndeferred');if(def&&def.checked)baseBody.deferred=true;
  const generated=[];
  try{
    for(let i=0;i<qty;i++){
      const lbl=qty>1?label+' #'+(i+1):label;
      const r=await fetch(_RA+'/api/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...baseBody,label:lbl})});
      if(r.status===401){toast('Sessão expirada',false);setTimeout(()=>location.href=_RA,1500);return;}
      const d=await r.json();
      if(d.ok)generated.push({label:lbl,code:d.key});
      else{toast('❌ Chave '+(i+1)+': '+adminErrorMessage(d,r.status),false);break;}
    }
    if(!generated.length)return;
    if(qty===1){
      const exp=[];if(days>0)exp.push(days+'d');if(hours>0)exp.push(hours+'h');if(mins>0)exp.push(mins+'min');
      toast('✅ '+generated[0].code+(exp.length?' · '+exp.join(' '):' · sem expiração')+' · '+(maxUses===-1?'∞ usos':maxUses+' uso(s)'));
    } else {
      toast('✅ '+generated.length+' chaves geradas! Download CSV iniciado.');
      const csv='Cliente,Chave\n'+generated.map(c=>'"'+c.label.replace(/"/g,'""')+'","'+c.code+'"').join('\n');
      const a=document.createElement('a');
      a.href='data:text/csv;charset=utf-8,﻿'+encodeURIComponent(csv);
      a.download='chaves_'+new Date().toISOString().slice(0,10)+'.csv';
      document.body.appendChild(a);a.click();document.body.removeChild(a);
    }
    ['nlabel','ndays','nhours','nmins','nuses'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    if(def)def.checked=false;
    const bq=document.getElementById('batch-qty');if(bq)bq.value='1';
    await doRefresh();
  }catch(e){toast('❌ Erro de rede',false);}
}

async function doRefresh(manual){
  try{
    const r=await fetch(_RA+'/api/data');
    if(r.status===401){toast('⏱ Sessão expirada — redirecionando...',false);setTimeout(()=>location.href=_RA,1800);return;}
    const d=await r.json();
    if(!r.ok||d.error){
      // Preserva os últimos dados válidos durante uma falha de leitura.
      if(manual)toast(adminErrorMessage(d,r.status),false);
      return;
    }
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
    const lr=document.getElementById('last-refresh');
    if(lr)lr.textContent='Atualizado '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    // Badge de chaves suspeitas no header
    const suspN=d.suspectKeys||0;
    const sb=document.getElementById('hdr-suspect-badge'),sbn=document.getElementById('hdr-suspect-num');
    if(sb&&sbn){sbn.textContent=suspN;sb.style.opacity=suspN>0?'1':'0.45';sb.style.pointerEvents=suspN>0?'auto':'none';}
    filterKeys();
    const usersPanel=document.querySelector('.sec-panel[data-panel="users"]');
    if(usersPanel&&usersPanel.classList.contains('active'))await loadUsers(true);
    if(manual)toast('Painel atualizado');
  }catch(e){console.error('Refresh error',e);if(manual)toast('Erro ao atualizar',false);}
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
async function loadBlacklist(){
  try{
    const r=await fetch(_RA+'/api/ip-blacklist');
    if(!r.ok)return;
    const d=await r.json();
    const tb=document.getElementById('ip-bl-tb');
    if(!tb)return;
    if(!d.ips||!d.ips.length){tb.innerHTML='<tr><td colspan="2" class="empty">Nenhum IP bloqueado</td></tr>';return;}
    tb.innerHTML='';
    d.ips.forEach(function(ip){
      const tr=document.createElement('tr');
      const td1=document.createElement('td');td1.style.cssText='font-family:monospace;font-size:13px';td1.textContent=ip;
      const td2=document.createElement('td');td2.style.textAlign='center';
      const btn=document.createElement('button');btn.className='bs bd';btn.style.cssText='font-size:11px;padding:3px 8px';btn.textContent='Remover';
      btn.onclick=function(){removeFromBlacklist(ip);};
      td2.appendChild(btn);tr.appendChild(td1);tr.appendChild(td2);tb.appendChild(tr);
    });
  }catch{}
}
async function addToBlacklist(){
  const inp=document.getElementById('ip-bl-input');
  const ip=(inp&&inp.value||'').trim();
  if(!ip){toast('Informe um IP.',false);return;}
  const r=await fetch(_RA+'/api/ip-blacklist/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ip})});
  const d=await r.json();
  if(d.ok){inp.value='';toast('IP bloqueado: '+ip);loadBlacklist();}else toast(adminErrorMessage(d,r.status),false);
}
async function removeFromBlacklist(ip){
  if(!confirm('Remover '+ip+' da blacklist?'))return;
  const r=await fetch(_RA+'/api/ip-blacklist/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ip})});
  const d=await r.json();
  if(d.ok){toast('IP removido.');loadBlacklist();}else toast(adminErrorMessage(d,r.status),false);
}

// TOTP Setup
async function toggleKey(code){
  try{const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/toggle',{method:'POST'});if(r.status===401){toast('Sessão expirada',false);return;}const d=await r.json();if(d.ok){toast(d.active?'Chave liberada!':'Chave bloqueada!');await doRefresh();}else if(r.status===409){toast('Esta chave foi alterada em outra sessão. Atualizando...',false);await doRefresh();}else{toast(adminErrorMessage(d,r.status),false);}}catch(e){toast('Erro',false);}
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
async function deleteKey(code){
  if(!confirm('Excluir chave '+code+'?'))return;
  try{const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code),{method:'DELETE'});if(r.status===401){toast('Sessão expirada',false);return;}const d=await r.json();if(d.ok){toast('Chave excluída');await doRefresh();}else toast(adminErrorMessage(d,r.status),false);}catch(e){toast('Erro',false);}
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
  const rows=[...document.querySelectorAll('#kb .key-cb:checked')].map(cb=>cb.closest('tr')).filter(Boolean);
  const codes=rows.map(r=>r.dataset.code).filter(Boolean);
  if(!codes.length)return;
  const labels=rows.map(r=>r.dataset.label||r.dataset.code).slice(0,8);
  const preview=labels.join('\n') + (codes.length>8?'\n… e mais '+(codes.length-8):'');
  if(!confirm('Excluir '+codes.length+' chave(s)? Esta ação é irreversível.\n\n'+preview))return;
  try{
    const r=await fetch(_RA+'/api/keys/batch',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({codes})});
    if(r.status===401){toast('Sessão expirada',false);return;}
    const d=await r.json();
    if(d.ok){toast('🗑 '+d.deleted+' chave(s) excluída(s)');await doRefresh();}
    else toast(adminErrorMessage(d,r.status),false);
  }catch(e){toast('Erro de rede',false);}
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
async function clearLog(){
  const date=document.getElementById('logDate').value;
  if(!confirm(date?'Limpar logs do dia '+date+'?':'Limpar TODO o log?'))return;
  try{const body=date?{date}:{};const r=await fetch(_RA+'/api/logs',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(d.ok){toast(date?'Log do dia limpo!':'Log completo apagado!');clearFilters();}}catch(e){toast('Erro ao limpar',false);}
}

function openRenew(code,label){
  document.getElementById('renewKeyCode').value=code;
  document.getElementById('renewKeyLabel').textContent=label;
  ['renewDays','renewHours','renewMins'].forEach(id=>document.getElementById(id).value='');
  const row=document.querySelector('#kb tr[data-code="'+code+'"]');
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
  document.getElementById('renewDays').focus();
}
function closeRenew(){document.getElementById('renewModal').classList.remove('open');}
document.getElementById('renewModal').addEventListener('click',function(e){if(e.target===this)closeRenew();});
async function saveRenew(){
  const code=document.getElementById('renewKeyCode').value;
  const days=parseInt(document.getElementById('renewDays').value)||0;
  const hours=parseInt(document.getElementById('renewHours').value)||0;
  const mins=parseInt(document.getElementById('renewMins').value)||0;
  if(!days&&!hours&&!mins){toast('Informe pelo menos um valor.',false);return;}
  const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/renew',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({days,hours,mins})});
  const d=await r.json();if(d.ok){toast('✅ Tempo adicionado! Expira: '+new Date(d.expiresAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}));closeRenew();await doRefresh();}else toast(adminErrorMessage(d,r.status),false);
}

function openEditUses(code,label,current){document.getElementById('editUsesCode').value=code;document.getElementById('editUsesLabel').textContent=label;document.getElementById('editUsesValue').value=current;document.getElementById('editUsesModal').classList.add('open');setTimeout(()=>{document.getElementById('editUsesValue').focus();document.getElementById('editUsesValue').select();},50);}
function closeEditUses(){document.getElementById('editUsesModal').classList.remove('open');}
document.getElementById('editUsesModal').addEventListener('click',function(e){if(e.target===this)closeEditUses();});
async function saveEditUses(){
  const code=document.getElementById('editUsesCode').value;
  const val=document.getElementById('editUsesValue').value.trim();
  const maxUses=val===''?3:parseInt(val);
  if(isNaN(maxUses)||maxUses<-1){toast('❌ Valor inválido.',false);return;}
  const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/max-uses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({maxUses})});
  const d=await r.json();if(d.ok){toast('✅ Limite: '+(maxUses===-1?'ilimitado':maxUses+' dispositivo(s)'));closeEditUses();await doRefresh();}else toast(adminErrorMessage(d,r.status),false);
}

function openRename(code,label){document.getElementById('renameCode').value=code;document.getElementById('renameValue').value=label;document.getElementById('renameModal').classList.add('open');setTimeout(()=>{const v=document.getElementById('renameValue');v.focus();v.select();},50);}
function closeRename(){document.getElementById('renameModal').classList.remove('open');}
document.getElementById('renameModal').addEventListener('click',function(e){if(e.target===this)closeRename();});
document.getElementById('renameValue').addEventListener('keydown',function(e){if(e.key==='Enter')saveRename();});
async function saveRename(){
  const code=document.getElementById('renameCode').value;
  const label=document.getElementById('renameValue').value.trim();
  if(!label){toast('Nome não pode ser vazio.',false);return;}
  const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/label',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label})});
  const d=await r.json();if(d.ok){toast('Renomeado: '+label);closeRename();await doRefresh();}else toast(adminErrorMessage(d,r.status),false);
}

function openPhones(code,label){
  const modal=document.getElementById('phonesModal');modal.dataset.code=code;
  document.getElementById('phonesLabel').textContent=label;
  const list=document.getElementById('phonesList');list.innerHTML='Carregando...';modal.classList.add('open');
  fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/phones').then(r=>r.json()).then(d=>{
    if(!d.phones||d.phones.length===0){list.innerHTML='<em style="color:var(--muted);font-size:12px">Nenhum número cadastrado</em>';document.getElementById('removeAllBtn').style.display='none';modal.dataset.phones='[]';return;}
    document.getElementById('removeAllBtn').style.display='';modal.dataset.phones=JSON.stringify(d.phones);
    list.innerHTML=d.phones.map((ph,i)=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-size:13px;font-family:monospace;color:var(--text)">'+ph.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]))+'</span><button class="bs bd" data-idx="'+i+'" onclick="removePhone(this)">Remover</button></div>').join('');
  }).catch(()=>{list.innerHTML='<em style="color:var(--red)">Erro ao carregar</em>';});
}
function closePhones(){document.getElementById('phonesModal').classList.remove('open');}
document.getElementById('phonesModal').addEventListener('click',function(e){if(e.target===this)closePhones();});
async function removePhone(btn){
  const modal=document.getElementById('phonesModal'),code=modal.dataset.code,phones=JSON.parse(modal.dataset.phones||'[]'),phone=phones[parseInt(btn.dataset.idx)];
  if(!phone){toast('Erro: número não encontrado.',false);return;}
  const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/phones',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone})});
  const d=await r.json();if(d.ok){toast('Número removido: '+phone);closePhones();await doRefresh();}else toast(adminErrorMessage(d,r.status),false);
}
async function removeAllPhones(){
  const code=document.getElementById('phonesModal').dataset.code;
  if(!confirm('Remover TODOS os números desta chave?'))return;
  const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/phones',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({all:true})});
  const d=await r.json();if(d.ok){toast('Todos removidos.');closePhones();await doRefresh();}else toast(adminErrorMessage(d,r.status),false);
}

function openNote(code,currentNote){document.getElementById('noteKeyCode').value=code;document.getElementById('noteKeyLabel').textContent=code;document.getElementById('noteText').value=currentNote||'';document.getElementById('noteModal').classList.add('open');setTimeout(()=>document.getElementById('noteText').focus(),100);}
function closeNote(){document.getElementById('noteModal').classList.remove('open');}
document.getElementById('noteModal').addEventListener('click',function(e){if(e.target===this)closeNote();});
document.getElementById('kb').addEventListener('click',function(e){const td=e.target.closest('.note-cell');if(!td)return;openNote(td.dataset.code||'',td.dataset.note||'');});
async function saveNote(){
  const code=document.getElementById('noteKeyCode').value,note=document.getElementById('noteText').value.trim();
  const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/note',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note})});
  const d=await r.json();if(d.ok){toast('Nota salva!');closeNote();await doRefresh();}else toast('Erro ao salvar nota',false);
}

async function exportCSV(){
  try{const r=await fetch(_RA+'/api/export/csv');if(r.status===401){toast('Sessão expirada',false);return;}const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='zvm-chaves-'+new Date().toISOString().slice(0,10)+'.csv';a.click();URL.revokeObjectURL(url);toast('CSV exportado!');}catch(e){toast('Erro ao exportar',false);}
}
async function toggleDevAccess(code,enabled,input){
  const desired=enabled===true;
  if(input)input.disabled=true;
  try{
    const r=await fetch(_RA+'/api/keys/'+encodeURIComponent(code)+'/dev-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:desired})});
    const d=await r.json();
    if(!r.ok||!d.ok){if(input)input.checked=!desired;toast('Erro: '+(d.error||'não foi possível alterar Acesso DEV'),false);return;}
    toast(d.devAccess?'Acesso DEV ativado':'Acesso DEV desativado');
    await doRefresh();
  }catch(e){if(input)input.checked=!desired;toast('Erro de rede ao alterar Acesso DEV',false);}
  finally{if(input&&document.body.contains(input))input.disabled=false;}
}

const lr0=document.getElementById('last-refresh');if(lr0)lr0.textContent='Carregado '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
filterKeys();

const _usersDataTpl=document.getElementById('zvm-admin-users-data');
let _usersData=(()=>{try{return JSON.parse(_usersDataTpl?.content?.textContent||'[]')}catch{return []}})();
function switchTab(t){
  document.querySelectorAll('.rtab').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));
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
      if(tb)tb.innerHTML='<tr><td colspan="8" class="empty">Falha ao consultar usuários (HTTP '+r.status+'). <button class="btn bw" style="margin-left:8px" onclick="loadUsers(true)">Tentar novamente</button></td></tr>';
      toast(d.error==='db_error'?'Banco temporariamente indisponível':'Erro ao carregar usuários',false);return;
    }
    _usersData=d.users||[];
    renderUsersTable(_usersData);
    if(d.stale)toast('MongoDB oscilou: exibindo o último snapshot disponível.',false);
  }catch(e){
    console.error('portal-users',e);
    if(_usersData.length){renderUsersTable(_usersData);toast('Falha de rede ao atualizar; mantendo os dados já carregados.',false);return;}
    if(tb)tb.innerHTML='<tr><td colspan="8" class="empty">Não foi possível carregar os usuários. <button class="btn bw" style="margin-left:8px" onclick="loadUsers(true)">Tentar novamente</button></td></tr>';
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
  if(!list.length){tb.innerHTML='<tr><td colspan="8" class="empty">Nenhum usuário cadastrado.</td></tr>';setCount(0);return;}
  setCount(list.length);
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
