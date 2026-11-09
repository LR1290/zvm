
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
    const desktop=await evaluate(cdp.send,sid,"(()=>{const sources=document.querySelector('#alpineSources');return {cards:document.querySelectorAll('.alpine-mode-card').length,sourceClosed:!!sources&&!sources.open,advanced:!!document.querySelector('#alpineAdvancedFilters #categoryField'),rows:document.querySelectorAll('#sheet tr.rank-row').length,admin:!!document.querySelector('#dataBtn'),opaque:globalThis.origin==='null'};})()");
    assert.equal(desktop.cards,4);
    assert.equal(desktop.sourceClosed,true);
    assert.equal(desktop.advanced,true);
    assert.ok(desktop.rows>10);
    assert.equal(desktop.admin,true);
    assert.equal(desktop.opaque,true);
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
    await sleep(400);
    const mobile=await evaluate(cdp.send,sid,"({cards:getComputedStyle(document.querySelector('#alpineMobileCards')).display,table:getComputedStyle(document.querySelector('.sheet-scroll')).display,records:document.querySelectorAll('#alpineMobileCards .alpine-card').length,mode:document.body.dataset.ssxMode,viewport:window.innerWidth})");
    assert.equal(mobile.table,'none');
    assert.notEqual(mobile.cards,'none');
    assert.ok(mobile.records>0);
    assert.equal(mobile.mode,'wings');
    assert.ok(mobile.viewport<=430);
    const mobShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(outDir,'ssx-v37-mobile.png'),Buffer.from(mobShot.data,'base64'));
    await evaluate(cdp.send,sid,"document.querySelector('.sheet-card').scrollIntoView({block:'start'})");
    await sleep(300);
    const rankingsShot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sid);
    fs.writeFileSync(path.join(outDir,'ssx-v37-mobile-rankings.png'),Buffer.from(rankingsShot.data,'base64'));
  } finally {
    cdp?.ws.close();
    chrome.kill('SIGTERM');
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
