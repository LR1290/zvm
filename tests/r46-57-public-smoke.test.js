'use strict';
const assert = require('node:assert/strict');
const {audit,canonicalOrigin,linksFromPublicPage} = require('../tools/smoke-public-readonly');
const origin = 'https://site.example.test';
function testFetch(overrides = {}) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({url,method:opts.method,credential:opts.credentials,redirect:opts.redirect});
    assert.equal(opts.method,'GET');
    assert.equal(opts.credentials,'omit');
    assert.equal(opts.redirect,'manual');
    const path = new URL(url).pathname + new URL(url).search;
    if (path === '/ready') return new Response(overrides.ready || '{"ok":true}',{status:overrides.readyStatus||200,headers:{'content-type':overrides.readyType || 'application/json'}});
    if (path.startsWith('/assets/')) return new Response('body',{status:overrides.assetStatus || 200,headers:{'content-type':overrides.assetType || 'text/css'}});
    return new Response(path.startsWith('/termos') ? '<main class="terms-main"><link href="/assets/test.aabbccddeeff.css"></main>' : '<main>ok</main>',{status:overrides.pageStatus||200,headers:{'content-type':'text/html'}});
  };
  return {f,calls};
}
(async()=>{
  const {f,calls}=testFetch();
  const result=await audit({origin,fetcher:f});
  assert.deepEqual(result,{ok:true,pages:8,assets:1,checks:10,readOnly:true});
  assert.equal(calls.length,10);
  assert.equal(calls.every(c=>c.url.startsWith(origin)&&c.method==='GET'&&c.credential==='omit'),true);
  assert.equal(linksFromPublicPage('<script src="/assets/a.js"></script><link href="/assets/a.js">').length,1);
  for(const s of ['http://site.example.test','https://user:pass@site.example.test','https://site.example.test/path','https://site.example.test/?q=x']) assert.throws(()=>canonicalOrigin(s));
  await assert.rejects(()=>audit({origin,fetcher:testFetch({assetStatus:404}).f}),/smoke_http_404/);
  await assert.rejects(()=>audit({origin,fetcher:testFetch({assetType:'text/html'}).f}),/smoke_asset_mime/);
  await assert.rejects(()=>audit({origin,fetcher:testFetch({readyStatus:503}).f}),/smoke_http_503/);
  await assert.rejects(()=>audit({origin,fetcher:testFetch({ready:'{"ok":false}'}).f}),/smoke_unready/);
  await assert.rejects(()=>audit({origin,fetcher:testFetch({pageStatus:404}).f}),/smoke_http_404/);
  console.log('R46.57 public smoke: 10 mocked cases PASS, all GET and no credentials');
})().catch(e=>{console.error(e);process.exitCode=1});
