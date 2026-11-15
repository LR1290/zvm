'use strict';
const assert=require('assert');
const fs=require('fs');
const crypto=require('crypto');
const server=fs.readFileSync('server.js','utf8');
const renderer=fs.readFileSync('src/web/public/landing/render.js','utf8');
const m=server.match(/\/assets\/(zvm-r46-system\.([0-9a-f]{12})\.css)'[\s\S]*?sha256: '([0-9a-f]{64})'/);
assert(m,'R46 system visual asset registered');
const file='assets/'+m[1];
assert(fs.existsSync(file),'system visual CSS exists');
const body=fs.readFileSync(file);
const css=body.toString();
const sha=crypto.createHash('sha256').update(body).digest('hex');
assert.strictEqual(sha,m[3],'system css sha');
assert.strictEqual(sha.slice(0,12),m[2],'content-addressed filename');
for(const token of ['zvmWaveDrift60','zvmWaveDriftBack60','zvmBrandPulse','zvmBrandRing','zvmIconFloat','prefers-reduced-motion:reduce','prefers-contrast:more']) assert(css.includes(token),token);
for(const surface of ['.r466-plan,.price-card','.auth-form-card','.client-app-card','.sc,.sec','.analytics-hero','.admin-overview']) assert(css.includes(surface),surface);
assert(css.includes('.r466-hero::after{display:none!important}'),'landing grid disabled');
assert(!server.includes('fonts.googleapis.com'),'no Google Fonts dependency');
assert(!server.includes('zvm-canvas-bg'),'legacy canvas references removed');
assert(!server.includes('CANVAS_BG'),'legacy canvas constants removed');
assert(!fs.existsSync('assets/zvm-canvas-bg.773654a9beb3.js'),'legacy canvas asset removed');
assert(!fs.readFileSync('assets/zvm-client-dashboard.490813914538.js','utf8').includes('bg-canvas'),'legacy client particle loop removed');
const analyticsCssName=fs.readdirSync('assets').find(n=>/^zvm-analytics-dashboard\.[a-f0-9]{12}\.css$/.test(n));
const adminCssName=fs.readdirSync('assets').find(n=>/^zvm-admin-dashboard\.[a-f0-9]{12}\.css$/.test(n));
assert(adminCssName,'admin CSS found');
assert(analyticsCssName, 'analytics CSS found');
const analyticsLabCssName=fs.readdirSync('assets').find(n=>/^zvm-analytics-lab\.[a-f0-9]{12}\.css$/.test(n));
assert(analyticsLabCssName,'analytics lab CSS found');
for(const direct of [adminCssName,analyticsCssName,analyticsLabCssName,'zvm-status.be29b1782339.css','zvm-r46-client-dashboard.64213392bec3.css']){
  assert(server.includes(`<link rel="stylesheet" href="/assets/${direct}">`),direct+' stylesheet link');
}
assert(server.includes(`<link rel="stylesheet" href="/assets/${m[1]}">`),'system stylesheet link');
assert(server.includes(`${adminCssName}">\n<link rel="stylesheet" href="/assets/${m[1]}`),'admin loads system CSS after local CSS');
assert(server.includes(`${analyticsCssName}">\n<link rel="stylesheet" href="/assets/${analyticsLabCssName}">\n<link rel="stylesheet" href="/assets/${m[1]}`),'analytics loads system CSS after local and lab CSS');
{const a=server.indexOf('zvm-r46-client-dashboard.64213392bec3.css');const b=server.indexOf(m[1],a);assert(a>=0&&b>a,'client dashboard loads system CSS after local CSS');}
assert(server.includes(`zvm-status.be29b1782339.css"><link rel="stylesheet" href="/assets/${m[1]}`),'status loads system CSS after local CSS');
for(const composite of ['_CSS_LANDING + _CSS_SYSTEM','_CSS_PLANS}${_CSS_SYSTEM}','_CSS_STANDALONE}${_CSS_PRIVACY}${_CSS_SYSTEM}','_CSS_FAQ}${_CSS_SYSTEM}','_CSS_AUTH}${_CSS_CLIENT_WORKSPACE}']) assert(server.includes(composite),composite);
assert(renderer.includes('Explore a ZVM em ação.'),'public copy uses customer language');
assert(!renderer.includes('Painel da Shell'),'public Shell wording removed');
const authMatch=server.match(/\/assets\/(zvm-r46-auth\.([0-9a-f]{12})\.css)'[\s\S]*?sha256: '([0-9a-f]{64})'/);
assert(authMatch,'auth CSS registered');
const authCss=fs.readFileSync('assets/'+authMatch[1],'utf8');
assert(authCss.includes('max-width:580px') && authCss.includes('max-width:660px'),'auth forms widened');
assert(authCss.includes('justify-content:flex-start'),'auth form column remains spacious');
assert(authCss.includes('.auth-form-brand{justify-content:center'),'auth brand centered inside form');

// R47 standalone navbar replaces retired /?sec=produto and /?sec=recursos anchors.
// Keep the real navigation contract: the canonical mainLinks must contain current routes.
for(const publicLink of ["['/#recursos', 'Recursos']", "['/#como', 'Como funciona']", "['/planos', 'Planos']", "['/faq', 'FAQ']", "['/privacidade', 'Privacidade']", "['/termos', 'Termos de Serviço']"]) assert(server.includes(publicLink),'shared header link '+publicLink);
assert(server.includes("publicNav: portalUser => _sharedNav({ activePath: '/', portalUser, showBack: false })"),'landing reuses shared public nav');
assert(css.includes('zvmWaveDrift60'),'compositor-first wave motion');
assert(css.includes('translate3d'),'wave motion uses transforms');
assert(!/zvmWaveDrift60[^}]*background-position/.test(css),'new wave keyframes avoid background-position animation');
assert(css.includes('outline:2px solid #18f295'),'sharp ZVM neon focus');
console.log('R46.23 unified visual system contract: PASS');
