'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const vm=require('node:vm');
const Module=require('node:module');
const root=path.resolve(__dirname,'..');
const serverFile=path.join(root,'server.js');
const server=fs.readFileSync(serverFile,'utf8');
let passed=0;

const cssMatch=server.match(/<link rel="stylesheet" href="\/assets\/(zvm-console-design\.([a-f0-9]{12})\.css)">/);
assert(cssMatch,'versioned Design System must be linked');
const css=fs.readFileSync(path.join(root,'assets',cssMatch[1]),'utf8');
const cssSha=crypto.createHash('sha256').update(css).digest('hex');
assert.equal(cssSha.slice(0,12),cssMatch[2]);
assert(server.includes("sha256: '"+cssSha+"'"),'asset registry must pin complete CSS digest');
assert.equal(server.split('/assets/'+cssMatch[1]+'"').length-1,2,'shared CSS must load in Admin and Client');
passed++;

const jsMatch=server.match(/<script src="\/assets\/(zvm-admin-dashboard\.([a-f0-9]{12})\.js)" defer><\/script>/);
assert(jsMatch);
const js=fs.readFileSync(path.join(root,'assets',jsMatch[1]),'utf8');
const jsSha=crypto.createHash('sha256').update(js).digest('hex');
assert.equal(jsSha.slice(0,12),jsMatch[2]);
assert(server.includes("sha256: '"+jsSha+"'"));
new vm.Script(js,{filename:jsMatch[1]});
assert.match(js,/if\(!valid\.includes\(t\)\)t='keys'/,'stale persisted tab must be corrected');
assert.match(js,/b\.setAttribute\('aria-current','page'\)/);
passed++;

// CSS lexical validity: balanced blocks even with strings and comments.
{
  let depth=0,string=null,comment=false;
  for(let i=0;i<css.length;i++){
    const ch=css[i],next=css[i+1];
    if(comment){if(ch==='*'&&next==='/'){comment=false;i++}continue}
    if(string){if(ch==='\\'){i++;continue}if(ch===string)string=null;continue}
    if(ch==='/'&&next==='*'){comment=true;i++;continue}
    if(ch==='"'||ch==="'"){string=ch;continue}
    if(ch==='{')depth++;
    else if(ch==='}'){depth--;assert(depth>=0,'unmatched CSS close brace')}
  }
  assert.equal(depth,0,'CSS should have no unclosed rules');
  assert(!string&&!comment);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/@media\(max-width:460px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /prefers-contrast:more/);
  assert.match(css,/focus-visible/);
  passed++;
}

// Confirm color contrast for primary and secondary text on dark panels.
const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255);
const lum=h=>rgb(h).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
const ratio=(a,b)=>{let l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)};
assert(ratio('#f3f8f4','#101a16')>=4.5,'text contrast AA');
assert(ratio('#b7cbbf','#101a16')>=4.5,'secondary text contrast AA');
assert(ratio('#94ad9d','#101a16')>=4.5,'muted text contrast AA');
assert(ratio('#082118','#46e3a2')>=4.5,'primary CTA contrast AA');
passed++;

// Historical expired-license CTA fixture intentionally exercises explicitly enabled sales.
process.env.ZVM_SALES_PAUSED='0';
process.env.RENDER='true';
process.env.ADMIN_USER='qa-ui';
process.env.ADMIN_PASS='qa-ui-secret';
process.env.MONGODB_URI='mongodb://127.0.0.1:27017/offline_qa';
const original=Module._load;
let api;
try{
  Module._load=function(id,...args){
    if(id==='mongodb')return{MongoClient:class OfflineMongoFixture {}};
    return original.call(this,id,...args);
  };
  api=require(serverFile).__test;
}finally{Module._load=original}
const fixture={label:'Cliente de teste',code:'qa-zvm-001',active:true,maxUses:3,phones:['551100000001'],
  planId:'monthly',createdAt:'2026-11-01T00:00:00.000Z',expiresAt:'2027-11-01T00:00:00.000Z'};
const admin=api.renderAdminDashboard({
  keysSnapshot:{'qa-zvm-001':fixture},
  portalUsers:[],portalUserCount:0
});
assert.match(admin,/<main class="admin-content" id="zvm-admin-main"/);
assert.match(admin,/<nav class="rsidebar" id="rsidebar" aria-label="Navegação administrativa">/);
assert.match(admin,/<a class="zvm-skip-link" href="#zvm-admin-main">/);
assert.match(admin,/<aside class="admin-day-thought" aria-label="Pensamento do dia">/,'keep the approved daily-thought module');
assert.doesNotMatch(admin,/<aside class="zvm-overview-help"/,'retired oversized help aside must not return');
assert.match(admin,/<section class="admin-overview admin-overview-compact"/,'licenses summary stays compact');
for(const id of ['kb','last-refresh','s-total','nlabel','phonesModal','users-tb','ip-bl-tb','toast']){
  assert(admin.includes('id="'+id+'"'),'functional Admin ID removed: '+id);
}
for(const tab of ['keys','logs','audit','users','security']){
  assert(admin.includes('data-tab="'+tab+'"'),'navigation removed: '+tab);
}
assert(admin.includes('/assets/'+cssMatch[1]));
assert(admin.includes('/assets/'+jsMatch[1]));
assert(!admin.includes('id="admin-key-drawer"'),'retired drawer must not return');
passed++;

const user={name:'Pessoa QA',_id:'qa@example.invalid',email:'qa@example.invalid',verified:true};
const client=api.renderPortalDashboard(user,fixture,'','');
assert(client.includes('<body class="zvm-client-premium">'));
assert(client.includes('/assets/'+cssMatch[1]));
assert.match(client,/<h1>Minha conta<\/h1>/);
assert.match(client,/<section class="client-quickfacts" aria-label="Resumo da licença">/);
assert.match(client,/Dispositivos vinculados/);
assert.match(client,/Validade/);
assert.match(client,/1 de 3/);
assert.match(client,/data-confirm="Remover este número da licença/);
assert.match(client,/action="\/cliente\/dispositivos\/remover"/);
assert.match(client,/name="phone" value="551100000001"/);
assert.match(client,/name="keyCode" value="qa-zvm-001"/);
assert.match(client,/href="\/cliente\/2fa\/setup"/);
passed++;

const noKey=api.renderPortalDashboard(user,null,'','');
assert.match(noKey,/Nenhuma chave vinculada/);
assert.doesNotMatch(noKey,/class="client-quickfacts"/);
assert.match(noKey,/Vincular uma chave/);
passed++;

const expired=api.renderPortalDashboard(user,{...fixture,active:false,expiresAt:'2026-01-01T00:00:00.000Z'},'','');
assert.match(expired,/Expirada/);
assert.match(expired,/<section class="client-quickfacts"/);
assert.match(expired,/Renovar agora/);
passed++;

// Source-level safety: preserve all sensitive routes, no authorization changes.
for(const route of ['/cliente/dispositivos/remover','/cliente/desvincular','/cliente/senha','/cliente/email']){
 assert(server.includes(route),'client route missing: '+route);
}
assert(server.includes('mutateAdminKeyRecordStrict'));
assert(server.includes('requireSameOriginPost(req)'));
assert(server.includes('readPortalKeySnapshot(user.keyCode, { db })'));
passed++;

console.log('R46.94 PASS: '+passed+' UI render/contract/accessibility/hash test groups');
