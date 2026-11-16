'use strict';
// R27 shared quota invariant across legacy media, chunked files and active uploads.
// No billing counters are trusted: account usage is derived from storage in the
// same transaction / per-account fence as the mutation.
const Large=require('./large-media-domain');
function fail(code){const error=new Error(code);error.code=code;throw error;}
function sum(records){
 if(!Array.isArray(records))fail('media_quota_state_invalid');
 let bytes=0;
 for(const row of records){
  if(!row||!Number.isSafeInteger(row.size)||row.size<0)fail('media_quota_state_invalid');
  bytes+=row.size;
  if(!Number.isSafeInteger(bytes))fail('media_quota_state_invalid');
 }
 return bytes;
}
function budget(legacy=[],chunked=[],pending=null){
 const usedBytes=sum(legacy)+sum(chunked);
 const usedItems=legacy.length+chunked.length;
 if(!Number.isSafeInteger(usedBytes))fail('media_quota_state_invalid');
 const reservedBytes=pending?sum([pending]):0;
 const reservedItems=pending?1:0;
 return {usedBytes,usedItems,reservedBytes,reservedItems,
  availableBytes:Math.max(0,Large.MAX_ACCOUNT-usedBytes-reservedBytes),
  availableItems:Math.max(0,Large.MAX_ITEMS-usedItems-reservedItems)};
}
function enforce(legacy=[],chunked=[],pending=null){
 const q=budget(legacy,chunked,pending);
 if(q.usedItems+q.reservedItems>Large.MAX_ITEMS)fail('media_item_quota');
 if(q.usedBytes+q.reservedBytes>Large.MAX_ACCOUNT)fail('media_storage_quota');
 return q;
}
module.exports={budget,enforce};
