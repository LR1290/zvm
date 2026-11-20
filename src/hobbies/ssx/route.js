'use strict';

// Independent hobby page. It does not import or touch ZVM authentication/business state.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { SSX_FAVICON_ROUTE, serveSSXFavicon } = require('./official-favicon');
const ssxAuth = require('./admin-auth');

const SSX_ROUTE = '/hobbies/ssx/ssx2012';
const SSX_V36_ARCHIVE_ROUTE = '/hobbies/ssx/ssx2012-v36';
const SSX_V37_PREVIEW_ROUTE = '/hobbies/ssx/ssx2012-alpine-v37-preview';
const SSX_BUNDLE_SHA256 = 'f80d0760eeb18042a081279f27da96e05dc5f7ed4362bc72e6a4739043897a5a';
const SHA256 = 'd99aa1caaf9e9833ff85f899119043cbddaca66ce9bc9aa5f256990d331e42f0';
const PARTS = 10;

// Read-only locally hosted SSX art: no browser hotlinking or arbitrary proxy URLs.
// All assets are checksummed original publisher/gameplay JPEGs from the documented
// non-commercial fan-site source manifest. No third-party trackers or scripts.
const SSX_MEDIA_BASE = '/hobbies/ssx/media/v37/';
const SSX_MEDIA_CHECKSUMS = Object.freeze({
  'hero.jpg':'99cf7fcd0ef11f126d0dc99a0348e23102b8cc61b3bd10b41045865709e907e0',
  'riders.jpg':'18bacc3cc35437ad4c2ebbfa8a7a00bcb1549a76dfd0e096f8b243b4f24daa3d',
  'race.jpg':'d5534816c1594e79a4129deb9117bb885978f095a4d6d99fecc81b069abbb9af',
  'trick.jpg':'365cc65d952994c21515676954c466747e3f11fea6cdc3e73e092c79d38137d2',
  'survive.jpg':'50f71d71764261dde17ef03ff38f3a700c214e7a3cfa59d65c063f4b67c1bd6e'
});
const mediaCache = new Map();

function serveSSXMedia(req,res,pathname) {
  if (!pathname.startsWith(SSX_MEDIA_BASE)) return false;
  const filename = pathname.slice(SSX_MEDIA_BASE.length);
  const expected = Object.prototype.hasOwnProperty.call(SSX_MEDIA_CHECKSUMS, filename)
    ? SSX_MEDIA_CHECKSUMS[filename] : null;
  if (!expected) return false;
  const method=String(req.method||'').toUpperCase();
  if(method!=='GET'&&method!=='HEAD'){
    res.writeHead(405,{Allow:'GET, HEAD','Cache-Control':'no-store','X-Robots-Tag':'noindex'});
    res.end();
    return true;
  }
  let data=mediaCache.get(filename);
  if(!data){
    try {
      const candidate=fs.readFileSync(path.join(__dirname,'media','v37',filename));
      if(candidate.length<1024 || candidate.length>500000 || candidate.subarray(0,3).toString('hex')!=='ffd8ff'
        || crypto.createHash('sha256').update(candidate).digest('hex')!==expected) {
        throw new Error('SSX_MEDIA_HASH_OR_FORMAT_MISMATCH');
      }
      data=candidate;mediaCache.set(filename,data);
    } catch(cause){
      console.error('[SSX-HOBBY] Artwork unavailable; rankings unaffected:',cause.code||cause.message);
      res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex'});
      res.end(method==='HEAD'?undefined:'Media unavailable');
      return true;
    }
  }
  // An opaque sandboxed HTML document is cross-origin even on the same domain.
  // CORP cross-origin is safe here because these five images are non-authenticated.
  const etag='"ssx37-media-'+expected.slice(0,24)+'"';
  const headers={
    'Content-Type':'image/jpeg',
    'Content-Length':data.length,
    'Cache-Control':'public, max-age=86400',
    'ETag':etag,
    'X-Content-Type-Options':'nosniff',
    'X-Robots-Tag':'noindex, nofollow, noarchive',
    'Cross-Origin-Resource-Policy':'cross-origin',
    'Access-Control-Allow-Origin':'*',
    'Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'none'; object-src 'none'; frame-ancestors 'none'"
  };
  if(String(req.headers['if-none-match']||'').trim()===etag){
    delete headers['Content-Length'];
    res.writeHead(304,headers);res.end();return true;
  }
  res.writeHead(200,headers);
  res.end(method==='HEAD'?undefined:data);
  return true;
}
let content = null;
let packed = null;
let error = false;
let v37Preview = null;
const ssxSiteVariants = new Map();

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

