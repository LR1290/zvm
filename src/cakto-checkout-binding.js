'use strict';
// Vinculo opaco de checkout autenticado. Nao autentica o usuario nem substitui HMAC Cakto.
const crypto=require('node:crypto');
const PREFIX='zvm1_';
const TTL_MS=45*24*60*60*1000;
const EMAIL_RX=/^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const KEY_RX=/^[a-z0-9-]{8,64}$/;
function aesKey(secret){
 if(typeof secret!=='string'||Buffer.byteLength(secret,'utf8')<32)return null;
 return crypto.createHash('sha256').update('zvm:cakto:checkout-binding:v1\0').update(secret).digest();
}
function createCheckoutBinding({keyCode,ownerEmail,secret,nowMs=Date.now()}){
 const key=aesKey(secret),code=String(keyCode||'').trim().toLowerCase(),email=String(ownerEmail||'').trim().toLowerCase();
 if(!key||!KEY_RX.test(code)||!EMAIL_RX.test(email)||!Number.isSafeInteger(nowMs))return '';
 const nonce=crypto.randomBytes(12),enc=crypto.createCipheriv('aes-256-gcm',key,nonce);
 enc.setAAD(Buffer.from(PREFIX));
 const plain=Buffer.from(JSON.stringify({v:1,c:code,e:email,exp:nowMs+TTL_MS}),'utf8');
 const ciphertext=Buffer.concat([enc.update(plain),enc.final()]);
 return PREFIX+Buffer.concat([nonce,enc.getAuthTag(),ciphertext]).toString('base64url');
}
// Introspecção autenticada somente para recuperação de assinaturas existentes.
 // Um claim expirado não concede acesso: exige prova de uma transação anterior
 // paga COM a mesma subscriptionId, chave e proprietário antes de ser usado.
function inspectCheckoutBinding(token,secret,nowMs=Date.now()){
 if(typeof token!=='string'||!token.startsWith(PREFIX)||token.length>640)return {status:'invalid'};
 const key=aesKey(secret);
 if(!key||!Number.isSafeInteger(nowMs))return {status:'invalid'};
 try{
  const encoded=token.slice(PREFIX.length);
  const bin=Buffer.from(encoded,'base64url');
  if(bin.length<29||bin.length>480||bin.toString('base64url')!==encoded)return {status:'invalid'};
  const dec=crypto.createDecipheriv('aes-256-gcm',key,bin.subarray(0,12));
  dec.setAAD(Buffer.from(PREFIX));dec.setAuthTag(bin.subarray(12,28));
  const doc=JSON.parse(Buffer.concat([dec.update(bin.subarray(28)),dec.final()]).toString('utf8'));
  if(doc?.v!==1||!KEY_RX.test(doc.c)||!EMAIL_RX.test(doc.e)||!Number.isSafeInteger(doc.exp)||doc.exp<=0||doc.exp>nowMs+TTL_MS)return {status:'invalid'};
  return {status:doc.exp<=nowMs?'expired':'active',keyCode:doc.c,ownerEmail:doc.e,expiresAtMs:doc.exp};
 }catch(_){return {status:'invalid'};}
}
function readCheckoutBinding(token,secret,nowMs=Date.now()){
 const inspected=inspectCheckoutBinding(token,secret,nowMs);
 return inspected.status==='active'?{keyCode:inspected.keyCode,ownerEmail:inspected.ownerEmail}:null;
}
function checkoutUrlForPortal(url,keyCode,ownerEmail,secret,nowMs=Date.now()){
 if(!keyCode||!ownerEmail)return url;
 const claim=createCheckoutBinding({keyCode,ownerEmail,secret,nowMs});if(!claim)return url;
 try{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.hostname!=='pay.cakto.com.br')return url;
  parsed.searchParams.set('sck',claim);return parsed.toString();
 }catch(_){return url;}
}
function isZvmCheckoutBinding(value){return typeof value==='string'&&value.startsWith(PREFIX);}
module.exports=Object.freeze({createCheckoutBinding,readCheckoutBinding,inspectCheckoutBinding,checkoutUrlForPortal,isZvmCheckoutBinding});
