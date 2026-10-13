'use strict';
// Isolated QA-only runner. Never import the production server or expose purchase endpoints.
const http=require('node:http');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
if(process.env.ZVM_STAGING_ONLY!=='1'){console.error('STAGING_ONLY_REQUIRED');process.exit(1);}
const port=Number(process.env.PORT||10000);
if(!Number.isInteger(port)||port<1||port>65535){console.error('INVALID_PORT');process.exit(1);}
try{
  for(const file of ['tests/r46-61-cakto-checkout-binding.test.js','tests/r46-62-commercial-plan-email.test.js']){
    const output=execFileSync(process.execPath,[file],{
      cwd:path.resolve(__dirname,'..'),timeout:30000,
      env:{PATH:process.env.PATH||'',NODE_ENV:'test'},
      stdio:['ignore','pipe','pipe'],maxBuffer:60000
    });
    if(!output.includes(Buffer.from('PASS')))throw new Error('regression_gate_missing_PASS');
  }
  console.log('R46.62 stage-only isolated regressions PASS');
}catch(e){console.error('R46.62 stage-only regressions FAILED');process.exit(1);}
const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='GET'&&req.url==='/ready'){
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({status:'ready',mode:'isolated-R46.62',readOnly:true}));
    return;
  }
  res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not Found');
});
server.requestTimeout=10000;
server.headersTimeout=10000;
server.listen(port,'0.0.0.0',()=>console.log('R46.62 staging health ready'));
