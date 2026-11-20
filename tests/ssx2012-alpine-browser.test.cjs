
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
    // R69: Chromium must validate actual control geometry, not merely labels.
    const desktopGeometry=await evaluate(cdp.send,sid,`(()=>{
      const direct=document.querySelector('#ssxDirectActions');
      const shortcuts=[...direct.children].filter(el=>el.matches('button,a')&&getComputedStyle(el).display!=='none');
      const options=[...document.querySelectorAll('#ssxViewOptions .ssx-view-actions > button:not([hidden])')]
        .filter(el=>getComputedStyle(el).display!=='none');
      const rects=shortcuts.map(el=>el.getBoundingClientRect());
      const controls=options.map(el=>el.getBoundingClientRect());
      const overlaps=rects.some((r,i)=>rects.slice(i+1).some(x=>
        r.left<x.right-1&&r.right>x.left+1&&r.top<x.bottom-1&&r.bottom>x.top+1));
      return {actions:shortcuts.length,overlaps,
        actionRows:new Set(rects.map(x=>Math.round(x.top))).size,
        actionHeights:rects.map(x=>Math.round(x.height)),
        optionRows:new Set(controls.map(x=>Math.round(x.top))).size,
        optionHeights:controls.map(x=>Math.round(x.height)),
        viewport:document.documentElement.clientWidth,
        overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
    })()`);
    console.log('SSX_R69_DESKTOP_CONTROLS',JSON.stringify(desktopGeometry));
    assert.ok(desktopGeometry.actions>=4,'Desktop shortcut row must expose public actions');
    assert.equal(desktopGeometry.actionRows,1,'Desktop shortcuts must align in one orderly row');
    assert.equal(desktopGeometry.overlaps,false,'Desktop shortcuts must not collide');
    assert.ok(desktopGeometry.actionHeights.every(h=>h>=36),'Utility chips need real accessible click targets');
    assert.equal(desktopGeometry.optionRows,1,'Desktop table controls must form one contextual row');
    assert.ok(desktopGeometry.optionHeights.every(h=>h>=38));
    assert.ok(desktopGeometry.overflow<=1,'Desktop layout must not overflow horizontally');
    const headerHierarchy=await evaluate(cdp.send,sid,`(()=>{
      const topbar=document.querySelector('.topbar'),nav=document.querySelector('#topNav'),
        tools=document.querySelector('#ssxDirectActions'),quick=document.querySelector('#ssxMobileQuickNav'),
        hero=document.querySelector('.hero'),sheet=document.querySelector('.sheet-head'),
        classification=document.querySelector('#ssxViewOptions .ssx-view-actions'),
        mode=document.querySelector('#alpineModeLabel');
      const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
      const chips=[...tools.querySelectorAll(':scope > button, :scope > a')].map(rect);
      const controls=[...classification.querySelectorAll('button:not([hidden])')].map(rect);
      return {navInside:topbar.contains(nav),utilitiesInside:tools.parentElement?.id==='ssxHeaderUtilityStack'&&
          tools.parentElement?.parentElement===topbar,
        quickInside:quick.parentElement?.id==='ssxHeaderUtilityStack'&&
          quick.parentElement?.parentElement===topbar,
        groups:[...tools.children].map(n=>n.dataset.ssxAction||n.className),
        header:rect(topbar),main:rect(nav),utility:rect(tools),hero:rect(hero),
        sheet:rect(sheet),mode:rect(mode),classification:rect(classification),
        chips,controls,utilityColor:getComputedStyle(tools).backgroundColor,
        utilityOverflow:getComputedStyle(tools).overflowX,
        docOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
    })()`);
    console.log('SSX_R71_HEADER_HIERARCHY',JSON.stringify(headerHierarchy));
    assert.equal(headerHierarchy.navInside,true,'Main destinations belong in the main topbar');
    assert.equal(headerHierarchy.utilitiesInside,true,'Utility actions must live inside the header, not below it');
    assert.equal(headerHierarchy.quickInside,true,'Mobile destinations share the same semantic header');
    assert.ok(headerHierarchy.utility.top>=headerHierarchy.main.bottom-1,
      'The discreet utility row must follow the primary navigation');
    assert.ok(headerHierarchy.hero.top>=headerHierarchy.header.bottom-1,
      'The hero must remain below the entire header');
    assert.ok(headerHierarchy.header.height<=135,'Desktop header must remain visually compact');
    assert.ok(headerHierarchy.chips.every(r=>r.width<180&&r.height<=38),
      'Utility controls must be compact chips rather than full-width blocks');
    assert.ok(headerHierarchy.controls.every(r=>r.height<=40&&r.width<210),
      'Contextual table actions must remain restrained and readable');
    assert.ok(headerHierarchy.docOverflow<=1);
    const headerArtifactDir=path.join(process.cwd(),'artifacts');
    fs.mkdirSync(headerArtifactDir,{recursive:true});
    await evaluate(cdp.send,sid,"window.scrollTo({top:0,behavior:'instant'})");
    await sleep(150);
    const headerShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(headerArtifactDir,'ssx-r71-desktop-header.png'),
      Buffer.from(headerShot.data,'base64'));
    await evaluate(cdp.send,sid,"document.querySelector('.sheet-card').scrollIntoView({block:'start',behavior:'instant'})");
    await sleep(150);
    const scrollVisibility=await evaluate(cdp.send,sid,`(()=>{
      const head=document.querySelector('.sheet-head').getBoundingClientRect();
      const nav=document.querySelector('.topbar').getBoundingClientRect();
      return {headTop:head.top,navBottom:nav.bottom,
        visible:head.top>=nav.bottom+2,
        viewport:innerHeight};
    })()`);
    assert.equal(scrollVisibility.visible,true,
      'Sticky header must not cover contextual record controls after navigation: '+JSON.stringify(scrollVisibility));
    const controlsShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(headerArtifactDir,'ssx-r71-desktop-record-controls.png'),
      Buffer.from(controlsShot.data,'base64'));

    // R70: A full-HD/ultrawide monitor must not retain the previous 1360px
    // centered island. Measure real visible Chromium geometry.
    const wideDir=path.join(process.cwd(),'artifacts');
    fs.mkdirSync(wideDir,{recursive:true});
    for(const width of [1920,2560,3440]){
      await cdp.send('Emulation.setDeviceMetricsOverride',
        {width,height:900,deviceScaleFactor:1,mobile:false},sid);
      await sleep(180);
      const geometry=await evaluate(cdp.send,sid,`(()=>{
        const get=selector=>{const node=document.querySelector(selector);
          const b=node.getBoundingClientRect();
          return{left:b.left,right:b.right,width:b.width,height:b.height,
            scrollWidth:node.scrollWidth,clientWidth:node.clientWidth};};
        const site=get('.app'),hero=get('.hero'),sheet=get('.sheet-card'),
          direct=get('#ssxDirectActions'),archive=get('#ssxSpecialArchive');
        const actions=[...document.querySelectorAll('#ssxDirectActions > :is(button,a)')]
          .filter(n=>getComputedStyle(n).display!=='none')
          .map(n=>n.getBoundingClientRect());
        const buttonCollision=actions.some((a,i)=>actions.slice(i+1).some(b=>
          a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1));
        const archiveInsideCredits=document.querySelector('#ssxCredits').contains(
          document.querySelector('#ssxSpecialArchive'));
        return{viewport:document.documentElement.clientWidth,site,hero,sheet,direct,
          archive,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
          buttons:actions.length,buttonCollision,archiveInsideCredits};
      })()`);
      console.log('SSX_R70_FULL_WIDTH_'+width,JSON.stringify(geometry));
      assert.ok(geometry.site.width>=width*.98,'App must fill the desktop viewport at '+width+'px');
      for(const part of ['hero','sheet','archive']){
        assert.ok(geometry[part].width>=width*.90,
          part+' must not remain a centered fixed-width column at '+width+'px');
        assert.ok(geometry[part].left>=-1&&geometry[part].right<=width+1,
          part+' must fit within '+width+'px viewport');
      }
      assert.ok(geometry.direct.width<900,
        'R71 utilities must remain a compact rail, not a full-width row at '+width+'px');
      assert.ok(geometry.direct.right<=width+1&&geometry.direct.left>=-1,
        'R71 utility rail must remain inside the header at '+width+'px');
      assert.ok(geometry.overflow<=1,'No horizontal overflow at '+width+'px');
      assert.equal(geometry.buttons,7,'Public action buttons must remain available');
      assert.equal(geometry.buttonCollision,false,'Wide action buttons must not overlap');
      assert.equal(geometry.archiveInsideCredits,false);
      if(width!==3440){
        await evaluate(cdp.send,sid,"window.scrollTo({top:0,behavior:'instant'})");
        await sleep(110);
        const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
        fs.writeFileSync(path.join(wideDir,'ssx-r70-full-width-'+width+'.png'),Buffer.from(shot.data,'base64'));
      }
    }
    await cdp.send('Emulation.setDeviceMetricsOverride',
      {width:1440,height:900,deviceScaleFactor:1,mobile:false},sid);
    await sleep(200);

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
    const archivePlacement=await evaluate(cdp.send,sid,"(()=>{const root=document.querySelector('#ssxSpecialArchive');const credits=document.querySelector('#ssxCredits');return {insideClosedCredits:credits.contains(root),parentTag:root.parentElement.tagName,display:getComputedStyle(root).display,accessible:!root.closest('details:not([open])')}})()");
    assert.equal(archivePlacement.insideClosedCredits,false,'Historical records must not be nested in a collapsed credits panel');
    assert.equal(archivePlacement.accessible,true,'Archive must be directly accessible from the public page');
    assert.notEqual(archivePlacement.display,'none');

    assert.equal(specials.snapshot,'2026-08-22','Archived source must show its real snapshot date');
    assert.equal(specials.authority,'google-sheets-archive');
    assert.equal(specials.records,2205,'Every special Sheets record, including 137 Survive special rows, must be present');
    assert.deepEqual(specials.tabs.map(t=>t.key),['level','android','dev','boost','challenge']);
    assert.deepEqual(specials.tabs.map(t=>t.text),
      ['Níveis baixos','Android','DEV / Testes','Sem boost','Survive sem Gear/Wings/Rewinds'],
      'Photo banner labels must NOT expose archived row counts as if they were track counts');
    assert.ok(specials.tabs.every(t=>!/[·–-]\\s*\\d+\\s*$/.test(t.text)),
      'No special category banner should end with a numeric badge');
    await evaluate(cdp.send,sid,"document.querySelector('#ssxSpecialArchive').scrollIntoView({block:'start',behavior:'instant'})");
    await sleep(150);
    const cleanArchiveDir=path.join(process.cwd(),'artifacts');
    fs.mkdirSync(cleanArchiveDir,{recursive:true});
    const cleanArchiveShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(cleanArchiveDir,'ssx-r77-archive-no-count-banners.png'),
      Buffer.from(cleanArchiveShot.data,'base64'));
    const archiveSelectionMotion=await evaluate(cdp.send,sid,`(()=>{
      const tab=document.querySelector('#ssxSpecialTabs [data-ssx-special-group=dev]');
      tab.click();
      const results=document.querySelector('#ssxSpecialResults');
      const selected=[...document.querySelectorAll('#ssxSpecialTabs .ssx-special-tab')].find(x=>x.getAttribute('aria-pressed')==='true');
      const state={selected:selected?.textContent?.trim(),
        animating:results.getAnimations().length,
        realDevScore:results.querySelector('.ssx-special-score')?.textContent};
      document.querySelector('#ssxSpecialTabs [data-ssx-special-group=level]').click();
      return state;
    })()`);
    console.log('SSX_R77_ARCHIVE_LABELS',JSON.stringify({tabs:specials.tabs,motion:archiveSelectionMotion}));
    assert.equal(archiveSelectionMotion.selected,'DEV / Testes');
    assert.ok(archiveSelectionMotion.animating>0,
      'Switching a historic photo category must have a real animated content reveal');

    assert.match(specials.link,/categorias extras/i);
    assert.equal(specials.mainCount,13,'Main 73-track navigator must remain intact');
    assert.equal(specials.mainScore,'01:35.99');
    assert.equal(specials.progress,true);
    const explore=await evaluate(cdp.send,sid,"(()=>{const tab=name=>document.querySelector('#ssxSpecialTabs [data-ssx-special-group=\"'+name+'\"]');const level=document.querySelector('#ssxSpecialLevel'),mode=document.querySelector('#ssxSpecialMode'),track=document.querySelector('#ssxSpecialTrack'),rows=document.querySelector('#ssxSpecialResults');const pick=(selector,value)=>{selector.value=String(value);selector.dispatchEvent(new Event('change',{bubbles:true}));};const info=()=>({count:Number(rows.dataset.visibleRecords),score:rows.querySelector('.ssx-special-score')?.textContent,raw:rows.querySelector('.ssx-special-score')?.dataset.ssxOriginalScore,formatStatus:rows.querySelector('.ssx-special-score')?.dataset.ssxScoreStatus,mode:Number(rows.querySelector('.ssx-special-record')?.dataset.archivedMode),rank:rows.querySelector('.ssx-special-record')?.dataset.archivedPosition,proof:rows.querySelector('a.ssx-youtube-proof')?.href,hasMark:!!rows.querySelector('.ssx-youtube-icon'),source:rows.querySelector('.ssx-special-ref')?.textContent});pick(level,'Level 9');pick(mode,'0');pick(track,'2');const nine=info();tab('android').click();const androidModes=[...mode.options].map(o=>Number(o.value));pick(mode,'2');pick(track,'16');const android=info();tab('dev').click();pick(track,'79');const dev=info();tab('boost').click();pick(track,'2');const boost=info();tab('challenge').click();const challengeModes=[...mode.options].map(o=>Number(o.value));pick(track,'8');const special=info();return{nine,androidModes,android,dev,boost,challengeModes,special,mainScore:document.querySelector('.ssx-region-detail .ssx-region-score')?.textContent,mainMode:document.body.dataset.ssxMode,archiveNote:document.querySelector('#ssxSpecialNote')?.textContent}})()");
    console.log('SSX_SPECIAL_CATEGORY_SAMPLES',JSON.stringify(explore));
    assert.equal(explore.nine.score,'01:26.45','Level 9 Board times must match the source spreadsheet snapshot');
    assert.deepEqual(explore.androidModes,[0,1,2,3]);
    assert.equal(explore.android.score,'44,604,320','Android Trick should be displayed with grouped thousands');
    assert.equal(explore.android.raw,'4.460432E7','Original exponent score must stay accessible');
    assert.equal(explore.android.mode,2);
    assert.equal(explore.dev.score,'00:34.79','Developer/test track must be read from its original ID');
    assert.equal(explore.boost.score,'01:42.83','Race time should display canonical MM:SS.ss');
    assert.equal(explore.boost.raw,'1:42.83','Original Race time must remain available');
    assert.match(explore.boost.proof,/youtu\.be/,'Real archived YouTube link must survive');
    assert.equal(explore.boost.hasMark,true);
    assert.deepEqual(explore.challengeModes,[5],'Archived Survive combined no Gear/Wings/Rewinds rule is a separate mode');
    assert.equal(explore.special.score,'10,787.35 m','Survive displays separators and explicit distance unit');
    assert.equal(explore.special.raw,'10,787,35m','Original Survive score must remain available');
    assert.equal(explore.special.formatStatus,'review-inferred-separators',
      'Legacy mixed separators are an interpretation pending review, not a certified correction');
    assert.match(explore.archiveNote,/2026-08-22/);
    assert.equal(explore.mainMode,'board');
    assert.equal(explore.mainScore,'01:35.99','Opening archived categories cannot change public current rankings');
    const scoreDisclosure=await evaluate(cdp.send,sid,`(()=>{
      const detail=document.querySelector('.ssx-region-group .ssx-region-detail');
      const note=detail.querySelector('.ssx-identity-verification-note');
      const main=detail.querySelector('.ssx-region-score');
      return {note:note?.textContent?.trim(),mainScore:main?.textContent?.trim(),
        mainOriginal:main?.dataset.ssxOriginalScore,
        formatter:typeof window.SSXScoreIntegrity?.format,
        rawSurvivePresent:!!document.querySelector('#ssxSpecialArchive')};
    })()`);
    console.log('SSX_R78_DISPLAY_INTEGRITY',JSON.stringify(scoreDisclosure));
    assert.match(scoreDisclosure.note,/identidades pendentes de verificação por ID/i);
    assert.equal(scoreDisclosure.formatter,'function');
    assert.equal(scoreDisclosure.mainScore,'01:35.99');
    assert.equal(scoreDisclosure.mainOriginal,'01:35.99');
    // Capture the exact UI result of the forensic formatter, not a mockup.
    const forensicShotDir=path.join(process.cwd(),'artifacts');
    fs.mkdirSync(forensicShotDir,{recursive:true});
    await evaluate(cdp.send,sid,
      "document.querySelector('#ssxSpecialResults .ssx-special-record').scrollIntoView({block:'center',behavior:'instant'})");
    await sleep(125);
    const surviveVisual=await evaluate(cdp.send,sid,`(()=>{
      const score=document.querySelector('#ssxSpecialResults .ssx-special-score');
      const card=score?.closest('.ssx-special-record');
      const style=getComputedStyle(score);
      return {whiteSpace:style.whiteSpace,
        scoreHeight:score?.getBoundingClientRect().height,
        lineHeight:parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.3,
        cardOverflow:(card?.scrollWidth||0)-(card?.clientWidth||0)};
    })()`);
    console.log('SSX_R78_SURVIVE_LAYOUT',JSON.stringify(surviveVisual));
    assert.equal(surviveVisual.whiteSpace,'nowrap','Survive distances must keep numeric value and unit together');
    assert.ok(surviveVisual.cardOverflow<=1,'Long formatted distance must not overflow a record card');
    const surviveProof=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(forensicShotDir,'ssx-r78-survive-original-vs-display.png'),
      Buffer.from(surviveProof.data,'base64'));
    await evaluate(cdp.send,sid,`(()=>{
      const tab=document.querySelector('#ssxSpecialTabs [data-ssx-special-group=android]');
      tab.click();
      const mode=document.querySelector('#ssxSpecialMode');
      mode.value='2';mode.dispatchEvent(new Event('change',{bubbles:true}));
      const track=document.querySelector('#ssxSpecialTrack');
      track.value='16';track.dispatchEvent(new Event('change',{bubbles:true}));
      document.querySelector('#ssxSpecialResults .ssx-special-record').scrollIntoView({
        block:'center',behavior:'instant'
      });
    })()`);
    await sleep(125);
    const trickProof=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(forensicShotDir,'ssx-r78-trick-commas-original-preserved.png'),
      Buffer.from(trickProof.data,'base64'));
    const screenshotScores=await evaluate(cdp.send,sid,`(()=>{
      const node=document.querySelector('#ssxSpecialResults .ssx-special-score');
      return {score:node?.textContent,raw:node?.dataset.ssxOriginalScore};
    })()`);
    assert.deepEqual(screenshotScores,{score:'44,604,320',raw:'4.460432E7'});



    // R66: every historical category reuses only the flag asset already
    // attributed to that exact rider in the frozen original v36 catalogue.
    const archiveFlags=await evaluate(cdp.send,sid,String.raw`(()=>{
      const samples=[];
      for(const group of ['level','android','dev','boost','challenge']){
        document.querySelector('#ssxSpecialTabs [data-ssx-special-group="'+group+'"]').click();
        const card=document.querySelector('#ssxSpecialResults .ssx-special-record');
        const rider=card?.querySelector('.ssx-special-rider-name')?.textContent.trim()||'';
        const expectedAsset=RIDER_FLAGS[riderKey(rider)];
        const expected=expectedAsset?FLAG_CODES[expectedAsset]||null:null;
        const image=card?.querySelector('img.ssx-special-rider-flag');
        samples.push({group,rider,expected,actual:image?.alt||null,source:image?.getAttribute('src')||null});
      }
      document.querySelector('#ssxSpecialViews [data-ssx-special-view="leaders"]').click();
      const leader=[...document.querySelectorAll('#ssxSpecialResults .ssx-special-leader')]
        .map(card=>{const name=card.querySelector('.ssx-special-leader-rider .ssx-special-rider-name')?.textContent.trim()||'';
          const asset=RIDER_FLAGS[riderKey(name)],image=card.querySelector('.ssx-special-leader-rider img.ssx-special-rider-flag');
          return{name,expected:asset?FLAG_CODES[asset]||null:null,actual:image?.alt||null,source:image?.getAttribute('src')||null};});
      const podium=[...document.querySelectorAll('#ssxSpecialPodium .ssx-special-medal-card')]
        .map(card=>{const name=card.dataset.ssxName,asset=RIDER_FLAGS[riderKey(name)];
          const image=card.querySelector('.ssx-special-medal-rider img.ssx-special-rider-flag');
          return{name,expected:asset?FLAG_CODES[asset]||null:null,actual:image?.alt||null,source:image?.getAttribute('src')||null};});
      document.querySelector('#ssxSpecialViews [data-ssx-special-view="records"]').click();
      return{samples,leader,podium,mainScore:document.querySelector('.ssx-region-detail .ssx-region-score')?.textContent};
    })()`);
    console.log('SSX_ARCHIVE_FLAG_PROVENANCE',JSON.stringify(archiveFlags));
    assert.deepEqual(archiveFlags.samples.map(x=>x.group),['level','android','dev','boost','challenge']);
    const flagItems=[...archiveFlags.samples,...archiveFlags.leader,...archiveFlags.podium];
    assert.ok(archiveFlags.samples.filter(x=>x.expected).length>=3,'Flags should be present in several archived category modes');
    assert.ok(archiveFlags.leader.length>0&&archiveFlags.podium.length>0,'Archive leader and podium flags need live UI coverage');
    for(const item of flagItems){
      assert.equal(item.actual,item.expected,'Archived flag must match original v36 source: '+item.name+' / '+item.group);
      if(item.expected)assert.match(item.source,/^blob:/,'Flags must reuse the original locally cached image, not remote calls');
      else assert.equal(item.source,null,'Unknown country must not acquire an invented flag');
    }
    assert.equal(archiveFlags.mainScore,'01:35.99','Restoring flags must not mutate main rankings');


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
    // R72: structural proof of a single-column regional navigator and Top 16
    // inside the selected region, not a second sticky/right-hand panel.
    const galleryGeometry=await evaluate(cdp.send,sid,"(()=>{const browser=document.querySelector('#ssxRegionBrowser'),index=browser.querySelector('.ssx-region-index'),africa=[...index.querySelectorAll('.ssx-region-group')].find(g=>g.dataset.regionName==='Africa'),dev=index.querySelector('.ssx-dev-group'),detail=browser.querySelector('.ssx-region-detail');return {topbarPosition:getComputedStyle(document.querySelector('.topbar')).position,rootColumns:getComputedStyle(browser).gridTemplateColumns.split(' ').length,regionColumns:getComputedStyle(index).gridTemplateColumns.split(' ').length,banners:index.querySelectorAll('.ssx-region-group').length,dev:!!dev,devTracks:dev?.querySelectorAll('.ssx-dev-track-choice').length,devRows:[...dev?.querySelectorAll('.ssx-dev-track-choice small')||[]].map(el=>Number.parseInt(el.textContent,10)||0).reduce((a,b)=>a+b,0),inline:africa.contains(detail),siblingDetail:!!browser.querySelector(':scope > .ssx-region-detail'),galleryWidth:index.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};})()");
    console.log('SSX_R72_GALLERY_DESKTOP',JSON.stringify(galleryGeometry));
    assert.notEqual(galleryGeometry.topbarPosition,'sticky','The header must never overlay content as a sticky layer');
    assert.notEqual(galleryGeometry.topbarPosition,'fixed','The header must scroll away normally');
    assert.equal(galleryGeometry.rootColumns,1,'Regional browser must be full-width, not two columns');
    assert.ok(galleryGeometry.regionColumns>=4,'Wide desktop should show at least four banners per gallery row');
    assert.equal(galleryGeometry.banners,12,'All real main-game regions must remain');
    assert.equal(galleryGeometry.dev,true,'Curated DEV should appear in the same gallery');
    assert.equal(galleryGeometry.devTracks,8);
    const devBannerLabel=await evaluate(cdp.send,sid,
      "document.querySelector('.ssx-dev-group > .ssx-region-banner')?.textContent.trim()");
    assert.doesNotMatch(devBannerLabel,/\\b10\\s+registros\\b/,
      'DEV gallery banner must not display a historical count as a title badge');

    assert.equal(galleryGeometry.devRows,10);
    assert.equal(galleryGeometry.inline,true,'Real Top 16 must be a descendant of the chosen region');
    assert.equal(galleryGeometry.siblingDetail,false,'Remove the independent right-hand ranking pane');
    assert.ok(galleryGeometry.overflow<=1);
    // R77: the banner disclosure must animate in BOTH directions, rather
    // than relying on hover transforms or animating only the entry scorecard.
    const motionMeta=await evaluate(cdp.send,sid,`(()=>{
      const alaska=document.querySelector('.ssx-region-group[data-region-name=Alaska]');
      const css=getComputedStyle(alaska,'::details-content');
      return {supports:CSS.supports('selector(details::details-content)'),
        acceptsAuto:CSS.supports('interpolate-size','allow-keywords'),
        transitions:css.transitionProperty,duration:css.transitionDuration,
        reduced:matchMedia('(prefers-reduced-motion: reduce)').matches};
    })()`);
    console.log('SSX_R77_DISCLOSURE_SUPPORT',JSON.stringify(motionMeta));
    if(motionMeta.supports&&motionMeta.acceptsAuto&&!motionMeta.reduced){
      assert.match(motionMeta.transitions,/block-size/,
        'Native details content must transition height on open AND close');
      assert.match(motionMeta.transitions,/opacity/,
        'Details content should fade as its height expands');
      const animationState=await evaluate(cdp.send,sid,`(()=>{
        const group=document.querySelector('.ssx-region-group[data-region-name=Alaska]');
        group.scrollIntoView({block:'center',behavior:'instant'});
        if(group.open)group.querySelector('summary').click();
        group.querySelector('summary').click();
        return {opened:group.open,active:group.getAnimations({subtree:true}).map(a=>a.constructor.name),
          content:parseFloat(getComputedStyle(group,'::details-content').blockSize)};
      })()`);
      await sleep(100);
      const openingMid=await evaluate(cdp.send,sid,`(()=>{
        const group=document.querySelector('.ssx-region-group[data-region-name=Alaska]');
        return {open:group.open,height:parseFloat(getComputedStyle(group,'::details-content').blockSize),
          opacity:Number(getComputedStyle(group,'::details-content').opacity)};
      })()`);
      await sleep(450);
      const openEnd=await evaluate(cdp.send,sid,`(()=>{
        const group=document.querySelector('.ssx-region-group[data-region-name=Alaska]');
        const height=parseFloat(getComputedStyle(group,'::details-content').blockSize);
        const wasOpen=group.open;
        group.querySelector('summary').click();
        return {wasOpen,open:group.open,height};
      })()`);
      await sleep(100);
      const closingMid=await evaluate(cdp.send,sid,`(()=>{
        const group=document.querySelector('.ssx-region-group[data-region-name=Alaska]');
        return {open:group.open,height:parseFloat(getComputedStyle(group,'::details-content').blockSize)};
      })()`);
      await sleep(450);
      const closedEnd=await evaluate(cdp.send,sid,`(()=>{
        const group=document.querySelector('.ssx-region-group[data-region-name=Alaska]');
        return {open:group.open,height:parseFloat(getComputedStyle(group,'::details-content').blockSize)};
      })()`);
      console.log('SSX_R77_BIDIRECTIONAL_MOTION',JSON.stringify({animationState,openingMid,openEnd,closingMid,closedEnd}));
      assert.equal(animationState.opened,true);
      assert.equal(openEnd.wasOpen,true,'Region must stay open through its expansion animation');
      assert.equal(openEnd.open,false,'Clicking the banner should begin closing it');
      assert.equal(closedEnd.open,false);
      assert.ok(openEnd.height>40,'Expanded banner must reveal content');
      assert.ok(openingMid.height<openEnd.height,
        'The expansion should pass through an intermediate height');
      assert.ok(closingMid.height>closedEnd.height,
        'The collapse should pass through an intermediate height');
    }

    // R73: a new track selection must update only its local ranking, rather
    // than destroying and rebuilding every regional banner and all mountains.
    const switchedInPlace=await evaluate(cdp.send,sid,`(()=>{
      const root=document.querySelector('#ssxRegionBrowser');
      const africa=root.querySelector('.ssx-region-group[data-region-name="Africa"]');
      const africaId=africa;
      const countBefore=root.querySelectorAll('.ssx-region-group').length;
      const other=[...africa.querySelectorAll('.ssx-track-choice')]
        .find(button=>button.textContent.includes('Corkscrew'));
      other.click();
      const after=root.querySelector('.ssx-region-group[data-region-name="Africa"]');
      const detail=after.querySelector('.ssx-region-detail');
      const changed={sameRoot:after===africaId,title:detail?.querySelector('h3')?.textContent,
        count:root.querySelectorAll('.ssx-region-group').length,
        rankCount:detail?.querySelectorAll('.ssx-region-rank').length,
        updateMs:Number(document.body.dataset.ssxLastTrackRenderMs||NaN),
        unrelatedBannersRetained:countBefore===root.querySelectorAll('.ssx-region-group').length};
      const original=[...after.querySelectorAll('.ssx-track-choice')]
        .find(button=>button.textContent.includes('Red Light'));
      original.click();
      changed.restored=after.querySelector('.ssx-region-detail h3')?.textContent;
      return changed;
    })()`);
    console.log('SSX_R73_INCREMENTAL_TRACK',JSON.stringify(switchedInPlace));
    assert.equal(switchedInPlace.sameRoot,true,'Track changes must retain the mounted region banners');
    assert.equal(switchedInPlace.unrelatedBannersRetained,true);
    assert.equal(switchedInPlace.title,'Corkscrew');
    assert.equal(switchedInPlace.restored,'Red Light');
    assert.equal(switchedInPlace.rankCount,16);
    const trackModeRow=await evaluate(cdp.send,sid,`(()=>{
      const rail=document.querySelector('#ssxSheetModeFilter');
      const detail=document.querySelector('.ssx-region-group[data-region-name="Africa"] .ssx-region-detail');
      const share=detail.querySelector('.ssx-track-share-button');
      return {sameRow:rail.parentElement===share.parentElement,
        controls:document.querySelectorAll('#ssxSheetModeFilter').length,
        title:detail.querySelector('h3')?.textContent};
    })()`);
    assert.equal(trackModeRow.sameRow,true,'Incremental track swaps must keep modes beside Share');
    assert.equal(trackModeRow.controls,1,'Never duplicate the canonical five-mode rail');
    assert.equal(trackModeRow.title,'Red Light');
    // R76: changing ranking mode must not replace any region, mountain, DEV
    // or search node; only per-track scorecounts and the selected Top 16 change.
    const galleryBaseline=await evaluate(cdp.send,sid,`(()=>{
      const root=document.querySelector('#ssxRegionBrowser');
      const africa=root.querySelector('.ssx-region-group[data-region-name="Africa"]');
      return{builds:Number(root.dataset.ssxGalleryBuilds||0),
        reuses:Number(root.dataset.ssxGalleryReuses||0),
        africa:africa?.dataset.regionName,regions:root.querySelectorAll('.ssx-region-group').length,
        search:document.querySelector('#ssxRegionSearch')?.value};
    })()`);
    await evaluate(cdp.send,sid,"document.querySelector('#ssxSheetModeFilter [data-ssx-sheet-mode=wings]').click()");
    await sleep(190);
    const wingsReuse=await evaluate(cdp.send,sid,`(()=>{
      const root=document.querySelector('#ssxRegionBrowser');
      return{mode:document.body.dataset.ssxMode,
        builds:Number(root.dataset.ssxGalleryBuilds||0),
        reuses:Number(root.dataset.ssxGalleryReuses||0),
        reuseMs:Number(root.dataset.ssxGalleryReuseMs||NaN),
        score:root.querySelector('.ssx-region-detail .ssx-region-score')?.textContent,
        mountedRegions:root.querySelectorAll('.ssx-region-group').length,
        sameSearch:document.querySelector('#ssxRegionSearch')?.value==='',
        nextShare:root.querySelector('.ssx-region-detail .ssx-track-share-button')?.textContent.includes('Compartilhar')};
    })()`);
    console.log('SSX_R76_MODE_REUSE',JSON.stringify({baseline:galleryBaseline,after:wingsReuse}));
    assert.equal(wingsReuse.mode,'wings');
    assert.equal(wingsReuse.score,'01:11.92','Reusing gallery must still hydrate genuine Wingsuit leaderboard');
    assert.equal(wingsReuse.builds,galleryBaseline.builds,'Mode switch must retain the complete gallery DOM');
    assert.ok(wingsReuse.reuses>galleryBaseline.reuses,'Mode switch must use partial scoreboard refresh');
    assert.equal(wingsReuse.mountedRegions,12);
    assert.equal(wingsReuse.sameSearch,true);
    assert.equal(wingsReuse.nextShare,true);
    assert.ok(Number.isFinite(wingsReuse.reuseMs)&&wingsReuse.reuseMs<350);
    await evaluate(cdp.send,sid,"document.querySelector('#ssxSheetModeFilter [data-ssx-sheet-mode=board]').click()");
    await sleep(190);
    const restoredBoard=await evaluate(cdp.send,sid,"({score:document.querySelector('.ssx-region-detail .ssx-region-score')?.textContent,builds:Number(document.querySelector('#ssxRegionBrowser').dataset.ssxGalleryBuilds||0)})");
    assert.equal(restoredBoard.score,'01:35.99');
    assert.equal(restoredBoard.builds,galleryBaseline.builds,'Returning to Board should not rebuild all 12 banners');


    assert.ok(Number.isFinite(switchedInPlace.updateMs)&&switchedInPlace.updateMs<350,
      'Track-only interaction must stay responsive without a full directory rebuild');
    const disciplineBar=await evaluate(cdp.send,sid,`(()=>{
      const bar=document.querySelector('#ssxSheetModeFilter'),buttons=[...bar.querySelectorAll('button:not([hidden])')];
      const r=bar.getBoundingClientRect();
      return {present:!bar.hidden,visible:getComputedStyle(bar).display!=='none',
        inShare:bar.parentElement?.classList.contains('ssx-track-share-controls'),
        shareTop:document.querySelector('.ssx-region-detail .ssx-track-share-button')?.getBoundingClientRect().top,
        modes:buttons.map(b=>b.dataset.ssxSheetMode),
        top:r.top,bottom:r.bottom,rankTop:document.querySelector('.ssx-region-detail .ssx-region-ranking').getBoundingClientRect().top,
        widths:buttons.map(b=>Math.round(b.getBoundingClientRect().width)),
        animated:getComputedStyle(document.querySelector('.ssx-region-group .ssx-track-choice')).transitionDuration,
        design:document.body.classList.contains('ssx-alpine-v38'),
        designStyle:!!document.querySelector('#ssx-v38-design')};
    })()`);
    console.log('SSX_R73_DESIGN_SYSTEM',JSON.stringify(disciplineBar));
    assert.equal(disciplineBar.design,true);
    assert.equal(disciplineBar.designStyle,true);
    assert.equal(disciplineBar.inShare,true,'Modes must share the exact action row as Compartilhar pista');
    assert.ok(Math.abs(disciplineBar.top-disciplineBar.shareTop)<=2,'Share and filters must align on the same desktop row');
    assert.equal(disciplineBar.visible,true);
    assert.equal(disciplineBar.present,true);
    assert.ok(disciplineBar.bottom<=disciplineBar.rankTop,'Modes must appear beside Share before the Top 16');
    assert.deepEqual(disciplineBar.modes,['board','wings','trick','survive','special']);
    assert.ok(disciplineBar.widths.every(w=>w>=80),'All five controls must be usable on desktop');
    assert.notEqual(disciplineBar.animated,'0s','Track interactions need restrained transitions');
    await evaluate(cdp.send,sid,"document.querySelector('.ssx-region-detail .ssx-track-share-controls').scrollIntoView({block:'center',behavior:'instant'})");
    await sleep(120);
    const modeShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    const v38Dir=path.join(process.cwd(),'artifacts');
    fs.mkdirSync(v38Dir,{recursive:true});
    fs.writeFileSync(path.join(v38Dir,'ssx-r73-desktop-five-modes.png'),Buffer.from(modeShot.data,'base64'));

    const r72Dir=path.join(process.cwd(),'artifacts');
    fs.mkdirSync(r72Dir,{recursive:true});
    await evaluate(cdp.send,sid,"document.querySelector('#ssxRegionBrowser').scrollIntoView({block:'start',behavior:'instant'})");
    await sleep(170);
    const galleryShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(r72Dir,'ssx-r72-desktop-region-gallery.png'),Buffer.from(galleryShot.data,'base64'));
    const expandedRegion=await evaluate(cdp.send,sid,"(()=>{const africa=[...document.querySelectorAll('.ssx-region-group')].find(g=>g.dataset.regionName==='Africa');if(!africa.open)africa.querySelector('summary').click();const top=africa.querySelector('summary').getBoundingClientRect(),list=africa.querySelector('.ssx-mountain-list').getBoundingClientRect(),detail=africa.querySelector('.ssx-region-detail').getBoundingClientRect();return{expanded:africa.open,tracks:africa.querySelectorAll('.ssx-track-choice').length,rankCount:africa.querySelectorAll('.ssx-region-rank').length,belowBanner:list.top>=top.bottom-1,inlineBelowTracks:detail.top>=list.bottom-1,rankCols:getComputedStyle(africa.querySelector('.ssx-region-ranking')).gridTemplateColumns.split(' ').length,detailWidth:detail.width,viewport:document.documentElement.clientWidth};})()");
    console.log('SSX_R72_INLINE_TOP16',JSON.stringify(expandedRegion));
    assert.equal(expandedRegion.expanded,true);
    assert.equal(expandedRegion.tracks,5,'The Africa banner exposes five curated main-game tracks');
    assert.equal(expandedRegion.rankCount,16,'Red Light displays all 16 recorded positions');
    assert.equal(expandedRegion.belowBanner,true);
    assert.equal(expandedRegion.inlineBelowTracks,true,'Top 16 must follow the track cards, never the right column');
    assert.ok(expandedRegion.rankCols>=2&&expandedRegion.detailWidth<=expandedRegion.viewport);
    await evaluate(cdp.send,sid,"document.querySelector('.ssx-region-group[data-region-name=Africa] .ssx-region-detail').scrollIntoView({block:'start',behavior:'instant'})");
    await sleep(150);
    const inlineShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(r72Dir,'ssx-r72-desktop-inline-top16.png'),Buffer.from(inlineShot.data,'base64'));
    const devDetail=await evaluate(cdp.send,sid,"(()=>{const dev=document.querySelector('.ssx-dev-group');if(!dev.open)dev.querySelector('summary').click();const track=[...dev.querySelectorAll('.ssx-dev-track-choice')].find(n=>n.textContent.includes('TEST RAIL'));track.click();const group=document.querySelector('.ssx-dev-group'),detail=group.querySelector('.ssx-dev-detail');const selected=detail.querySelector('h3')?.textContent;const score=detail.querySelector('.ssx-region-score')?.textContent;const provenance=detail.querySelector('.ssx-region-source')?.textContent;const count=detail.querySelectorAll('.ssx-dev-rank').length;return{selected,score,provenance,count,inline:group.contains(detail),officialCount:document.querySelector('#ssxSheetRegions [data-ssx-region=all] .ssx-sheet-region-count')?.textContent,officialScore:document.querySelector('.ssx-region-group .ssx-region-score')?.textContent};})()");
    console.log('SSX_R72_DEV_INLINE',JSON.stringify(devDetail));
    assert.equal(devDetail.selected,'TEST RAIL');
    assert.equal(devDetail.score,'00:34.79');
    assert.match(devDetail.provenance,/D2/);
    assert.equal(devDetail.count,1,'Do not fabricate the other 15 DEV positions');
    assert.equal(devDetail.inline,true);
    assert.equal(devDetail.officialCount,'73');
    assert.equal(devDetail.officialScore,'01:35.99','DEV curation must not replace official Red Light scores');
    await evaluate(cdp.send,sid,"document.querySelector('.ssx-dev-detail').scrollIntoView({block:'start',behavior:'instant'})");
    await sleep(150);
    const devShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(r72Dir,'ssx-r72-desktop-dev-records.png'),Buffer.from(devShot.data,'base64'));
    await evaluate(cdp.send,sid,"document.querySelector('.ssx-dev-group > summary').click()");
    await evaluate(cdp.send,sid,"document.querySelector('#ssxSpecialTabs').scrollIntoView({block:'start',behavior:'instant'})");
    await sleep(160);
    const specialBannersShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(r72Dir,'ssx-r72-historical-banner-categories.png'),Buffer.from(specialBannersShot.data,'base64'));
    const historicalBanners=await evaluate(cdp.send,sid,"(()=>{const nav=document.querySelector('#ssxSpecialTabs'),tabs=[...nav.querySelectorAll('.ssx-special-tab')],first=tabs[0].getBoundingClientRect();return {count:tabs.length,columns:getComputedStyle(nav).gridTemplateColumns.split(' ').length,heights:tabs.map(el=>Math.round(el.getBoundingClientRect().height)),firstWidth:first.width,art:tabs.map(el=>getComputedStyle(el).backgroundImage.includes('/hobbies/ssx/media/v37/')),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};})()");
    assert.equal(historicalBanners.count,5);
    assert.ok(historicalBanners.columns>=3&&historicalBanners.heights.every(v=>v>=90));
    assert.ok(historicalBanners.art.every(Boolean),'All historical category cards need pinned game artwork');
    assert.ok(historicalBanners.overflow<=1);
    // A scrolled public header must be gone: no dark translucent overlay.
    const overlay=await evaluate(cdp.send,sid,"(()=>{window.scrollTo({top:Math.min(document.documentElement.scrollHeight-900,2200),behavior:'instant'});const r=document.querySelector('.topbar').getBoundingClientRect();return{top:r.top,bottom:r.bottom,style:getComputedStyle(document.querySelector('.topbar')).position};})()");
    assert.ok(overlay.bottom<0&&overlay.style!=='fixed'&&overlay.style!=='sticky','Header overlay must scroll completely away');

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

    const regionRoundTrip=await evaluate(cdp.send,sid,"(()=>{const rail=document.querySelector('#ssxSheetRegions');const results=[];for(const name of ['Alaska','Japan','Training','Africa','all']){rail.querySelector('[data-ssx-region=\"'+name+'\"]').click();const root=document.querySelector('#ssxRegionBrowser');results.push({requested:name,active:rail.querySelector('[aria-pressed=true]')?.dataset.ssxRegion,regions:root.querySelectorAll('.ssx-region-group').length,group:root.querySelector('.ssx-region-group')?.dataset.regionName,tracks:root.querySelectorAll('.ssx-region-group .ssx-track-choice').length,canonical:Number(rail.querySelector('[data-ssx-region=all] .ssx-sheet-region-count')?.textContent),progress:document.querySelector('#renderProgress')?.hidden});}return results;})()");
    assert.deepEqual(regionRoundTrip.map(row=>row.active),['Alaska','Japan','Training','Africa','all'],'Every region tab must stay selected after native sheet redraw');
    assert.deepEqual(regionRoundTrip.map(row=>row.regions),[1,1,1,1,12],'Each region must retain its complete track directory');
    assert.deepEqual(regionRoundTrip.map(row=>row.tracks),[7,3,1,5,73],'All official SSX track counts must survive repeated region switching');
    assert.ok(regionRoundTrip.every(row=>row.canonical===73&&row.progress),'Region changes must not restart the loading sentinel');
    const r72DevInventory=await evaluate(cdp.send,sid,`(()=>{
      const group=document.querySelector('#ssxRegionBrowser .ssx-dev-group');
      const tracks=[...group?.querySelectorAll('.ssx-dev-track-choice')||[]];
      return{present:!!group,count:tracks.length,labels:tracks.map(b=>b.querySelector('strong')?.textContent),
        counts:tracks.map(b=>Number(b.dataset.ssxDevCount||0)),
        archive:group?.dataset.ssxProvenance,mainCount:document.querySelector('#ssxSheetRegions [data-ssx-region=all] .ssx-sheet-region-count')?.textContent};
    })()`);
    console.log('SSX_R72_DEV_DATA_CURATION',JSON.stringify(r72DevInventory));
    assert.equal(r72DevInventory.present,true,'DEV has its own curated banner');
    assert.equal(r72DevInventory.count,8,'Ten archived DEV scores belong to exactly eight recorded tracks');
    assert.equal(r72DevInventory.counts.reduce((a,b)=>a+b,0),10);
    assert.equal(r72DevInventory.archive,'google-sheets-2026-08-22');
    assert.equal(r72DevInventory.mainCount,'73','Historical DEV rows cannot inflate the official catalogue');
    assert.ok(r72DevInventory.labels.includes('TEST RAIL')&&r72DevInventory.labels.includes('Happiness'));
    const provenanceTotals=await evaluate(cdp.send,sid,
      "document.querySelector('#ssxRegionMatches')?.textContent.trim()");
    assert.match(provenanceTotals,/73 pistas/,'The official count must stay 73, not 81');
    assert.match(provenanceTotals,/8 DEV/,'Archived DEV entries must be itemized separately');

    // Open Africa through its actual banner, not by untrusted test CSS.
    await evaluate(cdp.send,sid,`(()=>{
      const africa=[...document.querySelectorAll('.ssx-region-group')]
        .find(g=>g.dataset.regionName==='Africa');
      if(!africa.open)africa.querySelector('summary').click();
    })()`);
    const sourceTabs=await evaluate(cdp.send,sid,"[...document.querySelectorAll('[data-source]')].map(x=>x.dataset.source)");
    assert.ok(sourceTabs.includes('combined')&&sourceTabs.includes('oz'),'Original source filters must remain wired');
    const sourceBuildsBefore=await evaluate(cdp.send,sid,"Number(document.querySelector('#ssxRegionBrowser').dataset.ssxGalleryBuilds||0)");
    await evaluate(cdp.send,sid,"document.querySelector('[data-source=oz]').click()");
    await sleep(180);
    const ozRace=await evaluate(cdp.send,sid,"(()=>({source:document.querySelector('[data-source=oz]').classList.contains('active'),ranks:document.querySelectorAll('.ssx-region-group .ssx-region-detail .ssx-region-rank').length,canonical:document.querySelectorAll('#ssxSheetRegions [data-ssx-region]').length,progress:document.querySelector('#renderProgress')?.hidden}))()");
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
    const sourceBuildsAfter=await evaluate(cdp.send,sid,"Number(document.querySelector('#ssxRegionBrowser').dataset.ssxGalleryBuilds||0)");
    assert.equal(sourceBuildsAfter,sourceBuildsBefore,
      'Source changes must preserve the photographic directory, updating only the ranks');


    // R75: multiple rapid inputs must yield at most one per-frame gallery
    // search, with the original Escape clear remaining immediate and focused.
    const searchBefore=await evaluate(cdp.send,sid,`(()=>{
      const input=document.querySelector('#ssxRegionSearch');
      const browser=document.querySelector('#ssxRegionBrowser');
      const first=Number(browser.dataset.ssxSearchPasses||0);
      const gallery=Number(browser.dataset.ssxGalleryBuilds||0);
      for(const word of ['c','cor','cork','corkscrew']){
        input.value=word;
        input.dispatchEvent(new Event('input',{bubbles:true}));
      }
      input.focus();
      return {first,gallery,focused:document.activeElement===input};
    })()`);
    await sleep(100);
    const discovery=await evaluate(cdp.send,sid,`(()=>{
      const input=document.querySelector('#ssxRegionSearch');
      const browser=document.querySelector('#ssxRegionBrowser');
      const global=document.querySelector('#search');
      const visible=[...browser.querySelectorAll('.ssx-track-choice')].filter(b=>!b.hidden);
      const passes=Number(browser.dataset.ssxSearchPasses||0)-${searchBefore.first};
      const rebuilds=Number(browser.dataset.ssxGalleryBuilds||0)-${searchBefore.gallery};
      const found={visible:visible.length,match:visible[0]?.textContent,
        hasClear:!document.querySelector('#ssxRegionSearchClear').hidden,
        inputFocus:document.activeElement===input,globalQuery:global.value,
        coalescedPasses:passes,fullRebuilds:rebuilds};
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      return {...found,clearAfterEscape:input.value,
        shownAfterEscape:[...browser.querySelectorAll('.ssx-track-choice')].filter(b=>!b.hidden).length,
        emptyHidden:document.querySelector('#ssxRegionNoMatches').hidden};
    })()`);
    console.log('SSX_R75_SEARCH_FRAME',JSON.stringify(discovery));
    assert.equal(searchBefore.focused,true);
    assert.equal(discovery.coalescedPasses,1,'Rapid search input must render once per frame, not every key');
    assert.equal(discovery.fullRebuilds,0,'Search must not rebuild the full banner catalogue');
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
    const trackKeys=await evaluate(cdp.send,sid,`(()=>{
      const africa=document.querySelector('.ssx-region-group[data-region-name="Africa"]');
      const entries=[...africa.querySelectorAll('button.ssx-track-choice:not([hidden])')];
      entries[0].focus();
      entries[0].dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));
      const end=document.activeElement?.textContent?.trim();
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));
      const home=document.activeElement?.textContent?.trim();
      return {end,home,selected:africa.querySelector('.ssx-region-detail h3')?.textContent,regionOpen:africa.open};
    })()`);
    console.log('SSX_R75_TRACK_KEYBOARD',JSON.stringify(trackKeys));
    assert.match(trackKeys.end,/Incoming/);
    assert.match(trackKeys.home,/Red Light/);
    assert.equal(trackKeys.selected,'Red Light','Keyboard focus navigation must not change record selections');
    assert.equal(trackKeys.regionOpen,true);

    assert.deepEqual(navigation.labels,['Pista anterior','Próxima pista']);
    const desktopDensity=await evaluate(cdp.send,sid,"(()=>{const item=document.querySelector('.ssx-region-rank');const proof=item.querySelector('.ssx-region-proof');const metrics=item.querySelector('.ssx-region-metrics');return {height:Math.round(item.getBoundingClientRect().height),score:metrics.querySelector('.ssx-region-score')?.textContent,accessible:proof?.getAttribute('aria-label'),proofWidth:proof?.getBoundingClientRect().width,gridColumns:getComputedStyle(item).gridTemplateColumns.split(' ').length}})()");
    assert.ok(desktopDensity.height>=50&&desktopDensity.height<=112,
      'Inline desktop scorecards must preserve their readable height');
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
    const interactions=await evaluate(cdp.send,sid,"(()=>{const about=document.querySelector('#aboutBtn');about.click();const opened=document.querySelector('#aboutModal').getAttribute('aria-hidden');document.querySelector('[data-close=\"aboutModal\"]').click();const direct=document.querySelector('#ssxDirectActions');const buttons=[...direct.querySelectorAll('button')].filter(b=>getComputedStyle(b).display!=='none');const toolsHidden=getComputedStyle(document.querySelector('#toolsGroup')).display==='none';const advanced=document.querySelector('#alpineAdvancedFilters');advanced.querySelector('summary').click();const filterOpen=advanced.open;advanced.querySelector('summary').click();return{opened,labels:buttons.map(b=>b.textContent.trim()),visible:buttons.every(b=>getComputedStyle(b).display!=='none'&&b.getBoundingClientRect().height>=36),toolsHidden,filterOpen,hasManagement:buttons.some(b=>b.dataset.ssxAction==='adminBtn')}})()");
    assert.equal(interactions.opened,'false','About modal must still open');
    assert.deepEqual(interactions.labels,['Ajustes','Guia','Dados','Sobre os dados']);
    assert.equal(interactions.visible,true,'All public/management actions must be accessible without More');
    assert.equal(interactions.toolsHidden,true,'The redundant overflow trigger must not appear');
    assert.equal(interactions.hasManagement,false,'Administrative controls must not be part of public shortcuts');
    assert.equal(interactions.filterOpen,true,'Only the advanced filter panel stays collapsed by default');
    const community=await evaluate(cdp.send,sid,"(()=>{const button=document.querySelector('#communityMenuBtn');button.click();const opened=document.querySelector('#introModal').getAttribute('aria-hidden');const header=document.querySelector('#introModal .modal-head h2').textContent;const sheetLabel=getComputedStyle(document.querySelector('#introModal [data-i=\"introFromSheet\"]')).display;document.querySelector('[data-close=\"introModal\"]').click();return {opened,header,sheetLabel,gearLabel:!!document.querySelector('#toolsMenuBtn [data-i=\"navTools\"]'),gearAria:document.querySelector('#toolsMenuBtn').getAttribute('aria-label'),snow:getComputedStyle(document.querySelector('#snowLayer')).display};})()");
    assert.equal(community.opened,'false','Community should directly open player guide');
    assert.doesNotMatch(community.header,/INTRO/i);
    assert.equal(community.sheetLabel,'none');
    assert.equal(interactions.labels.length,4);
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

    const restoredMobileTitle=await evaluate(cdp.send,sid,
      "document.querySelector('#heroTitle')?.textContent.trim()");
    assert.equal(restoredMobileTitle,'Conquiste a montanha.',
      'Legacy source/mode updates must not replace the localized community headline');
    const mobileHeroShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(outDir,'ssx-v37-mobile-hero.png'),Buffer.from(mobileHeroShot.data,'base64'));
    // Dedicated pre-dialog Chromium captures. The old screenshots labeled
    // "historical" were taken with Riders open or the page scrolled elsewhere;
    // verify the target section truly occupies the viewport before saving.
    const setViewportTarget=async selector=>{
      const pos=await evaluate(cdp.send,sid,`(()=>{
        const node=document.querySelector(${JSON.stringify(selector)});
        node.scrollIntoView({block:'start',behavior:'instant'});
        return {top:node.getBoundingClientRect().top,height:node.getBoundingClientRect().height,
          scrollY:window.scrollY,viewport:window.innerHeight,documentHeight:document.documentElement.scrollHeight};
      })()`);
      await sleep(260);
      const after=await evaluate(cdp.send,sid,`(()=>{
        const node=document.querySelector(${JSON.stringify(selector)});
        const rect=node.getBoundingClientRect();
        return{top:rect.top,bottom:rect.bottom,scrollY:window.scrollY,
          viewport:window.innerHeight,bodyOverflow:getComputedStyle(document.body).overflow,
          modalOpen:[...document.querySelectorAll('.modal[aria-hidden="false"]')].map(el=>el.id),
          scrollRoot:document.scrollingElement?.tagName,
          htmlOverflow:getComputedStyle(document.documentElement).overflow,
          htmlScrollHeight:document.documentElement.scrollHeight,
          bodyScrollHeight:document.body.scrollHeight,
          bodyInlineOverflow:document.body.style.overflow,
          hierarchy:(()=>{const out=[];let n=node;while(n&&out.length<9){
            const css=getComputedStyle(n),r=n.getBoundingClientRect();
            out.push({tag:n.tagName,id:n.id,className:String(n.className||'').slice(0,60),
              top:Math.round(r.top),height:Math.round(r.height),scrollHeight:n.scrollHeight,
              clientHeight:n.clientHeight,scrollTop:n.scrollTop,overflow:css.overflow,position:css.position});
            n=n.parentElement;}return out;})()};
      })()`);
      assert.ok(after.top<after.viewport&&after.bottom>0,
        'Chromium capture must show the intended visible section '+selector+' '+JSON.stringify({before:pos,after}));
      assert.deepEqual(after.modalOpen,[],'No modal can obscure a visual regression capture');
      return after;
    };
    await evaluate(cdp.send,sid,"(()=>{document.querySelector('#ssxSpecialTabs [data-ssx-special-group=android]').click();document.querySelector('#ssxSpecialViews [data-ssx-special-view=leaders]').click()})()");
    const archiveFrame=await setViewportTarget('#ssxSpecialPodium');
    console.log('SSX_R69_MOBILE_ARCHIVE_FRAME',JSON.stringify(archiveFrame));
    const visibleFlags=await evaluate(cdp.send,sid,"(()=>[...document.querySelectorAll('#ssxSpecialPodium img.ssx-special-rider-flag')].map(img=>({alt:img.alt,loaded:img.naturalWidth>0,top:img.getBoundingClientRect().top,width:img.getBoundingClientRect().width})))()");
    assert.ok(visibleFlags.length>0&&visibleFlags.every(img=>img.loaded&&img.width>=18),
      'Mobile archived flags must be actually painted, not merely present: '+JSON.stringify(visibleFlags));
    const archiveShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(outDir,'ssx-r69-mobile-archive-flags.png'),Buffer.from(archiveShot.data,'base64'));
    await evaluate(cdp.send,sid,"document.querySelector('#ssxSpecialViews [data-ssx-special-view=records]').click()");
    await setViewportTarget('.ssx-region-detail');
    const mainFlagsShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(outDir,'ssx-r69-mobile-ranking-flags.png'),Buffer.from(mainFlagsShot.data,'base64'));
    // Restore the user's previously selected challenge tab after isolated visuals.
    await evaluate(cdp.send,sid,"document.querySelector('#ssxSpecialTabs [data-ssx-special-group=challenge]').click()");

    const mobile=await evaluate(cdp.send,sid,"({cards:getComputedStyle(document.querySelector('#alpineMobileCards')).display,table:getComputedStyle(document.querySelector('.sheet-scroll')).display,records:document.querySelectorAll('#alpineMobileCards .alpine-card').length,mode:document.body.dataset.ssxMode,viewport:window.innerWidth})");
    assert.equal(mobile.table,'none');
    assert.equal(mobile.cards,'none','Mobile now starts with the same regional explorer as desktop');
    assert.ok(mobile.records>0,'Read-only legacy card data must remain available for filtered views');
    await evaluate(cdp.send,sid,`(()=>{
      const africa=[...document.querySelectorAll('.ssx-region-group')]
        .find(g=>g.dataset.regionName==='Africa');
      if(!africa.open)africa.querySelector('summary').click();
    })()`);
    const mobileRegional=await evaluate(cdp.send,sid,"(()=>{const root=document.querySelector('#ssxRegionBrowser');const africa=[...root.querySelectorAll('.ssx-region-group')].find(x=>x.dataset.regionName==='Africa');const banner=africa.querySelector('.ssx-region-banner');const detail=root.querySelector('.ssx-region-detail');const art=getComputedStyle(banner,'::before').backgroundImage;return {shown:getComputedStyle(root).display,cols:getComputedStyle(root).gridTemplateColumns,africa:!!africa,redLight:detail.querySelector('h3')?.textContent,runs:detail.querySelectorAll('.ssx-region-rank').length,flags:detail.querySelectorAll('.ssx-region-rider .rider-flag').length,art,navOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()");
    assert.equal(mobileRegional.shown,'grid','Mobile must render real region and mountain hierarchy');
    assert.equal(mobileRegional.redLight,'Red Light');
    assert.ok(mobileRegional.runs>0&&mobileRegional.flags>0,'Real flags and record rows must remain accessible');
    // Confirm the mobile image paints: an img element with src/alt is not enough.
    await evaluate(cdp.send,sid,"document.querySelector('.ssx-region-rider img.rider-flag')?.scrollIntoView({block:'center',behavior:'instant'})");
    await sleep(220);
    const mobileFlag=await evaluate(cdp.send,sid,`(()=>{
      const image=document.querySelector('.ssx-region-rider img.rider-flag');
      const style=getComputedStyle(image),r=image.getBoundingClientRect();
      return {source:image.getAttribute('src'),naturalWidth:image.naturalWidth,
        width:r.width,height:r.height,display:style.display,visibility:style.visibility,
        opacity:Number(style.opacity),flagPreference:typeof prefs==='object'?prefs.showFlags:null};
    })()`);
    console.log('SSX_R69_MOBILE_RANKING_FLAG',JSON.stringify(mobileFlag));
    assert.ok(mobileFlag.naturalWidth>0,'A real flag must load, not merely exist in the DOM');
    assert.ok(mobileFlag.width>=18&&mobileFlag.height>=12,'Mobile flags must be visibly sized');
    assert.notEqual(mobileFlag.display,'none');
    assert.equal(mobileFlag.visibility,'visible');
    assert.ok(mobileFlag.opacity>.9);

    assert.match(mobileRegional.art,/\/hobbies\/ssx\/media\/v37\//,'Region needs pinned game artwork');
    assert.equal(mobileRegional.navOverflow,false,'Regional mobile layout must not overflow screen');
    const resetMobile=await evaluate(cdp.send,sid,"(()=>({height:Math.round(document.querySelector('#ssxResetFilters').getBoundingClientRect().height),label:document.querySelector('#ssxResetFilters').textContent,contained:document.querySelector('.sheet-card #toolbar').contains(document.querySelector('#ssxResetFilters')),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}))()");
    assert.ok(resetMobile.height>=40&&resetMobile.contained);
    assert.ok(resetMobile.overflow<=1);

    const modeSheet=await evaluate(cdp.send,sid,"(()=>{const detail=document.querySelector('.ssx-region-detail');const bar=document.querySelector('#ssxSheetModeFilter');const rank=detail.querySelector('.ssx-region-ranking');const share=detail.querySelector('.ssx-track-share-button');const buttons=[...bar.querySelectorAll('button:not([hidden])')];return {inShare:bar.parentElement===share.parentElement,barDisplay:getComputedStyle(bar).display,beforeScores:bar.getBoundingClientRect().top<rank.getBoundingClientRect().top,withinDetail:detail.contains(bar),shareRect:{top:share.getBoundingClientRect().top,bottom:share.getBoundingClientRect().bottom,left:share.getBoundingClientRect().left,right:share.getBoundingClientRect().right},railRect:{top:bar.getBoundingClientRect().top,bottom:bar.getBoundingClientRect().bottom,left:bar.getBoundingClientRect().left,right:bar.getBoundingClientRect().right},sameRow:Math.min(bar.getBoundingClientRect().bottom,share.getBoundingClientRect().bottom)-Math.max(bar.getBoundingClientRect().top,share.getBoundingClientRect().top)>=Math.min(bar.getBoundingClientRect().height,share.getBoundingClientRect().height)*.6 && bar.getBoundingClientRect().left>=share.getBoundingClientRect().right-2,labels:buttons.map(b=>b.querySelector('.ssx-sheet-mode-name')?.textContent),active:bar.querySelector('[aria-pressed=true]')?.dataset.ssxSheetMode,hiddenUpper:getComputedStyle(document.querySelector('#alpineSubmodes')).display==='none',controlsHeight:buttons.map(b=>Math.round(b.getBoundingClientRect().height)),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}})()");
    assert.equal(modeSheet.inShare,true,'Modes must sit beside Share in the selected mobile track');
    assert.equal(modeSheet.barDisplay,'flex','The accessible five-mode rail must show above regional results');
    assert.equal(modeSheet.withinDetail,true,'Mode selector belongs to the selected track detail');
    console.log('SSX_R74_MOBILE_ACTION_ROW',JSON.stringify({sameRow:modeSheet.sameRow,share:modeSheet.shareRect,rail:modeSheet.railRect}));
    assert.equal(modeSheet.sameRow,true,'Share and modes must visibly overlap vertically and occupy neighboring columns on mobile');
    assert.equal(modeSheet.beforeScores,true,'Mode selector must precede all selected-track scorecards');
    assert.deepEqual(modeSheet.labels,['Board','Wingsuit','Trick It!','Survive It!','Survive It! · Sem equipamentos']);
    assert.equal(await evaluate(cdp.send,sid,
      "document.querySelector('#ssxSheetModeFilter').parentElement.classList.contains('ssx-track-share-controls')"),true);
    assert.equal(modeSheet.active,'wings');
    assert.equal(modeSheet.hiddenUpper,true,'No duplicated submode selectors in the hero');
    assert.ok(modeSheet.controlsHeight.every(h=>h>=44)&&modeSheet.overflow<=1);
    const fullModeRow=await evaluate(cdp.send,sid,`(()=>{
      const el=document.querySelector('#ssxSheetModeFilter');
      const r=el.getBoundingClientRect(),buttons=[...el.querySelectorAll('button')];
      return{width:r.width,viewport:document.documentElement.clientWidth,
        scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,
        labels:buttons.map(b=>b.textContent.trim()),
        heights:buttons.map(b=>Math.round(b.getBoundingClientRect().height)),
        viewportOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        visibleOnArrival:buttons.filter(b=>{const r=b.getBoundingClientRect(),w=el.getBoundingClientRect();return r.left>=w.left-1&&r.right<=w.right+1;}).length,
        itemWidths:buttons.map(b=>Math.round(b.getBoundingClientRect().width))};
    })()`);
    console.log('SSX_R73_MOBILE_MODE_ROW',JSON.stringify(fullModeRow));
    assert.equal(fullModeRow.labels.length,5);
    assert.ok(fullModeRow.visibleOnArrival>=1,'At least one discipline should be fully visible beside Share on mobile');
    assert.ok(fullModeRow.scrollWidth>fullModeRow.clientWidth,'The other modes must remain accessible via horizontal scrolling');
    assert.ok(fullModeRow.itemWidths.every(w=>w<=175),'Compact mode buttons must not expand to the full phone width');
    assert.ok(fullModeRow.heights.every(h=>h>=44));
    assert.ok(fullModeRow.viewportOverflow<=1);
    await evaluate(cdp.send,sid,"document.querySelector('.ssx-region-detail .ssx-track-share-controls').scrollIntoView({block:'center',behavior:'instant'})");
    await sleep(90);
    const mobileModeShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    const mobileModeDir=path.join(process.cwd(),'artifacts');
    fs.mkdirSync(mobileModeDir,{recursive:true});
    fs.writeFileSync(path.join(mobileModeDir,'ssx-r73-mobile-five-modes.png'),
      Buffer.from(mobileModeShot.data,'base64'));

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
    // R75: selecting a distant mode scrolls the *local* action rail only,
    // even when the track's Share button occupies the same horizontal row.
    await evaluate(cdp.send,sid,"document.querySelector('#ssxSheetModeFilter [data-ssx-sheet-mode=special]').click()");
    await sleep(160);
    const activeRail=await evaluate(cdp.send,sid,`(()=>{
      const rail=document.querySelector('#ssxSheetModeFilter'),btn=rail.querySelector('[aria-pressed=true]');
      const a=btn.getBoundingClientRect(),b=rail.getBoundingClientRect();
      return {mode:btn.dataset.ssxSheetMode,scrollLeft:rail.scrollLeft,
        fullyVisible:a.left>=b.left-2&&a.right<=b.right+2,
        sameShareRow:rail.parentElement.classList.contains('ssx-track-share-controls'),
        overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
    })()`);
    console.log('SSX_R75_ACTIVE_RAIL',JSON.stringify(activeRail));
    assert.equal(activeRail.mode,'special');
    assert.equal(activeRail.fullyVisible,true,'Active mobile discipline must remain in view');
    assert.equal(activeRail.sameShareRow,true);
    assert.ok(activeRail.scrollLeft>0&&activeRail.overflow<=1);
    await evaluate(cdp.send,sid,"document.querySelector('#ssxSheetModeFilter [data-ssx-sheet-mode=wings]').click()");
    await sleep(150);

    const otherModes=await evaluate(cdp.send,sid,"(()=>{document.querySelector('[data-alpine-group=survive]').click();const surviving=[...document.querySelectorAll('#ssxSheetModeFilter button:not([hidden])')].map(b=>b.dataset.ssxSheetMode);document.querySelector('#ssxSheetModeFilter [data-ssx-sheet-mode=special]').click();const special=document.body.dataset.ssxMode;document.querySelector('[data-alpine-group=trick]').click();const trickHidden=document.querySelector('#ssxSheetModeFilter').hidden;document.querySelector('[data-alpine-group=race]').click();return {surviving,special,trickHidden,restored:document.body.dataset.ssxMode,active:document.querySelector('#ssxSheetModeFilter [aria-pressed=true]')?.dataset.ssxSheetMode}})()");
    assert.deepEqual(otherModes.surviving,['board','wings','trick','survive','special']);
    assert.equal(otherModes.special,'special');
    assert.equal(otherModes.trickHidden,false,'All five modes must remain discoverable in Trick It!');
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
    assert.ok(mobileDensity.maxHeight<=116,'Readable mobile scorecards must not clip their labels');
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
    const directNav=await evaluate(cdp.send,sid,"(()=>{const quick=document.querySelector('#ssxMobileQuickNav');const direct=document.querySelector('#ssxDirectActions');const brand=document.querySelector('.brand');const menu=document.querySelector('#mobileMenuBtn');const buttons=[...direct.querySelectorAll('button')].filter(b=>getComputedStyle(b).display!=='none');return{quickLabels:[...quick.querySelectorAll('button')].map(b=>b.textContent),directLabels:buttons.map(b=>b.textContent),brandHidden:getComputedStyle(brand).display==='none',legacyHidden:getComputedStyle(document.querySelector('#topNav')).display==='none',hamburgerRemoved:menu===null,panelRemoved:!document.querySelector('#ssxMobileMore'),actionable:buttons.every(b=>b.getBoundingClientRect().height>=40),screenOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}})()");
    assert.deepEqual(directNav.quickLabels,['Recordes','Riders','Comunidade','Sobre']);
    assert.deepEqual(directNav.directLabels,['Ajustes','Guia','Dados','Sobre os dados']);
    assert.equal(directNav.brandHidden,false,'SSX 2012 branding must remain visible on mobile');
    assert.equal(directNav.legacyHidden,true);
    assert.equal(directNav.hamburgerRemoved,true);
    assert.equal(directNav.panelRemoved,true);
    assert.ok(directNav.actionable&&directNav.screenOverflow<=1);
    const compactHeader=await evaluate(cdp.send,sid,`(()=>{
      const header=document.querySelector('.topbar'),primary=document.querySelector('#ssxMobileQuickNav'),
        utility=document.querySelector('#ssxDirectActions');
      const rect=n=>{const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,width:r.width};};
      return {header:rect(header),primary:rect(primary),utility:rect(utility),
        insideHeader:header.contains(primary)&&header.contains(utility),
        primaryFirst:primary.compareDocumentPosition(utility)&Node.DOCUMENT_POSITION_FOLLOWING,
        utilityOverflow:getComputedStyle(utility).overflowX,
        scrollWidth:utility.scrollWidth,clientWidth:utility.clientWidth,
        docOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
    })()`);
    console.log('SSX_R71_MOBILE_HEADER',JSON.stringify(compactHeader));
    assert.ok(compactHeader.insideHeader,'Both navigation tiers must be inside the topbar');
    assert.ok(compactHeader.primaryFirst,'Public mobile destinations must come before tools');
    assert.ok(compactHeader.utility.top>=compactHeader.primary.bottom-1);
    assert.ok(compactHeader.utility.height<=60,'Mobile utilities must use a thin rail, not a three-row grid');
    assert.ok(compactHeader.docOverflow<=1);
    assert.equal(compactHeader.utilityOverflow,'auto','Mobile utilities must scroll within their own rail');
    const privateActions=await evaluate(cdp.send,sid,\"(()=>({admin:getComputedStyle(document.querySelector('#ssxDirectActions [data-ssx-action=adminBtn]')).display,submissions:getComputedStyle(document.querySelector('#ssxDirectActions [data-ssx-action=submissionsBtn]')).display}))()\");
    assert.equal(privateActions.admin,'none','Admin action must not be public');
    assert.equal(privateActions.submissions,'none','Moderation action must not be public');

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
    // Previously the mobile Chromium screenshots were obscured by Riders
    // because this interaction left its modal open for every later capture.
    const ridersClosed=await evaluate(cdp.send,sid,"(()=>{const modal=document.querySelector('#ridersModal');const close=document.querySelector('[data-close=ridersModal]');if(!modal||!close)return{found:false,closed:false};close.click();return{found:true,closed:modal.getAttribute('aria-hidden')==='true'};})()");
    assert.equal(ridersClosed.found,true,'Riders dialog needs an actual close control');
    assert.equal(ridersClosed.closed,true,'Riders dialog must close before visual inspection');

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
    const railInRegion=await evaluate(cdp.send,sid,"(()=>{const rail=document.querySelector('#ssxSheetModeFilter');const group=rail.closest('.ssx-region-group');return {share:rail.parentElement?.classList.contains('ssx-track-share-controls'),fallback:rail.parentElement?.classList.contains('sheet-card'),open:group?.open===true,visible:getComputedStyle(rail).display!=='none'&&rail.getClientRects().length>0}})()");
    assert.equal(railInRegion.visible,true,'The mode rail must remain keyboard-visible when reopening regional browsing');
    assert.ok(railInRegion.share&&railInRegion.open || railInRegion.fallback,
      'A selected open piste uses the Share row; a collapsed region uses the safe fallback');

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

    const focus=await evaluate(cdp.send,sid,"(()=>{document.querySelector('[data-alpine-group=\"race\"]').click();const wings=document.querySelector('#ssxSheetModeFilter [data-ssx-sheet-mode=\"wings\"]');wings.focus();wings.click();return {mode:document.body.dataset.ssxMode,retained:document.activeElement===wings,activeTag:document.activeElement?.tagName,activeText:document.activeElement?.textContent?.slice(0,55),activeMode:document.activeElement?.dataset?.ssxSheetMode,parent:wings.parentElement?.className,connected:wings.isConnected,railParent:document.querySelector('#ssxSheetModeFilter')?.parentElement?.className,railDisplay:getComputedStyle(document.querySelector('#ssxSheetModeFilter')).display,railBoxes:document.querySelector('#ssxSheetModeFilter').getClientRects().length,closedAncestor:!!wings.closest('details:not([open])'),groupOpen:wings.closest('details.ssx-region-group')?.open,view:document.body.dataset.ssxMobileView,buttonBoxes:wings.getClientRects().length,selected:document.querySelector('#ssxSheetModeFilter [aria-pressed=true]')?.dataset.ssxSheetMode};})()");
    assert.equal(focus.mode,'wings');
    console.log('SSX_R74_FOCUS_DIAGNOSTIC',JSON.stringify(focus));
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
    assert.equal(light.bg,'rgb(238, 246, 250)','The rebuilt v38 light-theme canvas must remain readable');
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
      assert.equal(responsiveMode.bar,'flex','The track-local five-mode control must remain a horizontal row at '+width+'px');
      assert.equal(responsiveMode.top,width<=900?'none':'flex','Original large-screen submodes must remain available at '+width+'px');
      assert.ok(responsiveMode.screenOverflow<=1,'No horizontal overflow at '+width+'px');
      const regionalGrid=await evaluate(cdp.send,sid,
        "getComputedStyle(document.querySelector('#ssxRegionBrowser .ssx-region-index')).gridTemplateColumns.split(' ').length");
      if(width===390)assert.equal(regionalGrid,2,
        'At 390px, show two photo banners per row without compressing inline scorecards');
      if(width===320)assert.equal(regionalGrid,1,
        'A 320px screen must keep a comfortably readable single banner per row');
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
        // Only source-proven rider flags are present. Verify actual pixel loading
        // on phone widths, in both archived leader and podium cards.
        await evaluate(cdp.send,sid,"document.querySelector('#ssxSpecialPodium').scrollIntoView({block:'center',behavior:'instant'})");
        await sleep(260);
        const archiveMobileFlag=await evaluate(cdp.send,sid,`(()=>{
          const items=[...document.querySelectorAll('#ssxSpecialPodium img.ssx-special-rider-flag, #ssxSpecialResults .ssx-special-leader img.ssx-special-rider-flag')];
          return items.map(img=>{
            const r=img.getBoundingClientRect(),cs=getComputedStyle(img);
            return {alt:img.alt,width:r.width,height:r.height,naturalWidth:img.naturalWidth,
              complete:img.complete,display:cs.display,visibility:cs.visibility,
              opacity:Number(cs.opacity),source:img.getAttribute('src')};
          });
        })()`);
        console.log('SSX_R69_ARCHIVE_MOBILE_FLAGS_'+width,JSON.stringify(archiveMobileFlag.slice(0,8)));
        assert.ok(archiveMobileFlag.length>=3,'The selected Android archive should have real source-mapped flags');
        for(const flag of archiveMobileFlag){
          assert.ok(flag.width>=18&&flag.height>=12,'Flag needs real visible dimensions');
          assert.equal(flag.display,'block');
          assert.equal(flag.visibility,'visible');
          assert.ok(flag.opacity>.9);
          assert.ok(flag.naturalWidth>0&&flag.complete,'Flags must finish decoding even in scrollable mobile lists');
          assert.match(flag.source,/^blob:/,'Original v36 flag Blob must remain the only flag source');
        }

        assert.equal(historicLeaderMobile.leaders,12);
        const compactLeaderColumns=await evaluate(cdp.send,sid,
          "getComputedStyle(document.querySelector('#ssxSpecialResults .ssx-special-leader')).gridTemplateColumns.split(' ').length");
        assert.equal(compactLeaderColumns,2,
          'Archive rider names must not be squeezed by a third score column at '+width+'px');

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
