'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const net = require('node:net');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const getBlock=(source,begin,end)=>{
  const i=source.indexOf(begin), j=source.indexOf(end,i+begin.length);
  assert(i>=0&&j>i, 'source boundary missing: '+begin);
  return source.slice(i,j);
};
let passed=0;
const match=/<script src="\/assets\/(zvm-admin-dashboard\.([a-f0-9]{12})\.js)" defer><\/script>/.exec(server);
assert(match);
const ui=fs.readFileSync(path.join(root,'assets',match[1]), 'utf8');
const hash=crypto.createHash('sha256').update(ui).digest('hex');
assert.equal(hash.slice(0,12),match[2]);
assert(server.includes("sha256: '"+hash+"'"));
new vm.Script(ui, {filename:match[1]});
passed++;

// Compile the exact production helpers, not an alternate testing implementation.
const storeCode=getBlock(server, 'const ADMIN_IP_BLACKLIST_LIMIT = 5000;', '\nasync function persistRateBlocks()');
const clientIpCode=getBlock(server, 'function normalizeClientIp(value)', '\nfunction getIp(req)');
const makeHelpers=new Function('net','URL','ipBlacklist','getMongoDb','zvmInvalidateMongoOnNetworkError',
  storeCode + '\n' + clientIpCode +
  '\nreturn {readAdminIpBlacklistSnapshot,mutateAdminIpBlacklistStrict,replaceIpBlacklist,normalizeClientIp};');
