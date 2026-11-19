const {test}=require('node:test'),assert=require('node:assert/strict');
const {mongoQa}=require('./mongo-qa.cjs');
const host='dedicated.example.mongodb.net';
const base={ZVM_QA_ATLAS_HOST:host,ZVM_QA_MONGODB_URI:'mongodb+srv://zvm_completa_qa_runner:fixture@'+host+'/zvm_completa_qa_r103'};
test('accept dedicated fixture',()=>assert.equal(mongoQa(base).MONGODB_DB,'zvm_completa_qa_r103'));
for(const uri of [undefined,base.ZVM_QA_MONGODB_URI.replace('dedicated','shared'),base.ZVM_QA_MONGODB_URI.replace('qa_r103','production'),base.ZVM_QA_MONGODB_URI+'?tls=false'])
  test('reject outside QA '+String(uri).slice(-15),()=>assert.throws(()=>mongoQa({...base,ZVM_QA_MONGODB_URI:uri})));
