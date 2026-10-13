'use strict';
const https = require('https');
const { SUPPORT_URL } = require('./src/support-contact');
const { buildKeyDeliveryDesign } = require('./src/email-key-delivery-design');

const BG = '#08110d';
const CARD = '#0f1712';
const CARD2 = '#141d17';
const BORDER = '#1e2b23';
const PRIMARY = '#00e676';
const WARN = '#f0b429';
const TEXT = '#eef2f0';
const DIM = '#8a9992';
const MUTED = '#4d5952';
const CONTENT_WIDTH = 680;
const ZVM_BRAND_ICON_BASE64 = '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';
const ZVM_BRAND_ICON_DATA_URI = 'data:image/png;base64,' + ZVM_BRAND_ICON_BASE64;
const ZVM_BRAND_ICON_CID = 'zvm-brand-icon';

function escHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeHttpUrl(value, fallback = '#') {
  try {
    const u = new URL(String(value || ''));
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.toString() : fallback;
  } catch { return fallback; }
}

function baseOrigin(value) {
  try {
    const u = new URL(String(value || ''));
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.origin : '';
  } catch { return ''; }
}

function _brand() {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 auto;"><tr>
    <td valign="middle" style="padding:0 8px 0 0;"><img src="${ZVM_BRAND_ICON_DATA_URI}" width="38" height="35" alt="" aria-hidden="true" style="display:block;border:0;outline:none;text-decoration:none;width:38px;height:35px;object-fit:contain;"></td>
    <td valign="middle" style="font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:24px;font-weight:900;letter-spacing:1px;color:${PRIMARY};white-space:nowrap;">ZVM</td>
  </tr></table>`;
}

function _send(subject, to, html) {
  return new Promise(resolve => {
    const apiKey = String(process.env.RESEND_API_KEY || '').trim();
    const from = String(process.env.EMAIL_FROM || 'ZVM <noreply@zvm.app>').trim();
    const addr = String(to || '').trim();
    if (!apiKey) { resolve({ ok: false, reason: 'RESEND_API_KEY não configurado' }); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) || addr.length > 254) {
      resolve({ ok: false, reason: 'destinatário inválido' }); return;
    }
    const safeSubject = String(subject || '(sem assunto)').replace(/[\r\n]+/g, ' ').slice(0, 200);
    const safeHtml = String(html || '');
    if (Buffer.byteLength(safeHtml, 'utf8') > 1024 * 1024) {
      resolve({ ok: false, reason: 'conteúdo do e-mail excede 1 MB' }); return;
    }

    // Gmail e outros webmails não renderizam data: URI em <img> de forma
    // confiável. A prévia HTML continua usando o data URI, mas no envio real
    // o logo é convertido para uma imagem inline CID suportada pelo Resend.
    const outboundHtml = safeHtml.split(ZVM_BRAND_ICON_DATA_URI).join(`cid:${ZVM_BRAND_ICON_CID}`);
    const replyTo = String(process.env.EMAIL_REPLY_TO || '').trim();
    const category = /Redefinição de senha/i.test(safeSubject) ? 'password_reset'
      : /Renovação confirmada/i.test(safeSubject) ? 'license_renewed'
      : /licença está pronta/i.test(safeSubject) ? 'license_ready'
      : /vence em breve/i.test(safeSubject) ? 'license_expiry'
      : 'transactional';
    const payload = {
      from,
      to: [addr],
      subject: safeSubject,
      html: outboundHtml,
      attachments: [{
        content: ZVM_BRAND_ICON_BASE64,
        filename: 'zvm-logo.png',
        content_type: 'image/png',
        content_id: ZVM_BRAND_ICON_CID,
      }],
      tags: [
        { name: 'source', value: 'zvm_transactional' },
        { name: 'type', value: category },
      ],
    };
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo) && replyTo.length <= 254) payload.reply_to = replyTo;
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'ZVM-Server/1.0',
      },
    }, r => {
      let bytes = 0;
      const chunks = [];
      r.on('data', chunk => {
        bytes += chunk.length;
        if (bytes <= 16 * 1024) chunks.push(Buffer.from(chunk));
      });
      r.on('end', () => {
        if (r.statusCode >= 200 && r.statusCode < 300) {
          let id = null;
          try { id = JSON.parse(Buffer.concat(chunks).toString('utf8')).id || null; } catch {}
          resolve({ ok: true, id }); return;
        }
        console.warn('[MAILER] Resend recusou envio:', r.statusCode, `(resposta ${bytes} bytes)`);
        resolve({ ok: false, reason: `Resend HTTP ${r.statusCode || 0}` });
      });
    });
    req.on('error', e => { console.warn('[MAILER] Erro de rede:', e.message); resolve({ ok: false, reason: 'erro de rede' }); });
    req.setTimeout(8000, () => { req.destroy(new Error('timeout')); });
    req.write(body); req.end();
  });
}

function _shell({ eyebrow, eyebrowColor, title, bodyHtml, footNote, baseUrl }) {
  const accent = eyebrowColor || PRIMARY;
  const base = baseOrigin(baseUrl);
  const home = base ? base + '/' : '#';
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>ZVM</title>
<style>
@media (min-width:641px){.zvm-card-pad{padding:44px 48px 40px!important}}
@media (max-width:640px){.zvm-stack{display:block!important;width:100%!important}.zvm-stack+.zvm-stack{margin-top:10px!important;border-radius:10px!important;border-left:1px solid ${BORDER}!important}.zvm-stack:first-child{border-radius:10px!important}.zvm-btn-cell{display:block!important;width:100%!important;padding:0 0 10px!important}.zvm-btn-cell:last-child{padding-bottom:0!important}.zvm-btn-cell table{width:100%!important}.zvm-btn-cell a{display:block!important;text-align:center!important}}
</style></head>
<body style="margin:0;padding:0;background:${BG};">
<div style="display:none!important;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${BG};">${escHtml(title)} — ZVM</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="${CONTENT_WIDTH}" cellpadding="0" cellspacing="0" style="max-width:${CONTENT_WIDTH}px;width:100%;">
<tr><td align="center" style="padding-bottom:26px;"><a href="${home}" style="text-decoration:none;">${_brand()}</a></td></tr>
<tr><td style="background:${CARD};border:1px solid ${BORDER};border-radius:16px;padding:0;overflow:hidden;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:3px;background:${accent};font-size:0;line-height:0;">&nbsp;</td></tr></table>
<div class="zvm-card-pad" style="padding:32px 28px 30px;font-family:Arial,Helvetica,sans-serif;">
${eyebrow ? `<div style="display:inline-block;font-size:11px;font-weight:800;color:${accent};letter-spacing:1.5px;text-transform:uppercase;background:${accent}1a;border:1px solid ${accent}40;border-radius:99px;padding:5px 12px;margin-bottom:18px;">${escHtml(eyebrow)}</div>` : ''}
<h1 style="margin:0 0 20px;font-size:24px;font-weight:900;color:${TEXT};letter-spacing:-.3px;line-height:1.3;">${escHtml(title)}</h1>
${bodyHtml}
</div></td></tr>
<tr><td style="padding:28px 16px 0;text-align:center;font-family:Arial,sans-serif;">
<p style="margin:0 0 14px;font-size:12px;color:${MUTED};">${escHtml(footNote || 'Dúvidas? Responda este e-mail ou chame no suporte via WhatsApp.')}</p>
<p style="margin:0 0 3px;font-size:12.5px;font-weight:800;color:${DIM};letter-spacing:.2px;">ZVM</p>
<p style="margin:0 0 10px;font-size:11px;color:${MUTED};">CRM, Disparos e produtividade no WhatsApp Web</p>
${base ? `<p style="margin:0 0 10px;font-size:11px;color:${MUTED};"><a href="${base}/cliente" style="color:${MUTED};text-decoration:underline;">Portal do Cliente</a> &nbsp;·&nbsp; <a href="${SUPPORT_URL}" style="color:${MUTED};text-decoration:underline;">Suporte</a></p>` : ''}
<p style="margin:0;font-size:10.5px;color:${MUTED};">© ${new Date().getFullYear()} ZVM. Todos os direitos reservados.</p>
</td></tr></table></td></tr></table></body></html>`;
}

