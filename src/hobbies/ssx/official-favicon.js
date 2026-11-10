'use strict';
// Exact official SSX (2012) logo published by Electronic Arts. No redraws,
// generated badges or generic redirects: the browser receives the original PNG
// bytes through the isolated, cacheable SSX path. No arbitrary URL proxying.
const https = require('node:https');
const crypto = require('node:crypto');

const SSX_FAVICON_ROUTE = '/hobbies/ssx/ssx2012/favicon.png';
const OFFICIAL_LOGO_URL = 'https://media.contentapi.ea.com/content/dam/gin/common/logos/ssx-2012-mono-logo.png';
const MAX_BYTES = 512 * 1024;
const SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

function isOfficialPng(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length >= 64 && bytes.length <= MAX_BYTES
    && bytes.subarray(0, 8).equals(SIGNATURE)
    && bytes.toString('ascii', 12, 16) === 'IHDR'
    // Original EA asset, 1795 x 1139. Fail closed if it changes unexpectedly.
    && bytes.readUInt32BE(16) === 1795
    && bytes.readUInt32BE(20) === 1139
    && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND';
}

function createFaviconHandler(request = https.get) {
  let cached = null;
  let inFlight = null;
  function download() {
    if (cached) return Promise.resolve(cached);
    if (inFlight) return inFlight;
    inFlight = new Promise((resolve, reject) => {
      let complete = false;
      const finish = (error, bytes) => {
        if (complete) return;
        complete = true;
        error ? reject(error) : resolve(bytes);
      };
      let upstream;
      try {
        upstream = request(OFFICIAL_LOGO_URL, {
          timeout: 7500,
          headers: { Accept: 'image/png', 'User-Agent': 'SSX-Community-Records/1.0' }
        }, incoming => {
          if (incoming.statusCode !== 200 ||
              !/^image\/png(?:\s*;|$)/i.test(String(incoming.headers['content-type'] || '')) ||
              Number(incoming.headers['content-length'] || 0) > MAX_BYTES) {
            incoming.resume();
            finish(new Error('SSX_OFFICIAL_FAVICON_UNEXPECTED_RESPONSE'));
            return;
          }
          const chunks = [];
          let size = 0;
          incoming.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_BYTES) {
              incoming.destroy();
              finish(new Error('SSX_OFFICIAL_FAVICON_TOO_LARGE'));
            } else {
              chunks.push(chunk);
            }
          });
          incoming.on('end', () => {
            if (complete) return;
            const bytes = Buffer.concat(chunks);
            if (!isOfficialPng(bytes)) {
              finish(new Error('SSX_OFFICIAL_FAVICON_VALIDATION_FAILED'));
            } else {
              const hash = crypto.createHash('sha256').update(bytes).digest('hex');
              finish(null, { bytes, etag: '"ssx-ea-original-' + hash.slice(0, 32) + '"' });
            }
          });
          incoming.on('error', finish);
        });
      } catch (error) {
        finish(error);
        return;
      }
      upstream.on('error', finish);
      upstream.on('timeout', () => upstream.destroy(new Error('SSX_OFFICIAL_FAVICON_TIMEOUT')));
    }).then(result => {
      cached = result;
      return result;
    }).finally(() => { inFlight = null; });
    return inFlight;
  }

  function serve(req, res, pathname) {
    if (pathname !== SSX_FAVICON_ROUTE) return false;
    const method = String(req.method || '').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }
    download().then(({ bytes, etag }) => {
      if (res.writableEnded || res.destroyed) return;
      const headers = {
        'Content-Type': 'image/png',
        'Content-Length': bytes.length,
        'Cache-Control': 'public, max-age=86400',
        ETag: etag,
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Access-Control-Allow-Origin': '*',
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
        'Content-Security-Policy': "default-src 'none'; object-src 'none'; frame-ancestors 'none'"
      };
      if (String((req.headers || {})['if-none-match'] || '').trim() === etag) {
        delete headers['Content-Length'];
        res.writeHead(304, headers);
        res.end();
      } else {
        res.writeHead(200, headers);
        res.end(method === 'HEAD' ? undefined : bytes);
      }
    }).catch(error => {
      console.error('[SSX-HOBBY] Official EA favicon unavailable:', error.message || error);
      if (!res.writableEnded && !res.destroyed) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(method === 'HEAD' ? undefined : 'Official SSX favicon temporarily unavailable');
      }
    });
    return true;
  }
  return serve;
}
module.exports = { SSX_FAVICON_ROUTE, OFFICIAL_LOGO_URL, isOfficialPng, createFaviconHandler, serveSSXFavicon: createFaviconHandler() };
