'use strict';
// Isolated HTTP fixture. Fictitious accounts/numbers only; no real Mongo or Render.
const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const { once } = require('node:events');
process.env.RENDER = 'true';
process.env.ADMIN_USER = 'r46-test';
process.env.ADMIN_PASS = 'r46-test-pass';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/zvm_r46_fixture';
const KEY_A = 'r46keya';
const KEY_B = 'r46keyb';
const PHONE_A1 = '5511999990001';
const PHONE_A2 = '5511999990002';
const PHONE_B = '5521999990003';
const emailA = 'alpha@example.invalid';
const emailB = 'beta@example.invalid';
const dbData = { keys: {
  [KEY_A]: { active:true, planId:'ZV_PRO', phones:[PHONE_A1, PHONE_A2], uses:2, maxUses:3, expiresAt:'2035-01-01T00:00:00.000Z', activations:[] },
  [KEY_B]: { active:true, planId:'ZV_PRO', phones:[PHONE_B], uses:1, maxUses:3, expiresAt:'2035-01-01T00:00:00.000Z', activations:[] }
}, users: {
  [emailA]: {_id:emailA, email:emailA, name:'Alpha', keyCode:KEY_A},
  [emailB]: {_id:emailB, email:emailB, name:'Beta', keyCode:KEY_B},
}};
const clone = x=> structuredClone(x);
let casWrites=0;
let readBarrier=null;
const db={
 async command(){return {ok:1}},
 collection(collection){
  if(collection==='portal_users')return {
    async findOne(filter){return clone(dbData.users[filter._id]||null)},
  };
  if(collection==='store')return {
    async findOne(filter, opts){
      assert.equal(filter._id,'keys');
      if(opts?.projection){
        const field = Object.keys(opts.projection).find(x=>x.startsWith('data.'));
        if(field){
          const key=field.slice(5);
          const snapshot=clone(dbData.keys[key]||null);
          if(readBarrier)await readBarrier.wait();
          return {data: snapshot?{[key]:snapshot}:{}};
        }
      }
      return {data:clone(dbData.keys)};
    },
    async updateOne(filter, update){
      const field = Object.keys(update.$set||{}).find(x=>x.startsWith('data.'));
      assert.ok(field);
      const key=field.slice(5);
      casWrites++;
      assert.ok(Object.hasOwn(filter, field), 'CAS requires previously-read record');
      if(JSON.stringify(filter[field])!==JSON.stringify(dbData.keys[key]))return {matchedCount:0,modifiedCount:0};
      dbData.keys[key]=clone(update.$set[field]);
      return {matchedCount:1,modifiedCount:1};
    }
  };
  throw Error(`Unexpected collection: ${collection}`);
 },
};
const originalLoad = Module._load;
let api;
try {
 Module._load=function(name,...args){
   if(name==='mongodb')return {MongoClient:class {async connect(){} db(){return db} async close(){}}};
   return originalLoad.call(this,name,...args);
 };
 api=require('../server.js').__test;
} finally {Module._load=originalLoad;}
let counter=0;
function token(){return (++counter).toString(16).padStart(64,'0');}
function auth(email,expiresAt=new Date(Date.now()+3600000).toISOString(),pending2fa=false){
 const value=token();api.portalSessions[value]={email,name:email.split('@')[0],pending2fa,expiresAt};return `zv_portal=${value}`;
}
let server;
function barrier(n){let count=0,release;const gate=new Promise(r=>release=r);return {async wait(){if(++count===n)release();await gate;}};}
async function req(path, cookie, params){
 const base=`http://127.0.0.1:${server.address().port}`;
 const method=params?'POST':'GET';
 const headers={'cookie':cookie,'sec-fetch-site':'same-origin'};
 if(params)headers['content-type']='application/x-www-form-urlencoded';
 const res=await fetch(base+path,{method,headers,body:params?new URLSearchParams(params):undefined,redirect:'manual'});
 return {status:res.status,location:res.headers.get('location'),text:await res.text()};
}
(async()=>{
 let checks=0;
 server=http.createServer((r,w)=>{api.handleRequest(r,w).catch(e=>{console.error(e.message);w.writeHead(500);w.end()})});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const a=auth(emailA),b=auth(emailB);
 const dashA=await req('/cliente',a);assert.equal(dashA.status,200);assert.ok(dashA.text.includes(PHONE_A1));assert.ok(!dashA.text.includes(PHONE_B));assert.ok(dashA.text.includes('name="phone"'));checks++;
 const dashB=await req('/cliente',b);assert.equal(dashB.status,200);assert.ok(dashB.text.includes(PHONE_B));assert.ok(!dashB.text.includes(PHONE_A1));checks++;
 const forged=await req('/cliente/dispositivos/remover',a,{phone:PHONE_B});assert.equal(forged.status,404);assert.deepEqual(dbData.keys[KEY_B].phones,[PHONE_B]);checks++;
 const oldForm=await req('/cliente/dispositivos/remover',a,{index:'0'});assert.equal(oldForm.status,409);checks++;
 const correct=await req('/cliente/dispositivos/remover',a,{phone:PHONE_A1});assert.equal(correct.status,302);assert.deepEqual(dbData.keys[KEY_A].phones,[PHONE_A2]);assert.deepEqual(dbData.keys[KEY_B].phones,[PHONE_B]);checks++;
 // A stale/missing phone must never remove a different device now at index 0.
 const stale=await req('/cliente/dispositivos/remover',a,{phone:PHONE_A1});assert.equal(stale.status,404);assert.deepEqual(dbData.keys[KEY_A].phones,[PHONE_A2]);checks++;
 dbData.keys[KEY_A].phones=[PHONE_A1,PHONE_A2];dbData.keys[KEY_A].uses=2;
 readBarrier=barrier(2);
 const result=await Promise.all([req('/cliente/dispositivos/remover',a,{phone:PHONE_A1}),req('/cliente/dispositivos/remover',a,{phone:PHONE_A2})]);
 readBarrier=null;assert.deepEqual(result.map(x=>x.status).sort(),[302,409]);assert.equal(dbData.keys[KEY_A].phones.length,1);assert.equal(dbData.keys[KEY_A].uses,1);checks++;
 const expired=auth(emailA,new Date(Date.now()-1000).toISOString(),true);
 const er=await req('/cliente/2fa/verificar',expired);assert.equal(er.status,302);checks++;
 const livePending=auth(emailA,new Date(Date.now()+120000).toISOString(),true);
 const lr=await req('/cliente/2fa/verificar',livePending);assert.equal(lr.status,200);checks++;
 const invalidExpiry=auth(emailA,'invalid',true);
 const ir=await req('/cliente/2fa/verificar',invalidExpiry);assert.equal(ir.status,302);checks++;
 assert.ok(casWrites>=3);
 console.log(`R46.39 Portal auth + device CAS HTTP fixture PASS / ${checks} groups; 2 tenants, no real DB`);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(server)await new Promise(r=>server.close(r));});
