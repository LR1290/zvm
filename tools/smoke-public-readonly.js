'use strict';
// R46.57: public GET-only smoke test. Never sends cookies, tokens or POST/PUT.
// Only public pages and assets; no customer data is logged or saved.
const DEFAULT_ORIGIN = 'https://zvm.onrender.com';
const PAGE_PATHS = Object.freeze([
  '/', '/termos?lang=pt-BR', '/termos?lang=pt-PT', '/termos?lang=en',
  '/privacidade', '/faq', '/planos', '/googleb72a9c76039b24b4.html',
]);
function canonicalOrigin(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.hash || url.search || url.pathname !== '/' || !url.hostname ||
      !/^[a-z0-9.-]+$/i.test(url.hostname)) throw Error('invalid_smoke_origin');
  return url.origin;
}
function contentTypeForAsset(asset) {
  if (/\.css$/i.test(asset)) return /^text\/css(?:;|$)/i;
  if (/\.js$/i.test(asset)) return /^(?:text|application)\/javascript(?:;|$)/i;
  if (/\.(?:png|jpe?g|webp|svg|ico)$/i.test(asset)) return /^image\//i;
  return null;
}
function linksFromPublicPage(html) {
  // Asset references are root-relative; reject arbitrary external hosts.
  return [...new Set([...String(html).matchAll(/\b(?:href|src)="(\/assets\/[a-zA-Z0-9._/-]+)"/g)]
    .map(match => match[1]))];
}
async function request(origin, resource, fetcher, timeoutMs) {
  const url = new URL(resource, origin);
  if (url.origin !== origin) throw Error('smoke_cross_origin_denied');
  // AbortSignal.timeout remains active until response body is consumed.
  const response = await fetcher(url.href, {
    method: 'GET', redirect: 'manual', credentials: 'omit',
    headers: { Accept: resource === '/ready' ? 'application/json' : '*/*' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status !== 200) throw Error('smoke_http_' + response.status + ':' + resource);
  if (response.headers?.get?.('location')) throw Error('smoke_unexpected_redirect:' + resource);
  return response;
}
async function audit({origin = DEFAULT_ORIGIN, fetcher = fetch, timeoutMs = 8000} = {}) {
  origin = canonicalOrigin(origin);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000)
    throw Error('smoke_invalid_timeout');
  const ready = await request(origin, '/ready', fetcher, timeoutMs);
  if (!/^application\/json(?:;|$)/i.test(ready.headers.get('content-type') || ''))
    throw Error('smoke_ready_json_missing');
  const readyBody = await ready.text();
  if (readyBody.length > 4096 || JSON.parse(readyBody).ok !== true)
    throw Error('smoke_unready');
  const assets = new Set();
  for (const resource of PAGE_PATHS) {
    const response = await request(origin, resource, fetcher, timeoutMs);
    const contentType = response.headers.get('content-type') || '';
    if (resource !== '/googleb72a9c76039b24b4.html' && !/^text\/html(?:;|$)/i.test(contentType))
      throw Error('smoke_page_mime:' + resource);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 750000) throw Error('smoke_page_oversized:' + resource);
    const body = await response.text();
    if (body.length > 750000) throw Error('smoke_page_oversized:' + resource);
    if (resource.startsWith('/termos') && !/terms-index|terms-main|terms-toc/.test(body))
      throw Error('smoke_terms_document_missing');
    for (const asset of linksFromPublicPage(body)) assets.add(asset);
  }
  for (const asset of [...assets].sort()) {
    const expected = contentTypeForAsset(asset);
    if (!expected || asset.includes('..')) throw Error('smoke_unknown_asset_type');
    const response = await request(origin, asset, fetcher, timeoutMs);
    const ct = response.headers.get('content-type') || '';
    if (!expected.test(ct)) throw Error('smoke_asset_mime:' + asset);
    // Do not retrieve private data or log response bodies.
    await response.body?.cancel?.();
  }
  return {ok:true,pages:PAGE_PATHS.length,assets:assets.size,checks:1+PAGE_PATHS.length+assets.size,readOnly:true};
}
if (require.main === module) audit({origin:process.env.ZVM_SMOKE_ORIGIN || DEFAULT_ORIGIN})
  .then(report => console.log(JSON.stringify(report)))
  .catch(e => {console.error('Public smoke failed:', String(e?.message||'error').slice(0,160)); process.exitCode=1;});
module.exports = {canonicalOrigin,contentTypeForAsset,linksFromPublicPage,audit};
