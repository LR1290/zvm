'use strict';
/**
 * Read-only, deterministic source provenance inventory for the SSX v36 archive.
 * This test never fetches remote pages, changes scores, assigns identities,
 * or guesses missing source categories. Follow-up reconciliation requires
 * independently captured Google Sheets and Ozmonet source snapshots.
 */
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {SHA256}=require('../src/hobbies/ssx/route');
const ROOT=path.join(__dirname,'../src/hobbies/ssx');
function archive(){
  const segments=Array.from({length:10},(_,i)=>
    fs.readFileSync(path.join(ROOT,'packed','ssx2012.html.gz.part'+String(i).padStart(2,'0'))));
  return zlib.gunzipSync(Buffer.concat(segments));
}
function locations(html,pattern,limit=6){
  const found=[];let match;
  while((match=pattern.exec(html))&&found.length<limit){
    const fragment=html.slice(Math.max(0,match.index-85),Math.min(html.length,match.index+135));
    const clean=fragment.replace(/<[^>]{0,500}>/g,' ').replace(/[\r\n\t ]+/g,' ').trim();
    found.push(clean.slice(0,185));
  }
  return found;
}
function externalSources(html){
  const matches=html.match(/https?:\/\/[^\s"'<>\\]{4,250}/g)||[];
  const origins=new Map(),urls=[];
  for(let raw of matches){
    raw=raw.replace(/&amp;/g,'&').replace(/[),;]+$/g,'');
    try{
      const u=new URL(raw);
      const host=u.hostname.toLowerCase();
      if(!/google|ozmonet|merq|youtube|youtu\.be|discord|spreadsheet/.test(host))continue;
      origins.set(host,(origins.get(host)||0)+1);
      if(/google.*spreadsheets|ozmonet|merq/.test(host)&&urls.length<30&&!urls.includes(u.origin+u.pathname)){
        urls.push(u.origin+u.pathname);
      }
    }catch(_){}
  }
  return {sourceHosts:[...origins].sort((a,b)=>b[1]-a[1]).slice(0,30),sourcePaths:urls};
}
test('forensic read-only SSX archive inventory for source reconciliation',()=>{
  const bytes=archive();
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),SHA256);
  const html=bytes.toString('utf8');
  assert.ok(html.length>1_000_000);
  const patterns={
    lowLevel:/low[\s_-]*level|lower[\s_-]*level|low[\s_-]*tier|niv[eé]is?\s*baixos?|easy\s*mode|novice/gi,
    android:/android|mobile\s*version|apk|ios\b/gi,
    testStages:/test[\s_-]*(?:track|level|stage|event|course)|(?:beta|demo|trial)[\s_-]*(?:track|stage|level)|test(?:ing)?\s*phase/gi,
    ozmonet:/ozmonet/gi,
    googleSheets:/docs\.google\.com\/spreadsheets|sheets\.google|spreadsheet/gi,
    ids:/\bxuid\b|\bplayer[\s_-]*id\b|\brider[\s_-]*id\b|\bgamer[\s_-]*id\b|\bprofile[\s_-]*id\b|\buser[\s_-]*id\b/gi,
    modeNames:/wingsuit|no[\s_-]*gear|survive[\s_-]*it|trick[\s_-]*it/gi
  };
  const markers={};
  for(const [name,pattern] of Object.entries(patterns)){
    markers[name]=locations(html,pattern,8);
  }
  const lines=externalSources(html);
  const catalog={
    sha256:SHA256,
    archiveBytes:bytes.length,
    sourceHosts:lines.sourceHosts,
    sourcePaths:lines.sourcePaths,
    markers,
    safeguards:{
      recordAuthority:'Google Sheets (externally verified snapshot required)',
      nameAuthority:'Ozmonet player ID mapping (externally verified snapshot required)',
      sourceInArchiveIsNotProofOfLatest:true,
      preventCrossModeRanking:true,
      requireStableIdBeforeRenaming:true,
      noWritesPerformed:true
    }
  };
  process.stdout.write('SSX_SOURCE_INVENTORY '+JSON.stringify(catalog)+'\n');
});
