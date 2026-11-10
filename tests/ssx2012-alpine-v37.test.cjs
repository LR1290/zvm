
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const zlib=require('node:zlib');
const vm=require('node:vm');
const path=require('node:path');
const {test}=require('node:test');
const {once}=require('node:events');
const {serveSSX2012,SSX_ROUTE,SSX_V36_ARCHIVE_ROUTE,SSX_V37_PREVIEW_ROUTE}=require('../src/hobbies/ssx/route');

async function harness(action){
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    if(!serveSSX2012(req,res,pathname)){res.writeHead(404);res.end();}
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  try {return await action(base);} finally {await new Promise(resolve=>server.close(resolve));}
}
function rawFetch(uri,accept='identity',method='GET'){
  return new Promise((resolve,reject)=>{
    const req=http.request(uri,{method,headers:{'Accept-Encoding':accept}},res=>{
      const chunks=[];
      res.on('data',c=>chunks.push(c));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
      res.on('error',reject);
    });req.on('error',reject);req.end();
  });
}
test('Alpine assets parse and have no remote scripts or credential material',()=>{
  const dir=path.join(__dirname,'../src/hobbies/ssx');
  const css=fs.readFileSync(path.join(dir,'alpine-v37.css'),'utf8');
  const js=fs.readFileSync(path.join(dir,'alpine-v37.js'),'utf8');
  assert.doesNotThrow(()=>new vm.Script(js,{filename:'alpine-v37.js'}));
  assert.match(css,/prefers-reduced-motion/);
  assert.doesNotMatch(css,/!important/i);
  assert.match(css,/@media \(max-width:620px\)/);
  assert.doesNotMatch(js,/<\/script/i);
  assert.doesNotMatch(css,/<\/style/i);
  assert.doesNotMatch(js,/fetch\s*\(|XMLHttpRequest|WebSocket|document\.cookie/);
  for(const mode of ['board','wings','trick','survive','special','all']){
    assert.match(css,new RegExp('data-ssx-mode="'+mode+'"'));
  }
});
test('published v37 and preview are byte-identical; archival v36 remains byte-exact',()=>harness(async base=>{
  const original=await rawFetch(base+SSX_V36_ARCHIVE_ROUTE);
  const enhanced=await rawFetch(base+SSX_V37_PREVIEW_ROUTE);
  const published=await rawFetch(base+SSX_ROUTE);
  assert.equal(published.status,200);
  assert.equal(published.headers['x-ssx-variant'],'ssx-ui-v38');
  assert.equal(published.headers['cache-control'],'public, max-age=300');
  assert.deepEqual(published.body,enhanced.body, 'Published and tested preview versions must be identical');
  assert.notEqual(published.headers.etag,enhanced.headers.etag);
  assert.equal(original.headers['x-ssx-variant'],'v36-archive');
  assert.equal(original.status,200);assert.equal(enhanced.status,200);
  assert.equal(enhanced.headers['x-ssx-variant'],'ssx-ui-v38-preview');
  assert.equal(enhanced.headers['cache-control'],'no-store');
  assert.equal(original.headers['cache-control'],'public, max-age=300');
  assert.notEqual(original.headers.etag,enhanced.headers.etag);
  assert.match(enhanced.headers['content-security-policy'],/sandbox allow-scripts/);
  assert.doesNotMatch(enhanced.headers['content-security-policy'],/allow-same-origin/);
  assert.match(enhanced.headers['x-robots-tag'],/noindex/);
  const baseline=original.body.toString('utf8');
  const view=enhanced.body.toString('utf8');
  assert.match(view,/id="ssx-alpine-v37-style"/);
  assert.match(view,/id="ssx-v38-design"/);
  assert.match(view,/ssx-alpine-v38/);
  assert.match(view,/id="ssx-alpine-v37-script"/);
  assert.match(view,/id="ssx-score-integrity-script"/);
  assert.match(view,/id="ssx-special-categories-v1-script"/);
  assert.match(view,/id="ssx-special-leaders-core-script"/);
  assert.match(view,/id="sheet"/);
  assert.match(view,/id="sourceSeg"/);
  const originalTitle=baseline.match(/<title>[^<]*<\/title>/i);
  assert.ok(originalTitle);
  const stripped=view
    .replace(/<style id="ssx-first-paint-style">[\s\S]*?<\/style>/,'')
    .replace(/<script id="ssx-boot-fallback">[\s\S]*?<\/script>/,'')
    .replace(/<style id="ssx-alpine-v37-style">[\s\S]*?<\/style>/,'')
    .replace(/<style id="ssx-v38-design">[\s\S]*?<\/style>/,'')
    .replace(/<script id="ssx-alpine-v37-script">[\s\S]*?<\/script>/,'')
    .replace(/<script id="ssx-score-integrity-script">[\s\S]*?<\/script>/,'')
    .replace(/<script id="ssx-special-categories-v1-script">[\s\S]*?<\/script>/,'')
    .replace(/<script id="ssx-special-leaders-core-script">[\s\S]*?<\/script>/,'')
    .replace(/<title>[^<]*<\/title>/i,originalTitle[0]);
  assert.equal(stripped,baseline,'Record dataset, app code and legacy HTML must remain unchanged');
}));
test('preview routes reject writes and directory probes; canonical trailing slash redirects',()=>harness(async base=>{
  const paths=['/hobbies/ssx/','/hobbies/ssx/ssx2012-alpine-v37-preview.js','/hobbies/ssx/packed'];
  for(const p of paths)assert.equal((await rawFetch(base+p)).status,404);
  assert.equal((await rawFetch(base+SSX_V37_PREVIEW_ROUTE,'identity','POST')).status,405);
  const redirect=await rawFetch(base+SSX_V37_PREVIEW_ROUTE+'/');
  assert.equal(redirect.status,308);
  assert.equal(redirect.headers.location,SSX_V37_PREVIEW_ROUTE);
  const archiveRedirect=await rawFetch(base+SSX_V36_ARCHIVE_ROUTE+'/');
  assert.equal(archiveRedirect.status,308);
  assert.equal(archiveRedirect.headers.location,SSX_V36_ARCHIVE_ROUTE);
  const publicRedirect=await rawFetch(base+SSX_ROUTE+'/');
  assert.equal(publicRedirect.status,308);
  assert.equal(publicRedirect.headers.location,SSX_ROUTE);
  assert.equal((await rawFetch(base+SSX_V36_ARCHIVE_ROUTE,'identity','POST')).status,405);
}));
test('v37 preview supports HEAD, gzip, brotli and encoded ETags independently',()=>harness(async base=>{
  const uri=base+SSX_V37_PREVIEW_ROUTE;
  const [identity,gzip,br,head]=await Promise.all([
    rawFetch(uri),rawFetch(uri,'gzip'),rawFetch(uri,'br'),rawFetch(uri,'identity','HEAD')
  ]);
  assert.equal(head.status,200);assert.equal(head.body.length,0);
  assert.ok(Number(head.headers['content-length'])>1e6);
  assert.equal(gzip.headers['content-encoding'],'gzip');
  assert.equal(br.headers['content-encoding'],'br');
  assert.notEqual(gzip.headers.etag,br.headers.etag);
  assert.deepEqual(zlib.gunzipSync(gzip.body),identity.body);
  assert.deepEqual(zlib.brotliDecompressSync(br.body),identity.body);
}));


test('v37.2 uses original game artwork from allowlisted verified sources with a documented fan-site policy',()=>{
  const dir=path.join(__dirname,'../src/hobbies/ssx');
  const css=fs.readFileSync(path.join(dir,'alpine-v37.css'),'utf8');
  const js=fs.readFileSync(path.join(dir,'alpine-v37.js'),'utf8');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'artwork-sources-v37.json'),'utf8'));
  assert.equal(manifest.noncommercial,true);
  assert.equal(manifest.assets.length,5);
  assert.equal(new Set(manifest.assets.map(item=>item.id)).size,5);
  assert.deepEqual(manifest.assets.map(x=>x.id).sort(),['hero','race','riders','survive','trick']);
  assert.match(manifest.eaContentPolicy,/^https:\/\/help\.ea\.com\//);
  assert.match(css,/prefers-reduced-data:reduce/);
  assert.match(css,/alpine-data-saver/);
  assert.match(js,/navigator\.connection\?\.saveData/);
  assert.match(js,/alpineArtCredits/);
  assert.equal((js.match(/artDisclaimer:/g)||[]).length,6,'six language variants must include the EA non-affiliation notice');
  for(const asset of manifest.assets){
    const url=new URL(asset.fileUrl);
    assert.equal(url.protocol,'https:');
    assert.ok(['media.contentapi.ea.com','jogorama.com.br'].includes(url.hostname));
    assert.equal(asset.verifiedHttpStatus,200);
    assert.equal(css.includes(asset.localPath),true,'Local artwork missing CSS: '+asset.id);
    assert.doesNotMatch(css,/url\("https:\/\/(?:jogorama|media\.contentapi)/,'Remote image hotlinks are forbidden in v37.2');
    const localFile=path.join(dir,'media','v37',asset.id+'.jpg');
    const actual=fs.readFileSync(localFile);
    assert.equal(actual.length,asset.localSizeBytes);
    assert.equal(require('node:crypto').createHash('sha256').update(actual).digest('hex'),asset.localSha256);
    assert.equal(actual.subarray(0,3).toString('hex'),'ffd8ff');
    assert.match(asset.sourcePage,/^https:\/\//);
  }
  assert.doesNotMatch(css,/!important/);
  assert.doesNotMatch(js,/fetch\s*\(|XMLHttpRequest|document\.cookie|WebSocket/);
});


test('versioned SSX artwork routes return the exact pinned JPEG, with opaque-origin access and no writes',()=>harness(async base=>{
  const dir=path.join(__dirname,'../src/hobbies/ssx');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'artwork-sources-v37.json'),'utf8'));
  for(const asset of manifest.assets){
    const uri=base+asset.localPath;
    const full=await rawFetch(uri);
    assert.equal(full.status,200,'Missing '+asset.id);
    assert.equal(full.headers['content-type'],'image/jpeg');
    assert.equal(full.headers['x-content-type-options'],'nosniff');
    assert.equal(full.headers['cross-origin-resource-policy'],'cross-origin');
    assert.equal(full.headers['access-control-allow-origin'],'*');
    assert.match(full.headers['x-robots-tag'],/noindex/);
    assert.equal(full.body.length,asset.localSizeBytes);
    assert.equal(require('node:crypto').createHash('sha256').update(full.body).digest('hex'),asset.localSha256);
    const head=await rawFetch(uri,'identity','HEAD');
    assert.equal(head.status,200);
    assert.equal(head.body.length,0);
    assert.equal(Number(head.headers['content-length']),asset.localSizeBytes);
    const after304=await new Promise((resolve,reject)=>{
      const req=http.get(uri,{headers:{'If-None-Match':full.headers.etag}},res=>{
        res.resume();res.on('end',()=>resolve(res.statusCode));res.on('error',reject);
      });req.on('error',reject);
    });
    assert.equal(after304,304);
    assert.equal((await rawFetch(uri,'identity','POST')).status,405);
  }
  assert.equal((await rawFetch(base+'/hobbies/ssx/media/v37/unknown.jpg')).status,404);
  assert.equal((await rawFetch(base+'/hobbies/ssx/media/v37/hero.jpg.zip')).status,404);
  assert.equal((await rawFetch(base+'/hobbies/ssx/media/v37/')).status,404);
}));

