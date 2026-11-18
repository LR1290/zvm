# ZVM Automações LITE — R61 / Extensão R48: auditoria complementar
Data: 18/11/2026 (UTC)
Origem: R47 assinada do proprietário; PR DRAFT #124 na branch feature/zvm-lite-key-v2-isolado-20261118.
**Sem merge na main, sem alterações na ZVM comercial ou no banco zapvoice.**

## Falhas omitidas na R47
1. `app/sidebar/lifecycle.js` restaurava largura hardcoded `214` ao reexibir uma Sidebar que já estava expandida. O layout canônico `C.EXPANDED_WIDTH` é 174. Como `setWidth()` aceita apenas 64/174, `214` era convertido silenciosamente para 64, deixando o estado visual expandido discordante do layout real.
2. O popup `pages/popup/index.html` exibia 'ZVM - Automações ativa' com ponto verde independentemente do resultado da autoridade V4. Isso confundia instalação presente com sessão autorizada.

## Correções R48
- A restauração pós-hide agora usa `C.EXPANDED_WIDTH`, não 214.
- Rodapé inicial neutro: `LITE — verificando sessão`; uma consulta `EXTUI_S0_C` com `forceNetwork:false` identifica estados:
  - authorized: 'LITE — sessão autorizada' (ponto verde);
  - unauthorized: 'LITE — entrar ou validar licença' (ponto neutro);
  - unavailable: 'LITE — verificação indisponível' (ponto laranja).
- Sem bypass de licença, sem afrouxar permissão e sem declarar uma versão instalada como autorizada.
- Versão do manifesto `0.1.48`, versão da edição `0.1.48-dev-r48-owner`.
- Reassinatura pela **mesma chave RSA 3072 e Ed25519** da linha R46/R47, privadas fora do repositório e fora da distribuição.

## Evidências (ambiente local)
- Teste dinâmico Chromium 144 `r48-chromium-regression.py`: R47 retorna largura 214 após expandir/ocultar/reabrir; R48 retorna 174. Popup autorizado, não autorizado e indisponível aprovado sem pageerrors.
- Node VM `r47-smoke.cjs` na árvore R48: catálogo LITE, Sidebar, larguras, roteador e negação CRM PASS.
- `node --check` em 242 JS: PASS.
- Referências de manifesto 84; 49 importações de service worker; recursos existentes.
- Árvore com 273 arquivos em ambas as versões; 9 modificados, sem adições nem remoções: `app/sidebar/lifecycle.js`, `app/popup/controller.js`, `app/popup/styles.css`, `pages/popup/index.html`, `app/shared/core/lite-edition.js`, `manifest.json` e 3 arquivos de identidade/assinatura.
- Runtime sem URLs explícitas para `zvm.onrender.com` e sem material de chave privada.
- CRX3 RSA-SHA256 e dois atestados Ed25519 verificados. ID Chrome permanece `ongildapieobgiamfjgnnnpelbeamfbk`.
- Build ID: `zvm-lite-dev-0.1.48-sae60f885d9e5`.
- Fingerprint: `5ff9e5554f2e565e4fceb200f8a6c5b164ec60a8525c65007d3f9c8aa7cd5f4a`.
- CRX3 SHA256: `719580b371c8a142aeba8cc92c529dbf56e1e05b9ea533452b048dacc548cc41`.
- ZIP manual SHA256: `824ddde344eccf869bc7c9ba2876906d66f45def15b4d77c88ad9eb2b8ac919e`, 273 entradas, CRC PASS.
- Assinatura DEV expira em `2026-11-24T22:31:15.248Z`.

## Backend
- Render **somente staging**, serviço `srv-dbv1sf8u01pc73cig79g`, variáveis de autoridade de build V4 alteradas para R48 (ID e SHA acima; versão 0.1.48). `ZVM_LITE_V4_ENABLED` segue no staging apenas.
- Key `zv2l-` cadastrada anteriormente no Mongo `zvm_lite_staging_20261118` não foi rotacionada; produção intacta.
- A homologação MV3 / WhatsApp real continua **pendente**: o Chromium deste ambiente bloqueia extensão (`net::ERR_BLOCKED_BY_CLIENT`), sem service worker; não contornar política e não declarar e2e aprovado.
- Atualizar arquivos unpacked no mesmo diretório de instalação, usando o mesmo ID; não desinstalar a versão anterior se quiser preservar `chrome.storage`.
