'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { createLandingRenderer } = require('../src/web/public/landing/render');
const storeUrl = 'https://chromewebstore.google.com/detail/zvm-automa%C3%A7%C3%B5es/fixture';
const chromeStoreBadge = () => `<a class="chrome-store-banner" href="${storeUrl}" target="_blank" rel="noopener noreferrer" aria-label="Instalar a ZVM pela Chrome Web Store" data-shared-badge="yes"><span class="chrome-store-mark"><svg viewBox="0 0 48 48"></svg></span><span class="chrome-store-copy"><small>Disponível na Chrome Web Store</small><strong>ZVM - Automações</strong><span>Extensão oficial</span></span></a>`;
const render = createLandingRenderer({
  plans:{solo:{id:'solo',price:39.9,maxUses:1,durationDays:30},padrao:{id:'padrao',price:59.9,maxUses:3,durationDays:30},pro:{id:'pro',price:94.9,maxUses:5,durationDays:30},empresarial:{id:'empresarial',price:169.9,maxUses:10,durationDays:30}},
  plans:{solo:{id:'solo',shortName:'Solo',price:39.9,maxUses:1,durationDays:30},padrao:{id:'padrao',shortName:'Padrão',price:59.9,maxUses:3,durationDays:30},pro:{id:'pro',shortName:'Pro',price:94.9,maxUses:5,durationDays:30},empresarial:{id:'empresarial',shortName:'Empresarial',price:169.9,maxUses:10,durationDays:30}},
  escHtml: s => String(s), favicon: 'data:;',
  sharedCssLink:'', landingCssLink:'', chromeStoreUrl: storeUrl,
  chromeStoreBadge, publicNav: () => '<nav class="znav standalone-nav"><a href="/#produto">Ferramenta</a><a href="/#recursos">Recursos</a><a href="/planos">Planos</a><a href="/faq">FAQ</a></nav>',
});
const html = render(null);
assert.match(html, /class="r4618-hero-store"/, 'dedicated placement for shared client portal banner');
assert.match(html, /data-shared-badge="yes"/, 'actual shared Chrome Store badge markup reused rather than reinvented');
assert.match(html, /Instalação gratuita/,'free installation distinguished from license purchase');
assert.match(html, /ativação requer uma licença|ativação exige uma licença/i, 'clarifies license requirement');
assert.equal((html.match(/data-shared-badge="yes"/g)||[]).length, 1, 'do not duplicate the prominent badge');
assert.doesNotMatch(html, /class="price-card/, 'landing must not duplicate the four purchase cards');
assert.equal((html.match(/class="r4624-plan-card/g)||[]).length,4,'public plan teasers present');assert.match(html,/href="\/planos\?plano=padrao"/,'price cards link to canonical plan details');
assert.match(html, /data-scroll-target="produto"/, 'hero CTA navigates to product section');
assert.match(html, /id="produto"/, 'product anchor exists');
assert.match(html, /id="recursos"/, 'features anchor exists');
assert.match(html, /id="planos"/, 'plans summary anchor exists');
assert.match(html, /id="faq"/, 'faq anchor exists');
assert.match(html, /zvm-r46-landing-navigation\.[0-9a-f]{12}\.js/, 'shared navigation behavior loaded');
assert.doesNotMatch(html, /scrollIntoView\(\{behavior:'smooth'/, 'old scroll with no sticky header compensation removed');
const cssName = /zvm-r46-landing\.[0-9a-f]{12}\.css/.exec(fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'))?.[0];
assert.ok(cssName, 'content-addressed landing stylesheet registered');
const css = fs.readFileSync(path.join(__dirname,'../assets', cssName),'utf8');
assert.match(css, /\.r4618-hero-store\s*\{/, 'badge placement styled');
assert.match(css, /@media\s*\(max-width:\s*\d+px\)/, 'responsive fallback exists');
assert.match(css, /@keyframes r4623/, 'ambient motion remains');
assert.match(css, /prefers-reduced-motion:reduce/, 'reduced motion support stays intact');
const jsName = /zvm-r46-landing-navigation\.[0-9a-f]{12}\.js/.exec(html)?.[0];
assert.ok(jsName, 'landing navigation asset referenced');
const behavior = fs.readFileSync(path.join(__dirname,'../assets', jsName),'utf8');
assert.match(behavior, /getBoundingClientRect/, 'uses actual geometry for measured header offset');
assert.match(behavior, /prefers-reduced-motion: reduce/, 'honors reduced motion');
assert.match(behavior, /\.znav/, 'sticky header measured');
assert.match(behavior, /IntersectionObserver/, 'nav active state tracks sections');
const server = fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
assert.match(server, /chromeStoreBadge: renderChromeStoreBadge/, 'landing injects the actual customer-portal badge renderer');
assert.match(server, /sharedCssLink: _CSS_SHARED \+ _CSS_STANDALONE/, 'same responsive navigation CSS used as customer pages');
for (const [fileName, type] of [[cssName,'text/css'],[jsName,'application/javascript']]) {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../assets', fileName))).digest('hex');
  assert.equal(fileName.split('.').at(-2), sha.slice(0,12), type + ' filename matches contents');
  assert.ok(server.includes(`sha256: '${sha}'`), type + ' registered asset hash matches contents');
}

console.log('R46.23 landing UX contract: PASS');
