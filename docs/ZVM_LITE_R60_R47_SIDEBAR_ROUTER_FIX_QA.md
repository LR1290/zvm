# ZVM Automações LITE R60 — R47 correção de boot da Sidebar e Painel (18/11/2026)

## Incidente reproduzido pelo proprietário
Chrome/WhatsApp Web em 18/11 mostrou 3 erros:
- `SIDEBAR_SHELL_TAXONOMY_INCOMPLETE`
- `Cannot read properties of undefined (reading 'COLLAPSED_WIDTH')`
- `ReferenceError: extSafeShellParam is not defined` em `app/background/authority/runtime-router.js:150`.
Popup exibia erros ao abrir painel e Sidebar. WhatsApp Web por si estava autenticado, extensão com falha de boot.

## Diagnóstico de causa raiz
- `app/sidebar/constants.js` usava `legacyDefaultPinnedV35` da versão completa como contagem obrigatória de pins (10), após a edição LITE ter removido módulos por `ExtensionCore.Edition`. O catálogo real da LITE tem 6 pins: `items,quick-response,broadcast,flow,funnel,export`. Essa exceção impedida criava `ExtensionUI.sidebarConstants` antes de `layout.js`.
- O acesso `C.COLLAPSED_WIDTH` falhava em cascata por não existir o objeto `sidebarConstants`.
- `app/background/authority/runtime-router.js` chamava `extSafeShellParam` (9 argumentos) sem definir a função, após remoção de código legado.

## Correções da R47 (em cima da R46, sem regressar à R41)
1. `app/sidebar/constants.js`: comparação de pins agora usa a projeção canônica `ShellCapabilities.getSidebarItems()+getSidebarOnlyItems()` já filtrada pelo produto LITE e os itens `pinEligible`. Mantém invariantes de unicidade e completude, sem reintroduzir CRM, Agenda removida, IA, etc.
2. `app/background/authority/runtime-router.js`: função `extSafeShellParam` readicionada com input estritamente string, tamanho máximo, caracteres permitidos `[A-Za-z0-9._:-]`. O fluxo restringe seções à `__extLiteAuthorityPolicy` e impede CRM.
3. `app/shared/core/lite-edition.js`: versionamento coerente `0.1.47-dev-r47-owner`.
4. `manifest.json`: versão `0.1.47`, `version_name=0.1.47-dev+R47-SIDEBAR-ROUTER-FIX`.
5. Nova assinatura por chave privada RSA 3072 estável da linha R46, sem trocar o ID Chrome. Nova assinatura Ed25519 do descritor. Chaves privadas preservadas fora do runtime e repositório.

## Artefatos verificados
- ZIP para Chrome Developer Mode: `ZVM-LITE-DEV-R47-CORRIGIDA-CARREGAR-SEM-COMPACTACAO.zip` | 3.432.535 bytes | SHA256 `057430d875c00fe72e5de31717f6af77662a4b5ecafaeb12eb2c8a98f320161c`.
- CRX3: `ZVM-LITE-DEV-R47-CORRIGIDA.crx` | 3.451.757 bytes | SHA256 `a73433273e0b431da2c77d6efe650d3f28e9c5539dba52fe0ed5ce02412eadc8`.
- Extension ID **inalterado**: `ongildapieobgiamfjgnnnpelbeamfbk`.
- Build ID `zvm-lite-dev-0.1.47-scbfd8b5f3d4f`; fingerprint `d71caf0417613537b679ed392939ea6c8accc7c0669e7eb0dc459ad644bf3235`.
- Assinatura DEV válida até `2026-11-24T22:08:10.732Z`.
- ZIP CRC 273/273 OK, CRX3 assinatura RSA-SHA256/ZIP match/ID OK, Ed25519 2/2 assinaturas OK.
- JS syntax 244/244; manifest referents presentes.
- Node VM: 8 grupos de teste PASS para catálogo, larguras, validação de parâmetros, abertura de painel permitido e negação CRM.
- Chromium 144 DOM sintético: Sidebar menu renderizou catálogo de 6 itens, 64/174/64 largura, sem page errors; a edição LITE bloqueou CRM como esperado.
- **MV3/WhatsApp real não foi testado:** Chromium neste ambiente não criou service worker e retornou `net::ERR_BLOCKED_BY_CLIENT` ao abrir popup chrome-extension. Não contornar política, não declarar homologação end-to-end.

## Backend / licença
- Render staging exclusivo `zvm-lite-homolog-20261118`, serviceId `srv-dbv1sf8u01pc73cig79g`.
- Variáveis da build R47 (build ID/fingerprint/versão) atualizadas via merge, preservando as demais.
- Deploy da alteração `dep-dbv246t6e07s73agbre0` confirmou status `live`; branch backend continua isolada `feature/zvm-lite-key-v2-isolado-20261118`, PR #124 em DRAFT, sem merge e sem alteração de `zvm.onrender.com`.
- Chave DEV LITE emitida na R59 permanece no banco isolado, **sem rotacioná-la**.
- A R46 antiga não é mais a versão reconhecida pela autoridade staging: instalar/atualizar para R47. Para preservar `chrome.storage`, evitar remover a extensão antiga; substituir arquivos na pasta unpacked e clicar `Atualizar` em `chrome://extensions`.

## Pendência
Receber validação de instalação do proprietário: menu Sidebar visível, Painel de Controle abre, autenticação key e refresh da sessão; caso contrário, recolher os erros novos pelo `chrome://extensions` e preservar R47 como checkpoint.
