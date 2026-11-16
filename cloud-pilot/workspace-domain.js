'use strict';
// ZVM Cloud data schema: user-owned drafts only; no WhatsApp execution.
// Native storage keys verified against R17 app/shared/core/storage-schema.js.
const crypto=require('node:crypto');
const MODULES=Object.freeze({
 contacts:{title:'Contatos',max:600},
 crm:{title:'CRM',max:100},
 labels:{title:'Etiquetas',max:200},
 library:{title:'Biblioteca',max:400},
 quickReplies:{title:'Respostas rápidas',max:200},
 flows:{title:'Fluxos',max:200},
 funnels:{title:'Funis',max:200},
 campaigns:{title:'Disparos',max:200},
 agenda:{title:'Agenda',max:200},
 settings:{title:'Configurações',max:1}
});
const LEGACY=Object.freeze([
 ['EXTUI:CrmStore','crm','crmList'],
 ['EXTUI:labelStore','labels','labelList'],
 ['EXTUI:textMessageStore','library','textMessageList','message'],
 ['EXTUI:audioStore','library','audioList','audio'],
 ['EXTUI:mediaStore','library','mediaList','media'],
 ['EXTUI:stickerStore','library','stickerList','sticker'],
 ['EXTUI:documentStore','library','documentList','document'],
 ['EXTUI:pixStore','library','pixList','pix'],
 ['EXTUI:interactiveListStore','library','interactiveListList','interactive-list'],
 ['EXTUI:contactCardStore','library','contactList','contact'],
 ['EXTUI:signaturesStore','library','list','signature'],
 ['EXTUI:extappQuickResponseStore','quickReplies','items'],
 ['EXTUI:extappFlowStore','flows','flowList'],
 ['EXTUI:extappFunnelStore','funnels','funnelList'],
 ['EXTUI:extappScheduleStore','agenda','scheduleList'],
 ['EXTUI:disparosJourneys','campaigns','journeys']
]);
const UNSAFE_KEYS=new Set(['__proto__','prototype','constructor']);
const SECRET_KEY=/(?:password|passwd|secret|token|cookie|authkey|apikey|privatekey|license|credential|session|webhook)/i;
const MEDIA_REF=/^(data:(?:audio|video|image|application)\/|blob:|extapp-media:|extapp-item:)/i;
function error(code){const e=new Error(code);e.code=code;return e;}
function isObject(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function cloneSafe(value,ctx={nodes:0},depth=0){
 if(depth>12||++ctx.nodes>10000)throw error('complexity_limit');
 if(value===null||typeof value==='boolean')return value;
 if(typeof value==='number'){if(!Number.isFinite(value))throw error('non_finite_value');return value;}
 if(typeof value==='string'){
  if(value.length>50000)throw error('string_too_long');
  if(MEDIA_REF.test(value))throw error('binary_reference_not_importable');
  return value;
 }
 if(Array.isArray(value)){
  if(value.length>1500)throw error('array_too_large');
  return value.map(item=>cloneSafe(item,ctx,depth+1));
 }
 if(!isObject(value))throw error('unsupported_value');
 const out={};
 const names=Object.keys(value);
 if(names.length>120)throw error('object_too_wide');
 for(const key of names){
  if(UNSAFE_KEYS.has(key)||SECRET_KEY.test(key))throw error('unsafe_or_secret_field');
  out[key]=cloneSafe(value[key],ctx,depth+1);
 }
 return out;
}
function normalizePhone(value){const normalized=String(value||'').replace(/\D/g,'');return /^\d{8,15}$/.test(normalized)?normalized:'';}
function checkAudience(module,records,contacts){
 if(!['campaigns','flows','funnels'].includes(module))return;
 const ids=new Set((contacts||[]).map(x=>x.id));
 for(const record of records){
  const refs=record.recipientIds;
  if(refs===undefined||refs===null)continue;
  if(!Array.isArray(refs)||refs.length>600||new Set(refs).size!==refs.length)throw error('invalid_audience');
  if(refs.some(id=>typeof id!=='string'||!ids.has(id)))throw error('unknown_audience_contact');
 }
}
function moduleCheck(name,records){
 const spec=MODULES[name];if(!spec)throw error('unknown_module');
 if(!Array.isArray(records)||records.length>spec.max)throw error('record_limit');
 const ids=new Set(),phones=new Set();
 const out=records.map((raw,index)=>{
  if(!isObject(raw))throw error('invalid_record');
  const r=cloneSafe(raw);
  const fallback=crypto.createHash('sha256').update(name+'\0'+index+'\0'+JSON.stringify(r)).digest('hex').slice(0,20);
  r.id=String(r.id||r._id||fallback).trim().slice(0,100);
  if(!/^[A-Za-z0-9_.:-]{1,100}$/.test(r.id)||ids.has(r.id))throw error('duplicate_or_invalid_id');
  delete r._id;ids.add(r.id);
  r.name=String(r.name||r.title||r.label||('Item '+(index+1))).trim().slice(0,120);
  if(name==='contacts'){
   r.phone=normalizePhone(r.phone||r.phoneNumber||r.contact?.phoneNumber);
   if(!r.phone)throw error('invalid_phone');
   if(phones.has(r.phone))throw error('duplicate_phone');
   phones.add(r.phone);
  }
  return r;
 });
 if(Buffer.byteLength(JSON.stringify(out),'utf8')>850000)throw error('module_too_large');
 return out;
}
function unwrap(raw){
 let value=raw;
 for(let i=0;i<3&&typeof value==='string';i++){
  try{value=JSON.parse(value);}catch{throw error('legacy_state_invalid_json');}
 }
 if(!isObject(value))throw error('legacy_state_invalid');
 return isObject(value.state)?value.state:value;
}
function extractList(data,key,listKey){
 if(!Object.prototype.hasOwnProperty.call(data,key))return null;
 // R17 SignaturesStore supports an old plain array as well as {list} and
 // Zustand {state:{list}}. Honor both without rewriting existing entries.
 let raw=data[key];
 for(let i=0;i<3&&typeof raw==='string';i++){
  try{raw=JSON.parse(raw);}catch{throw error('legacy_state_invalid_json');}
 }
 if(Array.isArray(raw))return raw;
 const state=unwrap(raw);
 if(Array.isArray(state[listKey]))return state[listKey];
 if(Array.isArray(state.list))return state.list;
 if(Array.isArray(state.items))return state.items;
 if(Array.isArray(state))return state;
 return [];
}
function planLegacy(source){
 if(!isObject(source))throw error('backup_not_object');
 const data=isObject(source.data)?source.data:source;
 if(!isObject(data))throw error('backup_data_missing');
 const modules={},counts={},warnings=[],skipped=[];
 const allowed=new Set(LEGACY.map(x=>x[0]));
 for(const key of Object.keys(data)){
  if(!allowed.has(key)&&key.startsWith('EXTUI:')&&!/(?:Secret|Auth|Token|License|deviceId|Key)/i.test(key))skipped.push(key);
 }
 for(const [key,module,field,libraryKind] of LEGACY){
  if(!Object.prototype.hasOwnProperty.call(data,key))continue;
  let list;
  try{list=extractList(data,key,field);}catch(e){throw error('legacy_'+module+'_invalid');}
  if(!Array.isArray(list))throw error('legacy_'+module+'_invalid');
  const records=[];
  for(let i=0;i<list.length;i++){
   const row=list[i];
   if(!isObject(row))throw error('legacy_row_invalid');
   const name=String(row.name||row.title||row.label||'').slice(0,120);
   if(module==='library'){
    // The extension stores each library kind in a separate independent store.
    // Never overwrite a previously processed kind with the next category.
    const kind=libraryKind==='media'?
      (/video/i.test(String(row.kind||row.type||row.mime||row.mimeType||''))?'video':
       /image/i.test(String(row.kind||row.type||row.mime||row.mimeType||''))?'image':'media'):
      libraryKind||'message';
    const id=String(row.id||'').trim();
    const source=Object.prototype.hasOwnProperty.call(data,id)?data[id]:null;
    let content=null;
    if(source!==null){
     try{content=unwrap(source);}catch{
      warnings.push('Biblioteca: conteúdo auxiliar de "'+name+'" está ilegível; original não será marcado como disponível.');
     }
    }
    const safeText=value=>typeof value==='string'&&!MEDIA_REF.test(value)?value.slice(0,16000):'';
    const dataText=content&&typeof content.data==='string'?safeText(content.data):'';
    const propText=content?.properties?.mensagem||content?.properties?.message;
    const ownText=row.text||row.message||row.mensagem||row.properties?.mensagem||'';
    const needsMedia=['audio','media','image','video','sticker','document'].includes(kind);
    // Independent R17 stores may reuse an item ID. A text store's keyed payload
    // must never be copied into an audio/image/video merely because IDs collide.
    const contentText=needsMedia?
      safeText(row.caption||row.text||row.description):
      dataText||safeText(propText)||safeText(ownText);
    const structured=['pix','interactive-list','contact'].includes(kind);
    const payload={};
    if(structured){
     for(const part of ['properties','items','rows','buttons','description']){
      const value=content?.[part]??row[part];
      if(value===undefined)continue;
      try{payload[part]=cloneSafe(value);}catch(e){
       if(e.code==='binary_reference_not_importable'||e.code==='unsafe_or_secret_field'){
        warnings.push('Biblioteca: campo de "'+name+'" não foi importado por segurança; revise os dados antes de usar.');
       }else throw e;
      }
     }
    }
    const ready=!needsMedia&&!structured&&!!contentText;
    if(!ready){
     warnings.push('Biblioteca: "'+name+'" ('+kind+') requer '+(needsMedia?'restauração manual da mídia original':'revisão do conteúdo original')+'; não será marcado como pronto.');
    }
    records.push({
     id:id||undefined,name,kind,text:contentText,originStore:key,
     favorite:row.favorite===true||row.isFavorite===true,
     showInQuickMenu:row.showInQuickMenu!==false,
     ...(Object.keys(payload).length?{payload}:{}),
     contentStatus:ready?'ready':structured&&(contentText||Object.keys(payload).length)?'needs_review':'missing_source'
    });
   }else if(module==='crm'){
    // Preserve native columns and memberships as a draft. No WhatsApp actions are run.
    records.push({id:String(row.id||'')||undefined,name,columns:cloneSafe(row.columns||[]),source:'R17'});
   }else{
    const sanitized={};
    for(const k of Object.keys(row)){
     if(UNSAFE_KEYS.has(k)||SECRET_KEY.test(k))continue;
     try{sanitized[k]=cloneSafe(row[k]);}
     catch(e){
      if(e.code==='binary_reference_not_importable'){
       warnings.push(module+': referência local de mídia em "'+name+'" precisa de migração separada.');
      }else throw e;
     }
    }
    sanitized.name=name||sanitized.name;
    // Native audiences are scoped to the local WhatsApp account. Never convert
    // their IDs to Cloud recipients without explicit account review.
    if(['flows','funnels','campaigns'].includes(module)&&Object.prototype.hasOwnProperty.call(sanitized,'recipientIds')){
     delete sanitized.recipientIds;
     sanitized.audienceReviewRequired=true;
     warnings.push(module+': destinatários de "'+name+'" precisam ser selecionados novamente para a conta Cloud.');
    }
    records.push(sanitized);
   }
  }
  if(module==='library'){
   const combined=[...(modules.library||[])];
   const ids=new Set(combined.map(x=>x.id));
   for(const record of records){
    const oldId=record.id;
    if(oldId&&ids.has(oldId)){
     // Native IDs are retained unless two independent stores reused one ID.
     record.sourceId=oldId;
     record.id='r17_'+crypto.createHash('sha256').update(key+'\\0'+oldId).digest('hex').slice(0,20);
     warnings.push('Biblioteca: ID repetido em categorias diferentes para "'+record.name+'"; origem preservada no item importado.');
    }
    if(record.id)ids.add(record.id);
    combined.push(record);
   }
   modules.library=moduleCheck('library',combined);
   counts.library=modules.library.length;
  }else{
   modules[module]=moduleCheck(module,records);
   counts[module]=records.length;
  }
 }
 // Contact records can be derived from CRM memberships, without inventing remote IDs.
 if(Array.isArray(modules.crm)){
  const phones=new Set(),contacts=[];
  for(const crm of modules.crm)for(const col of (crm.columns||[]))for(const item of (col.items||[])){
   const contact=item?.contact||{};
   const phone=normalizePhone(contact.phoneNumber||contact.phone);
   if(!phone||phones.has(phone))continue;
   phones.add(phone);
   contacts.push({id:'phone_'+phone,name:String(contact.name||contact.pushname||phone).slice(0,120),phone,source:'crm_backup'});
  }
  if(contacts.length){
   modules.contacts=moduleCheck('contacts',contacts);counts.contacts=contacts.length;
  }
 }
 if(!Object.keys(modules).length)throw error('no_compatible_modules');
 const digest=crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex');
 return {modules,counts,digest,warnings:warnings.slice(0,80),skipped:skipped.slice(0,80),sourceFormat:String(source.format||'storage-dump').slice(0,80)};
}
function mergeModules(current,planned,mode='merge'){
 if(mode!=='merge'&&mode!=='replace')throw error('invalid_mode');
 const next={...current};
 for(const [module,imported] of Object.entries(planned)){
  const old=Array.isArray(current[module])?current[module]:[];
  const records=mode==='replace'?imported:[...old.filter(r=>!imported.some(x=>x.id===r.id)),...imported];
  next[module]=moduleCheck(module,records);
 }
 return next;
}
function checkWhole(modules){
 if(!isObject(modules))throw error('invalid_workspace');
 for(const [name,records] of Object.entries(modules))moduleCheck(name,records);
 if(Buffer.byteLength(JSON.stringify(modules),'utf8')>1500000)throw error('workspace_too_large');
 return modules;
}
module.exports={MODULES,LEGACY,normalizePhone,moduleCheck,checkAudience,planLegacy,mergeModules,checkWhole,cloneSafe};
