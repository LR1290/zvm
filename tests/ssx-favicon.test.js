'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { serveSSX2012, SSX_ROUTE, SHA256 } = require('../src/hobbies/ssx/route');
const { createFaviconHandler, isOfficialPng, OFFICIAL_LOGO_URL, SSX_FAVICON_ROUTE } =
  require('../src/hobbies/ssx/official-favicon');

function originalShapeBytes() {
  const png = Buffer.alloc(80);
  Buffer.from('89504e470d0a1a0a','hex').copy(png,0);
  png.writeUInt32BE(13,8);
  png.write('IHDR',12,'ascii');
  png.writeUInt32BE(1795,16);
  png.writeUInt32BE(1139,20);
  png.write('IEND',png.length-8,'ascii');
  return png;
}
function fakeFetcher(body = originalShapeBytes(), statusCode = 200) {
  const calls = [];
  const get = (url, options, callback) => {
    calls.push({url,options});
    const req = new EventEmitter();
    req.destroy = err => process.nextTick(() => req.emit('error',err));
    process.nextTick(() => {
      const incoming = new PassThrough();
      incoming.statusCode = statusCode;
      incoming.headers = { 'content-type':'image/png', 'content-length':String(body.length) };
      callback(incoming);
      incoming.end(body);
    });
    return req;
  };
  return {get,calls};
}
function request(handler, route = SSX_FAVICON_ROUTE, method = 'GET', requestHeaders = {}) {
  return new Promise(resolve => {
    let response = { handled:null, status:null, headers:null, body:null };
    const res = {
      writeHead(status, headers){response.status=status;response.headers=headers;},
      end(body){response.body=body;resolve(response);}
    };
    response.handled = handler({method,headers:requestHeaders},res,route);
    if (!response.handled) resolve(response);
  });
}

test('source identity: original EA logo, not a generated or SSX 3 logo',()=>{
  assert.equal(OFFICIAL_LOGO_URL,'https://media.contentapi.ea.com/content/dam/gin/common/logos/ssx-2012-mono-logo.png');
  assert.equal(SSX_FAVICON_ROUTE,SSX_ROUTE+'/favicon.png');
  assert.ok(isOfficialPng(originalShapeBytes()));
  const wrong=originalShapeBytes();wrong.writeUInt32BE(1000,16);
  assert.equal(isOfficialPng(wrong),false);
  assert.equal(isOfficialPng(Buffer.from('<svg>fake</svg>')),false);
});

test('isolated endpoint returns EA original bytes, caches request and supports 304 and HEAD',async()=>{
  const fixture=originalShapeBytes();
  const upstream=fakeFetcher(fixture);
  const handler=createFaviconHandler(upstream.get);
  const [a,b] = await Promise.all([request(handler),request(handler)]);
  for(const r of [a,b]){
    assert.equal(r.handled,true);
    assert.equal(r.status,200);
    assert.equal(r.headers['Content-Type'],'image/png');
    assert.equal(r.headers['Access-Control-Allow-Origin'],'*');
    assert.deepEqual(r.body,fixture);
  }
  assert.equal(upstream.calls.length,1);
  assert.equal(upstream.calls[0].url,OFFICIAL_LOGO_URL);
  const cached=await request(handler,SSX_FAVICON_ROUTE,'GET',{'if-none-match':a.headers.ETag});
  assert.equal(cached.status,304);
  assert.equal(cached.body,undefined);
  const head=await request(handler,SSX_FAVICON_ROUTE,'HEAD');
  assert.equal(head.status,200);assert.equal(head.body,undefined);
  assert.equal(head.headers['Content-Length'],fixture.length);
  assert.equal(upstream.calls.length,1);
  const notServed=await request(handler,'/favicon.ico');
  assert.equal(notServed.handled,false);
  const unsafe=await request(handler,SSX_FAVICON_ROUTE,'POST');
  assert.equal(unsafe.status,405);
  assert.equal(upstream.calls.length,1);
});

test('rejects malformed or non-official image assets instead of faking the logo', async()=>{
  const upstream=fakeFetcher(Buffer.from('wrong'),200);
  const handler=createFaviconHandler(upstream.get);
  const oldError=console.error;
  let outcome;
  try {
    console.error=()=>{};
    outcome=await request(handler);
  } finally {console.error=oldError;}
  assert.equal(outcome.status,503);
  assert.match(String(outcome.body),/Official SSX favicon/);
});

test('SSX Alpine page links only original PNG; v36 archive and root favicon stay untouched',()=>{
  let response={status:null,headers:null,body:null};
  const res={writeHead(status,headers){response.status=status;response.headers=headers;},end(body){response.body=body;}};
  assert.equal(serveSSX2012({method:'GET',headers:{}},res,SSX_ROUTE),true);
  assert.equal(response.status,200);
  assert.match(response.body.toString('utf8'),/<link rel="icon" type="image\/png" href="\/hobbies\/ssx\/ssx2012\/favicon\.png\?v=ea-original-r86">/);
  const archived={status:null,body:null};
  assert.equal(serveSSX2012({method:'GET',headers:{}},{writeHead(status){archived.status=status;},end(body){archived.body=body;}},SSX_ROUTE+'-v36'),true);
  assert.equal(archived.status,200);
  assert.equal(crypto.createHash('sha256').update(archived.body).digest('hex'), SHA256);
  assert.equal(serveSSX2012({method:'GET',headers:{}},{writeHead(){},end(){}},'/favicon.ico'),false);
});
