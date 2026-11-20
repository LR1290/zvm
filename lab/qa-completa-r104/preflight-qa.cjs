'use strict';
// Read-only startup guard for the isolated ZVM Automações COMPLETA R104 QA service.
// Does not connect to MongoDB/Render and never prints connection strings or credentials.
const { URL } = require('node:url');
const QA_DB = 'zvm_completa_qa_r103';
const QA_MONGO_USER = 'zvm_completa_qa_runner';
const DEV_EXTENSION_ID = 'ckbffcbmanboelbihfkhiahgafnimcho';
const QA_SCOPE = 'zvm-completa-r104';
const QA_PUBLIC_HOST = /^zvm-completa-qa-[a-z0-9-]+\.onrender\.com$/;
const ATLAS_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.mongodb\.net$/;
const PAID_SECRETS = [
  'CAKTO_WEBHOOK_SECRET', 'CAKTO_READONLY_CLIENT_SECRET',
  'CAKTO_RECOVERY_SECRET', 'CAKTO_RECOVERY_SECRET_PREVIOUS',
  'META_APP_SECRET',
];
function invalid(code) { const e = Error(code); e.code = code; throw e; }
function checkQaEnvironment(env = process.env) {
  if (env.ZVM_QA_SCOPE !== QA_SCOPE) invalid('QA_SCOPE_NOT_CONFIRMED');
  const host = String(env.ZVM_QA_PUBLIC_HOSTNAME || '').trim().toLowerCase();
  if (!QA_PUBLIC_HOST.test(host)) invalid('QA_PUBLIC_HOST_NOT_EXCLUSIVE');
  const renderHost = String(env.RENDER_EXTERNAL_HOSTNAME || '').trim().toLowerCase();
  if (renderHost && host !== renderHost) invalid('QA_RENDER_HOST_MISMATCH');
  if (env.MONGODB_DB !== QA_DB) invalid('QA_DATABASE_MISMATCH');
  const atlasHost = String(env.ZVM_QA_ATLAS_HOST || '').trim().toLowerCase();
  if (!ATLAS_HOST.test(atlasHost)) invalid('QA_ATLAS_HOST_INVALID');
  let url;
  try { url = new URL(String(env.MONGODB_URI || '')); }
  catch (_) { invalid('QA_MONGODB_URI_INVALID'); }
  let username;
  try { username = decodeURIComponent(url.username); }
  catch (_) { invalid('QA_MONGODB_USER_INVALID'); }
  if (url.protocol !== 'mongodb+srv:' || url.hostname !== atlasHost ||
      url.port || url.pathname !== '/' + QA_DB || url.search || url.hash ||
      username !== QA_MONGO_USER || !url.password) invalid('QA_MONGODB_TARGET_INVALID');
  const extensionIds = String(env.ZVM_EXTENSION_IDS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (extensionIds.length !== 1 || extensionIds[0] !== DEV_EXTENSION_ID) invalid('QA_EXTENSION_ID_MISMATCH');
  if (!/^[a-f0-9]{64}$/i.test(String(env.ZVM_QA_FREE_SUBJECT || '')) ||
      /^0{64}$/i.test(String(env.ZVM_QA_FREE_SUBJECT || ''))) invalid('QA_FREE_SUBJECT_NOT_CONFIGURED');
  if (!String(env.ADMIN_USER || '').trim() || String(env.ADMIN_PASS || '').length < 12 ||
      String(env.APP_SECRET || '').length < 32) invalid('QA_ADMIN_OR_APP_SECRETS_MISSING');
  for (const k of PAID_SECRETS) if (String(env[k] || '').trim()) invalid('QA_PRODUCTION_INTEGRATION_SECRET_PRESENT');
  // A successful syntactic preflight never proves Atlas project/role isolation or build authorization.
  return Object.freeze({ scope: QA_SCOPE, backendHostname: host, atlasHostname: atlasHost,
    database: QA_DB, extensionId: DEV_EXTENSION_ID,
    renderHostnameVerified: Boolean(renderHost),
    atlasProjectAndRoleVerified: false, buildAuthorized: false,
    writesPerformed: false });
}
if (require.main === module) {
  try {
    const result = checkQaEnvironment();
    process.stdout.write(JSON.stringify({ ok: true, ...result }) + '\n');
  } catch (e) {
    process.stderr.write('QA_PREFLIGHT_FAILED: ' + (e.code || 'UNKNOWN_ERROR') + '\n');
    process.exitCode = 1;
  }
}
module.exports = { checkQaEnvironment, QA_DB, QA_SCOPE, DEV_EXTENSION_ID };
