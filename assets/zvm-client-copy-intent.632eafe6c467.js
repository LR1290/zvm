'use strict';
/* Portal-only copy intent from official ZVM license mail.
 * Does not put a license key in a URL or send it to any third party.
 * Browsers may require a fresh click to grant clipboard permission.
 */
(function(){
  if(new URLSearchParams(window.location.search).get('copy')!=='1')return;
  var button=document.getElementById('copy-license-key');
  if(!button)return;
  var value=button.querySelector('.client-key-value');
  function selectKey(){
    try{if(value){var range=document.createRange(),sel=window.getSelection();range.selectNodeContents(value);sel.removeAllRanges();sel.addRange(range);}}catch(_){/* selection is optional */}
    button.focus({preventScroll:true});
    button.scrollIntoView({block:'center',behavior:'instant'});
    button.style.outline='3px solid #00e98b';
    button.style.outlineOffset='5px';
  }
  selectKey();
  if(!navigator.clipboard||typeof navigator.clipboard.writeText!=='function'){
    if(window.zvmToast)window.zvmToast('info','Chave selecionada. Toque em Copiar chave para concluir.');
    return;
  }
  var key=button.dataset.key||'';
  if(!key)return;
  // Some browsers permit the link activation to survive the navigation; others
  // correctly require a second tap. Never claim automatic success on failure.
  navigator.clipboard.writeText(key).then(function(){
    if(window.zvmToast)window.zvmToast('success','Chave copiada para a área de transferência.');
  }).catch(function(){
    selectKey();
    if(window.zvmToast)window.zvmToast('info','Toque em Copiar chave para concluir.');
  });
})();
