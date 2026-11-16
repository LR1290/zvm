'use strict';
// R47.11 full Admin HTML contract; offline, with fake licenses and no live database calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Module=require('node:module');
const root=path.resolve(__dirname,'..'),src=fs.readFileSync(path.join(root,'server.js'),'utf8');
process.env.RENDER='true';process.env.NODE_ENV='test';
process.env.ADMIN_USER='r4711-fake-admin';process.env.ADMIN_PASS='fake-not-live';
process.env.MONGODB_URI='mongodb://127.0.0.1:1/offline-test';
const original=Module._load;let api;
try{
 Module._load=function(id,...args){if(id==='mongodb')return{MongoClient:class FakeMongo{}};return original.call(this,id,...args)};
 api=require(path.join(root,'server.js')).__test;
}finally{Module._load=original;}
assert.equal(typeof api.renderAdminDashboard,'function');
const key='zv-qa-ficticia',label="');window.adminXss=true;//";
const sample={label,active:true,maxUses:3,phones:['5511999888000'],
 createdAt:'2026-11-01T00:00:00.000Z',
 expiresAt:'2026-12-30T00:00:00.000Z'};
const html=api.renderAdminDashboard({keysSnapshot:{[key]:sample},portalUsers:[],portalUserCount:0});
assert(html.includes('class="zvm-admin-r6"'),'Admin dashboard must render');
const escaped=label.replace(/&/g,'&amp;').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
assert(html.includes('data-client-name="'+escaped+'"'),'client label is inert');
assert.equal((html.match(/\son(?:click|change|input|keydown|submit)=/g)||[]).length,0,
 'no legacy inline event handlers in the entire authenticated Admin HTML');
assert(!/<script\b(?![^>]*\bsrc=)[^>]*>/.test(html),'no inline script tags in Admin');
assert(html.includes('data-zvm-handler-click='),'static Admin commands are delegated');
assert(html.includes('data-zvm-handler-keydown='),'keyboard actions are delegated');
assert(html.includes('data-zvm-handler-click="hExportCsv"'),'Admin action hub is externalized');
const active=html.match(/<script src="\/assets\/(zvm-admin-dashboard\.[a-f0-9]{12}\.js)" defer><\/script>/);
assert(active,'versioned JS loaded');
const js=fs.readFileSync(path.join(root,'assets',active[1]),'utf8');
assert(js.includes('const _zvmAdminPageActions=Object.freeze('),'static handler registry');
assert(js.includes("document.addEventListener('keydown'")||js.includes("for(const type of ['click','change','input','keydown'])"));
assert(!js.includes('onclick="removePhone(this)"'));
assert(!js.includes('onclick="loadUsers(true)"'));
assert(src.includes('const _CSP_ADMIN_SCRIPT_STRICT = '));
const csp=src.match(/const _CSP_ADMIN_SCRIPT_STRICT = "([^"]+)"/);
assert(csp&&csp[1].includes("script-src 'self'; style-src"));
assert(!csp[1].includes("script-src 'self' 'unsafe-inline'"));
assert(csp[1].includes("style-src 'self' 'unsafe-inline'"),
 'inline CSS remains intentionally compatible pending separate migration');
assert(src.includes("(isAdminPage || isAnalyticsPage) ? _CSP_ADMIN_SCRIPT_STRICT : _CSP_LEGACY_HTML"));
const docker=fs.readFileSync(path.join(root,'Dockerfile'),'utf8');
for(const part of ['client-ip-policy.js','legacy-v3-shield.js','COPY --chown=node:node src ./src','COPY --chown=node:node assets ./assets','COPY --chown=node:node cloud-pilot ./cloud-pilot','COPY --chown=node:node security ./security'])
 assert(docker.includes(part),'Docker runtime missing '+part);
const ignore=fs.readFileSync(path.join(root,'.dockerignore'),'utf8');
for(const secret of ['.env','zvm.env','*.pem','*.key','*.dump','*.sqlite'])
 assert(ignore.includes(secret),'Docker ignore missing '+secret);
console.log('R47.11 PASS: real Admin renderer has zero inline events/scripts; script-src strict, Docker runtime complete');
