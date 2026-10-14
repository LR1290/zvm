'use strict';
// Use ONLY with a paid Cakto order already authenticated and validated by
// the existing commercial integrity guard. This never verifies Cakto itself.
const {inspectCheckoutBinding}=require('./cakto-checkout-binding');
function clean(s){return typeof s==='string'?s.trim().toLowerCase():'';}
async function resolveSubscriptionCheckout({claim,secret,nowMs,purchase,lookupPreviousPayment,lookupOwner}){
 const inspected=inspectCheckoutBinding(claim,secret,nowMs);
 if(inspected.status==='invalid')return {ok:false,reason:'binding_invalid'};
 if(typeof lookupOwner!=='function')return {ok:false,reason:'owner_lookup_required'};
 if(inspected.status==='expired'){
  if(!purchase||!['subscription_renewed','purchase_approved'].includes(purchase.event)||purchase.status!=='paid'||!clean(purchase.subscriptionId)){
   return {ok:false,reason:'expired_without_paid_subscription'};
  }
  if(typeof lookupPreviousPayment!=='function')return {ok:false,reason:'subscription_lookup_required'};
  const prior=await lookupPreviousPayment(purchase.subscriptionId);
  if(!prior || prior.txId===purchase.txId || prior.keyCode!==inspected.keyCode ||
     prior.approved!==true || prior.testMode===true || prior.source!=='cakto' ||
     prior.subscriptionId!==purchase.subscriptionId){
   return {ok:false,reason:'no_prior_paid_subscription_proof'};
  }
  const paid=Date.parse(String(prior.paidAt||''));
  const renewal=Date.parse(String(purchase.paidAt||''));
  if(!Number.isFinite(paid)||!Number.isFinite(renewal)||paid>=renewal)
   return {ok:false,reason:'subscription_payment_time_conflict'};
 }
 const owner=await lookupOwner(inspected.ownerEmail);
 if(!owner||owner.keyCode!==inspected.keyCode)return {ok:false,reason:'ownership_changed'};
 return {ok:true,keyCode:inspected.keyCode,ownerEmail:inspected.ownerEmail,reason:inspected.status==='expired'?'verified_subscription_renewal':'active_binding'};
}
module.exports={resolveSubscriptionCheckout};
