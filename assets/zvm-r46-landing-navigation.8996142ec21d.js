/* R46.18 — scoped, layout-aware navigation for the public landing page. */
(function () {
  'use strict';
  if (!document.body.classList.contains('r466-body')) return;
  const targets = Array.from(document.querySelectorAll('section[id]'));
  const navLinks = Array.from(document.querySelectorAll('.znav-main-links a[href*="#"]'));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const header = document.querySelector('.znav');
  const known = new Set(targets.map(section => section.id));
  function headerHeight() {
    return header ? Math.ceil(header.getBoundingClientRect().height) : 0;
  }
  function locate(id) {
    const section = document.getElementById(id);
    if (!section) return null;
    const available = Math.max(0, window.innerHeight - headerHeight());
    const bounds = section.getBoundingClientRect();
    if (bounds.height < available * .82) {
      // Center compact sections instead of leaving a tall empty area below.
      return Math.max(0, window.scrollY + bounds.top - headerHeight() - Math.max(24, (available - bounds.height) / 2));
    }
    const heading = section.querySelector('.r466-section-head, .r466-faq-head') || section;
    return Math.max(0, window.scrollY + heading.getBoundingClientRect().top - headerHeight() - 30);
  }
  function activate(id) {
    navLinks.forEach(link => {
      const selected = link.hash.slice(1) === id;
      link.classList.toggle('r4618-active', selected);
      if (selected) link.setAttribute('aria-current', 'location');
      else if (link.getAttribute('aria-current') === 'location') link.removeAttribute('aria-current');
    });
  }
  function cleanUrl() {
    try {
      const url = new URL(window.location.href);
      url.hash = '';
      url.searchParams.delete('sec');
      history.replaceState(history.state, '', url.pathname + url.search);
    } catch (_) { /* Non-critical: scrolling remains functional. */ }
  }
  function navigate(id, updateLocation) {
    const y = locate(id);
    if (y === null) return false;
    window.scrollTo({top: y, behavior: reducedMotion.matches ? 'auto' : 'smooth'});
    if (updateLocation) cleanUrl();
    activate(id);
    return true;
  }
  document.addEventListener('click', event => {
    const anchor = event.target.closest('a[href]');
    if (!anchor || anchor.classList.contains('skip-link')) return;
    // Let browser retain link semantics for control-click / new-tab gestures.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const forced = anchor.getAttribute('data-scroll-target');
    let id = forced;
    if (!id) {
      let url;
      try { url = new URL(anchor.href, window.location.href); } catch (_) { return; }
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return;
      id = url.searchParams.get('sec') || decodeURIComponent(url.hash.slice(1));
    }
    if (!id || !known.has(id)) return;
    event.preventDefault();
    navigate(id, true);
  });
  if ('IntersectionObserver' in window && targets.length) {
    const observer = new IntersectionObserver(entries => {
      const intersecting = entries.filter(entry => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (intersecting.length) activate(intersecting[0].target.id);
    }, {rootMargin: '-22% 0px -55% 0px', threshold: 0});
    targets.forEach(section => observer.observe(section));
  }
  // A deep link to a section must not remain hidden under the sticky header.
  window.addEventListener('load', () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('sec') || decodeURIComponent(window.location.hash.slice(1));
    if (known.has(id)) navigate(id, false);
    if (window.location.hash || params.has('sec')) cleanUrl();
  });
})();
