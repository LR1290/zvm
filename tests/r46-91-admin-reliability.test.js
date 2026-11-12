'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const match = server.match(/<script src="\/assets\/(zvm-admin-dashboard\.([0-9a-f]{12})\.js)" defer><\/script>/);
assert(match, 'Admin must use a fingerprinted script');
const filename = match[1];
const js = fs.readFileSync(path.join(__dirname, '..', 'assets', filename), 'utf8');
const digest = crypto.createHash('sha256').update(js).digest('hex');
assert.equal(digest.slice(0, 12), match[2], 'filename must match bytes, to avoid stale immutable cache');
assert.match(server, new RegExp("sha256: '"+digest+"'"), 'server asset allowlist must pin full SHA-256');
new vm.Script(js,{filename});
let passed=0;
const segment=(start,end)=>{
  const a=js.indexOf(start),b=js.indexOf(end,a+start.length);
  assert(a>=0&&b>a,'missing code segment: '+start);
  return js.slice(a,b);
};
const helperSource=segment('function adminErrorMessage(', 'function filterKeys(');
const creationSource=segment('let _adminGeneratingKeys = false;', 'async function doRefresh(');
const refreshSource=segment('async function doRefresh(', 'setInterval(()=>');
const phonesSource=segment('let _phonesReadGeneration=0', '\nfunction openNote(');
const editsSource=segment('const _adminKeyEditsInFlight=new Set();', '\nlet _phonesReadGeneration=0');
const deferred=()=>{let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
const reply=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
const element=()=>({
  dataset:{},style:{},disabled:false,value:'',textContent:'',innerHTML:'',hidden:false,
  classList:{_set:new Set(),add(x){this._set.add(x)},remove(x){this._set.delete(x)},contains(x){return this._set.has(x)},toggle(x,yes){if(yes)this._set.add(x);else this._set.delete(x)}},
  closest(){return element()},
  setAttribute(){},
  addEventListener(){},
  querySelectorAll(){return []}
});
function harness(extra={}) {
  const elements = new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)};
  const toasts=[],calls=[],createdLinks=[];
  const doc={
    getElementById:get,
    querySelector(){return null},
    querySelectorAll(){return []},
    addEventListener(){},
    createElement(tag){const el=element();el.click=()=>{createdLinks.push({href:el.href,download:el.download})};return el},
    body:{appendChild(){},removeChild(){}},
  };
  const ctx=vm.createContext({
    document:doc, console:{warn(){},error(){}},Date,Math,JSON,Number,String,Array,encodeURIComponent,
    _RA:'/admin', toast:(m,ok)=>toasts.push({m,ok}), filterKeys(){},loadUsers(){},
    confirm:()=>true, setTimeout:fn=>fn(),clearTimeout(){},
    fetch:extra.fetch|| (async(url,options)=>{calls.push({url,options});return reply(200,{ok:true,phones:[]})})
  });
  vm.runInContext(helperSource+'\n'+creationSource+'\n'+refreshSource+'\n'+phonesSource+'\n'+editsSource,ctx,{timeout:3000});
  return {ctx,doc,get,toasts,calls,createdLinks,run:name=>vm.runInContext(name,ctx)};
}
function prepareCreation(h){
  for(const [id,value] of Object.entries({nlabel:'Lote',ndays:'30',nhours:'0',nmins:'0',nuses:'2','batch-qty':'3'}))h.get(id).value=value;
}
(async()=>{
  // 1. Concurrent modal reads must never replace the last-opened license.
  {
    const reads=[];
    const h=harness({fetch:()=>{const d=deferred();reads.push(d);return d.promise}});
    const a=h.run('openPhones')('license_a','A');
    const b=h.run('openPhones')('license_b','B');
    assert.equal(reads.length,2);
    reads[1].resolve(reply(200,{phones:['222']}));
    await b;
    reads[0].resolve(reply(200,{phones:['111']}));
    await a;
    assert.equal(h.get('phonesModal').dataset.code,'license_b');
    assert.equal(h.get('phonesModal').dataset.phones,JSON.stringify(['222']));
    assert.equal(h.get('phonesLabel').textContent,'B');
    passed++;
  }
  // 2. A closed modal must reject late responses.
  {
    const d=deferred(),h=harness({fetch:()=>d.promise});
    const pending=h.run('openPhones')('license_a','A');
    h.run('closePhones')();
    d.resolve(reply(200,{phones:['111']}));
    await pending;
    assert.equal(h.get('phonesModal').dataset.phones,'[]');
    passed++;
  }
  // 3. Device GET failure cannot be presented as an empty list.
  {
    const h=harness({fetch:async()=>reply(503,{error:'db_unavailable'})});
    await h.run('openPhones')('license_a','A');
    assert.match(h.get('phonesList').textContent,/Falha ao carregar/);
    assert.equal(h.get('removeAllBtn').style.display,'none');
    passed++;
  }
  // 4. Double-click on single-number removal must make one DELETE only.
  {
    const d=deferred(),calls=[];
    const h=harness({fetch:(url,options)=>{
      calls.push({url,options});
      if(options&&options.method==='DELETE')return d.promise;
      return Promise.resolve(reply(200,{phones:['111','222']}));
    }});
    await h.run('openPhones')('license_a','A');
    const first=h.run('removePhone')({dataset:{idx:'0'}});
    const second=h.run('removePhone')({dataset:{idx:'0'}});
    assert.equal(calls.filter(c=>c.options?.method==='DELETE').length,1);
    assert.equal(h.get('phonesModal').classList.contains('open'),true);
    d.resolve(reply(200,{ok:true}));
    await Promise.all([first,second]);
    assert.equal(h.get('phonesModal').classList.contains('open'),false);
    passed++;
  }
  // 5. Lost confirmation must not auto-repeat DELETE; read-only reconciliation is safe.
  {
    let deletes=0,gets=0;
    const h=harness({fetch:async(_url,options)=>{
      if(options?.method==='DELETE'){deletes++;throw new Error('socket drop');}
      gets++;return reply(200,{phones:['111']});
    }});
    await h.run('openPhones')('license_a','A');
    await h.run('removePhone')({dataset:{idx:'0'}});
    assert.equal(deletes,1);
    assert.equal(gets,2);
    assert(h.toasts.some(x=>x.m.includes('Sem confirmação do servidor')));
    passed++;
  }
  // 6. All-device deletion must refuse empty lists and not issue destructive calls.
  {
    let deletes=0;
    const h=harness({fetch:async(_url,options)=>{
      if(options?.method==='DELETE')deletes++;
      return reply(200,{phones:[]});
    }});
    await h.run('openPhones')('license_a','A');
    await h.run('removeAllPhones')();
    assert.equal(deletes,0);
    passed++;
  }
  // 7. Partial batch with unknown result must preserve form and report only confirmed keys.
  {
    let creates=0;
    const h=harness({fetch:async(_url,options)=>{
      if(options?.method==='POST'){
        creates++;
        if(creates===1)return reply(200,{ok:true,key:'ZVM-ONE'});
        throw new Error('timeout after server may have committed');
      }
      return reply(200,{totalKeys:5,activeKeys:5,totalLogs:0,warnKeys:0,keysHtml:'ok',logsHtml:''});
    }});
    prepareCreation(h);
    await h.run('generateKey')();
    assert.equal(creates,2);
    assert.equal(h.get('nlabel').value,'Lote');
    assert.equal(h.get('admin-generate-key-btn').disabled,false);
    assert.match(h.get('admin-create-status').textContent,/1 de 3 chave/);
    assert.match(h.get('admin-create-status').textContent,/pode ter sido gravada/);
    assert.equal(h.createdLinks.length,1);
    const text=decodeURIComponent(h.createdLinks[0].href.split(',').slice(1).join(','));
    assert(text.includes('ZVM-ONE'));
    assert(!text.includes('ZVM-TWO'));
    passed++;
  }
  // 8. Validate batch count and max-uses before hitting the server.
  {
    const h=harness();prepareCreation(h);
    h.get('batch-qty').value='51';
    await h.run('generateKey')();
    assert.equal(h.calls.length,0);
    h.get('batch-qty').value='1';h.get('nuses').value='2junk';
    await h.run('generateKey')();
    assert.equal(h.calls.length,0);
    passed++;
  }
  // 9. Out-of-order successful refresh cannot replace a newer snapshot.
  {
    const a=deferred(),b=deferred(),reads=[];
    const h=harness({fetch:(_url,options)=>{const d=reads.length===0?a:b;reads.push(d);return d.promise}});
    const first=h.run('doRefresh')(false),second=h.run('doRefresh')(false);
    b.resolve(reply(200,{totalKeys:99,activeKeys:99,totalLogs:0,warnKeys:0,keysHtml:'new',logsHtml:'new'}));
    await second;
    a.resolve(reply(200,{totalKeys:1,activeKeys:1,totalLogs:0,warnKeys:0,keysHtml:'old',logsHtml:'old'}));
    await first;
    assert.equal(h.get('kb').innerHTML,'new');
    assert.equal(h.get('s-total').textContent,99);
    passed++;
  }
  // 10. Read failure keeps previous data and shows an accessible stale indicator.
  {
    const h=harness({fetch:async()=>reply(503,{error:'admin_data_unavailable'})});
    h.get('kb').innerHTML='previous-confirmed';
    await h.run('doRefresh')(false);
    assert.equal(h.get('kb').innerHTML,'previous-confirmed');
    assert.equal(h.get('last-refresh').dataset.stale,'1');
    assert.match(h.get('last-refresh').textContent,/não atualizados/);
    passed++;
  }
  // 11. Edit actions include duplicate guards and a network-failure reconciliation path.
  assert.match(js,/_adminKeyEditsInFlight\.has\(lock\)/);
  assert.match(js,/function saveRename\(\)/);
  assert.match(js,/function saveEditUses\(\)/);
  assert.match(js,/function saveNote\(\)/);
  assert.match(js,/function adminJsonRequest\(/);
  passed++;
  console.log('R46.91 PASS: '+passed+' admin reliability integration/contract groups + fingerprint integrity');
})().catch(e=>{console.error(e);process.exitCode=1;});