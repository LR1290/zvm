'use strict';
const https = require('https');

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
const ZVM_BRAND_ICON_DATA_URI = 'data:image/png;base64,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';

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
  return `<span style="display:inline-flex;align-items:center;gap:8px;text-decoration:none;vertical-align:middle;">
    <img src="${ZVM_BRAND_ICON_DATA_URI}" width="38" height="35" alt="" aria-hidden="true" style="display:block;border:0;outline:none;width:38px;height:35px;object-fit:contain;">
    <span style="font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1;font-weight:900;letter-spacing:1px;color:${PRIMARY};">ZVM</span>
  </span>`;
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
    const body = JSON.stringify({ from, to: [addr], subject: safeSubject, html: safeHtml });
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
      r.on('data', chunk => { bytes += chunk.length; });
      r.on('end', () => {
        if (r.statusCode >= 200 && r.statusCode < 300) { resolve({ ok: true }); return; }
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
<p style="margin:0 0 10px;font-size:11px;color:${MUTED};">Automação inteligente para WhatsApp</p>
${base ? `<p style="margin:0 0 10px;font-size:11px;color:${MUTED};"><a href="${base}/cliente" style="color:${MUTED};text-decoration:underline;">Portal do Cliente</a> &nbsp;·&nbsp; <a href="https://wa.me/5521996771552" style="color:${MUTED};text-decoration:underline;">Suporte</a></p>` : ''}
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

function buildKeyDeliveryEmail({ code, planLabel, maxUses, expiresAt, renewed, durationDays, baseUrl, extensionUrl, ctaPath }) {
  const base = baseOrigin(baseUrl);
  const portalPath = String(ctaPath || '/verificar').startsWith('/') ? String(ctaPath || '/verificar') : '/verificar';
  const verifyUrl = base ? base + portalPath : '#';
  const title = renewed ? 'Sua licença foi renovada' : 'Bem-vindo(a) ao ZVM';
  const intro = renewed
    ? `Sua licença ZVM foi renovada com sucesso${durationDays ? ` — mais ${Math.max(1, Number(durationDays)||0)} dias de acesso foram adicionados` : ''}. Sua chave continua a mesma.`
    : 'Sua compra foi aprovada. Sua chave de ativação já está pronta para uso.';
  const key = escHtml(String(code || '—').slice(0, 80));
  const plan = escHtml(String(planLabel || '—').slice(0, 80));
  const uses = Number.isFinite(Number(maxUses)) ? Math.max(1, Number(maxUses)) : 1;
  const keyBox = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr><td style="background:#04150b;border:1.5px dashed rgba(0,230,118,.45);border-radius:12px;padding:18px 20px;text-align:center;"><div style="font-family:Arial,sans-serif;font-size:10.5px;color:${DIM};text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Sua chave de ativação</div><div style="font-family:'Courier New',monospace;font-size:19px;font-weight:700;color:${PRIMARY};letter-spacing:.5px;word-break:break-all;">${key}</div></td></tr></table>`;
  const stats = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr><td class="zvm-stack" width="50%" style="background:${CARD2};border:1px solid ${BORDER};border-radius:10px 0 0 10px;border-right:none;padding:14px 16px;"><div style="font-family:Arial,sans-serif;font-size:10.5px;color:${DIM};text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Plano</div><div style="font-family:Arial,sans-serif;font-size:15px;font-weight:800;color:${TEXT};">${plan} <span style="font-weight:400;color:${DIM};font-size:12.5px;">· ${uses} número(s)</span></div></td><td class="zvm-stack" width="50%" style="background:${CARD2};border:1px solid ${BORDER};border-radius:0 10px 10px 0;padding:14px 16px;"><div style="font-family:Arial,sans-serif;font-size:10.5px;color:${DIM};text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Válida até</div><div style="font-family:Arial,sans-serif;font-size:15px;font-weight:800;color:${TEXT};">${escHtml(fmtDate(expiresAt))}</div></td></tr></table>`;
  const tutorialUrl = 'https://www.youtube.com/watch?v=DZ29f5U6OF8';
  const ext = safeHttpUrl(extensionUrl, '');
  const ctas = renewed ? [_button(verifyUrl,'Acessar minha conta')] : (ext ? [_button(ext,'Baixar a extensão'),_buttonOutline(tutorialUrl,'Ver tutorial')] : [_button(tutorialUrl,'Ver tutorial de instalação')]);
  const steps = renewed ? '' : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;"><tr><td style="border-top:1px solid ${BORDER};padding-top:22px;"><div style="font-family:Arial,sans-serif;font-size:11px;font-weight:800;color:${DIM};text-transform:uppercase;letter-spacing:.06em;margin-bottom:16px;">Como começar</div></td></tr><tr><td style="font-family:Arial,sans-serif;font-size:13.5px;color:${DIM};line-height:2;"><strong style="color:${TEXT}">1.</strong> Instale a extensão ZVM no Chrome<br><strong style="color:${TEXT}">2.</strong> Entre no WhatsApp Web e informe sua chave de ativação<br><strong style="color:${TEXT}">3.</strong> Conecte seu WhatsApp e comece a usar a ZVM</td></tr></table>`;
  const portal = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;"><tr><td style="border-top:1px solid ${BORDER};padding-top:22px;"><div style="font-family:Arial,sans-serif;font-size:11px;font-weight:800;color:${DIM};text-transform:uppercase;letter-spacing:.06em;margin-bottom:16px;">Gerencie sua licença</div></td></tr><tr><td>${_featureRow('📅','Validade e status','Consulte quando sua chave vence e se ela está ativa.')}${_featureRow('📱','Dispositivos conectados','Veja e gerencie os números vinculados à sua licença.')}${_featureRow('🔁','Renovação','Renove pelo portal quando o período estiver acabando.')}</td></tr><tr><td style="padding-top:6px;">${_buttonOutline(verifyUrl, portalPath === '/cliente' ? 'Acessar Portal do Cliente →' : 'Consultar minha chave →')}</td></tr></table>`;
  const body = `<p style="margin:0 0 22px;font-size:14.5px;color:${DIM};line-height:1.7;">${escHtml(intro)}</p>${keyBox}${stats}${_buttonRow(ctas)}${steps}${portal}`;
  return { subject: renewed ? 'ZVM — Renovação confirmada' : 'ZVM — Sua licença está pronta', html: _shell({ eyebrow: renewed ? 'Renovação confirmada' : 'Pagamento aprovado', title, bodyHtml:body, baseUrl, footNote:'Dúvidas sobre a ativação? Responda este e-mail ou chame no suporte via WhatsApp.' }) };
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
  return { ok: res.ok, reason: res.ok ? null : (res.reason || 'falha desconhecida no envio') };
}

module.exports = {
  sendPasswordResetEmail, sendKeyDeliveryEmail, sendKeyExpiryWarningEmail, sendEmail,
  buildPasswordResetEmail, buildKeyDeliveryEmail, buildKeyExpiryWarningEmail,
};
