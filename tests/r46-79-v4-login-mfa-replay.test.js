'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const begin = "  if (p === R_EXT+'/v4/session/login' && req.method === 'POST') {";
const next = "  if (p === R_EXT+'/v4/session/refresh' && req.method === 'POST') {";
const i = source.indexOf(begin);
const j = source.indexOf(next, i + begin.length);
assert.ok(i >= 0 && j > i, 'V4 login source region present');
const routeBody = source.slice(i, j);
const runRoute = new Function('req', 'res', 'ip', 'deps',
  'with(deps) { return (async function() {' + routeBody + '})(); }');

function setup() {
  const seen = new Set();
  const counters = { shared: 0, local: 0, issued: 0, authenticated: 0 };
  const deps = {
    p: '/extension/v4/session/login', R_EXT: '/extension',
    ZVM_BUILD_ENFORCE: false, ZVM_DEV_BUILD_ALLOW: false,
    console: { error() {} },
    checkRateLimit: () => true,
    parseBody: async req => ({ ...req.body, clientSecurity: { ...req.body.clientSecurity } }),
    zvmSecurityCheckClientShared: async (security, options) => {
      counters.shared++;
      // DEV autorizada somente depois de associar a licença tem uma
      // pré-validação negativa, que NÃO registra requestId.
      if (security.kind === 'deferred' && !options?.licenseKey)
        return { ok: false, code: 'DEV_BUILD_NOT_AUTHORIZED' };
      if (seen.has(security.requestId))
        return { ok: false, code: 'SECURITY_REPLAY_REJECTED' };
      seen.add(security.requestId);
      return { ok: true, securityProtocol: 2, channel: security.channel,
        signedDev: security.channel === 'dev' && security.kind !== 'deferred',
        recognized: security.channel !== 'dev' };
    },
    zvmSecurityCheckClient: (security) => {
      counters.local++;
      return { ok: true, securityProtocol: 2, channel: security.channel,
        signedDev: security.channel === 'dev', recognized: security.channel !== 'dev' };
    },
    zvmSecurityClientErrorStatus: code => code === 'DEV_BUILD_NOT_AUTHORIZED' ? 403 : 400,
    async getMongoDb() {
      return { collection: () => ({ updateOne: () => Promise.resolve({ matchedCount: 1 }) }) };
    },
    async authenticateExtensionAccount(body) {
      counters.authenticated++;
      if (body.password !== 'placeholder-password')
        return { ok: false, status: 401, errorCode: 'invalid_credentials' };
      if (!body.totpCode)
        return { ok: false, status: 401, errorCode: 'mfa_required' };
      if (body.totpCode !== '123456')
        return { ok: false, status: 401, errorCode: 'invalid_totp' };
      return { ok: true, subject: { type: 'account' }, accountEmail: 'synthetic@example.invalid',
        licenseKeyCode: 'synthetic-key', devAccess: true, entitlement: { entitlementRevision: 'test' } };
    },
    zvmSecurityDevBuildAllowed: () => true,
    extensionSessionSecurityFields: () => ({}),
    async createExtensionSession() {
      counters.issued++;
      return { token: 'synthetic-token', doc: {} };
    },
    extensionSessionSuccess: () => ({ ok: true, session: { sessionId: 'synthetic' } }),
    zvmInvalidateMongoOnNetworkError: () => false,
    sendJson: (res, body, status = 200) => { res.reply = { body, status }; },
  };
  async function login(id, channel, totpCode, kind = 'signed', password = 'placeholder-password') {
    const req = { method: 'POST', body: {
      password, totpCode,
      clientSecurity: { protocol: 2, channel, kind, requestId: id }
    } };
    const res = { setHeader() {} };
    await runRoute(req, res, 'synthetic-ip', deps);
    assert.ok(res.reply, 'server replied');
    return res.reply;
  }
  return { login, counters };
}

(async () => {
  const t = setup();
  assert.equal((await t.login('dev-start','dev','')).body.errorCode, 'mfa_required');
  assert.equal((await t.login('dev-wrong','dev','000000')).body.errorCode, 'invalid_totp');
  assert.equal((await t.login('dev-invalid-password','dev','123456','signed','wrong-password')).body.errorCode, 'invalid_credentials');
  assert.equal((await t.login('dev-finish','dev','123456')).status, 200,
    'signed DEV completes login after correct 2FA without consuming requestId twice');
  assert.equal(t.counters.local, 1,
    'signed DEV post-MFA recheck is read-only, after one shared anti-replay consume');
  assert.equal((await t.login('dev-finish','dev','123456')).body.errorCode, 'SECURITY_REPLAY_REJECTED',
    'actual repeated requestId still blocked');
  assert.equal((await t.login('beta-finish','beta','123456')).status, 200);
  assert.equal((await t.login('production-finish','production','123456')).status, 200);
  assert.equal((await t.login('legacy-dev-start','dev','','deferred')).body.errorCode, 'mfa_required');
  assert.equal((await t.login('legacy-dev-finish','dev','123456','deferred')).status, 200,
    'deferred DEV still consumes security request only when license has been confirmed');
  assert.equal((await t.login('legacy-dev-finish','dev','123456','deferred')).body.errorCode,
    'SECURITY_REPLAY_REJECTED', 'deferred DEV replay remains blocked');
  assert.equal(t.counters.issued, 4, 'sessions issued only for fully authenticated users');
  console.log('R46.79: V4 login 2FA + shared replay + signed/deferred DEV + BETA + RELEASE PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
