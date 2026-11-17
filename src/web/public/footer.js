'use strict';
// A single footer renderer for every public page, including the landing.
const { SUPPORT_URL } = require('../../support-contact');
function renderPublicFooter({supportUrl = SUPPORT_URL} = {}) {
  return `<footer class="r466-footer"><div class="r466-footer-inner"><div><a class="r466-brand" href="/"><img src="/assets/zvm-icon.a6f91b5ec82b.png" alt=""><span>ZVM <small>Automações</small></span></a><p>CRM e automação para quem trabalha no WhatsApp Web.</p></div><nav aria-label="Links do rodapé"><a href="/faq">FAQ</a><a href="/planos">Planos</a><a href="/privacidade">Privacidade</a><a href="/termos">Termos de Serviço</a><a href="/cliente">Portal do Cliente</a><a href="${supportUrl}" target="_blank" rel="noopener noreferrer">Suporte</a></nav><small>© ${new Date().getFullYear()} ZVM - Automações</small></div></footer>`;
}
module.exports = {renderPublicFooter};
