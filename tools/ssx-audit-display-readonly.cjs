'use strict';
/* Offline source audit for the hash-pinned v36 SSX 2012 snapshot.
 * This reads original bytes and reports candidate issues. It never writes
 * to the sheet, guesses player IDs, or modifies the published leaderboard.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const {SHA256}=require('../src/hobbies/ssx/route.js');
const score=require('../src/hobbies/ssx/score-integrity.js');
const ROOT=path.join(__dirname,'../src/hobbies/ssx/packed');
function readLiteral(script,key){
  const found=new RegExp('(?:let|const|var)\\s+'+key+'\\s*=').exec(script);
  if(!found)throw new Error('Missing verified source literal '+key);
  let at=found.index+found[0].length;
  while(/\s/.test(script[at]))at++;
  const open=script[at],close=open==='['?']':open==='{'?'}':null;
  if(!close)throw new Error('Unsafe source literal '+key);
  const stack=[],start=at;
  let quote=false,escape=false;
  for(;at<script.length;at++){
    const ch=script[at];
    if(quote){
      if(escape)escape=false;
      else if(ch==='\\')escape=true;
      else if(ch==='"')quote=false;
      continue;
    }
    if(ch==='"'){quote=true;continue;}
    if(ch==='['||ch==='{')stack.push(ch);
    else if(ch===']'||ch==='}'){
      if(!stack.length||stack.pop()!==(ch===']'?'[':'{'))throw new Error('Unbalanced literal '+key);
      if(!stack.length)return JSON.parse(script.slice(start,at+1));
    }
  }
  throw new Error('Unterminated literal '+key);
}
function readPinnedSnapshot(){
  const packed=Buffer.concat(Array.from({length:10},(_,i)=>
    fs.readFileSync(path.join(ROOT,'ssx2012.html.gz.part'+String(i).padStart(2,'0')))));
  const original=zlib.gunzipSync(packed);
  const sha=crypto.createHash('sha256').update(original).digest('hex');
  if(sha!==SHA256)throw new Error('SSX_ARCHIVE_SHA256_MISMATCH');
  const html=original.toString('utf8');
  const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)]
    .map(v=>v[1]).sort((a,b)=>b.length-a.length)[0];
  if(!script)throw new Error('No original source script');
  const META=readLiteral(script,'META'),TRACKS=readLiteral(script,'TRACKS');
  const G=readLiteral(script,'G'),SNG=readLiteral(script,'SNG');
  if(META.snapshot!=='2026-08-22'||G.length!==5887||SNG.length!==137||TRACKS.length!==83)
    throw new Error('Original snapshot count or date changed');
  return {sha256:sha,META,TRACKS,G,SNG};
}
function strictName(value){return String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en');}
function approximateKey(value){return strictName(value).normalize('NFKD')
  .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');}
function audit(snapshot){
  const rows=[...snapshot.G.map(r=>({row:r,source:'G'})),
    ...snapshot.SNG.map(r=>({row:r,source:'SNG'}))];
  const modes=new Map(),names=new Map(),approximations=new Map();
  const statusCounts={},sampleFormats={},scopes=new Map();
  for(const [index,{row,source}] of rows.entries()){
    const category=source==='SNG'?'Survive Special':String(row[0]??'');
    const mode=Number(row[3]),platform=String(row[7]??''),rider=String(row[4]??'').trim();
    const result=score.format(row[5],mode),modeKey=String(mode);
    const entry=modes.get(modeKey)||{mode,rows:0,formatted:0,needsReview:0,statuses:{}};
    entry.rows++;
    entry.statuses[result.status]=(entry.statuses[result.status]||0)+1;
    if(result.changed)entry.formatted++;
    if(result.status.startsWith('review-')){
      entry.needsReview++;
      if(!sampleFormats[result.status])sampleFormats[result.status]=[];
      if(sampleFormats[result.status].length<8)
        sampleFormats[result.status].push({category,trackId:row[1],mode,original:result.raw,display:result.display,
          sourceSheet:row[9],sourceCell:row[10]});
    }
    modes.set(modeKey,entry);
    statusCounts[result.status]=(statusCounts[result.status]||0)+1;
    const normal=strictName(rider),approx=approximateKey(rider);
    if(normal){
      if(!names.has(normal))names.set(normal,{variants:new Map(),rows:0});
      const group=names.get(normal);group.rows++;
      group.variants.set(rider,(group.variants.get(rider)||0)+1);
      if(approx){
        if(!approximations.has(approx))approximations.set(approx,new Set());
        approximations.get(approx).add(normal);
      }
    }
    const scope=JSON.stringify([category,mode,platform]);
    scopes.set(scope,(scopes.get(scope)||0)+1);
  }
  const exactSpellingCandidates=[...names.values()]
    .filter(g=>g.variants.size>1).map(g=>({rows:g.rows,names:[...g.variants.keys()].sort()}))
    .sort((a,b)=>b.rows-a.rows||a.names.join('').localeCompare(b.names.join('')));
  const nearSpellingCandidates=[...approximations.values()].filter(g=>g.size>1)
    .map(g=>({normalizedVariants:[...g].sort(),candidates:[...g].reduce((n,name)=>n+names.get(name).rows,0)}))
    .sort((a,b)=>b.candidates-a.candidates);
  return {
    schema:'ssx-source-display-audit-v1',snapshot:snapshot.META.snapshot,sha256:snapshot.sha256,
    totalRows:rows.length,scopes:scopes.size,distinctExactNames:[...new Set(rows.map(({row})=>String(row[4]??'').trim()))].length,
    caseSpaceVariantGroups:exactSpellingCandidates.length,
    nearVariantGroups:nearSpellingCandidates.length,
    displayStatuses:statusCounts,modes:[...modes.values()].sort((a,b)=>a.mode-b.mode),
    samplesRequiringReview:sampleFormats,
    nameCandidatesForManualReview:{
      caseOrWhitespace:exactSpellingCandidates.slice(0,20),
      punctuationOrAccent:nearSpellingCandidates.slice(0,20)
    },
    safeguards:{sourceWrites:0,identityMerges:0,automaticAliases:0,
      rawScoresUnchanged:true,rankingComparisonsUnchanged:true,
      requiresExactPlayerIdToCertifyIdentity:true,
      riderNetScoresUsed:0,liveSheetCoverageVerified:false}
  };
}
if(require.main===module)process.stdout.write('SSX_R78_SOURCE_AUDIT '+JSON.stringify(audit(readPinnedSnapshot()))+'\n');
module.exports={readPinnedSnapshot,audit,strictName,approximateKey};