function _button(href, label, color) {
  const bg = color || PRIMARY;
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:${bg};"><a href="${safeHttpUrl(href)}" style="display:inline-block;padding:14px 30px;font-family:Arial,sans-serif;font-size:14.5px;font-weight:800;color:#04150b;text-decoration:none;letter-spacing:.2px;">${escHtml(label)}</a></td></tr></table>`;
}
function _buttonOutline(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;border:1.5px solid ${BORDER};"><a href="${safeHttpUrl(href)}" style="display:inline-block;padding:12.5px 26px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:${TEXT};text-decoration:none;letter-spacing:.2px;">${escHtml(label)}</a></td></tr></table>`;
}
function _buttonRow(buttons) {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${buttons.map((b,i)=>`<td class="zvm-btn-cell" style="${i ? 'padding-left:10px;' : ''}">${b}</td>`).join('')}</tr></table>`;
}
function _featureRow(icon, title, desc) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;"><tr><td width="34" valign="top" style="font-size:18px;line-height:1;padding-top:1px;">${escHtml(icon)}</td><td valign="top" style="font-family:Arial,sans-serif;"><div style="font-size:13.5px;font-weight:800;color:${TEXT};margin-bottom:2px;">${escHtml(title)}</div><div style="font-size:12.5px;color:${DIM};line-height:1.6;">${escHtml(desc)}</div></td></tr></table>`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function buildPasswordResetEmail(resetUrl) {
  const safeReset = safeHttpUrl(resetUrl);
  const baseUrl = baseOrigin(safeReset);
  const body = `<p style="margin:0 0 22px;font-size:14.5px;color:${DIM};line-height:1.7;">Recebemos uma solicitação para redefinir a senha da sua conta ZVM. O link é válido por <strong style="color:${TEXT}">1 hora</strong>.</p>${_button(safeReset, 'Redefinir minha senha')}<p style="margin:22px 0 0;font-size:12.5px;color:${MUTED};line-height:1.6;">Se você não fez esta solicitação, ignore este e-mail. Sua senha atual continua funcionando normalmente.</p>`;
  return { subject: 'ZVM — Redefinição de senha', html: _shell({ eyebrow:'Segurança da conta', title:'Recuperação de senha', bodyHtml:body, baseUrl }) };
}
async function sendPasswordResetEmail(to, resetUrl) {
  const built = buildPasswordResetEmail(resetUrl); const res = await _send(built.subject, to, built.html); return res.ok;
}

function buildKeyDeliveryEmail(options = {}) {
  // Shared transactional template; authority delivers the persisted plan and expiry.
  return buildKeyDeliveryDesign(options);
}
async function sendKeyDeliveryEmail(to, opts) {
  const built = buildKeyDeliveryEmail(opts || {}); const res = await _send(built.subject, to, built.html); return res.ok;
}

function buildKeyExpiryWarningEmail({ code, hoursLeft, planLabel, maxUses, expiresAt, baseUrl, ctaPath }) {
  const base = baseOrigin(baseUrl);
  const portalPath = String(ctaPath || '/cliente').startsWith('/') ? String(ctaPath || '/cliente') : '/cliente';
  const renewUrl = base ? base + portalPath : '#';
  const hours = Math.max(0, Number(hoursLeft) || 0);
  const days = Math.floor(hours / 24), rem = Math.max(0, Math.round(hours - days * 24));
  const timeLeft = days > 0 ? `${days}d ${rem}h` : `${Math.max(1, Math.round(hours))}h`;
  const key = escHtml(String(code || '—').slice(0,80));
  const plan = escHtml(String(planLabel || '—').slice(0,80));
  const uses = Number.isFinite(Number(maxUses)) ? Math.max(1, Number(maxUses)) : 1;
  const keyBox = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr><td style="background:#1a1204;border:1.5px dashed rgba(240,180,41,.45);border-radius:12px;padding:20px;text-align:center;"><div style="font-family:Arial,sans-serif;font-size:10.5px;color:${DIM};text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Sua chave de ativação</div><div style="font-family:'Courier New',monospace;font-size:19px;font-weight:700;color:${WARN};letter-spacing:.5px;word-break:break-all;">${key}</div><div style="display:inline-block;margin-top:12px;font-family:Arial,sans-serif;font-size:11.5px;font-weight:800;color:#1a1204;text-transform:uppercase;background:${WARN};border-radius:99px;padding:5px 14px;">Restam ${escHtml(timeLeft)}</div></td></tr></table>`;
  const stats = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr><td class="zvm-stack" width="50%" style="background:${CARD2};border:1px solid ${BORDER};border-radius:10px 0 0 10px;border-right:none;padding:14px 16px;"><div style="font-family:Arial,sans-serif;font-size:10.5px;color:${DIM};text-transform:uppercase;margin-bottom:5px;">Plano</div><div style="font-family:Arial,sans-serif;font-size:15px;font-weight:800;color:${TEXT};">${plan} <span style="font-weight:400;color:${DIM};font-size:12.5px;">· ${uses} número(s)</span></div></td><td class="zvm-stack" width="50%" style="background:${CARD2};border:1px solid ${BORDER};border-radius:0 10px 10px 0;padding:14px 16px;"><div style="font-family:Arial,sans-serif;font-size:10.5px;color:${DIM};text-transform:uppercase;margin-bottom:5px;">Válida até</div><div style="font-family:Arial,sans-serif;font-size:15px;font-weight:800;color:${TEXT};">${escHtml(fmtDate(expiresAt))}</div></td></tr></table>`;
  const body = `<p style="margin:0 0 22px;font-size:14.5px;color:${DIM};line-height:1.7;">Sua licença ZVM está próxima do vencimento. Renove pelo portal para evitar interrupções.</p>${keyBox}${stats}${_buttonRow([_button(renewUrl,'Renovar minha licença',WARN),_buttonOutline(renewUrl,'Acessar Portal do Cliente')])}<p style="margin:22px 0 0;font-size:12.5px;color:${MUTED};line-height:1.6;">Depois de expirada, a chave para de funcionar até uma nova renovação. Seus dispositivos vinculados continuam salvos.</p>`;
  return { subject:'ZVM — Sua licença vence em breve', html:_shell({ eyebrow:'Aviso de expiração', eyebrowColor:WARN, title:'Sua licença ZVM está próxima do vencimento', bodyHtml:body, baseUrl, footNote:'Dúvidas sobre renovação? Responda este e-mail ou chame no suporte via WhatsApp.' }) };
}
async function sendKeyExpiryWarningEmail(to, opts) {
  const built = buildKeyExpiryWarningEmail(opts || {}); const res = await _send(built.subject, to, built.html); return res.ok;
}

async function sendEmail({ to, subject, html }) {
  const res = await _send(subject, to, html);
  return { ok: res.ok, id: res.id || null, reason: res.ok ? null : (res.reason || 'falha desconhecida no envio') };
}

module.exports = {
  sendPasswordResetEmail, sendKeyDeliveryEmail, sendKeyExpiryWarningEmail, sendEmail,
  buildPasswordResetEmail, buildKeyDeliveryEmail, buildKeyExpiryWarningEmail,
};
