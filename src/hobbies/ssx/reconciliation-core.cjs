'use strict';
/**
 * Strict, read-only reconciliation of separately captured evidence snapshots.
 * Sheets owns all record facts. Ozmonet supplies aliases ONLY when an exact
 * in-game numeric ID is unambiguous and its profile URL matches that ID.
 * Never modifies either snapshot or produces a write-back plan.
 */
const crypto=require('node:crypto');
const SHEET_ID='1SAk84oy05R0UK3JJ_JWJTskSqxj4GpGJkdRqfSmnx2I';
const VALID_MODES=new Set(['board','wings','trick','survive','special','android','dev','level9','no_boost','no_gear','no_wings','no_rewinds']);
const statuses=Object.freeze({
  confirmed:'ID_CONFIRMED_NAME_MATCH',
  review:'ID_CONFIRMED_NAME_DIFF',
  noId:'NO_STABLE_ID',
  notFound:'ID_NOT_IN_OZMONET',
  conflicting:'ID_CONFLICT_IN_OZMONET',
  invalid:'INVALID_EVIDENCE'
});
function safeStr(v){return typeof v==='string'?v.trim():'';}
function numericId(v){
  if(typeof v==='number'&&!Number.isSafeInteger(v))return '';
  const value=String(v??'').trim();
  return /^\d{1,20}$/.test(value)&&value!=='0'?value:'';
}
function validDate(v){return typeof v==='string'&&!Number.isNaN(Date.parse(v))&&/\d{4}-\d\d-\d\dT/.test(v);}
function isWebUrl(v){try{const u=new URL(v);return u.protocol==='https:';}catch(_){return false;}}
function normalizeName(s){return safeStr(s).normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g,' ');}
function sha(value){return crypto.createHash('sha256').update(value).digest('hex');}
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function validateSnapshot(snapshot,kind){
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw new Error(kind+': snapshot object required');
  if(snapshot.kind!==kind)throw new Error(kind+': invalid kind');
  if(!validDate(snapshot.capturedAt))throw new Error(kind+': capturedAt must be ISO date/time');
  if(!isWebUrl(snapshot.sourceUrl))throw new Error(kind+': sourceUrl must use HTTPS');
  const u=new URL(snapshot.sourceUrl);
  if(kind==='google_sheets'){
    if(u.hostname!=='docs.google.com'||!u.pathname.includes('/spreadsheets/d/'+SHEET_ID+'/'))throw new Error('Google Sheets: wrong spreadsheet ID or host');
    if(!Array.isArray(snapshot.records))throw new Error('Google Sheets: records must be array');
  }else{
    if(!['ssx.ozmonet.com','www.ssx.ozmonet.com'].includes(u.hostname))throw new Error('Ozmonet: wrong host');
    if(!Array.isArray(snapshot.players))throw new Error('Ozmonet: players must be array');
  }
}
function validOzProfile(p){
  if(!p||typeof p!=='object')return false;
  const id=numericId(p.playerId),name=safeStr(p.gamertag);
  if(!id||!name||!isWebUrl(p.profileUrl))return false;
  const u=new URL(p.profileUrl);
  return u.hostname==='ssx.ozmonet.com'&&u.pathname.replace(/\/$/,'')==='/user/'+id;
}
function profileIndex(players){
  const index=new Map(),rejected=[];
  for(const [i,player] of players.entries()){
    if(!validOzProfile(player)){rejected.push({index:i,reason:'INVALID_PROFILE_EVIDENCE'});continue;}
    const id=numericId(player.playerId);
    if(!index.has(id))index.set(id,new Map());
    const variants=index.get(id);const name=safeStr(player.gamertag);
    if(!variants.has(name))variants.set(name,player.profileUrl);
  }
  return {index,rejected};
}
function validRecord(r){
  if(!r||typeof r!=='object')return false;
  if(!safeStr(r.recordId)||!safeStr(r.eventId)||!safeStr(r.trackId)||!safeStr(r.mode))return false;
  if(!VALID_MODES.has(r.mode)||!safeStr(r.platform)||!safeStr(r.riderName))return false;
  if(!Number.isSafeInteger(r.position)||r.position<1)return false;
  if(typeof r.value!=='string'||!r.value.trim())return false;
  if(r.proofUrl&&!isWebUrl(r.proofUrl))return false;
  return true;
}
// A JSON tuple is injective; delimiter escaping collides for literal '%7C' values.
function recordKey(r){return JSON.stringify([r.platform,r.mode,r.variant||'standard',r.eventId,r.trackId,r.position]);}
function reconcile(sheets,oz){
  validateSnapshot(sheets,'google_sheets');validateSnapshot(oz,'ozmonet');
  const {index:aliases,rejected:invalidProfiles}=profileIndex(oz.players);
  const ids=new Map(),recordIds=new Map(),results=[],summary={};
  for(const status of Object.values(statuses))summary[status]=0;
  const collisions=new Map();
  for(const [i,r] of sheets.records.entries()){
    const item={recordId:safeStr(r?.recordId)||String(i),sourceIndex:i,source:'google_sheets',status:'',originalRiderName:safeStr(r?.riderName),ozmonetName:null,playerId:numericId(r?.playerId)||null,profileUrl:null,eventKey:null,note:null};
    const stableRecordId=safeStr(r?.recordId);
    if(stableRecordId){
      if(!recordIds.has(stableRecordId))recordIds.set(stableRecordId,[]);
      recordIds.get(stableRecordId).push(i);
    }
    if(!validRecord(r)){
      item.status=statuses.invalid;item.note='Record lacks required category/event/score/position metadata';
    }else{
      item.eventKey=recordKey(r);
      const id=numericId(r.playerId);
      if(r.playerId!=null&&!id){item.status=statuses.invalid;item.note='Malformed or non-numeric ID';}
      else if(!id){item.status=statuses.noId;item.note='No in-game ID; do not use fuzzy name matching';}
      else if(!aliases.has(id)){item.status=statuses.notFound;item.note='ID not in the supplied Ozmonet snapshot';}
      else{
        const matches=aliases.get(id);
        if(matches.size!==1){item.status=statuses.conflicting;item.note='Multiple names associated with the same in-game ID';}
        else{
          const [name,url]=[...matches][0];
          item.ozmonetName=name;item.profileUrl=url;
          item.status=normalizeName(name)===normalizeName(r.riderName)?statuses.confirmed:statuses.review;
        }
      }
      if(!collisions.has(item.eventKey))collisions.set(item.eventKey,[]);
      collisions.get(item.eventKey).push(item.recordId);
      if(id){if(!ids.has(id))ids.set(id,new Set());ids.get(id).add(item.originalRiderName);}
    }
    summary[item.status]++;
    results.push(item);
  }
  const eventPositionCollisions=[...collisions].filter(([,arr])=>arr.length>1).map(([key,recordIds])=>({key,recordIds}));
  const sameIdMultipleSheetNames=[...ids].filter(([,names])=>names.size>1).map(([playerId,names])=>({playerId,names:[...names].sort()}));
  const duplicateRecordIds=[...recordIds].filter(([,indices])=>indices.length>1)
    .map(([recordId,indices])=>({recordId,indices}));
  return {
    schemaVersion:1,kind:'ssx-reconciliation-audit',
    authority:{records:'google_sheets',identities:'ozmonet_exact_in_game_id'},
    snapshots:{googleSheets:{sourceUrl:sheets.sourceUrl,capturedAt:sheets.capturedAt,sha256:sha(canonical(sheets))},ozmonet:{sourceUrl:oz.sourceUrl,capturedAt:oz.capturedAt,sha256:sha(canonical(oz))}},
    totalSheetsRecords:sheets.records.length,
    validOzmonetProfiles:[...aliases.values()].reduce((n,m)=>n+m.size,0),
    summary,manualReviewCandidates:summary[statuses.review],
    invalidOzmonetProfiles:invalidProfiles,eventPositionCollisions,sameIdMultipleSheetNames,duplicateRecordIds,
    rows:results,
    safeguards:{changesApplied:0,automaticRenames:false,fuzzyMatches:false,preserveSheetScores:true,needsHumanApproval:true}
  };
}
module.exports={reconcile,recordKey,numericId,normalizeName,validOzProfile,VALID_MODES,statuses};
