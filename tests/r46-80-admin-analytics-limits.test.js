'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function region(start,end) {const i=src.indexOf(start),j=src.indexOf(end,i+start.length);assert.ok(i>=0&&j>i,'region '+start);return src.slice(i,j);}
function evalModule(code,names,values){return new Function(...names,code)(...values);}
(async () => {
const rl=region('const RL_CONFIG = {','\nif (!ZVM_LOCAL_SAFE_MODE) {');
assert.match(rl,/analytics_purge_preview/);
assert.match(rl,/analytics_purge_execute/);
assert.doesNotMatch(rl,/\banalytics_purge\s*:/);
const rate = evalModule('const rateLimitMap=new Map();let alerts=0;\n' + rl + '\nreturn {checkRateLimit,getRateLimitRetryAfterSeconds,map:rateLimitMap}', ['addSecurityAlert','console'],[()=>{}, {warn(){}}]);
const ip='synthetic-admin-ip';
for(let i=0;i<40;i++)assert.equal(rate.checkRateLimit(ip,'analytics_purge_preview'),true,'previews should not block');
for(let i=0;i<5;i++)assert.equal(rate.checkRateLimit(ip,'analytics_purge_execute'),true,'purge execution count');
assert.equal(rate.checkRateLimit(ip,'analytics_purge_execute'),false,'purge sixth destructive action blocked');
assert.ok(rate.getRateLimitRetryAfterSeconds(ip,'analytics_purge_execute')>0,'retry after for blocked execute');
assert.equal(rate.checkRateLimit(ip,'analytics_purge_preview'),true,'blocked write never poisons preview');
// Simula o fim de um bloqueio curto ainda dentro da janela antiga.
for(let i=41;i<80;i++)assert.equal(rate.checkRateLimit(ip,'analytics_purge_preview'),true);
assert.equal(rate.checkRateLimit(ip,'analytics_purge_preview'),false,'preview beyond its own max is blocked');
const held = rate.map.get(ip + ':analytics_purge_preview');
held.blockedUntil = Date.now()-1;
held.resetAt = Date.now()+30000;
assert.equal(rate.checkRateLimit(ip,'analytics_purge_preview'),true,'after cooldown, next request succeeds with fresh window');
for(let i=0;i<25;i++)assert.equal(rate.checkRateLimit(ip,'analytics_lab_preview'),true);
assert.equal(rate.checkRateLimit(ip,'analytics_lab_simulate'),true,'lab preview never poisons simulate');
assert.equal(rate.checkRateLimit(ip,'analytics_lab_email_send'),true,'email preview never poisons send');

const adminCreate=region('async function commitAdminKeyRecordStrict(', '\n// No painel Admin, o MongoDB é a autoridade');
let primaryWrites=0,recoveredWrites=0,attempted=[];
const primary={collection:()=>({async updateOne(query,update,options){primaryWrites++;attempted.push(update);assert.equal(options.timeoutMS,7000);throw Error('connection timed out')}})};
const recovered={collection:()=>({async updateOne(query,update,options){recoveredWrites++;attempted.push(update);assert.equal(options.timeoutMS,7000);}})};
let recoveredGet=0, invalidated=0, cachedKeys={};
const commit=evalModule(adminCreate+'\nreturn commitAdminKeyRecordStrict;', ['cloneKeyRecordForCommit','getMongoDb','zvmInvalidateMongoOnNetworkError','keys','invalidateKeysHtmlCache'],[(x)=>JSON.parse(JSON.stringify(x)),async()=>{recoveredGet++;return recovered;},()=>{invalidated++;return true;},cachedKeys,()=>{}]);
await commit('synthetic-code',{label:'Synthetic'},{db:primary}).then(()=>{throw Error('unexpected success for forced db')},()=>{});
assert.equal(primaryWrites,1,'injected DB error propagated with no retry');
const commit2=evalModule(adminCreate+'\nreturn commitAdminKeyRecordStrict;', ['cloneKeyRecordForCommit','getMongoDb','zvmInvalidateMongoOnNetworkError','keys','invalidateKeysHtmlCache'],[(x)=>JSON.parse(JSON.stringify(x)),async()=>{recoveredGet++;return recovered;},()=>{invalidated++;return true;},cachedKeys,()=>{}]);
const first=async()=>primary;
const injected=evalModule(adminCreate.replace('const db = deps.db || await getMongoDb();','const db = await getMongoDb();')+'\nreturn commitAdminKeyRecordStrict;', ['cloneKeyRecordForCommit','getMongoDb','zvmInvalidateMongoOnNetworkError','keys','invalidateKeysHtmlCache'],[(x)=>JSON.parse(JSON.stringify(x)),async()=>{recoveredGet++;return recoveredGet===1?primary:recovered;},()=>{invalidated++;return true;},cachedKeys,()=>{}]);
await injected('synthetic-code',{label:'Synthetic'});
assert.equal(primaryWrites,2);
assert.equal(recoveredWrites,1);
assert.deepEqual(attempted[1],attempted[2],'same record and key on retry');
assert.equal(cachedKeys['synthetic-code'].label,'Synthetic');

const mutate=region('async function mutateAdminKeyRecordStrict(','\nfunction sendAdminKeyPersistFailure(');
let updateCount=0, memo={'synthetic-code':{active:true}};
const mutateDb={collection:()=>({async findOneAndUpdate(){updateCount++;throw Error('connection timed out')}})};
const fn=evalModule(mutate+'\nreturn mutateAdminKeyRecordStrict;', ['getMongoDb','readAdminKeySnapshot','cloneKeyRecordForCommit','zvmInvalidateMongoOnNetworkError','keys','invalidateKeysHtmlCache'],[async()=>mutateDb,async()=>({active:true}),x=>JSON.parse(JSON.stringify(x)),()=>true,memo,()=>{}]);
await fn('synthetic-code',d=>{d.active=false}).then(()=>{throw Error('CAS should reject')},()=>{});
assert.equal(updateCount,1,'CAS never repeats potentially committed toggle');
assert.equal(memo['synthetic-code'].active,true,'CAS failure does not mutate cache');

const zone=region('  // ── Laboratório de Testes (Analytics)','  if (p === \'/cakto/webhook\'');
assert.match(zone,/checkRateLimit\(ip, 'analytics_purge_preview'\)/);
assert.match(zone,/checkRateLimit\(ip, 'analytics_purge_execute'\)/);
assert.match(zone,/const emailRateType = isSend \? 'analytics_lab_email_send' : 'analytics_lab_email_preview'/);
assert.match(zone,/checkRateLimit\(ip, emailRateType\)/);
assert.ok(zone.indexOf("const isSend = p === R_ANALYTICS+'/api/lab/email-send'") < zone.indexOf("const emailRateType ="),'isSend defined before rate check');
assert.match(zone,/sendAnalyticsRateLimited\(res, ip, 'analytics_purge_execute'\)/);
assert.match(src,/function sendAnalyticsRateLimited\(/);
console.log('R46.80: Analytics limits separated, admin Mongo recovery and nonrepeatable CAS PASSED');

})().catch(error => { console.error(error); process.exitCode = 1; });
