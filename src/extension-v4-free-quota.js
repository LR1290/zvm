'use strict';
const crypto = require('node:crypto');
// Account-bound, atomic FREE V4 quotas. NEVER take identity from request body.
const FREE_V4_QUOTA_LIMITS=Object.freeze({message:20,audio:10,media:10,document:10,scheduleItem:5});
const COLLECTION='extension_v4_free_usage';
const OPERATION_ID=/^[a-f0-9]{32,64}$/i,SUBJECT_ID=/^[a-f0-9]{64}$/i;
const VALID_ACTIONS=new Set(['check','reserve','settle','reconcile']);
class QuotaContractError extends Error{constructor(code,status){super(code);this.code=code;this.status=status;}}
function fail(code,status){throw new QuotaContractError(code,status);}
function utcPeriod(now){return now.toISOString().slice(0,10);}
function nextPeriod(now){const d=new Date(now);d.setUTCHours(24,0,0,0);return d;}
function ensureSubject(subject){if(!SUBJECT_ID.test(String(subject?.id||'')))fail('invalid_subject',401);if(subject.type!=='account')fail('account_session_required',403);return subject.id.toLowerCase();}
function rows(doc){const counts=doc?.counts||{};return Object.fromEntries(Object.entries(FREE_V4_QUOTA_LIMITS).map(([type,max])=>{const n=counts[type];return[type,{sent:Number.isSafeInteger(n)&&n>=0?Math.min(n,max):0,max}];}));}
function output(doc,day,now,details={}){return{ok:true,status:true,tier:'free',period:day,limits:rows(doc),expires_at:nextPeriod(now).toISOString(),...details};}
// Atomic conditional counter+operationId. Do not replay sends after an unknown ack.
async function executeV4FreeQuota({ collection, subject, tier, action = 'check',
  itemType, operationId, period, ack, messageId, scheduledItems, now = new Date() }) {
  now = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(now.getTime())) fail('invalid_server_clock', 503);
  const subjectId = ensureSubject(subject);
  if (tier !== 'free') fail('free_plan_required', 403);
  if (!VALID_ACTIONS.has(action)) fail('invalid_action', 400);
  if (!Object.hasOwn(FREE_V4_QUOTA_LIMITS, itemType)) fail('unknown_item_type', 400);
  if (!collection || !['insertOne','findOne','findOneAndUpdate'].every(k => typeof collection[k] === 'function')) fail('quota_storage_unavailable', 503);
  const today = utcPeriod(now);
  const target = (action === 'check' || action === 'reserve') ? today : String(period || today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) fail('invalid_period', 400);
  const daysBack = (Date.parse(today+'T00:00:00Z') - Date.parse(target+'T00:00:00Z')) / 86400000;
  if (!Number.isInteger(daysBack) || daysBack < 0 || daysBack > 2) fail('invalid_period', 400);
  if (action === 'reserve' && period && period !== today) fail('period_changed_reconcile_required', 409);
  const recordId = 'v4free:' + subjectId + ':' + target;
  if (action === 'check') return output(await collection.findOne({ _id: recordId }), target, now);
  if (!OPERATION_ID.test(String(operationId || ''))) fail('invalid_operation_id', 400);
  const operation = operationId.toLowerCase(), path = 'receipts.' + operation, field = 'counts.' + itemType;
  const getOp = doc => doc && doc.receipts && doc.receipts[operation];
  if (action === 'reconcile') {
    const doc = await collection.findOne({ _id: recordId }), op = getOp(doc);
    if (op && op.type !== itemType) fail('operation_type_mismatch', 409);
    return output(doc, target, now, { operationStatus: op?.status || 'not_found', duplicate: !!op });
  }
  if (action === 'settle') {
    if (!['confirmed','uncertain'].includes(String(ack))) fail('invalid_settlement', 400);
    if (ack === 'confirmed' && (typeof messageId !== 'string' || messageId.length < 8 || messageId.length > 256)) fail('message_receipt_required', 400);
    const doc = await collection.findOne({ _id: recordId }), op = getOp(doc);
    if (!op) fail('reservation_not_found', 409);
    if (op.type !== itemType) fail('operation_type_mismatch', 409);
    if (op.status === 'confirmed' || (ack === 'uncertain' && op.status === 'uncertain')) {
      return output(doc, target, now, { operationStatus: op.status, duplicate: true });
    }
    const status = ack === 'confirmed' ? 'confirmed' : 'uncertain', patch = { status, updatedAt: now };
    if (status === 'confirmed') patch.receiptHash = crypto.createHash('sha256').update(messageId, 'utf8').digest('hex');
    const update = { $set: Object.fromEntries(Object.entries(patch).map(([key, value]) => [path+'.'+key, value])) };
    const changed = await collection.findOneAndUpdate({ _id: recordId, [path+'.status']: op.status }, update, { returnDocument: 'after' });
    if (changed) return output(changed, target, now, { operationStatus: status });
    const latest = await collection.findOne({ _id: recordId }), after = getOp(latest);
    if (!after) fail('quota_result_uncertain', 503);
    return output(latest, target, now, { operationStatus: after.status, duplicate: true });
  }
  // A client cannot claim the number of active schedules. This requires
  // an authoritative scheduler; keeping the Free scheduling gate closed until
  // a server-side count exists is safer than silently bypassing limits.
  if (scheduledItems !== undefined || itemType === 'scheduleItem') fail('schedule_server_authority_required', 403);
  const ttlAt = new Date(now.getTime() + 35*86400000), max = FREE_V4_QUOTA_LIMITS[itemType];
  const initial = { _id: recordId,
    counts: Object.fromEntries(Object.keys(FREE_V4_QUOTA_LIMITS).map(k => [k,0])),
    receipts: {}, receiptCount: 0, createdAt: now, expireAt: ttlAt };
  try { await collection.insertOne(initial); }
  catch (error) { if (error?.code !== 11000) throw error; }
  // One atomic document update performs both the reservation counter and the
  // immutable operation receipt. No refund for a client-reported send failure:
  // after the WA-JS request the effect can be uncertain.
  const filter = { _id: recordId, [path]: { $exists: false },
    [field]: { $lt: max }, receiptCount: { $lt: 128 } };
  const update = { $inc: { [field]: 1, receiptCount: 1 },
    $set: { [path]: { type: itemType, status: 'reserved', createdAt: now, updatedAt: now } } };
  const charged = await collection.findOneAndUpdate(filter, update, { returnDocument: 'after' });
  if (charged) return output(charged, target, now, { operationStatus: 'reserved' });
  const doc = await collection.findOne({ _id: recordId }), op = getOp(doc);
  if (op) {
    if (op.type !== itemType) fail('operation_type_mismatch', 409);
    return output(doc, target, now, { operationStatus: op.status, duplicate: true });
  }
  if (Number(doc?.receiptCount || 0) >= 128) fail('quota_operation_limit_reached', 429);
  if (Number(doc?.counts?.[itemType] || 0) >= max) fail('MAX_LIMIT_REACHED', 403);
  fail('quota_result_uncertain', 503);
}
module.exports = { executeV4FreeQuota, FREE_V4_QUOTA_LIMITS, COLLECTION, QuotaContractError };
