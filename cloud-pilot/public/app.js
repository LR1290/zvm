'use strict';
(()=>{
 const el=id=>document.getElementById(id);
 async function call(url,opts={}){
  const res=await fetch(url,Object.assign({credentials:'same-origin',cache:'no-store'},opts));
  let x={};try{x=await res.json();}catch{}
  if(!res.ok)throw Error(x.error||'network');
  return x;
 }
 const write=(method,data)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 let role=null;
 function screen(ok){el('login').hidden=ok;el('app').hidden=!ok;}
 function tab(name){
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.page===name));
  document.querySelectorAll('.view').forEach(s=>s.hidden=s.id!==name);
 }
 async function state(){
  try{
   const s=await call('/api/session');
   screen(s.loggedIn);
   el('sealed').hidden=s.configured;
   el('form').hidden=!s.configured;
   if(s.loggedIn)await load();
  }catch{screen(false);el('error').textContent='Servidor indisponível. Tente novamente.';}
 }
 async function load(){
  let user;try{user=await call('/api/overview');}catch{screen(false);return;}
  role=user.role;
  el('adminTab').hidden=role!=='admin';
  ['campaigns','flows','funnels','library'].forEach(id=>{
   const b=document.querySelector('.tabs button[data-page="'+id+'"]');
   b.hidden=role==='admin';
  });
  if(role==='admin'){tab('admin');await admin();return;}
  tab('summary');
  try{
   const d=await call('/api/draft');
   el('name').value=d.name||'';el('message').value=d.message||'';
  }catch{el('saved').textContent='Não foi possível recuperar o rascunho armazenado na nuvem.';}
  preview();
 }
 async function admin(){
  try{
   const record=await call('/api/admin/guest');
   el('guestInfo').textContent=record.user?(record.user.email+' — '+(record.user.enabled?'Autorizada':'Desativada')):'Nenhuma cliente cadastrada.';
   el('guestEmail').value=record.user?.email||'';
  }catch{el('guestInfo').textContent='Não foi possível consultar a conta.';}
 }
 el('form').addEventListener('submit',async e=>{
  e.preventDefault();el('error').textContent='';
  const btn=el('form').querySelector('button');btn.disabled=true;
  try{
   await call('/api/login',write('POST',{email:el('email').value,password:el('password').value}));
   el('password').value='';screen(true);await load();
  }catch(e){
   el('error').textContent=e.message==='rate_limited'?'Muitas tentativas. Tente novamente mais tarde.':
    e.message==='setup_pending'?'Acesso aguardando ativação pelo administrador.':'E-mail ou senha incorretos.';
  }finally{btn.disabled=false;}
 });
 el('logout').addEventListener('click',async()=>{
  try{await call('/api/logout',{method:'POST'});}catch{}
  role=null;screen(false);el('password').value='';el('name').value='';el('message').value='';
 });
 document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>{
  if(b.hidden||role==='admin'&&b.dataset.page!=='summary'&&b.dataset.page!=='admin')return;
  tab(b.dataset.page);
 }));
 el('ping').addEventListener('click',async()=>{
  el('response').textContent='Verificando...';
  try{const r=await call('/api/ping',{method:'POST'});
   el('response').textContent='Conexão OK às '+new Date(r.at).toLocaleTimeString('pt-BR')+'. Verificação nº '+r.number+'; nenhum envio realizado.';
  }catch{el('response').textContent='Servidor temporariamente indisponível.';}
 });
 function preview(){el('preview').textContent=el('message').value.trim()||'A mensagem aparecerá aqui.';}
 el('message').addEventListener('input',preview);
 el('save').addEventListener('click',async()=>{
  const btn=el('save');btn.disabled=true;
  try{
   const r=await call('/api/draft',write('PUT',{name:el('name').value,message:el('message').value}));
   el('saved').textContent='Rascunho salvo no banco da ZVM Cloud às '+new Date(r.updatedAt).toLocaleTimeString('pt-BR')+'. Nenhum envio agendado.';
  }catch{el('saved').textContent='Falha ao salvar. O rascunho não foi confirmado no servidor.';}
  finally{btn.disabled=false;}preview();
 });
 el('clear').addEventListener('click',async()=>{
  if(!confirm('Apagar o rascunho deste teste?'))return;
  try{await call('/api/draft',{method:'DELETE'});el('name').value='';el('message').value='';el('saved').textContent='Rascunho apagado do servidor.';preview();}
  catch{el('saved').textContent='O servidor não confirmou a exclusão.';}
 });
 el('guestForm').addEventListener('submit',async e=>{
  e.preventDefault();const btn=el('guestForm').querySelector('button[type=submit]');btn.disabled=true;
  try{
   const email=el('guestEmail').value,password=el('guestPass').value;
   if(!confirm('Autorizar '+email+'? Se uma conta diferente já existir, o acesso anterior será revogado e seu rascunho removido.'))return;
   await call('/api/admin/guest',write('POST',{email,password}));
   el('guestPass').value='';el('adminResult').textContent='Conta autorizada. Compartilhe a senha por canal privado.';await admin();
  }catch{el('adminResult').textContent='Erro ao cadastrar. Verifique o e-mail e use uma senha de pelo menos 12 caracteres.';}
  finally{btn.disabled=false;}
 });
 el('revoke').addEventListener('click',async()=>{
  if(!confirm('REVOGAR a conta de teste? A convidada perderá acesso e seu rascunho será apagado.'))return;
  try{await call('/api/admin/guest',{method:'DELETE'});el('guestPass').value='';el('adminResult').textContent='Acesso revogado e dados de teste removidos.';await admin();}
  catch{el('adminResult').textContent='Não foi possível revogar. Verifique o servidor.';}
 });
 state();
})();
