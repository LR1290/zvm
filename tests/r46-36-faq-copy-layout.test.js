'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLandingRenderer } = require('../src/web/public/landing/render');
const { localizePublicHtml } = require('../src/web/public/i18n');
const cssPath = path.join(__dirname, '..', 'assets', 'zvm-r46-landing.af4c6e5c623b.css');
const landingCSS = fs.readFileSync(cssPath, 'utf8');
const render = createLandingRenderer({
  plans: {}, favicon:'data:,', sharedCssLink:'', landingCssLink:'',
  chromeStoreBadge: () => '', publicNav: () => '',
  escHtml: String
});
const markup = render(null);
const faq = markup.match(/<section class="r466-faq"[\s\S]*?<\/section>/)?.[0];
assert.ok(faq, 'FAQ section exists');
assert.match(faq, /<span>Perguntas frequentes<\/span><h2>Respostas sem complicação\.<\/h2>/);
const heading = faq.match(/<div class="r466-section-head r466-faq-head">([\s\S]*?)<\/div>/)?.[1];
assert.ok(heading, 'FAQ heading exists');
assert.doesNotMatch(heading, /<p>/, 'redundant intro paragraph must not be present');
assert.match(landingCSS, /\.r466-faq-head\{[^}]*display:flex;[^}]*flex-direction:column;/, 'FAQ heading must not inherit global two-column layout');
assert.match(landingCSS, /\.r466-faq-head h2\{[^}]*font-size:clamp\(/, 'FAQ gets a balanced dedicated typography');
for(const [lang,title] of [['pt-BR','Respostas sem complicação.'],['pt-PT','Respostas sem complicações.'],['en','Answers, made simple.']]){
 const localized = localizePublicHtml(markup,lang,{path:'/'});
 assert.ok(localized.includes(`<h2>${title}</h2>`), `${lang} FAQ title`);
 assert.ok(localized.includes(lang==='pt-BR'?'Dúvidas frequentes':lang==='en'?'Frequently asked questions':'Perguntas frequentes'),`${lang} FAQ kicker`);
 assert.ok(!localized.includes('Encontre respostas sobre instalação'), `${lang} should not show redundant description`);
}
console.log('R46.36 FAQ copy/layout/i18n: PASS');
