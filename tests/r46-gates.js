'use strict';
const assert=require('assert');const fs=require('fs');const crypto=require('crypto');
const server=fs.readFileSync('server.js','utf8');const renderer=fs.readFileSync('src/web/public/landing/render.js','utf8');
const m=server.match(/\/assets\/(zvm-r46-landing\.[0-9a-f]{12}\.css)'[\s\S]*?sha256: '([0-9a-f]{64})'/);assert(m,'R46 landing asset registry');
const css=fs.readFileSync('assets/'+m[1]);const cssText=css.toString();const sha=crypto.createHash('sha256').update(css).digest('hex');assert.strictEqual(sha,m[2]);assert.strictEqual(sha.slice(0,12),m[1].match(/\.([0-9a-f]{12})\.css$/)[1]);
const small=[...cssText.matchAll(/font-size\s*:\s*([0-9.]+)px/g)].map(x=>Number(x[1])).filter(x=>x<15);assert.deepStrictEqual(small,[],'no landing text below 15px');
for(const token of ['prefers-reduced-motion','prefers-contrast:more','focus-visible','min-height:48px']) assert(cssText.includes(token),token);
for(const term of ['CRM e Funis','Disparos','Fluxos','Assistentes IA','Biblioteca','Agenda e FollowUp']) assert(renderer.includes(term),term);
for(const banned of ['fonts.googleapis.com','Google Fonts','O site não inventa','Clique nas abas para explorar','A barra lateral apresenta']) assert(!renderer.includes(banned),banned);
for(const [file,expected] of [['zvm-shell-home-real.a9c1a0d7b030.png','a9c1a0d7b030333d0e9240228f11e34ef7a1e94be3b9763e18a621bb487de8b5'],['zvm-home-status.d67c284e8b99.png','d67c284e8b99a9641028b728dd21cfd5d2e102d2837b345331bf0bd41bd89556'],['zvm-home-models.7cdf6ab7bc37.png','7cdf6ab7bc37e71ad74b38260102c8fd8a6cb527bb98da2bff8d694ebb60e6da'],['zvm-home-favorites.ce590e486f02.png','ce590e486f02c0a69a583d6ab4d32fe301587beddcb7ee435ad82e6a6f0090af'],['zvm-home-connections.2a3c9faa94ec.png','2a3c9faa94ecd1faf08c81c748d35e5340a96e531f46f524363cf986707b7061'],['zvm-home-metrics.40db3ea20ff3.png','40db3ea20ff3d76465567da423e3ad586bba122de7828f709699343956664aa1']]){const b=fs.readFileSync('assets/'+file);assert.strictEqual(crypto.createHash('sha256').update(b).digest('hex'),expected,file+' sha');assert(server.includes('/assets/'+file),file+' registered');}
for(const clarity of ['Instalação gratuita','ativação requer uma licença','Ver detalhes do plano']) assert(renderer.includes(clarity),clarity);
assert(fs.readFileSync('src/web/public/footer.js','utf8').includes('Portal do Cliente'),'shared public footer has portal link');
const store='https://chromewebstore.google.com/detail/zvm-automações/bdhnikgcdccjabkmbfcakgjkkgdlmgja';
assert(renderer.includes('r4618-hero-store'),'single shared official-store badge');
assert(!renderer.includes('r466-hero-product'),'duplicate hero product removed');
assert(renderer.includes('r4611-product-first'),'real product preview promoted directly after hero');
assert(!renderer.includes('r4611-hero-orbits'),'decorative orbits removed');
assert(server.includes(store),'official Chrome Web Store URL wired');
for(const rx of [/zvm-shared\.[0-9a-f]{12}\.css/,/zvm-standalone\.[0-9a-f]{12}\.css/,/zvm-faq\.[0-9a-f]{12}\.css/,/zvm-plans-page\.[0-9a-f]{12}\.css/,/zvm-privacy\.[0-9a-f]{12}\.css/]) assert(rx.test(server),String(rx));
for(const prefix of ['zvm-shared','zvm-standalone','zvm-faq','zvm-plans-page','zvm-privacy']){const mm=server.match(new RegExp('/assets/('+prefix.replace(/-/g,'\\-')+'\\.[0-9a-f]{12}\\.css)'));assert(mm,prefix+' asset');const txt=fs.readFileSync('assets/'+mm[1],'utf8');const vals=[...txt.matchAll(/font-size\s*:\s*([0-9.]+)px/g)].map(x=>Number(x[1])).filter(x=>x<15);assert.deepStrictEqual(vals,[],prefix+' no text below 15px');}
assert(cssText.includes('overflow-anchor:none'),'stable preview scroll anchoring disabled');
assert(cssText.includes('opacity:0;visibility:hidden'),'preview switches without display relayout');
console.log('R46.23 public UX + install gates: PASS');
