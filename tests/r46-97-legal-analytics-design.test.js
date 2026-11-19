'use strict';
// R46.97: offline contracts, no external access, payments, emails or privileged side effects.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Module=require('node:module');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'server.js'),'utf8');
for(const type of ['legal','analytics']){
 const m=source.match(new RegExp('zvm-'+type+'-premium\\.([a-f0-9]{12})\\.css'));
 assert(m,'missing versioned '+type+' style');
 const name='zvm-'+type+'-premium.'+m[1]+'.css';
 const css=fs.readFileSync(path.join(root,'assets',name),'utf8');
 const hash=crypto.createHash('sha256').update(css).digest('hex');
 assert.equal(hash.slice(0,12),m[1],type+' fingerprint mismatch');
 assert(source.includes("sha256: '"+hash+"'"),type+' full SHA not registered');
 assert(!css.includes('!important'),'new '+type+' CSS has specificity debt');
 assert(css.includes('prefers-reduced-motion:reduce'));
}
process.env.RENDER='true';
process.env.ADMIN_USER='zvm-r4697-fixture';
process.env.ADMIN_PASS='test-password-only';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/zvm_r4697_offline';
const saved=Module._load;let api;
try{
 Module._load=function(id,...rest){
  if(id==='mongodb')return {MongoClient:class OfflineOnlyFixture{}};
  return saved.call(this,id,...rest);
 };
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=saved}
const pt=api.renderStandalonePrivacyPage(null);
const legalNames=['pt-BR','pt-PT','en'];
const terms=legalNames.map(locale=>[locale,api.renderStandaloneTermsPage(null,locale)]);
const err404=api.renderStandalone404Page(null);
const err500=api.renderStandalone500Page(null);
assert(pt.includes('class="zvm-public-premium zvm-legal-premium zvm-privacy-premium"'));
assert(pt.includes('<main id="main-content" class="zvm-privacy-main">'),'Privacy skip link target must be semantic');
assert.equal((pt.match(/id="main-content"/g)||[]).length,1,'Privacy has duplicate main IDs');
const standaloneLinks=[...pt.matchAll(/href="\\/assets\\/(zvm-standalone\\.[a-f0-9]{12}\\.css)"/g)].map(m=>m[1]);
assert.equal(standaloneLinks.length,1,'Privacy must load precisely one current standalone stylesheet');
const standaloneBytes=fs.readFileSync(path.join(root,'assets',standaloneLinks[0]));
const standaloneDigest=crypto.createHash('sha256').update(standaloneBytes).digest('hex');
assert.equal(standaloneLinks[0].split('.')[1],standaloneDigest.slice(0,12),'Privacy standalone asset hash matches its bytes');
assert(source.includes("sha256: '"+standaloneDigest+"'"),'privacy standalone CSS is pinned by the server');
for(const phrase of ['Lei Geral de Proteção de Dados','Cookies e rastreamento','Não vendemos dados pessoais']){
 assert(pt.includes(phrase),'Privacy text changed or lost '+phrase);
}
assert(pt.includes('r466-footer'),'Shared footer must be preserved');
for(const [lang,html] of terms){
 assert(html.includes('<html lang="'+lang+'"'),'Terms locale not preserved '+lang);
 assert(html.includes('class="zvm-terms-page zvm-public-premium zvm-legal-premium"'));
 assert(html.includes('<main id="main-content" class="terms-main">'));
 assert(html.includes('class="terms-toc"'),'Terms navigation index missing');
 assert(html.includes('hreflang="pt-BR"')&&html.includes('hreflang="en"'));
 assert(html.includes('r466-footer'),'Terms shared footer missing');
}
for(const [label,html] of [['404',err404],['500',err500]]){
 assert(html.includes('<main id="main-content" class="err-wrap zvm-trust-error'),label+' semantic main missing');
 assert(html.includes('zvm-error-premium'),label+' missing page style');
 assert(html.includes('href="/"'),label+' cannot recover to home');
 assert(html.includes('r466-footer'),label+' missing shared footer');
}
assert(err404.includes('href="/cliente"'),'404 portal recovery link lost');
assert(!api.renderStandalonePortalLogin().includes('zvm-legal-premium'),'Auth must remain isolated');
const fixture={stats:{total:0,revenueTotal:0,revenueLast30:0,byDay:[],byProduct:[],byMethod:[],byHour:[],topClients:[],retentionRate:0,uniqueClients:0},payments:[]};
(async()=>{
 const html=await api.renderAnalyticsDashboard(fixture);
 assert(html.includes('<body class="zvm-analytics-premium">'),'Analytics style not scoped');
 assert(html.includes('analytics-shell'),'Analytics workspace missing');
 assert(html.includes('class="analytics-rail"'),'Analytics navigation missing');
 assert(html.includes('id="purge-dialog"'),'Protected purge confirmation must remain');
 assert(html.includes('id="lab-sec"'),'Sandbox lab must remain');
 assert(html.includes('Nenhuma venda registrada'),'Zero-sales state should be safe');
 assert(!html.includes('zvm-legal-premium'),'Analytics is not public legal page');
 console.log('R46.97 PASS: 7 page renderers, CSS SHA-256, legal text/locales, semantic main, safe Analytics fixture and route contracts');
})().catch(e=>{console.error(e);process.exitCode=1});
