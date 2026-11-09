
'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const {once}=require('node:events');
const {test}=require('node:test');
const {serveSSX2012,SSX_V37_PREVIEW_ROUTE}=require('../src/hobbies/ssx/route');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function chromeBinary(){
  for(const candidate of [process.env.CHROME_BIN,'google-chrome','chromium','chromium-browser']){
    if(!candidate)continue;
    try{return execFileSync('which',[candidate],{encoding:'utf8'}).trim();}catch(_){}
  }
  throw new Error('CHROMIUM_REQUIRED_FOR_SSX_TEST');
}
async function waitForDevTools(filename,proc){
  for(let i=0;i<100;i++){
    if(fs.existsSync(filename))return fs.readFileSync(filename,'utf8').split('\n');
    if(proc.exitCode!==null)throw new Error('Chrome exited before DevTools port opened');
    await sleep(200);
  }
  throw new Error('Chromium DevTools startup timed out');
}
async function connect(url){
  const ws=new WebSocket(url);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let id=0;
  const pending=new Map();
  ws.onmessage=event=>{
    const message=JSON.parse(String(event.data));
    if(!message.id)return;
    const p=pending.get(message.id);
    if(!p)return;
    pending.delete(message.id);
    if(message.error)p.reject(new Error(JSON.stringify(message.error)));
    else p.resolve(message.result);
  };
  const send=(method,params={},sessionId)=>{
    const message={id:++id,method,params};
    if(sessionId)message.sessionId=sessionId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(message.id);reject(new Error('CDP timeout '+method));},25000);
      pending.set(message.id,{
        resolve:value=>{clearTimeout(timer);resolve(value);},
        reject:err=>{clearTimeout(timer);reject(err);}
      });
      ws.send(JSON.stringify(message));
    });
  };
  return {ws,send};
}
async function evaluate(send,session,expression){
  const output=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},session);
  if(output.exceptionDetails)throw new Error('Browser evaluation: '+output.exceptionDetails.text);
  return output.result?.value;
}
test('Alpine v37 renders and responds to interactions in desktop and mobile Chromium',{timeout:120000},async()=>{
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    if(!serveSSX2012(req,res,pathname)){res.writeHead(404);res.end();}
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const url='http://127.0.0.1:'+server.address().port+SSX_V37_PREVIEW_ROUTE;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ssx-alpine-'));
  const chrome=spawn(chromeBinary(),[
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--no-first-run','--no-default-browser-check',
    '--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'
  ],{stdio:'ignore'});
  let cdp;
  try {
    const ports=await waitForDevTools(path.join(dir,'DevToolsActivePort'),chrome);
    cdp=await connect('ws://127.0.0.1:'+ports[0]+ports[1]);
    const target=await cdp.send('Target.createTarget',{url:'about:blank'});
    const attached=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
    const sid=attached.sessionId;
    await cdp.send('Page.enable',{},sid);
    await cdp.send('Runtime.enable',{},sid);
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false},sid);
    await cdp.send('Page.navigate',{url},sid);
    let ready=false;
    for(let i=0;i<75;i++){
      try{
        ready=Boolean(await evaluate(cdp.send,sid,"document.body && document.body.classList.contains('ssx-alpine-v37') && document.querySelectorAll('.alpine-mode-card').length===4 && !!document.querySelector('#sheet tr.rank-row')"));
      }catch(_){}
      if(ready)break;
      await sleep(250);
    }
    assert.ok(ready,'Original rankings + Alpine UI should load');
    let firstPaint;
    for(let attempt=0;attempt<60;attempt++){
      firstPaint=await evaluate(cdp.send,sid,"(()=>({ready:document.documentElement.dataset.ssxBoot,loader:!!document.querySelector('#ssxBootScreen'),headline:document.querySelector('#heroTitle')?.textContent}))()");
      if(firstPaint.ready==='ready'&&!firstPaint.loader)break;
      await sleep(200);
    }
    if(firstPaint.ready!=='ready'){
      const diagnostics=await evaluate(cdp.send,sid,"(()=>({boot:document.documentElement.dataset.ssxBoot,domReady:document.readyState,modes:document.querySelectorAll('.alpine-mode-card').length,subtitle:document.querySelector('#heroDesc')?.textContent,viewOptions:!!document.querySelector('#ssxViewOptions'),management:!!document.querySelector('#ssxManagement'),loading:document.querySelector('#ssxBootProgress')?.textContent}))()");
      console.error('SSX_BOOT_DIAGNOSTICS',JSON.stringify(diagnostics));
    }
    assert.equal(firstPaint.ready,'ready','v38 should reveal after initialization');
    assert.equal(firstPaint.loader,false,'First-paint shell should be removed only when ready');
    assert.equal(firstPaint.headline,'Conquiste a montanha.');
    const desktop=await evaluate(cdp.send,sid,"(()=>{const sources=document.querySelector('#alpineSources');return {cards:document.querySelectorAll('.alpine-mode-card').length,sourceClosed:!!sources&&!sources.open,advanced:!!document.querySelector('#alpineAdvancedFilters #categoryField'),rows:document.querySelectorAll('#sheet tr.rank-row').length,admin:!!document.querySelector('#dataBtn'),opaque:globalThis.origin==='null'};})()");
    assert.equal(desktop.cards,4);
    assert.equal(desktop.sourceClosed,true);
    assert.equal(desktop.advanced,true);
    assert.ok(desktop.rows>10);
    const completeLoad=await evaluate(cdp.send,sid,"(()=>({registered:[...window.availableTracks()].length,rendered:document.querySelectorAll('#tbody .track-cell').length,regions:[...document.querySelectorAll('#ssxSheetRegions [data-ssx-region]')].map(b=>b.dataset.ssxRegion),regionGroups:document.querySelectorAll('#ssxRegionBrowser .ssx-region-group').length,allCount:Number(document.querySelector('#ssxSheetRegions [data-ssx-region=all] .ssx-sheet-region-count')?.textContent),progressHidden:document.querySelector('#renderProgress')?.hidden,progressDisplay:getComputedStyle(document.querySelector('#renderProgress')).display,completeLoader:window.__ssxCompleteTracksInstalled,indexReady:document.body.dataset.ssxTracksIndexed}))()");
    assert.equal(completeLoad.registered,73,'The canonical SSX archive defines 73 playable tracks');
    assert.equal(completeLoad.rendered,73,'Every SSX track must render at first paint without scrolling');
    assert.equal(completeLoad.regions.length,13,'All 12 regional tabs plus All regions must be available');
    assert.equal(completeLoad.regionGroups,12,'All regions must appear in the photographic browser');
    assert.equal(completeLoad.allCount,73,'All regions button should use full catalogue size');
    assert.equal(completeLoad.completeLoader,true);
    assert.equal(completeLoad.indexReady,'ready');
    assert.equal(completeLoad.progressHidden,true,'Legacy progressive loader must finish automatically');
    assert.equal(completeLoad.progressDisplay,'none','Progressive loading banner must not be visible');
    for(const region of ['Antarctica','Himalayas','Japan','Mount Eddie','New Zealand','Patagonia','Rockies','Siberia','Training'])assert.ok(completeLoad.regions.includes(region),'Missing registered region: '+region);
    assert.equal(desktop.admin,true);
    assert.equal(desktop.opaque,true);
    // Stage 3: the historical Sheets appendix is isolated from the 73-track
    // current main ranking, loaded in the same final page (no second face).
    const specials=await evaluate(cdp.send,sid,"(()=>{const root=document.querySelector('#ssxSpecialArchive');const tabs=[...root?.querySelectorAll('[data-ssx-special-group]')||[]];return{mounted:!!root,snapshot:root?.dataset.snapshot,authority:root?.dataset.ssxArchiveSource,records:Number(root?.dataset.records),tabs:tabs.map(b=>({key:b.dataset.ssxSpecialGroup,text:b.textContent.trim()})),link:document.querySelector('#ssxDirectActions a[href=\"#ssxSpecialArchive\"]')?.textContent,initial:root.querySelector('#ssxSpecialResults .ssx-special-record')?.querySelector('.ssx-special-score')?.textContent,mainCount:document.querySelectorAll('#ssxSheetRegions button').length,mainScore:document.querySelector('.ssx-region-detail .ssx-region-score')?.textContent,progress:document.querySelector('#renderProgress')?.hidden}})()");
    console.log('SSX_SPECIAL_UI_AUDIT',JSON.stringify(specials));
    assert.equal(specials.mounted,true,'Historical category section must mount in the canonical UI');
    assert.equal(specials.snapshot,'2026-08-22','Archived source must show its real snapshot date');
    assert.equal(specials.authority,'google-sheets-archive');
    assert.equal(specials.records,2205,'Every special Sheets record, including 137 Survive special rows, must be present');
    assert.deepEqual(specials.tabs.map(t=>t.key),['level','android','dev','boost','challenge']);
    assert.match(specials.link,/categorias extras/i);
    assert.equal(specials.mainCount,13,'Main 73-track navigator must remain intact');
    assert.equal(specials.mainScore,'01:35.99');
    assert.equal(specials.progress,true);
    const explore=await evaluate(cdp.send,sid,"(()=>{const tab=name=>document.querySelector('#ssxSpecialTabs [data-ssx-special-group=\"'+name+'\"]');const level=document.querySelector('#ssxSpecialLevel'),mode=document.querySelector('#ssxSpecialMode'),track=document.querySelector('#ssxSpecialTrack'),rows=document.querySelector('#ssxSpecialResults');const pick=(selector,value)=>{selector.value=String(value);selector.dispatchEvent(new Event('change',{bubbles:true}));};const info=()=>({count:Number(rows.dataset.visibleRecords),score:rows.querySelector('.ssx-special-score')?.textContent,mode:Number(rows.querySelector('.ssx-special-record')?.dataset.archivedMode),rank:rows.querySelector('.ssx-special-record')?.dataset.archivedPosition,proof:rows.querySelector('a.ssx-youtube-proof')?.href,hasMark:!!rows.querySelector('.ssx-youtube-icon'),source:rows.querySelector('.ssx-special-ref')?.textContent});pick(level,'Level 9');pick(mode,'0');pick(track,'2');const nine=info();tab('android').click();const androidModes=[...mode.options].map(o=>Number(o.value));pick(mode,'2');pick(track,'16');const android=info();tab('dev').click();pick(track,'79');const dev=info();tab('boost').click();pick(track,'2');const boost=info();tab('challenge').click();const challengeModes=[...mode.options].map(o=>Number(o.value));pick(track,'8');const special=info();return{nine,androidModes,android,dev,boost,challengeModes,special,mainScore:document.querySelector('.ssx-region-detail .ssx-region-score')?.textContent,mainMode:document.body.dataset.ssxMode,archiveNote:document.querySelector('#ssxSpecialNote')?.textContent}})()");
    console.log('SSX_SPECIAL_CATEGORY_SAMPLES',JSON.stringify(explore));
    assert.equal(explore.nine.score,'01:26.45','Level 9 Board times must match the source spreadsheet snapshot');
    assert.deepEqual(explore.androidModes,[0,1,2,3]);
    assert.equal(explore.android.score,'4.460432E7','Android Trick score should preserve the raw historical value');
    assert.equal(explore.android.mode,2);
    assert.equal(explore.dev.score,'00:34.79','Developer/test track must be read from its original ID');
    assert.equal(explore.boost.score,'1:42.83','No Boost time should be read from the original G record');
    assert.match(explore.boost.proof,/youtu\.be/,'Real archived YouTube link must survive');
    assert.equal(explore.boost.hasMark,true);
    assert.deepEqual(explore.challengeModes,[5],'Archived Survive combined no Gear/Wings/Rewinds rule is a separate mode');
    assert.equal(explore.special.score,'10,787,35m','Survive special distance must not be normalized into a race time');
    assert.match(explore.archiveNote,/2026-08-22/);
    assert.equal(explore.mainMode,'board');
    assert.equal(explore.mainScore,'01:35.99','Opening archived categories cannot change public current rankings');

    // Stage 4: count distinct archived #1 tracks, not first N rows, and never
    // merge nickname spellings across platforms/categories without in-game IDs.
    const historicalLeaders=await evaluate(cdp.send,sid,"(()=>{const tab=g=>document.querySelector('#ssxSpecialTabs [data-ssx-special-group='+g+']').click();const pick=(id,v)=>{const select=document.querySelector(id);select.value=String(v);select.dispatchEvent(new Event('change',{bubbles:true}));};const view=()=>document.querySelector('#ssxSpecialViews [data-ssx-special-view=leaders]').click();const state=()=>{const panel=document.querySelector('#ssxSpecialPodium'),cards=[...document.querySelectorAll('#ssxSpecialResults [data-ssx-leader-track]')],medals=[...panel.querySelectorAll('.ssx-special-medal-card')],aud=document.querySelector('#ssxSpecialRankingAudit');return{category:panel.dataset.ssxCategory,mode:Number(panel.dataset.ssxMode),platform:panel.dataset.ssxPlatform,podium:medals.map(x=>({name:x.dataset.ssxName,wins:Number(x.dataset.ssxWins),proofs:Number(x.dataset.ssxProofs)})),leaders:cards.length,uniqueTracks:new Set(cards.map(x=>x.dataset.ssxLeaderTrack)).size,allFirst:cards.every(x=>x.dataset.ssxLeaderPosition==='1'),names:cards.slice(0,5).map(x=>x.dataset.ssxLeaderRider),conflicts:Number(document.querySelector('#ssxSpecialResults').dataset.ssxArchiveConflicts),view:document.querySelector('#ssxSpecialViews [data-ssx-special-view=leaders]').getAttribute('aria-pressed'),note:panel.textContent.includes('não conciliada por ID Ozmonet'),snapshot:document.querySelector('#ssxSpecialNote').textContent.includes('2026-08-22'),platformOptions:[...document.querySelector('#ssxSpecialPlatform').options].map(x=>x.value),trackHidden:document.querySelector('#ssxSpecialTrack').closest('label').hidden,sourceMain:document.querySelector('.ssx-region-detail .ssx-region-score')?.textContent}};view();const challenge=state();tab('level');pick('#ssxSpecialLevel','Level 9');const lowBoard=state();pick('#ssxSpecialMode',1);const lowWings=state();tab('android');pick('#ssxSpecialMode',2);const android=state();tab('dev');const dev=state();tab('boost');const boost=state();const podiumButton=document.querySelector('#ssxSpecialPodium [data-ssx-podium-rider]');let selected={};if(podiumButton){const rider=podiumButton.dataset.ssxPodiumRider;podiumButton.click();const filtered=[...document.querySelectorAll('#ssxSpecialResults [data-ssx-leader-track]')];selected={rider,count:filtered.length,matches:filtered.every(x=>x.dataset.ssxLeaderRider===rider),clear:!!document.querySelector('[data-ssx-clear-podium-rider]')};document.querySelector('[data-ssx-clear-podium-rider]').click();selected.restored=document.querySelectorAll('#ssxSpecialResults [data-ssx-leader-track]').length===boost.leaders;}tab('challenge');const challengeAgain=state();document.querySelector('#ssxSpecialViews [data-ssx-special-view=records]').click();return{challenge,lowBoard,lowWings,android,dev,boost,selected,challengeAgain,recordsAgain:document.querySelector('#ssxSpecialViews [data-ssx-special-view=records]').getAttribute('aria-pressed'),mainScore:document.querySelector('.ssx-region-detail .ssx-region-score')?.textContent,mainMode:document.body.dataset.ssxMode}})()");
    console.log('SSX_HISTORICAL_LEADERS',JSON.stringify(historicalLeaders));
    for(const [category,item] of Object.entries(historicalLeaders).filter(([key])=>['challenge','lowBoard','lowWings','android','dev','boost','challengeAgain'].includes(key))){
      assert.equal(item.view,'true',category+' must offer visible historical leader mode');
      assert.equal(item.leaders,item.uniqueTracks,'Each archived track must have at most one unambiguous #1 ('+category+')');
      assert.equal(item.allFirst,true,'Only source position #1 may enter historical leader view');
      assert.ok(item.podium.length<=3,'Never invent a fourth podium holder');
      assert.ok(item.podium.every((p,i)=>p.wins>=1&&(i===0||p.wins<=item.podium[i-1].wins)));
      assert.equal(item.note,true,'Identity provenance needs explicit non-certified status');
      assert.equal(item.snapshot,true);
      assert.equal(item.trackHidden,true,'Track picker is not relevant for all-track leaders');
      assert.equal(item.sourceMain,'01:35.99','Archived leader tabs must not affect the main leaderboard');
    }
    assert.equal(historicalLeaders.challenge.mode,5);
    assert.deepEqual(historicalLeaders.challenge.platformOptions,['__unspecified__'],'Survive without recorded platform must not be mislabeled PS3');
    assert.equal(historicalLeaders.lowBoard.category,'Level 9');
    assert.equal(historicalLeaders.lowBoard.mode,0);
    assert.equal(historicalLeaders.lowWings.mode,1);
    assert.ok(historicalLeaders.lowBoard.leaders>=1);
    assert.ok(historicalLeaders.lowWings.leaders>=1);
    assert.equal(historicalLeaders.android.category,'Android');
    assert.equal(historicalLeaders.android.mode,2);
    assert.deepEqual(historicalLeaders.android.platformOptions,['Android']);
    assert.equal(historicalLeaders.dev.category,'DEV Tracks');
    assert.equal(historicalLeaders.boost.category,'No Boost');
    assert.equal(historicalLeaders.selected.matches,true);
    assert.equal(historicalLeaders.selected.clear,true);
    assert.equal(historicalLeaders.selected.restored,true);
    assert.equal(historicalLeaders.recordsAgain,'true');
    assert.equal(historicalLeaders.mainScore,'01:35.99');
    assert.equal(historicalLeaders.mainMode,'board');
    const independentSource=await evaluate(cdp.send,sid,"(()=>({source:typeof state==='object'?state.source:null,archiveAttr:document.querySelector('#ssxSpecialArchive')?.hasAttribute('data-source'),archiveSource:document.querySelector('#ssxSpecialArchive')?.dataset.ssxArchiveSource}))()");
    assert.equal(independentSource.source,'combined','Historical buttons must NEVER change the original main data-source filter');
    assert.equal(independentSource.archiveAttr,false,'No generic data-source on historical container');
    assert.equal(independentSource.archiveSource,'google-sheets-archive');


    // The legacy data engine may be committing a deferred original tbody
    // refresh. Require the final canonical scoreboard to recover rather than
    // sampling its transient half-rendered state in the same event turn.
    for(let attempt=0;attempt<12;attempt++){
      const ready=await evaluate(cdp.send,sid,"(()=>({groups:document.querySelectorAll('#tbody .track-cell').length,rows:document.querySelectorAll('#ssxRegionBrowser .ssx-region-rank').length}))()");
      if(ready.groups===73&&ready.rows>0)break;
      await sleep(150);
    }
    const regional=await evaluate(cdp.send,sid,"(()=>{const root=document.querySelector('#ssxRegionBrowser');const africa=[...root.querySelectorAll('.ssx-region-group')].find(x=>x.dataset.regionName==='Africa');const tabs=africa?.querySelectorAll('.ssx-track-choice')||[];const selected=root.querySelector('.ssx-region-detail h3');return {display:getComputedStyle(root).display,africa:!!africa,meru:africa?.textContent.includes('Meru Mountain'),redLight:[...tabs].some(b=>b.textContent.includes('Red Light')),first:selected?.textContent,rankCount:root.querySelectorAll('.ssx-region-rank').length,proof:!!root.querySelector('.ssx-region-proof'),regions:root.querySelectorAll('.ssx-region-group').length,nativeState:{category:document.querySelector('#category')?.value,region:document.querySelector('#region')?.value,track:document.querySelector('#track')?.value,search:document.querySelector('#search')?.value,source:document.querySelector('#sourceSeg [data-source].active')?.dataset.source},tbody:{groups:document.querySelectorAll('#tbody .track-cell').length,ranks:document.querySelectorAll('#tbody tr.rank-row').length,first:document.querySelector('#tbody tr.rank-row')?.outerHTML.slice(0,1400),sampleTracks:[...document.querySelectorAll('#tbody .track-name')].slice(0,5).map(x=>x.textContent),redHeader:[...document.querySelectorAll('#tbody .track-name')].find(x=>x.textContent.includes('Red Light'))?.textContent},originalState:typeof state==='object'?{source:state.source,category:state.category,mode:state.mode,track:state.track}:null,sourceControls:document.querySelector('#sourceSeg')?.outerHTML.slice(0,1400),indexReady:document.body.dataset.ssxTracksIndexed,firstTrackInfo:root.querySelector('.ssx-track-choice small')?.textContent,mainDetailParent:document.querySelector('.ssx-region-detail')?.parentElement?.id,allRanks:document.querySelectorAll('.ssx-region-rank').length,detailChildren:[...document.querySelector('.ssx-region-detail')?.children||[]].map(x=>x.className),rootChildren:[...root.children].map(x=>x.className),scoreParent:document.querySelector('.ssx-region-detail .ssx-region-score')?.closest('.ssx-region-rank')?.className,tableHidden:getComputedStyle(document.querySelector('.sheet-scroll')).display==='none'}})()");
    console.log('SSX_MAIN_REGIONAL_AFTER_ARCHIVE',JSON.stringify(regional));
    assert.equal(regional.display,'grid','Regional dashboard must replace oversized single-mode table');
    assert.equal(regional.africa,true);
    assert.equal(regional.meru,true);
    assert.equal(regional.redLight,true);
    assert.equal(regional.first,'Red Light');
    assert.ok(regional.regions>=2&&regional.rankCount>0&&regional.proof);
    assert.equal(regional.tableHidden,true);
    const initialShare=await evaluate(cdp.send,sid,"(()=>{const button=document.querySelector('.ssx-track-share-button');const url=new URL(button.dataset.shareUrl);return {label:button.textContent,mode:url.searchParams.get('mode'),parts:JSON.parse(url.searchParams.get('ssxTrack')),origin:url.origin,pathname:url.pathname,hash:url.hash,manualInputHidden:document.querySelector('.ssx-track-share-manual').hidden,liveStatus:document.querySelector('.ssx-track-share-status').getAttribute('role')}})()");
    assert.match(initialShare.label,/Compartilhar pista/);
    assert.equal(initialShare.mode,'board');
    assert.deepEqual(initialShare.parts,['Africa','Meru Mountain','Red Light']);
    assert.equal(initialShare.pathname,'/hobbies/ssx/ssx2012');
    assert.equal(initialShare.hash,'#ssxRegionBrowser');
    assert.equal(initialShare.manualInputHidden,true);
    assert.equal(initialShare.liveStatus,'status');

    const sheetUI=await evaluate(cdp.send,sid,"(()=>({indexReady:document.body.dataset.ssxTracksIndexed,tabs:document.querySelectorAll('#ssxSheetRegions [data-ssx-region]').length,allTracks:Number(document.querySelector('#ssxSheetRegions [data-ssx-region=all] .ssx-sheet-region-count')?.textContent||0),toolbarInSheet:document.querySelector('.sheet-card').contains(document.querySelector('#toolbar')),hiddenNative:getComputedStyle(document.querySelector('.ssx-legacy-region-select')).display==='none',active:document.querySelector('#ssxSheetRegions [aria-pressed=true]')?.dataset.ssxRegion,rows:document.querySelectorAll('#tbody tr.rank-row').length}))()");
    assert.equal(sheetUI.indexReady,'ready','All embedded records should be indexed on initial load');
    assert.ok(sheetUI.tabs>=3&&sheetUI.allTracks>=3,'Regional tabs should render without manually choosing a track');
    assert.equal(sheetUI.toolbarInSheet,true,'Actual existing filters should be part of the ranking sheet');
    assert.equal(sheetUI.hiddenNative,true,'Duplicate legacy region dropdown must not clutter the tabs');
    assert.equal(sheetUI.active,'all');
    const keyboardRail=await evaluate(cdp.send,sid,"(()=>{const nav=document.querySelector('#ssxSheetRegions');const reset=document.querySelector('#ssxResetFilters');const initiallyDisabled=reset.disabled;const all=nav.querySelector('[data-ssx-region=all]');all.focus();all.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));const first=nav.querySelector('[aria-pressed=true]')?.dataset.ssxRegion;const keyboardFocus=document.activeElement===nav.querySelector('[data-ssx-region=Africa]');document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));const last=nav.querySelector('[aria-pressed=true]')?.dataset.ssxRegion;const afterEnd=reset.disabled;document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));const home=nav.querySelector('[aria-pressed=true]')?.dataset.ssxRegion;nav.querySelector('[data-ssx-region=Japan]').click();const beforeReset=reset.disabled;reset.click();return{initiallyDisabled,first,keyboardFocus,last,afterEnd,home,beforeReset,afterResetDisabled:reset.disabled,afterReset:nav.querySelector('[aria-pressed=true]')?.dataset.ssxRegion,groups:document.querySelectorAll('#ssxRegionBrowser .ssx-region-group').length,catalog:document.querySelectorAll('#ssxSheetRegions button').length,mode:document.body.dataset.ssxMode,source:document.querySelector('#sourceSeg [data-source].active')?.dataset.source,resetLabel:reset.textContent.trim()}})()");
    assert.equal(keyboardRail.initiallyDisabled,true,'Reset control must not invite redundant clicks initially');
    assert.equal(keyboardRail.first,'Africa','Right arrow must activate adjacent region');
    assert.equal(keyboardRail.keyboardFocus,true,'Region keyboard focus should remain visible');
    assert.equal(keyboardRail.last,'Training','End should activate last canonical region');
    assert.equal(keyboardRail.afterEnd,false,'Changing region should enable reset');
    assert.equal(keyboardRail.home,'all','Home should return to all regions');
    assert.equal(keyboardRail.beforeReset,false);
    assert.equal(keyboardRail.afterResetDisabled,true,'Reset must restore inactive state');
    assert.equal(keyboardRail.afterReset,'all');
    assert.equal(keyboardRail.groups,12);
    assert.equal(keyboardRail.catalog,13);
    assert.equal(keyboardRail.mode,'board','Filter reset must preserve selected game mode');
    assert.equal(keyboardRail.source,'combined','Filter reset must not replace data authority');
    assert.match(keyboardRail.resetLabel,/Limpar filtros/);

    const filterPersistence=await evaluate(cdp.send,sid,"(()=>{const tabs=document.querySelector('#ssxSheetRegions');const allBefore=Number(tabs.querySelector('[data-ssx-region=all] .ssx-sheet-region-count').textContent);tabs.querySelector('[data-ssx-region=Africa]').click();const africa={pressed:tabs.querySelector('[data-ssx-region=Africa]').getAttribute('aria-pressed'),groups:document.querySelectorAll('#ssxRegionBrowser .ssx-region-group').length,redLight:!![...document.querySelectorAll('#ssxRegionBrowser .ssx-track-choice')].find(b=>b.textContent.includes('Red Light'))};const track=document.querySelector('#track');track.value='0';track.dispatchEvent(new Event('change',{bubbles:true}));const afterTrack={groups:document.querySelectorAll('#ssxRegionBrowser .ssx-region-group').length,tracks:document.querySelectorAll('#ssxRegionBrowser .ssx-track-choice').length,detail:document.querySelector('.ssx-region-detail h3')?.textContent,allCount:Number(tabs.querySelector('[data-ssx-region=all] .ssx-sheet-region-count').textContent),allTabs:tabs.querySelectorAll('[data-ssx-region]').length,loadDone:document.querySelector('#renderProgress').hidden};tabs.querySelector('[data-ssx-region=all]').click();return {allBefore,africa,afterTrack,restored:document.querySelectorAll('#ssxRegionBrowser .ssx-region-group').length,active:tabs.querySelector('[aria-pressed=true]')?.dataset.ssxRegion}})()");
    assert.equal(filterPersistence.africa.pressed,'true');
    assert.equal(filterPersistence.africa.groups,1,'Africa should show region-specific tracks');
    assert.equal(filterPersistence.africa.redLight,true);
    assert.ok(filterPersistence.afterTrack.tracks>=2,'Changing old track filter must not unload embedded tracks');
    assert.equal(filterPersistence.afterTrack.groups,1);
    assert.equal(filterPersistence.afterTrack.allCount,filterPersistence.allBefore,'Legacy filters cannot erase the regional index');
    assert.equal(filterPersistence.afterTrack.allTabs,13,'Changing piste filters cannot remove registered region tabs');
    assert.equal(filterPersistence.afterTrack.loadDone,true,'Filtering cannot restart the visible track loader');
    assert.equal(filterPersistence.active,'all');
    assert.equal(filterPersistence.restored,12,'All-region tab restores every canonical region');
    // Reset the old track field so the rest of the integration suite starts from an unfiltered sheet.
    await evaluate(cdp.send,sid,"(()=>{const track=document.querySelector('#track');track.value='';track.dispatchEvent(new Event('change',{bubbles:true}));})()");

    const regionRoundTrip=await evaluate(cdp.send,sid,"(()=>{const rail=document.querySelector('#ssxSheetRegions');const results=[];for(const name of ['Alaska','Japan','Training','Africa','all']){rail.querySelector('[data-ssx-region=\"'+name+'\"]').click();const root=document.querySelector('#ssxRegionBrowser');results.push({requested:name,active:rail.querySelector('[aria-pressed=true]')?.dataset.ssxRegion,regions:root.querySelectorAll('.ssx-region-group').length,group:root.querySelector('.ssx-region-group')?.dataset.regionName,tracks:root.querySelectorAll('.ssx-track-choice').length,canonical:Number(rail.querySelector('[data-ssx-region=all] .ssx-sheet-region-count')?.textContent),progress:document.querySelector('#renderProgress')?.hidden});}return results;})()");
    assert.deepEqual(regionRoundTrip.map(row=>row.active),['Alaska','Japan','Training','Africa','all'],'Every region tab must stay selected after native sheet redraw');
    assert.deepEqual(regionRoundTrip.map(row=>row.regions),[1,1,1,1,12],'Each region must retain its complete track directory');
    assert.deepEqual(regionRoundTrip.map(row=>row.tracks),[7,3,1,5,73],'All official SSX track counts must survive repeated region switching');
    assert.ok(regionRoundTrip.every(row=>row.canonical===73&&row.progress),'Region changes must not restart the loading sentinel');
    const sourceTabs=await evaluate(cdp.send,sid,"[...document.querySelectorAll('[data-source]')].map(x=>x.dataset.source)");
    assert.ok(sourceTabs.includes('combined')&&sourceTabs.includes('oz'),'Original source filters must remain wired');
    await evaluate(cdp.send,sid,"document.querySelector('[data-source=oz]').click()");
    await sleep(180);
    const ozRace=await evaluate(cdp.send,sid,"(()=>({source:document.querySelector('[data-source=oz]').classList.contains('active'),ranks:document.querySelectorAll('.ssx-region-detail .ssx-region-rank').length,canonical:document.querySelectorAll('#ssxSheetRegions [data-ssx-region]').length,progress:document.querySelector('#renderProgress')?.hidden}))()");
    assert.equal(ozRace.source,true);
    assert.equal(ozRace.ranks,0,'OZ standalone race mode has no ranked scores, so do not show stale combined data');
    const readableEmpty=await evaluate(cdp.send,sid,"(()=>({text:document.querySelector('.ssx-region-empty-inline')?.textContent,role:document.querySelector('.ssx-region-empty-inline')?.getAttribute('role'),visible:document.querySelector('.ssx-region-empty-inline')?.getBoundingClientRect().height>40}))()");
    assert.match(readableEmpty.text,/Nenhum recorde/i,'Empty source needs an explicit translated explanation');
    assert.equal(readableEmpty.role,'status','Empty score states must be accessible');
    assert.equal(readableEmpty.visible,true);

    assert.equal(ozRace.canonical,13);
    assert.equal(ozRace.progress,true);
    await evaluate(cdp.send,sid,"document.querySelector('[data-source=combined]').click()");
    await sleep(180);
    const combinedRace=await evaluate(cdp.send,sid,"(()=>({ranks:document.querySelectorAll('.ssx-region-detail .ssx-region-rank').length,score:document.querySelector('.ssx-region-detail .ssx-region-score')?.textContent,source:document.querySelector('[data-source=combined]').classList.contains('active'),regions:document.querySelectorAll('.ssx-region-group').length}))()");
    assert.equal(combinedRace.source,true);
    assert.equal(combinedRace.score,'01:35.99','Restoring combined data must restore the real Red Light record');
    assert.ok(combinedRace.ranks>0&&combinedRace.regions===12);


    const discovery=await evaluate(cdp.send,sid,"(()=>{const search=document.querySelector('#ssxRegionSearch');const global=document.querySelector('#search');search.value='corkscrew';search.dispatchEvent(new Event('input',{bubbles:true}));const visible=[...document.querySelectorAll('.ssx-track-choice')].filter(b=>!b.hidden);const afterFilter={visible:visible.length,match:visible[0]?.textContent,hasClear:!document.querySelector('#ssxRegionSearchClear').hidden,inputFocus:false,globalQuery:global.value};search.focus();afterFilter.inputFocus=document.activeElement===search;search.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return {...afterFilter,clearAfterEscape:search.value,shownAfterEscape:[...document.querySelectorAll('.ssx-track-choice')].filter(b=>!b.hidden).length,emptyHidden:document.querySelector('#ssxRegionNoMatches').hidden}})()");
    assert.equal(discovery.visible,1,'Regional search should find Corkscrew');
    assert.match(discovery.match,/Corkscrew/);
    assert.equal(discovery.hasClear,true);
    assert.equal(discovery.inputFocus,true);
    assert.equal(discovery.clearAfterEscape,'');
    assert.ok(discovery.shownAfterEscape>1&&discovery.emptyHidden);
    assert.equal(discovery.globalQuery,'','Local search must not overwrite global ranking filters');
    const navigation=await evaluate(cdp.send,sid,"(()=>{const prev=document.querySelector('[data-ssx-track-step=\"-1\"]');const disabled=prev.disabled;document.querySelector('[data-ssx-track-step=\"1\"]').click();const nextTrack=document.querySelector('.ssx-region-detail h3').textContent;document.querySelector('[data-ssx-track-step=\"-1\"]').click();const restored=document.querySelector('.ssx-region-detail h3').textContent;const labels=[...document.querySelectorAll('.ssx-region-step')].map(x=>x.getAttribute('aria-label'));return {disabled,nextTrack,restored,labels}})()");
    assert.equal(navigation.disabled,true,'Previous track disabled at first position');
    assert.equal(navigation.nextTrack,'Corkscrew');
    assert.equal(navigation.restored,'Red Light');
    assert.deepEqual(navigation.labels,['Pista anterior','Próxima pista']);
    const desktopDensity=await evaluate(cdp.send,sid,"(()=>{const item=document.querySelector('.ssx-region-rank');const proof=item.querySelector('.ssx-region-proof');const metrics=item.querySelector('.ssx-region-metrics');return {height:Math.round(item.getBoundingClientRect().height),score:metrics.querySelector('.ssx-region-score')?.textContent,accessible:proof?.getAttribute('aria-label'),proofWidth:proof?.getBoundingClientRect().width,gridColumns:getComputedStyle(item).gridTemplateColumns.split(' ').length}})()");
    assert.ok(desktopDensity.height<=58,'Desktop ranking rows should be compact');
    assert.equal(desktopDensity.gridColumns,3);
    assert.equal(desktopDensity.score,'01:35.99','Preserve full precision of race times');
    assert.ok(desktopDensity.proofWidth>=36&&desktopDensity.accessible,'Proof icon must be touchable and accessible');
    const officialProof=await evaluate(cdp.send,sid,"(()=>{const link=document.querySelector('.ssx-region-proof');const mark=link?.querySelector('.ssx-youtube-icon');return {label:link?.textContent.trim(),aria:link?.getAttribute('aria-label'),host:link?new URL(link.href).hostname:null,red:mark?getComputedStyle(mark).backgroundColor:null,blank:link?.target,rel:link?.rel,sourceLinks:document.querySelectorAll('#tbody a.proof[href]').length}})()");
    assert.equal(officialProof.label,'YouTube','Regional records must show a recognizable YouTube action');
    assert.match(officialProof.aria,/YouTube/);
    assert.match(officialProof.host,/^(?:youtu\.be|(?:www\.|m\.)?youtube\.com)$/);
    assert.equal(officialProof.red,'rgb(255, 0, 51)');
    assert.equal(officialProof.blank,'_blank');
    assert.match(officialProof.rel,/noopener/);
    assert.ok(officialProof.sourceLinks>0,'Real YouTube evidence must originate in canonical records');

    const corkscrew=await evaluate(cdp.send,sid,"(()=>{const africa=[...document.querySelectorAll('.ssx-region-group')].find(x=>x.dataset.regionName==='Africa');const target=[...africa.querySelectorAll('.ssx-track-choice')].find(x=>x.textContent.includes('Corkscrew'));target.click();return {selected:document.querySelector('.ssx-region-detail h3')?.textContent,runs:document.querySelectorAll('.ssx-region-rank').length}})()");
    assert.equal(corkscrew.selected,'Corkscrew','Track detail must update on selection');
    const nextShare=await evaluate(cdp.send,sid,"(()=>{const url=new URL(document.querySelector('.ssx-track-share-button').dataset.shareUrl);const address=new URL(location.href);return {parts:JSON.parse(url.searchParams.get('ssxTrack')),selectedInAddress:JSON.parse(address.searchParams.get('ssxTrack')),mode:url.searchParams.get('mode')}})()");
    assert.deepEqual(nextShare.parts,['Africa','Meru Mountain','Corkscrew']);
    assert.deepEqual(nextShare.selectedInAddress,nextShare.parts,'Selecting a track should update the shareable browser address');
    assert.equal(nextShare.mode,'board');

    assert.ok(corkscrew.runs>0);
    await evaluate(cdp.send,sid,"document.querySelector('.ssx-track-choice').click()");    const ssxVisualDir=path.join(process.cwd(),'artifacts');
    fs.mkdirSync(ssxVisualDir,{recursive:true});
    await evaluate(cdp.send,sid,"document.querySelector('.sheet-card').scrollIntoView({block:'start'})");
    await sleep(220);
    const racePreview=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(ssxVisualDir,'ssx-r40-desktop-race-it.png'),Buffer.from(racePreview.data,'base64'));
    await evaluate(cdp.send,sid,"window.scrollTo({top:0,behavior:'instant'})");
    await sleep(180);
    const publicUI=await evaluate(cdp.send,sid,"(()=>{const hero=document.querySelector('#top');const stats=document.querySelector('.ssx-community-stats');const advanced=document.querySelector('#alpineAdvancedFilters');const about=document.querySelector('#aboutBtn');const sources=document.querySelector('#alpineSources');const visibleNames=Array.from(document.querySelectorAll('#topNav > .nav-btn, #topNav > .nav-group > .nav-btn')).filter(el=>getComputedStyle(el).display!=='none').map(el=>el.id);return {title:document.title,heroDesc:document.querySelector('#heroDesc').textContent,headline:document.querySelector('#heroTitle').textContent,statsBelowHero:stats===hero.nextElementSibling,snapshotLabel:document.querySelector('[data-ssx-snapshot-count-label]')?.textContent?.trim(),recordsNav:!!document.querySelector('#topNav > #ssxNavRecords'),aboutInMainNav:about.parentElement.id==='topNav',nav:visibleNames,advancedClosed:!advanced.open,sourceInsideAdvanced:advanced.contains(sources),topNInsideAdvanced:advanced.contains(document.querySelector('#topN')),actionsInsideAdvanced:advanced.contains(document.querySelector('.toolbar-actions')),managementClosed:!document.querySelector('#ssxManagement').open,bridgeHidden:getComputedStyle(document.querySelector('#liveSyncChip')).display==='none',snapshotHidden:getComputedStyle(document.querySelector('.hero-kickers')).display==='none',summaryHidden:getComputedStyle(document.querySelector('#summary')).display==='none',creditsClosed:!document.querySelector('#ssxCredits').open,alpineText:document.body.innerText.includes('ALPINE EDITION')};})()");
    assert.equal(publicUI.title,'SSX 2012 · Recordes da Comunidade');
    assert.equal(publicUI.heroDesc,'Race It!, Trick It! e Survive It!: tempos, pontuações e provas em vídeo.');
    assert.equal(publicUI.statsBelowHero,true,'Community counts should appear below hero like the Canva reference');
    assert.equal(publicUI.snapshotLabel,'recordes na captura de 2026-08-22','An archived source must not be presented as live records');
    assert.equal(publicUI.recordsNav,true);
    assert.equal(publicUI.aboutInMainNav,true);
    assert.equal(publicUI.advancedClosed,true);
    assert.equal(publicUI.sourceInsideAdvanced,true);
    assert.equal(publicUI.topNInsideAdvanced,true);
    assert.equal(publicUI.actionsInsideAdvanced,true);
    assert.equal(publicUI.managementClosed,true);
    assert.equal(publicUI.bridgeHidden,true);
    assert.equal(publicUI.snapshotHidden,true);
    assert.equal(publicUI.summaryHidden,true);
    assert.equal(publicUI.creditsClosed,true);
    assert.equal(publicUI.alpineText,false);
    const grouped=await evaluate(cdp.send,sid,"(()=>{const group=document.querySelector('#communityMenuBtn')?.closest('.nav-group');const about=document.querySelector('#aboutBtn');const options=document.querySelector('#ssxViewOptions');return{communityBeforeAbout:!!group&&!!about&&Boolean(group.compareDocumentPosition(about)&Node.DOCUMENT_POSITION_FOLLOWING),viewClosed:!!options&&!options.open,actionsInside:options?.contains(document.querySelector('#alpineToggleTable'))&&options?.contains(document.querySelector('#alpinePositionsToggle')),fakeBootButtons:!!document.querySelector('.ssx-boot-mode')};})()");
    assert.equal(grouped.communityBeforeAbout,true,'Community must precede About');
    assert.equal(grouped.viewClosed,false,'Display actions should be available immediately without an overflow menu');
    assert.equal(grouped.actionsInside,true,'Result options must retain both existing actions');
    assert.equal(grouped.fakeBootButtons,false,'Do not render non-interactive placeholders');
    const interactions=await evaluate(cdp.send,sid,"(()=>{const about=document.querySelector('#aboutBtn');about.click();const opened=document.querySelector('#aboutModal').getAttribute('aria-hidden');document.querySelector('[data-close=\"aboutModal\"]').click();const direct=document.querySelector('#ssxDirectActions');const buttons=[...direct.querySelectorAll('button')];const toolsHidden=getComputedStyle(document.querySelector('#toolsGroup')).display==='none';const advanced=document.querySelector('#alpineAdvancedFilters');advanced.querySelector('summary').click();const filterOpen=advanced.open;advanced.querySelector('summary').click();return{opened,labels:buttons.map(b=>b.textContent.trim()),visible:buttons.every(b=>getComputedStyle(b).display!=='none'&&b.getBoundingClientRect().height>=36),toolsHidden,filterOpen,hasManagement:buttons.some(b=>b.dataset.ssxAction==='adminBtn')}})()");
    assert.equal(interactions.opened,'false','About modal must still open');
    assert.deepEqual(interactions.labels,['Ajustes','Guia','Sobre os dados','Submissões','Dados','Admin']);
    assert.equal(interactions.visible,true,'All public/management actions must be accessible without More');
    assert.equal(interactions.toolsHidden,true,'The redundant overflow trigger must not appear');
    assert.equal(interactions.hasManagement,true,'Admin and management shortcuts must be direct actions');
    assert.equal(interactions.filterOpen,true,'Only the advanced filter panel stays collapsed by default');
    const community=await evaluate(cdp.send,sid,"(()=>{const button=document.querySelector('#communityMenuBtn');button.click();const opened=document.querySelector('#introModal').getAttribute('aria-hidden');const header=document.querySelector('#introModal .modal-head h2').textContent;const sheetLabel=getComputedStyle(document.querySelector('#introModal [data-i=\"introFromSheet\"]')).display;document.querySelector('[data-close=\"introModal\"]').click();return {opened,header,sheetLabel,gearLabel:!!document.querySelector('#toolsMenuBtn [data-i=\"navTools\"]'),gearAria:document.querySelector('#toolsMenuBtn').getAttribute('aria-label'),snow:getComputedStyle(document.querySelector('#snowLayer')).display};})()");
    assert.equal(community.opened,'false','Community should directly open player guide');
    assert.doesNotMatch(community.header,/INTRO/i);
    assert.equal(community.sheetLabel,'none');
    assert.equal(interactions.labels.length,6);
    assert.equal(community.snow,'none','Decorative snow animation should not distract from original game artwork');

    const art=await evaluate(cdp.send,sid,"(()=>{const hero=getComputedStyle(document.querySelector('.hero'),'::before').backgroundImage;const cards=Array.from(document.querySelectorAll('[data-alpine-group]')).map(el=>({mode:el.dataset.alpineGroup,source:getComputedStyle(el).getPropertyValue('--alpine-art')}));const footer=document.querySelector('#alpineArtCredits');return{hero,cards,notice:footer?.textContent||'',links:footer?.querySelectorAll('a').length||0};})()");
    assert.match(art.hero,/\/hobbies\/ssx\/media\/v37\/hero\.jpg/);
    assert.equal(art.cards.length,4);
    for(const card of art.cards)assert.match(card.source,/\.jpg/,'Original SSX image missing for '+card.mode);
    assert.match(art.notice,/não é endossado pela EA/i);
    assert.equal(art.links,3);
    // External media are decoration; URL health is independently verified by
    // content-source audit, while intermittent CDN failure must never block rankings.
    const imgHealth=await evaluate(cdp.send,sid,"(async()=>{const ids=['hero','riders','race','trick','survive'];return await Promise.all(ids.map(id=>new Promise(resolve=>{const image=new Image();let done=false;const finish=state=>{if(done)return;done=true;resolve({id,status:state,width:image.naturalWidth,height:image.naturalHeight})};image.onload=()=>finish('loaded');image.onerror=()=>finish('blocked');setTimeout(()=>finish('timeout'),2500);image.referrerPolicy='no-referrer';image.src='/hobbies/ssx/media/v37/'+id+'.jpg';})));})()");
    assert.equal(imgHealth.length,5);
    assert.ok(imgHealth.every(item=>item.status==='loaded'&&item.width>0&&item.height>0),
      'All original SSX assets must load locally from opaque-origin preview: '+JSON.stringify(imgHealth));
    console.log('SSX_V37_LOCAL_IMAGE_HEALTH',JSON.stringify(imgHealth));
    await sleep(750);
    const trick=await evaluate(cdp.send,sid,"(()=>{document.querySelector('[data-alpine-group=\"trick\"]').click();return{mode:document.body.dataset.ssxMode,board:getComputedStyle(document.querySelector('#sheet td.mode-board')).display,trick:getComputedStyle(document.querySelector('#sheet td.mode-trick')).display};})()");
    assert.equal(trick.mode,'trick');
    assert.equal(trick.board,'none');
    assert.notEqual(trick.trick,'none');
    const wings=await evaluate(cdp.send,sid,"(()=>{document.querySelector('[data-alpine-group=\"race\"]').click();document.querySelector('[data-alpine-mode=\"wings\"]').click();document.querySelector('#alpineSources summary').click();return{mode:document.body.dataset.ssxMode,sourceOpen:document.querySelector('#alpineSources').open,wings:getComputedStyle(document.querySelector('#sheet td.mode-wings')).display,proof:!!document.querySelector('a.proof[href]')};})()");
    assert.equal(wings.mode,'wings');
    assert.equal(wings.sourceOpen,true);
    assert.notEqual(wings.wings,'none');
    assert.equal(wings.proof,true);
    const outDir=path.join(process.cwd(),'artifacts');
    fs.mkdirSync(outDir,{recursive:true});
    const deskShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(outDir,'ssx-v37-desktop.png'),Buffer.from(deskShot.data,'base64'));
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},sid);
    await evaluate(cdp.send,sid,"window.scrollTo({top:0,behavior:'instant'})");
    await sleep(400);

    const mobileHeroShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(outDir,'ssx-v37-mobile-hero.png'),Buffer.from(mobileHeroShot.data,'base64'));
    const mobile=await evaluate(cdp.send,sid,"({cards:getComputedStyle(document.querySelector('#alpineMobileCards')).display,table:getComputedStyle(document.querySelector('.sheet-scroll')).display,records:document.querySelectorAll('#alpineMobileCards .alpine-card').length,mode:document.body.dataset.ssxMode,viewport:window.innerWidth})");
    assert.equal(mobile.table,'none');
    assert.equal(mobile.cards,'none','Mobile now starts with the same regional explorer as desktop');
    assert.ok(mobile.records>0,'Read-only legacy card data must remain available for filtered views');
    const mobileRegional=await evaluate(cdp.send,sid,"(()=>{const root=document.querySelector('#ssxRegionBrowser');const africa=[...root.querySelectorAll('.ssx-region-group')].find(x=>x.dataset.regionName==='Africa');const banner=africa.querySelector('.ssx-region-banner');const detail=root.querySelector('.ssx-region-detail');const art=getComputedStyle(banner,'::before').backgroundImage;return {shown:getComputedStyle(root).display,cols:getComputedStyle(root).gridTemplateColumns,africa:!!africa,redLight:detail.querySelector('h3')?.textContent,runs:detail.querySelectorAll('.ssx-region-rank').length,flags:detail.querySelectorAll('.ssx-region-rider .rider-flag').length,art,navOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()");
    assert.equal(mobileRegional.shown,'grid','Mobile must render real region and mountain hierarchy');
    assert.equal(mobileRegional.redLight,'Red Light');
    assert.ok(mobileRegional.runs>0&&mobileRegional.flags>0,'Real flags and record rows must remain accessible');
    assert.match(mobileRegional.art,/\/hobbies\/ssx\/media\/v37\//,'Region needs pinned game artwork');
    assert.equal(mobileRegional.navOverflow,false,'Regional mobile layout must not overflow screen');
    const resetMobile=await evaluate(cdp.send,sid,"(()=>({height:Math.round(document.querySelector('#ssxResetFilters').getBoundingClientRect().height),label:document.querySelector('#ssxResetFilters').textContent,contained:document.querySelector('.sheet-card #toolbar').contains(document.querySelector('#ssxResetFilters')),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}))()");
    assert.ok(resetMobile.height>=40&&resetMobile.contained);
    assert.ok(resetMobile.overflow<=1);

    const modeSheet=await evaluate(cdp.send,sid,"(()=>{const detail=document.querySelector('.ssx-region-detail');const bar=document.querySelector('#ssxSheetModeFilter');const header=detail.querySelector('.ssx-region-detail-header');const rank=detail.querySelector('.ssx-region-ranking');const buttons=[...bar.querySelectorAll('button:not([hidden])')];return {inDetail:bar.parentElement===detail,barDisplay:getComputedStyle(bar).display,belowHeader:bar.getBoundingClientRect().top>=header.getBoundingClientRect().bottom-1,aboveScores:bar.getBoundingClientRect().bottom<=rank.getBoundingClientRect().top+1,labels:buttons.map(b=>b.querySelector('.ssx-sheet-mode-name')?.textContent),active:bar.querySelector('[aria-pressed=true]')?.dataset.ssxSheetMode,hiddenUpper:getComputedStyle(document.querySelector('#alpineSubmodes')).display==='none',controlsHeight:buttons.map(b=>Math.round(b.getBoundingClientRect().height)),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}})()");
    assert.equal(modeSheet.inDetail,true,'Mode selector belongs directly inside the chosen track classification');
    assert.equal(modeSheet.barDisplay,'grid','Board/Wingsuit must remain visible by scores');
    assert.equal(modeSheet.belowHeader,true,'Mode selector must follow the chosen track banner');
    assert.equal(modeSheet.aboveScores,true,'Mode selector must precede rider times');
    assert.deepEqual(modeSheet.labels,['Board','Wingsuit']);
    assert.equal(modeSheet.active,'wings');
    assert.equal(modeSheet.hiddenUpper,true,'No duplicated submode selectors in the hero');
    assert.ok(modeSheet.controlsHeight.every(h=>h>=44)&&modeSheet.overflow<=1);
    const switchBoard=await evaluate(cdp.send,sid,"(()=>{document.querySelector('#ssxSheetModeFilter [data-ssx-sheet-mode=board]').click();return{mode:document.body.dataset.ssxMode,active:document.querySelector('#ssxSheetModeFilter [aria-pressed=true]')?.dataset.ssxSheetMode,hero:document.querySelector('#heroTitle')?.textContent,catalog:document.querySelectorAll('#ssxSheetRegions button').length}})()");
    assert.equal(switchBoard.mode,'board');
    assert.equal(switchBoard.active,'board');
    assert.equal(switchBoard.hero,'Conquiste a montanha.');
    assert.equal(switchBoard.catalog,13,'Submode switch must preserve all region tabs');
    await sleep(150);
    const boardScore=await evaluate(cdp.send,sid,"document.querySelector('.ssx-region-detail .ssx-region-score')?.textContent");
    assert.equal(boardScore,'01:35.99','Mobile Board must show original Board times, not just change its label');
    await evaluate(cdp.send,sid,"document.querySelector('#ssxSheetModeFilter [data-ssx-sheet-mode=wings]').click()");
    await sleep(150);
    const wingsScore=await evaluate(cdp.send,sid,"(()=>({mode:document.body.dataset.ssxMode,active:document.querySelector('#ssxSheetModeFilter [aria-pressed=true]')?.dataset.ssxSheetMode,score:document.querySelector('.ssx-region-detail .ssx-region-score')?.textContent}))()");
    assert.equal(wingsScore.mode,'wings');
    assert.equal(wingsScore.active,'wings');
    assert.equal(wingsScore.score,'01:11.92');
    const otherModes=await evaluate(cdp.send,sid,"(()=>{document.querySelector('[data-alpine-group=survive]').click();const surviving=[...document.querySelectorAll('#ssxSheetModeFilter button:not([hidden])')].map(b=>b.dataset.ssxSheetMode);document.querySelector('#ssxSheetModeFilter [data-ssx-sheet-mode=special]').click();const special=document.body.dataset.ssxMode;document.querySelector('[data-alpine-group=trick]').click();const trickHidden=document.querySelector('#ssxSheetModeFilter').hidden;document.querySelector('[data-alpine-group=race]').click();return {surviving,special,trickHidden,restored:document.body.dataset.ssxMode,active:document.querySelector('#ssxSheetModeFilter [aria-pressed=true]')?.dataset.ssxSheetMode}})()");
    assert.deepEqual(otherModes.surviving,['survive','special']);
    assert.equal(otherModes.special,'special');
    assert.equal(otherModes.trickHidden,true,'Do not show irrelevant Board/Wings controls in Trick It!');
    assert.equal(otherModes.restored,'wings');
    assert.equal(otherModes.active,'wings');

    const sheetTabsMobile=await evaluate(cdp.send,sid,"(()=>{const nav=document.querySelector('#ssxSheetRegions');const search=document.querySelector('#ssxRegionSearch');return {display:getComputedStyle(nav).display,count:nav.querySelectorAll('button').length,contained:document.querySelector('.sheet-card').contains(nav),scrollOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,searchReady:!!search&&search.type==='search'}})()");
    assert.equal(sheetTabsMobile.display,'flex');
    assert.ok(sheetTabsMobile.count>=3&&sheetTabsMobile.contained);
    assert.equal(sheetTabsMobile.searchReady,true);
    assert.ok(sheetTabsMobile.scrollOverflow<=1,'The region tab rail should scroll inside itself on mobile');
    const smallNav=await evaluate(cdp.send,sid,"(()=>{const root=document.querySelector('#ssxRegionBrowser');const search=root.querySelector('#ssxRegionSearch');const step=root.querySelector('[data-ssx-track-step=\"1\"]');return {searchHeight:Math.round(search.getBoundingClientRect().height),stepWidth:Math.round(step.getBoundingClientRect().width),stepLabel:step.getAttribute('aria-label'),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}})()");
    assert.ok(smallNav.searchHeight>=35&&smallNav.stepWidth>=40,'Mobile regional controls need usable target sizes');
    assert.equal(smallNav.stepLabel,'Próxima pista');
    assert.ok(smallNav.overflow<=1);
    const mobileDensity=await evaluate(cdp.send,sid,"(()=>{const rows=[...document.querySelectorAll('.ssx-region-detail .ssx-region-rank')];const row=rows[0];const proof=rows.find(x=>x.querySelector('.ssx-region-proof'))?.querySelector('.ssx-region-proof');const btn=row.querySelector('.ssx-region-rider');const score=row.querySelector('.ssx-region-score');const metrics=row.querySelector('.ssx-region-metrics');const banner=document.querySelector('.ssx-region-detail-header');return {maxHeight:Math.max(...rows.slice(0,8).map(x=>Math.round(x.getBoundingClientRect().height))),count:rows.length,proofHeight:Math.round(proof?.getBoundingClientRect().height||0),proofWidth:Math.round(proof?.getBoundingClientRect().width||0),proofLabel:proof?.getAttribute('aria-label'),score:score.textContent,rider:btn.textContent.trim(),hasFlags:!!btn.querySelector('.rider-flag'),metricsInline:Boolean(metrics.contains(score)&&proof?.closest('.ssx-region-metrics')?.contains(proof)),headerHeight:Math.round(banner.getBoundingClientRect().height),width:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}})()");
    assert.ok(mobileDensity.maxHeight<=68,'Eight rows should fit in substantially less height');
    assert.ok(mobileDensity.proofHeight>=36&&mobileDensity.proofWidth>=36&&mobileDensity.proofLabel,'Proof link retains an accessible target');
    assert.equal(mobileDensity.metricsInline,true,'Time and evidence should share one compact line');
    assert.equal(mobileDensity.score,'01:11.92','Mobile keeps complete Wingsuit time');
    assert.ok(mobileDensity.hasFlags,'Rider flag remains visible');
    assert.ok(mobileDensity.headerHeight<=125,'Regional header leaves space for ranking');
    assert.ok(mobileDensity.width<=mobileDensity.viewport+1);
    await evaluate(cdp.send,sid,"document.querySelector('#ssxRegionBrowser').scrollIntoView({block:'start'})");
    await sleep(220);
    const regionalShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.mkdirSync(path.join(process.cwd(),'artifacts'),{recursive:true});
    fs.writeFileSync(path.join(process.cwd(),'artifacts','ssx-r42-mobile-regions.png'),Buffer.from(regionalShot.data,'base64'));
    assert.equal(mobile.mode,'wings');
    assert.ok(mobile.viewport<=430);
    const directNav=await evaluate(cdp.send,sid,"(()=>{const quick=document.querySelector('#ssxMobileQuickNav');const direct=document.querySelector('#ssxDirectActions');const brand=document.querySelector('.brand');const menu=document.querySelector('#mobileMenuBtn');const buttons=[...direct.querySelectorAll('button')];return{quickLabels:[...quick.querySelectorAll('button')].map(b=>b.textContent),directLabels:buttons.map(b=>b.textContent),brandHidden:getComputedStyle(brand).display==='none',legacyHidden:getComputedStyle(document.querySelector('#topNav')).display==='none',hamburgerRemoved:menu===null,panelRemoved:!document.querySelector('#ssxMobileMore'),actionable:buttons.every(b=>b.getBoundingClientRect().height>=40),screenOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}})()");
    assert.deepEqual(directNav.quickLabels,['Recordes','Riders','Comunidade','Sobre']);
    assert.deepEqual(directNav.directLabels,['Ajustes','Guia','Sobre os dados','Submissões','Dados','Admin']);
    assert.equal(directNav.brandHidden,true);
    assert.equal(directNav.legacyHidden,true);
    assert.equal(directNav.hamburgerRemoved,true);
    assert.equal(directNav.panelRemoved,true);
    assert.ok(directNav.actionable&&directNav.screenOverflow<=1);
    const directChecks=await evaluate(cdp.send,sid,"(()=>{document.querySelector('#ssxDirectActions [data-ssx-action=introBtn]').click();const guide=document.querySelector('#introModal').getAttribute('aria-hidden');document.querySelector('[data-close=introModal]').click();document.querySelector('#ssxDirectActions [data-ssx-action=sources]').click();const sourcesOpen=document.querySelector('#alpineSources').open;const filtersOpen=document.querySelector('#alpineAdvancedFilters').open;return {guide,sourcesOpen,filtersOpen}})()");
    assert.equal(directChecks.guide,'false','Guide must open directly from the permanent navigation');
    assert.equal(directChecks.sourcesOpen,true,'Sources should be reached directly');
    assert.equal(directChecks.filtersOpen,true,'Direct sources action expands the necessary filter disclosure');
    await evaluate(cdp.send,sid,"(()=>{document.querySelector('#alpineAdvancedFilters').open=false;document.querySelector('#alpineSources').open=false;})()");
    const directPreview=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(ssxVisualDir,'ssx-r51-mobile-direct-actions.png'),Buffer.from(directPreview.data,'base64'));
    const publicButtons=await evaluate(cdp.send,sid,"(()=>{document.querySelector('#ssxMobileQuickNav [data-ssx-action=aboutBtn]').click();const about=document.querySelector('#aboutModal').getAttribute('aria-hidden');document.querySelector('[data-close=aboutModal]').click();document.querySelector('#ssxMobileQuickNav [data-ssx-action=ridersBtn]').click();const riderModal=document.querySelector('#ridersModal');return {about,riderModal:riderModal?.getAttribute('aria-hidden')||'not-found'}})()");
    assert.equal(publicButtons.about,'false','About must open from the visible mobile shortcut');
    assert.notEqual(publicButtons.riderModal,'not-found','Riders must retain the original content');
    const mobileViewActions=await evaluate(cdp.send,sid,"(()=>{const details=document.querySelector('#ssxViewOptions');const summary=details.querySelector('summary');const toggle=document.querySelector('#alpinePositionsToggle');const table=document.querySelector('#alpineToggleTable');return{visible:details.open&&!toggle.hidden&&toggle.getBoundingClientRect().width>=40&&table.getBoundingClientRect().width>=40,summaryHidden:getComputedStyle(summary).display==='none'}})()");
    assert.equal(mobileViewActions.visible,true,'Table/positions controls must stay directly available');
    assert.equal(mobileViewActions.summaryHidden,true,'Display controls must not require opening another menu');
    // Check preview-only interactions without writing to Google, Discord or ZVM APIs.
    const overview=await evaluate(cdp.send,sid,"(()=>{const root=document.querySelector('#alpineMobileCards');return {first:root.querySelector('.alpine-card .alpine-card-top span')?.textContent,second:root.querySelectorAll('.alpine-card')[1]?.querySelector('.alpine-card-top span')?.textContent,toggleVisible:!document.querySelector('#alpinePositionsToggle').hidden};})()");
    assert.ok(overview.toggleVisible,'Summary controls should be visible in mobile overview');
    const allRanks=await evaluate(cdp.send,sid,"(()=>{document.querySelector('#alpinePositionsToggle').click();return {pressed:document.querySelector('#alpinePositionsToggle').getAttribute('aria-pressed'),firstTwo:Array.from(document.querySelectorAll('#alpineMobileCards .alpine-card')).slice(0,2).map(card=>card.querySelector('.alpine-card-top span')?.textContent)};})()");
    await sleep(300);
    const positions=await evaluate(cdp.send,sid,"({pressed:document.querySelector('#alpinePositionsToggle').getAttribute('aria-pressed'),firstTwo:Array.from(document.querySelectorAll('#alpineMobileCards .alpine-card')).slice(0,2).map(card=>card.querySelector('.alpine-card-top span')?.textContent),number:document.querySelectorAll('#alpineMobileCards .alpine-card').length})");
    assert.equal(positions.pressed,'true');
    const cardsContext=await evaluate(cdp.send,sid,"(()=>{const card=document.querySelector('#alpineMobileCards .alpine-card-visual');return {cardDisplay:getComputedStyle(document.querySelector('#alpineMobileCards')).display,regionalDisplay:getComputedStyle(document.querySelector('#ssxRegionBrowser')).display,region:card.querySelector('.ssx-card-location')?.textContent,art:getComputedStyle(card,'::before').backgroundImage,scoreColor:getComputedStyle(card.querySelector('.alpine-card-score')).color}})()");
    assert.equal(cardsContext.cardDisplay,'grid','All positions must show artwork-backed card feed');
    assert.equal(cardsContext.regionalDisplay,'none','Avoid duplicated desktop/mobile rankings');
    assert.ok(cardsContext.region.includes('Africa'));
    assert.match(cardsContext.art,/\/hobbies\/ssx\/media\/v37\//,'Mobile cards need original regional art');
    assert.equal(positions.firstTwo[0],positions.firstTwo[1],'All positions should display two ranks from the same track');
    assert.ok(positions.number>1);
    await evaluate(cdp.send,sid,"document.querySelector('.sheet-card').scrollIntoView({block:'start'})");
    await sleep(200);
    const positionsShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(outDir,'ssx-v37-mobile-all-positions.png'),Buffer.from(positionsShot.data,'base64'));
    await evaluate(cdp.send,sid,"document.querySelector('#alpinePositionsToggle').click()");
    await sleep(250);
    const leaders=await evaluate(cdp.send,sid,"(()=>{const root=document.querySelector('#alpineMobileCards');const cards=[...root.querySelectorAll('[data-leader-track]')];const tracks=cards.map(card=>card.querySelector('.alpine-card-top span')?.textContent);const redLight=cards.filter(card=>card.querySelector('.alpine-card-top span')?.textContent==='Red Light');const nav=document.querySelector('#ssxSheetModeFilter');return {pressed:document.querySelector('#alpinePositionsToggle').getAttribute('aria-pressed'),leadersPressed:document.querySelector('#ssxLeadersToggle').getAttribute('aria-pressed'),tracks:tracks.slice(0,5),count:cards.length,unique:new Set(cards.map(card=>card.dataset.leaderTrack)).size,regions:new Set(cards.map(card=>card.dataset.leaderRegion)).size,regionNames:[...new Set(cards.map(card=>card.dataset.leaderRegion))],redLightCount:redLight.length,redLightRank:redLight[0]?.dataset.leaderPosition,redLightScore:redLight[0]?.querySelector('.alpine-card-score')?.textContent,modeVisible:getComputedStyle(nav).display!=='none',modeParent:nav.parentElement?.classList.contains('sheet-card'),visibleCards:getComputedStyle(root).display==='grid',bannerHidden:getComputedStyle(document.querySelector('#ssxRegionBrowser')).display==='none',progress:document.querySelector('#renderProgress')?.hidden}})()");
    assert.equal(leaders.pressed,'false');
    assert.equal(leaders.leadersPressed,'true');
    assert.ok(leaders.count>=15,'Each scored track must produce one leader, not 16 Red Light positions');
    assert.equal(leaders.unique,leaders.count,'The leader overview must never repeat a track');
    assert.ok(leaders.regions>=4,'Leader overview must cover multiple regions, not just Africa');
    assert.equal(leaders.redLightCount,1,'Red Light must appear once, never 16 times');
    assert.equal(leaders.redLightRank,'#1');
    assert.equal(leaders.redLightScore,'01:11.92','Wingsuit leader must show the real Wingsuit time');
    assert.ok(leaders.modeVisible&&leaders.modeParent&&leaders.visibleCards&&leaders.bannerHidden);
    assert.equal(leaders.progress,true,'No return to progressive track loading');
    const podium=await evaluate(cdp.send,sid,"(()=>{const root=document.querySelector('#alpineMobileCards');const panel=root.querySelector('#ssxTop3Podium');const tiles=[...panel.querySelectorAll('.ssx-top3-entry')];const modes=[...document.querySelectorAll('#ssxSheetModeFilter button:not([hidden])')].map(b=>b.dataset.ssxSheetMode);const videos=[...root.querySelectorAll('a.ssx-youtube-proof')];const cards=[...root.querySelectorAll('.alpine-card-leader')];const rawProofs=document.querySelectorAll('#tbody a.proof[href]').length;return {panel:!!panel,title:panel.querySelector('h3')?.textContent,description:panel.querySelector('p')?.textContent,mode:panel.dataset.podiumMode,number:tiles.length,positions:tiles.map(x=>Number(x.dataset.ssxPodiumRank)),riders:tiles.map(x=>x.dataset.ssxPodiumRider),wins:tiles.map(x=>Number(x.dataset.ssxPodiumWins)),modes,rawProofs,videoLinks:videos.length,missing:cards.filter(x=>x.querySelector('.ssx-video-unavailable')).length,covered:cards.every(x=>!!x.querySelector('a.ssx-youtube-proof, .ssx-video-unavailable')),safeVideos:videos.every(a=>a.target==='_blank'&&a.rel.includes('noopener')&&!!a.querySelector('.ssx-youtube-icon')&&a.textContent.trim()==='YouTube'&&['youtu.be','youtube.com','www.youtube.com','m.youtube.com'].includes(new URL(a.href).hostname)),firstColor:videos.length?getComputedStyle(videos[0].querySelector('.ssx-youtube-icon')).backgroundColor:null,width:document.documentElement.scrollWidth-document.documentElement.clientWidth}})()");
    assert.equal(podium.panel,true,'Leaders overview should show a Top 3 podium');
    assert.equal(podium.mode,'wings');
    assert.match(podium.title,/Top 3/);
    assert.match(podium.description,/pistas em 1º lugar/,'Explain why cross-track scores are not compared');
    assert.ok(podium.number>=1&&podium.number<=3,'Up to three verified #1 holders should appear; never invent a podium position');
    assert.deepEqual(podium.positions,Array.from({length:podium.number},(_,i)=>i+1));
    assert.equal(new Set(podium.riders).size,podium.number);
    assert.ok(podium.wins.every((win,i)=>win>0&&(i===0||win<=podium.wins[i-1])),'Podium must use distinct first-place finish counts');
    assert.deepEqual(podium.modes,['board','wings','trick','survive','special'],'All five real categories must be reachable directly');
    assert.equal(podium.covered,true,'Cards without registered video must explain why YouTube is absent');
    assert.equal(podium.safeVideos,true,'YouTube actions must open trusted video proof with security attributes');
    assert.ok(podium.videoLinks>=1,'The leader gallery must display actual YouTube evidence when available');
    assert.equal(podium.firstColor,'rgb(255, 0, 51)');
    assert.ok(podium.width<=1,'Podium and mode tabs must not overflow the mobile viewport');
    console.log('SSX_YOUTUBE_AUDIT',JSON.stringify({sourceLinks:podium.rawProofs,leaderVideoLinks:podium.videoLinks,missingVideos:podium.missing,podiumWins:podium.wins}));
    const medalPreview=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(outDir,'ssx-r53-mobile-youtube-podium.png'),Buffer.from(medalPreview.data,'base64'));
    for(const mode of ['board','wings','trick','survive','special']){
      await evaluate(cdp.send,sid,"document.querySelector('#ssxSheetModeFilter [data-ssx-sheet-mode="+mode+"]').click()");
      await sleep(180);
      const active=await evaluate(cdp.send,sid,"(()=>{const panel=document.querySelector('#ssxTop3Podium');const items=[...panel.querySelectorAll('.ssx-top3-entry')];const cards=[...document.querySelectorAll('#alpineMobileCards .alpine-card-leader')];return{mode:panel.dataset.podiumMode,selected:document.querySelector('#ssxSheetModeFilter [aria-pressed=true]')?.dataset.ssxSheetMode,number:items.length,wins:items.map(x=>Number(x.dataset.ssxPodiumWins)),unique:new Set(items.map(x=>x.dataset.ssxPodiumRider)).size,cards:cards.length,modeTabs:document.querySelectorAll('#ssxSheetModeFilter button:not([hidden])').length,legacyProgress:document.querySelector('#renderProgress')?.hidden}})()");
      assert.equal(active.mode,mode,'Podium must follow the selected SSX mode');
      assert.equal(active.selected,mode);
      assert.equal(active.modeTabs,5,'Every mode remains one tap away');
      assert.ok(active.number<=3&&active.number>=0);
      assert.equal(active.unique,active.number);
      assert.ok(active.wins.every((win,i)=>win>=1&&(i===0||win<=active.wins[i-1])));
      assert.equal(active.legacyProgress,true);
    }
    await evaluate(cdp.send,sid,"document.querySelector('#ssxSheetModeFilter [data-ssx-sheet-mode=wings]').click()");
    await sleep(180);

    await evaluate(cdp.send,sid,"document.querySelector('#ssxSheetModeFilter [data-ssx-sheet-mode=board]').click()");
    await sleep(220);
    const boardLeaders=await evaluate(cdp.send,sid,"(()=>{const cards=[...document.querySelectorAll('#alpineMobileCards [data-leader-track]')];const red=cards.find(card=>card.querySelector('.alpine-card-top span')?.textContent==='Red Light');return {mode:document.body.dataset.ssxMode,selected:document.querySelector('#ssxSheetModeFilter [aria-pressed=true]')?.dataset.ssxSheetMode,count:cards.length,unique:new Set(cards.map(card=>card.dataset.leaderTrack)).size,redTime:red?.querySelector('.alpine-card-score')?.textContent,redRank:red?.dataset.leaderPosition}})()");
    assert.equal(boardLeaders.mode,'board');
    assert.equal(boardLeaders.selected,'board');
    assert.ok(boardLeaders.count>=15);
    assert.equal(boardLeaders.count,boardLeaders.unique);
    assert.equal(boardLeaders.redTime,'01:35.99');
    assert.equal(boardLeaders.redRank,'#1');
    await evaluate(cdp.send,sid,"document.querySelector('#ssxSheetModeFilter [data-ssx-sheet-mode=wings]').click()");
    await sleep(180);
    await evaluate(cdp.send,sid,"document.querySelector('#ssxRegionsToggle').click()");
    await sleep(180);
    assert.equal(await evaluate(cdp.send,sid,"getComputedStyle(document.querySelector('#ssxRegionBrowser')).display"),'grid','Regions returns to the approved mountain browsing panel');
    assert.equal(await evaluate(cdp.send,sid,"document.querySelector('#ssxSheetModeFilter').parentElement.classList.contains('ssx-region-detail')"),true);

    const detail=await evaluate(cdp.send,sid,"(()=>{const track=document.querySelector('#track');track.value='0';track.dispatchEvent(new Event('change',{bubbles:true}));return {track:track.value};})()");
    assert.equal(detail.track,'0','Red Light should exist as original track selector');
    await sleep(450);
    const trackCards=await evaluate(cdp.send,sid,"({ranks:Array.from(document.querySelectorAll('#alpineMobileCards .alpine-card')).slice(0,3).map(card=>card.querySelector('.alpine-card-top span:last-child')?.textContent),toggleHidden:document.querySelector('#alpinePositionsToggle').hidden,mode:document.body.dataset.ssxMode})");
    assert.ok(trackCards.ranks.length>=2,'Selected track should expose ranked entries, not only its winner');
    assert.equal(trackCards.toggleHidden,false,'Leaders must be directly accessible even when Red Light is filtered');
    assert.equal(trackCards.mode,'wings');
    assert.equal(await evaluate(cdp.send,sid,"getComputedStyle(document.querySelector('#alpineMobileCards')).display"),'grid','Single-track filter must show real ranked cards');
    await evaluate(cdp.send,sid,"document.querySelector('#ssxLeadersToggle').click()");
    await sleep(250);
    const freedLeaders=await evaluate(cdp.send,sid,"(()=>{const cards=[...document.querySelectorAll('#alpineMobileCards [data-leader-track]')];return{trackFilter:document.querySelector('#track').value,regions:new Set(cards.map(x=>x.dataset.leaderRegion)).size,tracks:cards.length,unique:new Set(cards.map(x=>x.dataset.leaderTrack)).size,redCount:cards.filter(x=>x.querySelector('.alpine-card-top span')?.textContent==='Red Light').length,mode:document.body.dataset.ssxMode}})()");
    assert.equal(freedLeaders.trackFilter,'','Leaders must clear a stale single-track filter');
    assert.ok(freedLeaders.regions>=4&&freedLeaders.tracks>=15);
    assert.equal(freedLeaders.tracks,freedLeaders.unique);
    assert.equal(freedLeaders.redCount,1);
    assert.equal(freedLeaders.mode,'wings');
    await evaluate(cdp.send,sid,"document.querySelector('#ssxRegionsToggle').click()");
    await sleep(160);
    assert.equal(await evaluate(cdp.send,sid,"getComputedStyle(document.querySelector('#ssxRegionBrowser')).display"),'grid','Return to regions must restore the photographic mountain navigator');

    await evaluate(cdp.send,sid,"(()=>{const track=document.querySelector('#track');track.value='';track.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await sleep(350);
    await evaluate(cdp.send,sid,"(()=>{const search=document.querySelector('#search');search.value='LR1290';search.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await sleep(650);
    const searched=await evaluate(cdp.send,sid,"({query:document.querySelector('#search').value,labels:Array.from(document.querySelectorAll('#alpineMobileCards .alpine-card-rider')).map(button=>button.textContent),toggleHidden:document.querySelector('#alpinePositionsToggle').hidden,number:document.querySelectorAll('#alpineMobileCards .alpine-card').length})");
    assert.equal(searched.query,'LR1290');
    assert.equal(searched.toggleHidden,false,'The user must be able to jump from rider search to leaders directly');
    assert.ok(searched.labels.some(name=>name.includes('LR1290')),'Filtered mobile cards must include matching rider');
    await evaluate(cdp.send,sid,"(()=>{const search=document.querySelector('#search');search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await sleep(350);
    const restored=await evaluate(cdp.send,sid,"(()=>{document.querySelector('[data-alpine-group=\"trick\"]').click();const before=document.body.dataset.ssxMode;document.querySelector('#alpineToggleTable').click();const all=document.body.dataset.ssxMode;document.querySelector('#alpineToggleTable').click();return {before,all,back:document.body.dataset.ssxMode};})()");
    assert.deepEqual(restored,{before:'trick',all:'all',back:'trick'},'Full table must return to actual prior mode');

    const focus=await evaluate(cdp.send,sid,"(()=>{document.querySelector('[data-alpine-group=\"race\"]').click();const wings=document.querySelector('#ssxSheetModeFilter [data-ssx-sheet-mode=\"wings\"]');wings.focus();wings.click();return {mode:document.body.dataset.ssxMode,retained:document.activeElement===wings};})()");
    assert.equal(focus.mode,'wings');
    assert.equal(focus.retained,true,'Mobile submode selection must retain focus on the visible control');

    await evaluate(cdp.send,sid,"document.querySelector('[data-lang=\"en\"]').click()");
    await sleep(300);
    const translated=await evaluate(cdp.send,sid,"({hero:document.querySelector('#heroTitle').textContent,more:document.querySelector('#alpinePositionsToggle').textContent,language:document.querySelector('#langName').textContent,snapshotLabel:document.querySelector('[data-ssx-snapshot-count-label]')?.textContent})");
    assert.equal(translated.hero,'Conquer the mountain.','New page headline must follow original language selector');
    assert.equal(translated.language.trim(),'English');
    assert.equal(translated.snapshotLabel,'records in the 2026-08-22 snapshot','Dated snapshot label must translate without becoming current/live');
    const translatedArchive=await evaluate(cdp.send,sid,"(()=>({title:document.querySelector('#ssxSpecialTitle')?.textContent,note:document.querySelector('#ssxSpecialNote')?.textContent,group:document.querySelector('#ssxSpecialTabs [aria-pressed=true]')?.dataset.ssxSpecialGroup}))()");
    assert.match(translatedArchive.title,/Special challenges/i);
    assert.match(translatedArchive.note,/2026-08-22/);
    assert.equal(translatedArchive.group,'challenge','Changing language must preserve the selected historic category');
    await evaluate(cdp.send,sid,"document.querySelector('[data-lang=\"pt-BR\"]').click()");
    await sleep(300);

    const portuguese=await evaluate(cdp.send,sid,"({lang:document.querySelector('#langName').textContent,hero:document.querySelector('#heroTitle').textContent})");
    assert.equal(portuguese.lang.trim(),'Português');
    assert.equal(portuguese.hero,'Conquiste a montanha.');
    const sourceSwitched=await evaluate(cdp.send,sid,"(()=>{document.querySelector('[data-source=\"google\"]').click();return {source:document.querySelector('#sourceSeg [data-source].active')?.dataset.source,bridge:!!document.querySelector('#liveTestBtn')};})()");
    assert.equal(sourceSwitched.source,'google','Existing Google Sheets source selection must still work');
    assert.equal(sourceSwitched.bridge,true,'Original Bridge settings must remain in the DOM');
    await evaluate(cdp.send,sid,"document.querySelector('[data-source=\"combined\"]').click()");
    await sleep(400);
    const combined=await evaluate(cdp.send,sid,"document.querySelector('#sourceSeg [data-source].active')?.dataset.source");
    assert.equal(combined,'combined');

    // Original Settings still controls the light/dark palette on Alpine panels.
    const light=await evaluate(cdp.send,sid,"(()=>{const theme=document.querySelector('#theme');theme.value='light';theme.dispatchEvent(new Event('change',{bubbles:true}));return {selected:theme.value,applied:document.documentElement.getAttribute('data-theme'),bg:getComputedStyle(document.body).backgroundColor,card:getComputedStyle(document.querySelector('.alpine-card')).backgroundColor};})()");
    assert.equal(light.selected,'light');
    assert.equal(light.applied,'light');
    assert.equal(light.bg,'rgb(237, 245, 250)');
    const lightRegion=await evaluate(cdp.send,sid,"(()=>({display:getComputedStyle(document.querySelector('#ssxRegionBrowser')).display,background:getComputedStyle(document.querySelector('.ssx-region-detail')).backgroundColor}))()");
    assert.equal(lightRegion.display,'grid');
    await evaluate(cdp.send,sid,"document.querySelector('.sheet-card').scrollIntoView({block:'start'})");
    await sleep(230);
    const lightShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(outDir,'ssx-v37-mobile-light.png'),Buffer.from(lightShot.data,'base64'));
    const dark=await evaluate(cdp.send,sid,"(()=>{const theme=document.querySelector('#theme');theme.value='dark';theme.dispatchEvent(new Event('change',{bubbles:true}));return document.documentElement.getAttribute('data-theme');})()");
    assert.equal(dark,'dark');
    for(const [width,height,columns] of [[320,740,1],[768,900,2],[1440,900,4],[390,844,2]]){
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<=390},sid);
      await sleep(180);
      const measured=await evaluate(cdp.send,sid,"(()=>{const grid=document.querySelector('.alpine-mode-grid');const sheet=document.querySelector('.sheet-card');return {columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,toolbarWidth:document.querySelector('#toolbar').getBoundingClientRect().width,sheetWidth:sheet.getBoundingClientRect().width,viewport:document.documentElement.clientWidth};})()");
      assert.equal(measured.columns,columns,'Modal card columns at '+width+'px');
      assert.ok(measured.sheetWidth<=measured.viewport+1,'Result panel must not overflow viewport at '+width+'px');
      const responsiveMode=await evaluate(cdp.send,sid,"(()=>({bar:getComputedStyle(document.querySelector('#ssxSheetModeFilter')).display,top:getComputedStyle(document.querySelector('#alpineSubmodes')).display,screenOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,controls:[...document.querySelectorAll('#ssxSheetModeFilter button:not([hidden])')].map(el=>Math.round(el.getBoundingClientRect().width))}))()");
      assert.equal(responsiveMode.bar,width<=900?'grid':'none','Mobile sheet controls must respect breakpoint at '+width+'px');
      assert.equal(responsiveMode.top,width<=900?'none':'flex','Original large-screen submodes must remain available at '+width+'px');
      assert.ok(responsiveMode.screenOverflow<=1,'No horizontal overflow at '+width+'px');
      const specialResponsive=await evaluate(cdp.send,sid,"(()=>{const root=document.querySelector('#ssxSpecialArchive');const rect=root.getBoundingClientRect();const buttons=[...root.querySelectorAll('.ssx-special-tab')];const selects=[...root.querySelectorAll('.ssx-special-select')].filter(x=>getComputedStyle(x.closest('label')).display!=='none');return{width:Math.round(rect.width),viewport:document.documentElement.clientWidth,docOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,internalScroll:root.querySelector('#ssxSpecialTabs').scrollWidth>=root.querySelector('#ssxSpecialTabs').clientWidth,buttonHeights:buttons.map(x=>Math.round(x.getBoundingClientRect().height)),selectHeights:selects.map(x=>Math.round(x.getBoundingClientRect().height)),recordCount:root.querySelectorAll('.ssx-special-record').length}})()");
      assert.ok(specialResponsive.width<=specialResponsive.viewport+1,'Historical panel must fit at '+width+'px');
      assert.ok(specialResponsive.docOverflow<=1,'Historical panel must not stretch viewport at '+width+'px');
      assert.ok(specialResponsive.buttonHeights.every(v=>v>=39),'Historical category tabs must remain usable at '+width+'px');
      assert.ok(specialResponsive.selectHeights.every(v=>v>=39),'Historical filters must remain usable at '+width+'px');
      if(width<=390){
        const historicLeaderMobile=await evaluate(cdp.send,sid,"(()=>{document.querySelector('#ssxSpecialTabs [data-ssx-special-group=android]').click();const mode=document.querySelector('#ssxSpecialMode');mode.value='2';mode.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#ssxSpecialViews [data-ssx-special-view=leaders]').click();const root=document.querySelector('#ssxSpecialArchive');const podium=document.querySelector('#ssxSpecialPodium');const cards=[...root.querySelectorAll('#ssxSpecialResults .ssx-special-leader')];const podiumCards=[...root.querySelectorAll('.ssx-special-medal-card')];const bounds=[...cards,...podiumCards].map(el=>el.getBoundingClientRect());return{mode:podium.dataset.ssxMode,category:podium.dataset.ssxCategory,platform:podium.dataset.ssxPlatform,podiumCount:podiumCards.length,leaders:cards.length,width:root.getBoundingClientRect().width,viewport:document.documentElement.clientWidth,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,cardOverflow:bounds.some(rect=>rect.width>document.documentElement.clientWidth+1||rect.right>document.documentElement.clientWidth+1),namesVerified:!podium.querySelector('.ssx-special-identity-warning')?.textContent?.includes('Ozmonet'),view:root.querySelector('[data-ssx-special-view=leaders]')?.getAttribute('aria-pressed')}})()");
        assert.equal(historicLeaderMobile.category,'Android');
        assert.equal(historicLeaderMobile.mode,'2');
        assert.equal(historicLeaderMobile.platform,'Android');
        assert.equal(historicLeaderMobile.podiumCount,3);
        assert.equal(historicLeaderMobile.leaders,12);
        assert.equal(historicLeaderMobile.view,'true');
        assert.equal(historicLeaderMobile.cardOverflow,false,'Historical leader/podium cards must fit '+width+'px');
        assert.ok(historicLeaderMobile.overflow<=1,'Historical leaders must not stretch '+width+'px screen');
        if(width===390){
          await evaluate(cdp.send,sid,"document.querySelector('#ssxSpecialPodium').scrollIntoView({block:'start'})");
          await sleep(150);
          const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
          fs.writeFileSync(path.join(outDir,'ssx-r58-mobile-historical-leaders-podium.png'),Buffer.from(shot.data,'base64'));
        }
        await evaluate(cdp.send,sid,"(()=>{document.querySelector('#ssxSpecialViews [data-ssx-special-view=records]').click();document.querySelector('#ssxSpecialTabs [data-ssx-special-group=challenge]').click()})()");
      }


      if(width<=900)assert.ok(responsiveMode.controls.every(v=>v>75),'Both mobile mode options must fit at '+width+'px');

      if(width<=390){
        const overflow=await evaluate(cdp.send,sid,"document.documentElement.scrollWidth-document.documentElement.clientWidth");
        assert.ok(overflow<=1,'Compact ranking must not cause horizontal overflow at '+width+'px');
      }
    }
    await evaluate(cdp.send,sid,"document.querySelector('.sheet-card').scrollIntoView({block:'start'})");

    const mobShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(outDir,'ssx-v37-mobile.png'),Buffer.from(mobShot.data,'base64'));
    await evaluate(cdp.send,sid,"document.querySelector('#ssxSpecialArchive').scrollIntoView({block:'start'})");
    await sleep(200);
    const specialShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(outDir,'ssx-r57-mobile-historical-special-categories.png'),Buffer.from(specialShot.data,'base64'));

    await evaluate(cdp.send,sid,"document.querySelector('.sheet-card').scrollIntoView({block:'start'})");
    await sleep(300);
    const rankingsShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(outDir,'ssx-v37-mobile-rankings.png'),Buffer.from(rankingsShot.data,'base64'));
    // A copied URL must open the same mountain and mode without storing private data.
    const targetLink=await evaluate(cdp.send,sid,"(()=>{document.querySelector('#ssxSheetRegions [data-ssx-region=Japan]').click();const button=document.querySelector('.ssx-track-share-button');const url=new URL(button.dataset.shareUrl);return {url:url.href,mode:url.searchParams.get('mode'),track:JSON.parse(url.searchParams.get('ssxTrack'))[2],region:JSON.parse(url.searchParams.get('ssxTrack'))[0],allowed:[...url.searchParams.keys()]}})()");
    assert.equal(targetLink.region,'Japan');
    assert.ok(targetLink.track,'Selected track needs a shareable name');
    assert.deepEqual(targetLink.allowed.sort(),['mode','ssxTrack'],'Shared URL should contain only public mode and track selection');
    await cdp.send('Page.navigate',{url:targetLink.url},sid);
    let linked;
    for(let i=0;i<80;i++){
      try{
        linked=await evaluate(cdp.send,sid,"(()=>({ready:document.documentElement.dataset.ssxBoot,region:document.querySelector('#ssxSheetRegions [aria-pressed=true]')?.dataset.ssxRegion,track:document.querySelector('.ssx-region-detail h3')?.textContent,mode:document.body.dataset.ssxMode,catalog:document.querySelectorAll('#ssxSheetRegions button').length,progress:document.querySelector('#renderProgress')?.hidden,share:document.querySelector('.ssx-track-share-button')?.dataset.shareUrl}))()");
        if(linked?.ready==='ready'&&linked?.track===targetLink.track)break;
      }catch(_){}
      await sleep(150);
    }
    assert.equal(linked.region,'Japan','Deep link must restore the region');
    assert.equal(linked.track,targetLink.track,'Deep link must open the exact canonical track');
    assert.equal(linked.mode,targetLink.mode,'Deep link must preserve selected game mode');
    assert.equal(linked.catalog,13,'Shared links must still load all 12 regions');
    assert.equal(linked.progress,true);
    const shareFallback=await evaluate(cdp.send,sid,"(async()=>{const button=document.querySelector('.ssx-track-share-button');Object.defineProperty(navigator,'share',{value:undefined,configurable:true});Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true});button.click();await Promise.resolve();const manual=document.querySelector('.ssx-track-share-manual');return {visible:!manual.hidden,link:manual.value,role:document.querySelector('.ssx-track-share-status').getAttribute('role')}})()");
    assert.equal(shareFallback.visible,true,'Clipboard unavailable must reveal an editable-selectable public URL');
    assert.equal(shareFallback.link,targetLink.url);
    assert.equal(shareFallback.role,'status');

  } finally {
    cdp?.ws.close();
    const exited=chrome.exitCode===null ? new Promise(resolve=>{
      const fallback=setTimeout(resolve,1600);
      chrome.once('exit',()=>{clearTimeout(fallback);resolve();});
    }) : Promise.resolve();
    chrome.kill('SIGTERM');
    await exited;
    if(chrome.exitCode===null)chrome.kill('SIGKILL');
    await new Promise(resolve=>server.close(resolve));
    try { fs.rmSync(dir,{recursive:true,force:true,maxRetries:12,retryDelay:100}); }
    catch(error) { console.warn('Temp Chromium profile cleanup deferred:',error.code); }
  }
});
