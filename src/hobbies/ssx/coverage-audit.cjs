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
        _events:new Set(),_tracks:new Set(),_firstTracks:new Set(),_trackCounts:new Map()
      });
    }
    const row=groups.get(key);
    const checked=evidence.rows[i];
    row.records++;
    if(checked.status===statuses.invalid)row.invalidRecords++;
    const event=clean(record.eventId),track=clean(record.trackId);
    if(event)row._events.add(event);
    if(track){
      const trackKey=JSON.stringify([event,track]);
      row._tracks.add(trackKey);
      row._trackCounts.set(trackKey,(row._trackCounts.get(trackKey)||0)+1);
    }
    if(record.position===1&&checked.status!==statuses.invalid){
      row.firstPlaces++;
      row._firstTracks.add(JSON.stringify([event,track]));
    }
    if(record.proofUrl&&checked.status!==statuses.invalid)row.withProof++;
    if(checked.status===statuses.confirmed)row.identityConfirmed++;
    else if(checked.status===statuses.review)row.identityNameDiff++;
    else row.identityUnresolved++;
  }
  const actualTrackCounts=new Map();
  const rows=[...groups.values()].map(row=>{
    actualTrackCounts.set(row.key,new Map(row._trackCounts));
    row.uniqueEvents=row._events.size;
    row.uniqueTracks=row._tracks.size;
    row.firstPlaceTracks=row._firstTracks.size;
    delete row._events;delete row._tracks;delete row._firstTracks;delete row._trackCounts;
    return row;
  }).sort((a,b)=>a.platform.localeCompare(b.platform)||a.mode.localeCompare(b.mode)||a.variant.localeCompare(b.variant));
  // Coverage certification requires an independently established manifest.
  // A subset of valid first-place rows must not certify itself as a full capture.
  const present=new Set(rows.map(row=>row.key));
  const expected=new Map(),missingExpected=[],invalidExpectations=[];
  const unexpectedCategories=[],mismatchedExpected=[];
  for(const [i,category] of expectedCategories.entries()){
    if(!isValidCategory(category)||!Number.isSafeInteger(category.recordCount)||category.recordCount<1
      ||!Array.isArray(category.tracks)||category.tracks.length===0){
      invalidExpectations.push(i);continue;
    }
    const key=categoryKey(category),tracks=new Map();
    let valid=true,sum=0;
    for(const t of category.tracks){
      const eventId=clean(t?.eventId),trackId=clean(t?.trackId),count=t?.recordCount;
      if(!eventId||!trackId||!Number.isSafeInteger(count)||count<1){valid=false;break;}
      const trackKey=JSON.stringify([eventId,trackId]);
      if(tracks.has(trackKey)){valid=false;break;}
      tracks.set(trackKey,count);
      sum+=count;
    }
    if(!valid||sum!==category.recordCount||expected.has(key)){
      invalidExpectations.push(i);continue;
    }
    expected.set(key,{category,tracks});
  }
  for(const [key,{category}] of expected){
    if(!present.has(key)){
      const [platform,mode,variant]=categoryTuple(category);
      missingExpected.push({key,platform,mode,variant,reason:'NOT_PRESENT_IN_SHEET_SNAPSHOT'});
    }
  }
  for(const row of rows){
    const requirement=expected.get(row.key);
    if(!requirement){
      unexpectedCategories.push({key:row.key,platform:row.platform,mode:row.mode,variant:row.variant});
      continue;
    }
    const observed=actualTrackCounts.get(row.key)||new Map();
    const missingTracks=[...requirement.tracks.keys()].filter(key=>!observed.has(key));
    const unexpectedTracks=[...observed.keys()].filter(key=>!requirement.tracks.has(key));
    const wrongTrackCounts=[...requirement.tracks].filter(([key,count])=>observed.has(key)&&observed.get(key)!==count)
      .map(([key,expectedRecords])=>({key,expectedRecords,observedRecords:observed.get(key)}));
    if(row.records!==requirement.category.recordCount||missingTracks.length||unexpectedTracks.length||wrongTrackCounts.length){
      mismatchedExpected.push({key:row.key,expectedRecords:requirement.category.recordCount,
        observedRecords:row.records,missingTracks,unexpectedTracks,wrongTrackCounts});
    }
  }
  const coverageManifestMatchesSnapshot=expected.size>0&&invalidExpectations.length===0
    &&missingExpected.length===0&&unexpectedCategories.length===0&&mismatchedExpected.length===0;
  const colliding=new Set(evidence.eventPositionCollisions.map(row=>row.key));
  const tracksWithoutFirstPlace=rows.reduce((n,row)=>n+row.uniqueTracks-row.firstPlaceTracks,0);
  // Fail closed: empty or incomplete captures never certify historical leaders.
  const completeFirstPlaces=rows.length>0&&rows.every(row=>row.uniqueTracks>0
    &&row.firstPlaces===row.uniqueTracks&&row.firstPlaceTracks===row.uniqueTracks
    &&row.invalidRecords===0);
  return {
    schemaVersion:1,
    kind:'ssx-category-coverage-audit',
    evidenceHashes:evidence.snapshots,
    totals:{
      sheetRecords:evidence.totalSheetsRecords,
      categories:rows.length,
      firstPlaces:rows.reduce((n,row)=>n+row.firstPlaces,0),
      missingExpectedCategories:missingExpected.length,
      unexpectedCategories:unexpectedCategories.length,
      mismatchedExpectedCategories:mismatchedExpected.length,
      expectedManifestCategories:expected.size,
      invalidCategoryRows:badCategoryKeys.length,
      ambiguousEventPositions:colliding.size,
      tracksWithoutFirstPlace,
      duplicateRecordIds:evidence.duplicateRecordIds.length,
      identitiesConfirmed:evidence.summary[statuses.confirmed],
      identitiesNameDifferences:evidence.summary[statuses.review],
      identitiesUnresolved:evidence.totalSheetsRecords-evidence.summary[statuses.confirmed]-evidence.summary[statuses.review]
    },
    categories:rows,
    missingExpected,
    unexpectedCategories,
    mismatchedExpected,
    invalidExpectations,
    invalidCategoryRows:badCategoryKeys,
    eventPositionCollisions:evidence.eventPositionCollisions,
    duplicateRecordIds:evidence.duplicateRecordIds,
    safeguards:{
      coverageManifestMatchesSnapshot,
      canCertifyLeaders:coverageManifestMatchesSnapshot&&completeFirstPlaces&&
        evidence.summary[statuses.invalid]===0&&
        evidence.eventPositionCollisions.length===0&&
        evidence.duplicateRecordIds.length===0&&
        invalidExpectations.length===0&&badCategoryKeys.length===0&&
        missingExpected.length===0,
      canCertifyRiderNames:coverageManifestMatchesSnapshot&&evidence.totalSheetsRecords>0&&
        evidence.summary[statuses.confirmed]===evidence.totalSheetsRecords&&
        evidence.duplicateRecordIds.length===0&&
        evidence.sameIdMultipleSheetNames.length===0&&
        evidence.eventPositionCollisions.length===0&&
        evidence.invalidOzmonetProfiles.length===0,
      changesApplied:0,
      crossTrackTimeRanking:false,
      manualReviewRequired:true
    }
  };
}
module.exports={groupCoverage,categoryTuple,categoryKey,isValidCategory};
