'use strict';
// Official Meta WhatsApp Business webhook boundary. No message dispatch.
// Stores only minimal verified operational metadata; never message text or contacts.
const crypto=require('node:crypto');
const MAX_WEBHOOK=256*1024;
function compare(a,b){
 const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));
 return x.length===y.length&&crypto.timingSafeEqual(x,y);
}
function readiness(env=process.env,store=null){
 const enabled=env.CLOUD_META_WEBHOOK_ENABLED==='1';
 const verifyToken=String(env.CLOUD_META_VERIFY_TOKEN||''),appSecret=String(env.CLOUD_META_APP_SECRET||'');
 const ownerEmail=String(env.CLOUD_META_OWNER_EMAIL||'').trim().toLowerCase();
 const phoneId=String(env.CLOUD_META_PHONE_NUMBER_ID||'').trim();
 const configured=enabled&&verifyToken.length>=24&&appSecret.length>=24&&/^\d{6,30}$/.test(phoneId)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)&&!!store&&typeof store.recordMetaEvent==='function';
 return {enabled,configured,ownerEmail:configured?ownerEmail:null,phoneId:configured?phoneId:null,sendEnabled:false};
}
function handshake(url,verifyToken){
 const mode=url.searchParams.get('hub.mode'),code=url.searchParams.get('hub.verify_token'),challenge=url.searchParams.get('hub.challenge');
 if(mode!=='subscribe'||!verifyToken||!compare(code,verifyToken)||!challenge||challenge.length>256||!/^[a-zA-Z0-9_-]+$/.test(challenge))return null;
 return challenge;
}
function signed(body,header,appSecret){
 if(!Buffer.isBuffer(body)||!appSecret||appSecret.length<24||!/^sha256=[a-f0-9]{64}$/i.test(String(header||'')))return false;
 const expected='sha256='+crypto.createHmac('sha256',appSecret).update(body).digest('hex');
 return compare(String(header||'').toLowerCase(),expected);
}
async function readLimited(req,max=MAX_WEBHOOK){
 const chunks=[];let size=0;
 for await(const chunk of req){
  size+=chunk.length;if(size>max)throw Error('webhook_too_large');
  chunks.push(chunk);
 }
 return Buffer.concat(chunks,size);
}
function eventSummary(data){
 if(!data||data.object!=='whatsapp_business_account'||!Array.isArray(data.entry)||data.entry.length>32)throw Error('webhook_invalid_shape');
 let incoming=0,statuses=0,changes=0;const phoneIds=new Set();
 for(const entry of data.entry){
  if(!entry||!Array.isArray(entry.changes)||entry.changes.length>32)throw Error('webhook_invalid_changes');
  for(const change of entry.changes){
   if(!change||change.field!=='messages')continue;
   const v=change.value||{};
   const messages=Array.isArray(v.messages)?v.messages:[];
   const states=Array.isArray(v.statuses)?v.statuses:[];
   incoming+=messages.length;statuses+=states.length;changes++;
   const id=String(v.metadata?.phone_number_id||'');
   if(/^\d{4,30}$/.test(id))phoneIds.add(id);
   if(incoming>1000||statuses>1000)throw Error('webhook_too_many_events');
  }
 }
 return {incomingCount:incoming,statusCount:statuses,changes,phoneNumberIds:[...phoneIds].slice(0,12),createdAt:new Date()};
}
async function handleWebhook(req,res,{env=process.env,store}={}){
 const state=readiness(env,store);
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(!state.configured){res.writeHead(503);res.end('Webhook not configured');return true;}
 const url=new URL(req.url||'/','https://zvm.onrender.com');
 if(req.method==='GET'){
  const challenge=handshake(url,env.CLOUD_META_VERIFY_TOKEN);
  res.writeHead(challenge?200:403,{'Content-Type':'text/plain; charset=utf-8'});
  res.end(challenge||'Forbidden');
  return true;
 }
 if(req.method!=='POST'){res.writeHead(405,{Allow:'GET, POST'});res.end();return true;}
 if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json')){res.writeHead(415);res.end();return true;}
 let bytes;
 try{bytes=await readLimited(req);}catch{res.writeHead(413);res.end();return true;}
 if(!signed(bytes,req.headers['x-hub-signature-256'],env.CLOUD_META_APP_SECRET)){
  res.writeHead(401);res.end();return true;
 }
 let data,summary;
 try{data=JSON.parse(bytes.toString('utf8'));summary=eventSummary(data);}
 catch{res.writeHead(400);res.end();return true;}
 if(summary.phoneNumberIds.some(id=>id!==state.phoneId)){res.writeHead(403);res.end();return true;}
 const digest=crypto.createHash('sha256').update(bytes).digest('hex');
 try{await store.recordMetaEvent(state.ownerEmail,digest,summary);}
 catch{res.writeHead(503);res.end();return true;}
 res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});
 res.end('EVENT_ACCEPTED');
 return true;
}
module.exports={readiness,handshake,signed,readLimited,eventSummary,handleWebhook,MAX_WEBHOOK};