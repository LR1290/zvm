'use strict';

// ZVM V4 free limits: durable, subject-scoped, atomic usage. No client phone,
// e-mail, self-declared plan or authorization claims are trusted by this module.
const crypto = require('node:crypto');
const FREE_LIMITS = Object.freeze({ message:20, audio:10, media:10, document:10, scheduleItem:5 });
const COLLECTION = 'extension_free_quota_v4';
class QuotaError extends Error { constructor(code,message){ super(message);this.name='QuotaError';this.code=code; } }
function fail(code,message){throw new QuotaError(code,message)}
function requireHealthyRow(row){if(!row)return; if(!row.sent||typeof row.sent!=='object'||!Array.isArray(row.applied))fail('QUOTA_STORAGE_UNAVAILABLE','Os registros de cota estão incompletos.');for(const name of Object.keys(FREE_LIMITS))if(!Number.isSafeInteger(row.sent[name])||row.sent[name]<0)fail('QUOTA_STORAGE_UNAVAILABLE','O contador precisa de reparo seguro.');}
function limitsView(row){requireHealthyRow(row);const s=row&&row.sent||{};const limits={};for(const [name,max]of Object.entries(FREE_LIMITS))limits[name]={sent:Number.isSafeInteger(s[name])&&s[name]>=0?s[name]:0,max};return limits;}
function createFreeQuotaService({db,now=()=>new Date()}={}){
  if(!db||typeof db.collection!=='function')throw Error('QUOTA_DB_REQUIRED');
  const col=db.collection(COLLECTION);let indexPromise=null;
  async function prepare(){ if(!indexPromise){indexPromise=col.createIndex({expiresAt:1},{expireAfterSeconds:0,name:'free_quota_ttl'}).catch(e=>{indexPromise=null;throw e;});}await indexPromise; }
  async function execute({subjectId,action='check',itemType,operationId,scheduledItems}={}){
    if(!/^[a-f0-9]{64}$/.test(String(subjectId||'')))fail('QUOTA_IDENTITY_REQUIRED','Conta autenticada necessária para conferir as cotas.');
    if(action!=='check'&&action!=='commit')fail('QUOTA_ACTION_INVALID','Operação de cota inválida.');
    if(action==='commit'&&!Object.hasOwn(FREE_LIMITS,itemType))fail('QUOTA_TYPE_INVALID','Tipo de uso inválido.');
    if(action==='commit'&&!/^[a-zA-Z0-9_.:-]{12,128}$/.test(String(operationId||'')))fail('QUOTA_OPERATION_REQUIRED','Identificador de operação ausente ou inválido.');
    if(action==='commit'&&itemType==='scheduleItem'&&(!Number.isSafeInteger(scheduledItems)||scheduledItems<0))fail('QUOTA_COUNT_INVALID','Quantidade de agendamentos inválida.');
    const date=now(),ms=date instanceof Date?date.getTime():NaN;
    if(!Number.isFinite(ms))fail('QUOTA_TIME_INVALID','Horário de consulta inválido.');
    const day=new Date(ms).toISOString().slice(0,10),id='v4:'+day+':'+subjectId;
    const expiration=new Date(Date.parse(day+'T00:00:00.000Z')+72*60*60*1000);
    const receipt=action==='commit'?crypto.createHash('sha256').update(itemType+'\x00'+operationId).digest('hex'):null;
    try{
      await prepare();
      if(action==='check'){const doc=await col.findOne({_id:id});return{free:true,unlimited:false,date:day,limits:limitsView(doc)};}
      const cap=FREE_LIMITS[itemType];
      if(itemType==='scheduleItem'&&scheduledItems>cap)fail('QUOTA_LIMIT_REACHED','Limite de agendamentos atingido.');
      const zero=Object.fromEntries(Object.keys(FREE_LIMITS).map(k=>[k,0]));
      const before=await col.findOne({_id:id});requireHealthyRow(before);
      if(!before){try{const inserted=await col.insertOne({_id:id,sent:zero,applied:[],createdAt:new Date(ms),expiresAt:expiration},{writeConcern:{w:'majority'}});if(inserted?.acknowledged!==true)fail('QUOTA_STORAGE_UNAVAILABLE','A gravação de cota não foi confirmada.');}
      catch(e){if(e?.code!==11000)throw e;}}
      const filter={_id:id,applied:{$ne:receipt}};
      if(itemType!=='scheduleItem')filter['sent.'+itemType]={$lt:cap};
      const update={
        ...(itemType==='scheduleItem'?{$max:{'sent.scheduleItem':scheduledItems}}:{$inc:{['sent.'+itemType]:1}}),
        $addToSet:{applied:receipt},$set:{updatedAt:new Date(ms)}
      };
      let changed=await col.findOneAndUpdate(filter,update,{returnDocument:'after',writeConcern:{w:'majority'}});
      if(changed&&Object.hasOwn(changed,'value'))changed=changed.value;
      if(!changed){const existing=await col.findOne({_id:id});
        if(existing&&Array.isArray(existing.applied)&&existing.applied.includes(receipt))return{free:true,unlimited:false,date:day,limits:limitsView(existing),duplicate:true};
        fail('QUOTA_LIMIT_REACHED','Limite gratuito atingido.');
      }
      if(!changed.sent||!Array.isArray(changed.applied)||!changed.applied.includes(receipt))fail('QUOTA_STORAGE_UNAVAILABLE','O contador não confirmou a operação.');
      return{free:true,unlimited:false,date:day,limits:limitsView(changed),duplicate:false};
    }catch(e){if(e instanceof QuotaError)throw e;throw new QuotaError('QUOTA_STORAGE_UNAVAILABLE','O contador está temporariamente indisponível.');}
  }
  return {execute};
}
module.exports={createFreeQuotaService,FREE_LIMITS,QuotaError};
