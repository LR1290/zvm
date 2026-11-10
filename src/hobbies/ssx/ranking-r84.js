/* SSX 2012 / R84 — UI-only ranking motion; never reads or modifies record values. */
(() => {
  'use strict';
  if (window.__SSX_R84_RANK_UI__) return;
  window.__SSX_R84_RANK_UI__ = true;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  const allowMotion = !(reduced || saveData);
  const raf = fn => window.requestAnimationFrame ? window.requestAnimationFrame(fn) : fn();
  function init(){
    const card = document.querySelector('.sheet-card');
    const header = card && card.querySelector('.sheet-head');
    const scroll = card && card.querySelector('.sheet-scroll');
    const tbody = card && card.querySelector('#tbody');
    if (!card || !header || !scroll || !tbody || header.dataset.ssxR84Ready === '1') return;
    header.dataset.ssxR84Ready = '1';
    const doc = header.ownerDocument;
    const emblem = doc.createElement('span');
    emblem.className = 'ssx-r84-emblem'; emblem.setAttribute('aria-hidden', 'true');
    emblem.textContent = '◆';
    const copy = doc.createElement('span'); copy.className = 'ssx-r84-heading';
    // Move existing title and metadata nodes, do not replace IDs, translations or listeners.
    for (const item of Array.from(header.children)) {
      if (item.matches('b,#sheetMeta')) copy.appendChild(item);
    }
    header.prepend(emblem,copy);
    const podium = doc.createElement('span');
    podium.className='ssx-r84-podium'; podium.setAttribute('aria-hidden','true');
    for (const rank of [1,2,3]){
      const chip=doc.createElement('span');chip.className='ssx-r84-podium-chip';
      chip.dataset.rank=String(rank);chip.textContent='#'+rank;podium.appendChild(chip);
    }
    header.appendChild(podium);
    const meter=doc.createElement('div');
    meter.className='ssx-r84-scroll-meter';meter.setAttribute('aria-hidden','true');
    const fill=doc.createElement('span');meter.appendChild(fill);
    header.after(meter);
    let scheduled=false;
    function measure(){
      scheduled=false;
      const room=Math.max(0,scroll.scrollWidth-scroll.clientWidth);
      meter.hidden=room<8;
      meter.style.setProperty('--ssx-r84-scroll',room>0?Math.min(100,Math.max(0,100*scroll.scrollLeft/room))+'%':'0%');
    }
    function schedule(){if(scheduled)return;scheduled=true;raf(measure)}
    scroll.addEventListener('scroll',schedule,{passive:true});
    window.addEventListener('resize',schedule,{passive:true});
    schedule();
    if (allowMotion && typeof IntersectionObserver === 'function') {
      const seen=new WeakSet();
      const io=new IntersectionObserver(entries=>{
        for(const item of entries){
          if(!item.isIntersecting)continue;
          item.target.classList.add('ssx-r84-in');
          io.unobserve(item.target);
        }
      },{rootMargin:'65px 0px',threshold:.05});
      let pending=false;
      function observeNewRows(){
        pending=false;
        for (const tr of tbody.querySelectorAll('tr.rank-row')) {
          if(seen.has(tr))continue;
          seen.add(tr);
          // Only podium rows animate; hundreds of historical rows never pay animation cost.
          if (tr.querySelector('td.pos.one,td.pos.two,td.pos.three')) io.observe(tr);
        }
      }
      const mutation=new MutationObserver(()=>{
        if(pending)return;pending=true;raf(observeNewRows);
      });
      mutation.observe(tbody,{childList:true});
      observeNewRows();
      // No global observers of player names, inputs, scores or identity fields.
    }
  }
  if(document.readyState === 'loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();