'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {RATE_PROFILES,brlToCents,normalizeMethod,estimatePayment,summarizeCaktoFinances}=require('../src/cakto-fee-analytics');
(async()=>{
 let scenarios=0;
 const actual=(amount,method,extras={})=>({amount,paymentMethod:method,source:'cakto',approved:true,testMode:false,...extras});
 const expect=(item,gross,fee,net,profile='negotiated')=>{
   const r=estimatePayment(item);assert.equal(r.grossCents,gross);assert.equal(r.feeCents,fee);
   assert.equal(r.netCents,net);assert.equal(r.rateProfile,profile);
   assert.equal(r.status,'estimate_not_settlement');
   assert.equal(r.reservedCents,null);assert.equal(r.availableCents,null);scenarios++;
 };
 expect(actual(39.90,'pix'),3990,199,3791);
 expect(actual(59.90,'pix'),5990,199,5791);
 expect(actual(39.90,'pix_auto'),3990,278,3712);
 expect(actual(39.90,'credit_card'),3990,358,3632);
 expect(actual(59.90,'credit_card',{caktoFeeProfile:'public_standard_2026'}),5990,548,5442,'public_standard_2026');
 assert.equal(brlToCents(0),0);assert.equal(brlToCents(39.9),3990);
 assert.equal(brlToCents(39.901),null);assert.equal(brlToCents('39.90'),null);
 assert.equal(brlToCents(-1),null);assert.equal(normalizeMethod('pix_automatico'),'pix_auto');
 assert.equal(normalizeMethod('CREDIT_CARD'),'credit_card');scenarios++;
 for(const bad of [actual(39.90,'boleto'),actual(39.9,'pix_auto',{caktoFeeProfile:'unknown'})]){
   const r=estimatePayment(bad);if(r.method==='unclassified')assert.equal(r.feeCents,null);
 }scenarios++;
 assert.equal(estimatePayment(actual(39.90,'pix',{testMode:true})).eligible,false);
 assert.equal(estimatePayment(actual(39.90,'pix',{approved:false})).eligible,false);
 assert.equal(estimatePayment(actual(39.90,'pix',{source:'other'})).eligible,false);
 const bad=estimatePayment(actual(39.90,'boleto'));
 assert.equal(bad.grossCents,3990);assert.equal(bad.feeCents,null);
 assert.equal(estimatePayment(actual(0.99,'pix')).feeCents,99,'fixed fee cannot exceed sale');
 const sum=await summarizeCaktoFinances([
   actual(39.90,'pix'),
   actual(39.90,'pix_auto'),
   actual(39.90,'credit_card'),
   actual(39.90,'boleto'),
   actual(39.90,'pix',{testMode:true}),
   actual(39.90,'pix',{source:'unrelated'}),
 ]);
 assert.equal(sum.count,4);assert.equal(sum.estimatedCount,3);assert.equal(sum.nonCaktoCount,2);
 assert.equal(sum.grossCents,15960);assert.equal(sum.unclassifiedGrossCents,3990);
 assert.equal(sum.modeledGrossCents,11970);assert.equal(sum.estimatedFeeCents,199+278+358);
 assert.equal(sum.estimatedNetCents,11970-(199+278+358));
 assert.equal(sum.complete,false);assert.equal(sum.settlementVerified,false);
 assert.equal(sum.reservedCents,null);assert.equal(sum.availableCents,null);
 assert.equal(Object.keys(sum.methods).length,3);
 const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 assert(server.includes('summarizeCaktoFinances(financialRows)'));
 assert(server.includes('estimatePayment(p)'));
 assert(server.includes('Cakto · Bruto, taxas e líquido'));
 assert(server.includes('não informados nos registros atuais'));
 assert(server.includes('colspan="10"'));
 assert(server.includes('baseAmount: sale.baseAmount ?? null'));
 assert(!server.includes('await updateFinanceBalances('));
 assert.equal(RATE_PROFILES.negotiated.pix.fixedCents,199);
 scenarios++;
 console.log('R46.76 Cakto fee modeling and financial display: '+scenarios+' test families PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
