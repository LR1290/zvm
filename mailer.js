'use strict';
// ── Envio de e-mails transacionais via Resend ──────────────────────
// Módulo isolado do server.js/ZVMeWSM.js pra facilitar manutenção.
// Sem RESEND_API_KEY ou domínio verificado no Resend, as funções
// abaixo simplesmente não enviam nada (retornam false) — não derrubam
// o servidor nem travam o fluxo que as chamou.
const https = require('https');

function _send(subject, to, html) {
  return new Promise(resolve => {
    const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
    const EMAIL_FROM     = process.env.EMAIL_FROM || 'ZVM <noreply@zvm.app>';
    if (!RESEND_API_KEY) { resolve({ ok: false, reason: 'RESEND_API_KEY não configurado' }); return; }

    const body = JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html });
    const req = https.request({
      hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, r => {
      let raw = '';
      r.on('data', c => { raw += c; });
      r.on('end', () => {
        if (r.statusCode < 300) { resolve({ ok: true }); return; }
        console.warn('[MAILER] Resend recusou envio:', r.statusCode, raw.slice(0, 300));
        resolve({ ok: false, reason: `Resend ${r.statusCode}: ${raw.slice(0, 300)}` });
      });
    });
    req.on('error', e => { console.warn('[MAILER] Erro de rede:', e.message); resolve({ ok: false, reason: e.message }); });
    req.setTimeout(8000, () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }); });
    req.write(body); req.end();
  });
}

// ── Design compartilhado (tabelas p/ compatibilidade com Gmail/Outlook) ──
const BG      = '#08110d';
const CARD    = '#0f1712';
const CARD2   = '#141d17';
const BORDER  = '#1e2b23';
const PRIMARY = '#00e676';
const WARN    = '#f0b429';
const TEXT    = '#eef2f0';
const DIM     = '#8a9992';
const MUTED   = '#4d5952';

function _shell({ eyebrow, eyebrowColor, title, bodyHtml, footNote }) {
  const accent = eyebrowColor || PRIMARY;
  return `<!DOCTYPE html><html lang="pt-BR"><body style="margin:0;padding:0;background:${BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
        <tr><td align="center" style="padding-bottom:22px;">
          <span style="font-family:Arial,sans-serif;font-size:15px;font-weight:900;color:${PRIMARY};letter-spacing:1px;">⚡ ZVM</span>
        </td></tr>
        <tr><td style="background:${CARD};border:1px solid ${BORDER};border-radius:16px;padding:0;overflow:hidden;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:3px;background:linear-gradient(90deg,transparent,${accent},transparent);font-size:0;line-height:0;">&nbsp;</td></tr></table>
          <div style="padding:32px 30px 30px;font-family:Arial,Helvetica,sans-serif;">
            ${eyebrow ? `<div style="display:inline-block;font-size:11px;font-weight:800;color:${accent};letter-spacing:1.5px;text-transform:uppercase;background:${accent}1a;border:1px solid ${accent}40;border-radius:99px;padding:5px 12px;margin-bottom:16px;">${eyebrow}</div>` : ''}
            <h1 style="margin:0 0 18px;font-size:22px;font-weight:900;color:${TEXT};letter-spacing:-.3px;line-height:1.3;">${title}</h1>
            ${bodyHtml}
          </div>
        </td></tr>
        <tr><td style="padding:24px 12px 0;text-align:center;font-family:Arial,sans-serif;">
          <p style="margin:0 0 6px;font-size:12px;color:${MUTED};">${footNote || 'Dúvidas? Responda este e-mail ou chame no suporte via WhatsApp.'}</p>
          <p style="margin:0;font-size:11px;color:${MUTED};">ZVM · Automação Profissional para WhatsApp</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
}

function _button(href, label, color) {
  const bg = color || PRIMARY;
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:${bg};">
    <a href="${href}" style="display:inline-block;padding:14px 30px;font-family:Arial,sans-serif;font-size:14.5px;font-weight:800;color:#04150b;text-decoration:none;letter-spacing:.2px;">${label}</a>
  </td></tr></table>`;
}

function _buttonOutline(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;border:1.5px solid ${BORDER};">
    <a href="${href}" style="display:inline-block;padding:12.5px 26px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:${TEXT};text-decoration:none;letter-spacing:.2px;">${label}</a>
  </td></tr></table>`;
}

function _buttonRow(buttons) {
  // buttons: array of pre-rendered <table> button snippets, laid side by side
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${
    buttons.map((b, i) => `<td style="${i > 0 ? 'padding-left:10px;' : ''}">${b}</td>`).join('')
  }</tr></table>`;
}

