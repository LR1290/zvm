'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Owner-approved landing markup. Keep sales authority on the server, never in client JS.
const template = fs.readFileSync(path.join(__dirname, 'owner-template.html'), 'utf8');

const ownerBrandSourceMatch = template.match(/<footer[\s\S]*?<img src="(data:image\/png;base64,[A-Za-z0-9+/=]+)" alt="ZVM Automações">/);
if (!ownerBrandSourceMatch) throw new Error('ZVM canonical header brand artwork missing');
const OWNER_TOP_BRAND_SRC = ownerBrandSourceMatch[1];
const OWNER_CSS_HREF = '/assets/zvm-sales-owner.a0ba31f21435.css';

const PLAN_KEYS = Object.freeze({ SOLO: 'solo', PADRAO: 'padrao', PRO: 'pro' });

function approvedTestimonials(raw, escHtml) {
  if (typeof raw !== 'string' || raw.length > 18000) return '';
  let entries;
  try { entries = JSON.parse(raw); } catch (_) { return ''; }
  if (!Array.isArray(entries)) return '';
  const approved = entries.filter(item =>
    item && item.approved === true &&
    typeof item.approvalId === 'string' && /^[a-zA-Z0-9_-]{6,80}$/.test(item.approvalId) &&
    typeof item.name === 'string' && item.name.trim().length >= 2 && item.name.length <= 80 &&
    typeof item.quote === 'string' && item.quote.trim().length >= 20 && item.quote.length <= 460
  ).slice(0, 3);
  if (!approved.length) return '';
  const cards = approved.map(item => {
    const role = typeof item.role === 'string' ? item.role.trim().slice(0, 80) : '';
    return '<article class="card"><blockquote>“' + escHtml(item.quote.trim()) + '”</blockquote>' +
      '<div class="who">' + escHtml(item.name.trim()) + '</div>' +
      (role ? '<div class="role">' + escHtml(role) + '</div>' : '') + '</article>';
  }).join('');
  return '<section class="zvm-testimonials" id="depoimentos" aria-labelledby="depoimentos-title">' +
    '<div class="wrap"><div class="head"><span class="eyebrow">Depoimentos reais</span>' +
    '<h2 id="depoimentos-title">A experiência de quem usa a ZVM.</h2></div>' +
    '<div class="cards c3">' + cards + '</div></div></section>';
}

function renderOwnerSalesLanding({ plans, salesPaused, escHtml, testimonialsJson = '', supportUrl = '', publicNavHtml }) {
  if (!plans || typeof escHtml !== 'function') throw new TypeError('Missing sales page dependencies');
  if (typeof publicNavHtml !== 'string' || !publicNavHtml.includes('class="znav standalone-nav"')) {
    throw new TypeError('Missing canonical public navigation');
  }
  const paused = salesPaused !== false;
  const tokens = Object.create(null);
  tokens.ZVM_OWNER_CSS = OWNER_CSS_HREF;
  tokens.ZVM_PUBLIC_NAV = publicNavHtml;
  tokens.ZVM_NOTICE_HIDDEN = paused ? '' : ' hidden';
  tokens.ZVM_NOTE_HIDDEN = paused ? '' : ' hidden';
  tokens.ZVM_TESTIMONIALS = approvedTestimonials(testimonialsJson, escHtml);
  tokens.ZVM_YEAR = String(new Date().getUTCFullYear());
  // Only the configured support WhatsApp endpoint is permitted in owner markup.
  tokens.ZVM_SUPPORT_URL = escHtml(/^https:\/\/wa\.me\/[0-9]{8,15}\?text=[a-zA-Z0-9%_.~+\-]*$/.test(supportUrl) ? supportUrl : '/faq');

  for (const [name, id] of Object.entries(PLAN_KEYS)) {
    const plan = plans[id];
    const price = Number(plan?.price);
    const count = Number(plan?.maxUses);
    const validPrice = Number.isFinite(price) && price > 0;
    const validCount = Number.isSafeInteger(count) && count > 0;
    tokens['ZVM_PRICE_' + name] = validPrice ? 'R$ ' + price.toFixed(2).replace('.', ',') : 'Consultar';
    tokens['ZVM_LIMIT_' + name] = validCount
      ? (count === 1 ? '1 número de WhatsApp' : 'Até ' + count + ' números de WhatsApp')
      : 'Consulte os limites do plano';
    const sellable = !paused && plan?.enabled === true && validPrice && validCount;
    tokens['ZVM_BTN_CLASS_' + name] = sellable ? '' : 'ghost';
    tokens['ZVM_BTN_LABEL_' + name] = sellable ? 'Assinar ' + (name === 'PADRAO' ? 'START' : name) : 'Ver detalhes';
  }

  const enterpriseCount = Number(plans.enterprise_v2?.maxUses);
  tokens.ZVM_LIMIT_ENTERPRISE = Number.isSafeInteger(enterpriseCount) && enterpriseCount > 0
    ? enterpriseCount + ' números de WhatsApp, com implantação personalizada'
    : 'Implantação personalizada sob consulta';

  const html = template.replace(/\{\{(ZVM_[A-Z0-9_]+)\}\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(tokens, key)) throw new Error('Unresolved sales token: ' + key);
    return String(tokens[key]);
  });
  if (/\{\{ZVM_[A-Z0-9_]+\}\}/.test(html)) throw new Error('Sales page template unresolved');
  return html;
}

module.exports = Object.freeze({ renderOwnerSalesLanding, approvedTestimonials, OWNER_TOP_BRAND_SRC });
