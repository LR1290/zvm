'use strict';
// Cloud pilot data only. Never access the ZVM Desktop/license database with this connection.
const DATABASE='zvm_cloud_pilot';
const copy=x=>x==null?null:JSON.parse(JSON.stringify(x));
const expMs=v=>new Date(v).getTime();
function createMemoryStore(){
 const grants=new Map(),drafts=new Map();
 return {
  async grant(sessionId,email,keyHash,expiresAt){grants.set(sessionId,{email,keyHash,expiresAt:new Date(expiresAt).toISOString()});},
  async getGrant(sessionId){const g=grants.get(sessionId);if(!g||!(expMs(g.expiresAt)>Date.now())){grants.delete(sessionId);return null;}return copy(g);},
  async revokeGrant(sessionId){grants.delete(sessionId);},
  async getDraft(email){return copy(drafts.get(email));},
  async setDraft(email,doc){drafts.set(email,copy(doc));return copy(doc);},
  async clearDraft(email){drafts.delete(email);},
  async close(){}
 };
}
async function createMongoStore(uri){
 if(!/^mongodb(\+srv)?:\/\//.test(uri||''))throw Error('CLOUD_MONGODB_URI_INVALID');
 const {MongoClient}=require('mongodb');
 const client=new MongoClient(uri,{appName:'zvm-cloud-pilot',maxPoolSize:5,minPoolSize:0,serverSelectionTimeoutMS:10000});
 await client.connect();
 const db=client.db(DATABASE),grants=db.collection('cloud_dev_grants'),drafts=db.collection('drafts');
 try{await grants.createIndex({expiresAt:1},{expireAfterSeconds:0});}
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
  async close(){await client.close();}
 };
}
module.exports={createMemoryStore,createMongoStore,DATABASE};