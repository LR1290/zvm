'use strict';
// R47.05: deterministic full-site width contract and immutable stylesheet migration.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'server.js'),'utf8');
const styles=[
 ['zvm-reference-public.dea9e334f766.css','zvm-reference-public.19040fd11331.css','19040fd113310e45c7f9096fdb75aece8f7a82a9cc5496781405fad178e2805b',['.r4701-hero .r466-hero-layout','.r4700-faq-layout','.r4701-plans-hero-inner','.plans-wrap','.r466-footer-inner']],
 ['zvm-legal-premium.0a3567075aa3.css','zvm-legal-premium.a314c8aa9ae1.css','a314c8aa9ae1d092f8b34c8dc9ca3992c7b17c88d0369b97aea230c3c4a7e7cf',['.zvm-trust-layout','.terms-wrap','.zvm-error-grid']],
 ['zvm-auth-premium.d44a7ff35e68.css','zvm-auth-premium.a96f915db3f4.css','a96f915db3f4102b08fc53c39a66a3c1fbeffc0a017d09c0697c1f9c5976f020',['.auth-shell','.auth-form-card']],
 ['zvm-console-design.1ee8679046a6.css','zvm-console-design.44762cb103f8.css','44762cb103f86784b9a7ad5dccf99b5ec304076e728f5dac1bb7875631cb7349',['.admin-content','.client-shell']],
 ['zvm-analytics-premium.cba05e60d098.css','zvm-analytics-premium.e8ce624836b1.css','e8ce624836b1715d4dd8d4d44c73563e2aa2250f74f0990b9020ff0f0d3b3ef6',['.analytics-workspace main']]
];
for(const [oldName,name,expected,selectors] of styles){
 const p=path.join(root,'assets',name);
 assert(fs.existsSync(p),'missing current CSS '+name);
 assert(!fs.existsSync(path.join(root,'assets',oldName)),'retired CSS still in assets '+oldName);
 const css=fs.readFileSync(p,'utf8');
 const digest=crypto.createHash('sha256').update(css).digest('hex');
 assert.equal(digest,expected,'immutable full SHA256 mismatch '+name);
 assert(name.includes(digest.slice(0,12)),'filename/contents differ '+name);
 assert(src.includes('/assets/'+name),'CSS not used in HTML '+name);
 assert(src.includes("sha256: '"+expected+"'"),'CSS not in integrity registry '+name);
 assert(!src.includes(oldName),'obsolete CSS still served '+oldName);
 const marker='/* R47.05';
 const fresh=css.slice(css.lastIndexOf(marker));
 assert(fresh.startsWith(marker),'missing R47.05 scope '+name);
 assert(fresh.includes('@media (min-width:1280px)'),'wide-only breakpoint missing '+name);
 assert(!fresh.includes('!important'),'new specificity override in '+name);
 for(const selector of selectors)assert(fresh.includes(selector),'missing width authority '+name+' :: '+selector);
}
const publicCss=fs.readFileSync(path.join(root,'assets',styles[0][1]),'utf8');
assert(publicCss.includes('--r475-wide:min(1840px,calc(100% - clamp(48px,6.25vw,136px)))'),
 'public width must be fluid, bounded and account for gutters');
assert(publicCss.includes('max-width:none'),'new width must not be blocked by historical caps');
assert(src.includes('const ZVM_SALES_PAUSED = !/^(0|false|no|off)$/i.test('),
 'commercial default must remain fail-closed');
console.log('R47.05 WIDTH PASS: 5 SHA256 assets; fluid public, legal, auth, console, analytics; no old CSS/no !important');