function _featureRow(icon, title, desc) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
    <tr>
      <td width="34" valign="top" style="font-size:18px;line-height:1;padding-top:1px;">${icon}</td>
      <td valign="top" style="font-family:Arial,sans-serif;">
        <div style="font-size:13.5px;font-weight:800;color:${TEXT};margin-bottom:2px;">${title}</div>
        <div style="font-size:12.5px;color:${DIM};line-height:1.6;">${desc}</div>
      </td>
    </tr>
  </table>`;
}

// ── Builders: montam { subject, html } sem enviar nada. O painel de
// Analytics (Laboratório de Testes) usa os MESMOS builders pra preview —
// o HTML mostrado ali é byte a byte o que seria enviado, nunca uma
// reconstrução separada que pode divergir do template real. ──

function buildPasswordResetEmail(resetUrl) {
  const body = `
    <p style="margin:0 0 22px;font-size:14.5px;color:${DIM};line-height:1.7;">Você solicitou a redefinição da sua senha do portal ZVM. Clique no botão abaixo para criar uma nova senha — o link é válido por <strong style="color:${TEXT}">1 hora</strong>.</p>
    ${_button(resetUrl, 'Redefinir minha senha')}
    <p style="margin:22px 0 0;font-size:12.5px;color:${MUTED};line-height:1.6;">Se você não solicitou essa redefinição, ignore este e-mail — sua senha atual continua funcionando normalmente.</p>`;
  const html = _shell({ eyebrow: 'Segurança da conta', title: 'Redefinir sua senha', bodyHtml: body });
  return { subject: 'Redefinição de senha — ZVM', html };
}

async function sendPasswordResetEmail(to, resetUrl) {
  const { subject, html } = buildPasswordResetEmail(resetUrl);
  const res = await _send(subject, to, html);
  return res.ok;
}

// Enviado quando uma compra é aprovada (webhook de venda ou API de parceiro)
// e uma chave nova/renovada é gerada — entrega automática, sem depender
// de um admin mandar a chave manualmente por WhatsApp.
// ctaPath (opcional): destino do botão de portal. Default '/verificar'
// preserva o comportamento de sempre pros chamadores legados (webhook de
// venda antigo, API de parceiro) — só o fluxo Cakto/standalone passa
// ctaPath:'/cliente' explicitamente (ver processCommercialSale). Não é uma
// troca global: cada chamador decide o próprio destino.
function buildKeyDeliveryEmail({ code, planLabel, maxUses, expiresAt, renewed, baseUrl, extensionUrl, ctaPath }) {
  const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
  const portalPath = ctaPath || '/verificar';
  const verifyUrl = `${(baseUrl || '').replace(/\/$/, '')}${portalPath}`;
  const title = renewed ? 'Sua renovação foi aprovada' : 'Bem-vindo(a) ao ZVM';
  const intro = renewed
    ? 'Sua chave já está ativa com o novo período de acesso — nenhuma ação extra é necessária se ela já estiver configurada na extensão.'
    : 'Sua compra foi aprovada! Sua chave de ativação já está pronta — em poucos minutos você já está disparando mensagens de voz, texto e mídia em massa no WhatsApp.';

  const keyBox = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
      <tr><td style="background:#04150b;border:1.5px dashed rgba(0,230,118,.45);border-radius:12px;padding:18px 20px;text-align:center;">
        <div style="font-family:Arial,sans-serif;font-size:10.5px;color:${DIM};text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Sua chave de ativação</div>
        <div style="font-family:'Courier New',monospace;font-size:19px;font-weight:700;color:${PRIMARY};letter-spacing:.5px;word-break:break-all;">${code}</div>
        <div style="font-family:Arial,sans-serif;font-size:11px;color:${MUTED};margin-top:8px;">Toque e segure pra selecionar e copiar</div>
      </td></tr>
    </table>`;

  const stats = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
      <tr>
        <td width="50%" style="background:${CARD2};border:1px solid ${BORDER};border-radius:10px 0 0 10px;border-right:none;padding:14px 16px;">
          <div style="font-family:Arial,sans-serif;font-size:10.5px;color:${DIM};text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Plano</div>
          <div style="font-family:Arial,sans-serif;font-size:15px;font-weight:800;color:${TEXT};">${planLabel || '—'} <span style="font-weight:400;color:${DIM};font-size:12.5px;">· ${maxUses || 1} número(s)</span></div>
        </td>
        <td width="50%" style="background:${CARD2};border:1px solid ${BORDER};border-radius:0 10px 10px 0;padding:14px 16px;">
          <div style="font-family:Arial,sans-serif;font-size:10.5px;color:${DIM};text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Válida até</div>
          <div style="font-family:Arial,sans-serif;font-size:15px;font-weight:800;color:${TEXT};">${fmtDate(expiresAt)}</div>
        </td>
      </tr>
    </table>`;

  const tutorialUrl = 'https://www.youtube.com/watch?v=DZ29f5U6OF8';

  // Primeira compra: baixar extensão é a ação principal, com o tutorial em vídeo ao lado.
  // A consulta da chave (/verificar) já tem sua própria seção mais abaixo — não repete o botão aqui.
  const ctaRow = renewed
    ? _buttonRow([_button(verifyUrl, 'Ver detalhes da chave')])
    : (extensionUrl
        ? _buttonRow([_button(extensionUrl, '📥 Baixar a extensão'), _buttonOutline(tutorialUrl, '▶ Ver tutorial')])
        : _buttonRow([_button(tutorialUrl, '▶ Ver tutorial de instalação')]));

  const steps = renewed ? '' : `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
      <tr><td style="border-top:1px solid ${BORDER};padding-top:22px;">
        <div style="font-family:Arial,sans-serif;font-size:11px;font-weight:800;color:${DIM};text-transform:uppercase;letter-spacing:.06em;margin-bottom:16px;">Como ativar em 3 passos</div>
      </td></tr>
      <tr><td style="font-family:Arial,sans-serif;font-size:13.5px;color:${DIM};line-height:2;">
        <strong style="color:${TEXT}">1.</strong> Baixe e instale a extensão ZVM no Chrome (botão acima)<br>
        <strong style="color:${TEXT}">2.</strong> Abra o WhatsApp Web, cole a chave acima no campo de ativação<br>
        <strong style="color:${TEXT}">3.</strong> Conecte seu WhatsApp e comece a disparar
      </td></tr>
    </table>`;

  const portalSection = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
      <tr><td style="border-top:1px solid ${BORDER};padding-top:22px;">
        <div style="font-family:Arial,sans-serif;font-size:11px;font-weight:800;color:${DIM};text-transform:uppercase;letter-spacing:.06em;margin-bottom:16px;">Gerencie sua chave a qualquer momento</div>
      </td></tr>
      <tr><td>
        ${_featureRow('📅', 'Validade e status', 'Consulte quando sua chave vence e se ela está ativa, sem precisar de login.')}
        ${_featureRow('📱', 'Dispositivos conectados', 'Veja quais números estão usando sua chave e remova algum pra liberar espaço.')}
        ${_featureRow('🔁', 'Renovação', 'Renove direto pelo portal quando o período estiver acabando.')}
      </td></tr>
      <tr><td style="padding-top:6px;">${_buttonOutline(verifyUrl, portalPath === '/cliente' ? 'Acessar minha conta →' : 'Acessar /verificar →')}</td></tr>
    </table>`;

  const body = `
    <p style="margin:0 0 22px;font-size:14.5px;color:${DIM};line-height:1.7;">${intro}</p>
    ${keyBox}
    ${stats}
    ${ctaRow}
    ${steps}
    ${portalSection}`;

  const html = _shell({
    eyebrow: renewed ? 'Renovação confirmada' : 'Pagamento aprovado',
    title,
    bodyHtml: body,
    footNote: 'Dúvidas sobre a ativação? Responda este e-mail ou chame no suporte via WhatsApp.'
  });
  return { subject: renewed ? 'ZVM — Chave renovada' : 'ZVM — Sua chave de ativação', html };
}