const makeDb=(initial,fail={})=>{
  const state={data:[...initial],reads:0,writes:0};
  const db={collection(name){
    assert.equal(name,'settings');
    return {
      async findOne(filter,opts){
        assert.equal(filter._id,'main');
        assert.equal(opts.projection.ipBlacklist,1);
        state.reads++;
        if(fail.read && (typeof fail.read==='function'?fail.read(state):true))throw Error('read disconnected');
        return {ipBlacklist:[...state.data]};
      },
      async updateOne(filter,update,opts){
        assert.equal(filter._id,'main');
        state.writes++;
        if(fail.write)throw Error('write disconnected');
        if(update.$addToSet){
          assert(!update.$set.ipBlacklist,'must never replace entire IP array');
          const ip=update.$addToSet.ipBlacklist;
          if(!state.data.includes(ip))state.data.push(ip);
        }else if(update.$pull){
          const set=new Set(update.$pull.ipBlacklist.$in);
          state.data=state.data.filter(ip=>!set.has(ip));
        }else throw Error('unexpected Mongo update');
        return {matchedCount:1, modifiedCount:1};
      }
    };
  }};
  return {db,state};
};
const make= (initial,fail={})=>{
  const local=new Set(initial),{db,state}=makeDb(initial,fail);
  const functions=makeHelpers(net,URL,local,async()=>db,()=>false);
  return {...functions, local,db,state};
};
(async()=>{
  // 1. Adding IP is atomic and publishes local cache only after confirmation.
  {
    const x=make(['203.0.113.10']);
    const result=await x.mutateAdminIpBlacklistStrict('add','203.0.113.11');
    assert(result.ips.includes('203.0.113.11'));
    assert(x.local.has('203.0.113.11'));
    assert.equal(x.state.writes,1);
    assert(x.state.reads>=2);
    passed++;
  }
  // 2. Mongo write failure leaves local enforcement unchanged, never reports OK.
  {
    const x=make(['203.0.113.10'],{write:true});
    await assert.rejects(x.mutateAdminIpBlacklistStrict('remove','203.0.113.10'), /disconnected/);
    assert(x.local.has('203.0.113.10'));
    assert.deepEqual(x.state.data,['203.0.113.10']);
    passed++;
  }
  // 3. Mongo read failure does not mutate in-memory state.
  {
    const x=make(['203.0.113.10'],{read:true});
    await assert.rejects(x.mutateAdminIpBlacklistStrict('add','203.0.113.11'), /disconnected/);
    assert.equal(x.state.writes,0);
    assert(!x.local.has('203.0.113.11'));
    passed++;
  }
  // 4. Legacy IPv4-mapped value is removed together with canonical equivalent.
  {
    const x=make(['::ffff:203.0.113.10','203.0.113.10','2001:db8::1']);
    const result=await x.mutateAdminIpBlacklistStrict('remove','203.0.113.10');
    assert.deepEqual(result.ips,['2001:db8::1']);
    assert.deepEqual(x.state.data,['2001:db8::1']);
    assert.deepEqual([...x.local],['2001:db8::1']);
    passed++;
  }
  // 5. Two unrelated writes cannot overwrite the whole list (Mongo $addToSet).
  {
    const x=make([]);
    await Promise.all([
      x.mutateAdminIpBlacklistStrict('add','203.0.113.15'),
      x.mutateAdminIpBlacklistStrict('add','203.0.113.16')
    ]);
    assert.deepEqual(x.state.data.sort(),['203.0.113.15','203.0.113.16']);
    passed++;
  }
  // 6. Duplicate already-blocked IP is idempotent, without a database write.
  {
    const x=make(['::ffff:203.0.113.17']);
    const result=await x.mutateAdminIpBlacklistStrict('add','203.0.113.17');
    assert.equal(x.state.writes,0);
    assert.deepEqual(result.ips,['203.0.113.17']);
    passed++;
  }
  // 7. Strict cap and input validation, including malformed source fields.
  {
    const x=make(['203.0.113.10']);
    await assert.rejects(x.mutateAdminIpBlacklistStrict('add','not-an-ip'), /invalid_ip/);
    await assert.rejects(x.mutateAdminIpBlacklistStrict('swap','203.0.113.10'), /invalid_ip_blacklist_operation/);
    assert.equal(x.state.writes,0);
    const many=Array.from({length:5000},(_,i)=>'2001:db8::'+(i+1).toString(16));
    const y=make(many);
    await assert.rejects(y.mutateAdminIpBlacklistStrict('add','203.0.113.18'),e=>e.code==='ip_blacklist_limit');
    assert.equal(y.state.writes,0);
    passed++;
  }
  // 8. Route guards, fail-closed DB reads, no old write-first helpers.
  {
    const routes=getBlock(server, "  if (p === R_ADMIN+'/api/ip-blacklist' && req.method === 'GET')", '\n  // ── Exportar auditoria administrativa CSV');
    assert.match(routes,/if \(!isAdminSession\(req\)\)/);
    assert.match(routes,/requireSameOriginPost\(req\)/);
    assert.match(routes,/requestedIp === normalizeClientIp\(ip\)/);
    assert.match(routes,/self_ip_block_forbidden/);
    assert.match(routes,/await mutateAdminIpBlacklistStrict\(operation, requestedIp\)/);
    assert.match(routes,/await readAdminIpBlacklistSnapshot\(\)/);
    assert.match(routes,/admin_ip_blacklist_unavailable/);
    assert.doesNotMatch(routes,/saveIpBlacklist|addIpBlacklistEntry|removeIpBlacklistEntry/);
    assert.doesNotMatch(server,/async function saveIpBlacklist\(/);
    passed++;
  }
  // 9. UI recognises lock-out prevention and DB unavailable vs key CAS.
  {
    assert.match(ui,/code==='self_ip_block_forbidden'/);
    assert.match(ui,/code==='admin_ip_blacklist_unavailable'/);
    assert.match(ui,/_adminBlacklistWriteBusy/);
    assert.match(ui,/await loadBlacklist\(\); \/\/ Somente GET/);
    passed++;
  }
  // 10. Concurrent user clicks send at most one POST and refresh by GET only.
  {
    const uiHelpers=getBlock(ui,'function adminErrorMessage(data,status)', '\nlet _adminRefreshIssued');
    const uiActions=getBlock(ui,'let _adminBlacklistReadGeneration=0', '\n// TOTP Setup');
    let resolvePost,postCount=0,getCount=0; const toasts=[];
    const tbody={innerHTML:'',textContent:'',appendChild(){}};
    const inp={value:'203.0.113.11'};
    const elements={'ip-bl-tb':tbody,'ip-bl-input':inp};
    const document={
      getElementById(id){return elements[id]||null},
      createElement(tag){return {style:{},appendChild(){},set textContent(v){this._text=v},set className(v){this._class=v}}}
    };
    const ctx=vm.createContext({
      document,fetch:async(url,opts)=>{
        if(opts?.method==='POST'){postCount++;return new Promise(resolve=>{resolvePost=resolve})}
        getCount++;return {ok:true,status:200,json:async()=>({ips:['203.0.113.11']})};
      },
      _RA:'/admin',toast:(text,ok)=>toasts.push({text,ok}),confirm:()=>true,Date,JSON,
      console:{warn(){}},setTimeout(){},clearTimeout(){}
    });
    vm.runInContext(uiHelpers+'\n'+uiActions,ctx);
    const first=vm.runInContext('addToBlacklist()',ctx);
    const second=vm.runInContext('addToBlacklist()',ctx);
    assert.equal(postCount,1);
    resolvePost({ok:true,status:200,json:async()=>({ok:true,ips:['203.0.113.11']})});
    await Promise.all([first,second]);
    assert.equal(postCount,1);
    assert.equal(getCount,1);
    assert.equal(inp.value,'');
    passed++;
  }
  console.log('R46.93 PASS: '+passed+' admin blacklist consistency/security regression groups (no production writes)');
})().catch(e=>{console.error(e);process.exitCode=1;});
