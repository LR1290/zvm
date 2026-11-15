'use strict';
// Isolated pilot persistence. Collection names and database are fixed to avoid touching Desktop data.
const DATABASE = 'zvm_cloud_pilot';
function clone(value) {return value == null ? null : JSON.parse(JSON.stringify(value));}
function createMemoryStore(){
 const users=new Map(), sessions=new Map(), drafts=new Map();
 return {
  async user(){return clone(users.get('guest'));},
  async setUser(user){const previous=users.get('guest');if(previous&&previous.email!==user.email)drafts.delete('guest');users.set('guest',clone(user));sessions.forEach((s,key)=>{if(s.subject==='guest')sessions.delete(key);});return true;},
  async revokeUser(){users.delete('guest');drafts.delete('guest');sessions.forEach((s,key)=>{if(s.subject==='guest')sessions.delete(key);});},
  async newSession(id,data){sessions.set(id,clone(data));},
  async session(id){const s=sessions.get(id);if(s&&s.expiresAt>Date.now())return clone(s);sessions.delete(id);return null;},
  async endSession(id){sessions.delete(id);},
  async draft(){return clone(drafts.get('guest'));},
  async setDraft(doc){drafts.set('guest',clone(doc));return clone(doc);},
  async clearDraft(){drafts.delete('guest');},
  async close(){}
 };
}
async function createMongoStore(uri){
 if(!/^mongodb(\+srv)?:\/\//.test(uri||''))throw Error('CLOUD_MONGODB_URI invalid');
 const {MongoClient}=require('mongodb');
 const client=new MongoClient(uri,{maxPoolSize:5,minPoolSize:0,serverSelectionTimeoutMS:10000,appName:'zvm-cloud-pilot'});
 await client.connect();
 const db=client.db(DATABASE);
 const users=db.collection('users'),sessions=db.collection('sessions'),drafts=db.collection('drafts');
 try{
  await sessions.createIndex({expiresAt:1},{expireAfterSeconds:0});
 }catch(error){await client.close();throw error;}
 return {
  async user(){return users.findOne({_id:'guest'});},
  async setUser(user){
   const previous=await users.findOne({_id:'guest'});
   if(previous&&previous.email!==user.email)await drafts.deleteOne({_id:'guest'});
   await users.replaceOne({_id:'guest'},Object.assign({_id:'guest'},user),{upsert:true});
   await sessions.deleteMany({subject:'guest'});
   return true;
  },
  async revokeUser(){await users.deleteOne({_id:'guest'});await sessions.deleteMany({subject:'guest'});await drafts.deleteOne({_id:'guest'});},
  async newSession(id,data){await sessions.insertOne(Object.assign({_id:id},data,{expiresAt:new Date(data.expiresAt)}));},
  async session(id){const s=await sessions.findOne({_id:id,expiresAt:{$gt:new Date()}});return s;},
  async endSession(id){await sessions.deleteOne({_id:id});},
  async draft(){return drafts.findOne({_id:'guest'});},
  async setDraft(doc){await drafts.replaceOne({_id:'guest'},Object.assign({_id:'guest'},doc),{upsert:true});return doc;},
  async clearDraft(){await drafts.deleteOne({_id:'guest'});},
  async close(){await client.close();}
 };
}
module.exports={createMemoryStore,createMongoStore,DATABASE};
