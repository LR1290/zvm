'use strict';
// Cloud pilot data only. Never access the ZVM Desktop/license database with this connection.
const DATABASE='zvm_cloud_pilot';
const crypto=require('node:crypto');
const workspaceId=email=>crypto.createHash('sha256').update('zvm-cloud-workspace-v1:'+email).digest('hex');
const copy=x=>x==null?null:JSON.parse(JSON.stringify(x));
const expMs=v=>new Date(v).getTime();
function createMemoryStore(){
 const grants=new Map(),drafts=new Map(),workspaces=new Map(),media=new Map(),metaEvents=new Map();
 return {
  async grant(sessionId,email,keyHash,expiresAt){grants.set(sessionId,{email,keyHash,expiresAt:new Date(expiresAt).toISOString()});},
  async getGrant(sessionId){const g=grants.get(sessionId);if(!g||!(expMs(g.expiresAt)>Date.now())){grants.delete(sessionId);return null;}return copy(g);},
  async revokeGrant(sessionId){grants.delete(sessionId);},
  async getDraft(email){return copy(drafts.get(email));},
  async setDraft(email,doc){drafts.set(email,copy(doc));return copy(doc);},
  async clearDraft(email){drafts.delete(email);},
  async readWorkspace(email){
   return copy(workspaces.get(workspaceId(email))||{revision:0,modules:{},updatedAt:null});
  },
  async writeWorkspace(email,revision,modules){
   const id=workspaceId(email),current=workspaces.get(id)||{revision:0};
   if(current.revision!==revision)return {conflict:true,currentRevision:current.revision};
   const next={revision:revision+1,modules:copy(modules),updatedAt:new Date().toISOString()};
   workspaces.set(id,next);return {conflict:false,...copy(next)};
  },
  async readMedia(email){
   const doc=media.get(workspaceId(email));
   if(!doc)return {revision:0,items:[]};
   return {revision:doc.revision,items:doc.items.map(item=>({...item,bytes:Buffer.from(item.bytes)}))};
  },
  async writeMedia(email,revision,items){
   const id=workspaceId(email),doc=media.get(id)||{revision:0};
   if(doc.revision!==revision)return {conflict:true};
   media.set(id,{revision:revision+1,items:items.map(item=>({...item,bytes:Buffer.from(item.bytes)}))});
   return {conflict:false,revision:revision+1};
  },
  async recordMetaEvent(email,digest,summary){
   const id=crypto.createHash('sha256').update(email+'|'+digest).digest('hex');
   if(metaEvents.has(id))return {duplicate:true};
   metaEvents.set(id,{id,summary:copy(summary),createdAt:new Date()});
   return {duplicate:false};
  },
  async close(){}
 };
}
async function createMongoStore(uri){
 if(!/^mongodb(\+srv)?:\/\//.test(uri||''))throw Error('CLOUD_MONGODB_URI_INVALID');
 const {MongoClient}=require('mongodb');
 const client=new MongoClient(uri,{appName:'zvm-cloud-pilot',maxPoolSize:5,minPoolSize:0,serverSelectionTimeoutMS:10000});
 await client.connect();
 const db=client.db(DATABASE),grants=db.collection('cloud_dev_grants'),drafts=db.collection('drafts'),workspaces=db.collection('cloud_workspaces'),media=db.collection('cloud_media'),metaEvents=db.collection('cloud_meta_events');
 try{await grants.createIndex({expiresAt:1},{expireAfterSeconds:0});await metaEvents.createIndex({createdAt:1},{expireAfterSeconds:7*24*3600});}
 catch(error){await client.close();throw error;}
 return {
  async grant(sessionId,email,keyHash,expiresAt){
   await grants.replaceOne({_id:sessionId},{_id:sessionId,email,keyHash,expiresAt:new Date(expiresAt)},{upsert:true});
  },
  async getGrant(sessionId){return grants.findOne({_id:sessionId,expiresAt:{$gt:new Date()}});},
  async revokeGrant(sessionId){await grants.deleteOne({_id:sessionId});},
  async getDraft(email){return drafts.findOne({_id:email});},
  async setDraft(email,doc){
   await drafts.replaceOne({_id:email},{_id:email,...doc},{upsert:true});
   return doc;
  },
  async clearDraft(email){await drafts.deleteOne({_id:email});},
  async readWorkspace(email){
   const doc=await workspaces.findOne({_id:workspaceId(email)});
   return doc?{revision:doc.revision,modules:doc.modules,updatedAt:doc.updatedAt}:{revision:0,modules:{},updatedAt:null};
  },
  async writeWorkspace(email,revision,modules){
   const id=workspaceId(email),next={_id:id,revision:revision+1,modules,updatedAt:new Date().toISOString()};
   try {
    if(revision===0){
     await workspaces.insertOne(next);
    } else {
     const result=await workspaces.replaceOne({_id:id,revision},next);
     if(result.matchedCount!==1)return {conflict:true};
    }
    return {conflict:false,revision:next.revision,updatedAt:next.updatedAt};
   }catch(error){
    if(error?.code===11000)return {conflict:true};
    throw error;
   }
  },
  async readMedia(email){
   const doc=await media.findOne({_id:workspaceId(email)});
   return doc?{revision:doc.revision,items:doc.items||[]}:{revision:0,items:[]};
  },
  async writeMedia(email,revision,items){
   const id=workspaceId(email),doc={_id:id,revision:revision+1,items};
   try{
    if(revision===0)await media.insertOne(doc);
    else{
     const changed=await media.replaceOne({_id:id,revision},doc);
     if(changed.matchedCount!==1)return {conflict:true};
    }
    return {conflict:false,revision:doc.revision};
   }catch(error){if(error?.code===11000)return {conflict:true};throw error;}
  },
  async recordMetaEvent(email,digest,summary){
   const id=crypto.createHash('sha256').update(email+'|'+digest).digest('hex');
   try{await metaEvents.insertOne({_id:id,owner:workspaceId(email),summary,createdAt:new Date()});return {duplicate:false};}
   catch(error){if(error?.code===11000)return {duplicate:true};throw error;}
  },
  async close(){await client.close();}
 };
}
module.exports={createMemoryStore,createMongoStore,DATABASE};