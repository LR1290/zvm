'use strict';
// R47.08 - pure QA fixtures. No production requests, credentials or MongoDB writes.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'server.js'),'utf8');
const jsName='zvm-admin-dashboard.bc01cf565fa7.js',cssName='zvm-admin-dashboard.cd85ea19cc73.css';
const js=fs.readFileSync(path.join(root,'assets',jsName),'utf8');
const css=fs.readFileSync(path.join(root,'assets',cssName),'utf8');
for(const name of [jsName,cssName]){
 const digest=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'assets',name))).digest('hex');
 assert(name.includes(digest.slice(0,12)),'immutable filename must contain content digest');
 assert(source.includes("sha256: '"+digest+"'"),'asset allowlist pins full SHA-256');
}
new vm.Script(js,{filename:jsName});
assert(source.includes('href="/assets/zvm-owner-site.42d17a62234b.css"'));
assert(source.includes('class="key-actions-popover" popover="auto"'));
assert(!source.includes('class="key-actions-more"'));
assert(source.includes('id="renewPreview"'));
assert(source.includes('<option value="remove">Remover tempo</option>'));
assert(source.includes('id="renewDays" placeholder="0"'));
assert(css.includes('.key-actions-popover:popover-open'));
assert(css.includes('.keys-table .key-actions-cell .acts'));
assert(css.includes('@media(max-width:750px)'));
assert(css.includes('.keys-table tbody tr.key-record.key-expanded'));
assert(!css.slice(css.indexOf('/* R47.08')).replace(/\/\*[\s\S]*?\*\//g,'').includes('!important'),'no CSS !important rules in new layer');

const inputs={renewDays:'-300',renewHours:'0',renewMins:'0',renewMode:'add'};
const mockDocument={getElementById(id){return {value:inputs[id]||''}}};
const inputStart=js.indexOf('function adminRenewInput(){'),inputEnd=js.indexOf('function updateRenewPreview(){',inputStart);
assert(inputStart>0&&inputEnd>inputStart);
const parseInput=new Function('document',js.slice(inputStart,inputEnd)+'return adminRenewInput;')(mockDocument);
let value=parseInput();assert.equal(value.ok,true);assert.equal(value.direction,'remove');
assert.equal(value.days,300);assert.equal(value.minutes,300*1440);
inputs.renewDays='300';inputs.renewMode='remove';value=parseInput();
assert.equal(value.ok,true);assert.equal(value.direction,'remove');
inputs.renewMode='add';inputs.renewDays='300';value=parseInput();
assert.equal(value.direction,'add');
inputs.renewHours='-1';assert.equal(parseInput().ok,false,'reject mixed signs');
inputs.renewDays='0';inputs.renewHours='0';assert.equal(parseInput().ok,false,'reject zero duration');

const begin=source.indexOf('async function renewAdminKeyAtomicStrict(');
const end=source.indexOf('async function mutateAdminKeyRecordStrict(',begin);
assert(begin>0&&end>begin,'atomic implementation boundary');
const atomic=source.slice(begin,end),_days=86400000;
const now=Date.now(),expiresAt=now+342*_days;
const record={label:'licença QA',active:false,expiresAt:new Date(expiresAt).toISOString(),expireDuration:null,lastAdminRenewalOperationId:null};
const keys={};let writes=0;
const db={collection(name){
 assert.equal(name,'store');
 return {async findOneAndUpdate(filter,pipeline){
   const field='data.qa',last=field+'.lastAdminRenewalOperationId';
   assert.equal(filter._id,'keys');
   if(filter[last] && filter[last].$ne===record.lastAdminRenewalOperationId)return null;
   const update=pipeline[0].$set;
   const amount=update[field+'.expiresAt'].$dateToString.date.$dateAdd.amount;
   if(amount<0){
     assert(filter.$expr,'subtraction must be conditional at the MongoDB write');
     assert(!Object.hasOwn(update,field+'.active'),'subtraction must not reactivate blocked licenses');
     if(Date.parse(record.expiresAt)<=Date.now()+Math.abs(amount)+60000)return null;
   }
   const current=Date.parse(record.expiresAt),base=amount<0?current:Math.max(Date.now(),current);
   record.expiresAt=new Date(base+amount).toISOString();
   record.lastAdminRenewalOperationId=update[last];
   if(Object.hasOwn(update,field+'.active'))record.active=update[field+'.active'];
   writes++;
   return {data:{qa:{...record}}};
 }};
}};
const deps={
 getMongoDb:async()=>db,readAdminKeySnapshot:async()=>({...record}),
 cloneKeyRecordForCommit:r=>({...r}),keys,
 invalidateKeysHtmlCache(){},zvmInvalidateMongoOnNetworkError(){}
};
const subtract=new Function('deps','with(deps){'+atomic+';return renewAdminKeyAtomicStrict;}')(deps);
(async()=>{
 const op='r4708subtract300qa';
 const first=await subtract('qa',-300*1440,{db,operationId:op});
 assert.equal(first.replayed,false);assert.equal(writes,1);
 assert.equal(record.active,false,'blocked key remains blocked');
 const remaining=(Date.parse(record.expiresAt)-now)/_days;
 assert(Math.abs(remaining-42)<.01,'300 days removed from 342');
 const retry=await subtract('qa',-300*1440,{db,operationId:op});
 assert.equal(retry.replayed,true);assert.equal(writes,1,'replaying must never subtract again');
 const over=await subtract('qa',-50*1440,{db,operationId:'r4708subtract50qa'});
 assert.equal(over,null);assert.equal(writes,1,'cannot deduct beyond remaining time');
 const added=await subtract('qa',2*1440,{db,operationId:'r4708add2daysqa'});
 assert.equal(added.replayed,false);assert.equal(writes,2);
 assert.equal(record.active,true,'existing positive renewal behavior preserved');
 console.log('R47.08 PASS: owner styling, compact popover, signed UI, 300-day subtraction, replay and expiry threshold');
})().catch(e=>{console.error(e);process.exitCode=1});
