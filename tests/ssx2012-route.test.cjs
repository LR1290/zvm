 'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { once } = require('node:events');
const { serveSSX2012,SSX_ROUTE,SHA256 } = require('../src/hobbies/ssx/route');

async function harness(f) {
  const server = http.createServer((req,res) => {
    const pathname = new URL(req.url,'http://localhost').pathname;
    if (!serveSSX2012(req,res,pathname)) {res.writeHead(404);res.end('not found');}
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {return await f(origin);} finally {await new Promise(resolve=>server.close(resolve));}
}

test('serves exact SSX URL with no-index and opaque-origin CSP',()=>harness(async base=>{
  const r = await fetch(base+SSX_ROUTE);
  assert.equal(r.status,200);
  assert.match(r.headers.get('content-type'),/text\/html/);
  assert.match(r.headers.get('x-robots-tag'),/noindex/);
  const csp=r.headers.get('content-security-policy');
  assert.match(csp,/sandbox allow-scripts/);
  assert.doesNotMatch(csp,/allow-same-origin/);
  assert.match(await r.text(),/SSX/);
}));
test('HEAD delivers content headers, no bytes',()=>harness(async base=>{
 const r = await fetch(base+SSX_ROUTE,{method:'HEAD'});
 assert.equal(r.status,200);
 assert.equal((await r.arrayBuffer()).byteLength,0);
 assert.ok(Number(r.headers.get('content-length'))>1e6);
}));
test('Brotli and gzip representations have distinct ETags',()=>harness(async base=>{
 const get = (encoding)=>new Promise((resolve,reject)=>http.get(base+SSX_ROUTE,{headers:{'Accept-Encoding':encoding}},res=>{
  const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));res.on('error',reject);
 }).on('error',reject));
 const br=await get('br'),gz=await get('gzip');
 assert.equal(br.status,200);assert.equal(gz.status,200);
 assert.equal(br.headers['content-encoding'],'br');assert.equal(gz.headers['content-encoding'],'gzip');
 assert.notEqual(br.headers.etag,gz.headers.etag);
 assert.ok(br.body.length<8_140_766);assert.ok(gz.body.length<8_140_766);
}));
test('conditional cache returns 304 only with matching encoding',()=>harness(async base=>{
 const a=await fetch(base+SSX_ROUTE);const etag=a.headers.get('etag');
 const b=await fetch(base+SSX_ROUTE,{headers:{'If-None-Match':etag}});
 assert.equal(b.status,304);assert.equal((await b.arrayBuffer()).byteLength,0);
}));
test('no prefix traversal / directory listing / POST',()=>harness(async base=>{
 assert.equal((await fetch(base+'/hobbies/ssx')).status,404);
 assert.equal((await fetch(base+'/hobbies/ssx/file.js')).status,404);
 assert.equal((await fetch(base+SSX_ROUTE,{method:'POST'})).status,405);
 assert.equal((await fetch(base+SSX_ROUTE+'/',{redirect:'manual'})).status,308);
}));
test('source integrity format',()=>assert.match(SHA256,/^[a-f0-9]{64}$/));