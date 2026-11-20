'use strict';
const fs=require('node:fs'),acorn=require('acorn'),assert=require('node:assert/strict');
const file=process.argv[2],before=fs.readFileSync(file,'utf8'),comments=[];
const ast=acorn.parse(before,{ecmaVersion:'latest',onComment:comments});
let after=before;
for(const c of comments.reverse()){
 if(/@license|@preserve|copyright|sourceMappingURL|^!|^#/i.test(c.value))continue;
 const gap=before.slice(c.start,c.end).replace(/[^\r\n]/g,'');
 after=after.slice(0,c.start)+(gap||' ')+after.slice(c.end);
}
const shape=node=>JSON.stringify(node,(k,v)=>k==='start'||k==='end'?undefined:v);
assert.equal(shape(acorn.parse(after,{ecmaVersion:'latest'})),shape(ast));
fs.writeFileSync(file,after);
console.log(JSON.stringify({acorn:acorn.version,before:Buffer.byteLength(before),after:Buffer.byteLength(after),astEqual:true}));
