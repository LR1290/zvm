'use strict';
// Cloud R24 — large media storage. Isolated from the legacy 1-MB coffer.
// One active upload per account; unfinished chunks expire automatically.
// Bytes are never exposed without Portal identity, DEV authorization, owner checks.
const crypto=require('node:crypto');
const Media=require('./media-domain');
const D=require('./large-media-domain');
const PART_TTL_MS=3*D.TTL_MS;
function mongoBytes(value){
 if(Buffer.isBuffer(value))return value;
 if(value&&Buffer.isBuffer(value.buffer))return Buffer.from(value.buffer);
 if(value instanceof Uint8Array)return Buffer.from(value.buffer,value.byteOffset,value.byteLength);
 return Buffer.from(value||[]);
}
function compatible(a,b){return a?.sha256===b.sha256&&a?.size===b.size&&a?.mime===b.mime;}
function createMemoryLargeMediaStore(){
 const sessions=new Map(),files=new Map();
 const owner=email=>D.ownerId(email);
 const owned=email=>{const id=owner(email);if(!files.has(id))files.set(id,new Map());return files.get(id);};
 const pending=email=>{
  const id=owner(email),s=sessions.get(id);
  if(s&&new Date(s.expiresAt).getTime()<=Date.now()){sessions.delete(id);return null;}
  return s||null;
 };
 async function begin(email,input,legacyBytes=0,legacyCount=0){
  const spec=D.specOf(input),records=owned(email);
  const match=records.get(spec.id);
  if(match){
   if(!compatible(match,spec))D.fail('media_id_collision');
   return {duplicate:true,file:D.publicFile(match),upload:null};
  }
  const current=pending(email);
  if(current){
   if(!compatible(current,spec)||current.name!==spec.name)D.fail('upload_already_active');
   return {duplicate:false,resumed:true,upload:D.publicUpload(current)};
  }
  if(records.size+legacyCount>=D.MAX_ITEMS)D.fail('media_item_quota');
  const used=[...records.values()].reduce((n,x)=>n+x.size,0);
  if(used+spec.size+Math.max(0,legacyBytes)>D.MAX_ACCOUNT)D.fail('media_storage_quota');
  const id=crypto.randomBytes(16).toString('hex');
  const session={...spec,uploadId:id,owner:owner(email),nextIndex:0,receivedBytes:0,
   expiresAt:new Date(Date.now()+D.TTL_MS).toISOString(),parts:[]};
  sessions.set(owner(email),session);
  return {duplicate:false,resumed:false,upload:D.publicUpload(session)};
 }
 async function status(email){return D.publicUpload(pending(email));}
 async function append(email,id,index,bytes,hash){
  const s=pending(email);
  if(!s||s.uploadId!==id)D.fail('upload_not_found');
  D.validateChunk(s,index,bytes,hash);
  if(index>s.nextIndex)D.fail('chunk_out_of_order');
  if(index<s.nextIndex){
   if(!s.parts[index]||D.sha(s.parts[index])!==D.sha(bytes))D.fail('chunk_conflict');
   return D.publicUpload(s);
  }
  s.parts[index]=Buffer.from(bytes);
  s.nextIndex++;s.receivedBytes+=bytes.length;
  return D.publicUpload(s);
 }
 async function finish(email,id){
  const s=pending(email);
  if(!s||s.uploadId!==id)D.fail('upload_not_found');
  if(s.nextIndex!==s.chunks||s.receivedBytes!==s.size)D.fail('upload_incomplete');
  D.validateWhole(s,s.parts);
  const records=owned(email);
  const previous=records.get(s.id);
  const duplicate=!!previous;
  if(previous&&!compatible(previous,s))D.fail('media_id_collision');
  if(!duplicate){
   const record={id:s.id,name:s.name,mime:s.mime,size:s.size,sha256:s.sha256,
    uploadedAt:new Date().toISOString(),uploadId:s.uploadId,parts:s.parts.map(x=>Buffer.from(x))};
   records.set(record.id,record);
  }
  sessions.delete(owner(email));
  return {duplicate,file:D.publicFile(records.get(s.id))};
 }
 async function list(email){return [...owned(email).values()].map(D.publicFile);}
 async function get(email,id){return owned(email).get(id)||null;}
 async function* chunks(email,id){
  const file=owned(email).get(id);
  if(!file)return;
  for(const bytes of file.parts)yield Buffer.from(bytes);
 }
 async function remove(email,id){
  const records=owned(email),existing=records.get(id);
  if(!existing)D.fail('media_not_found');
  records.delete(id);
  return true;
 }
 async function cancel(email,id){
  const s=pending(email);if(!s||s.uploadId!==id)D.fail('upload_not_found');
  sessions.delete(owner(email));return true;
 }
 return {begin,status,append,finish,list,get,chunks,remove,cancel,async close(){}};
}
async function createMongoLargeMediaStore(db,client){
 if(!client||typeof client.startSession!=='function')throw Error('cloud_large_media_transactions_required');
 const uploads=db.collection('cloud_large_media_uploads');
 const chunks=db.collection('cloud_large_media_chunks');
 const files=db.collection('cloud_large_media_files');
 await Promise.all([
  uploads.createIndex({owner:1},{unique:true}),
  uploads.createIndex({expiresAt:1},{expireAfterSeconds:0}),
  chunks.createIndex({uploadId:1,index:1},{unique:true}),
  chunks.createIndex({expiresAt:1},{expireAfterSeconds:0}),
  files.createIndex({owner:1})
 ]);
 const owned=email=>D.ownerId(email);
 const fileKey=(owner,id)=>owner+':'+id;
 const upload=async(email,id=null)=>{
  const owner=owned(email),s=await uploads.findOne(id?{_id:id,owner}:{owner});
  if(!s)return null;
  if(new Date(s.expiresAt).getTime()>Date.now())return s;
  await uploads.deleteOne({_id:s._id,owner});
  // Parts are kept under the 72-hour TTL until background cleanup.
  return null;
 };
 const fileOf=async(email,id)=>{
  const owner=owned(email);
  return files.findOne({_id:fileKey(owner,id),owner,status:'ready'});
 };
 const list=async(email)=>{
  const owner=owned(email),rows=await files.find({owner,status:'ready'}).toArray();
  return rows.map(D.publicFile);
 };
 async function begin(email,input,legacyBytes=0,legacyCount=0){
  const spec=D.specOf(input),owner=owned(email);
  const already=await fileOf(email,spec.id);
  if(already){
   if(!compatible(already,spec))D.fail('media_id_collision');
   return {duplicate:true,file:D.publicFile(already),upload:null};
  }
  const active=await upload(email);
  if(active){
   if(!compatible(active,spec)||active.name!==spec.name)D.fail('upload_already_active');
   return {duplicate:false,resumed:true,upload:D.publicUpload(active)};
  }
  const ready=await list(email);
  if(ready.length+legacyCount>=D.MAX_ITEMS)D.fail('media_item_quota');
  const occupied=ready.reduce((n,f)=>n+f.size,0)+Math.max(0,legacyBytes);
  if(occupied+spec.size>D.MAX_ACCOUNT)D.fail('media_storage_quota');
  const id=crypto.randomBytes(16).toString('hex');
  const doc={_id:id,owner,status:'pending',...spec,nextIndex:0,receivedBytes:0,
   expiresAt:new Date(Date.now()+D.TTL_MS)};
  try{await uploads.insertOne(doc);}
  catch(e){
   if(e?.code!==11000)throw e;
   const other=await upload(email);
   if(other&&compatible(other,spec)&&other.name===spec.name)
    return {duplicate:false,resumed:true,upload:D.publicUpload({...other,id:other._id})};
   D.fail('upload_already_active');
  }
  return {duplicate:false,resumed:false,upload:D.publicUpload({...doc,id})};
 }
 async function status(email){
  const s=await upload(email);
  return s?D.publicUpload({...s,id:s._id}):null;
 }
 async function append(email,id,index,bytes,hash){
  const owner=owned(email),s=await upload(email,id);
  if(!s||s.status!=='pending')D.fail('upload_not_found');
  D.validateChunk(s,index,bytes,hash);
  const key=id+':'+index,part=await chunks.findOne({_id:key,owner});
  if(part){
   if(part.sha256!==D.sha(bytes)||mongoBytes(part.bytes).length!==bytes.length)D.fail('chunk_conflict');
  }else{
   if(index!==s.nextIndex)D.fail('chunk_out_of_order');
   try{await chunks.insertOne({_id:key,owner,uploadId:id,index,bytes,sha256:D.sha(bytes),
    expiresAt:new Date(Date.now()+PART_TTL_MS)});}
   catch(e){
    if(e?.code!==11000)throw e;
    const other=await chunks.findOne({_id:key,owner});
    if(!other||other.sha256!==D.sha(bytes))D.fail('chunk_conflict');
   }
  }
  // Crash after insertion but before CAS is recovered by retrying this chunk.
  const changed=await uploads.updateOne({_id:id,owner,status:'pending',nextIndex:index},
   {$set:{nextIndex:index+1,receivedBytes:index*D.CHUNK_BYTES+bytes.length}});
  if(changed.matchedCount!==1){
   const latest=await upload(email,id);
   if(!latest||latest.nextIndex<index+1)D.fail('chunk_out_of_order');
   return D.publicUpload({...latest,id:latest._id});
  }
  return D.publicUpload({...s,id,nextIndex:index+1,receivedBytes:index*D.CHUNK_BYTES+bytes.length});
 }
 async function finish(email,id){
  const owner=owned(email),s=await upload(email,id);
  if(!s||!['pending','finalizing'].includes(s.status))D.fail('upload_not_found');
  if(s.nextIndex!==s.chunks||s.receivedBytes!==s.size)D.fail('upload_incomplete');
  // A claimed session cannot receive new chunks while final integrity is checked.
  if(s.status==='pending'){
   const claimed=await uploads.updateOne({_id:id,owner,status:'pending',nextIndex:s.chunks},{$set:{status:'finalizing'}});
   if(claimed.matchedCount!==1)D.fail('upload_in_progress');
  }
  let verified=false;
  try{
   const hash=crypto.createHash('sha256');
   let first=null,received=0,count=0;
   for await(const part of chunks.find({owner,uploadId:id}).sort({index:1})){
    if(part.index!==count)D.fail('large_media_corrupt_chunk');
    const bytes=mongoBytes(part.bytes);
    D.validateChunk(s,count,bytes,part.sha256);
    if(!first)first=bytes.subarray(0,32);
    received+=bytes.length;hash.update(bytes);count++;
   }
   if(count!==s.chunks||received!==s.size||hash.digest('hex')!==s.sha256)D.fail('large_media_digest_mismatch');
   if(!Media.mimeDetected(first,s.mime))D.fail('media_signature_invalid');
   verified=true;
  }finally{
   if(!verified)await uploads.updateOne({_id:id,owner,status:'finalizing'},{$set:{status:'pending'}});
  }
  const key=fileKey(owner,s.id),prior=await fileOf(email,s.id);
  if(prior){
   if(!compatible(prior,s))D.fail('media_id_collision');
   const session=client.startSession();
   try{
    await session.withTransaction(async()=>{
     await chunks.deleteMany({owner,uploadId:id},{session});
     await uploads.deleteOne({_id:id,owner,status:'finalizing'},{session});
    });
   }finally{await session.endSession();}
   return {duplicate:true,file:D.publicFile(prior)};
  }
  const doc={_id:key,owner,id:s.id,name:s.name,mime:s.mime,size:s.size,
   sha256:s.sha256,uploadId:id,uploadedAt:new Date().toISOString(),status:'ready'};
  // Commit metadata, lifetime extension and temporary-session cleanup atomically.
  // If the process dies, the transaction rolls back and a retry can finish.
  const session=client.startSession();
  try{
   await session.withTransaction(async()=>{
    await files.insertOne(doc,{session});
    await chunks.updateMany({owner,uploadId:id},{$unset:{expiresAt:''}},{session});
    await uploads.deleteOne({_id:id,owner,status:'finalizing'},{session});
   });
  }finally{await session.endSession();}
  return {duplicate:false,file:D.publicFile(doc)};
 }
 async function get(email,id){return fileOf(email,id);}
 async function* readChunks(email,id){
  const row=await fileOf(email,id);if(!row)return;
  const owner=owned(email);for await(const part of chunks.find({owner,uploadId:row.uploadId}).sort({index:1})){
   yield mongoBytes(part.bytes);
  }
 }
 async function remove(email,id){
  const owner=owned(email),key=fileKey(owner,id),row=await fileOf(email,id);
  if(!row)D.fail('media_not_found');
  const session=client.startSession();
  try{
   await session.withTransaction(async()=>{
    const deleted=await files.deleteOne({_id:key,owner,status:'ready'},{session});
    if(deleted.deletedCount!==1)D.fail('media_not_found');
    await chunks.deleteMany({owner,uploadId:row.uploadId},{session});
   });
  }finally{await session.endSession();}
  return true;
 }
 async function cancel(email,id){
  const owner=owned(email),s=await upload(email,id);
  if(!s)D.fail('upload_not_found');
  if(s.status==='finalizing')D.fail('upload_finalizing');
  const session=client.startSession();
  try{
   await session.withTransaction(async()=>{
    await uploads.deleteOne({_id:id,owner},{session});
    await chunks.deleteMany({owner,uploadId:id},{session});
   });
  }finally{await session.endSession();}
  return true;
 }
 return {begin,status,append,finish,list,get,chunks:readChunks,remove,cancel,async close(){}};
}
module.exports={createMemoryLargeMediaStore,createMongoLargeMediaStore};
