'use strict';
// R46.76 — READ-ONLY financial estimate. Rates negotiated with the owner are
// a scenario, not provider-confirmed settlement. Never use this to bill,
// grant licenses, change ledger amounts or infer cash available at Cakto.
const RATE_PROFILES = Object.freeze({
  negotiated: Object.freeze({
    pix: Object.freeze({ bps:0, fixedCents:199 }),
    pix_auto: Object.freeze({ bps:199, fixedCents:199 }),
    credit_card: Object.freeze({ bps:399, fixedCents:199 })
  }),
  public_standard_2026: Object.freeze({
    pix: Object.freeze({ bps:0, fixedCents:249 }),
    credit_card: Object.freeze({ bps:499, fixedCents:249 })
  })
});
function brlToCents(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1e11) return null;
  const cents=Math.round(amount*100);
  if (Math.abs(amount*100-cents)>0.00001 || !Number.isSafeInteger(cents)) return null;
  return cents;
}
function normalizeMethod(input) {
  const value=String(input??'').toLowerCase().trim().replace(/[ -]/g,'_');
  if(['pix','instant_payment'].includes(value)) return 'pix';
  if(['pix_auto','pix_automatico','pix_automático','automatic_pix','pix_recorrente'].includes(value)) return 'pix_auto';
  if(['credit_card','cartao_de_credito','cartão_de_crédito','card'].includes(value)) return 'credit_card';
  return null;
}
function estimatePayment(row,{profile='negotiated'}={}) {
  if(!row || row.approved!==true || row.testMode===true || (row.source!=='cakto' && row.txNamespace!=='cakto'))
    return {eligible:false, reason:'not_approved_cakto'};
  const grossCents=brlToCents(row.amount);
  if(grossCents===null) return {eligible:false, reason:'invalid_gross'};
  const method=normalizeMethod(row.paymentMethod);
  // A historical override is only allowed when a transaction explicitly
  // carries a vetted profile marker. Never guess historical fees by plan ID.
  const rateProfile=row.caktoFeeProfile==='public_standard_2026'?'public_standard_2026':profile;
  const rate=RATE_PROFILES[rateProfile]?.[method];
  if(!rate) return {eligible:true,method:method||'unclassified',grossCents, feeCents:null,netCents:null,
    baseCents:brlToCents(row.baseAmount),status:'unclassified',rateProfile:null,
    reservedCents:null,availableCents:null};
  const feeCents=Math.min(grossCents, Math.round(grossCents*rate.bps/10000)+rate.fixedCents);
  return { eligible:true,method,grossCents,baseCents:brlToCents(row.baseAmount),
    feeCents,netCents:grossCents-feeCents, rateProfile, status:'estimate_not_settlement',
    reservedCents:null,availableCents:null };
}
function emptyFinance() {
  return { source:'cakto',scope:'approved_real_payments',basis:'negotiated_fee_scenario_unverified',
    grossCents:0,estimatedFeeCents:0,estimatedNetCents:0,modeledGrossCents:0,
    unclassifiedGrossCents:0,nonCaktoCount:0,count:0,estimatedCount:0,
    unclassifiedCount:0,invalidGrossCount:0,methods:{},reservedCents:null,availableCents:null,
    settlementVerified:false,complete:false };
}
function appendEstimate(summary,row,opts={}) {
  const e=estimatePayment(row,opts);
  if(!e.eligible){if(e.reason==='invalid_gross')summary.invalidGrossCount++;else summary.nonCaktoCount++;return summary;}
  summary.count++;summary.grossCents+=e.grossCents;
  if(e.feeCents===null){summary.unclassifiedCount++;summary.unclassifiedGrossCents+=e.grossCents;return summary;}
  summary.estimatedCount++;summary.modeledGrossCents+=e.grossCents;
  summary.estimatedFeeCents+=e.feeCents;summary.estimatedNetCents+=e.netCents;
  const k=e.method+'_'+e.rateProfile;
  if(!summary.methods[k])summary.methods[k]={method:e.method,profile:e.rateProfile,count:0,grossCents:0,feeCents:0,netCents:0};
  const bucket=summary.methods[k];bucket.count++;bucket.grossCents+=e.grossCents;
  bucket.feeCents+=e.feeCents;bucket.netCents+=e.netCents;
  return summary;
}
async function summarizeCaktoFinances(rows,opts={}) {
  const summary=emptyFinance();
  for await(const row of rows) appendEstimate(summary,row,opts);
  summary.complete=summary.unclassifiedCount===0&&summary.invalidGrossCount===0;
  return summary;
}
function centsToBRL(cents) {return cents===null || !Number.isSafeInteger(cents)?null:cents/100;}
module.exports={ RATE_PROFILES,brlToCents,normalizeMethod,estimatePayment,emptyFinance,appendEstimate,summarizeCaktoFinances,centsToBRL };
