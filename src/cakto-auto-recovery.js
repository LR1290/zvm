'use strict';
// Cakto API verified recovery of SUBSCRIPTION renewals missing the webhook.
// Only pre-existing paid subscription + unchanged license owner. Orders which
// may already have been handled manually must be reviewed, never auto-credited.
const {createWindowUrl,validatePageUrl,requestJson,isVerifiedPaidMain,txMarkers}=require('./cakto-paid-order-audit');
const ORIGIN='https://api.cakto.com.br';
const ORDER_PREFIX='/public_api/orders/';
const idPattern=/^[a-z0-9_.:-]{1,120}$/i;
function orderDetailURL(id){
 if(!idPattern.test(String(id||'')) || id==='.' || id==='..')throw Error('cakto_recovery_order_invalid');
 return ORIGIN+ORDER_PREFIX+encodeURIComponent(id)+'/';
}
async function getOrderDetail(id,token,fetcher=fetch){
 const url=orderDetailURL(id);
 const controller=new AbortController(),stop=setTimeout(()=>controller.abort(),10000);
 try{
  const r=await fetcher(url,{method:'GET',redirect:'manual',headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:controller.signal});
  if(!r.ok)throw Error('cakto_recovery_detail_http_'+r.status);
  if(Number(r.headers?.get?.('content-length')||0)>1024*1024)throw Error('cakto_recovery_detail_oversize');
  const raw=await r.text();
  if(Buffer.byteLength(raw)>1024*1024)throw Error('cakto_recovery_detail_oversize');
  const detail=JSON.parse(raw);
  if(String(detail?.id)!==String(id))throw Error('cakto_recovery_id_mismatch');
  return detail;
 }finally{clearTimeout(stop);}
}
async function assessMissingRenewal(order,{db,normalize,resolvePlan,validateIntegrity,now=new Date(),enqueue}){
 if(!isVerifiedPaidMain(order)||!Number.isFinite(Date.parse(String(order.paidAt||''))))
  return {kind:'review',reason:'provider_unverified'};
 if(typeof normalize!=='function'||typeof resolvePlan!=='function'||typeof validateIntegrity!=='function'||typeof enqueue!=='function')
  throw Error('cakto_recovery_dependency_missing');
 const purchase=normalize({event:'purchase_approved',data:order});
 const plan=resolvePlan(purchase);
 if(!purchase||!plan||!validateIntegrity(purchase,plan)?.ok)
  return {kind:'review',reason:'commercial_validation'};
 const sub=String(purchase.subscriptionId||'').trim();
 if(!sub)return {kind:'review',reason:'subscription_id_missing'};
 const paidAt=new Date(purchase.paidAt);
 if(!Number.isFinite(paidAt.getTime())||paidAt>now||now.getTime()-paidAt.getTime()<30*60*1000)
  return {kind:'review',reason:'payment_grace'};
 const payments=db.collection('payments');
 const previous=await payments.findOne({
  source:'cakto',approved:true,testMode:{$ne:true},subscriptionId:sub,
  paidAt:{$lt:paidAt.toISOString()}
 },{sort:{paidAt:-1},projection:{_id:0,keyCode:1,paidAt:1,subscriptionId:1,txId:1,source:1,approved:1}});
 const code=String(previous?.keyCode||'');
 if(!/^[a-z0-9-]{8,64}$/.test(code))return {kind:'review',reason:'subscription_not_previously_bound'};
 const newer=await payments.findOne({
  source:'cakto',approved:true,keyCode:code,paidAt:{$gte:paidAt.toISOString()}
 },{projection:{_id:1}});
 if(newer)return {kind:'review',reason:'newer_payment_exists'};
 const owners=await db.collection('portal_users').find({keyCode:code},{projection:{_id:1}}).limit(2).toArray();
 if(owners.length!==1)return {kind:'review',reason:owners.length?'ambiguous_portal_ownership':'no_portal_owner'};
 const manual=await db.collection('admin_audit_logs').findOne({
  action:'key_renewed',keyCode:code,ts:{$gte:paidAt}
 },{projection:{_id:1}});
 if(manual)return {kind:'review',reason:'manual_renewal_after_payment'};
 // A paid original order with a purchase history is NOT a new license;
 // the existing payment/queue uniqueness remains authoritative.
 await enqueue(purchase,plan);
 return {kind:'enqueued'};
}
async function runMissingRenewalPass({token,db,normalize,resolvePlan,validateIntegrity,enqueue,
 fetcher=fetch,now=new Date(),maxPages=4,maxCandidates=20}){
 if(!token||!db||typeof enqueue!=='function')throw Error('cakto_recovery_configuration_missing');
 const end=new Date(now.getTime()+86400000).toISOString().slice(0,10);
 const start=new Date(now.getTime()-3*86400000).toISOString().slice(0,10);
 const summary={readOnly:false,mode:'scoped_paid_subscription_recovery',pages:0,seen:0,existing:0,
  alreadyQueued:0,enqueued:0,review:0,blockedReasons:{},complete:false};
 let url=createWindowUrl(start,end);
 const pageSet=new Set(),orderIds=new Set();
 while(url&&summary.pages<maxPages){
  url=validatePageUrl(url);
  if(pageSet.has(url))throw Error('cakto_recovery_page_loop');pageSet.add(url);
  const page=await requestJson(url,{token,fetcher});summary.pages++;
  for(const candidate of page.results){
   if(!isVerifiedPaidMain(candidate)||typeof candidate.paidAt!=='string'||!Number.isFinite(Date.parse(candidate.paidAt))||candidate.paidAt.slice(0,10)<start||candidate.paidAt.slice(0,10)>=end)continue;
   if(orderIds.has(candidate.id))continue;orderIds.add(candidate.id);summary.seen++;
   if(summary.seen>maxCandidates)return {...summary,complete:false,limitReached:true};
   const ids=txMarkers(candidate.id);
   const recorded=await db.collection('payments').findOne({approved:true,$or:[
    {commercialTxKey:ids.paymentKey},{txId:candidate.id,source:'cakto'},{txId:candidate.id,txNamespace:'cakto'}
   ]},{projection:{_id:1}});
   if(recorded){summary.existing++;continue;}
   const queued=await db.collection('webhook_events').findOne({eventKey:ids.eventKey,source:'cakto'},{projection:{_id:1}});
   if(queued){summary.alreadyQueued++;continue;}
   let decision;
   try{
    const verified=await getOrderDetail(candidate.id,token,fetcher);
    decision=await assessMissingRenewal(verified,{db,normalize,resolvePlan,validateIntegrity,enqueue,now});
   }catch(e){decision={kind:'review',reason:'provider_or_db_error'};}
   if(decision.kind==='enqueued')summary.enqueued++;
   else {summary.review++;const k=String(decision.reason||'unknown');summary.blockedReasons[k]=(summary.blockedReasons[k]||0)+1;}
  }
  url=page.next?validatePageUrl(page.next):null;
 }
 summary.complete=!url;
 return summary;
}
module.exports={orderDetailURL,getOrderDetail,assessMissingRenewal,runMissingRenewalPass};
