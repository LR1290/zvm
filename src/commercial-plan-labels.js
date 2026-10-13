'use strict';
// Presentation only: never mutate historical Cakto IDs/prices or licensed limits.
const legacy=Object.freeze({
 solo:{label:'SOLO',uses:1,tone:'solo'},padrao:{label:'PRO',uses:3,tone:'pro'},
 pro:{label:'PRO - contrato anterior',uses:5,tone:'pro'},
 empresarial:{label:'ENTERPRISE - contrato anterior',uses:10,tone:'enterprise'},
});
const modern=Object.freeze({
 start_v2:{label:'START',tone:'start'},
 pro_v2:{label:'PRO',tone:'pro'},
 enterprise_v2:{label:'ENTERPRISE',tone:'enterprise'}
});
const alias=Object.freeze({'solo':'solo','zvm solo':'solo','padrao':'padrao','zvm padrao':'padrao','zvm pro':'pro','zvm empresarial':'empresarial','empresarial':'empresarial'});
function slug(x){return String(x==null?'':x).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');}
function countUses(n){const k=Number(n);return n!==null&&n!==undefined&&n!==''&&Number.isInteger(k)&&k!==0&&k>=-1&&k<=10000?k:null;}
function displayLicensePlan({planId,planLabel,maxUses}={}){
 const id=String(planId||'').toLowerCase().trim(),count=countUses(maxUses);
 const found=legacy[id]||modern[id]||null;
 if(found){
  if(legacy[id]&&count!==null&&legacy[id].uses!==count){
   return {label:count===-1?'Licença sem limite':'Licença de '+count+' acesso(s) (revisar plano)',tone:'neutral',ambiguous:true,source:'inconsistent_legacy_id'};
  }
  return {label:found.label,tone:found.tone,ambiguous:false,source:'persisted_plan_id'};
 }
 const idFromLabel=alias[slug(planLabel)];
 if(idFromLabel){
  const item=legacy[idFromLabel];
  if(count===null||count===item.uses)return {label:item.label,tone:item.tone,ambiguous:false,source:'legacy_outbox_label'};
 }
 if(count!==null)return {label:count===-1?'Licença sem limite':'Licença de '+count+' acesso(s)',tone:'neutral',ambiguous:true,source:'unclassified'};
 return {label:'Licença ZVM',tone:'neutral',ambiguous:true,source:'unclassified'};
}
module.exports={displayLicensePlan};
