'use strict';

function envTrue(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function countExtensionIds(raw) {
  return String(raw || '').split(',').map(value => value.trim().toLowerCase()).filter(value => /^[a-p]{32}$/.test(value)).length;
}

function countHashes(raw) {
  return String(raw || '').split(/[;,\n\s]+/).map(value => value.trim().toLowerCase()).filter(value => /^[a-f0-9]{64}$/.test(value)).length;
}

function validateRuntimeSecurityConfig(env = {}, authorityState = {}, featureState = {}) {
  const problems = [];
  const runtimeEnv = String(env.ZVM_RUNTIME_ENV || '').trim().toLowerCase();
  const localSafeMode = envTrue(env.ZVM_LOCAL_SAFE_MODE);
  const renderRuntime = envTrue(env.RENDER);
  if (!runtimeEnv) problems.push('ZVM_RUNTIME_ENV_required');
  else if (!['staging', 'production'].includes(runtimeEnv)) problems.push('ZVM_RUNTIME_ENV_invalid');

  const requestedBuildEnforce = typeof authorityState.buildEnforce === 'boolean'
    ? authorityState.buildEnforce
    : envTrue(env.ZVM_BUILD_ENFORCE);
  const requestedDevBuildAllow = typeof authorityState.devBuildAllow === 'boolean'
    ? authorityState.devBuildAllow
    : envTrue(env.ZVM_DEV_BUILD_ALLOW);
  const requestedDevCohostAllow = typeof authorityState.devCohostAllow === 'boolean'
    ? authorityState.devCohostAllow
    : envTrue(env.ZVM_DEV_COHOST_ALLOW);
  const requestedDevSignedBuildsAllow = typeof authorityState.devSignedBuildsAllow === 'boolean'
    ? authorityState.devSignedBuildsAllow
    : envTrue(env.ZVM_DEV_SIGNED_BUILDS_ALLOW);
  // Local Safe Mode is an operator safety boundary: never inherit production
  // build enforcement or DEV bypass from a reused .env. The launcher also
  // overlays these values, but the validator remains fail-safe on its own.
  const buildEnforce = localSafeMode ? false : requestedBuildEnforce;
  const devBuildAllow = localSafeMode ? false : requestedDevBuildAllow;
  const devCohostAllow = localSafeMode ? false : requestedDevCohostAllow;
  const devSignedBuildsAllow = localSafeMode ? false : requestedDevSignedBuildsAllow;
  const extensionIdCount = Number.isInteger(authorityState.extensionIdCount)
    ? authorityState.extensionIdCount
    : countExtensionIds(env.ZVM_EXTENSION_IDS);
  const devKeyHashCount = Number.isInteger(authorityState.devKeyHashCount)
    ? authorityState.devKeyHashCount
    : countHashes(env.ZVM_DEV_BUILD_KEY_HASHES);
  const devDeviceHashCount = Number.isInteger(authorityState.devDeviceHashCount)
    ? authorityState.devDeviceHashCount
    : countHashes(env.ZVM_DEV_BUILD_DEVICE_HASHES);
  const registryV2ActiveCount = Number.isInteger(authorityState.registryV2ActiveCount)
    ? authorityState.registryV2ActiveCount
    : 0;
  const devSigningKeyCount = Number.isInteger(authorityState.devSigningKeyCount) ? authorityState.devSigningKeyCount : 0;
  const devSigningConfigured = authorityState.devSigningConfigured === true;

  if (localSafeMode && renderRuntime) problems.push('ZVM_LOCAL_SAFE_MODE_forbidden_on_render');

  if (runtimeEnv === 'production') {
    if (buildEnforce && extensionIdCount < 1) problems.push('ZVM_EXTENSION_IDS_required');
    if (buildEnforce && registryV2ActiveCount < 1) problems.push('ZVM_BUILD_REGISTRY_V2_active_required');
    if (devBuildAllow) problems.push('ZVM_DEV_BUILD_ALLOW_forbidden_in_production');
    if (devCohostAllow && registryV2ActiveCount < 1 && !devSignedBuildsAllow) problems.push('ZVM_BUILD_REGISTRY_V2_active_required_for_dev_cohost');
    if (devSignedBuildsAllow && !devCohostAllow) problems.push('ZVM_DEV_COHOST_ALLOW_required_for_signed_dev');
    if (devSignedBuildsAllow && (!devSigningConfigured || devSigningKeyCount < 1)) problems.push('ZVM_DEV_SIGNING_CONFIG_required');
    if (authorityState.registryV2Error === true) problems.push('ZVM_BUILD_REGISTRY_V2_invalid');
  }

  if (runtimeEnv === 'staging') {
    if (devCohostAllow) problems.push('ZVM_DEV_COHOST_ALLOW_forbidden_in_staging');
    if (devSignedBuildsAllow) problems.push('ZVM_DEV_SIGNED_BUILDS_ALLOW_forbidden_in_staging');
    if (!buildEnforce) problems.push('ZVM_BUILD_ENFORCE_required_in_staging');
    if (extensionIdCount < 1) problems.push('ZVM_EXTENSION_IDS_required');
    if (devBuildAllow && devKeyHashCount < 1) problems.push('ZVM_DEV_BUILD_KEY_HASHES_required');
    if (devBuildAllow && devDeviceHashCount < 1) problems.push('ZVM_DEV_BUILD_DEVICE_HASHES_required');
    const productionDbName = String(featureState.productionDbName || 'zapvoice').trim();
    const currentDbName = String(env.MONGODB_DB || '').trim();
    if (!currentDbName || currentDbName === productionDbName) problems.push('MONGODB_DB_must_be_isolated');
    if (authorityState.registryV2Error === true) problems.push('ZVM_BUILD_REGISTRY_V2_invalid');
  }

  for (const requirement of featureState.requiredCrypto || []) {
    if (!requirement || requirement.enabled !== true || requirement.configured === true) continue;
    const code = String(requirement.code || 'REQUIRED_CRYPTO_SECRET_missing').replace(/[^A-Za-z0-9_:-]/g, '');
    problems.push(code || 'REQUIRED_CRYPTO_SECRET_missing');
  }

  if (problems.length) {
    const error = new Error(`RUNTIME_SECURITY_CONFIG_INVALID:${problems.join(',')}`);
    error.code = 'RUNTIME_SECURITY_CONFIG_INVALID';
    error.problems = Object.freeze(problems.slice());
    throw error;
  }

  return Object.freeze({
    ok: true,
    runtimeEnv,
    buildEnforce,
    devBuildAllow,
    devCohostAllow,
    devSignedBuildsAllow,
    extensionIdCount,
    devKeyHashCount,
    devDeviceHashCount,
    localSafeMode,
  });
}

module.exports = { validateRuntimeSecurityConfig };
