'use strict';
/**
 * Evidence-coverage audit for SSX 2012.
 * Read-only; categories must come from explicit source rows or reviewer policy,
 * never from inferred rider names or old page navigation.
 */
const {reconcile,VALID_MODES,statuses}=require('./reconciliation-core.cjs');

function clean(value){return typeof value==='string'?value.trim():'';}
function categoryTuple(r){
  return [clean(r.platform),clean(r.mode),clean(r.variant)||'standard'];
}
function categoryKey(r){return JSON.stringify(categoryTuple(r));}
function isValidCategory(r){
  if(!r||typeof r!=='object')return false;
  const [platform,mode]=categoryTuple(r);
  return Boolean(platform&&mode&&VALID_MODES.has(mode));
}
function groupCoverage(sheets,oz,expectedCategories=[]){
  if(!Array.isArray(expectedCategories))throw new TypeError('expectedCategories must be an array');
  // Run the strict source + identity checks before any aggregation.
  const evidence=reconcile(sheets,oz);
  const groups=new Map(),badCategoryKeys=[];
  for(const [i,record] of sheets.records.entries()){
    if(!isValidCategory(record)){
      badCategoryKeys.push({index:i,recordId:clean(record?.recordId)||String(i)});
      continue;
    }
    const [platform,mode,variant]=categoryTuple(record);
    const key=categoryKey(record);
    if(!groups.has(key)){
      groups.set(key,{
        key,platform,mode,variant,
        records:0,uniqueEvents:0,uniqueTracks:0,firstPlaces:0,
        firstPlaceTracks:0,withProof:0,
        identityConfirmed:0,identityNameDiff:0,identityUnresolved:0,
        invalidRecords:0,
        _events:new Set(),_tracks:new Set(),_firstTracks:new Set()
      });
    }
    const row=groups.get(key);
    const checked=evidence.rows[i];
    row.records++;
    if(checked.status===statuses.invalid)row.invalidRecords++;
    const event=clean(record.eventId),track=clean(record.trackId);
    if(event)row._events.add(event);
    if(track)row._tracks.add(JSON.stringify([event,track]));
    if(record.position===1&&checked.status!==statuses.invalid){
      row.firstPlaces++;
      row._firstTracks.add(JSON.stringify([event,track]));
    }
    if(record.proofUrl&&checked.status!==statuses.invalid)row.withProof++;
    if(checked.status===statuses.confirmed)row.identityConfirmed++;
    else if(checked.status===statuses.review)row.identityNameDiff++;
    else row.identityUnresolved++;
  }
  const rows=[...groups.values()].map(row=>{
    row.uniqueEvents=row._events.size;
    row.uniqueTracks=row._tracks.size;
    row.firstPlaceTracks=row._firstTracks.size;
    delete row._events;delete row._tracks;delete row._firstTracks;
    return row;
  }).sort((a,b)=>a.platform.localeCompare(b.platform)||a.mode.localeCompare(b.mode)||a.variant.localeCompare(b.variant));
  const present=new Set(rows.map(row=>row.key)),missingExpected=[],invalidExpectations=[];
  for(const [i,category] of expectedCategories.entries()){
    if(!isValidCategory(category)){
      invalidExpectations.push(i);
      continue;
    }
    const key=categoryKey(category);
    if(!present.has(key)&&!missingExpected.some(m=>m.key===key)){
      const [platform,mode,variant]=categoryTuple(category);
      missingExpected.push({key,platform,mode,variant,reason:'NOT_PRESENT_IN_SHEET_SNAPSHOT'});
    }
  }
  const colliding=new Set(evidence.eventPositionCollisions.map(row=>row.key));
  return {
    schemaVersion:1,
    kind:'ssx-category-coverage-audit',
    evidenceHashes:evidence.snapshots,
    totals:{
      sheetRecords:evidence.totalSheetsRecords,
      categories:rows.length,
      firstPlaces:rows.reduce((n,row)=>n+row.firstPlaces,0),
      missingExpectedCategories:missingExpected.length,
      invalidCategoryRows:badCategoryKeys.length,
      ambiguousEventPositions:colliding.size,
      identitiesConfirmed:evidence.summary[statuses.confirmed],
      identitiesNameDifferences:evidence.summary[statuses.review],
      identitiesUnresolved:evidence.totalSheetsRecords-evidence.summary[statuses.confirmed]-evidence.summary[statuses.review]
    },
    categories:rows,
    missingExpected,
    invalidExpectations,
    invalidCategoryRows:badCategoryKeys,
    eventPositionCollisions:evidence.eventPositionCollisions,
    safeguards:{
      canCertifyLeaders:evidence.summary[statuses.invalid]===0&&
        evidence.eventPositionCollisions.length===0&&missingExpected.length===0,
      canCertifyRiderNames:evidence.summary[statuses.conflicting]===0&&
        evidence.summary[statuses.invalid]===0&&
        evidence.summary[statuses.noId]===0&&
        evidence.summary[statuses.notFound]===0&&
        evidence.summary[statuses.review]===0,
      changesApplied:0,
      crossTrackTimeRanking:false,
      manualReviewRequired:true
    }
  };
}
module.exports={groupCoverage,categoryTuple,categoryKey,isValidCategory};
