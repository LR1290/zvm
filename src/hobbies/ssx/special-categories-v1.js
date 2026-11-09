/* SSX 2012 — Archived special categories, client-only and read-only.
 * Data authority: original hash-pinned v36 Google Sheets export (2026-08-22).
 * IMPORTANT: No live refresh, Ozmonet name substitutions, or synthetic scores.
 * G and SNG are original same-document lexical arrays, not remote providers.
 */
(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const body=document.body;
  if(!body?.classList.contains('ssx-alpine-v37')||$('ssxSpecialArchive'))return;
  const records=typeof G!=='undefined'&&Array.isArray(G)?G:null;
  const surviveExtra=typeof SNG!=='undefined'&&Array.isArray(SNG)?SNG:null;
  const tracks=typeof TRACKS!=='undefined'&&Array.isArray(TRACKS)?TRACKS:null;
  const meta=typeof META!=='undefined'&&META&&typeof META==='object'?META:null;
  const sourcePanel=document.querySelector('.sheet-card');
  if(!records||!surviveExtra||!tracks||!meta||!sourcePanel)return;

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
  const lang=()=>{const code=String(document.documentElement.lang||'pt').slice(0,2).toLowerCase();return dictionaries[code]?code:'pt';};
  const copy=()=>dictionaries[lang()];
  const el=(tag,content='',className='')=>{
    const node=document.createElement(tag);
    if(className)node.className=className;
    node.textContent=content;
    return node;
  };
  const panel=el('section','','ssx-special-archive');
  panel.id='ssxSpecialArchive';
  panel.dataset.snapshot=captured;
  panel.dataset.source='google-sheets-archive';
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
  const trackField=el('label','','ssx-special-field');
  levelField.append(el('span'),levelSelect);
  modeField.append(el('span'),modeSelect);
  trackField.append(el('span'),trackSelect);
  filters.append(levelField,modeField,trackField);
  const totals=el('p','','ssx-special-totals');
  totals.id='ssxSpecialTotals';
  const scope=el('p','','ssx-special-scope');
  const rows=el('div','','ssx-special-results');
  rows.id='ssxSpecialResults';
  rows.setAttribute('aria-live','polite');
  panel.append(title,info,tabs,filters,totals,rows,scope);
  const anchor=$('alpineArtCredits');
  if(anchor)anchor.before(panel);
  else sourcePanel.after(panel);
  const direct=$('ssxDirectActions');
  const navLink=el('a','','ssx-direct-action ssx-special-nav-link');
  navLink.href='#ssxSpecialArchive';
  if(direct)direct.append(navLink);

  let group='level',level='Level 1',mode=0,trackId=null;
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
  function refreshSelects(keepMode=false,keepTrack=false){
    const entries=available();
    const c=copy();
    levelField.hidden=group!=='level';
    levelSelect.value=putOptions(levelSelect,VERIFIED_GROUPS.level.map(name=>({value:name,label:name})),level);
    const allowed=[...new Set(entries.map(item=>item.mode))].sort((a,b)=>a-b);
    const next=keepMode&&allowed.includes(mode)?mode:allowed[0];
    mode=Number(putOptions(modeSelect,allowed.map(value=>({value,label:c.modes[value]||String(value)})),next));
    const ids=[...new Set(entries.filter(item=>item.mode===mode).map(item=>item.trackId))].sort((a,b)=>a-b);
    const picked=keepTrack&&ids.includes(trackId)?trackId:ids[0];
    trackId=Number(putOptions(trackSelect,ids.map(id=>{
      const item=tracks[id];
      return {value:id,label:item[2]+(item[0]?' · '+item[0]:'')};
    }),picked));
  }
  function renderRows(){
    const c=copy();
    const filtered=available().filter(row=>row.mode===mode&&row.trackId===trackId);
    rows.replaceChildren();
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
      identity.append(el('strong',row.rider),el('small',row.platform||c.platform));
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
    trackId=null;
    render();
    tabs.querySelector('[data-ssx-special-group="'+group+'"]')?.focus({preventScroll:true});
  });
  levelSelect.addEventListener('change',()=>{
    level=levelSelect.value;
    refreshSelects(false,false);
    renderRows();
  });
  modeSelect.addEventListener('change',()=>{
    mode=Number(modeSelect.value);
    refreshSelects(true,false);
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
})();
