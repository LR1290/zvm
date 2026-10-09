'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {languageOptionsMarkup,localizePublicHtml}=require('../src/web/public/i18n');
const srv=fs.readFileSync('server.js','utf8');
for(const locale of ['pt-BR','pt-PT','en']){
 const markup=languageOptionsMarkup(locale,'/privacidade');
 assert.match(markup,/<svg[^>]+viewBox="0 0 24 16"/,'flag must have its own vector rendering; Windows emoji cannot regress to BR');
 assert.equal((markup.match(/<svg /g)||[]).length,4,'one current and three option flags');
 assert.match(markup,/href="\/privacidade\?lang=pt-PT"/,'keep current page');
 assert.match(markup, /aria-label="(?:Choose language|Escolher idioma)"/);
}
assert.match(srv,/\$\{_sharedNav\(\{activePath:'\/privacidade',portalUser,showBack:true\}\)\}/,'privacy must use canonical public navigation');
const priv=srv.slice(srv.indexOf('function renderPrivacyPage'),srv.indexOf('// ────────────',srv.indexOf('function renderPrivacyPage')));
assert.match(priv,/_CSS_STANDALONE/,'privacy must load same header CSS as plans');
const css=fs.readFileSync('assets/'+fs.readdirSync('assets').find(n=>/^zvm-privacy\.[\da-f]{12}\.css$/.test(n)),'utf8');
assert.match(css,/\.page-hero\s*>\s*p\s*\{[^}]*margin-inline:\s*auto/,'privacy update date must be centered');
const navCss=fs.readFileSync('assets/'+fs.readdirSync('assets').find(n=>/^zvm-standalone\.[a-f0-9]{12}\.css$/.test(n)),'utf8');
assert.match(navCss,/\.znav-action-links \.nav-cta\{[^}]*background:var\(--g\)/,'account creation should become the primary header action');
assert.match(srv,/class="zvm-action-hub"/,'shared action hub must exist');
for(const phrase of ['Ações do painel','Mais ações'])assert.ok(srv.includes(phrase),phrase);
const actionFile=fs.readdirSync('assets').find(n=>/^zvm-action-hub\.[a-f0-9]{12}\.css$/.test(n));
assert.ok(actionFile,'one reusable action hub stylesheet');
for(const href of ['/cliente/planos','/cliente/vincular','/cliente/2fa/setup'])assert.ok(srv.includes(href),href);
assert.match(srv,/<details class="analytics-advanced">[\s\S]*?<div class="stats2">[\s\S]*?<div class="analytics-insights">[\s\S]*?<\/details>/,'Analytics secondary KPIs and insights must remain reachable through progressive disclosure');
assert.match(srv, /<span class="logo-ver">Administração<\/span>/, 'Admin interface must use a customer-facing role label rather than old version');
console.log('R46.25 navigation, flag SVG and action hub: PASS');
