'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculate,scope}=require('../src/hobbies/ssx/special-leaders-core.js');
const row=(part={})=>Object.freeze({
  category:'Level 1',mode:0,platform:'Xbox 360',trackId:1,
  track:'Red Light',mountain:'Meru',region:'Africa',position:1,
  rider:'TestOne',score:'01:42.05',proof:'https://youtu.be/example',...part
});
test('only a recorded #1 becomes a leader; never the first visible top-16 row',()=>{
  const data=[row({position:2,rider:'Runner2'}),row({position:3,rider:'Runner3'})];
  const result=calculate(data,'Level 1',0,'Xbox 360');
  assert.equal(result.sourceRows,2);
  assert.equal(result.leaders.length,0);
  assert.deepEqual(result.withoutFirst.map(x=>x.trackId),[1]);
  assert.equal(result.podium.length,0);
});
test('one leader per track even with many Red Light ranked riders',()=>{
  const data=[
    row(), ...Array.from({length:16},(_,i)=>row({position:i+2,rider:'Other'+i})),
    row({trackId:2,track:'Corkscrew',position:1,rider:'TestTwo'})
  ];
  const result=calculate(data,'Level 1',0,'Xbox 360');
  assert.equal(result.sourceRows,18);
  assert.equal(result.leaderCount,2);
  assert.deepEqual(result.leaders.map(x=>x.trackId),[1,2]);
  assert.equal(result.podium.length,2);
  assert.equal(result.podium[0].wins,1);
});
test('count distinct first-place finishes, never compare cross-track times',()=>{
  const result=calculate([
    row({score:'03:40.00',rider:'A'}),
    row({trackId:2,score:'01:00.00',rider:'A'}),
    row({trackId:3,score:'00:02.00',rider:'B'}),
    row({trackId:4,score:'00:01.00',rider:'C'})
  ],'Level 1',0,'Xbox 360');
  assert.equal(result.podium[0].name,'A');
  assert.equal(result.podium[0].wins,2);
  assert.equal(result.podium.length,3);
  assert.equal(result.podium[0].proofs,2);
});
test('platform, category and mode must be separated, never silently merged',()=>{
  const rows=[
    row(),row({category:'Level 9',rider:'Level9',trackId:2}),
    row({platform:'Android',rider:'AndroidRider',trackId:2}),
    row({mode:1,rider:'WingsRider',trackId:2})
  ];
  const result=calculate(rows,'Level 1',0,'Xbox 360');
  assert.equal(result.sourceRows,1);
  assert.equal(result.leaders[0].rider,'TestOne');
  assert.equal(calculate(rows,'Level 1',0,'Android').leaders[0].rider,'AndroidRider');
  assert.equal(calculate(rows,'Level 1',1,'Xbox 360').leaders[0].rider,'WingsRider');
});
test('ambiguous different #1 claims for the same track are excluded and reported',()=>{
  const result=calculate([
    row(),row({rider:'Another',score:'01:39.20'}),
    row({trackId:2,rider:'VerifiedElsewhere'})
  ],'Level 1',0,'Xbox 360');
  assert.equal(result.collisions.length,1);
  assert.equal(result.collisions[0].claims.length,2);
  assert.equal(result.leaderCount,1);
  assert.equal(result.podium[0].name,'VerifiedElsewhere');
});
test('exact repeated #1 rows do not award a double win',()=>{
  const result=calculate([row(),row({proof:''}),row({position:2})],'Level 1',0,'Xbox 360');
  assert.equal(result.leaderCount,1);
  assert.equal(result.duplicateRows,1);
  assert.equal(result.podium[0].wins,1);
  assert.equal(result.podium[0].proofs,1);
});
test('different spellings are not merged without verified Ozmonet player ID',()=>{
  const result=calculate([
    row({rider:'TagName'}),row({rider:'tagname',trackId:2})
  ],'Level 1',0,'Xbox 360');
  assert.equal(result.contenders,2);
  assert.equal(result.identityStatus,'unverified-until-exact-ozmonet-player-id');
  assert.equal(result.certifiedCurrent,false);
});
test('score formatting, source records and archived arrays remain unchanged',()=>{
  const source=Object.freeze([
    row({score:'4.460432E7'}),
    row({trackId:2,score:'10,787,35m',rider:'Tester',proof:''})
  ]);
  const before=JSON.stringify(source);
  const result=calculate(source,'Level 1',0,'Xbox 360');
  assert.equal(result.leaders[0].score,'4.460432E7');
  assert.equal(result.leaders[1].score,'10,787,35m');
  assert.equal(JSON.stringify(source),before);
  assert.equal(result.source,'google-sheets-archive');
});
test('do not populate podium when category has no #1 position',()=>{
  const result=calculate([row({position:8})],'Level 1',0,'Xbox 360');
  assert.equal(result.trackCount,1);
  assert.equal(result.podium.length,0);
  assert.equal(result.withoutFirst.length,1);
});
test('invalid inputs are refused, unexpected rows cannot receive #1',()=>{
  assert.throws(()=>calculate(null,'Level 1',0,'Xbox 360'),/array/);
  assert.throws(()=>calculate([],'',0,'Xbox 360'),/mandatory/);
  assert.throws(()=>calculate([],'Level 1',0,''),/mandatory/);
  assert.deepEqual(scope([row(),row({position:0})],'Level 1',0,'Xbox 360').length,1);
});
