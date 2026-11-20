'use strict';
// SSX R111: immutable read-only snapshot of 11 official regional tabs.
// The live Google spreadsheet is never modified. Entries are reconciled by
// sheet + track label + rank + discipline, NOT by stale A1 coordinates.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const SHEET_ID='1SAk84oy05R0UK3JJ_JWJTskSqxj4GpGJkdRqfSmnx2I';
const CAPTURED='2026-11-20';
const SHEETS=Object.freeze(['AFRICA','ALASKA','ALPS','ANTARCTICA','HIMALAYAS','JAPAN',
  'MOUNT_EDDIE','NEW_ZEALAND','PATAGONIA','ROCKIES','SIBERIA']);
const MODES=Object.freeze({0:[6,4],1:[9,7],2:[12,10],3:[15,13]});
const MANUAL_ALIASES=Object.freeze({
  rollngthunder:'rollingthunder',
  groundtutorial:'groundtraining',
  frowiththeflo:'frowiththeflow',
  kidscorner:'thekidscorner',
  curnoesmustache:'curnoesmoustache'
});
function norm(s){
  return String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]/g,'');
}
function mappedLabel(s){const n=norm(s);return MANUAL_ALIASES[n]||n;}
function safeLink(link){
  if(!link)return '';
  try {const u=new URL(String(link));return u.protocol==='https:'&&!u.username&&!u.password
    &&u.href.length<=2048?u.href:'';}catch{return '';}
}
function metric(mode,raw){
  const s=String(raw||'').trim();
  if(mode<=1){
    if(!/^\d{1,3}[:.][0-5]\d[.,:]\d{1,3}$/.test(s))return {ok:false};
    return {ok:true,numeric:null};
  }
  if(mode===2){
    if(!/^[\d.,+\sEe-]+$/.test(s))return {ok:false};
    let v;
    if(/e[+-]?\d+$/i.test(s))v=Number(s.replace(',','.'));
    else{
      const trimmed=s.replace(/(?:[.,]00)$/,'');
      v=Number(trimmed.replace(/[.,\s]/g,''));
    }
    return {ok:Number.isSafeInteger(v)&&v>=1000&&v<=100000000000,numeric:v};
  }
  if(mode===3){
    if(!/^[\d.,\s]+m$/i.test(s))return {ok:false};
    const digits=s.slice(0,-1).replace(/[.,\s]/g,'');
    if(!/^\d{3,15}$/.test(digits))return {ok:false};
    const v=Number(digits)/100;
    return {ok:Number.isFinite(v)&&v>0&&v<=1e9,numeric:v};
  }
  return {ok:false};
}
function cellSource(data){
  if(data.schemaVersion!==1||data.spreadsheetId!==SHEET_ID||data.capturedOn!==CAPTURED
    ||!SHEETS.includes(data.sheet)||!Array.isArray(data.cells))throw new Error('SSX_R111_SOURCE_MISMATCH');
  const byRow=new Map(),labels=[];
  for(const entry of data.cells){
    if(!Array.isArray(entry)||entry.length!==4)throw new Error('SSX_R111_CELL_SCHEMA');
    const [r,c,v,l]=entry;
    if(!Number.isSafeInteger(r)||r<1||r>170||!Number.isSafeInteger(c)||c<1||c>19
       ||typeof v!=='string'||v.length>2048||typeof l!=='string')throw new Error('SSX_R111_CELL_INVALID');
    if(!byRow.has(r))byRow.set(r,new Map());
    if(byRow.get(r).has(c))throw new Error('SSX_R111_DUPLICATE_CELL');
    byRow.get(r).set(c,{v,link:safeLink(l)});
    if(c===2&&v.trim())labels.push({row:r,label:mappedLabel(v)});
  }
  labels.sort((a,b)=>a.row-b.row);
  const value=(r,c)=>byRow.get(r)?.get(c)||null;
  return {name:data.sheet,labels,value,rows:byRow};
}
function sources(){
  const result=new Map();
  for(const name of SHEETS){
    const raw=fs.readFileSync(path.join(__dirname,'sheet-snapshot-r111',name+'.json'),'utf8');
    if(raw.length>300000)throw new Error('SSX_R111_OVERSIZED_TAB');
    const obj=JSON.parse(raw);
    if(obj.sheet!==name)throw new Error('SSX_R111_TAB_NAME_MISMATCH');
    result.set(name,cellSource(obj));
  }
  return result;
}
function archiveByGroup(records){
  const groups=new Map();
  for(const [i,row] of records.entries()){
    if(!SHEETS.includes(row?.[9])||row?.[0]!=='Global Top 16')continue;
    const key=row[9]+'|'+row[1];
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push({row,index:i});
  }
  return groups;
}
function refresh(records,tracks,snapshotSources=sources()){
  if(!Array.isArray(records)||records.length<1000||!Array.isArray(tracks)||tracks.length!==83)
    throw new Error('SSX_R111_INCOMPATIBLE_ARCHIVE');
  const groups=archiveByGroup(records),changed=new Map(),skipped=[],report=[];
  for(const [key,group] of groups){
    const [sheetName,trackStr]=key.split('|');
    const trackId=Number(trackStr),track=tracks[trackId];
    if(!Array.isArray(track)||!track[2])throw new Error('SSX_R111_UNKNOWN_TRACK');
    const sheet=snapshotSources.get(sheetName);
    if(!sheet){skipped.push({key,reason:'TAB_NOT_FOUND'});continue;}
    const matchLabel=mappedLabel(track[2]);
    const matching=sheet.labels.filter(x=>x.label===matchLabel);
    if(matching.length!==1){skipped.push({key,reason:'TRACK_LABEL_AMBIGUOUS',matches:matching.length});continue;}
    const start=matching[0].row;
    const following=sheet.labels.find(x=>x.row>start);
    const end=Math.min(start+17,following?following.row-1:start+17);
    const original=new Map(group.map(x=>[x.row[2]+'|'+x.row[3],x.row]));
    const supportedModes=new Set(group.map(x=>x.row[3]));
    const next=[], seen=new Set(), review=[];
    let rankRows=0;
    for(let r=start;r<=end;r++){
      const rawRank=sheet.value(r,3)?.v?.trim()||'';
      if(!/^(?:[1-9]|1[0-6])(?:\.0+)?$/.test(rawRank))continue;
      const rank=Math.round(Number(rawRank));
      rankRows++;
      for(const mode of supportedModes){
        const [scoreCol,riderCol]=MODES[mode]||[];
        if(!scoreCol)continue;
        const score=sheet.value(r,scoreCol)?.v?.trim()||'';
        const rider=sheet.value(r,riderCol)?.v?.trim()||'';
        if(!score&&!rider)continue;
        const m=metric(mode,score);
        if(!m.ok||!rider||rider.length>80||/[\r\n\u0000-\u001f]/.test(rider)){
          review.push({rank,mode,reason:'MALFORMED_SCORE_OR_RIDER'});continue;
        }
        const slot=rank+'|'+mode;
        if(seen.has(slot))throw new Error('SSX_R111_DUPLICATE_POSITION:'+key+':'+slot);
        seen.add(slot);
        const old=original.get(slot);
        const scoreSource=sheet.value(r,scoreCol);
        const evidence=scoreSource?.link||
          ((old&&norm(old[4])===norm(rider)&&
            (String(old[5]).trim()===score||(mode>=2&&metric(mode,old[5]).numeric===m.numeric)))
          ? safeLink(old[8]):'');
        const platform=old?.[7]||'PS3';
        const resultCell=String.fromCharCode(64+scoreCol)+r;
        next.push(['Global Top 16',trackId,rank,mode,rider,score,m.numeric,platform,evidence,sheetName,resultCell]);
      }
    }
    // No silent replacement of a partly parsed tab or a shifted track block.
    if(rankRows<Math.min(6,group.length/2)||next.length<Math.max(3,Math.floor(group.length*0.55))){
      skipped.push({key,reason:'COVERAGE_TOO_LOW',rows:next.length,original:group.length});continue;
    }
    // Invalid source entries are not rewritten: preserve the exact original slot
    // for review rather than assigning someone else's score.
    for(const issue of review){
      const slot=issue.rank+'|'+issue.mode,old=original.get(slot);
      if(old&&!seen.has(slot)){next.push(old);seen.add(slot);}
    }
    next.sort((a,b)=>a[2]-b[2]||a[3]-b[3]);
    changed.set(key,next);
    const originalBySlot=original;
    const updates=next.filter(row=>{
      const old=originalBySlot.get(row[2]+'|'+row[3]);
      return !old||row[4]!==old[4]||row[5]!==old[5]||row[8]!==old[8];
    }).length;
    report.push({key,sourceRows:next.length,priorRows:group.length,updatedOrAdded:updates,review:review.length});
  }
  let output=[],seenGroups=new Set();
  for(const row of records){
    const key=row[9]+'|'+row[1];
    if(changed.has(key)&&row[0]==='Global Top 16'){
      if(!seenGroups.has(key)){output.push(...changed.get(key));seenGroups.add(key);}
    }else output.push(row);
  }
  if(output.length<5400||output.length>6100||report.length<60)throw new Error('SSX_R111_RESULT_INTEGRITY');
  const updated=report.reduce((n,r)=>n+r.updatedOrAdded,0);
  return {records:output,summary:{
    regionCapture:CAPTURED,spreadsheetId:SHEET_ID,regionalGroupsUpdated:report.length,
    regionalRows:report.reduce((n,r)=>n+r.sourceRows,0),changedOrNewRows:updated,
    skippedGroups:skipped,reviewRows:report.reduce((n,r)=>n+r.review,0),
    unchangedOtherCategories:records.filter(r=>!SHEETS.includes(r[9])).length,
    totalRecordsBefore:records.length,totalRecordsAfter:output.length
  }};
}
function locate(html,key){
  const re=new RegExp('(?:let|const|var)\\s+'+key+'\\s*=\\s*','g');
  const m=re.exec(html);if(!m)throw new Error('SSX_R111_LITERAL_MISSING:'+key);
  let at=m.index+m[0].length,quote=false,escape=false,depth=0;
  const start=at;
  if(!'[{' .includes(html[at]))throw new Error('SSX_R111_LITERAL_NOT_JSON:'+key);
  for(;at<html.length;at++){
    const ch=html[at];
    if(quote){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch==='"')quote=false;continue;}
    if(ch==='"'){quote=true;continue;}
    if(ch==='{'||ch==='[')depth++;
    if(ch==='}'||ch===']'){depth--;if(depth===0){
      const end=at+1;return {start,end,value:JSON.parse(html.slice(start,end))};
    }}
  }
  throw new Error('SSX_R111_LITERAL_UNTERMINATED:'+key);
}
function updateHtml(html) {
  const original=locate(html,'G'),tracks=locate(html,'TRACKS'),meta=locate(html,'META'),special=locate(html,'SNG');
  const result=refresh(original.value,tracks.value);
  const m={...meta.value,googleRecords:result.records.length+special.value.length,regionalCapture:CAPTURED,
    regionalGroupsUpdated:result.summary.regionalGroupsUpdated,
    regionalRows:result.summary.regionalRows,regionalSource:SHEET_ID};
  const replacements=[
    {start:original.start,end:original.end,value:JSON.stringify(result.records)},
    {start:meta.start,end:meta.end,value:JSON.stringify(m)}
  ].sort((a,b)=>b.start-a.start);
  let out=html;
  for(const r of replacements)out=out.slice(0,r.start)+r.value+out.slice(r.end);
  const signature=crypto.createHash('sha256').update(JSON.stringify(result.summary)).digest('hex');
  return {html:out,summary:{...result.summary,auditSignature:signature}};
}
module.exports={SHEET_ID,CAPTURED,SHEETS,metric,cellSource,refresh,updateHtml,locate};
