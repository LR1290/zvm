
/* SSX 2012 community records — public layout; rankings and evidence remain untouched. */
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

  // UI copy is intentionally editorial, not a release/build status banner.
  // The underlying v36 controls remain attached to their original DOM IDs.
  const publicCopy = {
    pt:{title:'SSX 2012 · Recordes da Comunidade',desc:'Race It!, Trick It! e Survive It!: tempos, pontuações e provas em vídeo.',records:'Recordes',riders:'Riders',about:'Sobre',more:'Mais opções',manage:'Gerenciar site',advanced:'Mais filtros',sources:'Sobre os dados',guide:'Guia',credits:'Créditos e fontes',footer:'Recordes da comunidade SSX 2012 · Projeto independente, não afiliado à EA.',modes:'Escolha uma modalidade',language:'Idioma',display:'Exibição',eyebrow:'RECORDES DA COMUNIDADE'},
    en:{title:'SSX 2012 · Community Records',desc:'Race It!, Trick It! and Survive It!: times, scores and video proof.',records:'Records',riders:'Riders',about:'About',more:'More options',manage:'Manage site',advanced:'More filters',sources:'About the data',guide:'Guide',credits:'Credits and sources',footer:'SSX 2012 community records · Independent fan project, not affiliated with EA.',modes:'Choose a mode',language:'Language',display:'View',eyebrow:'COMMUNITY RECORDS'},
    de:{title:'SSX 2012 · Community-Rekorde',desc:'Race It!, Trick It! und Survive It!: Zeiten, Punkte und Videobelege.',records:'Rekorde',riders:'Riders',about:'Über uns',more:'Mehr Optionen',manage:'Seite verwalten',advanced:'Weitere Filter',sources:'Über die Daten',guide:'Anleitung',credits:'Bildnachweise und Quellen',footer:'SSX 2012 Community-Rekorde · Unabhängiges Fanprojekt ohne Verbindung zu EA.',modes:'Spielmodus wählen',language:'Sprache',display:'Ansicht',eyebrow:'COMMUNITY-REKORDE'},
    es:{title:'SSX 2012 · Récords de la comunidad',desc:'Race It!, Trick It! y Survive It!: tiempos, puntuaciones y pruebas en vídeo.',records:'Récords',riders:'Riders',about:'Acerca de',more:'Más opciones',manage:'Administrar sitio',advanced:'Más filtros',sources:'Sobre los datos',guide:'Guía',credits:'Créditos y fuentes',footer:'Récords de SSX 2012 · Proyecto independiente sin afiliación a EA.',modes:'Elige una modalidad',language:'Idioma',display:'Vista',eyebrow:'RÉCORDS DE LA COMUNIDAD'},
    nl:{title:'SSX 2012 · Communityrecords',desc:'Race It!, Trick It! en Survive It!: tijden, scores en videobewijs.',records:'Records',riders:'Riders',about:'Over',more:'Meer opties',manage:'Site beheren',advanced:'Meer filters',sources:'Over de gegevens',guide:'Handleiding',credits:'Bronnen en credits',footer:'SSX 2012 Communityrecords · Onafhankelijk fanproject, niet verbonden met EA.',modes:'Kies een speltype',language:'Taal',display:'Weergave',eyebrow:'COMMUNITYRECORDS'},
    fr:{title:'SSX 2012 · Records communautaires',desc:'Race It!, Trick It! et Survive It! : temps, scores et preuves vidéo.',records:'Records',riders:'Riders',about:'À propos',more:'Plus d’options',manage:'Gérer le site',advanced:'Plus de filtres',sources:'À propos des données',guide:'Guide',credits:'Crédits et sources',footer:'Records SSX 2012 · Projet de fans indépendant, non affilié à EA.',modes:'Choisir un mode',language:'Langue',display:'Affichage',eyebrow:'RECORDS COMMUNAUTAIRES'}
  };
  // Editorial navigation text is independent of legacy controls and follows the six supported languages.
  const mobileCopy={
    pt:{community:'Comunidade',settings:'Ajustes',submissions:'Submissões',data:'Dados',admin:'Admin',navigation:'Navegação principal'},
    en:{community:'Community',settings:'Settings',submissions:'Submissions',data:'Data',admin:'Admin',navigation:'Main navigation'},
    de:{community:'Community',settings:'Einstellungen',submissions:'Einreichungen',data:'Daten',admin:'Admin',navigation:'Hauptnavigation'},
    es:{community:'Comunidad',settings:'Ajustes',submissions:'Envíos',data:'Datos',admin:'Admin',navigation:'Navegación principal'},
    nl:{community:'Community',settings:'Instellingen',submissions:'Inzendingen',data:'Gegevens',admin:'Admin',navigation:'Hoofdnavigatie'},
    fr:{community:'Communauté',settings:'Paramètres',submissions:'Soumissions',data:'Données',admin:'Admin',navigation:'Navigation principale'}
  };
  function refreshMobileNavigation(copy){
    const translations=mobileCopy[language()]||mobileCopy.en;
    const labels={
      records:copy.records,riders:copy.riders,community:translations.community,
      about:copy.about,more:copy.more,settings:translations.settings,
      guide:copy.guide,advanced:copy.advanced,sources:copy.sources,
      manage:copy.manage,submissions:translations.submissions,data:translations.data,admin:translations.admin
    };
    document.querySelectorAll('[data-ssx-mobile-label]').forEach(node=>{
      const value=labels[node.dataset.ssxMobileLabel];
      if(value)node.textContent=value;
    });
    const quick=$('ssxMobileQuickNav');
    if(quick)quick.setAttribute('aria-label',translations.navigation);
    const direct=$('ssxDirectActions');
    if(direct)direct.setAttribute('aria-label',(translations.navigation||copy.more)+' · '+copy.manage);
  }
  // Public destinations and tools remain one-tap actions, not another menu.
  // The original v36 buttons stay in the DOM to retain their event handlers.
  function installMobileNavigation(){
    if($('ssxMobileQuickNav'))return;
    const header=document.querySelector('.topbar');
    if(!header)return;
    const quick=document.createElement('nav');
    quick.id='ssxMobileQuickNav';
    quick.className='ssx-mobile-quick-nav';
    const direct=document.createElement('nav');
    direct.id='ssxDirectActions';
    direct.className='ssx-direct-actions';
    const item=(key,action,className)=>{
      const button=text('button','',className);
      button.type='button';
      button.dataset.ssxMobileLabel=key;
      button.dataset.ssxAction=action;
      return button;
    };
    for(const [key,action] of [
      ['records','ssxNavRecords'],['riders','ridersBtn'],
      ['community','communityMenuBtn'],['about','aboutBtn']
    ])quick.append(item(key,action,'ssx-mobile-quick-link'));
    for(const [key,action] of [
      ['settings','settingsBtn'],['guide','introBtn'],['sources','sources'],
      ['submissions','submissionsBtn'],['data','dataBtn'],['admin','adminBtn']
    ])direct.append(item(key,action,'ssx-direct-action'));
    header.insertAdjacentElement('afterend',quick);
    quick.insertAdjacentElement('afterend',direct);
    const navigate=event=>{
      const actionButton=event.target.closest('[data-ssx-action]');
      if(!actionButton)return;
      const action=actionButton.dataset.ssxAction;
      if(action==='sources'){
        const advanced=$('alpineAdvancedFilters');
        const sources=$('alpineSources');
        if(advanced)advanced.open=true;
        if(sources){
          sources.open=true;
          sources.scrollIntoView({block:'start',behavior:'instant'});
        }
        return;
      }
      const target=$(action);
      if(target)target.click();
    };
    quick.addEventListener('click',navigate);
    direct.addEventListener('click',navigate);
  }

  function applyPublicCopy() {
    const copy=publicCopy[language()]||publicCopy.en;
    document.title=copy.title;
    const replacements=[
      ['heroDesc',copy.desc],
      ['ssxNavRecords',copy.records],
      ['ssxManagementLabel',copy.manage],
      ['ssxCreditsLabel',copy.credits],
      ['ssxViewLabel',copy.display],
      ['alpineModesTitle',copy.modes]
    ];
    for(const [id,value] of replacements){
      const node=$(id);if(node)node.textContent=value;
    }
    for(const [id,symbol] of Object.entries({ssxNavRecords:'🏆',ridersBtn:'🏂',communityMenuBtn:'❄️',aboutBtn:'🏔️'})){
      const node=$(id);
      if(!node)continue;
      let icon=node.querySelector('.ssx-nav-symbol');
      if(!icon){icon=text('span',symbol,'ssx-nav-symbol');icon.setAttribute('aria-hidden','true');node.prepend(icon);}
    }
    const about=$('aboutBtn')?.querySelector('[data-i="aboutNav"]');
    if(about)about.textContent=copy.about;
    const riders=$('ridersBtn')?.querySelector('[data-i="riders"]');
    if(riders)riders.textContent=copy.riders;
    const intro=$('introBtn')?.querySelector('span:not(.nav-ico)');
    if(intro)intro.textContent=copy.guide;
    const more=$('toolsMenuBtn');if(more){more.setAttribute('aria-label',copy.more);const label=more.querySelector('[data-i="navTools"]');if(label)label.textContent=copy.more;}
    const lang=$('langBtn');if(lang)lang.setAttribute('aria-label',copy.language);
    const advanced=$('alpineAdvancedFilters')?.querySelector(':scope > summary');
    if(advanced)advanced.textContent=copy.advanced;
    const sources=$('alpineSources')?.querySelector(':scope > summary');
    if(sources)sources.textContent=copy.sources;
    const footer=document.querySelector('.footer');
    if(footer)footer.textContent=copy.footer;
    const eyebrow=document.querySelector('.hero-main > .eyebrow');
    if(eyebrow)eyebrow.textContent=copy.eyebrow;
    refreshMobileNavigation(copy);
  }
  function buildPublicLayout(hero,toolbar,card,credits) {
    const nav=$('topNav'),riders=$('ridersBtn'),tools=$('toolsGroup'),about=$('aboutBtn');
    if(nav&&riders&&tools&&about&&!$('ssxNavRecords')){
      const records=text('a','Recordes','btn nav-btn ssx-nav-records');
      records.id='ssxNavRecords';
      records.href='#alpine-modes';
      nav.insertBefore(records,riders);
      about.removeAttribute('role');
      about.classList.add('ssx-nav-about');
      nav.insertBefore(about,tools);
      // About originally belongs to another navigation group; move it before
      // reordering Community. insertBefore requires a direct child reference.
      const communityGroup=$('communityMenuBtn')?.closest('.nav-group');
      if(communityGroup?.parentElement===nav)nav.insertBefore(communityGroup,about);
      const more=$('toolsMenuBtn');
      if(more){
        more.classList.add('ssx-gear-trigger');
        more.setAttribute('title','Mais opções');
        const icon=more.querySelector('.nav-ico');
        if(icon)icon.textContent='⋯';
        // Desktop uses an icon; mobile retains its visible and translated label.
        const moreLabel=more.querySelector('[data-i="navTools"]');
        if(moreLabel)moreLabel.textContent='Mais opções';
      }
      const menu=$('toolsMenu'),submissions=$('submissionsBtn'),settings=$('settingsBtn'),data=$('dataBtn'),admin=$('adminBtn');
      if(menu&&submissions&&settings&&data&&admin){
        menu.prepend(settings);
        const management=document.createElement('details');
        management.className='ssx-management';
        management.id='ssxManagement';
        const disclosure=text('summary','Gerenciar site');
        disclosure.id='ssxManagementLabel';
        management.append(disclosure,submissions,data,admin);
        menu.append(management);
      }
    }
    // Community is a destination, not a dropdown containing only one Guide item.
    const communityButton=$('communityMenuBtn');
    if(communityButton){
      communityButton.removeAttribute('aria-haspopup');
      communityButton.removeAttribute('aria-expanded');
      communityButton.removeAttribute('aria-controls');
      communityButton.addEventListener('click',event=>{
        event.preventDefault();
        event.stopImmediatePropagation();
        $('introBtn')?.click();
      },true);
    }
    const introHeading=$('introModal')?.querySelector('.modal-head h2');
    if(introHeading)for(const node of introHeading.childNodes){
      if(node.nodeType===3 && /INTRO/i.test(node.nodeValue||''))node.nodeValue=' ';
    }
    const stats=hero.querySelector('.hero-stats');
    if(stats){
      stats.classList.add('ssx-community-stats');
      hero.insertAdjacentElement('afterend',stats);
    }
    const eyebrow=document.querySelector('.hero-main > .eyebrow');
    eyebrow?.removeAttribute('data-i');
    const advanced=$('alpineAdvancedFilters'),sources=$('alpineSources');
    const topN=$('topN')?.closest('.field');
    const actions=toolbar.querySelector('.toolbar-actions');
    if(advanced){
      advanced.classList.add('ssx-filter-disclosure');
      const inner=document.createElement('div');
      inner.className='ssx-advanced-content';
      const category=$('categoryField');
      if(category)inner.append(category);
      if(topN)inner.append(topN);
      if(actions)inner.append(actions);
      if(sources){
        sources.classList.add('ssx-source-disclosure');
        inner.append(sources);
      }
      advanced.append(inner);
    }
    if(credits){
      const box=document.createElement('details');
      box.id='ssxCredits';
      box.className='ssx-credits-disclosure';
      const summary=text('summary','Créditos e fontes');
      summary.id='ssxCreditsLabel';
      credits.replaceWith(box);
      box.append(summary,credits);
    }
    const footer=document.querySelector('.footer');
    footer?.removeAttribute('data-i');
    installMobileNavigation();
    applyPublicCopy();
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
    const search=$('search');
    if(search)search.placeholder=({
      pt:'Buscar rider ou recorde',en:'Find rider or record',
      de:'Rider oder Rekord suchen',es:'Buscar rider o récord',
      nl:'Zoek rider of record',fr:'Chercher rider ou record'
    })[language()]||copy.choose;
    sync();
    applyPublicCopy();
    scheduleCards(); // refresh card labels and evidence actions after language switches
  }

  // The existing ranking DOM is authoritative. This is a read-only regional view.
  let regionalSelection='';
  let openedRegions=new Set();
  let selectedRegion='all';
  let regionalCache=null;
  let fullTrackCatalog=null;
  const regionTabsI18n={
    pt:['Regiões','Todas as regiões','Use as setas para mudar de região'],
    en:['Regions','All regions','Use arrow keys to change region'],
    de:['Regionen','Alle Regionen','Region mit Pfeiltasten wechseln'],
    es:['Regiones','Todas las regiones','Usa las flechas para cambiar de región'],
    nl:['Regio’s','Alle regio’s','Wissel van regio met de pijltjestoetsen'],
    fr:['Régions','Toutes les régions','Utilisez les flèches pour changer de région']
  };
  let regionQuery='';
  const regionToolsCopy={
    pt:{search:'Buscar região, montanha ou pista',clear:'Limpar busca',previous:'Pista anterior',next:'Próxima pista',empty:'Nenhuma pista encontrada. Limpe a busca.',navigation:'Navegar entre pistas'},
    en:{search:'Find region, mountain or track',clear:'Clear search',previous:'Previous track',next:'Next track',empty:'No tracks found. Clear your search.',navigation:'Browse tracks'},
    de:{search:'Region, Berg oder Strecke suchen',clear:'Suche löschen',previous:'Vorherige Strecke',next:'Nächste Strecke',empty:'Keine Strecken gefunden. Suche löschen.',navigation:'Strecken wechseln'},
    es:{search:'Buscar región, montaña o pista',clear:'Borrar búsqueda',previous:'Pista anterior',next:'Pista siguiente',empty:'No se encontraron pistas. Borra la búsqueda.',navigation:'Navegar entre pistas'},
    nl:{search:'Zoek regio, berg of baan',clear:'Zoekopdracht wissen',previous:'Vorige baan',next:'Volgende baan',empty:'Geen banen gevonden. Wis de zoekopdracht.',navigation:'Banen doorzoeken'},
    fr:{search:'Rechercher région, montagne ou piste',clear:'Effacer',previous:'Piste précédente',next:'Piste suivante',empty:'Aucune piste trouvée. Effacez la recherche.',navigation:'Parcourir les pistes'}
  };
  const normalizedRegionText=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  function applyRegionSearch(){
    const browser=$('ssxRegionBrowser');
    if(!browser)return;
    const query=normalizedRegionText(regionQuery);
    let shown=0;
    for(const region of browser.querySelectorAll('.ssx-region-group')){
      let matches=0;
      for(const mountain of region.querySelectorAll('.ssx-mountain-section')){
        let mountainCount=0;
        for(const track of mountain.querySelectorAll('.ssx-track-choice')){
          const match=!query||normalizedRegionText(track.dataset.regionTrack).includes(query);
          track.hidden=!match;
          if(match){mountainCount++;matches++;shown++;}
        }
        mountain.hidden=mountainCount===0;
      }
      region.hidden=matches===0;
      region.open=query?matches>0:openedRegions.has(region.dataset.regionName);
    }
    const stats=$('ssxRegionMatches');
    if(stats)stats.textContent=shown+' '+(regionI18n[language()]||regionI18n.en)[2];
    const empty=$('ssxRegionNoMatches');
    if(empty)empty.hidden=shown>0;
    const clear=$('ssxRegionSearchClear');
    if(clear)clear.hidden=!regionQuery;
    resetControlState();
  }
  const regionImages=['race.jpg','hero.jpg','survive.jpg','trick.jpg','riders.jpg'];
  const regionIcons={Africa:'🌍',Alaska:'❄️',Alps:'🏔️',Antarctica:'🧊',Himalayas:'🏔️',Japan:'🌸','Mount Eddie':'🏂','New Zealand':'🌊',Patagonia:'🧗',Rockies:'🏔️',Siberia:'❄️',Training:'🎿'};
  const regionI18n={
    pt:['Regiões e pistas','Escolha uma pista','pistas','resultados','Ver prova','Nenhum recorde nesta seleção'],
    en:['Regions and tracks','Choose a track','tracks','results','Watch proof','No records in this selection'],
    de:['Regionen und Strecken','Strecke wählen','Strecken','Ergebnisse','Beweis ansehen','Keine Rekorde'],
    es:['Regiones y pistas','Elige una pista','pistas','resultados','Ver prueba','Sin récords'],
    nl:['Regio’s en banen','Kies een baan','banen','resultaten','Bekijk bewijs','Geen records'],
    fr:['Régions et pistes','Choisissez une piste','pistes','résultats','Voir la preuve','Aucun record']
  };
  function artForRegion(el,region){
    let hash=0;
    for(const char of region)hash=(hash*31+char.charCodeAt(0))>>>0;
    el.style.setProperty('--ssx-region-art','url("/hobbies/ssx/media/v37/'+regionImages[hash%regionImages.length]+'")');
  }
  function addRegionBrowser(card){
    if(!card||$('ssxRegionBrowser'))return;
    const browser=text('section','','ssx-region-browser');
    browser.id='ssxRegionBrowser';
    browser.setAttribute('aria-label','Regiões, montanhas e pistas');
    browser.addEventListener('click',event=>{
      const summary=event.target.closest('summary.ssx-region-banner');
      if(summary&&!regionQuery){
        const details=summary.closest('details[data-region-name]');
        if(details){
          if(details.open)openedRegions.delete(details.dataset.regionName);
          else openedRegions.add(details.dataset.regionName);
        }
        return;
      }
      let choice=event.target.closest('[data-region-track]');
      const step=event.target.closest('[data-ssx-track-step]');
      if(step){
        const ordered=[...browser.querySelectorAll('.ssx-track-choice')];
        const index=ordered.findIndex(node=>node.dataset.regionTrack===regionalSelection);
        choice=ordered[index+Number(step.dataset.ssxTrackStep)]||null;
        if(choice)regionQuery='';
      }
      if(!choice)return;
      regionalSelection=choice.dataset.regionTrack;
      openedRegions.add(choice.dataset.regionName);
      syncTrackAddress();
      renderRegionBrowser();
      if(window.matchMedia('(max-width:900px)').matches){
        const selected=$('ssxRegionBrowser')?.querySelector('.ssx-region-detail');
        if(selected)selected.scrollIntoView({block:'start',
          behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
      }else if(step){
        $('ssxRegionBrowser')?.querySelector('[data-ssx-track-step="'+step.dataset.ssxTrackStep+'"]')?.focus({preventScroll:true});
      }
    });
    card.querySelector('.sheet-scroll')?.before(browser);
  }

  // Index the embedded, canonical ranking rows in one pass. Row visibility belongs
  // only to the old table filter, never to whether a track has loaded.

  // The v36 page originally renders only eight track groups and waits for
  // IntersectionObserver to request the rest. Keep its canonical dataset and
  // ranking functions, but drain batches synchronously on each original render.
  function installCompleteTrackRendering(){
    const legacy=window.appendRenderBatch;
    if(typeof legacy!=='function'||window.__ssxCompleteTracksInstalled)return false;
    const progress=$('renderProgress');
    let inside=false;
    const complete=(...args)=>{
      if(inside)return legacy(...args);
      inside=true;
      try{
        for(let batch=0;batch<256;batch++){
          const before=$('tbody')?.querySelectorAll('.track-cell').length||0;
          legacy(...args);
          const after=$('tbody')?.querySelectorAll('.track-cell').length||0;
          if(progress?.hidden||after<=before)break;
        }
      }finally{
        inside=false;
      }
    };
    window.appendRenderBatch=complete;
    window.__ssxCompleteTracksInstalled=true;
    complete();
    return true;
  }
  // Region tabs are built from the original embedded track catalogue, not
  // from which scores are available in a particular source or game mode.
  function completeTrackCatalog(){
    if(fullTrackCatalog)return fullTrackCatalog;
    const canonical=typeof window.availableTracks==='function'?
      [...window.availableTracks()]:[];
    const records=new Map();
    if(typeof window.trackObj==='function'){
      for(const id of canonical){
        const item=window.trackObj(id);
        if(!item?.track||!item?.region)continue;
        const entry={
          region:String(item.region),
          mountain:String(item.mountain||''),
          track:String(item.track),
          order:Number(id)
        };
        entry.key=JSON.stringify([entry.region,entry.mountain,entry.track]);
        if(!records.has(entry.key))records.set(entry.key,{...entry,runs:[]});
      }
    }
    // The original spreadsheet's region dropdown carries the preferred ordering.
    const order=new Map([...$('region')?.options||[]].map((option,i)=>[option.textContent.trim(),i]));
    fullTrackCatalog=[...records.values()].sort((a,b)=>
      (order.get(a.region)??99)-(order.get(b.region)??99)||
      a.order-b.order||
      a.track.localeCompare(b.track,undefined,{numeric:true}));
    return fullTrackCatalog;
  }

  function indexedTracks(mode){
    if(!regionalCache){
      const indexes=new Map(Object.keys(tags).map(name=>[name,new Map()]));
      const body=$('tbody');
      let current=null;
      for(const row of body?.querySelectorAll('tr.rank-row')||[]){
        const cell=row.querySelector('.track-cell');
        if(cell){
          const name=cell.querySelector('.track-name')?.textContent?.trim();
          const heading=cell.querySelector('.track-meta')?.childNodes?.[0]?.textContent?.trim()||'';
          const parts=heading.split(' · ');
          current=name?{track:name,region:parts[0]||'Other',mountain:parts.slice(1).join(' · ')}:null;
        }
        if(!current)continue;
        for(const [name,selector] of Object.entries(tags)){
          const record=row.querySelector(selector);
          if(!record||record.classList.contains('empty'))continue;
          const rider=record.querySelector('.rider-name');
          const score=record.querySelector('.score')?.textContent?.trim();
          if(!rider||!score)continue;
          const key=JSON.stringify([current.region,current.mountain,current.track]);
          const map=indexes.get(name);
          if(!map.has(key))map.set(key,{...current,key,runs:[]});
          const proof=record.querySelector('a.proof[href]');
          let video='';
          if(proof){
            try{
              const url=new URL(proof.href);
              if(url.protocol==='https:'&&['youtu.be','youtube.com','www.youtube.com','m.youtube.com'].includes(url.hostname))video=url.href;
            }catch(_){}
          }
          map.get(key).runs.push({
            position:row.querySelector('.pos-label')?.textContent?.trim()||'',
            rider,score,video,
            source:record.querySelector('.source-badge')?.textContent?.trim()||'',
            flag:rider.querySelector('.rider-flag')
          });
        }
      }
      regionalCache=new Map([...indexes].map(([name,map])=>[name,[...map.values()]]));
      document.body.dataset.ssxTracksIndexed='ready';
    }
    return regionalCache.get(mode)||[];
  }
  function renderRegionTabs(entries){
    const nav=$('ssxSheetRegions');
    if(!nav)return;
    const labels=regionTabsI18n[language()]||regionTabsI18n.en;
    nav.setAttribute('aria-label',labels[0]);
    nav.title=labels[2];
    const counts=new Map();
    for(const item of entries)counts.set(item.region,(counts.get(item.region)||0)+1);
    const signature=[language(),...[...counts].map(([name,count])=>name+':'+count)].join('|');
    if(nav.dataset.signature!==signature){
      const fragment=document.createDocumentFragment();
      for(const [region,label] of [['all',labels[1]],...[...counts.keys()].map(region=>[region,(regionIcons[region]||'🏂')+' '+region])]){
        const button=text('button',label,'ssx-sheet-region-tab');
        button.type='button';
        button.dataset.ssxRegion=region;
        button.setAttribute('aria-pressed',String(region===selectedRegion));
        const amount=region==='all'?entries.length:counts.get(region);
        button.append(text('small',String(amount),'ssx-sheet-region-count'));
        fragment.append(button);
      }
      nav.replaceChildren(fragment);
      nav.dataset.signature=signature;
    }
    for(const button of nav.querySelectorAll('.ssx-sheet-region-tab')){
      button.setAttribute('aria-pressed',String(button.dataset.ssxRegion===selectedRegion));
    }
  }

  // A single deliberate reset for the real sheet fields. Keep source and
  // game mode unchanged; clear only user-selected filters and browse state.
  const resetLabels={
    pt:['Limpar filtros','Restaura a busca, região, pista e filtros; mantém modalidade e fonte'],
    en:['Clear filters','Reset search, region, track and filters; keep mode and source'],
    de:['Filter zurücksetzen','Suche, Region, Strecke und Filter zurücksetzen; Modus und Quelle behalten'],
    es:['Limpiar filtros','Restablece búsqueda, región, pista y filtros; conserva modo y fuente'],
    nl:['Filters wissen','Wis zoekopdracht, regio, baan en filters; behoud modus en bron'],
    fr:['Effacer les filtres','Réinitialiser recherche, région, piste et filtres; conserver mode et source']
  };
  const nativeFilterDefaults=new Map();
  function resetControlState(){
    const button=$('ssxResetFilters');
    if(!button)return;
    const labels=resetLabels[language()]||resetLabels.en;
    button.textContent='↺ '+labels[0];
    button.title=labels[1];
    button.setAttribute('aria-label',labels[1]);
    const altered=[...nativeFilterDefaults].some(([id,value])=>$(id)?.value!==value);
    const original=completeTrackCatalog()[0]?.key||'';
    const active=altered||!!$('search')?.value?.trim()||!!regionQuery||
      selectedRegion!=='all'||state.allPositions||
      !!regionalSelection&&regionalSelection!==original;
    button.disabled=!active;
    button.setAttribute('aria-disabled',String(!active));
  }
  function mountResetControl(toolbar){
    if(!toolbar||$('ssxResetFilters'))return;
    for(const id of ['category','region','track','topN']){
      if($(id))nativeFilterDefaults.set(id,$(id).value);
    }
    const button=text('button','','ssx-reset-filters');
    button.id='ssxResetFilters';
    button.type='button';
    button.addEventListener('click',()=>{
      if(button.disabled)return;
      regionQuery='';
      selectedRegion='all';
      regionalSelection='';
      openedRegions=new Set();
      state.allPositions=false;
      state.visible=12;
      const globalSearch=$('search');
      if(globalSearch&&globalSearch.value){
        globalSearch.value='';
        globalSearch.dispatchEvent(new Event('input',{bubbles:true}));
      }
      for(const id of ['region','category','topN','track']){
        const control=$(id);
        if(!control)continue;
        const initial=nativeFilterDefaults.get(id);
        if([...control.options].some(option=>option.value===initial))control.value=initial;
        else control.selectedIndex=0;
        control.dispatchEvent(new Event('change',{bubbles:true}));
      }
      regionQuery='';
      selectedRegion='all';
      regionalSelection='';
      openedRegions=new Set();
      syncTrackAddress();
      applyPublicCopy();
      sync();
      scheduleCards();
      renderRegionBrowser();
      resetControlState();
    });
    toolbar.append(button);
    resetControlState();
  }
  function revealRegionTab(nav,button){
    if(!nav||!button)return;
    const area=nav.getBoundingClientRect(),item=button.getBoundingClientRect();
    const inset=10;
    const delta=item.left<area.left+inset?
      item.left-area.left-inset:
      item.right>area.right-inset?item.right-area.right+inset:0;
    if(delta)nav.scrollBy({
      left:delta,
      behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'
    });
  }

  function mountSheetControls(card,toolbar){
    if(!card||!toolbar||$('ssxSheetRegions'))return;
    const nav=text('nav','','ssx-sheet-regions');
    nav.id='ssxSheetRegions';
    nav.addEventListener('keydown',event=>{
      const focused=event.target.closest('button[data-ssx-region]');
      if(!focused||!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;
      const items=[...nav.querySelectorAll('button[data-ssx-region]')];
      const index=items.indexOf(focused);
      if(index<0)return;
      event.preventDefault();
      const next=event.key==='Home'?0:event.key==='End'?items.length-1:
        Math.max(0,Math.min(items.length-1,index+(event.key==='ArrowRight'?1:-1)));
      const target=items[next];
      target.click();
      target.focus({preventScroll:true});
      revealRegionTab(nav,target);
    });
    nav.addEventListener('click',event=>{
      const button=event.target.closest('[data-ssx-region]');
      if(!button||button.dataset.ssxRegion===selectedRegion)return;
      selectedRegion=button.dataset.ssxRegion;
      regionalSelection='';
      regionQuery='';
      openedRegions=new Set(selectedRegion==='all'?[]:[selectedRegion]);
      const native=$('region');
      if(native){
        const option=selectedRegion==='all'
          ?([...native.options].find(o=>o.value==='')||native.options[0])
          :[...native.options].find(o=>normalizedRegionText(o.textContent)===normalizedRegionText(selectedRegion));
        if(option){
          native.value=option.value;
          native.dispatchEvent(new Event('change',{bubbles:true}));
        }
      }
      // The native filter rebuilt the table synchronously. Never show ranks
      // from the old region/source while the next animation frame is pending.
      regionalCache=null;
      renderRegionBrowser();
      syncTrackAddress();
      nav.querySelectorAll('[data-ssx-region]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.ssxRegion===selectedRegion)));
      const activeTab=nav.querySelector('[aria-pressed="true"]');
      activeTab?.focus({preventScroll:true});
      revealRegionTab(nav,activeTab);
      resetControlState();
    });
    const head=card.querySelector('.sheet-head');
    if(!head)return;
    head.after(nav);
    nav.after(toolbar);
    toolbar.classList.add('ssx-sheet-toolbar');
    $('region')?.closest('.field')?.classList.add('ssx-legacy-region-select');
  }


  // Keep a single canonical mode state. This secondary control is a compact
  // mobile presentation of the same Board/Wingsuit and Survive submodes.
  function mountSheetModeFilter(card){
    const toolbar=$('toolbar');
    if(!card||!toolbar||$('ssxSheetModeFilter'))return;
    const rail=text('nav','','ssx-sheet-mode-filter');
    rail.id='ssxSheetModeFilter';
    rail.setAttribute('role','group');
    rail.hidden=true;
    for(const [mode,symbol] of [['board','🏂'],['wings','🪂'],['survive','❄️'],['special','⚡']]){
      const button=text('button','','ssx-sheet-mode-option');
      button.type='button';
      button.dataset.ssxSheetMode=mode;
      button.setAttribute('aria-pressed','false');
      const pict=text('span',symbol,'ssx-sheet-mode-icon');
      pict.setAttribute('aria-hidden','true');
      button.append(pict,text('span','','ssx-sheet-mode-name'));
      rail.append(button);
    }
    rail.addEventListener('click',event=>{
      const button=event.target.closest('[data-ssx-sheet-mode]');
      if(!button||button.hidden)return;
      // The original sheet listens to bubbled clicks. Keep this internal mode
      // control independent so its source/title handlers cannot hijack it.
      event.stopPropagation();
      if(button.dataset.ssxSheetMode!==state.mode)selectMode(button.dataset.ssxSheetMode);
      updateCopy();
    });
    toolbar.after(rail);
  }
  function syncSheetModeFilter(group,copy){
    const rail=$('ssxSheetModeFilter');
    if(!rail)return;
    const allowed=group==='race'?['board','wings']:
      group==='survive'?['survive','special']:[];
    rail.hidden=allowed.length===0||state.fullTable;
    rail.setAttribute('aria-label',group==='race'?copy.race:
      group==='survive'?copy.survive:copy.modes);
    for(const button of rail.querySelectorAll('[data-ssx-sheet-mode]')){
      const mode=button.dataset.ssxSheetMode;
      const visible=allowed.includes(mode);
      button.hidden=!visible;
      const label=copy[mode==='survive'?'standard':mode]||mode;
      const name=button.querySelector('.ssx-sheet-mode-name');
      if(name)name.textContent=label;
      button.setAttribute('aria-label',label);
      button.setAttribute('aria-pressed',String(visible&&state.mode===mode));
      button.setAttribute('tabindex',visible?'0':'-1');
    }
  }


  // A track link contains only canonical public names and a known game mode.
  // Never serialize private account data, admin state, or the source selector.
  const shareLabels={
    pt:{share:'Compartilhar pista',copied:'Link copiado!',manual:'Selecione e copie este endereço:',failed:'Copie o endereço da pista:',title:'Recorde SSX 2012'},
    en:{share:'Share track',copied:'Link copied!',manual:'Select and copy this link:',failed:'Copy the track link:',title:'SSX 2012 record'},
    de:{share:'Strecke teilen',copied:'Link kopiert!',manual:'Link auswählen und kopieren:',failed:'Streckenlink kopieren:',title:'SSX 2012 Rekord'},
    es:{share:'Compartir pista',copied:'¡Enlace copiado!',manual:'Selecciona y copia el enlace:',failed:'Copia el enlace de la pista:',title:'Récord SSX 2012'},
    nl:{share:'Baan delen',copied:'Link gekopieerd!',manual:'Selecteer en kopieer deze link:',failed:'Kopieer de baanlink:',title:'SSX 2012-record'},
    fr:{share:'Partager la piste',copied:'Lien copié !',manual:'Sélectionnez et copiez ce lien :',failed:'Copiez le lien de la piste :',title:'Record SSX 2012'}
  };
  function trackShareUrl(trackKey){
    const target=new URL(location.href);
    // Previews must always share the canonical public SSX route, never a
    // development/preview route or a URL with unrelated session parameters.
    target.pathname=target.pathname.replace(/\/ssx2012-alpine-v37-preview$/,'/ssx2012');
    target.search='';
    target.searchParams.set('mode',state.mode);
    target.searchParams.set('ssxTrack',trackKey);
    target.hash='ssxRegionBrowser';
    return target.href;
  }
  function syncTrackAddress(){
    try{
      const url=new URL(location.href);
      if(regionalSelection&&completeTrackCatalog().some(item=>item.key===regionalSelection)){
        url.searchParams.set('ssxTrack',regionalSelection);
      }else url.searchParams.delete('ssxTrack');
      history.replaceState(history.state,'',url.toString());
    }catch(_){ /* URL cannot be changed inside opaque preview frames. */ }
  }
  function restoreSharedTrack(){
    try{
      const key=new URL(location.href).searchParams.get('ssxTrack');
      if(!key)return false;
      const track=completeTrackCatalog().find(item=>item.key===key);
      if(!track)return false;
      selectedRegion=track.region;
      regionalSelection=track.key;
      openedRegions.add(track.region);
      return true;
    }catch(_){return false;}
  }
  function createTrackShareControl(selected){
    const labels=shareLabels[language()]||shareLabels.en;
    const controls=text('div','','ssx-track-share-controls');
    const button=text('button','🔗 '+labels.share,'ssx-track-share-button');
    button.type='button';
    button.setAttribute('aria-label',labels.share);
    const url=trackShareUrl(selected.key);
    button.dataset.shareUrl=url;
    const status=text('span','','ssx-track-share-status');
    status.setAttribute('role','status');
    const manual=text('input','','ssx-track-share-manual');
    manual.type='text';
    manual.readOnly=true;
    manual.value=url;
    manual.setAttribute('aria-label',labels.manual);
    manual.hidden=true;
    button.addEventListener('click',async()=>{
      status.textContent='';
      manual.hidden=true;
      try{
        if(typeof navigator.share==='function'){
          await navigator.share({title:labels.title+' · '+selected.track,url});
          return;
        }
        if(navigator.clipboard&&typeof navigator.clipboard.writeText==='function'){
          await navigator.clipboard.writeText(url);
          status.textContent=labels.copied;
          return;
        }
      }catch(error){
        if(error?.name==='AbortError')return;
      }
      status.textContent=labels.failed;
      manual.hidden=false;
      manual.focus();
      manual.select();
    });
    controls.append(button,status,manual);
    return controls;
  }

  function renderRegionBrowser(){
    const browser=$('ssxRegionBrowser');
    if(!browser||!tags[state.mode])return;
    const copy=regionI18n[language()]||regionI18n.en;
    const indexed=new Map(indexedTracks(state.mode).map(item=>[item.key,item]));
    const allEntries=completeTrackCatalog().map(item=>indexed.get(item.key)||item);
    if(selectedRegion!=='all'&&!allEntries.some(item=>item.region===selectedRegion))selectedRegion='all';
    const entries=selectedRegion==='all'?allEntries:allEntries.filter(item=>item.region===selectedRegion);
    renderRegionTabs(allEntries);
    if(!entries.some(item=>item.key===regionalSelection))regionalSelection=entries[0]?.key||'';
    const selected=entries.find(item=>item.key===regionalSelection);
    const regions=new Map();
    for(const item of entries){
      if(!regions.has(item.region))regions.set(item.region,new Map());
      const mountains=regions.get(item.region);
      if(!mountains.has(item.mountain))mountains.set(item.mountain,[]);
      mountains.get(item.mountain).push(item);
    }
    if(!openedRegions.size&&selected)openedRegions.add(selected.region);
    const index=text('div','','ssx-region-index');
    const intro=text('header','','ssx-region-intro');
    intro.append(text('h3',copy[0]),text('p',copy[1]));
    const toolsCopy=regionToolsCopy[language()]||regionToolsCopy.en;
    const searchBox=text('div','','ssx-region-search-box');
    const regionSearch=document.createElement('input');
    regionSearch.id='ssxRegionSearch';
    regionSearch.type='search';
    regionSearch.autocomplete='off';
    regionSearch.setAttribute('aria-label',toolsCopy.search);
    regionSearch.placeholder=toolsCopy.search;
    regionSearch.value=regionQuery;
    regionSearch.addEventListener('input',()=>{
      regionQuery=regionSearch.value;
      applyRegionSearch();
    });
    regionSearch.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&regionQuery){
        event.preventDefault();
        regionQuery='';
        regionSearch.value='';
        applyRegionSearch();
      }
    });
    const clearSearch=text('button','×','ssx-region-search-clear');
    clearSearch.id='ssxRegionSearchClear';
    clearSearch.type='button';
    clearSearch.title=toolsCopy.clear;
    clearSearch.setAttribute('aria-label',toolsCopy.clear);
    clearSearch.addEventListener('click',()=>{
      regionQuery='';
      regionSearch.value='';
      applyRegionSearch();
      regionSearch.focus();
    });
    searchBox.append(regionSearch,clearSearch);
    const count=text('small','','ssx-region-search-count');
    count.id='ssxRegionMatches';
    count.setAttribute('aria-live','polite');
    intro.append(searchBox,count);
    index.append(intro);
    for(const [region,mountains] of regions){
      const section=document.createElement('details');
      section.className='ssx-region-group';
      section.dataset.regionName=region;
      section.open=openedRegions.has(region);
      const banner=text('summary','','ssx-region-banner');
      artForRegion(banner,region);
      banner.append(text('strong',(regionIcons[region]||'🏂')+' '+region),text('span','⌄','ssx-region-chevron'));
      const total=[...mountains.values()].reduce((n,items)=>n+items.length,0);
      banner.append(text('small',total+' '+copy[2]));
      section.append(banner);
      const mountainList=text('div','','ssx-mountain-list');
      for(const [mountain,pistes] of mountains){
        const box=text('section','','ssx-mountain-section');
        box.append(text('h4','🏔️ '+mountain));
        const grid=text('div','','ssx-track-grid');
        for(const item of pistes){
          const button=text('button','','ssx-track-choice');
          button.type='button';
          button.dataset.regionTrack=item.key;
          button.dataset.regionName=region;
          button.setAttribute('aria-pressed',String(item.key===regionalSelection));
          button.append(text('strong','🏂 '+item.track),text('small',item.runs.length+' '+copy[3]));
          grid.append(button);
        }
        box.append(grid);mountainList.append(box);
      }
      section.append(mountainList);index.append(section);
    }
    const noMatches=text('p',toolsCopy.empty,'ssx-region-no-matches');
    noMatches.id='ssxRegionNoMatches';
    noMatches.hidden=true;
    index.append(noMatches);
    const detail=text('div','','ssx-region-detail');
    if(selected){
      const header=text('header','','ssx-region-detail-header');
      artForRegion(header,selected.region);
      header.append(text('span',(regionIcons[selected.region]||'🏂')+' '+selected.region+' / '+selected.mountain),
        text('h3',selected.track),text('small','🏆 '+selected.runs.length+' '+copy[3]));
      detail.append(header);
      const trackIndex=entries.findIndex(item=>item.key===selected.key);
      const stepper=text('nav','','ssx-region-stepper');
      stepper.setAttribute('aria-label',toolsCopy.navigation);
      const previous=text('button','‹','ssx-region-step');
      previous.type='button';
      previous.dataset.ssxTrackStep='-1';
      previous.disabled=trackIndex<=0;
      previous.setAttribute('aria-label',toolsCopy.previous);
      previous.title=toolsCopy.previous;
      const position=text('span',(trackIndex+1)+' / '+entries.length,'ssx-region-step-count');
      const next=text('button','›','ssx-region-step');
      next.type='button';
      next.dataset.ssxTrackStep='1';
      next.disabled=trackIndex>=entries.length-1;
      next.setAttribute('aria-label',toolsCopy.next);
      next.title=toolsCopy.next;
      stepper.append(previous,position,next);
      detail.append(stepper,createTrackShareControl(selected));
      const ranking=text('div','','ssx-region-ranking');
      for(const run of selected.runs){
        const item=text('div','','ssx-region-rank');
        item.append(text('span',run.position+(run.position==='#1'?' 🏆':run.position==='#2'?' 🥈':run.position==='#3'?' 🥉':''),'ssx-region-position'));
        const identity=text('div','','ssx-region-identity');
        const name=text('button','','ssx-region-rider');
        if(run.flag)name.append(run.flag.cloneNode(true));
        const nameLabel=text('span',run.rider.textContent.trim());
        name.append(nameLabel);
        name.type='button';
        name.title=run.rider.textContent.trim();
        name.addEventListener('click',()=>run.rider.click());
        identity.append(name);
        if(run.source){
          const source=text('small',run.source,'ssx-region-source');
          source.title=run.source;
          identity.append(source);
        }
        const metrics=text('div','','ssx-region-metrics');
        metrics.append(text('strong',run.score,'ssx-region-score'));
        if(run.video){
          const proof=text('a','▶','ssx-region-proof');
          proof.setAttribute('aria-label',copy[4]);
          proof.title=copy[4];
          proof.href=run.video;proof.target='_blank';
          proof.rel='noopener noreferrer';proof.referrerPolicy='no-referrer';
          metrics.append(proof);
        }
        item.append(identity,metrics);
        ranking.append(item);
      }
      if(selected.runs.length)detail.append(ranking);
      else {
        const noRecords=text('p',copy[5],'ssx-region-empty ssx-region-empty-inline');
        noRecords.setAttribute('role','status');
        detail.append(noRecords);
      }
    }else detail.append(text('p',copy[5],'ssx-region-empty'));
    browser.replaceChildren(index,detail);
    applyRegionSearch();
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
      '<div class="alpine-heading"><div><h2 id="alpineModesTitle"></h2></div></div>'+
      '<div class="alpine-mode-grid" role="group" aria-label="Modalidades">'+
      '<button class="alpine-mode-card" type="button" data-alpine-group="race" aria-pressed="true"><strong data-alpine-i18n="race"></strong><span data-alpine-i18n="raceSub"></span></button>'+
      '<button class="alpine-mode-card" type="button" data-alpine-group="trick" aria-pressed="false"><strong data-alpine-i18n="trick"></strong><span data-alpine-i18n="trickSub"></span></button>'+
      '<button class="alpine-mode-card" type="button" data-alpine-group="survive" aria-pressed="false"><strong data-alpine-i18n="survive"></strong><span data-alpine-i18n="surviveSub"></span></button>'+
      '<button class="alpine-mode-card" type="button" data-alpine-group="riders" aria-pressed="false"><strong data-alpine-i18n="riders"></strong><span data-alpine-i18n="ridersSub"></span></button>'+
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
        const modeLabel=text('span','', 'alpine-results-mode');
        modeLabel.id='alpineModeLabel';
        const viewOptions=document.createElement('details');
        viewOptions.id='ssxViewOptions';
        viewOptions.className='ssx-view-options ssx-view-options-direct';
        viewOptions.open=true;
        const viewSummary=text('summary','Exibição');
        viewSummary.id='ssxViewLabel';
        const viewActions=text('div','','ssx-view-actions');
        const tableToggle=text('button','','alpine-small-action');
        tableToggle.id='alpineToggleTable';
        tableToggle.type='button';
        viewActions.append(tableToggle);
        viewOptions.append(viewSummary,viewActions);
        wrap.append(modeLabel,viewOptions);
        tableToggle.addEventListener('click',()=>{
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
        viewActions.append(positions);
        head.append(wrap);
      }
      const list=document.createElement('div');
      list.id='alpineMobileCards';
      list.className='alpine-mobile-cards';
      list.setAttribute('aria-live','polite');
      card.querySelector('.sheet-scroll')?.before(list);
      addRegionBrowser(card);
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
    buildPublicLayout(hero,toolbar,card,credits);
    mountSheetControls(card,toolbar);
    mountSheetModeFilter(card);
    mountResetControl(toolbar);

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
    if(search){search.addEventListener('input',()=>{
      scheduleCards();
      resetControlState();
    });}
    // The original source switcher rewrites the public hero copy during
    // rendering. Restore the approved presentation after its event handlers.
    document.querySelectorAll('[data-source]').forEach(button=>{
      button.addEventListener('click',()=>queueMicrotask(applyPublicCopy));
    });
    for(const name of ['category','region','track','topN']){
      $(name)?.addEventListener('change',()=>{
        state.visible=12;
        if(name==='region'){
          const select=$('region');
          const chosen=select?.selectedOptions?.[0];
          const matching=completeTrackCatalog().find(item=>
            chosen?.value&&normalizedRegionText(item.region)===normalizedRegionText(chosen.textContent));
          selectedRegion=matching?.region||'all';
          regionalSelection='';
          if(matching)openedRegions.add(matching.region);
        }
        if(name==='track'){
          const selected=$('track')?.selectedOptions?.[0];
          const match=selected?.value?completeTrackCatalog().find(item=>
            normalizedRegionText(item.track)===normalizedRegionText(selected.textContent)&&
            (selectedRegion==='all'||item.region===selectedRegion)):null;
          if(match){
            regionalSelection=match.key;
            openedRegions.add(match.region);
            syncTrackAddress();
          }
        }
        // The legacy data engine also rewrites the hero caption on filter changes.
        // Keep editorial copy stable while reusing its real filtering controls.
        applyPublicCopy();
        scheduleCards();
        resetControlState();
      });
    }
    $('langMenu')?.addEventListener('click',event=>{
      if(event.target.closest('[data-lang]'))setTimeout(updateCopy,0);
    });
    if(!observed && typeof MutationObserver!=='undefined'){
      // The fixed catalogue is source-independent, but the indexed rankings
      // and their rider/button nodes are source-dependent. Refresh them after
      // every original table redraw. Observe only direct row insert/removal,
      // never the new browse UI, to avoid a self-triggered render loop.
      new MutationObserver(records=>{
        if(!records.some(record=>record.type==='childList'))return;
        regionalCache=null;
        document.body.dataset.ssxTracksIndexed='pending';
        scheduleCards();
      }).observe(tbody,{childList:true});
      observed=true;
    }
    installCompleteTrackRendering();
    // Build one immutable catalogue and all five score indexes at first paint.
    completeTrackCatalog();
    indexedTracks('board');
    const params=new URL(location.href).searchParams;
    const startMode=params.get('mode');
    if(['board','wings','trick','survive','special'].includes(startMode))state.mode=startMode;
    if(startMode==='wings')state.lastRace='wings';
    if(startMode==='special')state.lastSurvive='special';
    restoreSharedTrack();
    updateCopy();
    selectMode(state.mode);
    // The single real interface becomes visible once its canonical controls exist.
    document.documentElement.dataset.ssxBoot = 'ready';
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
    syncSheetModeFilter(activeGroup,copy);
    const names={board:'Race It! · Board',wings:'Race It! · Wingsuit',trick:'Trick It!',survive:'Survive It! · '+copy.standard,special:'Survive It! · '+copy.special,all:copy.full};
    const label=$('alpineModeLabel');
    if(label)label.textContent=names[state.mode]||copy.results;
    const toggle=$('alpineToggleTable');
    if(toggle)toggle.textContent=state.fullTable?copy.back:copy.full;
    if($('ssxRegionBrowser'))scheduleCards();
    resetControlState();
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
      renderRegionBrowser();
    });
  }
  function renderCards(){
    const root=$('alpineMobileCards'),tbody=$('tbody');
    const contextual=Boolean($('track')?.value||$('search')?.value?.trim());
    document.body.dataset.ssxMobileView=state.fullTable?'table':
      contextual||state.allPositions?'cards':'browse';
    if(!root||!tbody||!tags[state.mode])return;
    const copy=t(), frag=document.createDocumentFragment();
    const showPositions=contextual||state.allPositions;
    let currentTrack='';
    let currentRegion='';
    let currentMountain='';
    let count=0;
    let hasMore=false;
    const seenTracks=new Set();
    const rows=tbody.querySelectorAll('tr.rank-row');
    for(const row of rows){
      const mark=row.querySelector('.track-cell');
      if(mark){
        currentTrack=mark.querySelector('.track-name')?.textContent?.trim()||currentTrack;
        const first=mark.querySelector('.track-meta')?.childNodes?.[0]?.textContent?.trim()||'';
        const parts=first.split(' · ');
        currentRegion=parts[0]||'';
        currentMountain=parts.slice(1).join(' · ');
      }
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
      const item=text('article','','alpine-card alpine-card-visual');
      artForRegion(item,currentRegion||'SSX 2012');
      const top=text('div','','alpine-card-top');
      top.append(text('span',trackName),
        text('span',row.querySelector('.pos-label')?.textContent||'',''));
      item.append(top);
      if(currentRegion){
        const location=text('div',(regionIcons[currentRegion]||'🏂')+' '+currentRegion+
          (currentMountain?' · '+currentMountain:''),'ssx-card-location');
        item.append(location);
      }
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