test('canonical public route has correct v37 title/HTML security and exact original data',()=>harness(async base=>{
  const response=await rawFetch(base+SSX_ROUTE);
  assert.equal(response.status,200);
  const html=response.body.toString('utf8');
  assert.match(html,/<title>SSX 2012 · Recordes da Comunidade<\/title>/);
  assert.match(html,/ssx-alpine-v37-style/);
  assert.match(html,/ssx-alpine-v37-script/);
  assert.match(html,/id="sheet"/);
  assert.match(html,/id="sourceSeg"/);
  assert.doesNotMatch(response.headers['content-security-policy'],/allow-same-origin/);
  assert.match(response.headers['content-security-policy'],/sandbox allow-scripts/);
  assert.match(response.headers['x-robots-tag'],/noindex/);
}));

test('public SSX UI has neutral brand/title and no Edition release promotion',()=>{
  const dir=path.join(__dirname,'../src/hobbies/ssx');
  const js=fs.readFileSync(path.join(dir,'alpine-v37.js'),'utf8');
  const css=fs.readFileSync(path.join(dir,'alpine-v37.css'),'utf8');
  assert.doesNotMatch(js,/ALPINE EDITION/);
  assert.match(js,/ssxManagementLabel/);
  assert.match(js,/ssxNavRecords/);
  assert.match(js,/ssx-advanced-content/);
  assert.match(js,/applyPublicCopy/);
  assert.match(js,/ssxViewOptions/);
  assert.match(js,/installMobileNavigation/);
  assert.match(js,/ssxDirectActions/);
  assert.match(js,/ssx-region-detail/);
  assert.match(js,/toolbar\.after\(rail\)/,
    'The persistent five-mode selector must be mounted outside the collapsible regional gallery');
  assert.match(js,/allowed=\['board','wings','trick','survive','special'\]/,
    'All five authentic modes must remain accessible from the results');
  const design=fs.readFileSync(path.join(dir,'design-v38.css'),'utf8');
  assert.match(design,/ssx-next-reveal/);
  assert.match(design,/prefers-reduced-motion/);
  assert.doesNotMatch(design,/!important/i);
  assert.doesNotMatch(design,/<\/style/i);
  assert.match(js,/function renderTrackLeaderCards\(root,copy\)/);
  assert.match(js,/function showTrackLeaders\(\)/);
  assert.match(js,/ssxLeadersToggle/);
  assert.match(js,/ssxRegionsToggle/);
  assert.match(css,/ssx-leaders-region-title/);
  assert.match(css,/alpine-card-leader/);
  assert.match(css,/ssx-direct-action/);
  assert.doesNotMatch(js,/ssxMobileMore.*append\(/);
  assert.match(js,/ssxMobileQuickNav/);
  assert.match(css,/ssx-mobile-quick-link/);
  assert.match(css,/ssx-region-banner/);
  assert.match(js,/mountSheetModeFilter\(card\)/);
  assert.match(js,/syncSheetModeFilter\(activeGroup,copy\)/);
  assert.match(css,/ssx-sheet-mode-option/);
  assert.match(css,/#ssxSheetModeFilter/);
  assert.doesNotMatch(css,/!important/);
  assert.match(js,/applyRegionSearch/);
  assert.match(js,/function mountResetControl\(toolbar\)/);
  assert.match(js,/function revealRegionTab\(nav,button\)/);
  assert.match(js,/KeyboardEvent|ArrowRight/);
  assert.match(js,/ssx-region-empty-inline/);
  assert.match(css,/ssx-reset-filters/);
  assert.match(css,/scroll-snap-type:x proximity/);
  assert.match(css,/ssx-region-empty-inline/);
  assert.match(js,/ssxRegionSearch/);
  assert.match(js,/function trackShareUrl\(trackKey\)/);
  assert.match(js,/function restoreSharedTrack\(\)/);
  assert.match(js,/function createTrackShareControl\(selected\)/);
  assert.match(js,/ssxTrack/);
  assert.match(css,/ssx-track-share-button/);
  assert.match(css,/ssx-track-share-manual/);
  assert.match(js,/ssxTrackStep/);
  assert.match(css,/ssx-region-stepper/);
  assert.match(css,/ssx-region-search-box/);
  assert.match(js,/function indexedTracks\(mode\)/);
  assert.match(js,/function renderRegionTabs\(entries\)/);
  assert.match(js,/mountSheetControls\(card,toolbar\)/);
  assert.match(css,/ssx-sheet-region-tab/);
  const indexBody=js.split('function indexedTracks(mode)')[1].split('function renderRegionTabs(entries)')[0];
  assert.doesNotMatch(indexBody,/row\.hidden|row\.style\.display/, 'Index must not depend on legacy UI row visibility');
  assert.match(css,/ssx-region-metrics/);
  assert.match(css,/ssx-region-rank/);
  assert.match(js,/function createYouTubeProof\(href,description,compact=false\)/);
  assert.match(js,/createYouTubeProof\(run\.video,copy\[4\],true\)/);
  assert.match(js,/createYouTubeProof\(lead\.video,copy\.proof\)/);
  assert.match(js,/function createTop3Podium\(index,copy\)/);
  assert.match(js,/function podiumStandings\(index\)/);
  assert.match(js,/winner\.position|run=>String\(run\.position\)/);
  assert.match(css,/ssx-youtube-icon/);
  assert.match(css,/ssx-top3-podium/);
  assert.match(css,/ssx-top3-medal/);
  assert.match(css,/ssx-video-unavailable/);
  assert.match(css,/alpine-card-visual/);
  assert.match(css,/data-ssx-mobile-view="browse"/);
  assert.match(js,/ssxMobileView/);
  assert.match(js,/artForRegion\(item,currentRegion/);
  assert.match(css,/grid-template-columns:minmax\(125px,190px\) max-content/);
  assert.match(css,/\.ssx-view-actions/);
  assert.match(css,/SSX 2012 public editorial layout/);
  assert.match(css,/\.ssx-community-stats/);
  assert.match(css,/\.ssx-credits-disclosure|#ssxCredits/);
  assert.doesNotMatch(css,/!important/);
});

test('six locale labels identify 6,024 Google records as a dated snapshot',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../src/hobbies/ssx/alpine-v37.js'),'utf8');
  const labels=["recordes na captura de 2026-08-22","records in the 2026-08-22 snapshot","Rekorde in der Aufnahme vom 22.08.2026","récords en la captura del 22-08-2026","records in momentopname van 22-08-2026","records dans la capture du 22/08/2026"];
  assert.equal(labels.length,6);
  for(const label of labels)assert.ok(js.includes("snapshotRecords:'"+label+"'"),'Missing dated locale label: '+label);
  assert.match(js,/capturedRecordsLabel\.removeAttribute\('data-i'\)/);
});
