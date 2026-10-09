(function(){
  var ICONS={success:'✓',error:'✕',warning:'!',info:'i'};
  function ensureStack(){var s=document.querySelector('.zvm-toast-stack');if(!s){s=document.createElement('div');s.className='zvm-toast-stack';s.setAttribute('role','status');s.setAttribute('aria-live','polite');document.body.appendChild(s);}return s;}
  window.zvmToast=function(type,msg,duration){
    var t=['success','error','warning','info'].indexOf(type)>=0?type:'info';
    var stack=ensureStack();
    var el=document.createElement('div');
    el.className='zvm-toast '+t;
    var icon=document.createElement('span');icon.className='zvm-toast-icon';icon.setAttribute('aria-hidden','true');icon.textContent=ICONS[t];
    var text=document.createElement('span');text.textContent=msg;
    el.appendChild(icon);el.appendChild(text);
    stack.appendChild(el);
    requestAnimationFrame(function(){el.classList.add('show');});
    var ms=duration||3200;
    setTimeout(function(){el.classList.remove('show');setTimeout(function(){el.remove();},220);},ms);
  };
})();

(function(){
  var copy=document.getElementById('copy-license-key');
  if(copy){copy.addEventListener('click',async function(){try{await navigator.clipboard.writeText(copy.dataset.key||'');var hint=copy.querySelector('.key-copy-hint');hint.textContent='✓ Copiado';if(window.zvmToast)zvmToast('success','Chave copiada para a área de transferência.');setTimeout(function(){hint.textContent='Copiar chave';},1800);}catch(e){if(window.zvmToast)zvmToast('error','Não foi possível copiar. Selecione a chave manualmente.');}});}
  var cd=document.getElementById('license-countdown-grid');
  if(cd&&cd.dataset.expires){
    var end=new Date(cd.dataset.expires).getTime();
    if(Number.isFinite(end)){
      var dEl=cd.querySelector('[data-cd="d"]'),hEl=cd.querySelector('[data-cd="h"]'),mEl=cd.querySelector('[data-cd="m"]'),sEl=cd.querySelector('[data-cd="s"]');
      var bar=document.getElementById('validity-bar-fill');
      function tick(){
        if(document.hidden)return;
        var ms=end-Date.now();
        if(ms<=0){if(dEl)dEl.textContent='0';if(hEl)hEl.textContent='00';if(mEl)mEl.textContent='00';if(sEl)sEl.textContent='00';if(bar){bar.style.width='0%';bar.style.background='#f05060';}return;}
        var days=Math.floor(ms/86400000),hours=Math.floor(ms%86400000/3600000),mins=Math.floor(ms%3600000/60000),secs=Math.floor(ms%60000/1000);
        if(dEl)dEl.textContent=String(days);
        if(hEl)hEl.textContent=String(hours).padStart(2,'0');
        if(mEl)mEl.textContent=String(mins).padStart(2,'0');
        if(sEl)sEl.textContent=String(secs).padStart(2,'0');
      }
      tick();
      var timer=setInterval(tick,1000);
      document.addEventListener('visibilitychange',function(){if(!document.hidden)tick();});
    }
  }
})();

(function(){
  var PRESETS=['default','neon','ocean','violet','sunset','mono','bolt','shield'];
  var btn=document.getElementById('dash-avatar-btn'),dialog=document.getElementById('avatar-dialog');
  if(!btn||!dialog)return;
  function hashKey(str){var h=0;for(var i=0;i<str.length;i++){h=(h*31+str.charCodeAt(i))|0;}return 'u'+Math.abs(h).toString(36);}
  var email=(btn.dataset.email||'').trim().toLowerCase();
  var storageKey='zvm:portal:avatar:'+hashKey(email);
  function applyPreset(id){
    if(PRESETS.indexOf(id)===-1)id='default';
    PRESETS.forEach(function(p){btn.classList.remove('avatar-'+p);});
    btn.classList.add('avatar-'+id);
    dialog.querySelectorAll('.avatar-option').forEach(function(opt){opt.classList.toggle('is-selected',opt.dataset.preset===id);});
    return id;
  }
  var current='default';
  try{var saved=localStorage.getItem(storageKey);if(saved&&PRESETS.indexOf(saved)!==-1)current=saved;}catch(e){}
  applyPreset(current);
  btn.addEventListener('click',function(){
    if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');
    var sel=dialog.querySelector('.avatar-option.is-selected')||dialog.querySelector('.avatar-option');
    if(sel)sel.focus();
  });
  dialog.addEventListener('click',function(e){
    var opt=e.target.closest('[data-preset]');
    if(opt){
      var id=applyPreset(opt.dataset.preset);
      try{localStorage.setItem(storageKey,id);}catch(e2){}
      if(window.zvmToast)zvmToast('success','Avatar atualizado.');
      dialog.close();
      return;
    }
    if(e.target===dialog||e.target.closest('.avatar-dialog-close'))dialog.close();
  });
  dialog.addEventListener('close',function(){btn.focus();});
})();

(function(){
  var p=new URLSearchParams(location.search);if(p.has('ok'))history.replaceState(null,'',location.pathname);
  var bar=document.getElementById('validity-bar-fill');
  if(bar){var w=Number(bar.dataset.width||'0');if(Number.isFinite(w))bar.style.width=Math.max(0,Math.min(100,w))+'%';if(bar.dataset.color)bar.style.background=bar.dataset.color;}
  document.querySelectorAll('form[data-confirm]').forEach(function(form){form.addEventListener('submit',function(e){if(!confirm(form.dataset.confirm||'Confirmar esta ação?'))e.preventDefault();});});
})();
