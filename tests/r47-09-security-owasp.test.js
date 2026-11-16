'use strict';
// R47.09 — offline security regression. No network or production license writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),src=fs.readFileSync(path.join(root,'server.js'),'utf8');
const start=src.indexOf('function buildKeysHtml('),stop=src.indexOf('function getKeysHtmlCached(',start);
assert(start>0&&stop>start,'renderer boundaries');
const escHtml=value=>String(value||'')
 .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
 .replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\x60/g,'&#96;');
const deps={keys:{},logs:[],isKeyExpired:()=>false,isKeyExpiringSoon:()=>false,
 getSuspectMeta:()=>({isSuspect:false,recentIpCount:0}),getKeyDisplayStatus:()=>'ativo',
 getKeyValiditySortKey:()=>12345,escHtml,fmtShortDate:()=>'-',MAX_USES:3,
 renderKeyStatusBadge:()=>'<b>ATIVO</b>',formatValidityCell:()=>'<small>32 dias</small>',
 renderTrackingChips:()=>'<span>Venda</span>'};
const build=new Function('deps','with(deps){'+src.slice(start,stop)+'return buildKeysHtml;}')(deps);
const maliciousName="');window.__xss_from_label=true;// <img src=x onerror=alert(1)> \"";
const maliciousCreated='" onmouseover="alert(2)';
const item={label:maliciousName,active:true,phones:['5511999000000'],maxUses:3,
 note:maliciousName,createdAt:maliciousCreated,expiresAt:'2026-12-25T00:00:00.000Z'};
const html=build({'zv-qa-key':item});
assert(html.includes('data-client-name="'+escHtml(maliciousName)+'"'));
assert(html.includes('data-created="'+escHtml(maliciousCreated)+'"'));
assert(!html.includes('onmouseover="alert(2)"'));
assert(!html.includes('<img src=x onerror=alert(1)>'));
assert(html.includes('data-max-uses="3"')&&html.includes('class="key-actions-popover"'));
const handlers=[...html.matchAll(/ on(?:click|change)="([^"]*)"/g)].map(m=>m[1]);
assert.equal(handlers.length,0,'license table must not emit executable HTML event handlers');
for(const action of ['renew','uses','more','toggle','rename','phones','dev-toggle','delete','details'])
 assert(html.includes('data-zvm-key-action="'+action+'"'),'missing delegated action '+action);
const suspectDeps={...deps,getSuspectMeta:()=>({isSuspect:true,recentIpCount:2})};
const suspectHtml=new Function('deps','with(deps){'+src.slice(start,stop)+'return buildKeysHtml;}')(suspectDeps)({'zv-qa-key':item});
assert(suspectHtml.includes('data-zvm-key-action="clear-suspect"'),'suspect action must be delegated');
assert(html.includes('data-client-name="'+escHtml(maliciousName)+'"'));
assert.equal((html.match(/<td\b/g)||[]).length,12);
assert.equal((html.match(/<\/td>/g)||[]).length,12);
const a=src.indexOf('function requireSameOriginPost('),b=src.indexOf('function isAnalyticsSession(',a);
assert(a>0&&b>a);
const guard=new Function(src.slice(a,b)+';return requireSameOriginPost;')();
const origins=[
 [{host:'zvm.onrender.com',origin:'https://zvm.onrender.com','sec-fetch-site':'same-origin'},true],
 [{host:'zvm.onrender.com',origin:'https://evil.example','sec-fetch-site':'same-origin'},false],
 [{host:'zvm.onrender.com',origin:'https://zvm.onrender.com','sec-fetch-site':'cross-site'},false],
 [{host:'zvm.onrender.com',referer:'https://zvm.onrender.com/admin','sec-fetch-site':'none'},true],
 [{host:'zvm.onrender.com',origin:'http://zvm.onrender.com','sec-fetch-site':'same-origin'},false],
 [{host:'localhost:3000',origin:'http://localhost:3000','sec-fetch-site':'same-origin'},true],
 [{host:'zvm.onrender.com'},false],
 [{host:'zvm.onrender.com','sec-fetch-site':'same-origin'},true],
 [{host:'zvm.onrender.com',origin:'null','sec-fetch-site':'same-origin'},false]
];
for(const [headers,expected] of origins)assert.equal(guard({headers}),expected,JSON.stringify(headers));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
const engine='>=24.22.3 <25 || >=26.13.1 <27';
assert.equal(pkg.engines.node,engine);
assert.equal(lock.packages[''].engines.node,engine);
assert(fs.readFileSync(path.join(root,'Dockerfile'),'utf8').startsWith('FROM node:24.22.3-alpine'));
const workflow=fs.readFileSync(path.join(root,'.github/workflows/security-audit.yml'),'utf8');
assert.equal((workflow.match(/node-version: '24.22.3'/g)||[]).length,3);
console.log('R47.09 PASS: inert HTML data, no dynamic JS handlers, 9 CSRF fixtures, secure Node LTS version floors');
