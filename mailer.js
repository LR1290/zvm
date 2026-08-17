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

// Largura alvo pro conteúdo — 680px fica no meio da faixa "premium" (680-720)
// sem chegar perto da largura de site que quebra em Gmail/Outlook. O <table>
// usa width E max-width juntos: Outlook (engine Word, ignora max-width) lê o
// width="680" fixo; clientes modernos (Gmail web, Apple Mail) respeitam o
// max-width e encolhem em telas menores. Isso sozinho já resolve mobile —
// o <style>/@media abaixo é só o refinamento extra (padding maior e cards
// lado a lado só quando a tela realmente permite).
const CONTENT_WIDTH = 680;

// Mesma logo oficial do portal (zvm-logo-light.png, 722×962) — nunca ⚡ ZVM
// nem texto improvisado. URL sempre absoluta a partir do baseUrl que cada
// caller já recebe (BASE_URL do servidor) — nunca hardcoded aqui, porque
// e-mail não tem conceito de caminho relativo (abre fora do domínio).
const LOGO_RATIO = 722 / 962;
function _logoImg(baseUrl) {
  const h = 42, w = Math.round(h * LOGO_RATIO);
  const src = `${(baseUrl || '').replace(/\/$/, '')}/static/assets/zvm-logo-light.png`;
  return `<img src="${src}" width="${w}" height="${h}" alt="ZVM" style="display:block;border:0;outline:none;text-decoration:none;">`;
}

