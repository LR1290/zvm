'use strict';
// New public merchandising is intentionally separate from historical Cakto grants.
// A new checkout is available only when owner pins an independent offer/product ID
// AND a verified Cakto checkout URL. Never reuse an old checkout at a new price.
const OLD_CHECKOUTS=new Set([
 'https://pay.cakto.com.br/7kzktq2_1000035',
 'https://pay.cakto.com.br/spxbb8u_1030568',
 'https://pay.cakto.com.br/3ehxsg3_1030569',
 'https://pay.cakto.com.br/eihat4z_1030571'
]);
function safeCheckout(s){
 try{const u=new URL(String(s||''));if(u.protocol!=='https:'||u.hostname!=='pay.cakto.com.br'||OLD_CHECKOUTS.has(u.origin+u.pathname)||u.search||u.hash)return '';return u.origin+u.pathname;}catch(_){return '';}
}
function readNewCatalog(env=process.env){
 const startUrl=safeCheckout(env.ZVM_START_V2_CHECKOUT_URL);
 const proUrl=safeCheckout(env.ZVM_PRO_V2_CHECKOUT_URL);
 const startId=String(env.CAKTO_START_V2_OFFER_ID||'').trim();
 const proId=String(env.CAKTO_PRO_V2_OFFER_ID||'').trim();
 const pinOk=id=>/^[a-zA-Z0-9_-]{6,128}$/.test(id);
 const oldIds=[env.CAKTO_SOLO_OFFER_ID,env.CAKTO_PADRAO_OFFER_ID,env.CAKTO_PRO_OFFER_ID,env.CAKTO_EMPRESARIAL_OFFER_ID].filter(Boolean).map(String);
 const startReady=!!startUrl&&pinOk(startId)&&!oldIds.includes(startId)&&(!proUrl||startUrl!==proUrl);
 const proReady=!!proUrl&&pinOk(proId)&&proId!==startId&&!oldIds.includes(proId)&&(!startUrl||proUrl!==startUrl);
 return Object.freeze({
  start_v2:Object.freeze({id:'start_v2',name:'ZVM START',shortName:'START',price:59.90,maxUses:1,durationDays:30,
    checkoutUrl:startReady?startUrl:'',offerId:startReady?startId:'',productId:'',enabled:startReady,subtitle:'Quem está começando'}),
  pro_v2:Object.freeze({id:'pro_v2',name:'ZVM PRO',shortName:'PRO',price:149.90,maxUses:3,durationDays:30,
    checkoutUrl:proReady?proUrl:'',offerId:proReady?proId:'',productId:'',enabled:proReady,subtitle:'Operação completa'}),
  enterprise_v2:Object.freeze({id:'enterprise_v2',name:'ZVM ENTERPRISE',shortName:'ENTERPRISE',price:null,maxUses:10,durationDays:30,
    checkoutUrl:'',offerId:'',productId:'',enabled:false,consult:true,subtitle:'Empresas que querem implantação'}),
 });
}
module.exports={readNewCatalog,safeCheckout};
