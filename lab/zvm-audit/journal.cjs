const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
 try {
  for(const [i,tree] of process.argv.slice(2).entries()){
   const page=await browser.newPage();
   await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<title>synthetic QA</title>'}));
   await page.goto('https://qa.invalid/');
   const source=fs.readFileSync(path.join(tree,'app/background/authority/send-effect-journal.js'),'utf8');
   await page.addScriptTag({content:source});
   const result=await page.evaluate(async()=>{
    const journal=self.__extSendEffectJournalAuthority;
    const input={effectDigest:'1'.repeat(64),payloadDigest:'2'.repeat(64)};
    const auth={ownerHash:'3'.repeat(64),verify:async()=>{}};
    const open=indexedDB.open;
    indexedDB.open=()=>{throw new DOMException('fixture','SecurityError')};
    let first,second;
    try{await journal.prepare(input,auth)}catch(e){first=e.code}
    indexedDB.open=open;
    try{second=(await journal.prepare(input,auth)).prepared}catch(e){second=e.code}
    return {first,second};
   });
   assert.equal(result.first,'SEND_EFFECT_JOURNAL_UNAVAILABLE');
   assert.equal(result.second,i?true:result.first);
   console.log(JSON.stringify({version:i?'candidate':'R115',...result}));
   if(i){
    const started=await page.evaluate(async()=>{
     const j=self.__extSendEffectJournalAuthority;
     const input={effectDigest:'1'.repeat(64),payloadDigest:'2'.repeat(64)};
     const auth={ownerHash:'3'.repeat(64),verify:async()=>{}};
     const {token}=await j.prepare(input,auth);
     const results=await Promise.allSettled(Array.from({length:100},()=>j.begin({...input,token},auth)));
     await j.close();
     return [results.filter(x=>x.value?.begun).length,results.filter(x=>x.reason?.code==='SEND_EFFECT_ALREADY_DISPATCHING').length];
    });
    assert.deepEqual(started,[1,99]);
    await page.reload();await page.addScriptTag({content:source});
    const recovered=await page.evaluate(async()=>{
     const j=self.__extSendEffectJournalAuthority, input={effectDigest:'1'.repeat(64),payloadDigest:'2'.repeat(64)};
     const auth={ownerHash:'3'.repeat(64),verify:async()=>{}};
     const outcome=await j.prepare(input,auth);
     let denied;try{await j.inspect(input,{...auth,ownerHash:'4'.repeat(64)})}catch(e){denied=e.code}
     return [outcome.prepared,outcome.ambiguous,denied];
    });
    assert.deepEqual(recovered,[false,true,'SEND_EFFECT_OWNER_MISMATCH']);
    console.log(JSON.stringify({started,recovered}));
   }
   await page.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
