'use strict';
// Isolated HTTP fixture: real application routing without production bootstrap or DB writes.
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
process.env.RENDER = 'true'; // import only; does not start service or load DB
process.env.NODE_ENV = 'test';
process.env.ADMIN_USER = 'fixture-admin';
process.env.ADMIN_PASS = 'fixture-password-never-used';
process.env.ANALYTICS_PASS = 'fixture-analytics-password-never-used';
process.env.APP_SECRET = 'fixture-application-secret-0123456789-0123456789-0123456789';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/never-connect';
const testPort = Number(process.env.ZVM_TEST_PORT || '31020');
process.env.BASE_URL = 'http://127.0.0.1:' + testPort;
process.env.CAKTO_WEBHOOK_SECRET = '';
process.env.RESEND_API_KEY = '';
process.env.META_APP_ID = '';
process.env.META_APP_SECRET = '';
const loader=Module._load;
let app;
try {
 Module._load=function(id,...args){if(id==='mongodb')return {MongoClient:class BlockedMongo{constructor(){throw Error('mongo_not_available_in_fixture')}}};return loader.call(this,id,...args);};
 app=require(path.resolve(__dirname,'..','server.js')).__test;
} finally { Module._load=loader; }
const server=http.createServer((req,res)=>{
 // Test-only views from the actual production renderers; no authentication is bypassed
 // in production code, and none of these URLs are registered by server.js.
 const fixturePages = {
  '/__fixture/admin-login': () => app.renderAdminLogin(),
  '/__fixture/admin-dashboard': () => app.renderAdminDashboard({portalUsers:[],portalUserCount:0}),
  '/__fixture/analytics-login': () => app.renderAnalyticsLogin(),
  '/__fixture/analytics-dashboard': () => app.renderAnalyticsDashboard({stats:{},payments:[]}),
  '/__fixture/client-dashboard': () => app.renderPortalDashboard({name:'Cliente Fictício',email:'fixture@example.invalid',keyCode:''},null),
  '/__fixture/client-plans': () => app.renderPortalPlans({name:'Cliente Fictício',email:'fixture@example.invalid'},null),
  '/__fixture/client-plans-current': () => app.renderPortalPlans({name:'Cliente Fictício',email:'fixture@example.invalid'}, {code:'zv-fixture-001',maxUses:3,planId:'padrao',expiresAt:'2026-12-15T00:00:00Z',phones:[]}),
  '/__fixture/client-license': () => app.renderStandalonePortalLinkKey('','',{name:'Cliente Fictício',email:'fixture@example.invalid'}),
  '/__fixture/client-security': () => app.renderStandaloneSetup2FA({name:'Cliente Fictício',email:'fixture@example.invalid'}),
  '/__fixture/client-password': () => app.renderStandalonePortalChangePwd('','',{name:'Cliente Fictício',email:'fixture@example.invalid'}),
  '/__fixture/client-email': () => app.renderStandalonePortalChangeEmail('','',{name:'Cliente Fictício',email:'fixture@example.invalid'})
 };
 if (req.method === 'GET' && fixturePages[req.url]) {
   Promise.resolve().then(fixturePages[req.url]).then(html => {
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);
   }).catch(e=>{console.error('[RENDER FIXTURE ERROR]',e.stack);res.writeHead(500);res.end('Render fixture error')});
   return;
 }
 app.handleRequest(req,res).catch(e=>{console.error('[FIXTURE HTTP ERROR]',req.url,e.stack); if(!res.headersSent)res.writeHead(500);res.end('fixture error');});
});
server.listen(testPort,'127.0.0.1',()=>console.log('R46 isolated real route fixture: http://127.0.0.1:' + testPort));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
