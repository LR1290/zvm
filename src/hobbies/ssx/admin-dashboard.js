'use strict';
// Standalone administrator dashboard: no scripts or ZVM commercial credentials.
const { publicBridgeEndpoint } = require('./live-endpoint');
const { BASE } = require('./admin-auth');
const { CAPTURED,SHEETS,SHEET_ID,locate }=require('./sheet-r111');
const HEADERS=Object.freeze({
  'Cache-Control':'no-store, private',
  'X-Content-Type-Options':'nosniff',
  'X-Robots-Tag':'noindex, nofollow, noarchive, nosnippet',
  'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; connect-src 'none'",
  'Cross-Origin-Resource-Policy':'same-origin',
  'Referrer-Policy':'same-origin',
  'X-Frame-Options':'DENY'
});
const STYLE=':root{color-scheme:dark;font-family:system-ui,-apple-system,Segoe UI,sans-serif}*{box-sizing:border-box}body{margin:0;background:#06121c;color:#e7f4fb;line-height:1.5}main{max-width:980px;margin:auto;padding:36px 24px 72px}header{display:flex;justify-content:space-between;align-items:center;gap:24px}h1{font-size:clamp(1.8rem,3vw,2.5rem);margin:8px 0 16px}h2{font-size:1.15rem;margin:0 0 14px}p{color:#b5ccda;margin:9px 0}.eyebrow{text-transform:uppercase;letter-spacing:.16em;font-size:.72rem;font-weight:800;color:#26cee5}section{background:#102534;border:1px solid #28455a;border-radius:16px;padding:22px;margin:18px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}a,button{color:#071d28;background:#20c4df;border:0;border-radius:9px;display:inline-block;padding:11px 15px;font:inherit;font-weight:750;text-decoration:none;cursor:pointer}a.secondary,button.secondary{background:#243e52;color:#dceefa}a:focus-visible,button:focus-visible{outline:3px solid #fff;outline-offset:3px}nav{display:flex;gap:10px;flex-wrap:wrap}form{margin:0}.status{font-weight:800}.ok{color:#68ecc0}.warn{color:#ffd48a}.bad{color:#ffb6b2}small{color:#91acb9}';
const escape=x=>String(x).replace(/[&<>"']/g,k=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[k]));
function page(title,content) {
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+escape(title)+' · Administração SSX 2012</title><style>'+STYLE+'</style></head>'+
    '<body><main><header><div><div class="eyebrow">SSX 2012 / ÁREA RESTRITA</div>'+
    '<h1>'+escape(title)+'</h1></div><form method="post" action="'+BASE+
    '/logout"><button class="secondary" type="submit">Sair</button></form></header>'+content+
    '</main></body></html>';
}
function dashboard(snapshot) {
  const ep=publicBridgeEndpoint(),report=snapshot?.regionalSummary;
  const status=ep?'<span class="status warn">Endereço cadastrado; conexão não verificada</span>':
    '<span class="status warn">Live Sync ainda não conectado</span>';
  const count=report&&Number.isSafeInteger(report.totalRecordsAfter)
    ?report.totalRecordsAfter.toLocaleString('pt-BR'):'indisponível';
  return page('Painel administrativo',
    '<p>Central privada do SSX 2012. Sessão autenticada, independente das contas e licenças da ZVM.</p>'+
    '<div class="grid">'+
    '<section><h2>Rankings oficiais</h2><p class="status ok">Snapshot preservado · '+escape(CAPTURED)+'</p>'+
    '<p><strong>'+escape(count)+'</strong> registros históricos na edição regional consolidada.</p>'+
    '<p>'+escape(SHEETS.length)+' regiões reconciliadas. Fonte Google Sheets mantida somente leitura.</p>'+
    '<nav><a href="'+BASE+'/export.json">Exportar cópia JSON</a>'+
    '<a class="secondary" href="'+BASE+'/diagnostics">Auditar integridade</a></nav></section>'+
    '<section><h2>Sincronização Google</h2>'+status+
    '<p>'+(ep?'A URL /exec foi aceita pelo validador; clique abaixo para testar a implantação v8.':
    'A URL /exec do Apps Script v8 ainda precisa ser cadastrada no Render.')+'</p>'+
    '<nav><a href="'+BASE+'/bridge-health">Testar conexão (somente leitura)</a></nav></section>'+
    '<section><h2>Ferramentas de administração</h2>'+
    '<p>O editor histórico é protegido pela sessão. Publicação e moderação na planilha exigem a integração oficial.</p>'+
    '<nav><a href="'+BASE+'/editor">Abrir editor histórico</a>'+
    '<a class="secondary" href="'+BASE+'/archive">Arquivo original v36</a></nav></section></div>'+
    '<section><h2>Operação segura</h2>'+
    '<p>Download e auditoria funcionam sem acesso de escrita ao Google. A exportação não altera rankings, provas, Discord nem licenças.</p>'+
    '<nav><a class="secondary" href="/hobbies/ssx/ssx2012">Ver página pública</a>'+
    '<a class="secondary" href="'+BASE+'/diagnostics">Estado do sistema</a></nav></section>'+
    '<small>Não insira senhas, tokens administrativos ou chaves em URLs e formulários públicos.</small>');
}
function diagnostics(snapshot) {
  const summary=snapshot?.regionalSummary||null;
  const ep=publicBridgeEndpoint();
  const val=key=>summary&&Number.isSafeInteger(summary[key])?summary[key].toLocaleString('pt-BR'):'não verificado';
  return page('Diagnóstico e integridade',
    '<p>Visão somente leitura da versão publicada. Sem escrita na planilha ou chamadas aos sistemas comerciais.</p>'+
    '<div class="grid">'+
    '<section><h2>Fonte oficial</h2><p class="status ok">Snapshot regional · '+escape(CAPTURED)+'</p>'+
    '<p>'+escape(SHEETS.length)+' regiões da planilha oficial preservadas.</p>'+
    '<p>Registros após reconciliação: <strong>'+escape(val('totalRecordsAfter'))+'</strong>.</p>'+
    '<p>Registros atualizados ou novos: '+escape(val('changedOrNewRows'))+'.</p></section>'+
    '<section><h2>Revisão de dados</h2>'+
    '<p>Grupos regionais atualizados: '+escape(val('regionalGroupsUpdated'))+'.</p>'+
    '<p>Linhas para revisão: '+escape(val('reviewRows'))+'.</p>'+
    '<p>Grupos preservados por segurança: '+escape(summary?.skippedGroups?.length??'não verificado')+'.</p></section>'+
    '<section><h2>Integração</h2>'+
    '<p class="status '+(ep?'warn':'bad')+'">'+
    (ep?'Endpoint cadastrado; teste pendente':'Endpoint público não cadastrado')+'</p>'+
    '<p>Uma URL configurada não comprova a sincronização. O teste real consulta apenas o ping v8.</p>'+
    '<nav><a href="'+BASE+'/bridge-health">Verificar Bridge v8</a></nav></section></div>'+
    '<section><h2>Segurança do administrador</h2>'+
    '<p>Sessão por cookie HttpOnly/Secure; acesso anônimo bloqueado; fonte pública separada da administração.</p>'+
    '<p>Esta tela não mostra credenciais, sessão nem segredos de integração.</p>'+
    '<nav><a href="'+BASE+'/export.json">Exportar JSON autenticado</a>'+
    '<a class="secondary" href="'+BASE+'">Voltar ao painel</a></nav></section>');
}
function exportSnapshot(snapshot) {
  if(!snapshot?.content||!snapshot?.regionalSummary)throw new Error('SSX_SNAPSHOT_NOT_AVAILABLE');
  const html=snapshot.content.toString('utf8');
  const regular=locate(html,'G').value;
  const special=locate(html,'SNG').value;
  if(!Array.isArray(regular)||regular.length<5000||!Array.isArray(special))
    throw new Error('SSX_EXPORT_INTEGRITY_FAILED');
  return {
    schemaVersion:1,
    exportedAt:new Date().toISOString(),
    source:'SSX 2012 R111 · cópia autenticada somente leitura',
    regionalSnapshotDate:CAPTURED,
    spreadsheetId:SHEET_ID,
    regionalSummary:snapshot.regionalSummary,
    regularRecords:regular,
    specialRecords:special
  };
}
function healthPage(info) {
  const cls=info.ok?'ok':info.configured?'bad':'warn';
  const msg=info.ok?'Bridge v'+info.version+' respondeu corretamente à consulta de leitura.':
    info.configured?'A URL existe, mas o Bridge v8 não foi validado. Confira /exec e as permissões de leitura.':
    'Configure SSX_PUBLIC_BRIDGE_URL no Render com a URL /exec do Apps Script.';
  return page('Verificação do Live Sync',
    '<section><h2>Teste não destrutivo</h2><p class="status '+cls+'">'+escape(msg)+'</p>'+
    '<p>Verificado em '+escape(new Date().toISOString())+'</p>'+
    '<p>Não foram efetuadas alterações na planilha, anúncios ou classificações.</p></section>'+
    '<a href="'+BASE+'">Voltar ao painel</a>');
}
function send(res,method,html,status=200) {
  const body=Buffer.from(html,'utf8');
  res.writeHead(status,{...HEADERS,'Content-Type':'text/html; charset=utf-8','Content-Length':body.byteLength});
  res.end(method==='HEAD'?undefined:body);
}
async function checkBridge(transport=fetch) {
  const ep=publicBridgeEndpoint();
  if(!ep)return {configured:false,ok:false,version:0};
  const initial=new URL(ep);
  initial.searchParams.set('action','ping');
  let target=initial;
  const signal=AbortSignal.timeout(10000);
  try {
    for(let n=0;n<4;n++){
      const res=await transport(target,{method:'GET',redirect:'manual',signal,
        headers:{Accept:'application/json'},credentials:'omit',cache:'no-store'});
      if([301,302,303,307,308].includes(res.status)){
        const next=new URL(res.headers.get('location')||'',target);
        if(next.protocol!=='https:'||!['script.google.com','script.googleusercontent.com'].includes(next.hostname.toLowerCase())||
          next.username||next.password)throw new Error('UNTRUSTED_REDIRECT');
        target=next;continue;
      }
      if(!res.ok||Number(res.headers.get('content-length')||0)>32768)throw new Error('RESPONSE_INVALID');
      let size=0;const parts=[];
      for await(const bytes of res.body) {
        size+=bytes.length;
        if(size>32768)throw new Error('RESPONSE_OVERSIZE');
        parts.push(Buffer.from(bytes));
      }
      const payload=JSON.parse(Buffer.concat(parts).toString('utf8'));
      const version=Number(payload?.version||0);
      return {configured:true,ok:payload?.ok===true&&Number.isSafeInteger(version)&&version>=8,version};
    }
  }catch{}
  return {configured:true,ok:false,version:0};
}
async function serveDashboard(req,res,pathname,getSnapshot) {
  if(![BASE,BASE+'/bridge-health',BASE+'/diagnostics',BASE+'/export.json'].includes(pathname))return false;
  const method=String(req.method||'').toUpperCase();
  if(method!=='GET'&&method!=='HEAD'){
    res.writeHead(405,{...HEADERS,Allow:'GET, HEAD'});res.end();return true;
  }
  if(pathname===BASE+'/bridge-health'){
    const info=await checkBridge();
    send(res,method,healthPage(info),info.ok?200:info.configured?502:503);
    return true;
  }
  let snapshot;
  try {snapshot=getSnapshot?.();}catch{
    send(res,method,page('Fonte indisponível',
      '<p>A leitura da cópia oficial falhou. Nenhuma informação foi alterada.</p>'+
      '<a href="'+BASE+'">Voltar</a>'),503);
    return true;
  }
  if(pathname===BASE+'/export.json'){
    try {
      const body=Buffer.from(JSON.stringify(exportSnapshot(snapshot)),'utf8');
      res.writeHead(200,{...HEADERS,
        'Content-Type':'application/json; charset=utf-8',
        'Content-Disposition':'attachment; filename="SSX2012_R111_SNAPSHOT.json"',
        'Content-Length':body.length});
      res.end(method==='HEAD'?undefined:body);
    }catch{
      res.writeHead(503,{...HEADERS,'Content-Type':'text/plain; charset=utf-8'});
      res.end(method==='HEAD'?undefined:'Exportação indisponível; fonte preservada.');
    }
    return true;
  }
  send(res,method,pathname===BASE?dashboard(snapshot):diagnostics(snapshot));
  return true;
}
module.exports={serveDashboard,dashboard,diagnostics,exportSnapshot,checkBridge,healthPage,HEADERS};