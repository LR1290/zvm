'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const text=name=>fs.readFileSync(path.join(root,name),'utf8');
const html=text('public/index.html'),server=text('server.js');
const workspace=text('public/workspace.js'),js=text('public/cloud-crm-board.js');
const css=text('public/cloud-crm-board.css'),domain=text('crm-board-domain.js');
test('R21 CRM: real board assets and DOM, no inline handlers',()=>{
 assert.match(html,/id="cloudCrmBoard"/);
 assert.match(html,/cloud-crm-board\.css/);
 assert.match(html,/cloud-crm-board\.js/);
 assert.match(server,/cloud-crm-board\.js':\['cloud-crm-board\.js','application\/javascript/);
 assert.match(server,/cloud-crm-board\.css':\['cloud-crm-board\.css','text\/css/);
 assert.doesNotMatch(html,/<script[^>]+src="https?:/i);
 assert.doesNotMatch(css,/!important/);
 assert.doesNotMatch(html,/\sonclick=/i);
});
test('R21 CRM: UI actions use server API, refresh revision and preserve DEV gate',()=>{
 assert.match(js,/\/api\/crm\/board/);
 assert.match(js,/credentials:'same-origin'/);
 assert.match(js,/revision:state\.revision/);
 assert.match(js,/action:'add-column'/);
 assert.match(js,/action:'rename-column'/);
 assert.match(js,/action:'remove-column'/);
 assert.match(js,/action:'add-contact'/);
 assert.match(js,/action:'move-card'/);
 assert.match(js,/action:'unlink-card'/);
 assert.match(js,/window\.addEventListener\('zvm-cloud-locked'/);
 assert.match(workspace,/window\.dispatchEvent\(new CustomEvent\('zvm-cloud-data'/);
 assert.match(workspace,/crm:snapshot\.data\?\.crm/);
 assert.match(workspace,/contacts:snapshot\.data\?\.contacts/);
 assert.match(workspace,/zvm-cloud-crm-changed/);
});
test('R21 CRM: API mutations are scoped, CAS protected and do not send',()=>{
 const a=server.indexOf("pathname==='/api/crm/board'"),b=server.indexOf("pathname==='/api/workspace'",a);
 assert(a>0&&b>a);
 const route=server.slice(a,b);
 for(const token of ['user.email','current.revision!==payload.revision','changeCrmBoard','moduleCheck','checkWhole','checkCrmLinks','store.writeWorkspace','sending:false'])
  assert(route.includes(token),'missing CRM gate '+token);
 assert(server.indexOf("if(!user)return json(res,401")<a);
 assert(server.indexOf("if(!await activated(user))")<a || server.indexOf("if(!await activated(user))")<0);
 assert.match(domain,/MAX_COLUMNS=40/);
 assert.doesNotMatch(js,/sendMessage|wppconnect|whatsapp\.send|localStorage/i);
});
test('R21 CRM: keyboard and mobile accessibility have dedicated styles',()=>{
 assert.match(css,/@media\(max-width:720px\)/);
 assert.match(css, /focus-visible/);
 assert.match(js,/setAttribute\('aria-label'/);
 assert.match(js,/setAttribute\('aria-live'/);
});
