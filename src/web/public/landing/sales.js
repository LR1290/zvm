'use strict';

const { renderPublicFooter } = require('../footer');
const { SUPPORT_URL } = require('../../../support-contact');

// Only manually approved, attributable feedback is eligible for publication.
// The renderer never invents customer names, ratings, quotes or performance metrics.
function readApprovedTestimonials(raw) {
  if (typeof raw !== 'string' || raw.length > 18000) return [];
  let entries;
  try { entries = JSON.parse(raw); } catch (_) { return []; }
  if (!Array.isArray(entries)) return [];
  return entries.filter(item =>
    item && item.approved === true &&
    typeof item.name === 'string' && item.name.trim().length >= 2 && item.name.length <= 80 &&
    typeof item.quote === 'string' && item.quote.trim().length >= 20 && item.quote.length <= 460 &&
    typeof item.approvalId === 'string' && /^[a-zA-Z0-9_-]{6,80}$/.test(item.approvalId)
  ).slice(0, 3).map(item => ({
    name: item.name.trim(),
    quote: item.quote.trim(),
    role: typeof item.role === 'string' ? item.role.trim().slice(0, 100) : ''
  }));
}

function campaignDeadline(raw, salesPaused, now = Date.now()) {
  if (salesPaused || typeof raw !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(raw)) return '';
  const value = Date.parse(raw);
  if (!Number.isFinite(value) || value <= now || value > now + 365 * 86400000) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(value);
}

