const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH});
  try {
    const page = await browser.newPage({offline:true});
    for (const file of ['shared/core/store-envelope','shared/core/backup-migration-core','background/authority/offscreen-options-data']) {
      await page.addScriptTag({path:path.join(process.argv[2],'app',file+'.js')});
    }
    const results = await page.evaluate(async () => {
      const store = new Map(), results = {};
      let account='a', interrupt=false, onWrite;
      window.extError=(code,message)=>Object.assign(new Error(message),{code});
      window.extIntegrityRequire=async()=>{};
      window.extSenderCanRuntime=()=>true;
      window.ExtensionStorage={
        accountScopeId:async()=>account,
        get:async key=>store.get(key),
        set:async (key,value)=>store.set(key,value),
        setMany:async (values,options={})=>{
          if(interrupt)account='b';
          if(onWrite)onWrite();
          if(options.expectedAccountScopeId!==undefined && options.expectedAccountScopeId!==account)throw extError('ACCOUNT_SCOPE_CHANGED');
          for(const [key,value] of Object.entries(options.expectedValues||{})){
            if(store.get(key)!==value)throw extError('CONFLICT');
          }
          for(const [key,value] of Object.entries(values))store.set(key,value);
        }
      };
      const send=(scope,action,payload)=>new Promise(resolve=>__extDataMutationDispatch({type:'EXTUI_DATA_MUTATE',scope,action,payload},{},resolve));
      const text='x'.repeat(20000);
      const key='EXTUI:textMessageStore';
      let res=await send('library','upsert',{kind:'message',item:{id:'one',body:text}});
      results.upsert=res.ok && JSON.parse(store.get(key)).state.textMessageList[0].body===text;
      store.set(key,JSON.stringify({state:{textMessageList:[{id:'one',body:text}]}}));
      res=await send('library','set_favorite',{kind:'message',id:'one',expectedRevision:0,favorite:true});
      results.favorite=res.ok && JSON.parse(store.get(key)).state.textMessageList[0].body===text;
      for(const [scope,action,payload] of [
        ['library','set_favorite',{kind:'message',id:'one',expectedRevision:1,favorite:false}],
        ['crm_funnel_prefs','patch',{patch:{legend:false}}],
        ['crm_copilot_preferences','patch',{patch:{assistantId:'qa'}}]
      ]){
        account='a';interrupt=true;
        const before=JSON.stringify([...store]);
        res=await send(scope,action,payload);
        results[scope]=res.errorCode==='ACCOUNT_SCOPE_CHANGED' && before===JSON.stringify([...store]);
      }
      interrupt=false;account='a';
      const concurrent=JSON.stringify({state:{textMessageList:[{id:'external'}]}});
      onWrite=()=>store.set(key,concurrent);
      res=await send('library','upsert',{kind:'message',item:{id:'new'}});
      results.concurrent=res.errorCode==='CONFLICT' && store.get(key)===concurrent;
      onWrite=null;
      const contentRef='EXTUI:trashPayload:fixture01';
      store.set(contentRef,'backup-content');
      store.set('restored','other-content');
      const request={kind:'message',contentRef,item:{id:'restored'}};
      res=await send('library','trash_restore',request);
      results.collision=res.errorCode==='LIBRARY_CONTENT_CONFLICT' && store.get('restored')==='other-content';
      store.delete('restored');
      store.set(key,concurrent);
      res=await send('library','trash_restore',request);
      results.restore=res.ok && store.get('restored')==='backup-content';
      window.__extStorageSchema={describe:()=>({codec:'zustand-json'})};
      const api=__extCreateBackupMigrationService(window,{});
      const envelope=ids=>({state:{textMessageList:ids.map(id=>({id}))}});
      for(const side of ['local','incoming']){
        try {
          api.mergeValue(envelope(side==='local'?['a','a']:['x']),envelope(side==='incoming'?['b','b']:['x']),key);
          results[side]=false;
        } catch(e){results[side]=e.code==='BACKUP_MERGE_DUPLICATE_ID';}
      }
      results.merge=api.mergeValue(envelope(['a','b']),envelope(['b','c']),key).state.textMessageList.map(x=>x.id).join()==='a,b,c';
      return results;
    });
    console.log(JSON.stringify(results));
    assert(Object.values(results).every(Boolean));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
