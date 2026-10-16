'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
function region(start,end){const a=src.indexOf(start),b=src.indexOf(end,a+start.length);assert(a>=0&&b>a,'region '+start);return src.slice(a,b);}
const helper=region('async function renewAdminKeyAtomicStrict(', '\nasync function mutateAdminKeyRecordStrict(');
const route=region('  const codeRenew = extractCode(', '  const codeMaxUses = extractCode(');
const ui=fs.readFileSync(path.join(__dirname,'..','assets','zvm-admin-dashboard.3bcd52923d5c.js'),'utf8');
function create(existing,{failNetwork=false,concurrent}={}){
  let record=JSON.parse(JSON.stringify(existing)),calls=0,now=Date.parse('2026-10-16T12:00:00.000Z');
  const db={collection(n){assert.equal(n,'store');return {
    async findOneAndUpdate(filter,update,options){
      calls++;
      assert.equal(options.returnDocument,'after');assert.equal(options.maxTimeMS,7000);
      assert.equal(options.projection['data.license'],1);
      if(failNetwork){record.expiresAt='2026-11-18T12:00:00.000Z';throw Error('unknown network result');}
      if(concurrent)Object.assign(record,concurrent);
      if(!record || record.lastAdminRenewalOperationId===filter['data.license.lastAdminRenewalOperationId']?.$ne)return null;
      assert.equal(filter._id,'keys');assert.equal(filter['data.license'].$type,'object');
      assert(Array.isArray(update)&&update.length===1,'must update by one atomic pipeline');
      const x=update[0].$set;
      assert.deepEqual(Object.keys(x).filter(y=>y.startsWith('data.license.')).sort(),
        ['active','expireDuration','expiresAt','lastAdminRenewalOperationId','warnEmailSent'].map(y=>'data.license.'+y).sort());
      assert.equal(x['data.license.expiresAt'].$dateToString.date.$dateAdd.startDate.$max[0],'$$NOW');
      const ms=x['data.license.expiresAt'].$dateToString.date.$dateAdd.amount;
      const base=Math.max(now,Date.parse(record.expiresAt||'')||now);
      record.expiresAt=new Date(base+ms).toISOString();
      record.active=true;record.expireDuration=null;record.warnEmailSent=false;
      if(x['data.license.lastAdminRenewalOperationId'])record.lastAdminRenewalOperationId=x['data.license.lastAdminRenewalOperationId'];
      return {data:{license:JSON.parse(JSON.stringify(record))}};
    }
  }}};
  return {db,get record(){return record},get calls(){return calls}};
}
async function run(){
  const cache={},updated=[];
  const fn=new Function('getMongoDb','zvmInvalidateMongoOnNetworkError','readAdminKeySnapshot','cloneKeyRecordForCommit','keys','invalidateKeysHtmlCache',
    helper+'\nreturn renewAdminKeyAtomicStrict;')(
    async()=>{throw Error('explicit db required')},()=>true,
    async(_,deps)=>deps.db.__current?.()||null,
    x=>JSON.parse(JSON.stringify(x)),cache,()=>updated.push(1));
  const initial={label:'Atendimento Pós',expiresAt:'2026-10-18T17:14:03.000Z',active:false,planId:'pro',usage:{sent:3},phones:['deviceA']};
  const x=create(initial,{concurrent:{usage:{sent:999},phones:['deviceA','deviceB']}});
  x.db.__current=()=>({...x.record});
  const uuid='r46-87-synthetic-0001';
  const done=await fn('license',31*1440,{db:x.db,operationId:uuid});
  assert.equal(done.replayed,false);
  assert.equal(done.record.expiresAt,'2026-11-18T17:14:03.000Z');
  assert.equal(x.record.usage.sent,999);assert.equal(x.record.phones.length,2);
  assert.equal(x.record.planId,'pro');assert.equal(x.calls,1);assert.equal(updated.length,1);
  const replay=await fn('license',31*1440,{db:x.db,operationId:uuid});
  assert.equal(replay.replayed,true);assert.equal(replay.record.expiresAt,done.record.expiresAt);assert.equal(x.calls,2);
  const nr=create({...initial,expiresAt:null});
  const current=await fn('license',1440,{db:nr.db,operationId:'r46-87-synthetic-0002'});
  assert.equal(current.record.expiresAt,'2026-10-17T12:00:00.000Z');
  const unknown=create(initial,{failNetwork:true});
  await assert.rejects(fn('license',1440,{db:unknown.db,operationId:'r46-87-synthetic-0003'}),/unknown network result/);
  assert.equal(unknown.calls,1,'unknown result must not retry');
  assert.match(route,/renewAdminKeyAtomicStrict\(codeRenew, totalMinutes/);
  assert.doesNotMatch(route,/mutateAdminKeyRecordStrict\(codeRenew/);
  assert.match(ui,/operationId:_renewOperationId/);
  assert.match(ui,/_renewInFlight=true/);
  console.log('R46.87 PASS: atomic renewal, concurrent activity, replay, unknown write and admin UI');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
