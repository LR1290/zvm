'use strict';
// R46.44 STAGING ONLY: wired to Portal and Cakto on this candidate branch.
// Do not deploy until the unique-index migration and email transfer pass real Mongo staging.
// portal_users.keyCode stays the sole ownership authority (no second ledger).
const FILTER=Object.freeze({keyCode:{$type:'string',$gt:''}});
const invalid=(code)=>Object.assign(new Error(code),{code});
const email=x=>String(x||'').trim().toLowerCase();
const validCode=x=>typeof x==='string'&&/^[a-z0-9_-]{1,30}$/.test(x);
function coversAllBoundLicenses(filter){
  if(!filter || typeof filter!=='object'||Array.isArray(filter))return false;
  const clauses=Object.keys(filter).length===1 && Array.isArray(filter.$and)?filter.$and:[filter];
  if(clauses.length<1||clauses.length>2)return false;
  const ops={};
  for(const clause of clauses){
    if(!clause||typeof clause!=='object'||Array.isArray(clause)||Object.keys(clause).length!==1||!Object.hasOwn(clause,'keyCode'))return false;
    const predicate=clause.keyCode;
    if(!predicate||typeof predicate!=='object'||Array.isArray(predicate))return false;
    for(const [key,value] of Object.entries(predicate)){
      if(!['$gt','$type'].includes(key)||Object.hasOwn(ops,key))return false;
      ops[key]=value;
    }
  }
  return Object.keys(ops).length===2&&ops.$gt===''&&ops.$type==='string';
}
function isOwnershipIndex(index){
 return Boolean(index?.unique===true&&index.key?.keyCode===1&&Object.keys(index.key).length===1&&
 (!index.collation||index.collation.locale==='simple')&&coversAllBoundLicenses(index.partialFilterExpression));
}
async function requireOwnershipIndex(db){
 if(!db||typeof db.collection!=='function')throw invalid('ownership_db_unavailable');
 const indexes=await db.collection('portal_users').listIndexes().toArray();
 if(!indexes.some(isOwnershipIndex))throw invalid('ownership_index_not_ready');
 return true;
}
function duplicate(e,code){if(Number(e?.code)!==11000)throw e;throw invalid(code);}
async function register(db,doc,deps={}){
 if(!doc?._id||doc._id!==email(doc._id))throw invalid('invalid_account');
 const code=doc.keyCode;
 if(code!==undefined&&code!==null&&code!==''&&!validCode(code))throw invalid('invalid_license');
 if(validCode(code))await (deps.requireIndex||requireOwnershipIndex)(db);
 try{await db.collection('portal_users').insertOne(doc);}catch(e){duplicate(e,'account_or_license_already_used');}
 return {ok:true,email:doc._id};
}
async function bind(db,source,code,deps={}){
 const id=email(source);
 if(!id||!validCode(code))throw invalid('invalid_binding');
 await (deps.requireIndex||requireOwnershipIndex)(db);
 let result;
 try{result=await db.collection('portal_users').updateOne(
 {_id:id,emailChangeOp:{$exists:false}},{$set:{keyCode:code}}
 );}catch(e){duplicate(e,'license_already_linked');}
 if(result?.matchedCount!==1)throw invalid('account_unavailable');
 return {ok:true,email:id,keyCode:code};
}
async function unbind(db,source,code,deps={}){
 const id=email(source);
 if(!id||!validCode(code))throw invalid('invalid_binding');
 await (deps.requireIndex||requireOwnershipIndex)(db);
 const r=await db.collection('portal_users').updateOne(
 {_id:id,keyCode:code,emailChangeOp:{$exists:false}},{$unset:{keyCode:''}});
 if(r?.matchedCount!==1)throw invalid('binding_changed');
 return {ok:true};
}
async function transferEmail(db,session,source,target,prepare,deps={}){
 const from=email(source),to=email(target);
 if(!from||!to||from===to||typeof prepare!=='function')throw invalid('invalid_email_move');
 await (deps.requireIndex||requireOwnershipIndex)(db);
 if(!session||typeof session.withTransaction!=='function')throw invalid('transactions_required');
 let committed=false;
 await session.withTransaction(async()=>{
  const coll=db.collection('portal_users');
  const previous=await coll.findOne({_id:from},{session});
  if(!previous)throw invalid('source_not_found');
  if(previous.emailChangeOp)throw invalid('email_move_in_progress');
  const next=prepare(previous,to);
  if(!next||next._id!==to||next.email!==to||next.keyCode!==previous.keyCode)throw invalid('unsafe_email_move');
  const removed=await coll.deleteOne({_id:from,emailChangeOp:{$exists:false}},{session});
  if(removed?.deletedCount!==1)throw invalid('email_move_race');
  try{await coll.insertOne(next,{session});}catch(e){duplicate(e,'target_email_or_license_conflict');}
  committed=true;
 });
 if(!committed)throw invalid('transaction_not_committed');
 return {ok:true,email:to};
}
module.exports={FILTER,coversAllBoundLicenses,isOwnershipIndex,requireOwnershipIndex,register,bind,unbind,transferEmail};
