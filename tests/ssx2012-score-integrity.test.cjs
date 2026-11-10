'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {format,apply}=require('../src/hobbies/ssx/score-integrity.js');
const {readPinnedSnapshot,audit,strictName}=require('../tools/ssx-audit-display-readonly.cjs');
test('mode-specific presentation never changes underlying source values or rank order',()=>{
  const cases=[
    ['1:42.83',0,'01:42.83','verified-format'],
    ['01:35.99','board','01:35.99','verified-format'],
    ['00:34.79',1,'00:34.79','verified-format'],
    ['03:61.00',0,'03:61.00','review-unparsed'],
    ['123456789',2,'123,456,789','verified-format'],
    ['4.460432E7',2,'44,604,320','verified-format'],
    ['12,345',2,'12,345','verified-format'],
    ['12345,67',2,'12345,67','review-unparsed'],
    ['10000.25m',3,'10,000.25 m','verified-format'],
    ['10,787,35m',5,'10,787.35 m','review-inferred-separators'],
    ['225 229,45m',3,'225,229.45 m','review-inferred-separators'],
    ['206.889.98m',3,'206,889.98 m','review-inferred-separators'],
    ['1.200,50m',3,'1,200.50 m','review-inferred-separators'],
    ['12,456.70 m',5,'12,456.70 m','verified-format']
  ];
  for(const [raw,mode,display,status] of cases){
    const result=format(raw,mode);
    assert.equal(result.display,display,'Wrong display for '+raw);
    assert.equal(result.status,status,'Wrong confidence for '+raw);
    assert.equal(result.raw,raw,'Original value must remain unchanged');
  }
  const raw='4.460432E7';
  const fakeNode={
    ownerDocument:{documentElement:{lang:'pt-BR'}},
    dataset:{},
    textContent:'',
    title:''
  };
  const ref=apply(fakeNode,raw,2);
  assert.equal(ref,fakeNode);
  assert.equal(fakeNode.textContent,'44,604,320');
  assert.equal(fakeNode.dataset.ssxOriginalScore,raw);
  assert.match(fakeNode.title,/4\.460432E7/);
  assert.equal(format('10,787,35m',5).changed,true);
  assert.equal(format('10,787,35m',5).status,'review-inferred-separators');
});
test('full August 2026 snapshot is audited read-only; aliases remain candidates, not merges',()=>{
  const frozen=readPinnedSnapshot();
  const originalRows=JSON.stringify([frozen.G,frozen.SNG]);
  const report=audit(frozen);
  assert.equal(report.snapshot,'2026-08-22');
  assert.equal(report.totalRows,6024);
  assert.equal(report.sha256,'d99aa1caaf9e9833ff85f899119043cbddaca66ce9bc9aa5f256990d331e42f0');
  assert.equal(report.modes.reduce((n,m)=>n+m.rows,0),6024);
  assert.equal(Object.values(report.displayStatuses).reduce((n,count)=>n+count,0),6024);
  assert.equal(report.safeguards.identityMerges,0);
  assert.equal(report.safeguards.sourceWrites,0);
  assert.equal(report.safeguards.riderNetScoresUsed,0);
  assert.equal(JSON.stringify([frozen.G,frozen.SNG]),originalRows);
  assert.equal(strictName('  Jake   '),strictName('jake'));
  const allReports=[...report.nameCandidatesForManualReview.caseOrWhitespace,
    ...report.nameCandidatesForManualReview.punctuationOrAccent];
  assert.ok(allReports.every(c=>c.names?.length>1||c.normalizedVariants?.length>1));
  const oldTrick=frozen.G.find(r=>r[0]==='Android'&&r[3]===2&&r[5]==='4.460432E7');
  assert.ok(oldTrick,'Original Android Trick score must survive archive load');
  const oldSurvive=frozen.SNG.find(r=>r[3]===5&&r[5]==='10,787,35m');
  assert.ok(oldSurvive,'Original Survive score must be retained');
  console.log('SSX_R78_FULL_SOURCE_AUDIT '+JSON.stringify(report));
});
