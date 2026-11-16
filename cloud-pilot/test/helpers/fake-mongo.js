'use strict';
// Isolated MongoDB adapter for transactional unit tests only. No network or
// database credentials. All R26/R27 fixtures reuse one implementation.
class FakeCollection{
 constructor(name){this.name=name;this.rows=new Map();this.indexes=[];}
 async createIndex(spec,options={}){this.indexes.push({spec,options});return this.name+'_idx';}
 matches(row,query){return Object.entries(query).every(([k,v])=>row[k]===v);}
 async findOne(query){return [...this.rows.values()].find(row=>this.matches(row,query))||null;}
 find(query){
  const rows=[...this.rows.values()].filter(row=>this.matches(row,query));
  return {
   async toArray(){return rows;},
   sort({index=1}){
    return{async *[Symbol.asyncIterator](){
     for(const row of rows.sort((a,b)=>(a.index-b.index)*index))yield row;
    }};
   }
  };
 }
 async insertOne(row){
  if(this.rows.has(row._id)||
     (this.name==='cloud_large_media_uploads'&&
      [...this.rows.values()].some(x=>x.owner===row.owner))){
   const error=Error('duplicate_key');error.code=11000;throw error;
  }
  this.rows.set(row._id,{...row});return {insertedId:row._id};
 }
 async replaceOne(filter,row){
  const existing=await this.findOne(filter);
  if(!existing)return {matchedCount:0};
  this.rows.set(existing._id,{...row});
  return {matchedCount:1};
 }
 async updateOne(query,updates,options={}){
  let row=await this.findOne(query);
  if(!row&&!options.upsert)return {matchedCount:0};
  if(!row){
   row={...query};
   if(this.rows.has(row._id)){const e=Error('duplicate_key');e.code=11000;throw e;}
   this.rows.set(row._id,row);
  }
  this.modify(row,updates);
  return {matchedCount:1};
 }
 modify(row,updates){
  for(const [k,v] of Object.entries(updates.$set||{}))row[k]=v;
  for(const [k,v] of Object.entries(updates.$setOnInsert||{}))if(!(k in row))row[k]=v;
  for(const [k,v] of Object.entries(updates.$inc||{}))row[k]=(row[k]||0)+v;
  for(const k of Object.keys(updates.$unset||{}))delete row[k];
 }
 async updateMany(query,changes){
  let n=0;for(const row of this.rows.values())if(this.matches(row,query)){
   this.modify(row,changes);n++;
  }
  return {matchedCount:n};
 }
 async deleteOne(query){
  const row=await this.findOne(query);if(!row)return {deletedCount:0};
  this.rows.delete(row._id);return {deletedCount:1};
 }
 async deleteMany(query){
  let n=0;
  for(const row of [...this.rows.values()])if(this.matches(row,query)){
   this.rows.delete(row._id);n++;
  }
  return {deletedCount:n};
 }
}
class FakeClient{
 static last=null;
 static shared=null;
 constructor(){
  this.state=FakeClient.shared||{
   collections:new Map(),stats:{transactions:0,closedSessions:0},
   lock:Promise.resolve(),failNext:false
  };
  this.collections=this.state.collections;this.stats=this.state.stats;
  FakeClient.last=this;
 }
 async connect(){return this;}
 db(){return{collection:name=>{
  if(!this.collections.has(name))this.collections.set(name,new FakeCollection(name));
  return this.collections.get(name);
 }};}
 startSession(){
  return {
   withTransaction:async action=>{
    const beforeLock=this.state.lock;let release;
    this.state.lock=new Promise(resolve=>{release=resolve;});
    await beforeLock;
    this.stats.transactions++;
    const snapshot=new Map([...this.collections].map(([key,col])=>
     [key,new Map([...col.rows].map(([id,row])=>[id,structuredClone(row)]))]));
    try{
     await action();
     if(this.state.failNext){
      this.state.failNext=false;
      throw Error('simulated_transaction_abort');
     }
    }catch(error){
     for(const [key,records] of snapshot)this.collections.get(key).rows=records;
     throw error;
    }finally{release();}
   },
   endSession:async()=>{this.stats.closedSessions++;}
  };
 }
 async close(){}
}
function sharedState(){return{
 collections:new Map(),stats:{transactions:0,closedSessions:0},
 lock:Promise.resolve(),failNext:false
};}
module.exports={FakeCollection,FakeClient,sharedState};
