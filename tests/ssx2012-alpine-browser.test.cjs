
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
    assert.equal(desktop.admin,true);
    assert.equal(desktop.opaque,true);
    const ssxDesktopDiagnostics=await evaluate(cdp.send,sid,`(()=>{const table=document.querySelector('#sheet'),heads=[...document.querySelectorAll('#sheet thead tr')].map(tr=>({html:tr.outerHTML.slice(0,1600),cellCount:tr.cells.length})),cells=[...document.querySelectorAll('#sheet tbody tr.rank-row')].slice(0,2).map(tr=>[...tr.cells].map(td=>({classes:td.className,display:getComputedStyle(td).display,width:Math.round(td.getBoundingClientRect().width)})));return {tableLayout:getComputedStyle(table).tableLayout,heads,cells}})()`);
    console.log('SSX_DESKTOP_LAYOUT_DIAGNOSTICS',JSON.stringify(ssxDesktopDiagnostics));


    const publicUI=await evaluate(cdp.send,sid,"(()=>{const hero=document.querySelector('#top');const stats=document.querySelector('.ssx-community-stats');const advanced=document.querySelector('#alpineAdvancedFilters');const about=document.querySelector('#aboutBtn');const sources=document.querySelector('#alpineSources');const visibleNames=Array.from(document.querySelectorAll('#topNav > .nav-btn, #topNav > .nav-group > .nav-btn')).filter(el=>getComputedStyle(el).display!=='none').map(el=>el.id);return {title:document.title,heroDesc:document.querySelector('#heroDesc').textContent,headline:document.querySelector('#heroTitle').textContent,statsBelowHero:stats===hero.nextElementSibling,recordsNav:!!document.querySelector('#topNav > #ssxNavRecords'),aboutInMainNav:about.parentElement.id==='topNav',nav:visibleNames,advancedClosed:!advanced.open,sourceInsideAdvanced:advanced.contains(sources),topNInsideAdvanced:advanced.contains(document.querySelector('#topN')),actionsInsideAdvanced:advanced.contains(document.querySelector('.toolbar-actions')),managementClosed:!document.querySelector('#ssxManagement').open,bridgeHidden:getComputedStyle(document.querySelector('#liveSyncChip')).display==='none',snapshotHidden:getComputedStyle(document.querySelector('.hero-kickers')).display==='none',summaryHidden:getComputedStyle(document.querySelector('#summary')).display==='none',creditsClosed:!document.querySelector('#ssxCredits').open,alpineText:document.body.innerText.includes('ALPINE EDITION')};})()");
    assert.equal(publicUI.title,'SSX 2012 · Recordes da Comunidade');
    assert.equal(publicUI.heroDesc,'Race It!, Trick It! e Survive It!: tempos, pontuações e provas em vídeo.');
    assert.equal(publicUI.statsBelowHero,true,'Community counts should appear below hero like the Canva reference');
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
    assert.equal(grouped.viewClosed,true,'Result actions should be collapsed by default');
    assert.equal(grouped.actionsInside,true,'Result options must retain both existing actions');
    assert.equal(grouped.fakeBootButtons,false,'Do not render non-interactive placeholders');
    const interactions=await evaluate(cdp.send,sid,"(()=>{const about=document.querySelector('#aboutBtn');about.click();const opened=document.querySelector('#aboutModal').getAttribute('aria-hidden');document.querySelector('[data-close=\"aboutModal\"]').click();document.querySelector('#toolsMenuBtn').click();const gearOpened=document.querySelector('#toolsGroup').classList.contains('open');document.querySelector('#ssxManagement summary').click();const managementOpened=document.querySelector('#ssxManagement').open;const adminExists=!!document.querySelector('#ssxManagement #adminBtn');document.querySelector('#toolsMenuBtn').click();const advanced=document.querySelector('#alpineAdvancedFilters');advanced.querySelector('summary').click();const filterOpen=advanced.open;advanced.querySelector('summary').click();return {opened,gearOpened,managementOpened,adminExists,filterOpen};})()");
    assert.equal(interactions.opened,'false','About modal must remain functional after moving its button');
    assert.equal(interactions.gearOpened,true);
    assert.equal(interactions.managementOpened,true);
    assert.equal(interactions.adminExists,true);
    assert.equal(interactions.filterOpen,true);
    const community=await evaluate(cdp.send,sid,"(()=>{const button=document.querySelector('#communityMenuBtn');button.click();const opened=document.querySelector('#introModal').getAttribute('aria-hidden');const header=document.querySelector('#introModal .modal-head h2').textContent;const sheetLabel=getComputedStyle(document.querySelector('#introModal [data-i=\"introFromSheet\"]')).display;document.querySelector('[data-close=\"introModal\"]').click();return {opened,header,sheetLabel,gearLabel:!!document.querySelector('#toolsMenuBtn [data-i=\"navTools\"]'),gearAria:document.querySelector('#toolsMenuBtn').getAttribute('aria-label'),snow:getComputedStyle(document.querySelector('#snowLayer')).display};})()");
    assert.equal(community.opened,'false','Community should directly open player guide');
    assert.doesNotMatch(community.header,/INTRO/i);
    assert.equal(community.sheetLabel,'none');
    assert.equal(community.gearLabel,true,'Mobile navigation needs an explicit label for the overflow menu');
    assert.equal(community.gearAria,'Mais opções');
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

    const ssxMobileDiagnostics=await evaluate(cdp.send,sid,`(()=>{const top=document.querySelector('.topbar'),nav=document.querySelector('#topNav'),buttons=[...document.querySelectorAll('button')].filter(b=>/menu|nav|hamburger|mobile/i.test(b.id+' '+b.className+' '+b.getAttribute('aria-label'))).slice(0,20).map(b=>b.outerHTML.slice(0,700));return {topbar:top?.outerHTML.slice(0,12500),nav:nav?.outerHTML.slice(0,12500),buttons,navStyle:nav?{display:getComputedStyle(nav).display,height:nav.getBoundingClientRect().height}:null}})()`);
    console.log('SSX_MOBILE_NAV_DIAGNOSTICS',JSON.stringify(ssxMobileDiagnostics));

    const mobileHeroShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(outDir,'ssx-v37-mobile-hero.png'),Buffer.from(mobileHeroShot.data,'base64'));
    const mobile=await evaluate(cdp.send,sid,"({cards:getComputedStyle(document.querySelector('#alpineMobileCards')).display,table:getComputedStyle(document.querySelector('.sheet-scroll')).display,records:document.querySelectorAll('#alpineMobileCards .alpine-card').length,mode:document.body.dataset.ssxMode,viewport:window.innerWidth})");
    assert.equal(mobile.table,'none');
    assert.notEqual(mobile.cards,'none');
    assert.ok(mobile.records>0);
    assert.equal(mobile.mode,'wings');
    assert.ok(mobile.viewport<=430);
    const mobileViewActions=await evaluate(cdp.send,sid,"(()=>{const details=document.querySelector('#ssxViewOptions');details.querySelector('summary').click();const toggle=document.querySelector('#alpinePositionsToggle');const visible=details.open && !toggle.hidden && toggle.getBoundingClientRect().width>=40 && getComputedStyle(toggle).display!=='none';details.querySelector('summary').click();return {visible,closedAgain:!details.open};})()");
    assert.equal(mobileViewActions.visible,true,'Mobile Exibição disclosure must expose a usable positions action');
    assert.equal(mobileViewActions.closedAgain,true,'Mobile Exibição disclosure must close after use');

    // Check preview-only interactions without writing to Google, Discord or ZVM APIs.
    const overview=await evaluate(cdp.send,sid,"(()=>{const root=document.querySelector('#alpineMobileCards');return {first:root.querySelector('.alpine-card .alpine-card-top span')?.textContent,second:root.querySelectorAll('.alpine-card')[1]?.querySelector('.alpine-card-top span')?.textContent,toggleVisible:!document.querySelector('#alpinePositionsToggle').hidden};})()");
    assert.ok(overview.toggleVisible,'Summary controls should be visible in mobile overview');
    const allRanks=await evaluate(cdp.send,sid,"(()=>{document.querySelector('#alpinePositionsToggle').click();return {pressed:document.querySelector('#alpinePositionsToggle').getAttribute('aria-pressed'),firstTwo:Array.from(document.querySelectorAll('#alpineMobileCards .alpine-card')).slice(0,2).map(card=>card.querySelector('.alpine-card-top span')?.textContent)};})()");
    await sleep(300);
    const positions=await evaluate(cdp.send,sid,"({pressed:document.querySelector('#alpinePositionsToggle').getAttribute('aria-pressed'),firstTwo:Array.from(document.querySelectorAll('#alpineMobileCards .alpine-card')).slice(0,2).map(card=>card.querySelector('.alpine-card-top span')?.textContent),number:document.querySelectorAll('#alpineMobileCards .alpine-card').length})");
    assert.equal(positions.pressed,'true');
    assert.equal(positions.firstTwo[0],positions.firstTwo[1],'All positions should display two ranks from the same track');
    assert.ok(positions.number>1);
    await evaluate(cdp.send,sid,"document.querySelector('.sheet-card').scrollIntoView({block:'start'})");
    await sleep(200);
    const positionsShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(outDir,'ssx-v37-mobile-all-positions.png'),Buffer.from(positionsShot.data,'base64'));
    await evaluate(cdp.send,sid,"document.querySelector('#alpinePositionsToggle').click()");
    await sleep(250);
    const concise=await evaluate(cdp.send,sid,"({firstTwo:Array.from(document.querySelectorAll('#alpineMobileCards .alpine-card')).slice(0,2).map(card=>card.querySelector('.alpine-card-top span')?.textContent),pressed:document.querySelector('#alpinePositionsToggle').getAttribute('aria-pressed')})");
    assert.equal(concise.pressed,'false');
    assert.notEqual(concise.firstTwo[0],concise.firstTwo[1],'Overview should show leaders from distinct tracks');

    const detail=await evaluate(cdp.send,sid,"(()=>{const track=document.querySelector('#track');track.value='0';track.dispatchEvent(new Event('change',{bubbles:true}));return {track:track.value};})()");
    assert.equal(detail.track,'0','Red Light should exist as original track selector');
    await sleep(450);
    const trackCards=await evaluate(cdp.send,sid,"({ranks:Array.from(document.querySelectorAll('#alpineMobileCards .alpine-card')).slice(0,3).map(card=>card.querySelector('.alpine-card-top span:last-child')?.textContent),toggleHidden:document.querySelector('#alpinePositionsToggle').hidden,mode:document.body.dataset.ssxMode})");
    assert.ok(trackCards.ranks.length>=2,'Selected track should expose ranked entries, not only its winner');
    assert.equal(trackCards.toggleHidden,true);
    assert.equal(trackCards.mode,'wings');

    await evaluate(cdp.send,sid,"(()=>{const track=document.querySelector('#track');track.value='';track.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await sleep(350);
    await evaluate(cdp.send,sid,"(()=>{const search=document.querySelector('#search');search.value='LR1290';search.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await sleep(650);
    const searched=await evaluate(cdp.send,sid,"({query:document.querySelector('#search').value,labels:Array.from(document.querySelectorAll('#alpineMobileCards .alpine-card-rider')).map(button=>button.textContent),toggleHidden:document.querySelector('#alpinePositionsToggle').hidden,number:document.querySelectorAll('#alpineMobileCards .alpine-card').length})");
    assert.equal(searched.query,'LR1290');
    assert.equal(searched.toggleHidden,true,'Rider search should switch into all-rank details');
    assert.ok(searched.labels.some(name=>name.includes('LR1290')),'Filtered mobile cards must include matching rider');
    await evaluate(cdp.send,sid,"(()=>{const search=document.querySelector('#search');search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await sleep(350);
    const restored=await evaluate(cdp.send,sid,"(()=>{document.querySelector('[data-alpine-group=\"trick\"]').click();const before=document.body.dataset.ssxMode;document.querySelector('#alpineToggleTable').click();const all=document.body.dataset.ssxMode;document.querySelector('#alpineToggleTable').click();return {before,all,back:document.body.dataset.ssxMode};})()");
    assert.deepEqual(restored,{before:'trick',all:'all',back:'trick'},'Full table must return to actual prior mode');

    const focus=await evaluate(cdp.send,sid,"(()=>{document.querySelector('[data-alpine-group=\"race\"]').click();const wings=document.querySelector('[data-alpine-mode=\"wings\"]');wings.focus();wings.click();return {mode:document.body.dataset.ssxMode,retained:document.activeElement===wings};})()");
    assert.equal(focus.mode,'wings');
    assert.equal(focus.retained,true,'Switching submodes must not destroy the focused button');

    await evaluate(cdp.send,sid,"document.querySelector('[data-lang=\"en\"]').click()");
    await sleep(300);
    const translated=await evaluate(cdp.send,sid,"({hero:document.querySelector('#heroTitle').textContent,more:document.querySelector('#alpinePositionsToggle').textContent,language:document.querySelector('#langName').textContent})");
    assert.equal(translated.hero,'Conquer the mountain.','New page headline must follow original language selector');
    assert.equal(translated.language.trim(),'English');
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
    }
    await evaluate(cdp.send,sid,"document.querySelector('.sheet-card').scrollIntoView({block:'start'})");

    const mobShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(outDir,'ssx-v37-mobile.png'),Buffer.from(mobShot.data,'base64'));
    await evaluate(cdp.send,sid,"document.querySelector('.sheet-card').scrollIntoView({block:'start'})");
    await sleep(300);
    const rankingsShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(outDir,'ssx-v37-mobile-rankings.png'),Buffer.from(rankingsShot.data,'base64'));
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
