import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SHA256=/^[a-f0-9]{64}$/;
const EXT_ID=/^[a-p]{32}$/;
const VERSION=/^\d+(?:\.\d+){2,3}$/;
const DEV_ID='ckbffcbmanboelbihfkhiahgafnimcho';
const BETA_ID='bdhnikgcdccjabkmbfcakgjkkgdlmgja';
const BETA=Object.freeze({version:'0.8.538',buildId:'zvm-beta-0.8.538-sfd6042e42478',fingerprint:'6c6effd303185ef456ffde231dcbf8dfc286122f82e51a49471972a02f026d50',source:'fd6042e424789117685ecbb23ef11cb73cedea6a25ccf2fcc6c308ee80f694fe'});
const PREVIOUS_BETA=Object.freeze({version:'0.8.537',buildId:'zvm-beta-0.8.537-sec877bc9a6c0',fingerprint:'25109d437a7994831ba3c5e4752075a68291adba6a998ed062ccadfcb9a0b0af'});
const ROLLBACK_BETA=Object.freeze({version:'0.8.528',buildId:'zvm-beta-0.8.528-sd88c00dcccd8',fingerprint:'b0879ed739522bc15ec02a9cba0d9139a68bf61e845d29cb74bd56cea785914c'});
const V731_FP='ed0459294aac386126a817aac3f3a845a4df2f4b66ace95a165a63306be31f62';
function die(m){throw new Error(`RELEASE_MANIFEST_INVALID:${m}`)}
function readJson(f){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){die(`${path.basename(f)}:${e.message}`)}}
function shaFile(f){return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}
function assert(v,m){if(!v)die(m)}
function exactIso(v){const s=String(v||'');const ms=Date.parse(s);return Number.isFinite(ms)&&new Date(ms).toISOString()===s}
function exactRegistry(v2,{buildId,version,fingerprint,channel='beta',profile='release',extensionId=BETA_ID},label){
 const rows=v2.builds.filter(x=>x?.buildId===buildId); assert(rows.length===1,`v2:${label}-count`); const e=rows[0];
 assert(e.status==='active',`v2:${label}-status`); assert(e.channel===channel&&e.profile===profile,`v2:${label}-pair`);
 assert(e.extensionVersion===version,`v2:${label}-version`); assert(e.buildFingerprint===fingerprint,`v2:${label}-fingerprint`);
 assert(Array.isArray(e.extensionIds)&&e.extensionIds.includes(extensionId),`v2:${label}-extension-id`); return e;
}
function validateRecord(key,r){
 assert(r&&typeof r==='object'&&!Array.isArray(r),`${key}:record`); assert(VERSION.test(String(r.version||'')),`${key}:version`);
 assert(/^zvm-(dev|beta)-\d+(?:\.\d+){2,3}-s[a-f0-9]{12}$/.test(String(r.buildId||'')),`${key}:buildId`);
 assert(['dev','beta'].includes(r.channel),`${key}:channel`); assert(['dev','release'].includes(r.profile),`${key}:profile`); assert(r.securityProtocol===2,`${key}:protocol`);
 assert(SHA256.test(String(r.sourceTreeSha256||'')),`${key}:source`); assert(SHA256.test(String(r.buildFingerprint||'')),`${key}:fingerprint`);
 assert(EXT_ID.test(String(r.extensionId||'')),`${key}:extensionId`); assert(SHA256.test(String(r.zipSha256||'')),`${key}:zipSha`);
}
export function verifyReleaseManifest(root){
 const m=readJson(path.join(root,'release/ZVM_RELEASE_MANIFEST.json')); const v1=readJson(path.join(root,'zvm-official-builds.json')); const v2=readJson(path.join(root,'zvm-build-registry-v2.json'));
 assert(m.schema===1,'schema'); assert(m.releaseId==='ZVM-V743-BETA-0.8.538-R32-REGISTRY-UPDATE','releaseId');
 assert(m.server?.buildId==='2026-09-16-v739-admin-dev-access-r32','server:buildId'); assert(m.server?.signedDevAuthority===true,'server:signedDevAuthority'); assert(m.server?.adminDevAccessControl===true,'server:adminDevAccessControl');
 assert(SHA256.test(String(m.server?.serverJsSha256||'')),'server:sha-format'); assert(shaFile(path.join(root,'server.js'))===m.server.serverJsSha256,'server:sha-mismatch');
 assert(m.server.nodeRuntime==='24.21.0','server:node'); assert(m.server.devCohostRequired===true,'server:cohost');
 const sa=m.server.devSigningAuthority||{}; assert(sa.algorithm==='Ed25519','signing:algorithm'); assert(sa.keyId==='dev-2026-01','signing:keyId');
 assert(typeof sa.publicKeyB64==='string'&&sa.publicKeyB64.length>40,'signing:publicKey'); assert(sa.buildMaxAgeDays===7,'signing:maxAge'); assert(sa.sessionTtlHours===12,'signing:session');
 try{const k=crypto.createPublicKey({key:Buffer.from(sa.publicKeyB64,'base64'),format:'der',type:'spki'});assert(k.asymmetricKeyType==='ed25519','signing:key-type')}catch{die('signing:publicKey-invalid')}
 const keys=Object.keys(m.extensions||{}).sort(); assert(JSON.stringify(keys)===JSON.stringify(['beta','dev']),'extensions:two-profile-only'); keys.forEach(k=>validateRecord(k,m.extensions[k]));
 const dev=m.extensions.dev; assert(dev.version==='0.8.535','dev:version'); assert(dev.extensionId===DEV_ID,'dev:id'); assert(dev.channel==='dev'&&dev.profile==='dev','dev:pair');
 assert(dev.buildId===`zvm-dev-${dev.version}-s${dev.sourceTreeSha256.slice(0,12)}`,'dev:derived-buildId'); assert(dev.authorization==='signed-attestation-after-r31-activation','dev:authorization');
 assert(dev.registryPreRegistrationRequired===false,'dev:registry-pre-registration'); assert(dev.devAttestation?.algorithm==='Ed25519','dev:att-alg'); assert(dev.devAttestation?.keyId===sa.keyId,'dev:att-keyId');
 assert(exactIso(dev.createdAt)&&exactIso(dev.devAttestation.signedAt)&&exactIso(dev.devAttestation.expiresAt),'dev:timestamps');
 assert(Date.parse(dev.devAttestation.expiresAt)-Date.parse(dev.createdAt)===7*24*60*60*1000,'dev:max-age');
 assert(!v2.builds.some(x=>x?.buildId===dev.buildId),'dev:v739-must-not-require-registry-entry');
 const beta=m.extensions.beta; assert(beta.version===BETA.version&&beta.buildId===BETA.buildId&&beta.buildFingerprint===BETA.fingerprint&&beta.sourceTreeSha256===BETA.source,'beta:frozen-identity');
 assert(beta.extensionId===BETA_ID&&beta.channel==='beta'&&beta.profile==='release','beta:frozen-pair'); exactRegistry(v2,{...BETA,extensionId:BETA_ID},'current-beta');
 exactRegistry(v2,{...PREVIOUS_BETA,extensionId:BETA_ID},'previous-beta');
 exactRegistry(v2,{...ROLLBACK_BETA,extensionId:BETA_ID},'rollback-beta'); assert(v2.builds.find(x=>x?.buildId==='zvm-beta-0.8.529-s3b3cdbbe7fe4')?.status==='revoked','v2:v734-revoked');
 assert(v1.schemaVersion===1&&Array.isArray(v1.builds?.['0.8.526'])&&v1.builds['0.8.526'].includes(V731_FP),'v1:rollback');
 const c=m.compatibility||{}; assert(c.v2DevCurrent?.authorization==='signed-dev-attestation','compat:dev-signed'); assert(c.v2DevCurrent?.registryPreRegistrationRequired===false,'compat:dev-no-prereg');
 assert(c.v2BetaCurrent?.authorization==='registry-v2-exact'&&c.v2BetaCurrent?.buildId===BETA.buildId,'compat:beta-exact'); assert(c.v2BetaPrevious?.buildId===PREVIOUS_BETA.buildId&&c.v2BetaPrevious?.buildFingerprint===PREVIOUS_BETA.fingerprint,'compat:beta-previous'); assert(c.legacyV3Allowed===true&&c.destructiveMigration===false,'compat:legacy');
 const g=m.prelaunchGates||{}; assert(g.node24LocalGatePassed===true,'gate:node24'); assert(g.adminDevAccessGatePassed===true,'gate:admin-dev-access'); assert(g.signedDevAuthorityLocalGatePassed===true,'gate:signed-dev'); assert(g.v739DevSignedGatePassed===true,'gate:v739'); assert(g.v740DevSignedGatePassed===true,'gate:v740'); assert(g.v743BrowserIconSemanticIntegrityLocalGatePassed===true,'gate:v743-browser-icon'); assert(g.v743RuntimeTransformedIconRegressionPassed===true,'gate:v743-runtime-icon-regression'); assert(g.v743CriticalRawTamperRegressionPassed===true,'gate:v743-critical-raw'); assert(g.v743DeterministicBuildGatePassed===true,'gate:v743-deterministic'); assert(g.v743ChromiumNativePackGatePassed===true,'gate:v743-chromium-pack'); assert(g.v743RegistryPrepared===true,'gate:v743-registry'); assert(g.realChromeStoreInstallSmokePassed===false,'gate:store-smoke-must-remain-open');
 return {releaseId:m.releaseId,devBuildId:dev.buildId,betaBuildId:beta.buildId,serverJsSha256:m.server.serverJsSha256};
}
function rootArg(argv){const i=argv.indexOf('--root');return i>=0&&argv[i+1]?path.resolve(argv[i+1]):path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')}
if(path.resolve(process.argv[1]||'')===path.resolve(fileURLToPath(import.meta.url))){try{const r=verifyReleaseManifest(rootArg(process.argv.slice(2)));console.log(`RELEASE_MANIFEST_OK ${r.releaseId} dev=${r.devBuildId} beta=${r.betaBuildId} server=${r.serverJsSha256}`)}catch(e){console.error(e?.message||String(e));process.exitCode=1}}
