'use strict';
/* ZVM Cloud R23 — Biblioteca Studio. Each item is a private draft.
 * This frontend does NOT send anything to WhatsApp or expose extension-local files. */
(()=>{
 const base=new URL(document.currentScript.src).pathname.replace(/\/cloud-library\.js$/,'');
 const TYPES=Object.freeze([
  ['message','Mensagens','message-square'],['audio','Áudios','music'],
  ['image','Imagens','image'],['video','Vídeos','video'],['media','Mídia','file'],
  ['sticker','Figurinhas','smile'],['document','Documentos','file-text'],
  ['interactive-list','Listas','list'],['contact','Contatos','user-round'],
  ['signature','Assinaturas','pen-line'],['pix','PIX','wallet']
 ]);
 const MEDIA=Object.freeze({
  audio:['audio/mpeg','audio/ogg'],
  image:['image/png','image/jpeg','image/webp'],
  video:['video/mp4'],media:['image/png','image/jpeg','image/webp','audio/mpeg','audio/ogg','video/mp4','application/pdf'],
  sticker:['image/png','image/webp'],document:['application/pdf']
 });
 const TYPE_NAMES=Object.fromEntries(TYPES.map(([id,name])=>[id,name]));
 const mount=document.getElementById('cloudLibraryStudio');if(!mount)return;
 let enabled=false,records=[],revision=0,assets=[],filter='all',search='',favorites=false,editing=null,busy=false,notice='',noticeBad=false;
 const make=(tag,text='',cls='')=>{
  const n=document.createElement(tag);if(cls)n.className=cls;
  if(text!==null)n.textContent=String(text);
  return n;
 };
 const button=(text,action,cls='secondary')=>{
  const n=make('button',text,cls);n.type='button';n.disabled=busy;
  n.addEventListener('click',action);return n;
 };
 const api=async(route,options={})=>{
  const response=await fetch(base+route,{credentials:'same-origin',cache:'no-store',...options});
  let json={};try{json=await response.json();}catch{}
  if(!response.ok)throw Error(json.error||'network_error');
  return json;
 };
 const mutation=(body)=>({method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const kindOf=item=>TYPE_NAMES[item.kind]?item.kind:'message';
 const nameOf=record=>String(record.name||'Sem título');
 const missing=item=>item.contentStatus==='missing_source'||(MEDIA[kindOf(item)]&&!item.mediaId);
 const bytes=size=>Math.ceil(Number(size||0)/1024)+' KB';
 const linked=item=>assets.find(x=>x.id===item.mediaId)||null;
 function notify(text,isError=false){notice=text;noticeBad=isError;const target=mount.querySelector('.cloud-library-feedback');if(target){target.textContent=text;target.classList.toggle('error',isError);}}
 function addField(parent,label,element){
  const wrapper=make('div','','cloud-lib-field');
  const lab=make('label',label);const id='cloud-lib-'+element.name;lab.htmlFor=id;element.id=id;
  wrapper.append(lab,element);parent.append(wrapper);return wrapper;
 }
 function preview(target,draft){
  target.replaceChildren();
  const kind=kindOf(draft),asset=linked(draft);
  const status=make('div',TYPE_NAMES[kind]||'Mensagem','cloud-lib-preview-kind');
  const bubble=make('div','','cloud-lib-bubble');
  if(draft.text?.trim())bubble.append(make('p',draft.text.trim(),'cloud-lib-bubble-text'));
  if(asset){
   const media=make('div',asset.name+' · '+bytes(asset.size),'cloud-lib-file-preview');
   bubble.append(media);
   if(['image','sticker'].includes(kind)&&String(asset.mime||'').startsWith('image/')){
    const img=make('img',null,'cloud-lib-image-preview');
    img.src=base+'/api/media/'+asset.id;img.loading='lazy';img.alt='Imagem privada: '+asset.name;
    bubble.append(img);
   }
  }
  if(!draft.text?.trim()&&!asset)bubble.append(make('p',MEDIA[kind]?'Arquivo ainda não associado':'Digite uma mensagem para visualizar a prévia','cloud-lib-placeholder'));
  if(['contact','interactive-list'].includes(kind)){
   bubble.append(make('small','Estrutura importada: requer revisão específica antes de ficar pronta.','cloud-lib-warning'));
  }
  target.append(status,bubble);
 }
 function editor(){
  const draft=editing;
  const form=make('form',null,'cloud-library-editor');
  const head=make('div',null,'cloud-lib-editor-head');
  head.append(make('strong',draft.id?'Editar item da Biblioteca':'Novo item da Biblioteca'));
  head.append(button('Fechar',()=>{editing=null;render();}));
  form.append(head);
  const columns=make('div',null,'cloud-lib-editor-grid'),fields=make('div',null,'cloud-lib-editor-fields');
  const type=make('select');type.name='kind';
  for(const [id,name] of TYPES){const option=make('option',name);option.value=id;option.selected=id===kindOf(draft);type.append(option);}
  addField(fields,'Categoria',type);
  const title=make('input');title.name='name';title.type='text';title.required=true;title.maxLength=120;title.value=draft.name||'';title.placeholder='Nome que aparecerá na Biblioteca';
  addField(fields,'Nome do item',title);
  const composer=make('textarea');composer.name='text';composer.rows=5;composer.maxLength=2000;composer.value=String(draft.text||'');composer.placeholder='Digite a mensagem ou legenda do item...';
  addField(fields,'Mensagem / legenda',composer);
  const previewWrap=make('div',null,'cloud-lib-live-preview');
  previewWrap.append(make('strong','Prévia abaixo do campo de mensagem'));
  const previewBody=make('div');previewWrap.append(previewBody);fields.append(previewWrap);
  const mediaWrap=make('div',null,'cloud-lib-media-wrap');
  const previewUpdate=()=>{
   const kind=type.value,asset=linked({mediaId:mediaSelect.value});
   if(!MEDIA[kind]||!asset||!MEDIA[kind].includes(asset.mime))mediaSelect.value='';
   draft.kind=kind;draft.name=title.value;draft.text=composer.value;
   draft.mediaId=mediaSelect.value||undefined;
   mediaWrap.hidden=!MEDIA[kind];preview(previewBody,draft);
  };
  const mediaSelect=make('select');mediaSelect.name='mediaId';
  mediaWrap.append(addField(make('div'),'Anexo vinculado no Cofre',mediaSelect));
  const refreshOptions=()=>{
   mediaSelect.replaceChildren();
   const none=make('option','Sem arquivo vinculado (não fica pronto)');none.value='';mediaSelect.append(none);
   const kind=type.value;
   for(const asset of assets.filter(a=>MEDIA[kind]?.includes(a.mime))){
    const option=make('option',asset.name+' · '+bytes(asset.size));
    option.value=asset.id;option.selected=asset.id===draft.mediaId;mediaSelect.append(option);
   }
   mediaSelect.value=assets.some(x=>x.id===draft.mediaId&&MEDIA[kind]?.includes(x.mime))?draft.mediaId:'';
  };
  refreshOptions();fields.append(mediaWrap);
  const opts=make('div',null,'cloud-lib-editor-options');
  const favLabel=make('label','','cloud-lib-check');
  const fav=make('input');fav.type='checkbox';fav.checked=draft.favorite===true;favLabel.append(fav,make('span','Favorito'));
  const menuLabel=make('label','','cloud-lib-check');
  const quick=make('input');quick.type='checkbox';quick.checked=draft.showInQuickMenu!==false;menuLabel.append(quick,make('span','Exibir no menu rápido futuramente'));
  opts.append(favLabel,menuLabel);fields.append(opts);
  type.addEventListener('change',()=>{refreshOptions();previewUpdate();});
  mediaSelect.addEventListener('change',previewUpdate);
  title.addEventListener('input',previewUpdate);
  composer.addEventListener('input',previewUpdate);
  previewUpdate();
  columns.append(fields);form.append(columns);
  const actions=make('div',null,'cloud-lib-editor-actions');
  const save=make('button','Salvar na Biblioteca','primary');save.type='submit';save.disabled=busy;
  actions.append(save,button('Cancelar',()=>{editing=null;render();}));
  form.append(actions);
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(busy)return;
   const name=title.value.trim(),kind=type.value,text=composer.value.trim();
   if(!name){notify('Informe um nome para o item.',true);title.focus();return;}
   if(!Object.hasOwn(TYPE_NAMES,kind)){notify('Categoria inválida.',true);return;}
   const original=editing?.original||null;
   const updated={...(original||{}),id:original?.id||'cloudlib_'+crypto.randomUUID().replaceAll('-',''),
    name,kind,text,favorite:fav.checked,showInQuickMenu:quick.checked};
   if(MEDIA[kind]){
    if(mediaSelect.value)updated.mediaId=mediaSelect.value;else delete updated.mediaId;
    updated.contentStatus=updated.mediaId?'ready':'missing_source';
   }else{
    delete updated.mediaId;
    if(kind==='contact'||kind==='interactive-list')updated.contentStatus='needs_review';
    else updated.contentStatus=text?'ready':'missing_source';
   }
   if(original&&kind!==kindOf(original)){delete updated.payload;delete updated.originStore;delete updated.sourceId;}
   await commit(list=>{
    const ix=list.findIndex(x=>x.id===updated.id);
    if(original&&ix<0)throw Error('item_removed_in_other_session');
    if(ix<0)list.push(updated);else list[ix]=updated;
   },'Item salvo com segurança. Nenhuma mensagem foi enviada.');
  });
  return form;
 }
 function card(record){
  const kind=kindOf(record),media=linked(record);
  const article=make('article',null,'cloud-lib-card');
  const top=make('div',null,'cloud-lib-card-top');
  top.append(make('span',TYPE_NAMES[kind],'cloud-lib-kind'));
  const star=button(record.favorite===true?'★':'☆',()=>toggleFavorite(record),'cloud-lib-star'+(record.favorite===true?' is-fav':''));
  star.setAttribute('aria-label',record.favorite===true?'Remover favorito':'Adicionar favorito');
  top.append(star);article.append(top);
  article.append(make('h3',nameOf(record)));
  if(record.text?.trim())article.append(make('p',record.text.slice(0,190),'cloud-lib-item-copy'));
  if(media){
   article.append(make('div',media.name+' · '+bytes(media.size),'cloud-lib-file-preview'));
   if(['image','sticker'].includes(kind)&&media.mime.startsWith('image/')){
    const img=make('img',null,'cloud-lib-card-image');
    img.src=base+'/api/media/'+media.id;img.loading='lazy';img.alt='Imagem vinculada: '+media.name;article.append(img);
   }
  }
  const needsReview=record.contentStatus==='needs_review';
  const badge=make('small',missing(record)?'Origem ausente • restaurar mídia/conteúdo':needsReview?'Precisa de revisão':'Conteúdo vinculado','cloud-lib-item-status'+(missing(record)||needsReview?' needs-review':''));
  article.append(badge);
  const actions=make('div',null,'cloud-lib-card-actions');
  actions.append(button('Editar',()=>openEditor(record)));
  actions.append(button('Duplicar',()=>duplicate(record)));
  actions.append(button('Excluir',()=>remove(record),'cloud-lib-danger'));
  article.append(actions);
  return article;
 }
 function render(){
  if(!enabled)return;
  mount.replaceChildren();
  const bar=make('div',null,'cloud-library-toolbar');
  const left=make('div',null,'cloud-library-toolbar-title');
  left.append(make('strong','Biblioteca ZVM'),make('small',records.length+' itens salvos na conta · nenhum envio habilitado'));
  bar.append(left,button('+ Novo item',()=>openEditor(null),'primary'));mount.append(bar);
  const filters=make('div',null,'cloud-lib-types');filters.setAttribute('aria-label','Categorias da Biblioteca');
  for(const [id,name] of [['all','Todos'],...TYPES.map(([k,v])=>[k,v])]){
   const total=id==='all'?records.length:records.filter(r=>kindOf(r)===id).length;
   const chip=button(name+' · '+total,()=>{filter=id;render();},'cloud-lib-filter'+(filter===id?' selected':''));
   chip.setAttribute('aria-pressed',String(filter===id));filters.append(chip);
  }mount.append(filters);
  const controls=make('div',null,'cloud-lib-controls');
  const searchInput=make('input');searchInput.type='search';searchInput.value=search;searchInput.placeholder='Pesquisar nome, mensagem ou legenda...';searchInput.setAttribute('aria-label','Buscar na Biblioteca');
  searchInput.addEventListener('input',()=>{search=searchInput.value;updateGrid();});
  const favoritesButton=button(favorites?'★ Somente favoritos':'☆ Mostrar favoritos',()=>{favorites=!favorites;render();},'cloud-lib-fav-filter'+(favorites?' selected':''));
  favoritesButton.setAttribute('aria-pressed',String(favorites));
  controls.append(searchInput,favoritesButton);mount.append(controls);
  const feedback=make('p',notice,'cloud-library-feedback'+(noticeBad?' error':''));
  feedback.setAttribute('aria-live','polite');mount.append(feedback);
  if(editing)mount.append(editor());
  const listing=make('div',null,'cloud-lib-grid');listing.id='cloudLibraryGrid';mount.append(listing);
  function updateGrid(){
   listing.replaceChildren();
   const query=search.trim().toLocaleLowerCase('pt-BR');
   const found=records.filter(x=>(filter==='all'||kindOf(x)===filter)&&(!favorites||x.favorite===true)&&
    (!query||(nameOf(x)+' '+String(x.text||'')).toLocaleLowerCase('pt-BR').includes(query)));
   for(const item of found)listing.append(card(item));
   if(!found.length){
    const empty=make('div',null,'cloud-lib-empty');
    empty.append(make('strong',records.length?'Nenhum resultado para este filtro.':'Sua Biblioteca está vazia.'),
      make('p',records.length?'Ajuste a busca ou escolha outra categoria.':'Crie uma mensagem, associe anexos do Cofre ou importe dados da extensão R17.'));
    listing.append(empty);
   }
  }updateGrid();
 }
 async function fetchData(){
  const [data,vault]=await Promise.all([api('/api/workspace/library'),api('/api/media')]);
  records=Array.isArray(data.records)?data.records:[];revision=data.revision;assets=Array.isArray(vault.items)?vault.items:[];
  render();
 }
 function openEditor(record){
  editing={...record,original:record||null};if(!record)editing={kind:filter!=='all'?filter:'message',name:'',text:'',favorite:false,showInQuickMenu:true,original:null};
  render();mount.querySelector('.cloud-library-editor')?.scrollIntoView({block:'nearest',behavior:'smooth'});
 }
 async function commit(mutate,success){
  if(!enabled||busy)return;busy=true;
  try{
   // Read fresh CAS state before mutation. A concurrent write is never overwritten.
   const current=await api('/api/workspace/library'),list=[...(current.records||[])];
   mutate(list);
   await api('/api/workspace/library',mutation({revision:current.revision,records:list}));
   editing=null;await fetchData();notify(success);
   window.dispatchEvent(new CustomEvent('zvm-cloud-library-changed'));
  }catch(error){
   if(error.message==='workspace_conflict'){
    await fetchData().catch(()=>{});
    notify('A Biblioteca mudou em outra sessão. Revise os dados e tente novamente.',true);
   }else{
    notify(error.message==='unknown_library_media'?'O arquivo vinculado não existe mais no Cofre. Atualize antes de salvar.':
     error.message==='library_media_kind_mismatch'?'Este arquivo não é compatível com a categoria escolhida.':
     'Alteração não confirmada: '+error.message,true);
   }
  }finally{busy=false;}
 }
 async function toggleFavorite(item){
  await commit(list=>{const ix=list.findIndex(x=>x.id===item.id);if(ix<0)throw Error('item_removed_in_other_session');list[ix]={...list[ix],favorite:list[ix].favorite!==true};},'Favorito atualizado.');
 }
 async function duplicate(item){
  await commit(list=>{
   if(!list.some(x=>x.id===item.id))throw Error('item_removed_in_other_session');
   const copy={...item,id:'cloudlib_'+crypto.randomUUID().replaceAll('-',''),
    name:('Cópia de '+nameOf(item)).slice(0,120),favorite:false};
   delete copy.originStore;delete copy.sourceId;list.push(copy);
  },'Cópia criada. A mídia original permanece vinculada ao Cofre.');
 }
 async function remove(item){
  if(!window.confirm('Excluir "'+nameOf(item)+'" da Biblioteca Cloud? O arquivo original permanecerá no Cofre.'))return;
  await commit(list=>{
   const ix=list.findIndex(x=>x.id===item.id);if(ix<0)throw Error('item_removed_in_other_session');
   list.splice(ix,1);
  },'Item removido da Cloud. Nenhum arquivo foi apagado do Cofre.');
 }
 window.addEventListener('zvm-cloud-ready',()=>{
  enabled=true;fetchData().catch(()=>notify('Não foi possível carregar a Biblioteca. Verifique a conexão.',true));
 });
 window.addEventListener('zvm-cloud-media-data',event=>{
  if(!enabled)return;
  assets=Array.isArray(event.detail?.items)?event.detail.items:[];
  if(!editing)render();
 });
 window.addEventListener('zvm-cloud-data',event=>{
  if(!enabled||!Array.isArray(event.detail?.library))return;
  records=event.detail.library;revision=event.detail.revision;
  if(!editing)render();
 });
 window.addEventListener('zvm-cloud-locked',()=>{
  enabled=false;records=[];revision=0;assets=[];editing=null;notice='';mount.replaceChildren();
 });
})();
