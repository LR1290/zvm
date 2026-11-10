/* SSX 2012 — Archived special categories, client-only and read-only.
 * Data authority: original hash-pinned v36 Google Sheets export (2026-08-22).
 * IMPORTANT: No live refresh, Ozmonet name substitutions, or synthetic scores.
 * G and SNG are original same-document lexical arrays, not remote providers.
 */
(()=>{
  'use strict';
  function mount(){
  const $=id=>document.getElementById(id);
  const body=document.body;
  if(!body?.classList.contains('ssx-alpine-v37')||$('ssxSpecialArchive'))return;
  const records=typeof G!=='undefined'&&Array.isArray(G)?G:null;
  const surviveExtra=typeof SNG!=='undefined'&&Array.isArray(SNG)?SNG:null;
  const tracks=typeof TRACKS!=='undefined'&&Array.isArray(TRACKS)?TRACKS:null;
  const meta=typeof META!=='undefined'&&META&&typeof META==='object'?META:null;
  const sourcePanel=document.querySelector('.sheet-card');
  const leaderCore=typeof SSXSpecialLeaders==='object'?SSXSpecialLeaders:null;
  if(!records||!surviveExtra||!tracks||!meta||!sourcePanel||!leaderCore)return;

  const VERIFIED_GROUPS=Object.freeze({
    level:['Level 1','Level 3','Level 6','Level 7','Level 8','Level 9'],
    android:['Android'],dev:['DEV Tracks'],boost:['No Boost'],challenge:['Survive Special']
  });
  const allowedModes=new Set([0,1,2,3,5]);
  // Validate the public August 2026 export rather than silently losing rows.
  const ready=records.length+surviveExtra.length===Number(meta.googleRecords)
    &&tracks.length===Number(meta.tracks)
    &&/^\d{4}-\d{2}-\d{2}$/.test(String(meta.snapshot||''));
  if(!ready)return;
  const captured=String(meta.snapshot);
  const entries=[];
  function ingest(array,isSpecial){
    for(const original of array){
      if(!Array.isArray(original)||original.length<11)continue;
      const category=isSpecial?'Survive Special':String(original[0]||'');
      if(!isSpecial&&!['No Boost','Level 1','Level 3','Level 6','Level 7','Level 8','Level 9','Android','DEV Tracks'].includes(category))continue;
      const id=Number(original[1]),place=Number(original[2]),mode=Number(original[3]);
      if(!Number.isInteger(id)||id<0||id>=tracks.length||!Number.isInteger(place)||place<1||!allowedModes.has(mode))continue;
      if(isSpecial&&mode!==5)continue;
      const track=tracks[id];
      if(!Array.isArray(track)||typeof track[2]!=='string')continue;
      const name=String(original[4]??'').trim();
      const score=String(original[5]??'').trim();
      if(!name||!score)continue;
      let proof='';
      const link=original[8];
      if(typeof link==='string'&&link){
        try{
          const u=new URL(link);
          if(u.protocol==='https:'&&['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(u.hostname))proof=u.href;
        }catch(_){}
      }
      entries.push(Object.freeze({
        category,trackId:id,region:String(track[0]||''),mountain:String(track[1]||''),
        track:String(track[2]),position:place,mode,rider:name,score,
        platform:String(original[7]||''),proof,sheet:String(original[9]||''),
        cell:String(original[10]||'')
      }));
    }
  }
  ingest(records,false);
  ingest(surviveExtra,true);
  const index=new Map();
  for(const entry of entries){
    if(!index.has(entry.category))index.set(entry.category,[]);
    index.get(entry.category).push(entry);
  }
  for(const set of index.values())set.sort((a,b)=>a.trackId-b.trackId||a.mode-b.mode||a.position-b.position||a.cell.localeCompare(b.cell));
  if(!entries.length)return;

  const dictionaries={
    pt:{title:'Desafios especiais · arquivo histórico',note:'Dados históricos do Google Sheets de {date}. Não representam uma atualização da planilha atual. Nomes de riders ainda aguardam conferência por ID na Ozmonet.',level:'Níveis baixos',android:'Android',dev:'DEV / Testes',boost:'Sem boost',challenge:'Survive sem Gear/Wings/Rewinds',category:'Categoria',variant:'Nível',mode:'Modalidade',track:'Pista',results:'recordes no arquivo',evidence:'YouTube',missing:'Sem vídeo cadastrado nesta captura',platform:'Plataforma não informada',source:'Referência original',empty:'Não há recordes nesta combinação.',go:'Categorias extras',scope:'Esta seção não modifica os líderes e o Top 3 do jogo principal.',modes:['Board','Wingsuit','Trick It!','Survive It!','','Survive sem Gear/Wings/Rewinds']},
    en:{title:'Special challenges · historical archive',note:'Archived Google Sheets data from {date}. Not a live update of the current sheet. Rider names still require Ozmonet verification by exact ID.',level:'Low levels',android:'Android',dev:'DEV / Test tracks',boost:'No Boost',challenge:'Survive No Gear/Wings/Rewinds',category:'Category',variant:'Level',mode:'Mode',track:'Track',results:'archived records',evidence:'YouTube',missing:'No video recorded in this snapshot',platform:'Platform not specified',source:'Original reference',empty:'No records for this selection.',go:'Extra categories',scope:'This section does not alter main leaderboards or Top 3.',modes:['Board','Wingsuit','Trick It!','Survive It!','','Survive No Gear/Wings/Rewinds']},
    de:{title:'Spezialherausforderungen · Archiv',note:'Archivdaten aus Google Sheets vom {date}, nicht aktuell. Fahrernamen benötigen ID-Verifizierung über Ozmonet.',level:'Niedrige Level',android:'Android',dev:'DEV / Teststrecken',boost:'Ohne Boost',challenge:'Survive ohne Gear/Wings/Rewinds',category:'Kategorie',variant:'Level',mode:'Modus',track:'Strecke',results:'archivierte Rekorde',evidence:'YouTube',missing:'Kein Video im Archiv',platform:'Plattform nicht angegeben',source:'Originalreferenz',empty:'Keine Rekorde.',go:'Spezialkategorien',scope:'Kein Einfluss auf Hauptranglisten und Top 3.',modes:['Board','Wingsuit','Trick It!','Survive It!','','Survive ohne Gear/Wings/Rewinds']},
    es:{title:'Desafíos especiales · archivo histórico',note:'Datos de Google Sheets del {date}; no son datos actuales. Los nombres requieren verificación por ID en Ozmonet.',level:'Niveles bajos',android:'Android',dev:'DEV / Pruebas',boost:'Sin boost',challenge:'Survive sin Gear/Wings/Rewinds',category:'Categoría',variant:'Nivel',mode:'Modalidad',track:'Pista',results:'récords archivados',evidence:'YouTube',missing:'Sin vídeo en esta captura',platform:'Plataforma no indicada',source:'Referencia original',empty:'No hay récords.',go:'Categorías extra',scope:'No modifica las clasificaciones principales.',modes:['Board','Wingsuit','Trick It!','Survive It!','','Survive sin Gear/Wings/Rewinds']},
    nl:{title:'Speciale uitdagingen · historisch archief',note:'Google Sheets-archief van {date}, geen actuele gegevens. Namen vereisen verificatie via Ozmonet-ID.',level:'Lage levels',android:'Android',dev:'DEV / Testbanen',boost:'Geen boost',challenge:'Survive zonder Gear/Wings/Rewinds',category:'Categorie',variant:'Level',mode:'Speltype',track:'Baan',results:'archiefrecords',evidence:'YouTube',missing:'Geen video in dit archief',platform:'Platform onbekend',source:'Oorspronkelijke verwijzing',empty:'Geen records gevonden.',go:'Extra categorieën',scope:'Hoofdranglijsten en Top 3 blijven ongewijzigd.',modes:['Board','Wingsuit','Trick It!','Survive It!','','Survive zonder Gear/Wings/Rewinds']},
    fr:{title:'Défis spéciaux · archive historique',note:'Données Google Sheets du {date}, pas une mise à jour actuelle. Noms à vérifier par ID sur Ozmonet.',level:'Bas niveaux',android:'Android',dev:'DEV / Tests',boost:'Sans boost',challenge:'Survive sans Gear/Wings/Rewinds',category:'Catégorie',variant:'Niveau',mode:'Mode',track:'Piste',results:'records archivés',evidence:'YouTube',missing:'Aucune vidéo dans cette archive',platform:'Plateforme non précisée',source:'Référence originale',empty:'Aucun record.',go:'Catégories supplémentaires',scope:'Les classements principaux et Top 3 restent inchangés.',modes:['Board','Wingsuit','Trick It!','Survive It!','','Survive sans Gear/Wings/Rewinds']}
  };

  // This is an archived, provisional leaderboard based on exact spellings in
  // the old sheet. A matching Ozmonet in-game player ID is NOT supplied here.
  const leaderboardCopy={
    pt:{records:'Recordes da pista',leaders:'Líderes e Top 3',platform:'Plataforma',title:'🏆 Top 3 histórico · provisório',method:'Mais primeiros lugares em pistas diferentes, por categoria, modalidade e plataforma. Empates por ordem alfabética.',unverified:'Apelidos agrupados pela grafia exata da planilha; identidade ainda não conciliada por ID Ozmonet.',wins:'pistas lideradas',proofs:'vídeos cadastrados',first:'Primeiros lugares',conflicts:'Pistas com #1 conflitante',missingFirst:'Pistas sem #1 registrado',duplicate:'Linhas #1 repetidas',noLeader:'Não há primeiro lugar inequívoco nesta categoria.',allRiders:'Todos os líderes',audit:'Auditoria da origem',claims:'Reivindicações originais'},
    en:{records:'Track records',leaders:'Leaders & Top 3',platform:'Platform',title:'🏆 Historical Top 3 · provisional',method:'Most first-place finishes on different tracks within this category, mode and platform. Ties alphabetical.',unverified:'Nicknames are grouped by exact sheet spelling; player IDs have not yet been reconciled with Ozmonet.',wins:'tracks led',proofs:'video proofs',first:'First places',conflicts:'Tracks with conflicting #1',missingFirst:'Tracks without a recorded #1',duplicate:'Repeated #1 rows',noLeader:'No unambiguous first place in this category.',allRiders:'All leaders',audit:'Source audit',claims:'Original claims'},
    de:{records:'Streckenrekorde',leaders:'Sieger & Top 3',platform:'Plattform',title:'🏆 Historische Top 3 · vorläufig',method:'Meiste erste Plätze auf verschiedenen Strecken je Kategorie, Modus und Plattform. Gleichstände alphabetisch.',unverified:'Namen werden nach exakter Schreibweise gruppiert; IDs sind noch nicht mit Ozmonet abgeglichen.',wins:'Streckensiege',proofs:'Videobelege',first:'Erste Plätze',conflicts:'Strecken mit widersprüchlichem #1',missingFirst:'Strecken ohne #1',duplicate:'Doppelte #1-Zeilen',noLeader:'Kein eindeutiger erster Platz.',allRiders:'Alle Sieger',audit:'Quellenprüfung',claims:'Originaleinträge'},
    es:{records:'Récords de pista',leaders:'Líderes y Top 3',platform:'Plataforma',title:'🏆 Top 3 histórico · provisional',method:'Más primeros puestos en pistas distintas por categoría, modalidad y plataforma. Empates alfabéticos.',unverified:'Apodos agrupados por grafía exacta de la hoja; IDs aún sin verificar en Ozmonet.',wins:'pistas lideradas',proofs:'pruebas en vídeo',first:'Primeros puestos',conflicts:'Pistas con #1 contradictorio',missingFirst:'Pistas sin #1',duplicate:'Filas #1 duplicadas',noLeader:'No hay primer puesto inequívoco.',allRiders:'Todos los líderes',audit:'Auditoría de fuente',claims:'Registros originales'},
    nl:{records:'Baanrecords',leaders:'Leiders en Top 3',platform:'Platform',title:'🏆 Historische Top 3 · voorlopig',method:'Meeste eerste plaatsen op verschillende banen per categorie, modus en platform. Gelijke stand alfabetisch.',unverified:'Namen gegroepeerd op exacte schrijfwijze; ID-controle via Ozmonet ontbreekt nog.',wins:'banen geleid',proofs:'videobewijzen',first:'Eerste plaatsen',conflicts:'Banen met tegenstrijdige #1',missingFirst:'Banen zonder #1',duplicate:'Dubbele #1-rijen',noLeader:'Geen ondubbelzinnige eerste plaats.',allRiders:'Alle leiders',audit:'Broncontrole',claims:'Oorspronkelijke claims'},
    fr:{records:'Records de piste',leaders:'Leaders et Top 3',platform:'Plateforme',title:'🏆 Top 3 historique · provisoire',method:'Plus de premières places sur des pistes différentes par catégorie, mode et plateforme. Ex æquo alphabétiques.',unverified:'Noms regroupés selon la graphie exacte; identités non vérifiées par ID Ozmonet.',wins:'pistes en tête',proofs:'preuves vidéo',first:'Premières places',conflicts:'Pistes avec #1 contradictoire',missingFirst:'Pistes sans #1',duplicate:'Lignes #1 répétées',noLeader:'Aucune première place sans ambiguïté.',allRiders:'Tous les leaders',audit:'Audit des sources',claims:'Déclarations originales'}
  };

  const lang=()=>{const code=String(document.documentElement.lang||'pt').slice(0,2).toLowerCase();return dictionaries[code]?code:'pt';};
  const copy=()=>dictionaries[lang()];
  const el=(tag,content='',className='')=>{
    const node=document.createElement(tag);
    if(className)node.className=className;
    node.textContent=content;
    return node;
  };
  // Original v36's verified rider->flag assets and cached Blob URLs are the
  // only allowed source. Never infer nationality from gamertags or platforms.
  function archiveFlagForRider(name){
    if(typeof prefs==='undefined'||!prefs.showFlags
      ||typeof RIDER_FLAGS==='undefined'||typeof FLAG_ASSETS==='undefined'
      ||typeof FLAG_CODES==='undefined'||typeof riderKey!=='function'
      ||typeof flagUrl!=='function')return null;
    const asset=RIDER_FLAGS[riderKey(name)];
    if(!asset||!Object.prototype.hasOwnProperty.call(FLAG_ASSETS,asset))return null;
    const code=String(FLAG_CODES[asset]||'').toUpperCase();
    if(!/^[A-Z]{2}(?:-[A-Z]{2,3})?$/.test(code))return null;
    const url=flagUrl(asset);
    if(!url)return null;
    // Keep the archive's flag independent from legacy v36 mobile .rider-flag
    // visibility rules; the source asset and attribution remain unchanged.
    const image=el('img','','ssx-special-rider-flag');
    image.src=url;
    image.alt=code;
    image.title=code;
    image.decoding='async';
    // Archived cards are rerendered on every filter change. Lazy loading
    // postponed Blob image decoding in mobile/scrollable results, leaving flags
    // apparently absent even though the src/alt attributes existed.
    image.loading='eager';
    return image;
  }
  function archiveRiderLabel(name,tag='span'){
    const label=el(tag,'','ssx-special-rider-label');
    const flag=archiveFlagForRider(name);
    if(flag)label.append(flag);
    label.append(el('span',name,'ssx-special-rider-name'));
    return label;
  }
  const panel=el('section','','ssx-special-archive');
  panel.id='ssxSpecialArchive';
  panel.dataset.snapshot=captured;
  // Never use data-source here: the original v36 global source handler
  // catches clicks from descendants and switches the main records engine.
  panel.dataset.ssxArchiveSource='google-sheets-archive';
  panel.dataset.records=String(entries.length);
  const title=el('h2');
  title.id='ssxSpecialTitle';
  const info=el('p','','ssx-special-note');
  info.id='ssxSpecialNote';
  const tabs=el('nav','','ssx-special-tabs');
  tabs.id='ssxSpecialTabs';
  const filters=el('div','','ssx-special-filters');
  const levelSelect=el('select','','ssx-special-select');
  levelSelect.id='ssxSpecialLevel';
  const modeSelect=el('select','','ssx-special-select');
  modeSelect.id='ssxSpecialMode';
  const trackSelect=el('select','','ssx-special-select');
  trackSelect.id='ssxSpecialTrack';
  const levelField=el('label','','ssx-special-field');
  const modeField=el('label','','ssx-special-field');
  const platformSelect=el('select','','ssx-special-select');
  platformSelect.id='ssxSpecialPlatform';
  const platformField=el('label','','ssx-special-field');
  const trackField=el('label','','ssx-special-field');
  levelField.append(el('span'),levelSelect);
  modeField.append(el('span'),modeSelect);
  platformField.append(el('span'),platformSelect);
  trackField.append(el('span'),trackSelect);
  filters.append(levelField,modeField,platformField,trackField);
  const views=el('div','','ssx-special-views');
  views.id='ssxSpecialViews';
  for(const value of ['records','leaders']){
    const button=el('button','','ssx-special-view-btn');
    button.type='button';
    button.dataset.ssxSpecialView=value;
    button.setAttribute('aria-pressed','false');
    views.append(button);
  }
  const podium=el('section','','ssx-special-podium');
  podium.id='ssxSpecialPodium';
  podium.hidden=true;
  const audit=el('div','','ssx-special-ranking-audit');
  audit.id='ssxSpecialRankingAudit';
  audit.hidden=true;
  const totals=el('p','','ssx-special-totals');
  totals.id='ssxSpecialTotals';
  const scope=el('p','','ssx-special-scope');
  const rows=el('div','','ssx-special-results');
  rows.id='ssxSpecialResults';
  rows.setAttribute('aria-live','polite');
  panel.append(title,info,tabs,filters,views,podium,audit,totals,rows,scope);
  // Credits are inside a collapsed <details>. Inserting the archive before
  // alpineArtCredits accidentally nested 2,205 records inside that hidden
  // disclosure, outside the document's scrollable height on mobile/desktop.
  // Mount as a sibling after the credits disclosure instead.
  const credits=$('ssxCredits');
  if(credits)credits.after(panel);
  else sourcePanel.after(panel);
  const direct=$('ssxDirectActions');
  const navLink=el('a','','ssx-direct-action ssx-special-nav-link');
  navLink.href='#ssxSpecialArchive';
  if(direct)direct.append(navLink);

  let group='level',level='Level 1',mode=0,platform='PS3',trackId=null,view='records',selectedRider='';
  function available(){
    const categories=VERIFIED_GROUPS[group]||[];
    const selection=group==='level'?[level]:categories;
    return selection.flatMap(name=>index.get(name)||[]);
  }
  function putOptions(select,options,current){
    select.replaceChildren();
    for(const opt of options){
      const option=el('option',opt.label);
      option.value=String(opt.value);
      select.append(option);
    }
    select.value=String(current);
    if(select.selectedIndex<0&&select.options.length)select.selectedIndex=0;
    return select.value;
  }
  function refreshSelects(keepMode=false,keepTrack=false,keepPlatform=true){
    const records=available();
    const c=copy();
    levelField.hidden=group!=='level';
    levelSelect.value=putOptions(levelSelect,VERIFIED_GROUPS.level.map(name=>({value:name,label:name})),level);
    const allowed=[...new Set(records.map(item=>item.mode))].sort((a,b)=>a-b);
    const next=keepMode&&allowed.includes(mode)?mode:allowed[0];
    mode=Number(putOptions(modeSelect,allowed.map(value=>({value,label:c.modes[value]||String(value)})),next));
    const inMode=records.filter(item=>item.mode===mode);
    const platforms=[...new Set(inMode.map(item=>leaderCore.platformKey(item.platform)))].sort();
    const nextPlatform=keepPlatform&&platforms.includes(platform)?platform:platforms[0]||'__unspecified__';
    platform=putOptions(platformSelect,platforms.map(value=>({
      value,label:value==='__unspecified__'?c.platform:value
    })),nextPlatform);
    const ids=[...new Set(inMode.filter(item=>leaderCore.platformKey(item.platform)===platform)
      .map(item=>item.trackId))].sort((a,b)=>a-b);
    const picked=keepTrack&&ids.includes(trackId)?trackId:ids[0];
    trackId=Number(putOptions(trackSelect,ids.map(id=>{
      const item=tracks[id];
      return {value:id,label:item[2]+(item[0]?' · '+item[0]:'')};
    }),picked));
  }

  function sourceLink(row,c){
    const proof=el('div','','ssx-special-evidence');
    if(row.proof){
      const link=el('a','YouTube','ssx-youtube-proof ssx-special-youtube');
      link.href=row.proof;
      link.target='_blank';
      link.rel='noopener noreferrer';
      link.referrerPolicy='no-referrer';
      link.setAttribute('aria-label',c.evidence+' · '+row.rider+' · '+row.track);
      const icon=el('span','','ssx-youtube-icon');
      icon.setAttribute('aria-hidden','true');
      link.prepend(icon);
      proof.append(link);
    }else proof.append(el('span',c.missing,'ssx-special-no-video'));
    return proof;
  }
  function renderHistoricalLeaders(){
    const c=copy(),l=leaderboardCopy[lang()];
    const category=group==='level'?level:VERIFIED_GROUPS[group][0];
    const report=leaderCore.calculate(available(),category,mode,platform);
    podium.hidden=false;
    audit.hidden=false;
    trackField.hidden=true;
    rows.replaceChildren();
    rows.dataset.visibleRecords=String(report.leaderCount);
    rows.dataset.ssxArchiveLeaders=String(report.leaderCount);
    rows.dataset.ssxArchiveConflicts=String(report.collisions.length);
    podium.dataset.ssxCategory=category;
    podium.dataset.ssxMode=String(mode);
    podium.dataset.ssxPlatform=platform;
    podium.dataset.ssxPodiumCount=String(report.podium.length);
    const heading=el('header','','ssx-special-podium-head');
    heading.append(el('h3',l.title),el('p',l.method));
    const medalGrid=el('div','','ssx-special-medal-grid');
    for(const [i,holder] of report.podium.entries()){
      const card=el('article','','ssx-special-medal-card');
      card.dataset.ssxRank=String(i+1);
      card.dataset.ssxName=holder.name;
      card.dataset.ssxWins=String(holder.wins);
      card.dataset.ssxProofs=String(holder.proofs);
      const medal=el('span',['🥇','🥈','🥉'][i],'ssx-special-medal');
      medal.setAttribute('aria-hidden','true');
      const riderButton=el('button','','ssx-special-medal-rider');
      riderButton.append(archiveRiderLabel(holder.name));
      riderButton.type='button';
      riderButton.dataset.ssxPodiumRider=holder.name;
      riderButton.setAttribute('aria-pressed',String(selectedRider===holder.name));
      riderButton.setAttribute('aria-label',holder.name+' · '+holder.wins+' '+l.wins);
      card.append(medal,riderButton,el('strong',holder.wins+' '+l.wins,'ssx-special-medal-count'));
      card.append(el('small',holder.proofs+' '+l.proofs,'ssx-special-medal-proofs'));
      medalGrid.append(card);
    }
    if(!report.podium.length)medalGrid.append(el('p',l.noLeader,'ssx-special-empty'));
    podium.replaceChildren(heading,medalGrid,el('p',l.unverified,'ssx-special-identity-warning'));
    const entries=selectedRider?report.leaders.filter(row=>row.rider===selectedRider):report.leaders;
    totals.textContent=entries.length+' / '+report.trackCount+' '+l.first
      +' · '+category+' · '+(c.modes[mode]||mode)+' · '+(platform==='__unspecified__'?c.platform:platform);
    const status=el('p',l.audit+': '+report.collisions.length+' '+l.conflicts
      +' · '+report.withoutFirst.length+' '+l.missingFirst
      +' · '+report.duplicateRows+' '+l.duplicate,'ssx-special-audit-text');
    audit.replaceChildren(status);
    if(selectedRider){
      const clear=el('button','↩ '+l.allRiders,'ssx-special-clear-rider');
      clear.type='button';
      clear.dataset.ssxClearPodiumRider='true';
      audit.append(clear);
    }
    if(report.collisions.length){
      const details=el('details','','ssx-special-conflicts');
      details.append(el('summary',l.conflicts+' ('+report.collisions.length+')'));
      for(const conflict of report.collisions){
        const line=el('p',conflict.track+': '+conflict.claims.map(item=>
          item.rider+' ('+item.score+')').join(' / '),'ssx-special-conflict-row');
        details.append(line);
      }
      audit.append(details);
    }
    const list=document.createDocumentFragment();
    for(const row of entries){
      const card=el('article','','ssx-special-record ssx-special-leader');
      card.dataset.ssxLeaderTrack=String(row.trackId);
      card.dataset.ssxLeaderRider=row.rider;
      card.dataset.ssxLeaderPosition=String(row.position);
      card.dataset.ssxLeaderPlatform=leaderCore.platformKey(row.platform);
      const rank=el('span','#1','ssx-special-rank');
      const identity=el('div','','ssx-special-identity');
      identity.append(el('strong',row.track),el('small',(row.region||'')+' · '+(row.mountain||'')));
      const score=el('strong',row.score,'ssx-special-score');
      const rider=el('div','','ssx-special-leader-rider');
      rider.append(archiveRiderLabel(row.rider,'strong'),el('small',row.platform||c.platform));
      const reference=el('small',c.source+': '+[row.sheet,row.cell].filter(Boolean).join(' · '),'ssx-special-ref');
      card.append(rank,identity,score,rider,sourceLink(row,c),reference);
      list.append(card);
    }
    if(!entries.length)list.append(el('p',l.noLeader,'ssx-special-empty'));
    rows.append(list);
  }
  function renderViewControls(){
    const l=leaderboardCopy[lang()];
    for(const button of views.querySelectorAll('[data-ssx-special-view]')){
      const value=button.dataset.ssxSpecialView;
      button.textContent=l[value];
      button.setAttribute('aria-pressed',String(view===value));
    }
    trackField.hidden=view==='leaders';
  }

  function renderRows(){
    renderViewControls();
    if(view==='leaders')return renderHistoricalLeaders();
    podium.hidden=true;
    audit.hidden=true;
    const c=copy();
    const filtered=available().filter(row=>row.mode===mode
      &&leaderCore.platformKey(row.platform)===platform&&row.trackId===trackId);
    rows.replaceChildren();
    rows.dataset.ssxArchiveLeaders='';
    rows.dataset.ssxArchiveConflicts='';
    rows.dataset.visibleRecords=String(filtered.length);
    totals.textContent=filtered.length+' / '+available().length+' '+c.results+' · '+(tracks[trackId]?.[2]||'');
    if(!filtered.length){rows.append(el('p',c.empty,'ssx-special-empty'));return;}
    const frag=document.createDocumentFragment();
    for(const row of filtered){
      const card=el('article','','ssx-special-record');
      card.dataset.archivedPosition=String(row.position);
      card.dataset.archivedMode=String(row.mode);
      card.dataset.archivedTrack=String(row.trackId);
      const rank=el('span','#'+row.position,'ssx-special-rank');
      const identity=el('div','','ssx-special-identity');
      identity.append(archiveRiderLabel(row.rider,'strong'),el('small',row.platform||c.platform));
      const result=el('strong',row.score,'ssx-special-score');
      const reference=el('small',c.source+': '+[row.sheet,row.cell].filter(Boolean).join(' · '),'ssx-special-ref');
      const evidence=el('div','','ssx-special-evidence');
      if(row.proof){
        const link=el('a','YouTube','ssx-youtube-proof ssx-special-youtube');
        link.href=row.proof;
        link.target='_blank';
        link.rel='noopener noreferrer';
        link.referrerPolicy='no-referrer';
        link.setAttribute('aria-label',c.evidence+' · '+row.rider+' · '+row.track);
        link.prepend(el('span','','ssx-youtube-icon'));
        evidence.append(link);
      }else evidence.append(el('span',c.missing,'ssx-special-no-video'));
      card.append(rank,identity,result,evidence,reference);
      frag.append(card);
    }
    rows.append(frag);
  }
  function render(){
    const c=copy();
    title.textContent='🗂️ '+c.title;
    info.textContent=c.note.replace('{date}',captured);
    scope.textContent='ⓘ '+c.scope;
    navLink.textContent='🎮 '+c.go;
    levelField.querySelector('span').textContent=c.variant;
    modeField.querySelector('span').textContent=c.mode;
    platformField.querySelector('span').textContent=leaderboardCopy[lang()].platform;
    trackField.querySelector('span').textContent=c.track;
    tabs.replaceChildren();
    for(const [key,categories] of Object.entries(VERIFIED_GROUPS)){
      const count=categories.reduce((sum,name)=>sum+(index.get(name)?.length||0),0);
      if(!count)continue;
      const tab=el('button',c[key]+' · '+count,'ssx-special-tab');
      tab.type='button';
      tab.dataset.ssxSpecialGroup=key;
      tab.setAttribute('aria-pressed',String(key===group));
      tabs.append(tab);
    }
    refreshSelects(true,true);
    renderRows();
  }
  tabs.addEventListener('click',event=>{
    const button=event.target.closest('[data-ssx-special-group]');
    if(!button)return;
    group=button.dataset.ssxSpecialGroup;
    if(!VERIFIED_GROUPS[group])return;
    mode=0;
    platform='PS3';
    trackId=null;
    selectedRider='';
    render();
    tabs.querySelector('[data-ssx-special-group="'+group+'"]')?.focus({preventScroll:true});
  });
  levelSelect.addEventListener('change',()=>{
    level=levelSelect.value;
    selectedRider='';
    refreshSelects(false,false,false);
    renderRows();
  });
  modeSelect.addEventListener('change',()=>{
    mode=Number(modeSelect.value);
    selectedRider='';
    refreshSelects(true,false,false);
    renderRows();
  });
  platformSelect.addEventListener('change',()=>{
    platform=platformSelect.value;
    selectedRider='';
    refreshSelects(true,false,true);
    renderRows();
  });
  views.addEventListener('click',event=>{
    const button=event.target.closest('[data-ssx-special-view]');
    if(!button)return;
    const target=button.dataset.ssxSpecialView;
    if(target!=='records'&&target!=='leaders')return;
    view=target;
    selectedRider='';
    renderRows();
    views.querySelector('[data-ssx-special-view="'+target+'"]')?.focus({preventScroll:true});
  });
  podium.addEventListener('click',event=>{
    const button=event.target.closest('[data-ssx-podium-rider]');
    if(!button)return;
    selectedRider=selectedRider===button.dataset.ssxPodiumRider?'':button.dataset.ssxPodiumRider;
    renderRows();
  });
  audit.addEventListener('click',event=>{
    if(!event.target.closest('[data-ssx-clear-podium-rider]'))return;
    selectedRider='';
    renderRows();
  });
  trackSelect.addEventListener('change',()=>{trackId=Number(trackSelect.value);renderRows();});
  // The parent page already owns language selection; update the archive without
  // rerendering and resetting user filters or ever modifying its record data.
  let oldLanguage=lang();
  const observer=new MutationObserver(()=>{
    if(lang()!==oldLanguage){oldLanguage=lang();render();}
  });
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  document.getElementById('langMenu')?.addEventListener('click',()=>{
    queueMicrotask(()=>{
      if(lang()!==oldLanguage){oldLanguage=lang();render();}
    });
  });
  render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();