// Alpine v37.2 is a progressive enhancement of the exact, hash-verified v36
// payload and record dataset. The /ssx2012-v36 archive remains byte-identical.
function loadV37Preview() {
  if (v37Preview) return v37Preview;
  const css = fs.readFileSync(path.join(__dirname, 'alpine-v37.css'), 'utf8');
  // V38 presentation is a standalone, audited design system. Keep the
  // original rules solely as compatibility for unmodified archived controls.
  const design = fs.readFileSync(path.join(__dirname, 'design-v38.css'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, 'alpine-v37.js'), 'utf8');
  const scoreIntegrity = fs.readFileSync(path.join(__dirname, 'score-integrity.js'), 'utf8');
  const specialJs = fs.readFileSync(path.join(__dirname, 'special-categories-v1.js'), 'utf8');
  const specialLeaderJs = fs.readFileSync(path.join(__dirname, 'special-leaders-core.js'), 'utf8');
  // R84 is optional, UI-only and isolated. A missing asset must never downgrade
  // the live v38 site or prevent viewing the archived rankings.
  let rankingStyle = '', rankingScript = '';
  try {
    rankingStyle = fs.readFileSync(path.join(__dirname, 'ranking-r84.css'), 'utf8');
    rankingScript = fs.readFileSync(path.join(__dirname, 'ranking-r84.js'), 'utf8');
    if (!rankingStyle || !rankingScript || rankingStyle.length > 30000 || rankingScript.length > 12000
      || /<\/style/i.test(rankingStyle) || /<\/script/i.test(rankingScript)) {
      throw new Error('SSX_R84_ASSET_VALIDATION');
    }
  } catch (cause) {
    rankingStyle = '';
    rankingScript = '';
    console.error('[SSX-HOBBY] R84 optional ranking UI unavailable, retaining v38:', cause.code || cause.message);
  }
  if (/<\/style/i.test(css) || /<\/style/i.test(design) || /<\/script/i.test(js) || /<\/script/i.test(scoreIntegrity) || /<\/script/i.test(specialJs) || /<\/script/i.test(specialLeaderJs)) {
    throw new Error('SSX_V37_UNSAFE_INLINE_ASSET');
  }
  const original = content.toString('utf8');

  // The former loading splash was a second, visibly different page.
  // Hold only the final page's paint until its own controls are ready.
  // No duplicate hero/nav and no simulated loading progress is created.
  const firstPaintStyle = String.raw`
html{background:#07131d;color-scheme:dark}
html:not([data-ssx-boot="ready"]):not([data-ssx-boot="fallback"]) body{visibility:hidden}
`;
  // If the engine fails, expose the real v36 content rather than trapping
  // visitors on an indefinite blank loading face. This timer creates no UI.
  const bootGuard = '<script id="ssx-boot-fallback">setTimeout(function(){'
    + 'var root=document.documentElement;'
    + 'if(root.dataset.ssxBoot==="ready")return;'
    + 'root.dataset.ssxBoot="fallback";'
    + '},15000);</script>';

  if (!/<\/head\s*>/i.test(original) || !/<\/body\s*>/i.test(original)) {
    throw new Error('SSX_V37_DOCUMENT_ANCHOR_MISSING');
  }
  const updated = original
    .replace(/<\/head\s*>/i, '<style id="ssx-first-paint-style">\n' + firstPaintStyle + '\n</style>' + bootGuard + '<style id="ssx-alpine-v37-style">\n' + css + '\n</style><style id="ssx-v38-design">\n' + design + '\n</style>' + (rankingStyle ? '<style id="ssx-r84-rank-style">\n' + rankingStyle + '\n</style>' : '') + '</head>')
    .replace(/<\/body\s*>/i, '<script id="ssx-score-integrity-script">\n' + scoreIntegrity + '\n</script>' + '<script id="ssx-alpine-v37-script">\n' + js + '\n</script>' + '<script id="ssx-special-leaders-core-script">\n' + specialLeaderJs + '\n</script>' + '<script id="ssx-special-categories-v1-script">\n' + specialJs + '\n</script>' + (rankingScript ? '<script id="ssx-r84-rank-script">\n' + rankingScript + '\n</script>' : '') + '</body>')
    .replace(/<title>[^<]*<\/title>/i, '<title>SSX 2012 · Recordes da Comunidade</title>')
    .replace(/<\/head\s*>/i, '<link rel="icon" type="image/png" href="' + SSX_FAVICON_ROUTE + '?v=ea-original-white-r87"></head>');
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


// Public live sync configuration is server-owned. Never trust a browser-provided
// spreadsheet URL, and never embed an administrator/bot secret in HTML.
function publicBridgeEndpoint() {
  const raw=String(process.env.SSX_PUBLIC_BRIDGE_URL||'').trim();
  try {
    const u=new URL(raw);
    if(u.protocol!=='https:' || u.hostname.toLowerCase()!=='script.google.com' ||
      !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname) || u.search || u.hash || u.username || u.password) return '';
    return u.toString();
  } catch {return '';}
}
function configureLiveEndpoint(html, admin) {
  const before="function loadLiveConfig(){LIVE_STATE.endpoint=normalizeAdminEndpoint(safeGet('ssx.live.endpoint','')||safeGet('ssx.admin.endpoint',''));";
  const configured=JSON.stringify(publicBridgeEndpoint());
  const replacement="function loadLiveConfig(){LIVE_STATE.endpoint=normalizeAdminEndpoint("+configured+
    (admin?"||safeGet('ssx.live.endpoint','')||safeGet('ssx.admin.endpoint','')":"")+");";
  if(!html.includes(before))throw new Error('SSX_LIVE_CONFIG_ANCHOR_MISSING');
  return html.replace(before,replacement);
}
// The existing v36 frontend initializes its moderation inputs even when they
// are unused. Replace the actual admin panels server-side with inert hidden
// compatibility stubs: no privileged panel/configuration is shipped to players.
function replaceDivById(html,id,replacement) {
  const startPattern=new RegExp('<div\\b[^>]*\\bid="'+id+'"[^>]*>','i');
  const found=startPattern.exec(html);
  if(!found)throw new Error('SSX_PUBLIC_REDACTION_ANCHOR_MISSING:'+id);
  const start=found.index;
  const matcher=/<\/?div\b[^>]*>/gi;
  matcher.lastIndex=start+found[0].length;
  let depth=1,match;
  while((match=matcher.exec(html))) {
    if(/^<\//.test(match[0]))depth--;
    else depth++;
    if(depth===0)return html.slice(0,start)+replacement+html.slice(matcher.lastIndex);
  }
  throw new Error('SSX_PUBLIC_REDACTION_UNBALANCED:'+id);
}
function sanitizeSSXPublic(html) {
  const adminInputs=['adminRider','adminResult','adminEvidence','adminEndpoint','adminToken'];
  const adminSelects=['adminKind','adminCountry','adminRegion','adminTrack'];
  const adminButtons=['adminPreviewBtn','adminSyncBtn','adminSaveBridge','adminPing'];
  const adminMarkup='<div id="adminModal" class="overlay" hidden aria-hidden="true">'+
    adminInputs.map(id=>'<input type="text" id="'+id+'" hidden>').join('')+
    adminSelects.map(id=>'<select id="'+id+'" hidden></select>').join('')+
    adminButtons.map(id=>'<button type="button" id="'+id+'" hidden></button>').join('')+
    '<div id="adminCountryFlag"></div><span id="adminResultHelp"></span>'+
    '<span id="adminResultIcon"></span><div id="adminPreview"></div>'+
    '<div id="adminBridgeStatus"></div></div>';
  const submissionsMarkup='<div id="submissionsModal" class="overlay" hidden aria-hidden="true">'+
    '<input id="discordApiEndpoint" hidden><input id="discordAdminKey" hidden>'+
    '<div id="discordStatus"></div><div id="submissionsList"></div></div>';
  const publicSources='<div id="dataModal" class="overlay" aria-hidden="true">'+
    '<div class="modal narrow"><div class="modal-head"><h2>Dados e fontes</h2>'+
    '<button class="btn close" type="button" data-close="dataModal">×</button></div>'+
    '<div class="modal-body"><p>Fontes históricas: Google Sheets e arquivo Ozmonet (2017). '+
    'O arquivo offline permanece disponível caso o Live Sync esteja indisponível.</p>'+
    '<p>Os rankings públicos são somente leitura. A configuração das integrações e a moderação '+
    'são exclusivas da administração.</p><div id="selfAuditStatus"></div></div></div></div>';
  html=replaceDivById(html,'adminModal',adminMarkup);
  html=replaceDivById(html,'submissionsModal',submissionsMarkup);
  html=replaceDivById(html,'dataModal',publicSources);
  for(const id of ['adminBtn','submissionsBtn']){
    const pattern=new RegExp('<button\\b(?=[^>]*\\bid="'+id+'")[^>]*>[\\s\\S]*?<\\/button>','i');
    if(!pattern.test(html))throw new Error('SSX_PUBLIC_REDACTION_BUTTON_MISSING:'+id);
    html=html.replace(pattern,'<button id="'+id+'" type="button" hidden aria-hidden="true"></button>');
  }
  const hide='<style id="ssx-public-security">[hidden]{display:none!important}'+
    '#ssxManagement,#ssxManagementLabel,#adminBtn,#submissionsBtn,'+
    '[data-ssx-action="adminBtn"],[data-ssx-action="submissionsBtn"],'+
    '[data-ssx-mobile-label="admin"],[data-ssx-mobile-label="submissions"]{display:none!important}</style>';
  if(!/<\/head\s*>/i.test(html))throw new Error('SSX_PUBLIC_HEAD_MISSING');
  return html.replace(/<\/head\s*>/i,hide+'</head>');
}
function siteVariant(admin=false,fallback=false) {
  const key=(admin?'admin':'public')+(fallback?'-fallback':'');
  if(ssxSiteVariants.has(key))return ssxSiteVariants.get(key);
  const original=fallback?content.toString('utf8'):loadV37Preview().content.toString('utf8');
  const html=configureLiveEndpoint(admin?original:sanitizeSSXPublic(original),admin);
  const data=Buffer.from(html,'utf8');
  const variant={content:data,hash:crypto.createHash('sha256').update(data).digest('hex'),gzip:null,br:null};
  ssxSiteVariants.set(key,variant);
  return variant;
}
function siteBodyFor(encoding,admin=false,fallback=false) {
  const variant=siteVariant(admin,fallback);
  if(encoding==='gzip'){
    if(!variant.gzip)variant.gzip=zlib.gzipSync(variant.content,{level:6});
    return variant.gzip;
  }
  if(encoding==='br'){
    if(!variant.br)variant.br=zlib.brotliCompressSync(variant.content,{
      params:{[zlib.constants.BROTLI_PARAM_QUALITY]:4}
    });
    return variant.br;
  }
  return variant.content;
}

function serveSSX2012(req, res, pathname) {
  if(serveSSXFavicon(req,res,pathname))return true;
  if(serveSSXMedia(req,res,pathname))return true;
  if(ssxAuth.handleAuth(req,res,pathname))return true;
  const isAdmin=pathname===ssxAuth.BASE;
  const isAdminArchive=pathname===ssxAuth.BASE+'/archive';
  const isLegacyArchive=pathname===SSX_V36_ARCHIVE_ROUTE || pathname===SSX_V36_ARCHIVE_ROUTE+'/';
  if(isLegacyArchive){
    res.writeHead(303,{Location:ssxAuth.BASE+'/archive','Cache-Control':'no-store',
      'X-Robots-Tag':'noindex'});res.end();return true;
  }
  const isPreview = pathname === SSX_V37_PREVIEW_ROUTE || pathname === SSX_V37_PREVIEW_ROUTE + '/';
  const isArchive = isAdminArchive;
  const isPublic = pathname === SSX_ROUTE || pathname === SSX_ROUTE + '/';
  if (!isPublic && !isPreview && !isArchive && !isAdmin) return false;
  const method = String(req.method || '').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    res.end(); return true;
  }
  if (pathname === SSX_ROUTE + '/' || pathname === SSX_V37_PREVIEW_ROUTE + '/' || pathname === SSX_V36_ARCHIVE_ROUTE + '/') {
    res.writeHead(308, { Location: isPreview ? SSX_V37_PREVIEW_ROUTE : isArchive ? SSX_V36_ARCHIVE_ROUTE : SSX_ROUTE, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
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
  let body, etag, fallback = false;
  try {
    body = isArchive ? bodyFor(encoding) : siteBodyFor(encoding,isAdmin,false);
    etag = isArchive
      ? '"ssx36-' + SHA256.slice(0,24) + '-' + encoding + '"'
      : '"ssx39-' + (isAdmin?'admin-':isPreview?'preview-':'public-')+
        siteVariant(isAdmin,false).hash.slice(0,24) + '-' + encoding + '"';
  } catch (cause) {
    console.error('[SSX-HOBBY] Alpine v37 unavailable:', cause.code || cause.message);
    if (isPublic) {
      // Keep the original public address usable if Alpine assets fail to load.
      fallback = true;
      try {
        body=siteBodyFor(encoding,false,true);
        etag='"ssx39public-fallback-'+siteVariant(false,true).hash.slice(0,24)+'-'+encoding+'"';
      } catch(redactionError) {
        res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
        res.end(method==='HEAD'?undefined:'SSX temporarily unavailable');return true;
      }
    } else {
      res.writeHead(503, { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store', 'X-Robots-Tag':'noindex' });
      res.end(method === 'HEAD' ? undefined : 'SSX preview temporarily unavailable');
      return true;
    }
  }
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': isPreview || fallback || isAdmin || isArchive ? 'no-store, private' : 'public, max-age=300',
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
  headers['X-SSX-Variant'] = isAdmin ? 'ssx-admin-v39' : isPreview ? 'ssx-ui-v39-preview'
    : isArchive ? 'v36-archive-auth' : fallback ? 'v36-public-redacted' : 'ssx-ui-v39-public';
  if (encoding !== 'identity') headers['Content-Encoding'] = encoding;
  if (String(req.headers['if-none-match'] || '').trim() === etag) {
    delete headers['Content-Length'];
    res.writeHead(304, headers); res.end(); return true;
  }
  res.writeHead(200, headers);
  res.end(method === 'HEAD' ? undefined : body);
  return true;
}

module.exports = { serveSSX2012, serveSSXMedia, SSX_ROUTE, SSX_V36_ARCHIVE_ROUTE, SSX_MEDIA_BASE, SSX_V37_PREVIEW_ROUTE, SHA256, publicBridgeEndpoint, sanitizeSSXPublic, ssxAuth };