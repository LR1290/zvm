'use strict';
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
  ['login','devGate','unavailable','app'].forEach(id=>el(id).hidden=id!==section);
  if(section!=='app')window.dispatchEvent(new Event('zvm-cloud-locked'));
 }
 function tab(name){
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.page===name));
  document.querySelectorAll('.view').forEach(view=>view.hidden=view.id!==name);
 }
 async function refresh(){
  try{
   const status=await call('/api/session');
   if(!status.loggedIn){screen('login');return;}
   if(!status.persistence){screen('unavailable');return;}
   el('accountLabel').textContent=status.email||'';
   if(!status.devAuthorized){screen('devGate');return;}
   screen('app');
   tab('summary');
   window.dispatchEvent(new Event('zvm-cloud-ready'));
   try{
    await call('/api/overview');
    const draft=await call('/api/draft');
    el('name').value=draft.name||'';
    el('message').value=draft.message||'';
    preview();
   }catch(error){
    if(error.message==='dev_key_required'||error.message==='site_login_required'){await refresh();return;}
    el('saved').textContent='Não foi possível carregar o rascunho. Verifique a conexão.';
   }
  }catch{screen('unavailable');}
 }
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
   el('name').value='';el('message').value='';el('saved').textContent='';
   await refresh();
  }catch{el('response').textContent='Não foi possível revogar o acesso. Tente novamente.';}
 });
 el('retry').addEventListener('click',refresh);
 document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>tab(b.dataset.page)));
 el('ping').addEventListener('click',async()=>{
  el('response').textContent='Verificando...';
  try{
   const result=await call('/api/ping',{method:'POST'});
   el('response').textContent='Servidor respondeu às '+new Date(result.at).toLocaleTimeString('pt-BR')+'. Teste nº '+result.number+'. Nenhuma mensagem enviada.';
  }catch(error){
   el('response').textContent=error.message==='dev_key_required'?'Chave DEV revogada ou expirada. Recarregue a página.':'Servidor indisponível.';
  }
 });
 function preview(){el('preview').textContent=el('message').value.trim()||'A mensagem aparecerá aqui.';}
 el('message').addEventListener('input',preview);
 el('save').addEventListener('click',async()=>{
  el('save').disabled=true;
  try{
   const saved=await call('/api/draft',body('PUT',{name:el('name').value,message:el('message').value}));
   el('saved').textContent='Salvo na Cloud às '+new Date(saved.updatedAt).toLocaleTimeString('pt-BR')+'. Não agendado.';
  }catch(error){
   el('saved').textContent=error.message==='dev_key_required'?'Acesso DEV não autorizado. Recarregue a página.':'Não foi possível confirmar o salvamento.';
  }finally{el('save').disabled=false;preview();}
 });
 el('clear').addEventListener('click',async()=>{
  if(!confirm('Remover o rascunho deste usuário da Cloud?'))return;
  try{
   await call('/api/draft',{method:'DELETE'});
   el('name').value='';el('message').value='';el('saved').textContent='Rascunho removido da nuvem.';preview();
  }catch{el('saved').textContent='O servidor não confirmou a exclusão.';}
 });
 refresh();
})();