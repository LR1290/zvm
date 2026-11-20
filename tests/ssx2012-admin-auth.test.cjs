'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const http=require('node:http');
const {once}=require('node:events');
const {test}=require('node:test');
const {serveSSX2012,SSX_ROUTE,SSX_V36_ARCHIVE_ROUTE,publicBridgeEndpoint,ssxAuth}=require('../src/hobbies/ssx/route');
const {checkBridge}=require('../src/hobbies/ssx/admin-dashboard');
const ADMIN='/hobbies/ssx/ssx2012/admin';
async function harness(callback) {
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    if(!serveSSX2012(req,res,pathname)){res.writeHead(404);res.end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  try{return await callback(base);}finally{await new Promise(resolve=>server.close(resolve));}
}
const password='SSX Private Admin Example 2026!';
const salt=Buffer.from('defacedfeeddd00dddefacedfeeddd00dd','hex');
const derived=crypto.scryptSync(password,salt,64,{N:16384,r:8,p:1,maxmem:32*1024*1024});
process.env.SSX_SITE_ADMIN_EMAIL='admin@example.com';
process.env.SSX_SITE_ADMIN_PASSWORD_HASH='scrypt$'+salt.toString('hex')+'$'+derived.toString('hex');
process.env.SSX_SITE_ADMIN_SESSION_KEY=crypto.randomBytes(48).toString('hex');
process.env.SSX_PUBLIC_BRIDGE_URL='https://script.google.com/macros/s/test_deployment-ABC123/exec';

test('Bridge public configuration accepts only trusted Apps Script exec endpoints',()=>{
  assert.equal(publicBridgeEndpoint(),process.env.SSX_PUBLIC_BRIDGE_URL);
  const safe=process.env.SSX_PUBLIC_BRIDGE_URL;
  for(const bad of ['https://docs.google.com/spreadsheets/d/123','https://evil.example/macros/s/id/exec',
    'http://script.google.com/macros/s/id/exec','https://script.google.com/macros/s/id/dev',
    'https://script.google.com/macros/s/id/exec?token=SECRET']){
    process.env.SSX_PUBLIC_BRIDGE_URL=bad;
    assert.equal(publicBridgeEndpoint(),'');
  }
  process.env.SSX_PUBLIC_BRIDGE_URL=safe;
});
test('missing credentials fail closed independently of normal SSX viewing',()=>harness(async base=>{
  const email=process.env.SSX_SITE_ADMIN_EMAIL;
  process.env.SSX_SITE_ADMIN_EMAIL='';
  try{
    const r=await fetch(base+ADMIN,{redirect:'manual'});
    assert.equal(r.status,503);
    assert.equal((await fetch(base+SSX_ROUTE)).status,200);
  }finally{process.env.SSX_SITE_ADMIN_EMAIL=email;}
}));
test('public HTML omits privileged interface and receives trusted server-side Live Sync endpoint',()=>harness(async base=>{
  const r=await fetch(base+SSX_ROUTE);
  assert.equal(r.status,200);
  const body=await r.text();
  assert.match(body,/id="ssx-public-security"/);
  assert.match(body,/id="adminBtn" type="button" hidden/);
  assert.match(body,/id="submissionsBtn" type="button" hidden/);
  assert.doesNotMatch(body,/class="modal admin-modal"/);
  assert.doesNotMatch(body,/class="modal submissions-modal"/);
  assert.doesNotMatch(body,/id="liveSaveBtn"/);
  assert.match(body,/normalizeAdminEndpoint\("https:\/\/script\.google\.com\/macros\/s\/test_deployment-ABC123\/exec"\)/);
  assert.equal((await fetch(base+SSX_V36_ARCHIVE_ROUTE,{redirect:'manual'})).status,303);
  assert.equal((await fetch(base+ADMIN,{redirect:'manual'})).status,303);
}));
test('admin email/password uses same-origin POST, signed HttpOnly cookie and no-cache protected HTML',()=>harness(async base=>{
  const login=await fetch(base+ADMIN+'/login',{redirect:'manual'});
  assert.equal(login.status,200);
  assert.match(await login.text(),/type="email"/);
  assert.match(login.headers.get('content-security-policy'),/form-action 'self'/);
  const payload=new URLSearchParams({email:'admin@example.com',password});
  const forbidden=await fetch(base+ADMIN+'/login',{method:'POST',body:payload,redirect:'manual'});
  assert.equal(forbidden.status,403,'Login must reject cross-site or no-Origin POSTs');
  const wrong=await fetch(base+ADMIN+'/login',{method:'POST',body:new URLSearchParams({email:'admin@example.com',password:'incorrect password 2026'}),
    headers:{Origin:base},redirect:'manual'});
  assert.equal(wrong.status,401);
  const ok=await fetch(base+ADMIN+'/login',{method:'POST',body:payload,
    headers:{Origin:base},redirect:'manual'});
  assert.equal(ok.status,303);
  const setCookie=ok.headers.get('set-cookie');
  assert.match(setCookie,/ssx_admin=/);
  assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/Secure/);
  assert.match(setCookie,/SameSite=Strict/);
  assert.match(setCookie,/Path=\/hobbies\/ssx\/ssx2012\/admin/);
  const cookie=setCookie.split(';')[0];
  const admin=await fetch(base+ADMIN,{headers:{Cookie:cookie},redirect:'manual'});
  assert.equal(admin.status,200);
  assert.equal(admin.headers.get('cache-control'),'no-store, private');
  assert.match(admin.headers.get('content-security-policy'),/default-src 'none'/);
  const dashboard=await admin.text();
  assert.match(dashboard,/Painel administrativo/);
  assert.match(dashboard,/action="\/hobbies\/ssx\/ssx2012\/admin\/logout"/);
  assert.doesNotMatch(dashboard,/adminToken|ADMIN_API_KEY|class="modal admin-modal"/);
  const editor=await fetch(base+ADMIN+'/editor',{headers:{Cookie:cookie},redirect:'manual'});
  assert.equal(editor.status,200);
  assert.equal(editor.headers.get('x-ssx-variant'),'ssx-admin-v39');
  const html=await editor.text();
  assert.match(html,/class="modal admin-modal"/);
  assert.match(html,/id="liveSaveBtn"/);
  const archive=await fetch(base+ADMIN+'/archive',{headers:{Cookie:cookie},redirect:'manual'});
  assert.equal(archive.status,200);
  const guarded=await fetch(base+ADMIN+'/bridge-health',{redirect:'manual'});
  assert.equal(guarded.status,303);
  assert.equal(guarded.headers.get('location'),ADMIN+'/login');
  const forged=cookie.slice(0,-2)+'zz';
  assert.equal((await fetch(base+ADMIN,{headers:{Cookie:forged},redirect:'manual'})).status,303);
  const logout=await fetch(base+ADMIN+'/logout',{method:'POST',headers:{Origin:base,Cookie:cookie},redirect:'manual'});
  assert.equal(logout.status,303);
  assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
}));

