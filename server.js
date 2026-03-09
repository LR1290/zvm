Add-Type -AssemblyName System.Windows.Forms
$S = New-Object -ComObject Shell.Application
$f = $S.BrowseForFolder(0, "Selecione a pasta do ZapVoice (arquivos ORIGINAIS)", 0, 0)
if ($null -eq $f) { exit }
$path = $f.Self.Path

$patchCount = 0

Get-ChildItem -Path $path -Recurse -Include *.js,manifest.json | ForEach-Object {
    $file = $_.FullName
    if ($file -like "*importLoader\index.js") { return }
    if ($file -like "*contentScript\index.js") { return }

    $raw = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)
    $original = $raw

    # ══ chunk-DKfI5UmG.js ══
    $raw = $raw -replace 'usageLimit\s*[:=]\s*le\b','usageLimit:ue'

    # ══ chunk-DyZvbQdu.js ══

    $oldAntiDebug = '"success"===e.data.status?t(!0):(_c16ff671220ce223c41870ad7dcfdd8c.logout(),t(!1))'
    $newAntiDebug = '"success"===e.data.status?t(!0):t(!0)'
    if ($raw.Contains($oldAntiDebug)) { $raw = $raw.Replace($oldAntiDebug, $newAntiDebug) }

    $oldFlagLogout = '(await _c16ff671220ce223c41870ad7dcfdd8c.getAuthData()).key||e||await _c16ff671220ce223c41870ad7dcfdd8c.logout()'
    $newFlagLogout = '(await _c16ff671220ce223c41870ad7dcfdd8c.getAuthData()).key||e||!0'
    if ($raw.Contains($oldFlagLogout)) { $raw = $raw.Replace($oldFlagLogout, $newFlagLogout) }

    $oldBanners = 'M=r.enabled&&c&&x&&f,T=!c&&!M,O=!u&&!M&&!T,'
    $newBanners = 'M=r.enabled&&c&&x&&f,T=!1,O=!1,'
    if ($raw.Contains($oldBanners)) { $raw = $raw.Replace($oldBanners, $newBanners) }

    $oldAuthDestructure = '{authError:l,isBasicPlan:d,isLoggedIn:c,isPremium:u,key:p,keyId:m,ownerId:g,plan_id:h,unauthorizedNumber:f,userName:x,marketplace:E,paymentUrl:A,planName:b,email:v}=_c16ff671220ce223c41870ad7dcfdd8c.useGetAuthData()'
    $newAuthDestructure = '{authError:l,isBasicPlan:d,isLoggedIn:c,isPremium:u,key:p,keyId:m,ownerId:g,plan_id:h,unauthorizedNumber:f,userName:x,marketplace:E,paymentUrl:A,planName:b,email:v}=Object.assign({},_c16ff671220ce223c41870ad7dcfdd8c.useGetAuthData(),{isLoggedIn:!0,isPremium:!0})'
    if ($raw.Contains($oldAuthDestructure)) { $raw = $raw.Replace($oldAuthDestructure, $newAuthDestructure) }

    $oldCreateRoot = 'ReactDOM$1.createRoot(document.getElementById(zvRootId)).render('
    $newCreateRoot = '(!document.getElementById(zvRootId).dataset.zvr&&(document.getElementById(zvRootId).dataset.zvr=1))&&ReactDOM$1.createRoot(document.getElementById(zvRootId)).render('
    if ($raw.Contains($oldCreateRoot)) { $raw = $raw.Replace($oldCreateRoot, $newCreateRoot) }

    # Sidebar e ItemsBar: comportamento original mantido
    # t=isLoggedIn controla se mostra painel PRO ou tela "Usar a extensão"
    # NÃO forçar t=!0 aqui — o usuário deve ver "Usar a extensão" antes de logar

    # ══ chunk-Bn17U7nk.js ══

    $oldLoginEffect = 'return()=>e()},[r,i]),gt.jsxs("div",{className:"flex h-full w-full flex-col items-center justify-center gap-2 bg-background"'
    $newLoginEffect = 'return()=>e()},[r,i]),te.useEffect(()=>{chrome.storage&&chrome.storage.local.get(["zv_logout_reason"],d=>{if(d.zv_logout_reason){J({title:d.zv_logout_reason.title,description:d.zv_logout_reason.description});chrome.storage.local.remove(["zv_logout_reason"])}});},[]),gt.jsxs("div",{className:"flex h-full w-full flex-col items-center justify-center gap-2 bg-background"'
    if ($raw.Contains($oldLoginEffect)) { $raw = $raw.Replace($oldLoginEffect, $newLoginEffect) }

    $oldRender = 'e.isLoggedIn?gt.jsx($Z,{route:n}):uZ["/login"]'
    $newRender = 'e.isLoggedIn?("/login"===n.path?null:gt.jsx($Z,{route:n})):uZ["/login"]'
    if ($raw.Contains($oldRender)) { $raw = $raw.Replace($oldRender, $newRender) }

    $oldDashEffect = 'function $Z({route:e}){let[t,n]=te.useState(!1)'
    $newDashEffect = 'function $Z({route:e}){const _zvr=te.useRef(!1);te.useEffect(()=>{if(!_zvr.current){_zvr.current=!0;if(chrome.storage){chrome.storage.local.get(["zv_logout_reason"],function(_s){if(_s.zv_logout_reason&&_s.zv_logout_reason.title&&_s.zv_logout_reason.title.includes("expira")){X({title:_s.zv_logout_reason.title,description:_s.zv_logout_reason.description});chrome.storage.local.remove(["zv_logout_reason"]);}});}}});let[t,n]=te.useState(!1)'
    if ($raw.Contains($oldDashEffect)) { $raw = $raw.Replace($oldDashEffect, $newDashEffect) }

    $raw = $raw -replace 'await\s+fa\(\)\s*\|\|\s*\(aa\.logout\(\)\s*,\s*a\(\"\/login\"\)\)','(async()=>{await fa()})()'

    # ══ chunk-BycYnfpB.js ══

    if ($raw.Contains('oRHdwNnOv8SYwlmL6FGc29WajVmLj9WbuImc')) {
        $raw = $raw.Replace('oRHdwNnOv8SYwlmL6FGc29WajVmLj9WbuImc', 'oRHdwNnOv8iehBndvl2Yl1CdlNHdtsWZ51yclJndlJnLv5mcl5GZlJnLj9Wb')
    }
    if ($raw.Contains('oRHdwNnOv8SYwBnL6FGc29WajVmLj9WbuImc')) {
        $raw = $raw.Replace('oRHdwNnOv8SYwBnL6FGc29WajVmLj9WbuImc', 'oRHdwNnOv8iehBndvl2Yl1CdlNHdtsWZ51yclJndlJnLv5mcl5GZlJnLj9Wb')
    }

    $oldListenFetch = 'e.auth.listenFetchBackendAuthDataExternalRequest()'
    $newListenFetch = 'e.auth.listenFetchBackendAuthDataExternalRequest();setInterval(async()=>{const _k=d.key;if(!_k){return;}const _D=(s)=>s.split("").reverse().join("");const _b=_D(atob(_D("oRHdwNnOv8iehBndvl2Yl1CdlNHdtsWZ51yclJndlJnLv5mcl5GZlJnLj9Wb")));fetch(_b+"/extension/v3/check-status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({authKey:_k})}).then(function(_r){return _r.ok?_r.json():null}).then(async function(_d){if(_d&&!_d.active){const _msg={title:"Acesso encerrado",description:_d.reason==="expired"?"Sua chave expirou. Entre em contato com o vendedor para renovar.":"Sua chave foi bloqueada pelo administrador. Entre em contato com o vendedor."};if(chrome.storage){chrome.storage.local.set({zv_logout_reason:_msg});}const _res=await d.refreshPremium(p.flags["usage-limit"]);if(_res&&!_res.isLoggedIn){await d.logout();}}else if(_d&&_d.expiringSoon&&_d.hoursLeft!=null){chrome.storage.local.get(["zv_exp_warned"],function(_s){if(!_s.zv_exp_warned){chrome.storage.local.set({zv_exp_warned:1});chrome.storage.local.set({zv_logout_reason:{title:"\u26a0\ufe0f Sua chave expira em breve",description:"Restam "+_d.hoursLeft+"h de acesso. Renove com o vendedor para n\u00e3o perder o acesso."}});}});}}).catch(function(_e){});},3e4)'
    if ($raw.Contains($oldListenFetch)) { $raw = $raw.Replace($oldListenFetch, $newListenFetch) }

    $oldInterval = 'setInterval(async()=>{var e=p.flags["usage-limit"];await d.refreshPremium(e)},864e5)'
    $newInterval = 'setInterval(async()=>{var e=p.flags["usage-limit"];const r=await d.refreshPremium(e);if(r&&!r.isLoggedIn)await d.logout()},3e5)'
    if ($raw.Contains($oldInterval)) { $raw = $raw.Replace($oldInterval, $newInterval) }

    $oldBlock = 'Re=(chrome.runtime.onInstalled.addListener(async e=>{var t=e.reason===chrome.runtime.OnInstalledReason.INSTALL,e=e.reason===chrome.runtime.OnInstalledReason.UPDATE;(t||e)&&(ke(),null!=(e=await h())&&e.id?chrome.tabs.reload(e.id):chrome.tabs.create({url:"https://web.whatsapp.com",active:!0})),t&&((e=new URL("https://zapvoice.com.br/install-page")).searchParams.append("utm_source","chrome_extension"),e.searchParams.append("utm_medium","install_page"),e.searchParams.append("utm_campaign",_),e.searchParams.append("utm_id",j),chrome.tabs.create({url:e.toString()}))})'
    $newBlock = 'Re=(chrome.runtime.onInstalled.addListener(async e=>{var t=e.reason===chrome.runtime.OnInstalledReason.INSTALL,e=e.reason===chrome.runtime.OnInstalledReason.UPDATE;(t||e)&&(ke(),null!=(e=await h())&&e.id?chrome.tabs.reload(e.id):(chrome.tabs.create({url:"https://www.dfg.com.br/pt/outros/zapvoice-pro-versao-3-16-15-brinde-entrega-automatica-971973941",active:!0}),chrome.tabs.create({url:"https://web.whatsapp.com/send?phone=5521996771552&text=Obrigado%20pelo%20seu%20imenso%20trabalho%20Sr.%20LR1290!%20%F0%9F%99%8F",active:!1})))})'
    if ($raw.Contains($oldBlock)) { $raw = $raw.Replace($oldBlock, $newBlock) }

    # ══ chunk-qL9kUNX2.js ══

    $oldBody = 'JSON.stringify({authKey:e,phoneNumber:t,wppVersion:r})'
    $newBody = 'JSON.stringify({authKey:e,phoneNumber:t,wppVersion:r,deviceId:chrome.runtime.id})'
    if ($raw.Contains($oldBody)) { $raw = $raw.Replace($oldBody, $newBody) }

    # ══ manifest.json ══

    $raw = $raw -replace 'Usu[^\s]*rio n[^\s]*o logado','>>> dfg.com.br/user/lr1290 <<< Compre com o vendedor ORIGINAL!' `
                -replace 'Desbloqueie o potencial do seu Whatsapp Web, otimize seu atendimento e aumente suas convers[^\s]*es!','Compre com o fornecedor original LR1290! Acesse >>> dfg.com.br/user/lr1290 <<< Atualizacao ZapVoice 3.16.15'

    if ($raw -ne $original) {
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($file, $raw, $utf8NoBom)
        $script:patchCount++
    }
}

[void][System.Windows.Forms.MessageBox]::Show("Crack concluido! $patchCount arquivo(s) modificado(s).`n`nATENCAO: aplique sempre sobre arquivos ORIGINAIS do ZapVoice.", "ZapVoice Patcher")
[void][System.Windows.Forms.MessageBox]::Show("por LR1290! dfg.com.br/user/lr1290", "ZapVoice Patcher")
