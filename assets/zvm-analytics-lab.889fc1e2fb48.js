'use strict';
/* Analytics lab R46.68: deterministic template selection; no automatic requests. */
(function(){
const root=document.getElementById('lab-sec');if(!root)return;
const $=id=>document.getElementById(id);
const sale=$('lab-sale-pane'),email=$('lab-email-pane'),tabs=[...root.querySelectorAll('[data-lab-mode]')];
function tab(mode){sale.hidden=mode!=='sale';email.hidden=mode!=='email';tabs.forEach(b=>{const active=b.dataset.labMode===mode;b.classList.toggle('is-active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;});}
tabs.forEach(b=>b.addEventListener('click',()=>tab(b.dataset.labMode)));
const plan=$('lab-mail-plan'),kind=$('lab-mail-kind'),status=$('lab-email-status'),frame=$('lab-iframe'),hidden=$('lab-tpl');
function selection(){const id=plan.value,type=kind.value;if(!['start','pro','enterprise'].includes(id)||!['new','renewal'].includes(type))return null;return {planId:id,kind:type,template:'delivery_'+(type==='renewal'?'renewal_':'')+id};}
function update(){const s=selection();if(!s)return;hidden.value=s.template;frame.removeAttribute('srcdoc');frame.style.display='none';status.textContent='Selecione Visualizar para gerar a prévia. Nada será enviado automaticamente.';const label=$('lab-mail-summary');if(label)label.textContent=plan.options[plan.selectedIndex].text+' · '+(s.kind==='renewal'?'Renovação':'Nova licença');}
plan.addEventListener('change',update);kind.addEventListener('change',update);
const buttons=[...root.querySelectorAll('.lab-mail-action')];
function mask(s){return String(s).replace(/^(.)([^@]*)(@.*)$/,'$1***$3');}
async function perform(send){
const s=selection();if(!s)return;
const to=$('lab-tpl-email').value.trim().toLowerCase();
if(send&& !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)){status.textContent='Informe um destinatário válido.';return;}
if(send&&!confirm('Enviar um e-mail de TESTE '+s.planId.toUpperCase()+' para '+to+'?'))return;
buttons.forEach(b=>b.disabled=true);status.textContent=send?'Enviando teste…':'Gerando prévia…';
try{
const rootPath=document.documentElement.dataset.analyticsRoot||'/analytics';
const response=await fetch(rootPath+'/api/lab/email-'+(send?'send':'preview'),{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({...s,...(send?{email:to}:{})})});
const body=await response.json();
if(!response.ok||(send&&!body.ok)){
if(typeof window.labRenderStatus==='function')window.labRenderStatus(status,{short:'Não foi possível '+(send?'enviar':'visualizar')+' o e-mail.',detail:String(body.reason||body.error||response.status).slice(0,160)});
else status.textContent='Falha: '+(body.reason||body.error||response.status);
}else if(send){status.textContent='✓ Provedor aceitou o teste para '+mask(to)+'. Confira a caixa de entrada.';}
else {frame.srcdoc=body.html;frame.style.display='block';status.textContent='✓ Prévia pronta · '+(body.subject||'');}
}catch(e){status.textContent='Falha de conexão. Confira a sessão.';}
finally{buttons.forEach(b=>b.disabled=false);}
}
$('lab-mail-preview-btn').addEventListener('click',()=>perform(false));
$('lab-mail-send-btn').addEventListener('click',()=>perform(true));
update();tab('sale');
})();
