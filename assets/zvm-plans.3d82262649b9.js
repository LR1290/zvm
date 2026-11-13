(function(){
  var d=document.querySelector('.checkout-dialog'),last=null,go=d&&d.querySelector('.modal-continue');
  var nameEl=document.getElementById('modal-plan-name'),metaEl=document.getElementById('modal-plan-meta'),priceEl=document.getElementById('modal-plan-price');
  function open(btn){
    if(!d||!btn.dataset.checkout)return;
    last=btn;
    if(go&&btn.dataset.checkout)go.href=btn.dataset.checkout;
    if(nameEl)nameEl.textContent='ZVM '+(btn.dataset.planName||'');
    var lang=document.documentElement.lang;
    var n=Number(btn.dataset.devices||0),days=Number(btn.dataset.duration||0);
    if(metaEl){
      if(lang==='en')metaEl.textContent=n+' WhatsApp number'+(n===1?'':'s')+' · '+days+' days';
      else if(lang==='pt-PT')metaEl.textContent=n+' número'+(n===1?'':'s')+' de WhatsApp · '+days+' dias';
      else metaEl.textContent=n+' número'+(n===1?'':'s')+' · '+days+' dias';
    }
    if(priceEl)priceEl.textContent='R$ '+(btn.dataset.price||'');
    if(d.showModal)d.showModal();else d.setAttribute('open','');
    var focus=d.querySelector('.modal-continue,.modal-login,.modal-cancel');if(focus)focus.focus();
  }
  document.addEventListener('click',function(e){var btn=e.target.closest('[data-buy-plan]');if(btn){open(btn);return;}if(e.target.closest('.modal-cancel'))d.close();});
  if(d){d.addEventListener('click',function(e){if(e.target===d)d.close();});d.addEventListener('close',function(){if(last)last.focus();});}
  // Allow direct links from the landing and previously shared #plan-* URLs.
  // Focus the intended card, then keep a clean canonical /planos address.
  function focusLinkedPlan() {
    var url;
    try { url = new URL(window.location.href); } catch (_) { return; }
    var selected = url.searchParams.get('plano');
    if (!selected && /^#plan-(solo|padrao|pro|empresarial)$/.test(url.hash)) selected = url.hash.slice(6);
    if (!/^(solo|padrao|pro|empresarial)$/.test(selected || '')) return;
    var card = document.querySelector('.price-card[data-plan-id="'+selected+'"]');
    if (!card) return;
    url.searchParams.delete('plano'); url.hash='';
    try { history.replaceState(history.state, '', url.pathname + url.search); } catch (_) {}
    window.requestAnimationFrame(function(){
      var top = window.scrollY + card.getBoundingClientRect().top - (document.querySelector('.znav')?.offsetHeight || 0) - 18;
      window.scrollTo({top:Math.max(0,top),behavior:'auto'});
    });
  }
  if(document.readyState==='complete')focusLinkedPlan();else window.addEventListener('load',focusLinkedPlan,{once:true});
  document.querySelectorAll('input[name="need"]').forEach(function(r){r.addEventListener('change',function(){document.querySelectorAll('.price-card').forEach(function(c){c.classList.toggle('suggested',c.dataset.planId===r.value);});});});
})();
