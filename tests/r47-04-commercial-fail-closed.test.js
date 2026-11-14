'use strict';
// R47.04: production-safe defaults and truthful FAQ under five independent Node env modes.
// No network, no real customers, no payment or license mutations.
const assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs'),child=require('node:child_process');
const root=path.resolve(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
assert.match(server,/const ZVM_SALES_PAUSED = !\/\^\(0\|false\|no\|off\)\$\/i\.test\(/,
 'sales must fail closed unless explicitly reopened');
assert(server.includes("if (p === '/cakto/webhook' && req.method === 'POST')"),
 'delivery webhook for previously paid purchases must remain available');
const probe="'use strict';\nconst Module=require('node:module');\nconst original=Module._load;\nprocess.env.RENDER='true';\nprocess.env.ADMIN_USER='r4704-commercial-qa';\nprocess.env.ADMIN_PASS='offline-only-not-real';\nprocess.env.MONGODB_URI='mongodb://127.0.0.1:27017/zvm_r4704_commercial_qa';\ntry{\n Module._load=function(id,...rest){if(id==='mongodb')return{MongoClient:class OfflineMongo{}};return original.call(this,id,...rest)};\n const api=require('./server.js').__test;\n const guest=api.renderPlanosPage(null),home=api.renderStandaloneLandingPage(null),faq=api.renderStandaloneFaqPage(null);\n const {localizePublicHtml}=require('./src/web/public/i18n');\n const en=localizePublicHtml(faq,'en',{path:'/faq'}),pt=localizePublicHtml(faq,'pt-PT',{path:'/faq'});\n console.log('R4704_COMMERCIAL='+JSON.stringify({\n  buy:guest.includes('data-buy-plan='),\n  provider:guest.includes('https://pay.cakto.com.br/'),\n  pause:guest.includes('Vendas temporariamente suspensas'),\n  homePaused:home.includes('Vendas temporariamente suspensas'),\n  faqPaused:faq.includes('Quando as compras forem reabertas'),\n  faqGuest:faq.includes('sem criar uma conta'),\n  faqNoFalseClaim:!faq.includes('Sim. Use o mesmo e-mail cadastrado na sua conta ZVM'),\n  englishPaused:en.includes('Once sales reopen'),\n  englishGuest:en.includes('without creating an account'),\n  portuguesePaused:pt.includes('Quando as compras reabrirem'),\n  portugueseGuest:pt.includes('sem criar uma conta')\n }));\n}finally{Module._load=original}";

const cases=[
 {name:'missing env',value:null,open:false},
 {name:'explicit pause',value:'1',open:false},
 {name:'unrecognized env',value:'unexpected',open:false},
 {name:'explicit reopen',value:'0',open:true},
 {name:'explicit false',value:'false',open:true}
];
for(const c of cases){
 const env={...process.env};
 if(c.value===null)delete env.ZVM_SALES_PAUSED;else env.ZVM_SALES_PAUSED=c.value;
 const p=child.spawnSync(process.execPath,['-e',probe],{
   cwd:root,env,encoding:'utf8',maxBuffer:3*1024*1024,timeout:20000
 });
 assert.equal(p.status,0,c.name+' process failed: '+(p.stderr||p.stdout||p.error));
 const line=(p.stdout||'').split('\n').find(x=>x.startsWith('R4704_COMMERCIAL='));
 assert(line,c.name+' missing offline probe: '+p.stdout);
 const info=JSON.parse(line.slice('R4704_COMMERCIAL='.length));
 assert.equal(info.buy,c.open,c.name+' checkout state');
 if(!c.open)assert.equal(info.provider,false,c.name+' direct payment provider leaked');
 assert.equal(info.pause,!c.open,c.name+' public plans banner');
 assert.equal(info.homePaused,!c.open,c.name+' home banner');
 assert.equal(info.faqPaused,!c.open,c.name+' truthful FAQ commercial state');
 assert(info.faqGuest&&info.faqNoFalseClaim&&info.englishGuest&&info.portugueseGuest,
  c.name+' account-free checkout FAQ mismatch: '+JSON.stringify(info));
 assert.equal(info.englishPaused,!c.open,c.name+' English translation');
 assert.equal(info.portuguesePaused,!c.open,c.name+' PT-PT translation');
}
console.log('R47.04 COMMERCIAL PASS: 5 independent env states, guest checkout FAQ and existing webhook');
