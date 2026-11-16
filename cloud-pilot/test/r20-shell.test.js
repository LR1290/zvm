'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const file=name=>fs.readFileSync(path.join(root,name),'utf8');
const html=file('public/index.html'),ui=file('public/cloud-ui.js');
const css=file('public/cloud-ui.css'),work=file('public/workspace.js'),server=file('server.js');

const pages=['summary','campaigns','flows','funnels','crm','labels','contacts',
 'library','quickReplies','agenda','migration','integration','settings'];
test('R20: staging shell exposes all 13 real work areas without removing auth or DEV gate',()=>{
 const nav=[...html.matchAll(/<button[^>]*data-page="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(nav,pages);
 for(const id of ['loading','login','devGate','unavailable','app','devForm','accountLabel','devKey',
  'leaveDev','retry','ping','response','cloudPageTitle','cloudContacts','cloudLibrary',
  'cloudAutomations','cloudModulesOverview','cloudCommandButton','cloudCommandInput',
  'cloudCommandDialog','cloudCommandResults','cloudCommandClose']){
  assert.ok(html.includes('id="'+id+'"'),'Missing interface contract '+id);
 }
 for(const page of pages)assert.match(html,new RegExp('id="'+page+'"'));
 assert.match(html,/method="POST" action="\/cliente\/login"/);
 assert.match(html,/cloud-ui\.css/);assert.match(html,/cloud-ui\.js/);
 assert.ok(!html.includes('style="'),'Strict CSP blocks inline styles');
});
test('R20: Cloud shell assets served via existing private-origin router, without remote scripts',()=>{
 assert.match(server,/\'\/cloud-ui\.js\':\['cloud-ui\.js\'/);
 assert.match(server,/\'\/cloud-ui\.css\':\['cloud-ui\.css\'/);
 assert.doesNotMatch(html,/src="https?:\/\//i);
 assert.doesNotMatch(css,/!important/);
 assert.match(css,/grid-template-columns:244px minmax\(0,1fr\)/);
 assert.match(css,/@media\(max-width:900px\)/);
 assert.match(ui,/window\.addEventListener\('zvm-cloud-locked'/);
 assert.match(ui,/window\.addEventListener\('zvm-cloud-ready'/);
});
test('R20: overview counts are generated from authorized workspace API, not fabricated send statistics',()=>{
 for(const id of ['cloudContacts','cloudLibrary','cloudAutomations'])
  assert.match(ui,new RegExp(id));
 assert.match(work,/new CustomEvent\('zvm-cloud-data'/);
 assert.match(work,/snapshot\.counts\|\|\{\}/);
 assert.match(work,/className='workspace-filter'/);
 assert.match(work,/module==='crm'/);
 assert.doesNotMatch(ui,/api\/send|sendMessage|wppconnect/i);
 assert.match(ui,/zvm-cloud-sidebar-collapsed/); // Persist only the non-sensitive layout preference.
 assert.match(server,/sending:false/);
 assert.match(html,/Envios e agendamentos automáticos estão desativados/);
});
