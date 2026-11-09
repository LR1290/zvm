'use strict';
// Read-only investigation of the original, SHA-pinned v36 HTML.
// No networking, no writes, no use of guessed records.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {gunzipSync}=require('node:zlib');
const {createHash}=require('node:crypto');
const {SHA256}=require('../src/hobbies/ssx/route');
const root=join(__dirname,'../src/hobbies/ssx/packed');
const data=gunzipSync(Buffer.concat(Array.from({length:10},(_,i)=>readFileSync(join(root,'ssx2012.html.gz.part'+String(i).padStart(2,'0'))))));
assert.equal(createHash('sha256').update(data).digest('hex'),SHA256);
const source=data.toString('utf8');
function context(pattern,max=5){
  const matches=[];let m;
  while((m=pattern.exec(source))&&matches.length<max){
    const from=Math.max(0,m.index-230),to=Math.min(source.length,m.index+350);
    const html=source.slice(from,to);
    matches.push({offset:m.index,context:html.replace(/[\r\n\t]+/g,' ').replace(/ {2,}/g,' ').slice(0,570)});
  }
  return matches;
}
test('identify exact source structures for historical special-category integration',()=>{
  const patterns={
    android:/\bAndroid\b/ig,
    level9:/\bLevel\s*9\b/ig,
    lowLevel:/\b(?:low.{0,5}level|lower.{0,5}level)\b/ig,
    developer:/\b(?:DEV\s*Tracks?|Developer\s*Tracks?|Test(?:ing)?\s*(?:Stages?|Tracks?))\b/ig,
    noBoost:/\bNo[\s_-]*Boost\b/ig,
    noGear:/\bNo[\s_-]*Gear\b/ig,
    noWings:/\bNo[\s_-]*Wings\b/ig,
    testRail:/\bTEST[\s_-]*RAIL\b/ig,
    snowjam:/\bSnowjam\b/ig
  };
  const inventory={};
  for(const [key,pattern] of Object.entries(patterns)){
    inventory[key]=context(pattern,6);
  }
  const ids=[...source.matchAll(/<section\b[^>]*\bid=["']([^"']{1,140})["'][^>]*>/gi)].slice(0,55).map(m=>m[1]);
  const headers=[...source.matchAll(/<h[2-4]\b[^>]*>([\s\S]{0,200}?)<\/h[2-4]>/gi)].slice(0,100).map(m=>m[1].replace(/<[^>]+>/g,' ').trim()).filter(Boolean);
  const scripts=[...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(m=>({offset:m.index,length:m[1].length,start:m[1].slice(0,250)}));
  const mainScript=scripts.length?[...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].sort((a,b)=>b[1].length-a[1].length)[0]?.[1]||'':'';
  const prefix=mainScript.slice(0,2200);
  const declarations=[...mainScript.matchAll(/(?:^|[;\n])\s*(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].slice(0,95).map(m=>({name:m[1],offset:m.index}));
  const structural=[...mainScript.matchAll(/(?:^|[;\n])\s*(?:let|const|var)\s+([A-Z][A-Z0-9_]{2,})\s*=/g)].slice(0,55).map(m=>({name:m[1],offset:m.index}));
  console.log('SSX_SCRIPT_OBJECTS '+JSON.stringify({prefix,declarations,structural}));
  console.log('SSX_SPECIAL_STRUCTURES '+JSON.stringify({size:source.length,ids,headers,scripts:scripts.slice(-12)}));
  console.log('SSX_SPECIAL_MARKERS '+JSON.stringify(inventory));
  assert.ok(inventory.android.length>0);
  assert.ok(inventory.level9.length>0);
  assert.ok(inventory.developer.length>0);
});
