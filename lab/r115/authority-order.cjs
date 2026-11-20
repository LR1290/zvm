const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
async function check(tree, name, args) {
  const source = fs.readFileSync(path.join(tree,'app/background/authority/license-authority.js'),'utf8');
  const lines = source.split('\n');
  let release, checks = 0, opaqueCalls = 0;
  const ctx = {extIntegrityRequire:() => ++checks===1 ? new Promise(r => {release=r;}) : Promise.resolve(),
    _s0u:Promise.resolve(), _s0uRequire(){}, extError:code=>Object.assign(new Error(code),{code}),
    self:{}, args};
  function reached() { opaqueCalls++; throw Error('opaque reached'); }
  ctx.self.extuiOpaqueV4LoginKey = ctx.self.extuiOpaqueV4LoginAccount = reached;
  vm.createContext(ctx);
  vm.runInContext(lines.filter(line=>line.startsWith('var extLicenseOperationRevision') ||
    line.startsWith('function extLicenseBeginOperation') || line.startsWith('function extLicenseAssertOperation') ||
    line.startsWith('async function '+name+'(')).join('\n'),ctx);
  const invoke = () => ctx[name](...args).catch(error=>error.message);
  const first = invoke();
  await invoke();
  release();
  return {name,stale:await first,opaqueCalls};
}
(async()=>{
  for(const [i,tree] of process.argv.slice(2).entries()) {
    for(const [name,args] of [['_s0D',['test']],['extAccountV4Login',['qa@example.invalid','fixture','']]]) {
      const result = await check(tree,name,args);
      console.log(path.basename(tree),JSON.stringify(result));
      assert.equal(result.opaqueCalls,i===0?2:1);
      if(i)assert.equal(result.stale,'LICENSE_OPERATION_SUPERSEDED');
    }
  }
})().catch(e=>{console.error(e);process.exitCode=1});
