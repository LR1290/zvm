const assert=require('node:assert/strict'),{test}=require('node:test');
const {freeDevAccess}=require('./qa-free.cjs');
const db={databaseName:'zvm_completa_qa_r103'},subject='a'.repeat(64);
const env={MONGODB_DB:db.databaseName,ZVM_QA_FREE_SUBJECT:subject,ZVM_QA_ATLAS_HOST:'qa.example.mongodb.net',MONGODB_URI:'mongodb+srv://zvm_completa_qa_runner:fixture@qa.example.mongodb.net/zvm_completa_qa_r103'};
test('only designated verified QA Free account qualifies',()=>{
  assert.equal(freeDevAccess({verified:true},db,subject,env),true);
  for(const args of [[{verified:false},db,subject,env],[{verified:true,keyCode:'existing'},db,subject,env],[{verified:true},db,'b'.repeat(64),env],[{verified:true},{databaseName:'zapvoice'},subject,env],[{verified:true},db,subject,{...env,ZVM_QA_ATLAS_HOST:'other.example.mongodb.net'}]])
    assert.equal(freeDevAccess(...args),false);
});
