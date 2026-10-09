'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
process.env.RENDER = 'true'; process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/test';
process.env.ADMIN_USER = 'fixture-admin'; process.env.ADMIN_PASS='fixture-password'; process.env.ANALYTICS_PASS='fixture-analytics'; process.env.APP_SECRET='fixture-long-app-secret-123456789-123456789-123456789';
const original = Module._load;
let api;
try {
  Module._load=function(id,...args){if(id==='mongodb')return {MongoClient:class OfflineMongo{}};return original.call(this,id,...args);};
  api=require('../server.js').__test;
} finally { Module._load=original; }
const pages={home:api.renderStandaloneLandingPage(),plans:api.renderPlanosPage(null),faq:api.renderStandaloneFaqPage(),privacy:api.renderStandalonePrivacyPage()};
const foot=html=>html.match(/<footer class="r466-footer">[\s\S]*?<\/footer>/)?.[0];
for(const [name,html] of Object.entries(pages)) {
  assert.ok(foot(html),`${name} must use the same canonical public footer as landing`);
  assert.match(foot(html),/r466-footer-inner/,`${name} uses full-width footer with internal grid`);
  assert.equal((html.match(/<footer\b/g)||[]).length,1,`${name} has one footer`);
}
const canonical=foot(pages.home);
for(const [name,html] of Object.entries(pages))assert.equal(foot(html),canonical,`${name} footer markup is identical`);
assert.doesNotMatch(pages.home,/href="\/planos#plan-/, 'landing links must not generate plan hashes');
const nav=fs.readFileSync(path.join(__dirname,'..','assets',fs.readdirSync(path.join(__dirname,'..','assets')).find(s=>/^zvm-r46-landing-navigation\..*\.js$/.test(s))), 'utf8');
assert.doesNotMatch(nav,/window\.location\.search \+ '#' \+ encodeURIComponent\(id\)/,'section scroll must not add fragments');
assert.match(nav,/replaceState/,'legacy fragments must be removed');
const planScript=fs.readFileSync(path.join(__dirname,'..','assets',fs.readdirSync(path.join(__dirname,'..','assets')).find(s=>/^zvm-plans\..*\.js$/.test(s))), 'utf8');
assert.match(planScript,/URLSearchParams|searchParams/,'plan selection via clean query');
assert.match(planScript,/plan-padrao|plan-.*id/,'legacy anchors preserved');
console.log('R46.33 public footer and hashless navigation: PASS');