function _shell({ eyebrow, eyebrowColor, title, bodyHtml, footNote, baseUrl }) {
  const accent  = eyebrowColor || PRIMARY;
  const base    = (baseUrl || '').replace(/\/$/, '');
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>ZVM</title>
<style>
  /* Refinamento pra clientes que suportam @media (Gmail web/app, Apple Mail,
     Outlook novo). Outlook clássico (desktop, engine Word) ignora isto e
     fica só com o inline abaixo — que já é seguro em qualquer largura. */
  @media (min-width:641px){
    .zvm-card-pad{padding:44px 48px 40px!important;}
  }
  @media (max-width:640px){
    .zvm-stack{display:block!important;width:100%!important;}
    .zvm-stack + .zvm-stack{margin-top:10px!important;border-radius:10px!important;border-left:1px solid ${BORDER}!important;}
    .zvm-stack:first-child{border-radius:10px!important;}
    .zvm-btn-cell{display:block!important;width:100%!important;padding:0 0 10px!important;}
    .zvm-btn-cell:last-child{padding-bottom:0!important;}
    .zvm-btn-cell table{width:100%!important;}
    .zvm-btn-cell a{display:block!important;text-align:center!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="${CONTENT_WIDTH}" cellpadding="0" cellspacing="0" style="max-width:${CONTENT_WIDTH}px;width:100%;">
        <tr><td align="center" style="padding-bottom:26px;">
          <a href="${base}/" style="text-decoration:none;">${_logoImg(baseUrl)}</a>
        </td></tr>
        <tr><td style="background:${CARD};border:1px solid ${BORDER};border-radius:16px;padding:0;overflow:hidden;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:3px;background:linear-gradient(90deg,transparent,${accent},transparent);font-size:0;line-height:0;">&nbsp;</td></tr></table>
          <div class="zvm-card-pad" style="padding:32px 28px 30px;font-family:Arial,Helvetica,sans-serif;">
            ${eyebrow ? `<div style="display:inline-block;font-size:11px;font-weight:800;color:${accent};letter-spacing:1.5px;text-transform:uppercase;background:${accent}1a;border:1px solid ${accent}40;border-radius:99px;padding:5px 12px;margin-bottom:18px;">${eyebrow}</div>` : ''}
            <h1 style="margin:0 0 20px;font-size:24px;font-weight:900;color:${TEXT};letter-spacing:-.3px;line-height:1.3;">${title}</h1>
            ${bodyHtml}
          </div>
        </td></tr>
        <tr><td style="padding:28px 16px 0;text-align:center;font-family:Arial,sans-serif;">
          <p style="margin:0 0 14px;font-size:12px;color:${MUTED};">${footNote || 'Dúvidas? Responda este e-mail ou chame no suporte via WhatsApp.'}</p>
          <p style="margin:0 0 3px;font-size:12.5px;font-weight:800;color:${DIM};letter-spacing:.2px;">ZVM</p>
          <p style="margin:0 0 10px;font-size:11px;color:${MUTED};">Automação inteligente para WhatsApp</p>
          <p style="margin:0 0 10px;font-size:11px;color:${MUTED};"><a href="${base}/cliente" style="color:${MUTED};text-decoration:underline;">Portal do Cliente</a> &nbsp;·&nbsp; <a href="https://wa.me/5521996771552" style="color:${MUTED};text-decoration:underline;">Suporte</a></p>
          <p style="margin:0;font-size:10.5px;color:${MUTED};">© ${new Date().getFullYear()} ZVM. Todos os direitos reservados.</p>
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
  // buttons: array of pre-rendered <table> button snippets, lado a lado no
  // desktop; a classe zvm-btn-cell (ver <style> em _shell) empilha em telas
  // ≤640px e estica cada botão pra largura total — só nos clientes que
  // suportam @media; Outlook clássico mantém lado a lado sempre (ele não
  // tem um cenário real de "tela estreita").
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${
    buttons.map((b, i) => `<td class="zvm-btn-cell" style="${i > 0 ? 'padding-left:10px;' : ''}">${b}</td>`).join('')
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
  // Sem parâmetro baseUrl próprio (só resetUrl) — a origem pra montar a logo
  // e os links do rodapé vem do próprio resetUrl, que já é sempre construído
  // com BASE_URL na origem (ver chamadores em ZVMeWSM.js). Evita adicionar
  // mais um parâmetro só pra isso.
  let baseUrl = '';
  try { baseUrl = new URL(resetUrl).origin; } catch (_) { /* resetUrl malformado — logo cai pro fallback do <img> quebrado, sem travar o e-mail */ }
  const body = `
    <p style="margin:0 0 22px;font-size:14.5px;color:${DIM};line-height:1.7;">Recebemos uma solicitação para redefinir a senha da sua conta ZVM. Clique no botão abaixo para criar uma nova senha — o link é válido por <strong style="color:${TEXT}">1 hora</strong>.</p>
    ${_button(resetUrl, 'Redefinir minha senha')}
    <p style="margin:22px 0 0;font-size:12.5px;color:${MUTED};line-height:1.6;">Se você não fez esta solicitação, ignore este e-mail — sua senha atual continua funcionando normalmente.</p>`;
  const html = _shell({ eyebrow: 'Segurança da conta', title: 'Recuperação de senha', bodyHtml: body, baseUrl });
  return { subject: 'ZVM — Redefinição de senha', html };
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
function buildKeyDeliveryEmail({ code, planLabel, maxUses, expiresAt, renewed, durationDays, baseUrl, extensionUrl, ctaPath }) {
  const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
  const portalPath = ctaPath || '/verificar';
  const verifyUrl = `${(baseUrl || '').replace(/\/$/, '')}${portalPath}`;
  const isPortal = portalPath === '/cliente';
  const title = renewed ? 'Sua licença foi renovada' : 'Bem-vindo(a) ao ZVM';
  const intro = renewed
    // "durationDays" só existe quando o chamador já sabe o período do plano
    // (fluxo Cakto/standalone) — nos fluxos legados (webhook antigo, API de
    // parceiro) essa informação não chega até aqui, e a frase some sozinha
    // em vez de inventar um número.
    ? `Sua licença ZVM foi renovada com sucesso${durationDays ? ` — mais ${durationDays} dias de acesso foram adicionados` : ''}. A chave existente continua a mesma, sem precisar reconfigurar nada na extensão.`
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
        <td class="zvm-stack" width="50%" style="background:${CARD2};border:1px solid ${BORDER};border-radius:10px 0 0 10px;border-right:none;padding:14px 16px;">
          <div style="font-family:Arial,sans-serif;font-size:10.5px;color:${DIM};text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Plano</div>
          <div style="font-family:Arial,sans-serif;font-size:15px;font-weight:800;color:${TEXT};">${planLabel || '—'} <span style="font-weight:400;color:${DIM};font-size:12.5px;">· ${maxUses || 1} número(s)</span></div>
        </td>
        <td class="zvm-stack" width="50%" style="background:${CARD2};border:1px solid ${BORDER};border-radius:0 10px 10px 0;padding:14px 16px;">
          <div style="font-family:Arial,sans-serif;font-size:10.5px;color:${DIM};text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Válida até</div>
          <div style="font-family:Arial,sans-serif;font-size:15px;font-weight:800;color:${TEXT};">${fmtDate(expiresAt)}</div>
        </td>
      </tr>
    </table>`;

  const tutorialUrl = 'https://www.youtube.com/watch?v=DZ29f5U6OF8';

  // Primeira compra: baixar extensão é a ação principal, com o tutorial em vídeo ao lado.
  // A consulta da chave (portal) já tem sua própria seção mais abaixo — não repete o botão aqui.
  const ctaRow = renewed
    ? _buttonRow([_button(verifyUrl, 'Acessar minha conta')])
    : (extensionUrl
        ? _buttonRow([_button(extensionUrl, 'Baixar a extensão'), _buttonOutline(tutorialUrl, 'Ver tutorial')])
        : _buttonRow([_button(tutorialUrl, 'Ver tutorial de instalação')]));

  const steps = renewed ? '' : `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
      <tr><td style="border-top:1px solid ${BORDER};padding-top:22px;">
        <div style="font-family:Arial,sans-serif;font-size:11px;font-weight:800;color:${DIM};text-transform:uppercase;letter-spacing:.06em;margin-bottom:16px;">Como começar</div>
      </td></tr>
      <tr><td style="font-family:Arial,sans-serif;font-size:13.5px;color:${DIM};line-height:2;">
        <strong style="color:${TEXT}">1.</strong> Instale a extensão ZVM no Chrome (botão acima)<br>
        <strong style="color:${TEXT}">2.</strong> Entre no WhatsApp Web e cole a chave acima no campo de ativação<br>
        <strong style="color:${TEXT}">3.</strong> Conecte seu WhatsApp e comece a disparar
      </td></tr>
    </table>`;

  const portalSection = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
      <tr><td style="border-top:1px solid ${BORDER};padding-top:22px;">
        <div style="font-family:Arial,sans-serif;font-size:11px;font-weight:800;color:${DIM};text-transform:uppercase;letter-spacing:.06em;margin-bottom:16px;">Gerencie sua licença a qualquer momento</div>
      </td></tr>
      <tr><td>
        ${_featureRow('📅', 'Validade e status', 'Consulte quando sua chave vence e se ela está ativa, sem precisar de login.')}
        ${_featureRow('📱', 'Dispositivos conectados', 'Veja quais números estão usando sua chave e remova algum pra liberar espaço.')}
        ${_featureRow('🔁', 'Renovação', 'Renove direto pelo portal quando o período estiver acabando.')}
      </td></tr>
      <tr><td style="padding-top:6px;">${_buttonOutline(verifyUrl, isPortal ? 'Acessar Portal do Cliente →' : 'Consultar minha chave →')}</td></tr>
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
    baseUrl,
    footNote: 'Dúvidas sobre a ativação? Responda este e-mail ou chame no suporte via WhatsApp.'
  });
  return { subject: renewed ? 'ZVM — Renovação confirmada' : 'ZVM — Sua licença está pronta', html };
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
        <td class="zvm-stack" width="50%" style="background:${CARD2};border:1px solid ${BORDER};border-radius:10px 0 0 10px;border-right:none;padding:14px 16px;">
          <div style="font-family:Arial,sans-serif;font-size:10.5px;color:${DIM};text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Plano</div>
          <div style="font-family:Arial,sans-serif;font-size:15px;font-weight:800;color:${TEXT};">${planLabel || '—'} <span style="font-weight:400;color:${DIM};font-size:12.5px;">· ${maxUses || 1} número(s)</span></div>
        </td>
        <td class="zvm-stack" width="50%" style="background:${CARD2};border:1px solid ${BORDER};border-radius:0 10px 10px 0;padding:14px 16px;">
          <div style="font-family:Arial,sans-serif;font-size:10.5px;color:${DIM};text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Válida até</div>
          <div style="font-family:Arial,sans-serif;font-size:15px;font-weight:800;color:${TEXT};">${fmtDate(expiresAt)}</div>
        </td>
      </tr>
    </table>`;

  const body = `
    <p style="margin:0 0 22px;font-size:14.5px;color:${DIM};line-height:1.7;">Sua licença ZVM está próxima do vencimento. Renove agora pelo portal e continue usando sua automação sem interrupção.</p>
    ${keyBox}
    ${stats}
    ${_buttonRow([_button(renewUrl, 'Renovar minha licença', WARN), _buttonOutline(renewUrl, 'Acessar Portal do Cliente')])}
    <p style="margin:22px 0 0;font-size:13px;color:${TEXT};line-height:1.6;font-weight:600;">Renove antes do vencimento para continuar usando o ZVM sem interrupções.</p>
    <p style="margin:10px 0 0;font-size:12.5px;color:${MUTED};line-height:1.6;">Depois de expirada, a chave para de funcionar até uma nova renovação — seus dispositivos vinculados continuam salvos.</p>`;

  const html = _shell({
    eyebrow: 'Aviso de expiração',
    eyebrowColor: WARN,
    title: 'Sua licença ZVM está próxima do vencimento',
    bodyHtml: body,
    baseUrl,
    footNote: 'Dúvidas sobre renovação? Responda este e-mail ou chame no suporte via WhatsApp.'
  });
  return { subject: 'ZVM — Sua licença vence em breve', html };
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
