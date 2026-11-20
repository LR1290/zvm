/**
 * SSX 2012 · Google Apps Script Bridge v8 (read-only foundation)
 *
 * Attach this project to the OFFICIAL SSX 2012 workbook, or set
 * SPREADSHEET_ID in Script Properties. Deploy as Web App /exec.
 * This bridge never writes to any sheet. Administrative mutations are
 * intentionally unavailable until an authenticated protocol is reviewed.
 */
var SSX_BRIDGE_VERSION = 8;
var SSX_EXPECTED_SHEET_ID = '1SAk84oy05R0UK3JJ_JWJTskSqxj4GpGJkdRqfSmnx2I';
var SSX_REGIONS = ['AFRICA','ALASKA','ALPS','ANTARCTICA','HIMALAYAS',
  'JAPAN','MOUNT_EDDIE','NEW_ZEALAND','PATAGONIA','ROCKIES','SIBERIA'];
var SSX_MAX_PAGE_ROWS = 100;
var SSX_MAX_COLUMNS = 19;

function ssxJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function ssxBook_() {
  var configured = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  var book = configured ? SpreadsheetApp.openById(configured) : SpreadsheetApp.getActiveSpreadsheet();
  if (!book || book.getId() !== SSX_EXPECTED_SHEET_ID)
    throw new Error('OFFICIAL_SPREADSHEET_NOT_CONNECTED');
  return book;
}
function ssxRegion_(value) {
  var name = String(value || '').trim().toUpperCase().replace(/ /g,'_');
  if (SSX_REGIONS.indexOf(name) < 0) throw new Error('UNKNOWN_REGION');
  return name;
}
function ssxReadRegion_(book, region, startRow, limit) {
  var name = ssxRegion_(region);
  var tab = book.getSheetByName(name);
  if (!tab) throw new Error('REGION_TAB_NOT_FOUND');
  var totalRows = tab.getLastRow();
  var nc = Math.min(SSX_MAX_COLUMNS, tab.getLastColumn());
  var offset = Number(startRow || 1);
  var requested = Number(limit || SSX_MAX_PAGE_ROWS);
  if (!Number.isSafeInteger(offset) || offset < 1 || !Number.isSafeInteger(requested) || requested < 1 || requested > SSX_MAX_PAGE_ROWS)
    throw new Error('INVALID_PAGE');
  var nr = Math.max(0, Math.min(requested, totalRows - offset + 1));
  if (!nr || !nc) return {region:name,rows:[],rowCount:totalRows,columnCount:nc,startRow:offset,nextRow:null};
  var grid = tab.getRange(offset,1,nr,nc).getDisplayValues();
  // Values only: never disclose formulas, Drive IDs, owner information,
  // protected notes or script properties.
  return {region:name,rows:grid,rowCount:totalRows,columnCount:nc,startRow:offset,nextRow:offset + nr <= totalRows ? offset + nr : null};
}
function doGet(e) {
  try {
    var q = (e && e.parameter) || {};
    var action = String(q.action || 'ping').toLowerCase();
    if (action === 'ping') {
      ssxBook_(); // A healthy /exec must have access to the correct workbook.
      return ssxJson_({
      ok:true,version:SSX_BRIDGE_VERSION,readOnly:true,
      service:'ssx2012-google-sheets-bridge'
    });
    }
    if (action !== 'manifest' && action !== 'region')
      return ssxJson_({ok:false,version:SSX_BRIDGE_VERSION,error:'UNSUPPORTED_ACTION'});
    var book = ssxBook_();
    if (action === 'manifest') return ssxJson_({
      ok:true,version:SSX_BRIDGE_VERSION,readOnly:true,regions:SSX_REGIONS,
      updatedAt:new Date().toISOString()
    });
    var data = ssxReadRegion_(book,q.region,q.startRow,q.limit);
    return ssxJson_({ok:true,version:SSX_BRIDGE_VERSION,readOnly:true,data:data});
  } catch (err) {
    return ssxJson_({ok:false,version:SSX_BRIDGE_VERSION,
      error:String(err && err.message || 'BRIDGE_ERROR').replace(/[^A-Z0-9_]/gi,'_').slice(0,80)});
  }
}
function doPost(e) {
  return ssxJson_({ok:false,version:SSX_BRIDGE_VERSION,error:'WRITE_DISABLED'});
}
