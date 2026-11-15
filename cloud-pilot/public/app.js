'use strict';(()=>{
 const el=id=>document.getElementById(id);
 async function call(url,opts={}){const res=await fetch(url,Object.assign({credentials:'same-origin',cache:'no-store'},opts));let x={};try{x=await res.json();}catch{}if(!res.ok)throw Error(x.error||'network');return x;}
 const key='zvm-cloud-pilot-draft';
 function show(ok){el('login').hidden=ok;el('app').hidden=!ok;}
 async function reload(){
  try{const s=await call('/api/session');show(s.loggedIn);el('sealed').hidden=s.configured;el('form').hidden=!s.configured;if(s.loggedIn)await load();}
  catch{show(false);el('error').textContent='Não foi possível contactar o servidor.';}
 }
 async function load(){
  try{await call('/api/overview');}catch{show(false);return;}
  try{const v=JSON.parse(localStorage.getItem(key)||'{}');el('name').value=(v.name||'').slice(0,80);el('message').value=(v.message||'').slice(0,2000);}catch{}
  preview();
 }
 el('form').addEventListener('submit',async e=>{
  e.preventDefault();el('error').textContent='';const btn=el('form').querySelector('button');btn.disabled=true;
  try{await call('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:el('email').value,password:el('password').value})});el('password').value='';show(true);await load();}
  catch(e){el('error').textContent=e.message==='rate_limited'?'Excesso de tentativas. Tente mais tarde.':'Acesso não autorizado.';}
  finally{btn.disabled=false;}
 });
 el('logout').addEventListener('click',async()=>{try{await call('/api/logout',{method:'POST'});}catch{}show(false);});
 document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('active',x===b));
  document.querySelectorAll('.view').forEach(x=>x.hidden=x.id!==b.dataset.page);
 }));
 el('ping').addEventListener('click',async()=>{el('response').textContent='Verificando...';try{const r=await call('/api/ping',{method:'POST'});el('response').textContent='Conexão OK às '+new Date(r.at).toLocaleTimeString('pt-BR')+'. Teste nº '+r.number+'; nenhum envio realizado.';}catch{el('response').textContent='Servidor indisponível.';}});
 function preview(){el('preview').textContent=el('message').value.trim()||'A mensagem aparecerá aqui.';}
 el('message').addEventListener('input',preview);
 el('save').addEventListener('click',()=>{try{localStorage.setItem(key,JSON.stringify({name:el('name').value,message:el('message').value}));el('saved').textContent='Rascunho guardado somente neste navegador, não agendado.';}catch{el('saved').textContent='Não foi possível salvar.';}preview();});
 el('clear').addEventListener('click',()=>{localStorage.removeItem(key);el('name').value='';el('message').value='';el('saved').textContent='Rascunho local limpo.';preview();});
 reload();
})();