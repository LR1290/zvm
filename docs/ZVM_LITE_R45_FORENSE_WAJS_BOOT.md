# ZVM Automações LITE R45 — correção forense de boot e WA-JS (18/11/2026)

**Status:** extensão R45 DEV assinada e CRX3 verificado localmente; ainda sem homologação de MV3 no WhatsApp Web nem backend LITE habilitado. PR #124 DRAFT, sem merge, deploy ou mudança de chaves em produção.

## Evidência dos screenshots R44
1. `LICENSE_WORKER_UNCLASSIFIED` na tela "Serviço da extensão indisponível".
2. DevTools do Chrome aponta, no `vendor/wa-js/wa-js.js` v4.7.3-alpha.0, "Module isLidMigrated was not found" e, em outro erro recolhido, "func is not a function".

## Causas reproduzidas e alterações reais na extensão
- **`extAssertSender` inexistente** no runtime R44. Em simulação do service worker importando **49 módulos reais**, um pedido `EXTUI_S0_LOCAL_CREDENTIAL` lançava `ReferenceError: extAssertSender is not defined` e respondia com `LICENSE_WORKER_UNCLASSIFIED`. Foi restaurado o guard em `app/background/authority/foundation-integrity.js`; somente origem autorizada com booleano explícito true é aceita.
- **`self.__extBoundedResponseText.read` inexistente** no runtime: `offscreen-options.js` usava o leitor para login/refresh, mas nenhum módulo o registrava; a VM reproduziu `TypeError: Cannot read properties of undefined (reading 'read')` em login. Implementado leitor único fail-closed: streaming, limite estrito de 262144 bytes conforme chamadores, UTF-8 fatal, declaração/limite real de bytes, mensagens de erro tipadas.
- **WA-JS incompatível:** substituído `vendor/wa-js/wa-js.js` v4.7.3-alpha.0 por asset **oficial** `v4.8.2` do GitHub WPPConnect, 595652 bytes, SHA-256 `b1a9c3c42357ad2a9fb7504f460c909dcf0e2b1ad8129abdb485f151164a4b10` (digest do release), verificado também por GitHub Actions `44375919588`. Atualizada `app/shared/core/wa-js-channel-policy.js`. O seletor antigo exato `e=>e.Lid1X1MigrationUtils&&"function"==typeof e.Lid1X1MigrationUtils.isLidMigrated` não existe no v4.8.2. Não houve emulação de funções do WhatsApp.
- Mensagem de autorização `LITE_BUILD_AUTHORITY_UNCONFIGURED` agora aparece com texto específico da edição LITE em `license-authority.js` / `auth-ui.js`, sem mascarar como defeito genérico de boot; `boot-kernel.js` classifica o código como AUTH.

## Testes concluídos na build R45
- **36 listeners** carregados na VM com módulos **reais**; `EXTUI_S0_LOCAL_CREDENTIAL`, `EXTUI_S0_C`, `EXTUI_S0_B`: PASS; login simulado com backend desabilitado retorna corretamente `LITE_BUILD_AUTHORITY_UNCONFIGURED`; emissor falsificado `UNAUTHORIZED_SENDER`; **nenhum LICENSE_WORKER_UNCLASSIFIED** nos fluxos verificados.
- Leitor HTTP `7/7` (JSON, Content-Length excessivo, streaming excessivo, UTF-8 inválido, resposta 204 vazia, limite inválido, imutabilidade).
- UI `3/3` classificações de erro; **244** scripts JS sintaticamente válidos; **49** imports SW e **95** referências de manifesto existentes.
- **273** arquivos runtime, **271** itens protegidos, duas assinaturas Ed25519 verificadas, CRX3 RSA-SHA256 e bytes do ZIP verificados: PASS.
- CRX3 `ZVM-LITE-DEV-R45-CORRIGIDA.crx`: SHA256 `65ab22a2945c3f2100a7130a0cfd0d4e926efaa6162c5378ec289bb6a118b1d8`, 3451410 bytes.
- ZIP apenas extensão `ZVM-LITE-DEV-R45-CARREGAR-EXTENSAO.zip`: SHA256 `2b869df5c7d658657c8b24eae9ccbd4914ebeb896c69da48791cf276d8543fee`, 3432189 bytes. **Zero BAT, PS1, PFX ou chaves privadas** no runtime.
- Identidade DEV de laboratório: `dcknidlcilfkpldljaggjkgfgemlmjbm` (diferente da R44, sem reaproveitar chave privada perdida). Assinatura de build expira `2026-11-21T19:08:37.128Z`; não é assinatura oficial de cliente.

## Limites claros
A VM não reproduz WhatsApp Web conectado. O Chromium disponível impõe políticas `ExtensionInstallBlocklist=["*"]` e `URLBlocklist=["*"]`: a extensão MV3 não foi instalada/testada nele, sem tentativa de violar a política. A atualização da WA-JS elimina o seletor obsoleto encontrado no print, mas o erro colapsado "func is not a function" não tinha stack suficiente no screenshot para comprovação individual.

**O backend LITE V4 ainda não está habilitado**: `ZVM_LITE_V4_ENABLED=false`. O login comercial permanece BLOQUEADO de forma declarada, independente dos bugs de boot agora corrigidos. É necessário ambiente de homologação com identidade estável, configuração da autoridade, chaves LITE e teste com WhatsApp real autorizado. Nenhum deploy/merge automático.
