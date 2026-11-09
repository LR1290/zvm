'use strict';

// Independent hobby page. It does not import or touch ZVM authentication/business state.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const SSX_ROUTE = '/hobbies/ssx/ssx2012';
const SSX_V37_PREVIEW_ROUTE = '/hobbies/ssx/ssx2012-alpine-v37-preview';
const SSX_BUNDLE_SHA256 = 'f80d0760eeb18042a081279f27da96e05dc5f7ed4362bc72e6a4739043897a5a';
const SHA256 = 'd99aa1caaf9e9833ff85f899119043cbddaca66ce9bc9aa5f256990d331e42f0';
const PARTS = 10;
let content = null;
let packed = null;
let error = false;
let v37Preview = null;

// The upstream connector limits single-blob uploads. These ten binary chunks are
// *one* deterministic gzip artifact, not runtime dependencies or duplicated code.
function loadBundle() {
  if (content || error) return;
  try {
    const parts = [];
    for (let i = 0; i < PARTS; i++) {
      parts.push(fs.readFileSync(path.join(__dirname, 'packed', `ssx2012.html.gz.part${String(i).padStart(2,'0')}`)));
    }
    const candidate = Buffer.concat(parts);
    const compressedHash = crypto.createHash('sha256').update(candidate).digest('hex');
    if (compressedHash !== SSX_BUNDLE_SHA256) throw new Error('SSX_BUNDLE_HASH_MISMATCH');
    const decompressed = zlib.gunzipSync(candidate);
    const uncompressedHash = crypto.createHash('sha256').update(decompressed).digest('hex');
    if (uncompressedHash !== SHA256) throw new Error('SSX_HTML_HASH_MISMATCH');
    content = decompressed;
    packed = candidate;
  } catch (cause) {
    error = true;
    console.error('[SSX-HOBBY] Asset unavailable; ZVM unaffected:', cause.code || cause.message);
  }
}

// The preview reuses the exact validated v36 payload and record dataset.
// Nothing is persisted or injected into the production /ssx2012 response.
function loadV37Preview() {
  if (v37Preview) return v37Preview;
  const css = fs.readFileSync(path.join(__dirname, 'alpine-v37.css'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, 'alpine-v37.js'), 'utf8');
  if (/<\/style/i.test(css) || /<\/script/i.test(js)) {
    throw new Error('SSX_V37_UNSAFE_INLINE_ASSET');
  }
  const original = content.toString('utf8');
  if (!/<\/head\s*>/i.test(original) || !/<\/body\s*>/i.test(original)) {
    throw new Error('SSX_V37_DOCUMENT_ANCHOR_MISSING');
  }
  const updated = original
    .replace(/<\/head\s*>/i, '<style id="ssx-alpine-v37-style">\n' + css + '\n</style></head>')
    .replace(/<\/body\s*>/i, '<script id="ssx-alpine-v37-script">\n' + js + '\n</script></body>')
    .replace(/<title>[^<]*<\/title>/i, '<title>SSX 2012 · Alpine v37 Preview</title>');
  const data = Buffer.from(updated, 'utf8');
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  v37Preview = { content: data, hash, gzip: null, br: null };
  return v37Preview;
}
function v37BodyFor(encoding) {
  const v37 = loadV37Preview();
  if (encoding === 'gzip') {
    if (!v37.gzip) v37.gzip = zlib.gzipSync(v37.content, { level: 6 });
    return v37.gzip;
  }
  if (encoding === 'br') {
    if (!v37.br) v37.br = zlib.brotliCompressSync(v37.content, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
    });
    return v37.br;
  }
  return v37.content;
}

function pickEncoding(value = '') {
  const qualities = new Map();
  for (const component of String(value).split(',')) {
    const bits = component.trim().toLowerCase().split(';').map(s => s.trim());
    if (!bits[0]) continue;
    let q = 1;
    const matched = bits.slice(1).join(';').match(/(?:^|;)q\s*=\s*([0-9.]+)/);
    if (matched) q = Math.max(0, Math.min(1, Number(matched[1]) || 0));
    qualities.set(bits[0], q);
  }
  const q = x => qualities.has(x) ? qualities.get(x) : (qualities.get('*') || 0);
  return q('br') > 0 && q('br') >= q('gzip') ? 'br' : q('gzip') > 0 ? 'gzip' : 'identity';
}

function bodyFor(encoding) {
  if (encoding === 'gzip') return packed;
  if (encoding === 'br') {
    // Brotli is created once and shared only after the bundle was validated.
    if (!bodyFor.brotli) bodyFor.brotli = zlib.brotliCompressSync(content, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
    });
    return bodyFor.brotli;
  }
  return content;
}

function serveSSX2012(req, res, pathname) {
  const isPreview = pathname === SSX_V37_PREVIEW_ROUTE || pathname === SSX_V37_PREVIEW_ROUTE + '/';
  if (pathname !== SSX_ROUTE && pathname !== SSX_ROUTE + '/' && !isPreview) return false;
  const method = String(req.method || '').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    res.end(); return true;
  }
  if (pathname === SSX_ROUTE + '/' || pathname === SSX_V37_PREVIEW_ROUTE + '/') {
    res.writeHead(308, { Location: isPreview ? SSX_V37_PREVIEW_ROUTE : SSX_ROUTE, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    res.end(); return true;
  }
  loadBundle();
  if (!content) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag':'noindex' });
    res.end(method === 'HEAD' ? undefined : 'SSX temporarily unavailable');
    return true;
  }
  // NO allow-same-origin: this document has an opaque browser origin and cannot
  // make authenticated same-origin requests to ZVM or read its cookies/storage.
  const csp = [
    'sandbox allow-scripts allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads',
    "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"
  ].join('; ');
  const encoding = pickEncoding(req.headers['accept-encoding']);
  let body, etag;
  try {
    body = isPreview ? v37BodyFor(encoding) : bodyFor(encoding);
    etag = isPreview
      ? '"ssx37preview-' + v37Preview.hash.slice(0, 24) + '-' + encoding + '"'
      : '"ssx36-' + SHA256.slice(0, 24) + '-' + encoding + '"';
  } catch (cause) {
    console.error('[SSX-HOBBY] Preview failed without affecting v36:', cause.message);
    res.writeHead(503, { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store', 'X-Robots-Tag':'noindex' });
    res.end(method === 'HEAD' ? undefined : 'SSX preview temporarily unavailable');
    return true;
  }
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': isPreview ? 'no-store' : 'public, max-age=300',
    ETag: etag,
    Vary: 'Accept-Encoding',
    'Content-Length': body.length,
    'Content-Security-Policy': csp,
    'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
  if (isPreview) headers['X-SSX-Variant'] = 'alpine-v37-preview';
  if (encoding !== 'identity') headers['Content-Encoding'] = encoding;
  if (String(req.headers['if-none-match'] || '').trim() === etag) {
    delete headers['Content-Length'];
    res.writeHead(304, headers); res.end(); return true;
  }
  res.writeHead(200, headers);
  res.end(method === 'HEAD' ? undefined : body);
  return true;
}

module.exports = { serveSSX2012, SSX_ROUTE, SSX_V37_PREVIEW_ROUTE, SHA256 };