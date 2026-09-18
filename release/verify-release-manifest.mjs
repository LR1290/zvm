import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SHA256=/^[a-f0-9]{64}$/;
const EXT_ID=/^[a-p]{32}$/;
const VERSION=/^\d+(?:\.\d+){2,3}$/;
const DEV_ID='ckbffcbmanboelbihfkhiahgafnimcho';
const BETA_ID='bdhnikgcdccjabkmbfcakgjkkgdlmgja';
const V746=Object.freeze({
  version:'0.8.541',source:'203ccc4889818720c5da6fbedfe6acfc29afe33977e055f885efa52090de7145',
  devBuildId:'zvm-dev-0.8.541-s203ccc488981',devFingerprint:'44420b8eae9f7de4341b41807d25bb82a247b6e8fed53ae647bc133166cc8ceb',
  betaBuildId:'zvm-beta-0.8.541-s203ccc488981',betaFingerprint:'573f75cb7a704e99d2746fcb2ec4a0411f7a66b75446eb4653b28c8b8213e857'
});
const ACTIVE_BETA=Object.freeze({version:'0.8.539',buildId:'zvm-beta-0.8.539-s5a6b9d982a41',fingerprint:'dd455c29552bcebec6a3296f12727c9dba0e4251582bdf1c6216ac4c1e44a3e9',source:'5a6b9d982a41b6f13ce6506dbbe8c19a87a95d5bfdcb0cc1ea7cfef5f0a4c740'});
const PREVIOUS_BETA=Object.freeze({version:'0.8.538',buildId:'zvm-beta-0.8.538-sfd6042e42478',fingerprint:'6c6effd303185ef456ffde231dcbf8dfc286122f82e51a49471972a02f026d50'});
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
 assert(Number.isInteger(r.zipBytes)&&r.zipBytes>0,`${key}:zipBytes`); assert(Number.isInteger(r.protectedFileCount)&&r.protectedFileCount>0,`${key}:protected`);
 assert(Number.isInteger(r.zipEntryCount)&&r.zipEntryCount>0,`${key}:entries`); assert(exactIso(r.createdAt),`${key}:createdAt`);
}
export function verifyReleaseManifest(root){
 const m=readJson(path.join(root,'release/ZVM_RELEASE_MANIFEST.json')); const v1=readJson(path.join(root,'zvm-official-builds.json')); const v2=readJson(path.join(root,'zvm-build-registry-v2.json'));
 assert(m.schema===1,'schema'); assert(m.releaseId==='ZVM-V746-0.8.541-R34-BUILD3-LEGACY-COMPAT-ASSET-REFRESH','releaseId');
 assert(m.server?.buildId==='2026-09-18-build3-v3-unpacked-compat-r34','server:buildId'); assert(m.server?.signedDevAuthority===true,'server:signedDevAuthority'); assert(m.server?.adminDevAccessControl===true,'server:adminDevAccessControl'); assert(m.server?.legacyBuild3UnpackedCorsCompat===true,'server:legacyBuild3UnpackedCorsCompat');
 assert(SHA256.test(String(m.server?.serverJsSha256||'')),'server:sha-format'); assert(shaFile(path.join(root,'server.js'))===m.server.serverJsSha256,'server:sha-mismatch');
 assert(m.server.nodeRuntime==='24.21.0','server:node'); assert(m.server.devCohostRequired===true,'server:cohost');
 const sa=m.server.devSigningAuthority||{}; assert(sa.algorithm==='Ed25519','signing:algorithm'); assert(sa.keyId==='dev-2026-01','signing:keyId');
 assert(typeof sa.publicKeyB64==='string'&&sa.publicKeyB64.length>40,'signing:publicKey'); assert(sa.buildMaxAgeDays===7,'signing:maxAge'); assert(sa.sessionTtlHours===12,'signing:session');
 try{const k=crypto.createPublicKey({key:Buffer.from(sa.publicKeyB64,'base64'),format:'der',type:'spki'});assert(k.asymmetricKeyType==='ed25519','signing:key-type')}catch{die('signing:publicKey-invalid')}
 const keys=Object.keys(m.extensions||{}).sort(); assert(JSON.stringify(keys)===JSON.stringify(['beta','dev']),'extensions:two-profile-only'); keys.forEach(k=>validateRecord(k,m.extensions[k]));
 const dev=m.extensions.dev;
 assert(dev.version===V746.version&&dev.buildId===V746.devBuildId&&dev.buildFingerprint===V746.devFingerprint&&dev.sourceTreeSha256===V746.source,'dev:v746-identity');
 assert(dev.extensionId===DEV_ID&&dev.channel==='dev'&&dev.profile==='dev','dev:pair'); assert(dev.buildId===`zvm-dev-${dev.version}-s${dev.sourceTreeSha256.slice(0,12)}`,'dev:derived-buildId');
 assert(dev.authorization==='signed-attestation-after-r31-activation','dev:authorization'); assert(dev.registryPreRegistrationRequired===false,'dev:registry-pre-registration');
 assert(dev.googleDriveOAuthQualified===false&&dev.oauthState==='pending-real-client-id-omitted','dev:oauth-pending');
 assert(dev.devAttestation?.algorithm==='Ed25519'&&dev.devAttestation?.keyId===sa.keyId,'dev:attestation'); assert(exactIso(dev.devAttestation.signedAt)&&exactIso(dev.devAttestation.expiresAt),'dev:attestation-time');
 assert(Date.parse(dev.devAttestation.expiresAt)-Date.parse(dev.createdAt)===7*24*60*60*1000,'dev:max-age'); assert(!v2.builds.some(x=>x?.buildId===dev.buildId),'dev:no-registry-prereg');
 const beta=m.extensions.beta;
 assert(beta.version===V746.version&&beta.buildId===V746.betaBuildId&&beta.buildFingerprint===V746.betaFingerprint&&beta.sourceTreeSha256===V746.source,'beta:v746-identity');
 assert(beta.extensionId===BETA_ID&&beta.channel==='beta'&&beta.profile==='release','beta:pair'); assert(beta.buildId===`zvm-beta-${beta.version}-s${beta.sourceTreeSha256.slice(0,12)}`,'beta:derived-buildId');
 assert(beta.runtimeAuthorized===false&&beta.releaseCandidate===false&&beta.registryPreRegistrationRequired===true,'beta:not-promoted');
 assert(beta.googleDriveOAuthQualified===false&&beta.oauthState==='pending-real-client-id-omitted','beta:oauth-pending');
 assert(beta.authorization==='pending-registry-v2-and-real-google-oauth','beta:authorization'); assert(!v2.builds.some(x=>x?.buildId===beta.buildId),'beta:not-in-registry');
 assert(beta.minification?.firstPartyReadableCopyThrough===0&&beta.minification?.firstPartyJsTotal===229,'beta:minification');
 exactRegistry(v2,{...ACTIVE_BETA,extensionId:BETA_ID},'active-beta'); exactRegistry(v2,{...PREVIOUS_BETA,extensionId:BETA_ID},'previous-beta'); exactRegistry(v2,{...ROLLBACK_BETA,extensionId:BETA_ID},'rollback-beta');
 assert(v2.builds.find(x=>x?.buildId==='zvm-beta-0.8.529-s3b3cdbbe7fe4')?.status==='revoked','v2:v734-revoked');
 assert(v1.schemaVersion===1&&Array.isArray(v1.builds?.['0.8.526'])&&v1.builds['0.8.526'].includes(V731_FP),'v1:rollback');
 const c=m.compatibility||{}; assert(c.v2BetaCurrentActive?.buildId===ACTIVE_BETA.buildId&&c.v2BetaCurrentActive?.authorization==='registry-v2-exact','compat:active-beta');
 assert(c.v2DevBundledLatest?.buildId===V746.devBuildId&&c.v2DevBundledLatest?.authorization==='signed-dev-attestation','compat:v746-dev');
 assert(c.v2BetaBundledLatest?.buildId===V746.betaBuildId&&c.v2BetaBundledLatest?.runtimeAuthorized===false,'compat:v746-beta-pending');
 assert(c.v2BetaPrevious?.buildId===PREVIOUS_BETA.buildId&&c.v2BetaRollback?.buildId===ROLLBACK_BETA.buildId,'compat:rollback'); assert(c.legacyV3Allowed===true&&c.destructiveMigration===false,'compat:legacy');
 const b3=c.legacyV3UnpackedBuild3||{}; assert(b3.extensionVersion==='0.2.7'&&b3.manifestKeyPresent===false&&b3.installationMode==='unpacked','compat:build3-shape'); assert(b3.artifactSha256==='0a5ee8280bbfa71396fdde22dcdff26b8c87b3f1ab9982648891f96a0284dc39','compat:build3-sha'); assert(Array.isArray(b3.corsPaths)&&b3.corsPaths.length===2&&b3.corsPaths.includes('/extension/v3/key')&&b3.corsPaths.includes('/extension/v3/check-status'),'compat:build3-paths');
 const g=m.prelaunchGates||{}; assert(g.node24LocalGatePassed===true,'gate:node24'); assert(g.serverR33Build3CompatLocalGatePassed===true,'gate:r33-build3-compat'); assert(g.v746ShowcaseFlowGatePassed===true,'gate:v746-showcase'); assert(g.v746DevSignedGatePassed===true,'gate:v746-dev-signed'); assert(g.v746BetaArtifactGatePassed===true,'gate:v746-beta-artifact'); assert(g.v746BetaFirstPartyReadableCopyThroughZero===true,'gate:v746-beta-minified');
 assert(g.v746GoogleOAuthRealGatePassed===false&&g.v746BetaRegistryPrepared===false&&g.v746ChromeWebStorePromotionAllowed===false,'gate:v746-pending-external'); assert(g.realChromeStoreInstallSmokePassed===false,'gate:store-smoke-open'); assert(g.chromeWebStoreSubmissionAllowed===false,'gate:store-submission-blocked');
 return {releaseId:m.releaseId,devBuildId:dev.buildId,betaBuildId:beta.buildId,activeBetaBuildId:ACTIVE_BETA.buildId,serverJsSha256:m.server.serverJsSha256};
}
function rootArg(argv){const i=argv.indexOf('--root');return i>=0&&argv[i+1]?path.resolve(argv[i+1]):path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')}
if(path.resolve(process.argv[1]||'')===path.resolve(fileURLToPath(import.meta.url))){try{const r=verifyReleaseManifest(rootArg(process.argv.slice(2)));console.log(`RELEASE_MANIFEST_OK ${r.releaseId} dev=${r.devBuildId} bundledBeta=${r.betaBuildId} activeBeta=${r.activeBetaBuildId} server=${r.serverJsSha256}`)}catch(e){console.error(e?.message||String(e));process.exitCode=1}}
