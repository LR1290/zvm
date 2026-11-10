'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { serveSSX2012, SSX_ROUTE, SHA256 } = require('../src/hobbies/ssx/route');

function request(path, method = 'GET', requestHeaders = {}) {
  const response = { status: 0, headers: {}, body: null };
  const res = {
    writeHead(status, headers) { response.status = status; response.headers = headers || {}; },
    end(body) { response.body = body; }
  };
  const handled = serveSSX2012({ method, headers: requestHeaders }, res, path);
  return { handled, ...response };
}
const iconPath = SSX_ROUTE + '/favicon.svg';
const expectedIconHash = 'a40f363f991c115131176ff56871c7218dbe53124e956e64ab7f5b6f2d20061f';

test('SSX favicon serves a small integrity-checked SVG without modifying the ZVM root', () => {
  const r = request(iconPath);
  assert.equal(r.handled, true);
  assert.equal(r.status, 200);
  assert.match(r.headers['Content-Type'], /^image\/svg\+xml/);
  assert.equal(r.headers['Cross-Origin-Resource-Policy'], 'cross-origin');
  assert.equal(r.headers['Access-Control-Allow-Origin'], '*');
  assert.ok(Buffer.isBuffer(r.body));
  assert.equal(crypto.createHash('sha256').update(r.body).digest('hex'), expectedIconHash);
  assert.match(r.body.toString('utf8'), /SSX/);
  assert.match(r.body.toString('utf8'), /2012/);
  assert.equal(serveSSX2012({ method: 'GET' }, { writeHead(){}, end(){} }, '/favicon.ico'), false);
});

test('SSX favicon HEAD, conditional GET and unsafe method are handled correctly', () => {
  const get = request(iconPath);
  const head = request(iconPath, 'HEAD');
  const cached = request(iconPath, 'GET', {'if-none-match': get.headers.ETag});
  const post = request(iconPath, 'POST');
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);
  assert.equal(head.headers['Content-Length'], get.body.length);
  assert.equal(cached.status, 304);
  assert.equal(cached.body, undefined);
  assert.equal(post.status, 405);
});

test('public Alpine page declares only the route-scoped favicon and archived source bytes stay fixed', () => {
  const page = request(SSX_ROUTE);
  assert.equal(page.handled, true);
  assert.equal(page.status, 200);
  const html = page.body.toString('utf8');
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" sizes="any" href="\/hobbies\/ssx\/ssx2012\/favicon\.svg\?v=a40f363f991c">/);
  const archived = request(SSX_ROUTE + '-v36');
  assert.equal(archived.status, 200);
  assert.equal(crypto.createHash('sha256').update(archived.body).digest('hex'), SHA256);
});
