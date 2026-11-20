const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
 try{
  const page=await browser.newPage({offline:true});
  const s=fs.readFileSync(path.join(process.argv[2],'app/content/features/broadcast/panel.js'),'utf8');
  const render=s.slice(s.indexOf('async function renderPreflightStep'),s.indexOf('var ITEM_STORAGE_BY_TYPE'));
  const result=await page.evaluate(async code=>{
   function extDomEl(tag,attrs,children){
    const node=document.createElement(tag);
    for(const [k,v] of Object.entries(attrs||{})){if(k==='text')node.textContent=v;else if(k==='disabled')node.disabled=v;else node.setAttribute(k,v);}
    node.append(...(children||[]));return node;
   }
   const formatPreflightDuration=()=>'',TYPE_ICONS=[],stepEl=document.body.appendChild(document.createElement('section'));
   const state={selectedType:'message',contactEntries:[{value:'00000000000'}],minDelay:1,maxDelay:2};
   let resolve,release,attempts=0,queues=0,rendered=0;
   const renderConfigStep=step=>step.replaceChildren(document.createTextNode('configuration')),renderStatusStep=()=>{rendered++;};
   const toast=()=>{};
   const enqueueAndStart=async(_,approved)=>{attempts++;await new Promise(r=>{release=r});if(approved())queues++;};
   window.__extSendSafetyManager={preflightRecipients:()=>new Promise(r=>{resolve=r})};
   const review=eval('(()=>{'+code+';return renderPreflightStep})()');
   const tick=()=>new Promise(r=>setTimeout(r,0));
   const start=performance.now(),first=review(stepEl);
   const feedback=performance.now()-start,hasPending=!!stepEl.querySelector('[role=status]');
   await new Promise(r=>setTimeout(r,1100));stepEl.querySelector('button').click();
   resolve({ok:true,allowedRecipients:['00000000000']});await first;
   const oldIgnored=stepEl.textContent==='configuration';
   const second=review(stepEl);resolve({ok:true,allowedRecipients:['00000000000']});await second;
   const confirm=stepEl.querySelector('#extuiDisparosPreflightConfirm'),checks=stepEl.querySelectorAll('input');
   checks[0].click();checks[1].click();confirm.click();
   checks[1].click();checks[1].click();for(let i=0;i<10000;i++)confirm.dispatchEvent(new Event('click'));
   stepEl.querySelector('#extuiDisparosPreflightBack').click();release();await tick();
   return {feedback,hasPending,oldIgnored,attempts,queues,rendered};
  },render);
  console.log(JSON.stringify(result));assert(result.feedback<100);assert(result.hasPending&&result.oldIgnored);
  assert.equal(result.attempts,1);assert.equal(result.queues,0);assert.equal(result.rendered,0);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
