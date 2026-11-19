'use strict';
// R47.10 isolated security regression; never accesses live services or client records.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'server.js'),'utf8');
const name=(source.match(/<script src="\/assets\/(zvm-admin-dashboard\.[a-f0-9]{12}\.js)" defer><\/script>/)||[])[1];
assert(name,'versioned Admin script');
const js=fs.readFileSync(path.join(root,'assets',name),'utf8');
const sha=crypto.createHash('sha256').update(js).digest('hex');
assert(name.includes(sha.slice(0,12)),'asset URL pinned by digest');
assert(source.includes("sha256: '"+sha+"'"),'allowlist SHA matches bytes');
new vm.Script(js,{filename:name});

const first=source.indexOf('function buildKeysHtml('),last=source.indexOf('function getKeysHtmlCached(',first);
const block=source.slice(first,last);
const escHtml=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\x60/g,'&#96;');
const fakeDeps={keys:{},logs:[],isKeyExpired:()=>false,isKeyExpiringSoon:()=>false,
 getSuspectMeta:()=>({isSuspect:false,recentIpCount:0}),escHtml,
 getKeyDisplayStatus:()=>'ativo',getKeyValiditySortKey:()=>12345,
 renderKeyStatusBadge:()=>'<span>ATIVO</span>',formatValidityCell:()=>'<span>32 dias</span>',
 renderTrackingChips:()=>'<span>Venda</span>',fmtShortDate:()=>'-',MAX_USES:3};
const render=new Function('deps','with(deps){'+block+'return buildKeysHtml;}')(fakeDeps);
const label="');window.bad=true;//";
const html=render({'qa-key':{label,phones:['123'],active:true,maxUses:3,expiresAt:'2026-12-20T00:00:00.000Z'}});
assert(html.includes('data-client-name="'+escHtml(label)+'"'));
assert.equal((html.match(/ on(?:click|change)="[^"]*"/g)||[]).length,0,'no inline handlers in key list');
for(const action of ['renew','uses','more','toggle','rename','phones','dev-toggle','delete','details'])
 assert(html.includes('data-zvm-key-action="'+action+'"'),'missing action '+action);
const sl=js.indexOf('const _zvmLicenseActions='),el=js.indexOf("document.addEventListener('toggle',",sl);
assert(sl>=0&&el>sl,'delegation implementation');
const calls=[],listeners={};
const actions={
 document:{addEventListener(name,fn){(listeners[name]??=[]).push(fn)}},
 openRenew:(...a)=>calls.push(['renew',...a]),
 openEditUses:(...a)=>calls.push(['uses',...a]),
 toggleKeyActionMenu:()=>calls.push(['more']),
 toggleKey:(...a)=>calls.push(['toggle',...a]),
 openRename:(...a)=>calls.push(['rename',...a]),
 openPhones:(...a)=>calls.push(['phones',...a]),
 deleteKey:(...a)=>calls.push(['delete',...a]),
 clearSuspect:(...a)=>calls.push(['suspect',...a]),
 toggleKeyDetails:()=>calls.push(['details']),
 toggleDevAccess:(...a)=>calls.push(['dev',...a])
};
const dispatcher=new Function('deps','with(deps){'+js.slice(sl,el)+'return _zvmLicenseActions;}')(actions);
const row={dataset:{code:'qa-key',clientName:label,maxUses:'3'}};
const button={dataset:{zvmKeyAction:'renew'},nextElementSibling:{hidden:true},
 closest(sel){if(sel==='[data-zvm-key-action]')return this;if(sel==='.keys-table')return {};if(sel==='tr.key-record')return row;return null}};
const click=listeners.click[0],change=listeners.change[0];
assert(click&&change,'delegated listeners installed');
for(const key of ['renew','uses','more','toggle','rename','phones','delete','clear-suspect','details']){
 button.dataset.zvmKeyAction=key;click({target:button});
}
const input={checked:true,matches:sel=>sel==='input[data-zvm-key-action="dev-toggle"]',closest:()=>row};
change({target:input});
assert.equal(calls.length,10);
assert.deepEqual(calls[0],['renew','qa-key',label]);
assert.deepEqual(calls[1],['uses','qa-key',label,3]);
assert.deepEqual(calls[2],['more']);
assert.deepEqual(calls[9],['dev','qa-key',true,input]);
assert.equal(button.nextElementSibling.hidden,false);
assert(Object.isFrozen(dispatcher),'dispatch table is fixed');

const secStart=source.indexOf('const _CSP_LEGACY_HTML = '),secEnd=source.indexOf('const _SEC_HEADERS =',secStart);
assert(secStart>0&&secEnd>secStart);
const csp=new Function(source.slice(secStart,secEnd)+'return {_CSP_LEGACY_HTML,_CSP_NO_INLINE_RESPONSE,_CSP_PRIVILEGED_SCRIPT_STRICT};')();
assert(csp._CSP_LEGACY_HTML.includes("'unsafe-inline'"));
assert(!csp._CSP_NO_INLINE_RESPONSE.includes("'unsafe-inline'"));
const sh=source.indexOf('function sendHtml('),se=source.indexOf('function sendAuthHtml(',sh);
assert(sh>0&&se>sh);
const deps={
 applyOwnerSiteTheme:x=>x,applyCanonicalFavicon:x=>x,Buffer,URL,
 _SEC_HEADERS:{'Content-Security-Policy':csp._CSP_NO_INLINE_RESPONSE},
 _CSP_LEGACY_HTML:csp._CSP_LEGACY_HTML,
 _CSP_PRIVILEGED_SCRIPT_STRICT:csp._CSP_PRIVILEGED_SCRIPT_STRICT,
 _CSP_AUTH_STRICT:"default-src 'self'; script-src 'self'; style-src 'self'",
 R_ADMIN:'/qa-admin',R_ANALYTICS:'/qa-analytics',
 _appendVary(){},_compressedSend(){throw Error('unexpected compression')}
};
const sendHtml=new Function('deps','with(deps){'+source.slice(sh,se)+'return sendHtml;}')(deps);
function response(url){
 const headers={};
 return {req:{url,headers:{}},headers,
 setHeader(k,v){headers[k]=v},getHeader(k){return headers[k]},
 writeHead(status){this.status=status},end(b){this.data=b}};
}
for(const path of ['/qa-admin','/qa-analytics','/other']){
 const r=response(path);sendHtml(r,'<html></html>');
 assert.equal(r.status,200);
 assert(r.headers['Content-Security-Policy'].includes("'unsafe-inline'"),'CSS remains compatible');
 if(path==='/qa-admin'||path==='/qa-analytics'){
   const directives=r.headers['Content-Security-Policy'].split(';').map(x=>x.trim());
   assert.equal(directives.find(x=>x.startsWith('script-src')),"script-src 'self'",'Privileged scripts must not execute inline');
 }
 assert.equal(!!r.headers['Content-Security-Policy-Report-Only'],path!=='/other','CSP telemetry scoped to privileged pages');
}
assert.equal(new Set(JSON.parse(fs.readFileSync(root+'/package.json','utf8')).scripts.check.split(' && ')).size,
 JSON.parse(fs.readFileSync(root+'/package.json','utf8')).scripts.check.split(' && ').length,'no duplicate CI commands');
console.log('R47.10 PASS: 10 delegated actions, stored XSS fixtures, strict non-HTML CSP, scoped report-only, deduplicated check');
