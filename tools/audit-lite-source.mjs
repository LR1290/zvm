#!/usr/bin/env node
/**
 * ZVM LITE — fail-closed read-only source and Ed25519 audit.
 * A valid signature against an EMBEDDED public key does not prove that Render
 * trusts this key or that the extension works in an actual MV3 browser.
 * Usage: node tools/audit-lite-source.mjs <unpacked-folder> [ISO8601-UTC-now]
 * Exit 0: all checks passed; 1: cannot audit; 2: source MUST NOT be installed.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const safe=p=>typeof p==='string'&&/^[A-Za-z0-9_.\/+@-]+$/.test(p)&&p.split('/').every(t=>t!==''&&t!=='.'&&t!=='..');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const FIELDS=['schema','audience','productId','channel','extensionId','buildId','sha256','keyId','issuedAt','expiresAt'];
const DESC=['schema','securityProtocol','buildId','channel','profile','extensionVersion','extensionId','sourceTreeSha256','buildFingerprint','protectedFiles','createdAt'];
const exempt=new Set(['app/security/integrity.json','app/security/lite-v4-signed-build.json']);
const read=(root,n)=>JSON.parse(fs.readFileSync(path.join(root,n),'utf8'));
const timestamp=v=>{const ms=Date.parse(v);return typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(ms)&&new Date(ms).toISOString()===v?ms:NaN;};
function listFiles(root){
  const found=[];let visits=0;
  function visit(rel){
    for(const item of fs.readdirSync(path.join(root,rel),{withFileTypes:true})){
      const name=rel?rel+'/'+item.name:item.name;
      if(++visits>10000||!safe(name)||item.isSymbolicLink())throw Error('UNSAFE_SOURCE_TREE:'+name);
      if(item.isDirectory())visit(name);
      else if(item.isFile())found.push(name);
      else throw Error('UNSUPPORTED_FILE_TYPE:'+name);
    }
  }
  visit('');return found.sort();
}
const verify=(pub,content,sig)=>{try{return crypto.verify(null,content,pub,sig);}catch{return false;}};
export function auditLiteSource(root,now=Date.now()){
  root=path.resolve(root);
  const issues=[],add=(code,file)=>issues.push({code,file});
  const manifest=read(root,'manifest.json'),integ=read(root,'app/security/integrity.json'),identity=read(root,'app/security/build-identity.json'),v4=read(root,'app/security/lite-v4-signed-build.json');
  const js=fs.readFileSync(path.join(root,'app/shared/core/lite-dev-identity.js'),'utf8');
  const value=n=>new RegExp('var\\s+'+n+"\\s*=\\s*'([^']+)'").exec(js)?.[1]||'';
  const id=value('devExtensionId'),keyId=value('devPublicKeyId'),publicSpki=value('devPublicKeySpkiBase64');
  let pub;
  try{pub=crypto.createPublicKey({key:Buffer.from(publicSpki,'base64'),format:'der',type:'spki'});if(pub.asymmetricKeyType!=='ed25519')throw Error('not Ed25519');}catch{add('PUBLIC_KEY_INVALID','app/shared/core/lite-dev-identity.js');}
  let computedId='';
  try{
    const rsa=Buffer.from(manifest.key,'base64');
    crypto.createPublicKey({key:rsa,format:'der',type:'spki'});
    const bytes=crypto.createHash('sha256').update(rsa).digest().subarray(0,16);
    computedId=Array.from(bytes).map(b=>String.fromCharCode(97+(b>>4),97+(b&15))).join('');
  }catch{add('MANIFEST_KEY_INVALID','manifest.json');}
  if(!id||computedId!==id||v4.payload?.extensionId!==id||integ.devAttestation?.descriptor?.extensionId!==id)add('EXTENSION_ID_MISMATCH','manifest.json');
  if(manifest.manifest_version!==3||!/^\d+(?:\.\d+){2,3}-dev(?:\+|$)/i.test(String(manifest.version_name||'')))add('DEV_MARKER_INVALID','manifest.json');
  if(integ.extensionVersion!==manifest.version||identity.extensionVersion!==manifest.version)add('VERSION_MISMATCH','app/security/build-identity.json');
  if(!Array.isArray(integ.files)||integ.files.length<8||integ.files.length>10000)throw Error('INTEGRITY_LIST_INVALID');
  const files=new Set(listFiles(root)),seen=new Set(),entries=[];
  for(const item of integ.files){
    const n=item?.path;
    if(!safe(n)||seen.has(n)||!/^[a-f0-9]{64}$/.test(item.sha256)||!Number.isSafeInteger(item.size)||item.size<0) {add('INTEGRITY_ENTRY_INVALID',String(n));continue;}
    seen.add(n);
    const entry={path:n,sha256:item.sha256,size:item.size};
    if(item.mode){entry.mode=item.mode;if(n!=='manifest.json'||item.mode!=='manifest-json-v1')add('INTEGRITY_MODE_INVALID',n);}
    entries.push(entry);
    if(!files.has(n)){add('PROTECTED_FILE_MISSING',n);continue;}
    let bytes;
    if(n==='manifest.json'&&item.mode==='manifest-json-v1'){
      const copy={...manifest};delete copy.key;delete copy.update_url;
      if(manifest.update_url&&manifest.update_url!=='https://clients2.google.com/service/update2/crx')add('MANIFEST_UPDATE_URL_INVALID',n);
      bytes=Buffer.from(canonical(copy));
    }else{bytes=fs.readFileSync(path.join(root,n));}
    if(bytes.length!==item.size)add('FILE_SIZE_MISMATCH',n);
    if(sha(bytes)!==item.sha256)add('FILE_SHA256_MISMATCH',n);
  }
  for(const n of files)if(!seen.has(n)&&!exempt.has(n))add('UNPROTECTED_SOURCE',n);
  entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const fp=sha(Buffer.from(JSON.stringify({extensionVersion:integ.extensionVersion,files:entries})));
  if(fp!==integ.buildFingerprint)add('FINGERPRINT_MISMATCH','app/security/integrity.json');
  const expectedId='zvm-lite-dev-'+manifest.version+'-s'+String(identity.sourceTreeSha256||'').slice(0,12);
  const att=integ.devAttestation||{},d=att.descriptor||{};
  if(identity.buildId!==expectedId||d.buildId!==expectedId||d.sourceTreeSha256!==identity.sourceTreeSha256||d.buildFingerprint!==integ.buildFingerprint||d.protectedFiles!==integ.files.length)add('ATTESTATION_IDENTITY_MISMATCH','app/security/integrity.json');
  const desc={};for(const f of DESC)desc[f]=d[f];
  const body=Buffer.from(JSON.stringify({schema:1,algorithm:'Ed25519',keyId,descriptor:desc,signedAt:att.signedAt,expiresAt:att.expiresAt}));
  if(!pub||att.keyId!==keyId||!verify(pub,body,Buffer.from(String(att.signature||'').replace(/-/g,'+').replace(/_/g,'/'),'base64')))add('ATTESTATION_SIGNATURE_INVALID','app/security/integrity.json');
  const at=[timestamp(d.createdAt),timestamp(att.signedAt),timestamp(att.expiresAt)];
  if(at.some(x=>!Number.isFinite(x))||at[0]>now+300000||at[1]>now+300000||at[2]<=now||at[2]<=at[1]||at[2]-at[0]>7*86400000)add('ATTESTATION_EXPIRED','app/security/integrity.json');
  const payload=v4.payload||{},v4canonical={};for(const f of FIELDS)v4canonical[f]=payload[f];
  if(Object.keys(v4).sort().join(',')!=='payload,signatureBase64'||Object.keys(payload).sort().join(',')!==[...FIELDS].sort().join(','))add('V4_PAYLOAD_SHAPE_INVALID','app/security/lite-v4-signed-build.json');
  if(!pub||!verify(pub,Buffer.from(JSON.stringify(v4canonical)),Buffer.from(String(v4.signatureBase64||''),'base64')))add('V4_SIGNATURE_INVALID','app/security/lite-v4-signed-build.json');
  if(payload.buildId!==expectedId||payload.sha256!==integ.buildFingerprint||payload.keyId!==keyId||payload.productId!=='zvm_lite'||payload.channel!=='dev')add('V4_BUILD_BINDING_INVALID','app/security/lite-v4-signed-build.json');
  const v4dates=[timestamp(payload.issuedAt),timestamp(payload.expiresAt)];
  if(v4dates.some(x=>!Number.isFinite(x))||v4dates[0]>now+300000||v4dates[1]<=now||v4dates[1]<=v4dates[0]||v4dates[1]-v4dates[0]>7*86400000)add('V4_DESCRIPTOR_EXPIRED','app/security/lite-v4-signed-build.json');
  return {ok:issues.length===0,checkedFiles:files.size,protectedFiles:integ.files.length,issues,trust:'Embedded public key only; check Render authority and real MV3 separately'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    if(!process.argv[2])throw Error('Usage: node tools/audit-lite-source.mjs <unpacked-root> [UTC timestamp]');
    const when=process.argv[3]?timestamp(process.argv[3]):Date.now();
    if(!Number.isFinite(when))throw Error('INVALID_AUDIT_DATE');
    const result=auditLiteSource(process.argv[2],when);
    console.log(JSON.stringify(result,null,2));
    process.exitCode=result.ok?0:2;
  }catch(err){console.error('LITE_SOURCE_AUDIT_FAILED:',String(err.message).slice(0,200));process.exitCode=1;}
}