test('read-only Bridge health probe accepts v8 and refuses redirects to untrusted hosts',async()=>{
  const good=async(url,options)=>{
    assert.equal(new URL(url).searchParams.get('action'),'ping');
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'manual');
    return new Response(JSON.stringify({ok:true,version:8}),{
      status:200,headers:{'Content-Type':'application/json'}
    });
  };
  const ok=await checkBridge(good);
  assert.deepEqual(ok,{configured:true,ok:true,version:8});
  const old=await checkBridge(async()=>new Response('{"ok":true,"version":7}',{status:200}));
  assert.equal(old.ok,false);assert.equal(old.version,7);
  const untrusted=await checkBridge(async()=>new Response(null,{status:302,headers:{Location:'https://example.com/leak'}}));
  assert.equal(untrusted.ok,false);
  const tiny=await checkBridge(async()=>new Response('x'.repeat(32769),{status:200}));
  assert.equal(tiny.ok,false);
});
test('GET administrative health and editor remain protected when credentials are absent',()=>harness(async base=>{
  const address=process.env.SSX_PUBLIC_BRIDGE_URL;
  process.env.SSX_PUBLIC_BRIDGE_URL='';
  try {
    const login=await fetch(base+ADMIN+'/login');
    assert.equal(login.status,200);
    const a=await fetch(base+ADMIN+'/bridge-health',{redirect:'manual'});
    const b=await fetch(base+ADMIN+'/editor',{redirect:'manual'});
    assert.equal(a.status,303);assert.equal(b.status,303);
  } finally {process.env.SSX_PUBLIC_BRIDGE_URL=address;}
}));

test('login rate limit trusts Render-owned client IP but ignores attacker X-Forwarded-For',()=>{
  const old=process.env.RENDER;
  const req={headers:{'cf-connecting-ip':'203.0.113.72','x-forwarded-for':'198.51.100.3'},
    socket:{remoteAddress:'10.0.0.23'}};
  try{
    process.env.RENDER='true';
    assert.equal(ssxAuth.adminClientIp(req),'203.0.113.72');
    req.headers['x-forwarded-for']='192.0.2.90';
    assert.equal(ssxAuth.adminClientIp(req),'203.0.113.72');
    process.env.RENDER='';
    assert.equal(ssxAuth.adminClientIp(req),'10.0.0.23');
  }finally{if(old===undefined)delete process.env.RENDER;else process.env.RENDER=old;}
});
