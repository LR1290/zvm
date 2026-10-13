'use strict';
const {renderPublicFooter} = require('../footer');
const {SUPPORT_URL} = require('../../../support-contact');

function createLandingRenderer({ escHtml, favicon, sharedCssLink, landingCssLink, chromeStoreBadge, publicNav, plans = {} }) {
  const icon = name => {
    const paths = {
      crm:'<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><rect x="17" y="4" width="4" height="16" rx="1"/>',
      send:'<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
      flow:'<circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.6 7.4 15.4 16.6"/><path d="M18 3v6h-6"/>',
      funnel:'<path d="M3 4h18l-7 8v6l-4 2v-8z"/>',
      book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
      calendar:'<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
      clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      sparkle:'<path d="m12 3-1.3 3.7L7 8l3.7 1.3L12 13l1.3-3.7L17 8l-3.7-1.3Z"/><path d="m5 14-.8 2.2L2 17l2.2.8L5 20l.8-2.2L8 17l-2.2-.8Z"/>',
      shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/>',
      check:'<path d="m5 12 4 4L19 6"/>',
      arrow:'<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
      users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>',
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || paths.check}</svg>`;
  };

  const homePreviewTabs = Object.freeze([
    Object.freeze({ id:'overview', label:'Visão geral', image:'/assets/zvm-shell-home-real.a9c1a0d7b030.png', alt:'Tela Visão geral da ZVM - Automações' }),
    Object.freeze({ id:'status', label:'Status', image:'/assets/zvm-home-status.d67c284e8b99.png', alt:'Tela Status da ZVM - Automações' }),
    Object.freeze({ id:'models', label:'Modelos', image:'/assets/zvm-home-models.7cdf6ab7bc37.png', alt:'Tela Modelos da ZVM - Automações' }),
    Object.freeze({ id:'favorites', label:'Favoritos', image:'/assets/zvm-home-favorites.ce590e486f02.png', alt:'Tela Favoritos da ZVM - Automações' }),
    Object.freeze({ id:'connections', label:'Conexões', image:'/assets/zvm-home-connections.2a3c9faa94ec.png', alt:'Tela Conexões da ZVM - Automações' }),
    Object.freeze({ id:'metrics', label:'Métricas Nerd', image:'/assets/zvm-home-metrics.40db3ea20ff3.png', alt:'Tela Métricas Nerd da ZVM - Automações' }),
  ]);

  function renderProductTabs() {
    const radios = homePreviewTabs.map((tab, index) => `<input class="r466-tab-radio r466-tab-${tab.id}" type="radio" name="r466-home-preview" id="r466-${tab.id}"${index === 0 ? ' checked' : ''} aria-label="Abrir ${escHtml(tab.label)}">`).join('');
    const panels = homePreviewTabs.map(tab => `<figure class="r466-preview-panel r466-panel-${tab.id}"><img src="${tab.image}" alt="${escHtml(tab.alt)}"></figure>`).join('');
    const labels = homePreviewTabs.map(tab => `<label for="r466-${tab.id}">${escHtml(tab.label)}</label>`).join('');
    return `${radios}<div class="r466-tab-strip" role="group" aria-label="Áreas do painel">${labels}</div><div class="r466-preview-panels">${panels}</div>`;
  }

  const supportUrl = SUPPORT_URL;

  // Presentation-only price teasers: same authoritative commercial catalog as /planos.
  // No checkout links, copy of prices, or separate plan selection state.
  function renderLandingPlans() {
    return Object.values(plans).map(plan => {
      if (!['start_v2','pro_v2','enterprise_v2'].includes(plan.id)) return '';
      const value = plan.consult ? null : Number(plan.price);
      const devices = Number(plan.maxUses);
      if ((!plan.consult && (!Number.isFinite(value) || value <= 0)) || !Number.isSafeInteger(devices) || devices <= 0) return '';
      const price = plan.consult ? 'Sob consulta' : 'R$ ' + value.toFixed(2).replace('.', ',');
      const id = escHtml(plan.id);
      const popular = plan.id === 'pro_v2';
      return `<a class="r4624-plan-card${popular?' is-popular':''}" data-plan-id="${id}" href="/planos?plano=${id}">
        ${popular?'<span class="r4624-plan-popular">Mais escolhido</span>':''}${plan.consult?'<span class="r4624-plan-popular">Sob consulta</span>':''}
        <h3>${escHtml(plan.shortName || plan.name || plan.id)}</h3>
        <p>${escHtml(plan.subtitle || '')} · ${devices} ${devices===1?'número':'números'} de WhatsApp</p>
        <strong>${price}</strong><span class="r4624-plan-period">${plan.consult?'Implantação personalizada':'por mês'}</span>
        <span class="r4624-plan-link">Ver detalhes do plano <span aria-hidden="true">→</span></span>
      </a>`;
    }).join('');
  }

  return function renderLandingPage(portalUser = null) {
    // The exact banner component is injected from the customer portal.
    // No duplicated icon/artwork or separately maintained destination URL.
    const storeBadgeMarkup = typeof chromeStoreBadge === 'function' ? chromeStoreBadge() : '';

    return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZVM - Automações | CRM e automação no WhatsApp Web</title>
<meta name="description" content="CRM, Disparos, Fluxos, Funis, Biblioteca, Agenda, FollowUp e Assistentes IA integrados ao WhatsApp Web.">
<link rel="icon" type="image/svg+xml" href="${favicon}">${sharedCssLink}${landingCssLink}</head>
<body class="r466-body">${typeof publicNav === 'function' ? publicNav(portalUser) : `<a class="r466-skip" href="#main-content">Pular para o conteúdo</a>`}
<main id="main-content">
<section class="r466-hero r466-hero-centered">
  <div class="r466-hero-bg" aria-hidden="true"><svg class="r4618-ambient-wave wave-one" viewBox="0 0 1500 650" preserveAspectRatio="none"><path d="M-100 365 C260 540 385 160 775 354 S1190 520 1620 266"/></svg><svg class="r4618-ambient-wave wave-two" viewBox="0 0 1500 650" preserveAspectRatio="none"><path d="M-90 500 C350 275 565 580 892 435 S1290 255 1600 452"/></svg></div>
  <div class="r466-hero-float r466-float-crm" aria-hidden="true">${icon('crm')} CRM</div>
  <div class="r466-hero-float r466-float-fluxos" aria-hidden="true">${icon('flow')} Fluxos</div>
  <div class="r466-hero-float r466-float-disparos" aria-hidden="true">${icon('send')} Disparos</div>
  <div class="r466-hero-float r466-float-ia" aria-hidden="true">${icon('sparkle')} IA</div>
  <div class="r466-hero-layout">
    <div class="r466-hero-copy">
      <span class="r466-kicker">Extensão para WhatsApp Web</span>
      <h1>Organize o atendimento.<br><em>Automatize a rotina.</em></h1>
      <p>Organize clientes, acompanhe conversas e automatize tarefas sem sair do WhatsApp Web.</p>
      <div class="r466-hero-links">
        <div class="r4618-hero-store" aria-label="Instalação pela Chrome Web Store">${storeBadgeMarkup}</div>
        <a href="/?sec=produto" data-scroll-target="produto" class="r466-btn secondary">Ver como funciona</a>
      </div>
      <p class="r466-license-note">Instalação gratuita. A ativação requer uma licença.</p>
    </div>
  </div>
  <a class="r4612-scroll-cue" href="/?sec=produto" data-scroll-target="produto" aria-label="Rolar para conhecer a ferramenta por dentro"><span class="r4612-scroll-mouse" aria-hidden="true"><i></i></span><span>Explore a ZVM</span></a>
</section>

<section class="r466-product r4611-product-first" id="produto"><div class="r466-section-head centered r4612-product-head"><span>Veja a ferramenta por dentro</span><h2>Explore a ZVM em ação.</h2><p>Escolha uma aba para conhecer diferentes áreas do painel real.</p></div><div class="r466-demo">${renderProductTabs()}</div></section>



<section class="r466-benefits" id="beneficios"><div class="r466-section-head centered"><span>Feita para o seu dia a dia</span><h2>Mais clareza. Menos tarefas repetidas.</h2><p>Deixe as conversas, os clientes e as tarefas organizados em um só lugar.</p></div><div class="r466-benefit-grid"><article>${icon('crm')}<h3>Acompanhe cada cliente</h3><p>Organize contatos, notas e etapas sem perder o contexto.</p></article><article>${icon('flow')}<h3>Automatize com controle</h3><p>Prepare fluxos e envios para facilitar o trabalho diário.</p></article><article>${icon('book')}<h3>Encontre tudo rapidamente</h3><p>Guarde mensagens e materiais que você usa com frequência.</p></article></div></section>

<section class="r466-features" id="recursos"><div class="r466-section-head"><span>Recursos</span><h2>Uma ferramenta. Muitas possibilidades.</h2><p>Conheça os recursos disponíveis, sem precisar descobrir tudo de uma vez.</p></div><div class="r466-feature-explore"><details><summary>${icon('crm')}<span>Atendimento e CRM</span><span class="r466-explore-more">Saiba mais</span></summary><div class="r466-explore-body"><article><h3>CRM e Funis</h3><p>Organize clientes, etapas, notas e próximos passos.</p></article><article><h3>Agenda e FollowUp</h3><p>Mantenha seus compromissos e acompanhamentos por perto.</p></article></div></details><details><summary>${icon('flow')}<span>Automações</span><span class="r466-explore-more">Saiba mais</span></summary><div class="r466-explore-body"><article><h3>Fluxos</h3><p>Crie sequências visuais para tarefas recorrentes.</p></article><article><h3>Disparos</h3><p>Prepare listas e acompanhe os envios com cuidado.</p></article></div></details><details><summary>${icon('book')}<span>Conteúdo e organização</span><span class="r466-explore-more">Saiba mais</span></summary><div class="r466-explore-body"><article><h3>Biblioteca</h3><p>Reutilize mensagens, áudios, imagens, vídeos e documentos.</p></article><article><h3>Assistentes IA</h3><p>Personalize os assistentes de acordo com sua rotina.</p></article></div></details></div></section>

<section class="r466-how" id="como-funciona"><div class="r466-section-head centered"><span>Como funciona</span><h2>Comece em três passos.</h2></div><div class="r466-steps"><article><b>01</b><h3>Instale e ative</h3><p>Instale a extensão, valide sua chave e entre normalmente no WhatsApp Web.</p></article><article><b>02</b><h3>Configure sua rotina</h3><p>Crie CRMs, modelos, fluxos, funis e conteúdos conforme sua necessidade.</p></article><article><b>03</b><h3>Trabalhe com contexto</h3><p>Use os recursos da ZVM enquanto mantém o atendimento no WhatsApp Web.</p></article></div></section>



<section class="r466-plans" id="planos"><div class="r466-section-head centered"><span>Planos</span><h2>Um plano para cada ritmo.</h2><p>Instale gratuitamente pela loja oficial e escolha uma licença conforme a quantidade de números que sua operação precisa.</p></div><div class="r4624-plan-grid" aria-label="Planos e preços">${renderLandingPlans()}</div><p class="r4624-plans-note">Todos os planos incluem os mesmos recursos. O que muda é a quantidade de números de WhatsApp.</p></section>

<section class="r466-faq" id="faq"><div class="r466-faq-layout"><div class="r466-section-head r466-faq-head"><span>Perguntas frequentes</span><h2>Respostas sem complicação.</h2></div><div class="r466-faq-list"><details><summary>O que é a ZVM - Automações?</summary><p>É uma extensão para WhatsApp Web que reúne CRM, Disparos, Fluxos, Funis, Biblioteca, Agenda, FollowUp e Assistentes IA.</p></details><details><summary>Preciso instalar outro programa?</summary><p>Não. A ZVM funciona como extensão do navegador e acompanha sua rotina dentro do WhatsApp Web.</p></details><details><summary>O que muda entre os planos?</summary><p>O conjunto de módulos é o mesmo. O que muda é a quantidade de números de WhatsApp autorizados na licença e o valor do período de 30 dias.</p></details><details><summary>Como recebo minha chave?</summary><p>Após a confirmação da compra, a chave é enviada automaticamente para o e-mail informado no pedido.</p></details><details><summary>Como funciona o suporte?</summary><p>Você pode falar diretamente com o suporte da ZVM pelo WhatsApp para dúvidas de instalação, ativação e uso.</p></details></div></div></section>

<section class="r466-final"><div><span>ZVM - Automações</span><h2>Conheça uma forma mais simples<br><em>de trabalhar no WhatsApp.</em></h2><p>Baixe a extensão pela loja oficial e escolha sua licença para começar.</p><div class="r466-actions"><a href="/planos" class="r466-btn secondary">Conhecer planos</a></div></div></section>
<script src="/assets/zvm-r46-landing-navigation.8996142ec21d.js" defer></script>
</main>
${renderPublicFooter({supportUrl})}
</body></html>`;
  };
}

module.exports = { createLandingRenderer };
