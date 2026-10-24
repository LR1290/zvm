'use strict';
const assert=require('node:assert/strict'); const fs=require('node:fs'); const crypto=require('node:crypto');
const root=require('node:path').join(__dirname,'..'); const src=fs.readFileSync(root+'/server.js','utf8');
function asset(prefix,ext,activeScript=false){const names=fs.readdirSync(root+'/assets').filter(n=>n.startsWith(prefix)&&n.endsWith(ext)).filter(n=>!activeScript||src.includes('<script src="/assets/'+n+'" defer>'));assert.equal(names.length,1,prefix); const name=names[0],data=fs.readFileSync(root+'/assets/'+name);assert.equal(name.match(/\.([0-9a-f]{12})\./)[1],crypto.createHash('sha256').update(data).digest('hex').slice(0,12));assert(src.includes('/assets/'+name));return data.toString();}
const sys=asset('zvm-r46-system.','.css');const adm=asset('zvm-admin-dashboard.','.js',true); const admCSS=asset('zvm-admin-dashboard.','.css');
assert.doesNotMatch(sys,/body>\.toast(?=[,{])/,'do not override toast position');assert.match(admCSS,/\.toast\{position:fixed/);
const row=src.slice(src.indexOf('function buildKeysHtml('),src.indexOf('function getKeysHtmlCached('));assert.doesNotMatch(row,/toggleModule\(|ZapSaver ativo|title="ZapSaver"/);
assert.doesNotMatch(adm,/async function toggleModule/);assert.match(src,/const AVAILABLE_MODULES = \['zapSaver'\]/);assert.match(src,/modules: \{ \.\.\.DEFAULT_MODULES, zapSaver: true \}/);assert.match(src,/const codeModules = extractCode/);
const privacy=src.slice(src.indexOf('function renderPrivacyPage('),src.indexOf('function renderStandaloneFaqPage('));assert.doesNotMatch(privacy,/WhatsApp: \(21\) 99677-1552/);assert.match(privacy,/Falar com suporte/);
assert.match(src,/name:\s*'\/ready — prontidão operacional \(aplicação, Mongo e Cakto\)'[\s\S]{0,200}pass:\s*rReady\.status === 200 \? true : null/);
assert.match(adm,/filter\(x=>x\.pass!==null\)/);assert.match(adm,/operationalWarnings/);
console.log('R46.35 hardening and compatibility PASS');
