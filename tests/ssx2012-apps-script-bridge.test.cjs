'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../integrations/ssx2012/apps-script/Code.gs'),'utf8');
const ID='1SAk84oy05R0UK3JJ_JWJTskSqxj4GpGJkdRqfSmnx2I';
function setup(options={}) {
  const calls=[];
  const tab={getLastRow:()=>806,getLastColumn:()=>33,
    getRange:(row,col,nr,nc)=>{calls.push([row,col,nr,nc]);return {getDisplayValues:()=>Array.from({length:nr},(_,i)=>[String(row+i),'Rider'])};}};
  const book={getId:()=>options.sheetId||ID,getSheetByName:name=>name==='MOUNT_EDDIE'?tab:null};
  const context={
    SpreadsheetApp:{getActiveSpreadsheet:()=>book,openById:()=>book},
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>''})},
    ContentService:{MimeType:{JSON:'application/json'},createTextOutput:s=>({text:s,setMimeType(){return this;}})},
    Date,Number,JSON,String,Error
  };
  vm.createContext(context);vm.runInContext(script,context);
  const call=query=>JSON.parse(context.doGet({parameter:query}).text);
  return {call,calls,post:()=>JSON.parse(context.doPost({}).text)};
}
test('Bridge ping validates the exact official workbook',()=>{
  assert.equal(setup().call({action:'ping'}).version,8);
  assert.equal(setup({sheetId:'different'}).call({action:'ping'}).ok,false);
});
test('Bridge reads bounded pages without silently truncating a region',()=>{
  const x=setup();
  const first=x.call({action:'region',region:'MOUNT_EDDIE',startRow:'1',limit:'100'});
  assert.equal(first.ok,true);assert.equal(first.data.rowCount,806);
  assert.equal(first.data.rows.length,100);assert.equal(first.data.nextRow,101);
  const last=x.call({action:'region',region:'MOUNT EDDIE',startRow:'801',limit:'100'});
  assert.equal(last.data.rows.length,6);assert.equal(last.data.nextRow,null);
  assert.deepEqual(x.calls,[[1,1,100,19],[801,1,6,19]]);
});
test('Bridge rejects untrusted regions, unbounded pages and writes',()=>{
  const x=setup();
  assert.equal(x.call({action:'region',region:'WEB_ADMIN_LOG'}).ok,false);
  assert.equal(x.call({action:'region',region:'MOUNT_EDDIE',limit:'1000'}).ok,false);
  assert.equal(x.post().error,'WRITE_DISABLED');
  assert.deepEqual(x.calls,[]);
});
