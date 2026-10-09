'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const Module=require('node:module');process.env.RENDER='true';process.env.NODE_ENV='test';
process.env.ADMIN_USER='test-admin';process.env.ADMIN_PASS='test-secret';process.env.MONGODB_URI='mongodb://127.0.0.1:1/fixture';
let api;const load=Module._load;
try{Module._load=function(id,...args){if(id==='mongodb')return {MongoClient:class Dummy{}};return load.call(this,id,...args)};api=require('../server').__test;}finally{Module._load=load;}
assert.equal(api._SEC_HEADERS['Referrer-Policy'],'no-referrer','public and private responses should not leak paths or tokens in Referer');
assert.match(api._CSP_PUBLIC_STRICT,/script-src 'self'/);
assert.doesNotMatch(api._CSP_PUBLIC_STRICT,/unsafe-inline/);
const cssFile=fs.readdirSync(path.join(__dirname,'..','assets')).find(n=>/^zvm-standalone\.[0-9a-f]{12}\.css$/.test(n));
const css=fs.readFileSync(path.join(__dirname,'..','assets',cssFile),'utf8');
assert.match(css,/\.r466-footer\{[^}]*border-top:1px solid var\(--zline,/,'footer separator must have default color on all pages');
console.log('R46.33 privacy and footer visual regression: PASS');
