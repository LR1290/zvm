'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const sharp = require('sharp');
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
async function whiteFaviconFixture() {
  const width=1795, height=1139, pixels=Buffer.alloc(width*height*4);
  for (let y=500;y<620;y++) for (let x=400;x<610;x++) {
    const i=(y*width+x)*4;
    pixels[i]=12; pixels[i+1]=24; pixels[i+2]=36; pixels[i+3]=255;
  }
  return sharp(pixels,{raw:{width,height,channels:4}}).png().toBuffer();
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

test('isolated endpoint serves original EA artwork in white with alpha, caches and supports 304 and HEAD',async()=>{
  const fixture=await whiteFaviconFixture();
  const upstream=fakeFetcher(fixture);
  const handler=createFaviconHandler(upstream.get);
  const [a,b] = await Promise.all([request(handler),request(handler)]);
  for(const r of [a,b]){
    assert.equal(r.handled,true);
    assert.equal(r.status,200);
    assert.equal(r.headers['Content-Type'],'image/png');
    assert.equal(r.headers['Access-Control-Allow-Origin'],'*');
    assert.ok(r.body.length > 64);
    assert.notDeepEqual(r.body,fixture);
    assert.match(r.headers.ETag,/^"ssx-ea-original-white-[a-f0-9]{32}"$/);
  }
  assert.deepEqual(a.body,b.body);
  const {data,info}=await sharp(a.body).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,1795);assert.equal(info.height,1139);
  const mark=(520*1795+420)*4;
  assert.deepEqual([...data.subarray(mark,mark+4)],[255,255,255,255]);
  assert.equal(data[3],0);
  assert.equal(upstream.calls.length,1);
  assert.equal(upstream.calls[0].url,OFFICIAL_LOGO_URL);
  const cached=await request(handler,SSX_FAVICON_ROUTE,'GET',{'if-none-match':a.headers.ETag});
  assert.equal(cached.status,304);
  assert.equal(cached.body,undefined);
  const head=await request(handler,SSX_FAVICON_ROUTE,'HEAD');
  assert.equal(head.status,200);assert.equal(head.body,undefined);
  assert.equal(head.headers['Content-Length'],a.body.length);
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
  assert.match(response.body.toString('utf8'),/<link rel="icon" type="image\/png" href="\/hobbies\/ssx\/ssx2012\/favicon\.png\?v=ea-original-white-r87">/);
  const archived={status:null,body:null};
  assert.equal(serveSSX2012({method:'GET',headers:{}},{writeHead(status){archived.status=status;},end(body){archived.body=body;}},SSX_ROUTE+'-v36'),true);
  assert.equal(archived.status,200);
  assert.equal(crypto.createHash('sha256').update(archived.body).digest('hex'), SHA256);
  assert.equal(serveSSX2012({method:'GET',headers:{}},{writeHead(){},end(){}},'/favicon.ico'),false);
});
