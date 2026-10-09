'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createLandingRenderer}=require('../src/web/public/landing/render');
const {localizePublicHtml}=require('../src/web/public/i18n');
const store='https://chromewebstore.google.com/detail/zvm/verified-fixture';
const html=createLandingRenderer({escHtml:String,favicon:'data:,',sharedCssLink:'',landingCssLink:'',plans:{},chromeStoreBadge:()=>`<a data-store-fixture="true" class="chrome-store-banner" href="${store}">ZVM - Automações</a>`,publicNav:()=>'<nav class="znav standalone-nav"><div class="znav-main-links"></div></nav>'})();
const hero=html.slice(html.indexOf('<section class="r466-hero '),html.indexOf('</section>'));
assert.match(hero,/<h1>Organize o atendimento\.[\s\S]*Automatize a rotina\.<\/em><\/h1>/,'the original centered hero headline is restored');
assert.match(hero,/r466-hero-centered/,'centered hero content used instead of two-column split');
assert.doesNotMatch(hero,/class="r466-hero-visual"/,'real app screenshot stays in product demo, not side of hero');
assert.match(hero,/r466-hero-float/,'original airy floating category accents return');
assert.equal((hero.match(/data-store-fixture="true"/g)||[]).length,1,'only one Chrome Web Store download CTA');
assert.equal((hero.match(/class="r466-btn /g)||[]).length,1,'one secondary explore CTA');
assert.match(html,/id="produto"/,'full real product demo remains below the hero');
for(const [locale,needle] of [['pt-BR','Organize o atendimento.'],['pt-PT','Organize o atendimento.'],['en','Streamline your customer conversations.']]){
 const translated=localizePublicHtml(html,locale,{path:'/'});
 assert.ok(translated.includes(needle),`hero translated for ${locale}`);
}
const css=fs.readFileSync(path.join(__dirname,'../assets',fs.readdirSync(path.join(__dirname,'../assets')).find(n=>/^zvm-r46-landing\.[a-f0-9]{12}\.css$/.test(n))),'utf8');
assert.match(css,/\.r466-hero-centered\s*\{/,'dedicated centered hero layout styles');
const plansCss=fs.readFileSync(path.join(__dirname,'../assets',fs.readdirSync(path.join(__dirname,'../assets')).find(n=>/^zvm-plans-page\.[a-f0-9]{12}\.css$/.test(n))),'utf8');
assert.match(plansCss,/\.plans-wrap \.client-plan-tags\{/, 'public pricing cards use the same in-flow badge slot as customer portal');
assert.match(plansCss,/\.plans-wrap \.client-plan-tags \.price-badge/, 'badge is contained within the card');
console.log('R46.26 centered hero + pricing badge contract: PASS');
