'use strict';
// R46.17 — auditoria operacional explicitamente READ-ONLY. No provider POST,
// queue update, license mutation, customer export or storage of webhook payloads.
const crypto = require('node:crypto');
const API_ORIGIN = 'https://api.cakto.com.br';
const HISTORY_PATH = '/public_api/webhook/event_history/';
const ENTITLEMENT_EVENTS = new Set(['purchase_approved', 'subscription_renewed']);
const hash = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const eventKeyFor = (txId) => `cakto:purchase_approved:evt_${hash(`cakto:event\0${txId}`)}`;
const paymentKeyFor = (txId) => `cpt_${hash(`cakto\0${txId}`)}`;
const orderRef = (id) => `order#${hash(`cakto:reconcile\0${id}`).slice(0, 12)}`;
const safeOrderId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(id);
const httpStatus = x => x !== null && x !== undefined && x !== '' && Number.isInteger(Number(x)) ? Number(x) : null;

function historyURL(input) {
  const url = new URL(input, API_ORIGIN);
  if (url.origin !== API_ORIGIN || url.protocol !== 'https:' || url.username || url.password || url.pathname !== HISTORY_PATH || url.hash) {
    throw Error('cakto_history_pagination_url_rejected');
  }
  return url.toString();
}
function orderURL(id) {
  if (!safeOrderId(id)) throw Error('cakto_invalid_order_id');
  return `${API_ORIGIN}/public_api/orders/${encodeURIComponent(id)}/`;
}
function parseMainOrder(row) {
  if (!row || !ENTITLEMENT_EVENTS.has(String(row.event_id || row.payload?.event || '').toLowerCase())) return { category: 'ignored_event' };
  const data = row.payload?.data;
  const entries = Array.isArray(data) ? data : [data];
  const mains = entries.filter(x => x && typeof x === 'object' && !Array.isArray(x) && (!x.offer_type || x.offer_type === 'main'));
  if (mains.length !== 1 || !safeOrderId(mains[0].id)) return { category: 'ambiguous_payload' };
  return { category: 'candidate', id: mains[0].id, originalStatus: String(mains[0].status || '').toLowerCase(), status: httpStatus(row.event_status) };
}
function currentOrderPaid(order, id) {
  if (!order || String(order.id) !== id) return false;
  if (String(order.status || '').toLowerCase() !== 'paid') return false;
  // Status alone may be stale or inconsistent; fail closed on reversals.
  return !order.refundedAt && !order.chargedbackAt && !order.canceledAt;
}
function newSummary() {
  return { pagesRead: 0, entriesRead: 0, matchedWebhook: 0, ignoredUnrelated: 0,
    ignoredEvent: 0, ambiguous: 0, orderCurrentNotPaid: 0, orderVerificationFailed: 0,
    existingPayment: 0, existingQueue: 0, missingVerifiedPaid: 0, sample: [],
    complete: false, readOnly: true, replayPerformed: false, licensesChanged: false };
}
async function reconcileRows(rows, opts) {
  const { webhookUrl, fetchOrder, findQueue, findPayment, summary, maxOrders = 30, maxSample = 12 } = opts;
  if (!webhookUrl || typeof fetchOrder !== 'function' || typeof findQueue !== 'function' || typeof findPayment !== 'function') throw Error('cakto_audit_configuration_missing');
  const webhookURL = new URL(webhookUrl);
  if (webhookURL.protocol !== 'https:' || webhookURL.username || webhookURL.password) throw Error('cakto_audit_webhook_url_invalid');
  const visited = opts.visited || new Set();
  const scanned = opts.scanned || { count: 0 };
  for (const row of rows) {
    summary.entriesRead++;
    if (String(row?.app?.url || row?.url || '') !== webhookUrl) { summary.ignoredUnrelated++; continue; }
    summary.matchedWebhook++;
    const parsed = parseMainOrder(row);
    if (parsed.category === 'ignored_event') { summary.ignoredEvent++; continue; }
    if (parsed.category !== 'candidate' || parsed.originalStatus !== 'paid') { summary.ambiguous++; continue; }
    // Same paid order can have multiple history events; only one lookup.
    if (visited.has(parsed.id)) continue;
    visited.add(parsed.id);
    if (++scanned.count > maxOrders) return { truncated: true };
    const payment = await findPayment(paymentKeyFor(parsed.id), parsed.id);
    if (payment) { summary.existingPayment++; continue; }
    const queue = await findQueue(eventKeyFor(parsed.id));
    if (queue) { summary.existingQueue++; continue; }
    let current;
    try { current = await fetchOrder(parsed.id); }
    catch (_) { summary.orderVerificationFailed++; continue; }
    if (!currentOrderPaid(current, parsed.id)) { summary.orderCurrentNotPaid++; continue; }
    // Candidate for human commercial review only: offer/product plan mapping
    // is intentionally not assumed from a webhook history row.
    summary.missingVerifiedPaid++;
    if (summary.sample.length < maxSample) summary.sample.push({ ref: orderRef(parsed.id), providerHttpStatus: parsed.status });
  }
  return { truncated: false };
}
async function getJSON(url, token, { fetcher = fetch, maxBytes = 1_000_000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher(url, { method: 'GET', redirect: 'manual', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw Error(`cakto_api_http_${response.status}`);
    const sizeHint = Number(response.headers?.get?.('content-length') || 0);
    if (sizeHint > maxBytes) throw Error('cakto_api_response_too_large');
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw Error('cakto_api_response_too_large');
    return JSON.parse(raw);
  } finally { clearTimeout(timeout); }
}
async function audit({ token, webhookUrl, mongoDb, fetcher = fetch, maxPages = 3, maxOrders = 30 }) {
  if (!token || !webhookUrl || !mongoDb) throw Error('cakto_audit_configuration_missing');
  if (!(maxPages >= 1 && maxPages <= 20 && maxOrders >= 1 && maxOrders <= 500)) throw Error('cakto_audit_limits_invalid');
  const summary = newSummary();
  const visited = new Set(), scanned = { count: 0 }, pagesVisited = new Set();
  const coll = mongoDb.collection('webhook_events'), payments = mongoDb.collection('payments');
  // Provider-supported filter: latest approved/renewal deliveries first.
  let next = historyURL(`${HISTORY_PATH}?event_id=purchase_approved%2Csubscription_renewed&ordering=-dispatchedAt`);
  let exhausted = false, truncated = false;
  while (next && summary.pagesRead < maxPages) {
    const safe = historyURL(next);
    if (pagesVisited.has(safe)) throw Error('cakto_history_pagination_cycle');
    pagesVisited.add(safe);
    const page = await getJSON(safe, token, { fetcher });
    if (!page || !Array.isArray(page.results)) throw Error('cakto_history_invalid_response');
    summary.pagesRead++;
    const state = await reconcileRows(page.results, { webhookUrl, summary, visited, scanned, maxOrders,
      fetchOrder: id => getJSON(orderURL(id), token, { fetcher }),
      findQueue: key => coll.findOne({ eventKey: key, source: 'cakto' }, { projection: { _id: 1 } }),
      findPayment: (key, id) => payments.findOne({ approved: true, $or: [
        { commercialTxKey: key }, { txId: id, txNamespace: 'cakto' }, { txId: id, source: 'cakto' },
      ] }, { projection: { _id: 1 } }),
    });
    if (state.truncated) { truncated = true; break; }
    next = page.next ? historyURL(page.next) : null;
    exhausted = !next;
  }
  summary.complete = exhausted && !truncated;
  summary.truncationReason = truncated ? 'max_orders' : (!exhausted ? 'max_pages' : null);
  return summary;
}
async function main() {
  // Only explicit --audit; no scheduled job and no persistent report.
  if (process.argv.slice(2).some(x => x !== '--audit')) throw Error('cakto_audit_only_supported');
  if (!process.argv.includes('--audit')) throw Error('cakto_audit_requires_explicit_flag');
  const token = process.env.CAKTO_READONLY_ACCESS_TOKEN;
  const webhookUrl = process.env.CAKTO_AUDIT_WEBHOOK_URL;
  const mongoUri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB;
  if (!token || !webhookUrl || !mongoUri || !dbName) throw Error('cakto_audit_env_required');
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 7500 });
  try {
    await client.connect();
    const summary = await audit({ token, webhookUrl, mongoDb: client.db(dbName) });
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.complete) process.exitCode = 2;
  } finally { await client.close(); }
}
if (require.main === module) main().catch(e => {
  // Intentionally never log raw errors: driver/URL failures may contain secrets.
  console.error('Cakto reconciliação read-only não concluída:', /^cakto_[a-z0-9_]+$/.test(e.message) ? e.message : 'operational_error');
  process.exitCode = 1;
});
module.exports = { audit, reconcileRows, parseMainOrder, currentOrderPaid, historyURL, orderURL, getJSON, newSummary, eventKeyFor, paymentKeyFor };
