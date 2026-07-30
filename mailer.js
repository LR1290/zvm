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

function _wrap(title, bodyHtml) {
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0d0d0d;color:#e0e0e0;border-radius:10px;padding:28px 24px">` +
    `<h2 style="color:#00e676;margin:0 0 16px">⚡ ${title}</h2>${bodyHtml}` +
    `<hr style="border:none;border-top:1px solid #1a1a1a;margin:20px 0">` +
    `<p style="font-size:11px;color:#444;margin:0">ZVM · Automação Profissional para WhatsApp</p></div>`;
}

async function sendPasswordResetEmail(to, resetUrl) {
  const html = _wrap('ZVM — Redefinição de senha', `
    <p style="margin:0 0 20px;color:#aaa;line-height:1.7">Você solicitou a redefinição da sua senha. Clique no botão abaixo para criar uma nova senha. O link é válido por <strong style="color:#fff">1 hora</strong>.</p>
    <a href="${resetUrl}" style="display:inline-block;background:#00e676;color:#000;font-weight:700;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:14px">Redefinir minha senha</a>
    <p style="margin:20px 0 0;font-size:12px;color:#666">Se você não solicitou a redefinição, ignore este e-mail. Sua senha não será alterada.</p>`);
  const res = await _send('Redefinição de senha — ZVM', to, html);
  return res.ok;
}

// Enviado quando uma compra é aprovada (webhook de venda ou API de parceiro)
// e uma chave nova/renovada é gerada — entrega automática, sem depender
// de um admin mandar a chave manualmente por WhatsApp.
async function sendKeyDeliveryEmail(to, { code, planLabel, maxUses, expiresAt, renewed, baseUrl }) {
  const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
  const verifyUrl = `${(baseUrl || '').replace(/\/$/, '')}/verificar`;
  const title = renewed ? 'ZVM — Chave renovada' : 'ZVM — Sua chave de ativação';
  const intro = renewed
    ? 'Sua renovação foi aprovada! Sua chave já está ativa com o novo período de acesso.'
    : 'Sua compra foi aprovada! Aqui está sua chave de ativação — cole ela na extensão ZVM para começar.';
  const html = _wrap(title, `
    <p style="margin:0 0 20px;color:#aaa;line-height:1.7">${intro}</p>
    <div style="background:#111;border:1px solid #232d28;border-radius:8px;padding:16px 18px;margin-bottom:20px">
      <div style="font-size:11px;color:#8a9992;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Sua chave</div>
      <div style="font-family:monospace;font-size:16px;color:#00e676;font-weight:700;word-break:break-all">${code}</div>
    </div>
    <p style="margin:0 0 6px;color:#ccc;font-size:14px"><strong>Plano:</strong> ${planLabel || '—'} · até ${maxUses || 1} número(s)</p>
    <p style="margin:0 0 20px;color:#ccc;font-size:14px"><strong>Válida até:</strong> ${fmtDate(expiresAt)}</p>
    <a href="${verifyUrl}" style="display:inline-block;background:#00e676;color:#000;font-weight:700;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:14px">Verificar minha chave</a>
    <p style="margin:20px 0 0;font-size:12px;color:#666">Cole essa chave na extensão ZVM no Chrome pra ativar. Dúvidas? Responda este e-mail ou chame no suporte via WhatsApp.</p>`);
  const res = await _send(title, to, html);
  return res.ok;
}

module.exports = { sendPasswordResetEmail, sendKeyDeliveryEmail };
