'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createLandingRenderer} = require('../src/web/public/landing/render');
const {localizePublicHtml, languageOptionsMarkup} = require('../src/web/public/i18n');
const store='https://chromewebstore.google.com/detail/zvm/official-id';
const plans={solo:{id:'solo',shortName:'Solo',price:39.9,maxUses:1,durationDays:30},padrao:{id:'padrao',shortName:'Padrão',price:59.9,maxUses:3,durationDays:30},pro:{id:'pro',shortName:'Pro',price:94.9,maxUses:5,durationDays:30},empresarial:{id:'empresarial',shortName:'Empresarial',price:169.9,maxUses:10,durationDays:30}};
const badge=()=>`<a class="chrome-store-banner" href="${store}" data-store-badge="canonical">ZVM - Automações</a>`;
const render=createLandingRenderer({escHtml:s=>String(s),favicon:'data:,',sharedCssLink:'',landingCssLink:'',chromeStoreUrl:store,chromeStoreBadge:badge,plans,publicNav:()=>'<nav class="znav standalone-nav"><div class="znav-main-links"></div><div class="znav-action-links"><a href="/cliente">Entrar</a></div></nav>'});
const html=render();
assert.equal((html.match(new RegExp(store,'g'))||[]).length,1,'the sole outbound store link is the canonical shared badge');
assert.equal((html.match(/data-store-badge="canonical"/g)||[]).length,1,'one official store badge');
assert.doesNotMatch(html,/Instalar gratuitamente|Instalar pela Chrome Web Store|>Instalar no Chrome</,'no competing install CTAs');
assert.match(html,/Ver como funciona/,'one secondary hero action retained');
assert.match(html,/<footer class="r466-footer">/,'footer landmark stays');
assert.match(html,/r466-footer-inner/,'footer background spans viewport; content is constrained');
assert.equal((html.match(/class="r4624-plan-card/g)||[]).length,4,'prices are visible on landing');
for(const [id,plan] of Object.entries(plans)){
 assert.ok(html.includes(`href="/planos?plano=${id}"`),`${id} points to canonical plans route`);
 assert.ok(html.includes(`data-plan-id="${id}"`),`${id} uses canonical catalog identity`);
 assert.ok(html.includes(`R$ ${plan.price.toFixed(2).replace('.',',')}`),`${id} shows live catalog value`);
}
assert.doesNotMatch(html,/https:\/\/pay\.cakto\.com\.br/,'landing never launches payment directly');
assert.doesNotMatch(html,/class="price-card/,'checkout components stay on /planos only');
for(const [locale,flag,engName] of [['pt-BR','<svg','Inglês'],['pt-PT','<svg','Inglês'],['en','<svg','English']]){
 const picker=languageOptionsMarkup(locale,'/planos');
 assert.match(picker,new RegExp(flag),`${locale} flag in picker`);
 assert.match(picker,new RegExp(engName),`${locale} correctly names English`);
 assert.match(picker,/href="\/planos\?lang=pt-PT"/,'picker keeps current route');
 assert.doesNotMatch(picker,/>PT-BR <|>PT-PT <|>EN </,'no language codes shown');
 const localized=localizePublicHtml(html,locale,{path:'/'});
 for(const id of Object.keys(plans)) assert.ok(localized.includes(`/planos?plano=${id}`));
 if(locale==='en')assert.match(localized,/See plan details/,'English pricing CTA localized');
}
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const nav=server.slice(server.indexOf('function _sharedNav('),server.indexOf('function _standaloneFoot()'));
assert.doesNotMatch(nav,/data-store-link|class="nav-store"/,'shared header focuses on login and signup');
const landingCss=fs.readFileSync(path.join(__dirname,'..','assets',fs.readdirSync(path.join(__dirname,'..','assets')).find(n=>/^zvm-r46-landing\.[a-f0-9]{12}\.css$/.test(n))),'utf8');
assert.doesNotMatch(landingCss,/\.r466-body \.znav-main-links a\[href="\/faq"\]/,'landing must not hide shared header links');
const sharedFooterCss=fs.readFileSync(path.join(__dirname,'..','assets',fs.readdirSync(path.join(__dirname,'..','assets')).find(n=>/^zvm-standalone\.[a-f0-9]{12}\.css$/.test(n))),'utf8');
assert.match(sharedFooterCss,/\.r466-footer\{[^}]*background:/,'shared footer dark background spans full width');
console.log('R46.24 public conversion and locale contracts: PASS');
