'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {validateRuntimeSecurityConfig} = require('../runtime-config');

const baseEnv = Object.freeze({
  ZVM_RUNTIME_ENV: 'production',
  ZVM_BUILD_ENFORCE: '1',
  ZVM_DEV_BUILD_ALLOW: '0',
  ZVM_DEV_COHOST_ALLOW: '0',
  ZVM_DEV_SIGNED_BUILDS_ALLOW: '0',
});
const authority = Object.freeze({
  buildEnforce: true, extensionIdCount: 1, registryV2ActiveCount: 21,
  devSigningConfigured: false, devSigningKeyCount: 0,
});
function codes(env, auth = authority, features = {}) {
  try { return {ok:validateRuntimeSecurityConfig(env,auth,features).ok,codes:[]}; }
  catch(e) { assert.equal(e.code,'RUNTIME_SECURITY_CONFIG_INVALID'); return {ok:false,codes:e.problems}; }
}
test('production: existing CWS registry without DEV cohosting stays valid',()=>{
  assert.equal(codes({...baseEnv}).ok,true);
});
test('production: disabling build enforcement fails startup',()=>{
  const out=codes({...baseEnv,ZVM_BUILD_ENFORCE:'0'},{...authority,buildEnforce:false});
  assert(out.codes.includes('ZVM_BUILD_ENFORCE_required_in_production'));
});
test('production: DEV cohosting without signed build authority fails closed',()=>{
  const out=codes({...baseEnv,ZVM_DEV_COHOST_ALLOW:'1'},{...authority,devCohostAllow:true});
  assert(out.codes.includes('ZVM_DEV_COHOST_REQUIRES_SIGNED_BUILDS'));
});
test('production: existing signed DEV cohosting remains valid',()=>{
  const env={...baseEnv,ZVM_DEV_COHOST_ALLOW:'1',ZVM_DEV_SIGNED_BUILDS_ALLOW:'1'};
  const auth={...authority,devCohostAllow:true,devSignedBuildsAllow:true,devSigningConfigured:true,devSigningKeyCount:1};
  assert.equal(codes(env,auth).ok,true);
});
test('production: DEV signing without a verified key remains blocked',()=>{
  const env={...baseEnv,ZVM_DEV_COHOST_ALLOW:'1',ZVM_DEV_SIGNED_BUILDS_ALLOW:'1'};
  const out=codes(env,{...authority,devCohostAllow:true,devSignedBuildsAllow:true,devSigningConfigured:false,devSigningKeyCount:0});
  assert(out.codes.includes('ZVM_DEV_SIGNING_CONFIG_required'));
});
test('production: unsigned DEV bypass remains forbidden',()=>{
  const out=codes({...baseEnv,ZVM_DEV_BUILD_ALLOW:'1'},{...authority,devBuildAllow:true});
  assert(out.codes.includes('ZVM_DEV_BUILD_ALLOW_forbidden_in_production'));
});
test('staging: DEV cohosting remains forbidden',()=>{
  const env={ZVM_RUNTIME_ENV:'staging',ZVM_BUILD_ENFORCE:'1',ZVM_DEV_COHOST_ALLOW:'1',MONGODB_DB:'zvm_lab'};
  const out=codes(env,{...authority,devCohostAllow:true},{productionDbName:'zapvoice'});
  assert(out.codes.includes('ZVM_DEV_COHOST_ALLOW_forbidden_in_staging'));
});
test('staging: isolated database and enforced builds remain valid',()=>{
  const env={ZVM_RUNTIME_ENV:'staging',ZVM_BUILD_ENFORCE:'1',MONGODB_DB:'zvm_lab'};
  assert.equal(codes(env,{...authority},{productionDbName:'zapvoice'}).ok,true);
});
