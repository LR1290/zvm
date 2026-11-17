'use strict';
// R50 forensic regression: site nav must not inherit the R46 legacy !important
// type rules on public pages, but private client/admin styling remains unchanged.
const assert = require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const server=read('server.js');
const legacyPath='assets/zvm-r46-system.cf01433d7f45.css';
const legacy=read(legacyPath);
const site=read('assets/zvm-owner-site.e10ede63c1f0.css');
const owner=read('assets/zvm-sales-owner.a610cb96b94d.css');
const check=(part)=>assert(legacy.includes(part),'legacy font isolation missing: '+part);

assert(!fs.existsSync(path.join(root,'assets/zvm-r46-system.aa366d924866.css')),
  'obsolete R46 CSS remains reachable');
assert(server.includes('/assets/zvm-r46-system.cf01433d7f45.css'),
  'server must mount the scoped stylesheet');
assert(server.includes("sha256: 'cf01433d7f45c6054eefdc7a33b8f80c225b94bbe2c927b04a1ebe1809a79b6b'"));
check('body:not(.zvm-public-premium) .znav{min-height:72px!important;height:72px!important;');
check('body:not(.zvm-public-premium) .znav-links a{font-size:15px!important;font-weight:650!important}');
check('body:not(.zvm-public-premium) .znav-links{gap:10px!important}');
check('body:not(.zvm-public-premium) .znav-links a.nav-active{');
check('body:not(.zvm-public-premium) .nav-cta,.nav-store{border-radius:12px!important');
check('body:not(.zvm-public-premium) .znav-brand,.page-hero-tag');
check('body:not(.zvm-public-premium) button,body:not(.zvm-public-premium) input');
assert(!/\.znav-links a\{font-size:15px!important/.test(legacy.replaceAll(
  'body:not(.zvm-public-premium) .znav-links a{font-size:15px!important','PUBLIC_FONT_SCOPED'
)), 'unscoped important nav font persists');
assert(!/(^|[\n;}])\.znav\{/.test(legacy),'unscoped height selector remains');
assert(!/(^|[\n;}])\.znav-links\{/.test(legacy),'unscoped gap selector remains');
// Canonical public rule applies to ALL five server-rendered pages.
assert(site.includes('body.zvm-public-premium .znav .znav-main-links>a{'));
assert(site.includes('font-size:14px;font-weight:650'));
assert(site.includes('font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'));
assert(site.includes('body.zvm-public-premium .znav .znav-action-links>a'));
assert(site.includes('body.zvm-public-premium .znav .znav-action-links>a.nav-cta'));
assert(!owner.includes('.znav-main-links>a{'), 'homepage must not override header link typography');
assert(server.includes("['/', '/planos', '/faq', '/privacidade', '/termos'].includes(currentPath)"));
assert(server.includes('publicNavHtml: _sharedNav({activePath:'));
assert(!legacy.includes('body.zvm-public-premium .znav-links a{font-size:15px!important'));
console.log('R50: canonical site font 14px/650, legacy 15px!important isolated from all public pages');
