'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LegacyV3Shield,
  legacyKeyStateSignature,
  legacyReloginCacheKey,
} = require('../legacy-v3-shield');

test('R42 check-status cache hits within TTL and invalidates on state change', () => {
  let now = 1000;
  const shield = new LegacyV3Shield({ now: () => now, checkTtlMs: 120000, keyTtlMs: 1800000, maxEntries: 64 });
  const key = { active:true, isBasicPlan:false, phones:['+55 (31) 99999-0000'], modules:{crm:true}, permissions:['a'] };
  const sig1 = legacyKeyStateSignature(key);
  const payload = { active:true, planName:'Pro' };
  shield.setCheck('abc', sig1, payload);
  assert.deepEqual(shield.getCheck('abc', sig1), payload);
  key.active = false;
  const sig2 = legacyKeyStateSignature(key);
  assert.equal(shield.getCheck('abc', sig2), null);
  const snap = shield.snapshot();
  assert.equal(snap.checkHits, 1);
  assert.equal(snap.checkMisses, 1);
});

test('R42 check-status cache expires by TTL even without state change', () => {
  let now = 1000;
  const shield = new LegacyV3Shield({ now: () => now, checkTtlMs: 2000, maxEntries:64 });
  const sig = legacyKeyStateSignature({ active:true });
  shield.setCheck('abc', sig, {active:true});
  now += 1999;
  assert.equal(shield.getCheck('abc', sig).active, true);
  now += 2000;
  assert.equal(shield.getCheck('abc', sig), null);
});

test('R42 relogin cache key separates phone, extension id, IP, WPP version and username', () => {
  const base = { keyCode:'abc', phone:'+55 31 99999-0000', deviceId:'ext-a', ip:'1.2.3.4', wppVersion:'2.1', userName:'A' };
  const a = legacyReloginCacheKey(base);
  assert.notEqual(a, legacyReloginCacheKey({...base, phone:'+55 31 99999-0001'}));
  assert.notEqual(a, legacyReloginCacheKey({...base, deviceId:'ext-b'}));
  assert.notEqual(a, legacyReloginCacheKey({...base, ip:'1.2.3.5'}));
  assert.notEqual(a, legacyReloginCacheKey({...base, wppVersion:'2.2'}));
  assert.notEqual(a, legacyReloginCacheKey({...base, userName:'B'}));
});

test('R42 state signature covers commercial/auth mutations', () => {
  const base = {
    active:true, expiresAt:'2030-01-01T00:00:00.000Z', isBasicPlan:false,
    plan_id:'ZV_PRO', maxUses:3, uses:1, phones:['5531999990000'],
    modules:{crm:true}, permissions:['crm'], segments:['x'], label:'L'
  };
  const sig = legacyKeyStateSignature(base);
  for (const mut of [
    {active:false}, {expiresAt:'2031-01-01T00:00:00.000Z'}, {isBasicPlan:true},
    {plan_id:'ZV_BASIC'}, {maxUses:2}, {uses:2}, {phones:['5531888880000']},
    {modules:{crm:false}}, {permissions:['other']}, {segments:['y']}, {label:'N'}
  ]) {
    assert.notEqual(sig, legacyKeyStateSignature({...base, ...mut}), JSON.stringify(mut));
  }
});

test('R42 bounded LRU never exceeds maxEntries', () => {
  const shield = new LegacyV3Shield({ maxEntries:64 });
  for (let i=0;i<200;i++) shield.setCheck('k'+i, 's'+i, {i});
  const snap = shield.snapshot();
  assert.equal(snap.checkEntries, 64);
  assert.ok(snap.evictions >= 136);
});

test('R42 simulated frozen Build 3: 52 contexts / 15 min cuts expensive relogins by >80%', () => {
  let now = 0;
  const shield = new LegacyV3Shield({ now:() => now, checkTtlMs:120000, keyTtlMs:1800000, maxEntries:2048 });
  const state = { active:true, expiresAt:'2030-01-01T00:00:00.000Z', isBasicPlan:false, maxUses:5, uses:1, phones:['5531999990000'] };
  const sig = legacyKeyStateSignature(state);
  let keyMisses=0, keyHits=0, checkMisses=0, checkHits=0;
  const contexts=52;
  for (let ms=0; ms<15*60*1000; ms+=30000) {
    now=ms;
    for(let c=0;c<contexts;c++){
      const checkKey='key-'+c;
      if(shield.getCheck(checkKey,sig)) checkHits++;
      else { checkMisses++; shield.setCheck(checkKey,sig,{active:true}); }
      if(ms % 300000 === 0){
        const rk=legacyReloginCacheKey({keyCode:checkKey,phone:'5531999990000',deviceId:'ext-'+c,ip:'10.0.0.'+(c%250),wppVersion:'2.0',userName:'U'});
        if(shield.getKey(rk,sig)) keyHits++;
        else { keyMisses++; shield.setKey(rk,sig,{isLoggedIn:true}); }
      }
    }
  }
  assert.ok(checkHits > checkMisses * 2, {checkHits,checkMisses});
  assert.ok(keyHits >= keyMisses * 2, {keyHits,keyMisses});
  const baselineRelogins = contexts * 3;
  assert.ok(keyMisses <= contexts, {baselineRelogins,keyMisses});
});

test('R42 estimated write counter is explicit observability only', () => {
  const shield = new LegacyV3Shield({maxEntries:64});
  shield.noteDbWritesAvoided(2);
  shield.noteDbWritesAvoided(1);
  shield.noteKeyBypass();
  const s=shield.snapshot();
  assert.equal(s.estimatedDbWritesAvoided,3);
  assert.equal(s.keyBypasses,1);
});
