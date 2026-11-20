const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
  try {
    const page=await browser.newPage({offline:true});
    const src=fs.readFileSync(path.join(process.argv[2],'app/dashboard/features/library/items.js'),'utf8');
    const render=src.slice(src.indexOf('async function renderGrid('),src.indexOf('function editLibraryUniversalTrigger'));
    const result=await page.evaluate(async render=>{
      const libraryRenderGeneration=1,activeKind='message',libraryGridRequests=new WeakMap(),
        libraryGridSnapshots=new WeakMap(),libraryGridSelectedItems=new WeakMap(),librarySelectionByKind={},
        libraryScrollByKind={},libraryFavoritesByKind={},sectionCountEl=null,libraryFavoritesBtnEl=null,pageRootEl=null,
        libraryPreviewStudio=null,renderLibrarySelectionPreview=()=>{};
      let libraryPreviewSelectedId='',searchTerm='',count=0;
      const list=Array.from({length:5000},(_,i)=>({id:String(i),name:'item '+i}));
      const loadList=async()=>list;
      const el=(tag,attrs)=>Object.assign(document.createElement(tag),{className:attrs.class});
      const renderCard=item=>{
        count++;
        const row=el('div',{class:'extuiItensRow'});
        row.dataset.itemId=item.id;
        for(let n=0;n<12;n++)row.append(document.createElement('span'));
        return row;
      };
      const grid=eval('('+render+')'), host=document.body;
      let interruptedAt;
      const replacement=new Promise(resolve=>setTimeout(()=>{
        interruptedAt=count;searchTerm='item 4999';resolve(grid(host,1,activeKind,true));
      },0));
      await Promise.all([grid(host),replacement]);
      return {interruptedAt,rows:host.querySelectorAll('.extuiItensRow').length,selected:libraryPreviewSelectedId};
    },render);
    console.log(JSON.stringify(result));
    assert(result.interruptedAt>0 && result.interruptedAt<5000 && result.rows===1 && result.selected==='4999');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
