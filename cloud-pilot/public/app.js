'use strict';
/* ZVM Cloud R19: shell/auth controller. Draft editing lives in workspace.js. */
(()=>{
 const el=id=>document.getElementById(id);
 const base=new URL(document.currentScript.src).pathname.replace(/\/app\.js$/,'');
 async function call(path,options={}){
  const response=await fetch(base+path,Object.assign({credentials:'same-origin',cache:'no-store'},options));
  let data={};try{data=await response.json();}catch{}
  if(!response.ok)throw Error(data.error||'network_error');
  return data;
 }
 const body=(method,data)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 function screen(section){
  for(const id of ['loading','login','devGate','unavailable','app'])el(id).hidden=id!==section;
  if(section!=='app')window.dispatchEvent(new Event('zvm-cloud-locked'));
 }
 function tab(name){
  document.querySelectorAll('.tabs button').forEach(button=>button.classList.toggle('active',button.dataset.page===name));
  document.querySelectorAll('.view').forEach(view=>view.hidden=view.id!==name);
 }
 async function refresh(){
  screen('loading');
  try{
   const status=await call('/api/session');
   if(!status.loggedIn){screen('login');return;}
   if(!status.persistence){screen('unavailable');return;}
   el('accountLabel').textContent=status.email||'';
   if(!status.devAuthorized){screen('devGate');return;}
   screen('app');
   tab('summary');
   window.dispatchEvent(new Event('zvm-cloud-ready'));
  }catch{
   screen('unavailable');
  }
 }
 function init(){
  el('devForm').addEventListener('submit',async event=>{
   event.preventDefault();el('devError').textContent='';
   const button=el('devForm').querySelector('button');
   button.disabled=true;
   try{
    await call('/api/dev/activate',body('POST',{key:el('devKey').value}));
    el('devKey').value='';
    await refresh();
   }catch(error){
    el('devError').textContent=error.message==='try_again_later'?'Muitas tentativas. Tente mais tarde.':
     error.message==='site_login_required'?'Entre novamente na sua conta ZVM.':
     error.message==='dev_key_not_authorized'?'A chave precisa estar vinculada à sua conta, ativa e com Acesso DEV.':'Não foi possível validar essa chave.';
   }finally{button.disabled=false;}
  });
  el('leaveDev').addEventListener('click',async()=>{
   try{
    await call('/api/dev/leave',{method:'POST'});
    await refresh();
   }catch{el('response').textContent='Não foi possível revogar o acesso. Tente novamente.';}
  });
  el('retry').addEventListener('click',refresh);
  document.querySelectorAll('.tabs button').forEach(button=>button.addEventListener('click',()=>tab(button.dataset.page)));
  el('ping').addEventListener('click',async()=>{
   el('response').textContent='Verificando...';
   try{
    const result=await call('/api/ping',{method:'POST'});
    el('response').textContent='Servidor respondeu às '+new Date(result.at).toLocaleTimeString('pt-BR')+'. Teste nº '+result.number+'. Nenhuma mensagem enviada.';
   }catch(error){
    el('response').textContent=error.message==='dev_key_required'?'Chave DEV revogada ou expirada. Recarregue a página.':'Servidor indisponível.';
   }
  });
  refresh();
 }
 try{init();}catch(error){
  console.error('[ZVM-CLOUD] Falha de inicialização da interface:',error?.name||'Error');
  screen('unavailable');
 }
})();
