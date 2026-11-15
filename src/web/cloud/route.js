'use strict';
// Shared-process route adapter. Same pattern as src/hobbies/ssx/route.js:
// one HTTP listener, independent module and explicit URL ownership.
const {createHandler}=require('../../../cloud-pilot/server');
const {createMongoStore}=require('../../../cloud-pilot/store');

const BASE='/dev/cloud';
const REQUEST_TIMEOUT_RETRY_MS=30000;

function createCloudRoute(options={}){
 const factory=options.factory||(async()=>{
  // No fallback to ZVM Desktop's database credentials. Cloud must be explicitly provisioned.
  const uri=String(process.env.CLOUD_MONGODB_URI||'').trim();
  const store=uri?await createMongoStore(uri):null;
  return createHandler({store});
 });
 let loader=null;
 let nextRetry=0;
 async function getHandler(){
  if(loader)return loader;
  if(Date.now()<nextRetry)return null;
  loader=Promise.resolve().then(factory).catch(error=>{
   nextRetry=Date.now()+REQUEST_TIMEOUT_RETRY_MS;
   loader=null;
   console.error('[ZVM-CLOUD] Isolated pilot unavailable:',error?.name||'Error');
   return null;
  });
  return loader;
 }
 return async function serveZVMCloud(req,res,pathname){
  if(pathname!==BASE&&!pathname.startsWith(BASE+'/'))return false;
  if(pathname===BASE){
   const method=String(req.method||'').toUpperCase();
   if(method==='GET'||method==='HEAD'){
    res.writeHead(308,{Location:BASE+'/','Cache-Control':'no-store','X-Robots-Tag':'noindex'});
    res.end();
   }else{
    res.writeHead(405,{Allow:'GET, HEAD','Cache-Control':'no-store'});
    res.end();
   }
   return true;
  }
  const handler=await getHandler();
  if(!handler){
   res.writeHead(503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex'});
   res.end(JSON.stringify({error:'cloud_temporarily_unavailable'}));
   return true;
  }
  const original=req.url;
  const suffix=original.slice(BASE.length);
  // The request header/hostname/origin stay unchanged: login remains origin-protected.
  req.url=suffix||'/';
  try{
   await handler(req,res);
  }finally{
   req.url=original;
  }
  return true;
 };
}
const serveZVMCloud=createCloudRoute();
module.exports={serveZVMCloud,createCloudRoute,BASE};
