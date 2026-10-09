'use strict';
// Test-only isolated production renderer. No MongoDB, email, or live session is created.
const path=require('node:path');
const Module=require('node:module');
process.env.RENDER='true';
process.env.NODE_ENV='test';
process.env.ADMIN_USER='fixture-admin';
process.env.ADMIN_PASS='fixture-password-never-used';
process.env.ANALYTICS_PASS='fixture-analytics-password-never-used';
process.env.APP_SECRET='fixture-application-secret-0123456789-0123456789-0123456789';
process.env.MONGODB_URI='mongodb://127.0.0.1:1/never-connect';
process.env.BASE_URL='http://127.0.0.1:31051';
process.env.CAKTO_WEBHOOK_SECRET='';
process.env.RESEND_API_KEY='';
process.env.META_APP_ID='';
process.env.META_APP_SECRET='';
const original=Module._load,log=console.log;
let app;
try{
 console.log=()=>{};
 Module._load=function(id,...args){if(id==='mongodb')return {MongoClient:class BlockedMongo{constructor(){throw Error('fixture_db_disallowed')}}};return original.call(this,id,...args);};
 app=require(path.resolve(__dirname,'..','server.js')).__test;
}finally{Module._load=original;console.log=log;}
Promise.resolve(app.renderAnalyticsDashboard({stats:{},payments:[]})).then(html=>process.stdout.write(html),e=>{console.error(e);process.exitCode=1;});
