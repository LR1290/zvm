// Used only by the separate QA overlay. Identity comes from the authenticated account.
function freeDevAccess(user, db, subject, env=process.env){
  const name='zvm_completa_qa_r103';
  if(db?.databaseName!==name || env.MONGODB_DB!==name || user?.verified!==true || user.keyCode)return false;
  if(!/^[a-f0-9]{64}$/.test(subject||'') || subject!==env.ZVM_QA_FREE_SUBJECT)return false;
  try{
    const uri=new URL(env.MONGODB_URI);
    return uri.protocol==='mongodb+srv:' && uri.hostname===env.ZVM_QA_ATLAS_HOST &&
      uri.username==='zvm_completa_qa_runner' && uri.pathname==='/'+name && !uri.search && !uri.hash;
  }catch{return false;}
}
module.exports={freeDevAccess};
