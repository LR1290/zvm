/**
 * SSX 2012 · Google Apps Script Bridge v8 (read-only foundation)
 *
 * Attach this project to the OFFICIAL SSX 2012 workbook, or set
 * SPREADSHEET_ID in Script Properties. Deploy as Web App /exec.
 * This bridge never writes to any sheet. Administrative mutations are
 * intentionally unavailable until an authenticated protocol is reviewed.
 */
var SSX_BRIDGE_VERSION = 8;
var SSX_REGIONS = ['AFRICA','ALASKA','ALPS','ANTARCTICA','HIMALAYAS',
  'JAPAN','MOUNT EDDIE','NEW ZEALAND','PATAGONIA','ROCKIES','SIBERIA'];
var SSX_MAX_ROWS = 170;
var SSX_MAX_COLUMNS = 19;

function ssxJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function ssxBook_() {
  var configured = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (configured) return SpreadsheetApp.openById(configured);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('SPREADSHEET_NOT_CONFIGURED');
  return active;
}
function ssxRegion_(value) {
  var name = String(value || '').trim().toUpperCase().replace(/_/g,' ');
  if (SSX_REGIONS.indexOf(name) < 0) throw new Error('UNKNOWN_REGION');
  return name;
}
function ssxReadRegion_(book, region) {
  var name = ssxRegion_(region);
  var tab = book.getSheetByName(name) || book.getSheetByName(name.replace(/ /g,'_'));
  if (!tab) throw new Error('REGION_TAB_NOT_FOUND');
  var nr = Math.min(SSX_MAX_ROWS, tab.getLastRow());
  var nc = Math.min(SSX_MAX_COLUMNS, tab.getLastColumn());
  if (!nr || !nc) return {region:name,rows:[],rowCount:0,columnCount:0};
  var grid = tab.getRange(1,1,nr,nc).getDisplayValues();
  // Values only: never disclose formulas, Drive IDs, owner information,
  // protected notes or script properties.
  return {region:name,rows:grid,rowCount:nr,columnCount:nc};
}
function doGet(e) {
  try {
    var q = (e && e.parameter) || {};
    var action = String(q.action || 'ping').toLowerCase();
    if (action === 'ping') return ssxJson_({
      ok:true,version:SSX_BRIDGE_VERSION,readOnly:true,
      service:'ssx2012-google-sheets-bridge'
    });
    if (action !== 'manifest' && action !== 'region')
      return ssxJson_({ok:false,version:SSX_BRIDGE_VERSION,error:'UNSUPPORTED_ACTION'});
    var book = ssxBook_();
    if (action === 'manifest') return ssxJson_({
      ok:true,version:SSX_BRIDGE_VERSION,readOnly:true,regions:SSX_REGIONS,
      updatedAt:new Date().toISOString()
    });
    var data = ssxReadRegion_(book,q.region);
    return ssxJson_({ok:true,version:SSX_BRIDGE_VERSION,readOnly:true,data:data});
  } catch (err) {
    return ssxJson_({ok:false,version:SSX_BRIDGE_VERSION,
      error:String(err && err.message || 'BRIDGE_ERROR').replace(/[^A-Z0-9_]/gi,'_').slice(0,80)});
  }
}
function doPost(e) {
  return ssxJson_({ok:false,version:SSX_BRIDGE_VERSION,error:'WRITE_DISABLED'});
}
