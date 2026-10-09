'use strict';
const assert = require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../assets/zvm-plans.26a755b1251d.js'),'utf8');
assert.match(code,/document\.documentElement\.lang/, 'checkout modal must derive customer language');
assert.match(code,/WhatsApp number/, 'English modal must reflect selected locale');
assert.match(code,/número/, 'Portuguese modal remains localized');
console.log('R46.22 purchase modal localization: PASS');