function renderSalesPage({
  escHtml, favicon, sharedCssLink, cssUrl, publicNav, plans = {},
  salesPaused = true, testimonialsJson = '', campaignEndAt = ''
} = {}) {
  if (typeof escHtml !== 'function') throw new TypeError('escHtml required');
  const esc = escHtml;
  const testimonials = readApprovedTestimonials(testimonialsJson);
  const deadline = campaignDeadline(campaignEndAt, salesPaused);
  const ctaText = salesPaused ? 'Consultar os planos' : 'Escolher meu plano';
  const pausedNotice = salesPaused
    ? '<aside class="zvs-pause" role="status"><strong>Vendas temporariamente pausadas.</strong> Os planos estão disponíveis para consulta. A compra só será liberada quando a ZVM reabrir os pagamentos.</aside>'
    : '';
  const deadlineNotice = deadline
    ? '<p class="zvs-offer" role="note">Condição comercial com prazo definido: até ' + esc(deadline) + ' (horário de Brasília). Confira os valores e requisitos atualizados antes de comprar.</p>'
    : '';
  const planCards = Object.values(plans).filter(plan =>
    plan && ['solo','padrao','pro'].includes(plan.id) &&
    Number.isFinite(Number(plan.price)) && Number(plan.price) > 0 &&
    Number.isSafeInteger(Number(plan.maxUses)) && Number(plan.maxUses) > 0
  ).map(plan => {
    const uses = Number(plan.maxUses);
    const price = Number(plan.price).toFixed(2).replace('.', ',');
    const name = esc(plan.shortName || plan.name || plan.id);
    const link = '/planos?plano=' + encodeURIComponent(plan.id);
    return '<a class="zvs-plan" data-plan-id="' + esc(plan.id) + '" href="' + link + '">' +
      '<strong>' + name + '</strong>' +
      '<small>' + uses + ' ' + (uses === 1 ? 'número de WhatsApp' : 'números de WhatsApp') + '</small>' +
      '<span class="zvs-price">R$ ' + price + ' <small>/ 30 dias</small></span>' +
      '<span class="zvs-plan-action">' + (salesPaused ? 'Ver detalhes do plano' : 'Escolher plano') + ' &#8594;</span></a>';
  }).join('');
  const testimonialsSection = testimonials.length ? [
    '<section class="zvs-section" id="depoimentos" aria-labelledby="zvs-feedback-heading"><div class="zvs-shell">',
    '<header class="zvs-head"><span class="zvs-label">Experiências verificadas pela equipe</span><h2 id="zvs-feedback-heading">O que clientes contam sobre a ZVM</h2></header>',
    '<div class="zvs-testimonials">',
    testimonials.map(t => '<article class="zvs-quote"><blockquote>&ldquo;' + esc(t.quote) + '&rdquo;</blockquote><div class="zvs-quote-name">' + esc(t.name) + '</div>' +
      (t.role ? '<div class="zvs-quote-role">' + esc(t.role) + '</div>' : '') + '</article>').join(''),
    '</div></div></section>'
  ].join('') : '';
  return [
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>ZVM - Automações | Mais organização e menos trabalho repetitivo no WhatsApp</title>',
    '<meta name="description" content="Cansou de perder tempo com mensagens repetidas e clientes sem acompanhamento? Conheça a ZVM: CRM, Biblioteca e automações para WhatsApp Web.">',
    '<meta property="og:type" content="website"><meta property="og:title" content="ZVM - Automações para WhatsApp Web">',
    '<meta property="og:description" content="Menos tarefas repetitivas. Mais controle sobre clientes e conversas.">',
    '<link rel="canonical" href="https://zvm.onrender.com/vendas">',
    '<link rel="icon" type="image/svg+xml" href="' + esc(favicon) + '">',
    String(sharedCssLink || ''),
    '<link rel="stylesheet" href="' + esc(cssUrl) + '"></head>',
    '<body class="zvs-body zvm-public-premium zvm-experience">',
    typeof publicNav === 'function' ? publicNav() : '<a class="skip-link" href="#main-content">Pular para o conteúdo</a>',
    '<main id="main-content" class="zvs">',
    '<section class="zvs-shell zvs-hero" aria-labelledby="zvs-title"><div>',
    '<span class="zvs-kicker"><i class="zvs-dot" aria-hidden="true"></i>ZVM · Automações para WhatsApp Web</span>',
    '<h1 id="zvs-title">Seu WhatsApp está cheio de conversas. <em>Seu dia não precisa estar.</em></h1>',
    '<p class="zvs-lead">Cansou de responder tudo de novo, perder o histórico e esquecer clientes no meio da correria? Organize conversas, reutilize mensagens e automatize tarefas com a ZVM.</p>',
    deadlineNotice,
    '<div class="zvs-actions"><a class="zvs-btn zvs-primary" href="/planos">' + ctaText + ' &#8594;</a><a class="zvs-btn zvs-secondary" href="#como-funciona">Entender em 30 segundos</a></div>',
    '<p class="zvs-subnote">Instalação gratuita · Ativação com licença · Funciona como extensão no navegador</p>',
    pausedNotice,
    '</div><figure class="zvs-hero-art"><div class="zvs-mini">Interface real da ZVM</div>',
    '<img class="zvs-image" src="/assets/zvm-shell-home-real.a9c1a0d7b030.png" alt="Captura real do painel da ZVM, com ferramentas de organização e automação." width="1180" height="710" fetchpriority="high" decoding="async">',
    '<figcaption>Captura da ferramenta. As informações visíveis são demonstrativas.</figcaption></figure></section>',
    '<div class="zvs-proofbar" aria-label="Diferenciais da ferramenta"><div class="zvs-shell">',
    '<span><b class="zvs-check" aria-hidden="true">&#10003;</b> CRM no WhatsApp Web</span>',
    '<span><b class="zvs-check" aria-hidden="true">&#10003;</b> Fluxos e Biblioteca</span>',
    '<span><b class="zvs-check" aria-hidden="true">&#10003;</b> Chave entregue por e-mail após pagamento</span>',
    '</div></div>',
    '<section class="zvs-shell zvs-section" id="beneficios" aria-labelledby="zvs-pain-title">',
    '<header class="zvs-head"><span class="zvs-label">Isso acontece com você?</span>',
    '<h2 id="zvs-pain-title">O tempo perdido no atendimento também custa oportunidades.</h2>',
    '<p class="zvs-desc">A ZVM ajuda a eliminar improvisos que deixam sua operação mais lenta.</p></header>',
    '<div class="zvs-pains">',
    '<article class="zvs-pain"><span class="zvs-pain-number">01 / REPETIÇÃO</span><h3>Digita a mesma resposta todo dia?</h3><p>Salve mensagens e materiais na Biblioteca para reutilizar em poucos cliques.</p></article>',
    '<article class="zvs-pain"><span class="zvs-pain-number">02 / DESORGANIZAÇÃO</span><h3>Não lembra quem precisa de retorno?</h3><p>Use CRM, etiquetas e funis para enxergar os próximos passos.</p></article>',
    '<article class="zvs-pain"><span class="zvs-pain-number">03 / ROTINA MANUAL</span><h3>Perde tempo organizando processos?</h3><p>Monte fluxos para tarefas recorrentes e trabalhe com mais controle.</p></article>',
    '</div></section>',
    '<section class="zvs-shell zvs-section" id="como-funciona" aria-labelledby="zvs-steps-title">',
    '<header class="zvs-head"><span class="zvs-label">Simples de começar</span><h2 id="zvs-steps-title">Três passos. Sem complicar.</h2></header>',
    '<div class="zvs-steps">',
    '<article class="zvs-step"><b>01</b><div><strong>Instale</strong><p>Adicione a extensão ao navegador compatível.</p></div></article>',
    '<article class="zvs-step"><b>02</b><div><strong>Ative</strong><p>Receba e vincule a chave da licença à sua conta.</p></div></article>',
    '<article class="zvs-step"><b>03</b><div><strong>Organize</strong><p>Use a ZVM no WhatsApp Web de acordo com a sua rotina.</p></div></article>',
    '</div></section>',
    testimonialsSection,
    '<section class="zvs-shell zvs-section" id="planos" aria-labelledby="zvs-prices-title">',
    '<header class="zvs-head"><span class="zvs-label">Investimento claro</span><h2 id="zvs-prices-title">Escolha pela quantidade de números.</h2>',
    '<p class="zvs-desc">Os recursos são os mesmos nos planos. Você escolhe quantos números precisa utilizar.</p></header>',
    '<div class="zvs-plans">' + planCards + '</div>',
    '<p class="zvs-assurance">Pagamento e condições detalhadas na página oficial de planos. Sem exigência de cadastro prévio para comprar quando as vendas estiverem abertas. <a href="/planos">Ver condições completas</a>.</p>',
    '</section>',
    '<section class="zvs-shell zvs-section" id="faq" aria-labelledby="zvs-faq-title">',
    '<header class="zvs-head"><span class="zvs-label">Sem dúvidas na hora de decidir</span><h2 id="zvs-faq-title">Perguntas frequentes</h2></header>',
    '<div class="zvs-faq-list">',
    '<details><summary>Preciso criar conta antes de comprar?</summary><p>Não. Quando o checkout estiver liberado, você pode comprar informando um e-mail válido no pagamento e vincular a chave à sua conta depois.</p></details>',
    '<details><summary>Como recebo a chave?</summary><p>Após a confirmação do pagamento, a chave é enviada ao e-mail informado na compra.</p></details>',
    '<details><summary>Funciona só pelo celular?</summary><p>A extensão ZVM é voltada ao WhatsApp Web em navegador compatível. O ZVM Cloud para celular é uma solução separada e ainda não faz parte desta oferta.</p></details>',
    '<details><summary>Existe garantia contra bloqueio pelo WhatsApp?</summary><p>Não. O uso precisa respeitar as políticas do WhatsApp, o consentimento dos contatos e os limites aplicáveis. Nenhuma ferramenta pode garantir ausência de bloqueios.</p></details>',
    '</div><p class="zvs-assurance">Ainda tem dúvidas? <a href="/faq">Veja o FAQ completo</a> ou <a href="' + esc(SUPPORT_URL) + '" target="_blank" rel="noopener noreferrer">fale com o suporte</a>.</p>',
    '</section>',
    '<section class="zvs-last"><div class="zvs-shell"><h2>Seu próximo cliente merece atenção. Seu tempo também.</h2>',
    '<p>Troque a rotina improvisada por uma operação mais organizada, com ferramentas que acompanham seu atendimento.</p>',
    '<a class="zvs-btn zvs-primary" href="/planos">' + ctaText + ' &#8594;</a>',
    '</div></section>',
    '<div class="zvs-mobile-cta"><a class="zvs-btn zvs-primary" href="/planos">' + ctaText + ' &#8594;</a></div>',
    '</main>', renderPublicFooter({ supportUrl: SUPPORT_URL }), '</body></html>'
  ].join('');
}

module.exports = Object.freeze({ renderSalesPage, readApprovedTestimonials, campaignDeadline });
