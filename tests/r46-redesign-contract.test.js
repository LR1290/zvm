'use strict';
const assert = require('node:assert/strict');
const { createLandingRenderer } = require('../src/web/public/landing/render');
const { localizePublicHtml } = require('../src/web/public/i18n');
const store='https://chromewebstore.google.com/detail/zvm/verified-id';
const render=createLandingRenderer({escHtml:s=>String(s),favicon:'data:,',sharedCssLink:'',landingCssLink:'',chromeStoreUrl:store,chromeStoreBadge:()=>`<a class="chrome-store-banner" href="${store}" data-shared-badge="yes">Chrome Web Store</a>`,publicNav:()=>'<nav class="znav standalone-nav"><div class="znav-main-links"></div></nav>'});
const html=render();
const hero=html.split('</section>')[0];
assert.match(hero,/<h1>Organize o atendimento\./,'restored human-facing hero H1');
assert.match(hero,/r466-hero-centered/,'hero uses original centered composition');
assert.equal((hero.match(/class="r466-btn /g)||[]).length,1,'one exploration CTA plus canonical store badge');
assert.match(hero,/data-scroll-target="produto"/,'see product CTA');
assert.match(hero,/href="https:\/\/chromewebstore\.google\.com/,'official store CTA');
assert.doesNotMatch(hero,/r4611-hero-orbits/,'no decorative orbits');
assert.equal((hero.match(/data-shared-badge="yes"/g)||[]).length,1,'reused official banner');
assert.match(hero,/ativação requer uma licença/i);
assert.ok(html.indexOf('id="produto"')<html.indexOf('id="recursos"'));
assert.match(html,/r466-benefit-grid/,'three benefit groups');
assert.match(html,/class="r466-feature-explore"/,'progressive disclosure');
assert.match(html,/href="\/planos"/,'one canonical purchase page');
for(const [locale,needle] of [['pt-BR','Organize o atendimento.'],['pt-PT','Organize o atendimento.'],['en','Streamline your customer conversations.']]) {
  const out=localizePublicHtml(html,locale,{path:'/'});
  assert.match(out,new RegExp(needle),locale+' localized main heading');
  if(locale==='en'){assert.doesNotMatch(out,/Seu dia mais leve\.|Sua rotina|Conheça a ZVM por dentro/);assert.match(out,/aria-label="Dashboard areas"/,'ARIA labels must be localized');assert.match(out,/alt="ZVM overview screenshot"/,'real screenshot tab alt must be localized');}
}
console.log('R46.26 restored centered hero contract: PASS');
