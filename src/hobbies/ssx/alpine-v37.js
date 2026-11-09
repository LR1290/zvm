
/* SSX Alpine v37 — scoped DOM enhancement; never calls ZVM APIs or handles credentials. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const dictionary = {
    pt:{hero:'Conquiste a montanha.',desc:'Explore os melhores tempos, pontuações e riders da comunidade SSX 2012.',explore:'Explorar recordes',modes:'Escolha sua modalidade',race:'Race It!',raceSub:'Velocidade e precisão',trick:'Trick It!',trickSub:'Pontuação nas manobras',survive:'Survive It!',surviveSub:'Maior distância',riders:'Riders',ridersSub:'Conheça a comunidade',board:'Board',wings:'Wingsuit',standard:'Padrão',special:'Sem equipamentos',advanced:'Filtros avançados',sources:'Fontes dos dados e sincronização',full:'Ver tabela completa',back:'Voltar à modalidade',results:'Resultados',champions:'Melhores resultados por pista',positions:'Classificação da pista',empty:'Não há recordes nesta seleção.',more:'Mostrar mais recordes',positionsAll:'Todas as posições',positionsLeaders:'Só líderes por pista',proof:'Ver prova',top:'Posição',track:'Pista',choose:'Pesquise por pista, jogador ou região',panel:'Opções avançadas',title:'SSX 2012 · Recordes da comunidade',artTitle:'Artes originais de SSX 2012',artDisclaimer:'Este site/projeto não é endossado pela EA ou seus licenciadores, nem afiliado a eles.',artSource:'Artes promocionais: Electronic Arts. Capturas do jogo: SSX 2012, preservadas em galeria de referência. As imagens são meramente ilustrativas; os rankings continuam independentes.'},
    en:{hero:'Conquer the mountain.',desc:'Explore the fastest times, highest scores and riders in the SSX 2012 community.',explore:'Explore records',modes:'Choose a mode',race:'Race It!',raceSub:'Race to the finish',trick:'Trick It!',trickSub:'High scores and combos',survive:'Survive It!',surviveSub:'Go the distance',riders:'Riders',ridersSub:'Meet the community',board:'Board',wings:'Wingsuit',standard:'Standard',special:'No equipment',advanced:'Advanced filters',sources:'Data sources and sync',full:'Full table',back:'Back to mode',results:'Results',champions:'Best runs per track',positions:'Track standings',empty:'No records for this selection.',more:'Show more records',positionsAll:'All positions',positionsLeaders:'Leaders per track',proof:'Watch proof',top:'Position',track:'Track',choose:'Find a track, rider or region',panel:'Advanced options',title:'SSX 2012 · Community records',artTitle:'Original SSX 2012 artwork',artDisclaimer:'This fansite is not endorsed by or affiliated with EA or its licensors.',artSource:'Promotional artwork: Electronic Arts. Game screenshots: SSX 2012, archived in a reference gallery. Images are decorative; community rankings remain independent.'},
    de:{hero:'Bezwinge den Berg.',desc:'Entdecke Zeiten, Punkte und Fahrer der SSX 2012-Community.',explore:'Rekorde erkunden',modes:'Modus wählen',race:'Race It!',raceSub:'Die schnellste Zeit',trick:'Trick It!',trickSub:'Höchste Punktzahl',survive:'Survive It!',surviveSub:'Größte Distanz',riders:'Fahrer',ridersSub:'Unsere Community',board:'Board',wings:'Wingsuit',standard:'Standard',special:'Ohne Ausrüstung',advanced:'Erweiterte Filter',sources:'Datenquellen und Sync',full:'Ganze Tabelle',back:'Zurück zum Modus',results:'Ergebnisse',champions:'Beste Ergebnisse pro Strecke',positions:'Streckenrangliste',empty:'Keine Ergebnisse.',more:'Mehr Ergebnisse',positionsAll:'Alle Plätze',positionsLeaders:'Streckensieger',proof:'Beweis ansehen',top:'Platz',track:'Strecke',choose:'Strecke, Fahrer oder Region suchen',panel:'Erweiterte Optionen',title:'SSX 2012 · Community-Rekorde',artTitle:'Originalgrafiken von SSX 2012',artDisclaimer:'Diese Fan-Website wird weder von EA oder deren Lizenzgebern unterstützt noch steht sie mit ihnen in Verbindung.',artSource:'Werbegrafiken: Electronic Arts. Spielbilder: SSX 2012, in einer Galerie archiviert. Die Rangliste ist unabhängig.'},
    es:{hero:'Conquista la montaña.',desc:'Explora tiempos, puntuaciones y riders de la comunidad SSX 2012.',explore:'Explorar récords',modes:'Elige una modalidad',race:'Race It!',raceSub:'Mejores tiempos',trick:'Trick It!',trickSub:'Mejores puntuaciones',survive:'Survive It!',surviveSub:'Mayor distancia',riders:'Riders',ridersSub:'Conoce la comunidad',board:'Board',wings:'Wingsuit',standard:'Estándar',special:'Sin equipo',advanced:'Filtros avanzados',sources:'Fuentes y sincronización',full:'Tabla completa',back:'Volver a modalidad',results:'Resultados',champions:'Mejores marcas por pista',positions:'Clasificación de pista',empty:'No hay resultados.',more:'Ver más récords',positionsAll:'Todas las posiciones',positionsLeaders:'Líderes por pista',proof:'Ver prueba',top:'Posición',track:'Pista',choose:'Buscar pista, jugador o región',panel:'Opciones avanzadas',title:'SSX 2012 · Récords comunitarios',artTitle:'Arte original de SSX 2012',artDisclaimer:'Este sitio de fans no está respaldado por EA ni sus licenciantes, ni afiliado a ellos.',artSource:'Arte promocional: Electronic Arts. Capturas: SSX 2012, conservadas en una galería de referencia. Las clasificaciones son independientes.'},
    nl:{hero:'Verover de berg.',desc:'Ontdek tijden, scores en riders van de SSX 2012-community.',explore:'Records bekijken',modes:'Kies een speltype',race:'Race It!',raceSub:'Snelste tijden',trick:'Trick It!',trickSub:'Hoogste scores',survive:'Survive It!',surviveSub:'Grootste afstand',riders:'Riders',ridersSub:'Ontmoet de community',board:'Board',wings:'Wingsuit',standard:'Standaard',special:'Zonder uitrusting',advanced:'Geavanceerde filters',sources:'Gegevensbronnen en synchronisatie',full:'Volledige tabel',back:'Terug naar speltype',results:'Resultaten',champions:'Beste records per baan',positions:'Baanklassement',empty:'Geen resultaten.',more:'Meer records',positionsAll:'Alle posities',positionsLeaders:'Baanleiders',proof:'Bewijs bekijken',top:'Positie',track:'Baan',choose:'Zoek baan, rider of regio',panel:'Geavanceerde opties',title:'SSX 2012 · Communityrecords',artTitle:'Originele SSX 2012-beelden',artDisclaimer:'Deze fansite wordt niet onderschreven door EA of haar licentiegevers en is niet aan hen verbonden.',artSource:'Promotiebeelden: Electronic Arts. Screenshots: SSX 2012, bewaard in een referentiegalerij. Rankings zijn onafhankelijk.'},
    fr:{hero:'Dominez la montagne.',desc:'Découvrez les temps, scores et riders de la communauté SSX 2012.',explore:'Explorer les records',modes:'Choisissez un mode',race:'Race It!',raceSub:'Meilleurs temps',trick:'Trick It!',trickSub:'Meilleurs scores',survive:'Survive It!',surviveSub:'Plus longues distances',riders:'Riders',ridersSub:'La communauté',board:'Board',wings:'Wingsuit',standard:'Standard',special:'Sans équipement',advanced:'Filtres avancés',sources:'Sources et synchronisation',full:'Tableau complet',back:'Retour au mode',results:'Résultats',champions:'Meilleurs scores par piste',positions:'Classement de la piste',empty:'Aucun record disponible.',more:'Voir plus de records',positionsAll:'Toutes les positions',positionsLeaders:'Meilleurs par piste',proof:'Voir la preuve',top:'Position',track:'Piste',choose:'Rechercher piste, rider ou région',panel:'Options avancées',title:'SSX 2012 · Records communautaires',artTitle:'Illustrations originales de SSX 2012',artDisclaimer:'Ce site de fans nest ni approuvé par EA ou ses concédants de licence, ni affilié à eux.',artSource:'Illustrations promotionnelles : Electronic Arts. Captures : SSX 2012, archivées dans une galerie. Les classements restent indépendants.'}
  };
  const state = {mode:'board',lastRace:'board',lastSurvive:'survive',beforeFullTable:'board',visible:12,fullTable:false,allPositions:false};
  const tags = {
    board:'.record-cell.mode-board', wings:'.record-cell.mode-wings',
    trick:'.record-cell.mode-trick', survive:'.record-cell.mode-survive:not(.mode-survive-special)',
    special:'.record-cell.mode-survive-special'
  };
  let deferred = 0;
  let observed = false;
  function language() {
    const indicator = String($('langName')?.textContent || '').trim().toLowerCase();
    const byName = {'português':'pt','english':'en','deutsch':'de','español':'es','nederlands':'nl','français':'fr'};
    return byName[indicator] || (document.documentElement.lang || 'pt').slice(0,2).toLowerCase();
  }
  function t() { return dictionary[language()] || dictionary.en; }
  function text(tag, value, className) {
    const node=document.createElement(tag);
    node.textContent=value;
    if(className)node.className=className;
    return node;
  }
  function updateCopy() {
    const copy=t();
    const title=$('heroTitle'), desc=$('heroDesc');
    if(title)title.textContent=copy.hero;
    if(desc)desc.textContent=copy.desc;
    const titleDoc = $('alpineModesTitle'); if(titleDoc)titleDoc.textContent=copy.modes;
    document.querySelectorAll('[data-alpine-i18n]').forEach(node=>{
      const key=node.getAttribute('data-alpine-i18n');
      if(copy[key])node.textContent=copy[key];
    });
    const search=$('search'); if(search)search.placeholder=copy.choose;
    sync();
    scheduleCards(); // refresh card labels and evidence actions after language switches
  }
  function addUI() {
    const hero=$('top'),toolbar=$('toolbar'),sheet=$('sheet'),tbody=$('tbody');
    if(!hero||!toolbar||!sheet||!tbody||$('alpine-modes'))return false;
    document.body.classList.add('ssx-alpine-v37');
    if(navigator.connection?.saveData)document.body.classList.add('alpine-data-saver');
    const anchor=text('a','Explorar recordes','alpine-hero-cta');
    anchor.id='alpineExplore';
    anchor.href='#toolbar';
    anchor.dataset.alpineI18n='explore';
    hero.querySelector('.hero-main')?.append(anchor);

    const modes=document.createElement('section');
    modes.id='alpine-modes';
    modes.setAttribute('aria-label','Modalidades de SSX 2012');
    modes.innerHTML=
      '<div class="alpine-heading"><div><div class="alpine-eyebrow">SSX 2012 · ALPINE EDITION</div><h2 id="alpineModesTitle"></h2></div></div>'+
      '<div class="alpine-mode-grid" role="group" aria-label="Modalidades">'+
      '<button class="alpine-mode-card" type="button" data-alpine-group="race" aria-pressed="true"><span class="alpine-icon" aria-hidden="true">🏁</span><strong data-alpine-i18n="race"></strong><span data-alpine-i18n="raceSub"></span></button>'+
      '<button class="alpine-mode-card" type="button" data-alpine-group="trick" aria-pressed="false"><span class="alpine-icon" aria-hidden="true">🏆</span><strong data-alpine-i18n="trick"></strong><span data-alpine-i18n="trickSub"></span></button>'+
      '<button class="alpine-mode-card" type="button" data-alpine-group="survive" aria-pressed="false"><span class="alpine-icon" aria-hidden="true">🏔️</span><strong data-alpine-i18n="survive"></strong><span data-alpine-i18n="surviveSub"></span></button>'+
      '<button class="alpine-mode-card" type="button" data-alpine-group="riders" aria-pressed="false"><span class="alpine-icon" aria-hidden="true">👥</span><strong data-alpine-i18n="riders"></strong><span data-alpine-i18n="ridersSub"></span></button>'+
      '</div><div class="alpine-submodes" id="alpineSubmodes" role="group" aria-label="Submodalidades"></div>';
    hero.insertAdjacentElement('afterend',modes);

    const src=document.querySelector('.source-strip'),policy=$('racePolicy');
    if(src){
      const details=document.createElement('details');
      details.id='alpineSources';
      details.className='alpine-details';
      const summary=text('summary','', '');
      summary.dataset.alpineI18n='sources';
      details.append(summary,src);
      if(policy)details.append(policy);
      modes.insertAdjacentElement('afterend',details);
    }
    const categoryField=$('categoryField');
    if(categoryField){
      const advanced=document.createElement('details');
      advanced.className='alpine-details alpine-filter-advanced';
      advanced.id='alpineAdvancedFilters';
      const summary=text('summary','');
      summary.dataset.alpineI18n='advanced';
      advanced.append(summary,categoryField);
      toolbar.append(advanced);
    }

    const card=document.querySelector('.sheet-card');
    if(card){
      const head=card.querySelector('.sheet-head');
      if(head){
        const wrap=document.createElement('div');
        wrap.className='alpine-results-title';
        wrap.append(
          text('span','', 'alpine-results-mode'),
          text('button','', 'alpine-small-action')
        );
        wrap.firstChild.id='alpineModeLabel';
        wrap.lastChild.id='alpineToggleTable';
        wrap.lastChild.type='button';
        wrap.lastChild.addEventListener('click',()=>{
          if(state.fullTable){
            selectMode(state.beforeFullTable);
          } else {
            state.beforeFullTable=state.mode;
            state.fullTable=true;
            state.mode='all';
            state.visible=12;
            sync();
          }
          card.classList.toggle('alpine-show-table',state.fullTable);
        });
        const positions=text('button','','alpine-small-action alpine-positions-toggle');
        positions.id='alpinePositionsToggle';
        positions.type='button';
        positions.setAttribute('aria-pressed','false');
        positions.addEventListener('click',()=>{
          state.allPositions=!state.allPositions;
          state.visible=12;
          sync();
          scheduleCards();
        });
        wrap.append(positions);
        head.append(wrap);
      }
      const list=document.createElement('div');
      list.id='alpineMobileCards';
      list.className='alpine-mobile-cards';
      list.setAttribute('aria-live','polite');
      card.querySelector('.sheet-scroll')?.before(list);
    }

    // Media provenance belongs with the page, separate from the project brand.
    // Existing rankings, bridge credentials and About gallery are not modified.
    const credits=document.createElement('aside');
    credits.id='alpineArtCredits';
    credits.className='alpine-art-credits';
    credits.setAttribute('aria-label','Créditos das imagens do SSX 2012');
    const creditsTitle=text('strong','');
    creditsTitle.dataset.alpineI18n='artTitle';
    const disclaimer=text('p','');
    disclaimer.dataset.alpineI18n='artDisclaimer';
    const sourceText=text('p','');
    sourceText.dataset.alpineI18n='artSource';
    const references=text('p','');
    for(const [label,url] of [
      ['EA · SSX','https://www.ea.com/games/ssx'],
      ['EA · política de conteúdo','https://help.ea.com/pt-br/articles/security-and-rules/ea-content-policy/'],
      ['Jogorama · capturas SSX (2012)','https://jogorama.com.br/jogos/xbox-360/5424/ssx-2012/']
    ]){
      const link=text('a',label);
      link.href=url;
      link.rel='noopener noreferrer';
      link.target='_blank';
      link.referrerPolicy='no-referrer';
      references.append(link);
    }
    credits.append(creditsTitle,disclaimer,sourceText,references);
    card?.insertAdjacentElement('afterend',credits);

    modes.addEventListener('click',event=>{
      const item=event.target.closest('[data-alpine-group]');
      if(item){
        const group=item.dataset.alpineGroup;
        if(group==='riders'){ $('ridersBtn')?.click();return; }
        selectMode(group==='race'?state.lastRace:group==='survive'?state.lastSurvive:group);
        return;
      }
      const sub=event.target.closest('[data-alpine-mode]');
      if(sub)selectMode(sub.dataset.alpineMode);
    });
    const search=$('search');
    if(search){search.addEventListener('input',scheduleCards);}
    for(const name of ['category','region','track','topN']){
      $(name)?.addEventListener('change',()=>{
        state.visible=12;
        scheduleCards();
      });
    }
    $('langMenu')?.addEventListener('click',event=>{
      if(event.target.closest('[data-lang]'))setTimeout(updateCopy,0);
    });
    if(!observed && typeof MutationObserver!=='undefined'){
      new MutationObserver(scheduleCards).observe(tbody,{childList:true});
      observed=true;
    }
    const params=new URL(location.href).searchParams;
    const startMode=params.get('mode');
    if(['board','wings','trick','survive','special'].includes(startMode))state.mode=startMode;
    if(startMode==='wings')state.lastRace='wings';
    if(startMode==='special')state.lastSurvive='special';
    updateCopy();
    selectMode(state.mode);
    return true;
  }
  function selectMode(mode){
    if(!tags[mode])return;
    state.mode=mode;
    state.fullTable=false;
    state.visible=12;
    if(mode==='board'||mode==='wings')state.lastRace=mode;
    if(mode==='survive'||mode==='special')state.lastSurvive=mode;
    document.querySelector('.sheet-card')?.classList.remove('alpine-show-table');
    sync();
    scheduleCards();
    try {
      const url=new URL(location.href);
      url.searchParams.set('mode',mode);
      history.replaceState(history.state,'',url.toString());
    } catch(_) { /* opaque sandbox origin: browsing state remains local */ }
  }
  function sync(){
    if(!document.body.classList.contains('ssx-alpine-v37'))return;
    document.body.dataset.ssxMode=state.mode;
    const copy=t();
    const activeGroup=['board','wings'].includes(state.mode)?'race':
      ['survive','special'].includes(state.mode)?'survive':state.mode;
    for(const btn of document.querySelectorAll('[data-alpine-group]')){
      btn.setAttribute('aria-pressed',String(btn.dataset.alpineGroup===activeGroup));
    }
    const sub=$('alpineSubmodes');
    if(sub){
      const choices=activeGroup==='race'?[['board','board'],['wings','wings']]:
        activeGroup==='survive'?[['survive','standard'],['special','special']]:[];
      // Rebuild only when the group changes; preserve button focus for keyboard users.
      if(sub.dataset.group!==activeGroup){
        sub.replaceChildren();
        choices.forEach(([mode])=>{
          const button=text('button','','alpine-submode');
          button.type='button';
          button.dataset.alpineMode=mode;
          sub.append(button);
        });
        sub.dataset.group=activeGroup;
      }
      for(const button of sub.querySelectorAll('[data-alpine-mode]')){
        const mode=button.dataset.alpineMode;
        button.textContent=copy[mode==='survive'?'standard':mode];
        button.setAttribute('aria-pressed',String(state.mode===mode));
      }
    }
    const names={board:'Race It! · Board',wings:'Race It! · Wingsuit',trick:'Trick It!',survive:'Survive It! · '+copy.standard,special:'Survive It! · '+copy.special,all:copy.full};
    const label=$('alpineModeLabel');
    if(label)label.textContent=names[state.mode]||copy.results;
    const toggle=$('alpineToggleTable');
    if(toggle)toggle.textContent=state.fullTable?copy.back:copy.full;
    const positions=$('alpinePositionsToggle');
    if(positions){
      const contextual=Boolean($('track')?.value||$('search')?.value?.trim());
      positions.hidden=contextual||state.fullTable;
      positions.textContent=state.allPositions?copy.positionsLeaders:copy.positionsAll;
      positions.setAttribute('aria-pressed',String(state.allPositions));
    }
    const raceGroup=document.querySelector('#thead .race-group');
    const surviveGroup=document.querySelector('#thead .survive-group');
    if(raceGroup)raceGroup.colSpan=state.mode==='all'?2:1;
    if(surviveGroup)surviveGroup.colSpan=state.mode==='all'?2:1;
  }
  function scheduleCards(){
    if(deferred)return;
    deferred=requestAnimationFrame(()=>{
      deferred=0;
      renderCards();
    });
  }
  function renderCards(){
    const root=$('alpineMobileCards'),tbody=$('tbody');
    if(!root||!tbody||!tags[state.mode])return;
    const copy=t(), frag=document.createDocumentFragment();
    const contextual=Boolean($('track')?.value||$('search')?.value?.trim());
    const showPositions=contextual||state.allPositions;
    let currentTrack='';
    let count=0;
    let hasMore=false;
    const seenTracks=new Set();
    const rows=tbody.querySelectorAll('tr.rank-row');
    for(const row of rows){
      const mark=row.querySelector('.track-cell');
      if(mark)currentTrack=mark.querySelector('.track-name')?.textContent?.trim()||currentTrack;
      if(row.hidden||row.style.display==='none')continue;
      const record=row.querySelector(tags[state.mode]);
      if(!record||record.classList.contains('empty'))continue;
      const score=record.querySelector('.score')?.textContent?.trim();
      const rider=record.querySelector('.rider-name');
      if(!score||!rider)continue;
      const trackName=currentTrack||$('track')?.selectedOptions?.[0]?.textContent||copy.track;
      // Overview: first *available* score of each track, not necessarily #1.
      // Track selection and rider search: show every matching ranked position.
      if(!showPositions&&seenTracks.has(trackName))continue;
      count++;
      if(count>state.visible){hasMore=true;break;}
      seenTracks.add(trackName);
      const item=text('article','','alpine-card');
      const top=text('div','','alpine-card-top');
      top.append(text('span',trackName),
        text('span',row.querySelector('.pos-label')?.textContent||'',''));
      item.append(top);
      const name=text('button',rider.textContent.trim(),'alpine-card-rider');
      name.type='button';
      name.addEventListener('click',()=>rider.click());
      item.append(name,text('div',score,'alpine-card-score'));
      const source=record.querySelector('.source-badge');
      if(source)item.append(text('span',source.textContent.trim(),'alpine-card-top'));
      const proof=record.querySelector('a.proof[href]');
      if(proof){
        try{
          const url=new URL(proof.href);
          if(url.protocol==='https:'&&['youtu.be','youtube.com','www.youtube.com','m.youtube.com'].includes(url.hostname)){
            const a=text('a',copy.proof,'alpine-card-proof');
            a.href=url.href;
            a.target='_blank';
            a.rel='noopener noreferrer';
            a.referrerPolicy='no-referrer';
            item.append(a);
          }
        }catch(_){}
      }
      frag.append(item);
    }
    if(!count){
      frag.append(text('p',copy.empty,'alpine-card-empty'));
    } else if(hasMore){
      const more=text('button',copy.more,'alpine-small-action alpine-load-more');
      more.type='button';
      more.addEventListener('click',()=>{state.visible+=12;scheduleCards();});
      frag.append(more);
    }
    root.replaceChildren(frag);
    const positions=$('alpinePositionsToggle');
    if(positions){
      positions.hidden=contextual||state.fullTable;
      positions.textContent=state.allPositions?copy.positionsLeaders:copy.positionsAll;
    }
  }
  function init(){
    if(!addUI() && document.readyState==='loading')document.addEventListener('DOMContentLoaded',addUI,{once:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