async function sendKeyDeliveryEmail(to, opts) {
  const { subject, html } = buildKeyDeliveryEmail(opts);
  const res = await _send(subject, to, html);
  return res.ok;
}

// Aviso de expiração — mesma identidade visual do e-mail de entrega/renovação,
// com acento âmbar (WARN) no lugar do verde pra comunicar urgência sem sair
// da linguagem visual da marca. O scheduler (checkExpiryWarnings) só troca
// a construção do HTML por esta função — timing, EXPIRY_WARN_HOURS,
// warnEmailSent e a regra de um aviso por ciclo continuam no chamador,
// intocados.
function buildKeyExpiryWarningEmail({ code, hoursLeft, planLabel, maxUses, expiresAt, baseUrl, ctaPath }) {
  const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
  const portalPath = ctaPath || '/cliente';
  const renewUrl = `${(baseUrl || '').replace(/\/$/, '')}${portalPath}`;
  const daysLeft = Math.max(0, Math.floor((hoursLeft || 0) / 24));
  const remainderHours = Math.max(0, Math.round((hoursLeft || 0) - daysLeft * 24));
  const timeLeftLabel = daysLeft > 0 ? `${daysLeft}d ${remainderHours}h` : `${Math.max(1, Math.round(hoursLeft || 0))}h`;

  const keyBox = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
      <tr><td style="background:#1a1204;border:1.5px dashed rgba(240,180,41,.45);border-radius:12px;padding:20px 20px 18px;text-align:center;">
        <div style="font-family:Arial,sans-serif;font-size:10.5px;color:${DIM};text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Sua chave de ativação</div>
        <div style="font-family:'Courier New',monospace;font-size:19px;font-weight:700;color:${WARN};letter-spacing:.5px;word-break:break-all;">${code}</div>
        <div style="display:inline-block;margin-top:12px;font-family:Arial,sans-serif;font-size:11.5px;font-weight:800;color:#1a1204;text-transform:uppercase;letter-spacing:.06em;background:${WARN};border-radius:99px;padding:5px 14px;">Restam ${timeLeftLabel}</div>
      </td></tr>
    </table>`;

  const stats = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
      <tr>
        <td width="50%" style="background:${CARD2};border:1px solid ${BORDER};border-radius:10px 0 0 10px;border-right:none;padding:14px 16px;">
          <div style="font-family:Arial,sans-serif;font-size:10.5px;color:${DIM};text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Plano</div>
          <div style="font-family:Arial,sans-serif;font-size:15px;font-weight:800;color:${TEXT};">${planLabel || '—'} <span style="font-weight:400;color:${DIM};font-size:12.5px;">· ${maxUses || 1} número(s)</span></div>
        </td>
        <td width="50%" style="background:${CARD2};border:1px solid ${BORDER};border-radius:0 10px 10px 0;padding:14px 16px;">
          <div style="font-family:Arial,sans-serif;font-size:10.5px;color:${DIM};text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Válida até</div>
          <div style="font-family:Arial,sans-serif;font-size:15px;font-weight:800;color:${TEXT};">${fmtDate(expiresAt)}</div>
        </td>
      </tr>
    </table>`;

  const body = `
    <p style="margin:0 0 22px;font-size:14.5px;color:${DIM};line-height:1.7;">Sua licença ZVM está perto do vencimento. Renove agora pelo portal e mantenha sua automação funcionando sem interrupção.</p>
    ${keyBox}
    ${stats}
    ${_buttonRow([_button(renewUrl, 'RENOVAR MINHA LICENÇA', WARN)])}
    <p style="margin:22px 0 0;font-size:13px;color:${TEXT};line-height:1.6;font-weight:600;">Renove antes do vencimento para continuar usando o ZVM sem interrupções.</p>
    <p style="margin:10px 0 0;font-size:12.5px;color:${MUTED};line-height:1.6;">Depois de expirada, a chave para de funcionar até uma nova renovação — seus dispositivos vinculados continuam salvos.</p>`;

  const html = _shell({
    eyebrow: 'Aviso de expiração',
    eyebrowColor: WARN,
    title: 'Sua licença está expirando',
    bodyHtml: body,
    footNote: 'Dúvidas sobre renovação? Responda este e-mail ou chame no suporte via WhatsApp.'
  });
  return { subject: 'Sua licença ZVM está expirando', html };
}

