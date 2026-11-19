'use strict';
// Account-bound, atomic FREE V4 quotas. NEVER take identity from request body.
const FREE_V4_QUOTA_LIMITS=Object.freeze({message:20,audio:10,media:10,document:10,scheduleItem:5});
const COLLECTION='extension_v4_free_usage';
const OPERATION_ID=/^[a-f0-9]{32,64}$/i,SUBJECT_ID=/^[a-f0-9]{64}$/i;
const VALID_ACTIONS=new Set(['check','commit','reconcile']);
class QuotaContractError extends Error{constructor(code,status){super(code);this.code=code;this.status=status;}}
function fail(code,status){throw new QuotaContractError(code,status);}
function utcPeriod(now){return now.toISOString().slice(0,10);}
function nextPeriod(now){const d=new Date(now);d.setUTCHours(24,0,0,0);return d;}
function ensureSubject(subject){if(!SUBJECT_ID.test(String(subject?.id||'')))fail('invalid_subject',401);if(subject.type!=='account')fail('account_session_required',403);return subject.id.toLowerCase();}
function rows(doc){const counts=doc?.counts||{};return Object.fromEntries(Object.entries(FREE_V4_QUOTA_LIMITS).map(([type,max])=>{const n=counts[type];return[type,{sent:Number.isSafeInteger(n)&&n>=0?Math.min(n,max):0,max}];}));}
function output(doc,day,now,details={}){return{ok:true,status:true,tier:'free',period:day,limits:rows(doc),expires_at:nextPeriod(now).toISOString(),...details};}
// Atomic conditional counter+operationId. Do not replay sends after an unknown ack.
async function executeV4FreeQuota({collection,subject,tier,action='check',itemType,operationId,scheduledItems,period,now=new Date()}){
 now=now instanceof Date?now:new Date(now);if(!Number.isFinite(now.valueOf()))fail('invalid_server_clock',503);
 const id=ensureSubject(subject);if(tier!=='free')fail('free_plan_required',403);if(!VALID_ACTIONS.has(action))fail('invalid_action',400);
 if(!Object.hasOwn(FREE_V4_QUOTA_LIMITS,itemType))fail('unknown_item_type',400);
 if(!collection||!['insertOne','findOne','findOneAndUpdate'].every(k=>typeof collection[k]==='function'))fail('quota_storage_unavailable',503);
 const today=utcPeriod(now),target=action==='reconcile'&&/^\d{4}-\d{2}-\d{2}$/.test(String(period||''))?period:today;
 if(action==='reconcile'){const delta=(Date.parse(today+'T00:00:00Z')-Date.parse(target+'T00:00:00Z'))/86400000;if(!Number.isInteger(delta)||delta<0||delta>2)fail('invalid_period',400);}
 const key='v4free:'+id+':'+target;
 if(action==='check')return output(await collection.findOne({_id:key}),today,now);
 if(!OPERATION_ID.test(String(operationId||'')))fail('invalid_operation_id',400);
 const op=itemType+':'+operationId.toLowerCase();
 if(action==='reconcile'){const doc=await collection.findOne({_id:key});return output(doc,target,now,{operationStatus:Array.isArray(doc?.operations)&&doc.operations.includes(op)?'committed':'not_found'});}
 if(period&&period!==today)fail('period_changed_reconcile_required',409);
 const max=FREE_V4_QUOTA_LIMITS[itemType];
 if(itemType==='scheduleItem'){if(!Number.isSafeInteger(scheduledItems)||scheduledItems<0||scheduledItems>max)fail('invalid_schedule_count',400);}
 else if(scheduledItems!==undefined)fail('invalid_schedule_count',400);
 const initial={_id:key,counts:Object.fromEntries(Object.keys(FREE_V4_QUOTA_LIMITS).map(k=>[k,0])),operations:[],createdAt:now,expireAt:new Date(now.getTime()+35*86400000)};
 try{await collection.insertOne(initial);}catch(e){if(e?.code!==11000)throw e;}
 const field='counts.'+itemType,filter={_id:key,operations:{$ne:op}},update={$addToSet:{operations:op}};
 if(itemType==='scheduleItem')update.$max={[field]:scheduledItems};
 else{filter[field]={$lt:max};update.$inc={[field]:1};}
 const changed=await collection.findOneAndUpdate(filter,update,{returnDocument:'after'});
 if(changed)return output(changed,today,now,{operationStatus:'committed'});
 const existing=await collection.findOne({_id:key});
 if(Array.isArray(existing?.operations)&&existing.operations.includes(op))return output(existing,today,now,{operationStatus:'committed',duplicate:true});
 if(itemType!=='scheduleItem'&&Number(existing?.counts?.[itemType]||0)>=max)fail('MAX_LIMIT_REACHED',403);
 fail('quota_result_uncertain',503);
}
module.exports={executeV4FreeQuota,FREE_V4_QUOTA_LIMITS,COLLECTION,QuotaContractError};
