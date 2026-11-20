'use strict';
// QA-only bootstrap: enforce configuration before launching server.js as the
// entrypoint. Requiring server.js here does NOT start it (require.main guard).
const path=require('node:path');
const {spawn}=require('node:child_process');
const {checkQaEnvironment}=require('./preflight-qa.cjs');
try {
  checkQaEnvironment(process.env);
} catch(error) {
  process.stderr.write('QA_START_BLOCKED: '+(error.code||'PREFLIGHT_FAILED')+'\n');
  process.exit(1);
}
const root=path.resolve(__dirname,'../..');
const child=spawn(process.execPath,[path.join(root,'server.js')],{
  cwd:root, env:process.env, stdio:'inherit',
});
let childExited=false;
for(const signal of ['SIGTERM','SIGINT']){
  process.on(signal,()=>{if(!childExited)child.kill(signal);});
}
child.once('error',err=>{
  process.stderr.write('QA_SERVER_PROCESS_START_FAILED\n');
  process.exitCode=1;
});
child.once('exit',(code,signal)=>{
  childExited=true;
  process.exitCode=code===null?(signal?1:0):code;
});
