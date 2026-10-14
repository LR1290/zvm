'use strict';
// Reconciliation is READ-ONLY. An API order absent from payments must NOT be
// credited automatically: it may already have been renewed manually.
const crypto=require('node:crypto');
const API_ORIGIN='https://api.cakto.com.br';
const ORDERS_PATH='/public_api/orders/';
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
function txMarkers(id){
 if(!/^[A-Za-z0-9_.:-]{1,120}$/.test(String(id||'')))throw Error('invalid_cakto_order_id');
 return {paymentKey:'cpt_'+hash('cakto\0'+id),eventKey:'cakto:purchase_approved:evt_'+hash('cakto:event\0'+id),displayRef:'order#'+hash('cakto:audit\0'+id).slice(0,12)};
}
function validatePageUrl(input){
 const u=new URL(input,API_ORIGIN);
 if(u.protocol!=='https:'||u.origin!==API_ORIGIN||u.pathname!==ORDERS_PATH||u.username||u.password||u.hash)throw Error('cakto_order_page_rejected');
 return u.toString();
}
function createWindowUrl(from,to){
 if(!/^\d{4}-\d\d-\d\d$/.test(from)||!/^\d{4}-\d\d-\d\d$/.test(to)||from>=to)throw Error('invalid_date_window');
 const u=new URL(ORDERS_PATH,API_ORIGIN);
 u.searchParams.set('status','paid');u.searchParams.set('offer_type','main');
 u.searchParams.set('paidAt__gte',from);u.searchParams.set('paidAt__lt',to);
 u.searchParams.set('ordering','-paidAt');u.searchParams.set('limit','100');return u.toString();
}
function isVerifiedPaidMain(order){
 return !!order && order.status==='paid' && order.offer_type==='main'
  && !order.refundedAt && !order.chargedbackAt && !order.canceledAt
  && typeof order.id==='string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(order.id);
}
async function requestJson(url,{token,fetcher=fetch,maxBytes=1_500_000}){
 const ac=new AbortController();const stop=setTimeout(()=>ac.abort(),10000);
 try{
  const r=await fetcher(validatePageUrl(url),{method:'GET',redirect:'manual',
   headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:ac.signal});
  if(!r.ok)throw Error('cakto_orders_http_'+r.status);
  if(Number(r.headers?.get?.('content-length')||0)>maxBytes)throw Error('cakto_orders_oversize');
  const raw=await r.text();
  if(Buffer.byteLength(raw)>maxBytes)throw Error('cakto_orders_oversize');
  const data=JSON.parse(raw);
  if(!Array.isArray(data?.results))throw Error('cakto_orders_malformed');
  return data;
 }finally{clearTimeout(stop);}
}
async function auditPaidOrders({token,db,from,to,fetcher=fetch,maxPages=12}){
 if(!token||!db||!/^\d{4}-\d\d-\d\d$/.test(from)||!/^\d{4}-\d\d-\d\d$/.test(to)||!(maxPages>0&&maxPages<=30))throw Error('cakto_order_audit_invalid_configuration');
 const totals={readOnly:true,complete:false,pages:0,paidMain:0,foundPayment:0,queued:0,needsReview:0,skipped:0,sample:[]};
 let url=createWindowUrl(from,to);const pages=new Set(),orders=new Set();
 while(url&&totals.pages<maxPages){
  url=validatePageUrl(url);
  if(pages.has(url))throw Error('cakto_order_page_cycle');pages.add(url);
  const page=await requestJson(url,{token,fetcher});totals.pages++;
  for(const order of page.results){
   if(!isVerifiedPaidMain(order)||!Number.isFinite(Date.parse(String(order.paidAt||'')))||order.paidAt.slice(0,10)<from||order.paidAt.slice(0,10)>=to){totals.skipped++;continue;}
   if(orders.has(order.id))continue;
   orders.add(order.id);totals.paidMain++;
   const key=txMarkers(order.id);
   const payment=await db.collection('payments').findOne({approved:true,$or:[
    {commercialTxKey:key.paymentKey},{txId:order.id,source:'cakto'},{txId:order.id,txNamespace:'cakto'}]},
    {projection:{_id:1}});
   if(payment){totals.foundPayment++;continue;}
   const event=await db.collection('webhook_events').findOne({eventKey:key.eventKey,source:'cakto'},
    {projection:{_id:1,status:1}});
   if(event){totals.queued++;continue;}
   totals.needsReview++;
   if(totals.sample.length<12)totals.sample.push(key.displayRef);
  }
  url=page.next?validatePageUrl(page.next):null;
 }
 totals.complete=!url;
 return totals;
}
async function getScopedToken(clientId,clientSecret,{fetcher=fetch}={}){
 if(!clientId||!clientSecret)throw Error('cakto_readonly_credentials_missing');
 const ac=new AbortController();const stop=setTimeout(()=>ac.abort(),10000);
 try{
  const r=await fetcher('https://api.cakto.com.br/public_api/token/',{
   method:'POST',redirect:'manual',
   headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({client_id:clientId,client_secret:clientSecret}),signal:ac.signal
  });
  if(!r.ok)throw Error('cakto_auth_failed');
  const body=await r.text();if(Buffer.byteLength(body)>8192)throw Error('cakto_auth_oversize');
  const data=JSON.parse(body);
  const scopes=String(data.scope||'').split(/\s+/);
  if(!scopes.includes('read')||!scopes.includes('orders')||scopes.includes('write'))throw Error('cakto_readonly_scope_required');
  if(typeof data.access_token!=='string'||!data.access_token)throw Error('cakto_auth_invalid');
  return data.access_token;
 }finally{clearTimeout(stop);}
}
module.exports={txMarkers,validatePageUrl,createWindowUrl,isVerifiedPaidMain,requestJson,auditPaidOrders,getScopedToken};
