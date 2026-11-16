'use strict';
// R21 — Operations on CRM drafts only. The caller owns CAS, tenancy, and DEV authorization.
// Legacy R17 columns/cards are preserved verbatim except for the requested operation.
const crypto=require('node:crypto');
const {normalizePhone}=require('./workspace-domain');
const MAX_COLUMNS=40, MAX_CARDS=600;
function failure(code){const e=new Error(code);e.code=code;throw e;}
function index(value,length){if(!Number.isSafeInteger(value)||value<0||value>=length)failure('invalid_column_index');return value;}
function itemIndex(value,length){if(!Number.isSafeInteger(value)||value<0||value>=length)failure('invalid_card_index');return value;}
function title(raw){if(typeof raw!=='string'||raw.trim().length<1||raw.trim().length>80)failure('invalid_column_title');return raw.trim();}
function count(columns){return columns.reduce((n,c)=>n+c.items.length,0);}
function changeCrmBoard(pipelines,contacts,input){
 if(!Array.isArray(pipelines)||!Array.isArray(contacts)||!input||typeof input!=='object'||Array.isArray(input))failure('invalid_crm_operation');
 if(typeof input.pipelineId!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(input.pipelineId))failure('invalid_pipeline_id');
 const pipelineIndex=pipelines.findIndex(p=>p.id===input.pipelineId);
 if(pipelineIndex<0)failure('crm_pipeline_not_found');
 const pipe=structuredClone(pipelines[pipelineIndex]);
 if(pipe.columns===undefined)pipe.columns=[];
 if(!Array.isArray(pipe.columns)||pipe.columns.length>MAX_COLUMNS)failure('unsupported_crm_columns');
 for(const col of pipe.columns){
  if(!col||typeof col!=='object'||Array.isArray(col)||!Array.isArray(col.items))failure('unsupported_crm_column');
  if(col.items.some(i=>!i||typeof i!=='object'||Array.isArray(i)))failure('unsupported_crm_cards');
 }
 if(count(pipe.columns)>MAX_CARDS)failure('crm_card_limit');
 const op=input.action;
 if(op==='add-column'){
  if(pipe.columns.length>=MAX_COLUMNS)failure('crm_column_limit');
  const name=title(input.title);
  pipe.columns.push({id:'cloud_col_'+crypto.randomUUID(),title:name,items:[]});
 }else if(op==='rename-column'){
  const col=pipe.columns[index(input.columnIndex,pipe.columns.length)];
  col.title=title(input.title);
 }else if(op==='remove-column'){
  const i=index(input.columnIndex,pipe.columns.length);
  if(pipe.columns[i].items.length)failure('crm_column_not_empty');
  pipe.columns.splice(i,1);
 }else if(op==='add-contact'){
  const col=pipe.columns[index(input.columnIndex,pipe.columns.length)];
  const contact=contacts.find(c=>c.id===input.contactId);
  if(!contact)failure('crm_contact_not_found');
  if(count(pipe.columns)>=MAX_CARDS)failure('crm_card_limit');
  const phone=normalizePhone(contact.phone);
  if(!phone)failure('crm_contact_invalid');
  for(const stage of pipe.columns)for(const card of stage.items){
   const other=normalizePhone(card.contact?.phoneNumber||card.contact?.phone||card.phone);
   if(card.contactId===contact.id||(other&&other===phone))failure('crm_contact_already_assigned');
  }
  col.items.push({id:'cloud_card_'+crypto.randomUUID(),contactId:contact.id,contact:{name:String(contact.name||'').slice(0,120),phoneNumber:phone},source:'cloud'});
 }else if(op==='move-card'){
  const a=index(input.fromIndex,pipe.columns.length),b=index(input.toIndex,pipe.columns.length);
  if(a===b)failure('crm_same_column');
  const from=pipe.columns[a].items;
  const at=itemIndex(input.itemIndex,from.length);
  const item=from.splice(at,1)[0];
  pipe.columns[b].items.push(item);
 }else if(op==='unlink-card'){
  const col=pipe.columns[index(input.columnIndex,pipe.columns.length)];
  col.items.splice(itemIndex(input.itemIndex,col.items.length),1);
 }else failure('unknown_crm_action');
 const output=[...pipelines];output[pipelineIndex]=pipe;
 return {records:output,action:op,pipelineId:pipe.id,columns:pipe.columns.length,cards:count(pipe.columns)};
}
function checkCrmLinks(pipelines,contacts){
 if(!Array.isArray(pipelines)||!Array.isArray(contacts))failure('invalid_crm_links');
 const ids=new Set(contacts.map(c=>c.id));
 for(const pipeline of pipelines){
  if(!pipeline||!Array.isArray(pipeline.columns))continue;
  for(const column of pipeline.columns){
   if(!column||!Array.isArray(column.items))continue;
   for(const card of column.items){
    if(card?.source==='cloud'&&(!card.contactId||!ids.has(card.contactId)))
     failure('crm_contact_in_use');
   }
  }
 }
}
module.exports={changeCrmBoard,checkCrmLinks,MAX_COLUMNS,MAX_CARDS};