async function sendKeyExpiryWarningEmail(to, opts) {
  const { subject, html } = buildKeyExpiryWarningEmail(opts);
  const res = await _send(subject, to, html);
  return res.ok;
}

// Envio genérico ({ to, subject, html }) — hoje usado só pelo endpoint de
// teste do Laboratório de Analytics (/api/lab/email-send). Retorna { ok, reason }
// em vez de um boolean cru: o Laboratório precisa do motivo real da falha pra
// mostrar ao admin (ex.: Resend recusando o destinatário) em vez de adivinhar
// "verifique a API key" quando a causa é outra.
async function sendEmail({ to, subject, html }) {
  const addr = String(to || '').trim();
  // Sem validação, um endereço vindo do banco/webhook chegaria cru na API do Resend.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) || addr.length > 254) {
    console.warn('[MAILER] destinatário inválido — envio abortado');
    return { ok: false, reason: 'destinatário inválido' };
  }
  const res = await _send(String(subject || '(sem assunto)').slice(0, 200), addr, String(html || ''));
  return { ok: res.ok, reason: res.ok ? null : (res.reason || 'falha desconhecida no envio') };
}

module.exports = {
  sendPasswordResetEmail, sendKeyDeliveryEmail, sendKeyExpiryWarningEmail, sendEmail,
  buildPasswordResetEmail, buildKeyDeliveryEmail, buildKeyExpiryWarningEmail,
};
