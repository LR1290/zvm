const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async()=>{
  const source=fs.readFileSync(path.join(process.argv[2],'app/shared/core/session.js'),'utf8');
  const activate=source.slice(source.indexOf('async function _h('),source.indexOf('async function _i('));
  for(const boundary of ['phone','response','storage']){
    let unblock,started,live=true,rpc=0;
    const waiting=new Promise(r=>{started=r});
    const pause=()=>new Promise(resolve=>{unblock=resolve;started()});
    const ctx={_6:'new session',_0:'pub',_1:100,_a(){},_9:{},
      _b:async key=>key==='pub'?pause():boundary==='phone'?null:'123',
      _g:pause,_e:async()=>{rpc++;return boundary==='response'?pause():{}},
      _evaluateLicenseExpiry:async()=>{},_q(){}};
    vm.createContext(ctx);vm.runInContext(activate,ctx);
    const pending=ctx._h('synthetic',()=>live);
    await waiting;live=false;unblock(boundary==='response'?{license:'old session'}:'old');
    const result=await pending;
    assert.equal(result.ok,false);assert.equal(ctx._6,'new session');assert.equal(rpc,boundary==='phone'?0:1);
    console.log(boundary,'PASS',rpc);
  }
})().catch(err=>{console.error(err);process.exitCode=1});
