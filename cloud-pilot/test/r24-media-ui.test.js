'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');
const html=read('public/index.html'),ui=read('public/workspace.js'),css=read('public/cloud-ui.css');
const server=read('server.js'),store=read('store.js'),large=read('large-media-store.js');

test('R24 UI: honest file quota, progress, resume and cancel controls',()=>{
 for(const id of ['cloudMediaFile','cloudMediaUpload','cloudMediaRefresh','cloudMediaCancel',
   'cloudMediaProgress','cloudMediaResumeInfo','cloudMediaStatus','cloudMediaItems'])
  assert.ok(html.includes('id="'+id+'"'),'missing '+id);
 assert.match(html,/até 32 MB por arquivo/);
 assert.match(html,/128 MB por conta/);
 assert.match(html,/ZIPs de 1 GB ainda exigem/);
 assert.match(html,/aria-label="Progresso de envio ao cofre"/);
 assert.match(css,/cloudMediaProgress/);
 assert.match(css,/#cloudMediaProgress\[hidden\]/);
 assert.doesNotMatch(css,/!important/);
});
test('R24 UI: uploads native binary chunks, SHA-256, account resume without local secrets',()=>{
 for(const expr of [
  /file\.slice\(begin,end\)\.arrayBuffer\(\)/,/crypto\.subtle\.digest\('SHA-256'/,
  /application\/octet-stream/,/X-Chunk-Sha256/,
  /\/api\/media\/uploads/,/pendingMediaUpload/,/upload\.nextIndex/,
  /AbortController/,/mediaAbort\.abort\(\)/,/cancelMediaUpload/,
  /progressMedia\(100\*/,/getElementById|byId\('cloudMediaFile'\)/
 ])assert.match(ui,expr);
 assert.doesNotMatch(ui,/btoa\(|localStorage|sessionStorage|\.sendMessage\(/i);
 assert.match(ui,/cloudMediaCancel.*addEventListener\('click',cancelMediaUpload\)/);
});
test('R24 server: quota, auth, atomic finalization and private media download',()=>{
 assert.match(server,/if\(!await activated\(user\)\)/);
 assert.match(server,/originAllowed\(req\)/);
 assert.match(server,/pathname==='\/api\/media\/uploads'/);
 assert.match(server,/store\.large\.begin\(user\.email/);
 assert.match(server,/store\.large\.append\(user\.email/);
 assert.match(server,/store\.large\.finish\(user\.email/);
 assert.match(server,/store\.large\.cancel\(user\.email/);
 assert.match(server,/store\.removeMediaIfUnlinked\(user\.email/);
 assert.match(store,/withMediaFence/);
 assert.match(store,/mediaFences\.updateOne/);
 assert.match(server,/validateLargeDownload/);
 assert.match(server,/checkLibraryRecords\(records,\[\.\.\.vault\.items/);
 assert.match(server,/checkLibraryRecords\(modules\.library,\[\.\.\.vault\.items/);
 assert.match(large,/session\.withTransaction/);
 assert.match(large,/upload_finalizing/);
 assert.match(large,/expiresAt/);
 assert.match(store,/createMongoLargeMediaStore\(db,client\)/);
 assert.doesNotMatch(server,/\/api\/send['"]/);
});
