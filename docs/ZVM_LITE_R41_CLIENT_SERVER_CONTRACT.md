# ZVM Automações LITE — R41 | Continuidade da integração extensão × servidor

**18/11/2026 — laboratório isolado.** PR #124 permanece DRAFT. **Não mesclar, não publicar, não fazer deploy nem liberar licenças de clientes.**

## Origem imutável da extensão

- Fonte R40 recuperada da Biblioteca: `ZVM_LITE_R40_FONTE_LAB_NAO_INSTALAR.zip`, SHA-256 `90b27bd79faa54a9aaedaf73b358255b38453d08b9843f0ca1b3ad5d701ffd7a`.
- Cópia R41 criada em laboratório: `ZVM_LITE_R41_FONTE_LAB_NAO_INSTALAR.zip`, SHA-256 `81bc059c83e835616eff04985f83ea3817343087931c668a465432f6b5bab9a8`, 687 arquivos e 4.598.751 bytes. **Fonte, não instalador**; enviada como artefato na conversa do proprietário, não adicionada ao repositório do servidor.
- Runtime do candidato: `0.1.41-dev+R41-LAB-NAO-INSTALAR`; `installationAllowed=false`; não inclui `app/security/integrity.json`, `build-identity.json`, `lite-v4-signed-build.json`, assinatura CRX3 oficial nem chave Ed25519.

## Contrato de wire V4 exclusivo

| Ação | Rota da LITE |
| --- | --- |
| Entrada e-mail/senha | `POST /extension/lite/v4/session/login` |
| Entrada por chave LITE | `POST /extension/lite/v4/session/key` |
| Renovação opaca | `POST /extension/lite/v4/session/refresh` |
| Encerrar sessão | `POST /extension/lite/v4/session/logout` |

As três rotas que validam autenticação exigem **`clientSecurity` e `signedBuild`** do mesmo objeto gerado e verificado pelo `app/background/authority/lite-v4-client.js`. Descritor somente de recurso empacotado: `app/security/lite-v4-signed-build.json`; assinatura Ed25519 da chave **própria da LITE**. Campos canônicos do payload na ordem contratada: `schema,audience,productId,channel,extensionId,buildId,sha256,keyId,issuedAt,expiresAt`.

As versões existentes do `build-identity.json` exigem `buildId=zvm-lite-dev-<semver>-s<12hex>`. Na R41 o backend passou a aceitar os pontos do semver no campo `buildId`, mantendo conferência exata da configuração e assinatura. Para provisionar uma build real, seu `ZVM_LITE_DEV_BUILD_ID` deve coincidir com o ID do manifesto assinado. O servidor NÃO aceita um produto escolhido apenas pelo cliente, nem reutiliza a autoridade da ZVM completa.

A conta do portal agora distingue `keyCode` (completa) de `liteKeyCode` (LITE), impedindo substituição cruzada. Os formulários aceitam a chave de 57 caracteres, com validação estrita e sem truncamento silencioso.

## Evidência de QA

- CI especializado do backend: **PASS**, run `44345500794` (GitHub Actions, código `bb11ed27...`).
- Suite R41 do módulo cliente: **7/7 PASS** (Ed25519 real, chaves QA efêmeras).
- Auditoria da fonte R41: **420 JS válidos, 49 importações presentes, 15 verificações PASS**.
- UI Início Chromium DOM: **17 verificações PASS** (não atesta extensão MV3).
- MV3 Chromium unpacked: **BLOQUEADO** por política da sessão Chromium deste ambiente: `chrome://extensions/` devolveu `ERR_BLOCKED_BY_ADMINISTRATOR`; service worker não se registrou. Não contornar a política.
- A CI **global** da branch permanece vermelha por testes existentes de i18n de `/privacidade` (espera `pt-PT`) e navegação mobile (rail de 338px); não atribuir aprovação geral à branch.

## Pré-requisitos que não podem ser simulados

1. ID e chave RSA/CRX3 de distribuição próprios da LITE, em custódia segura do proprietário; nada reutilizado da completa.
2. Chave Ed25519 oficial própria e descritor V4 da build efetivamente assinada; só chave pública no runtime e no servidor.
3. Gerar manifesto de integridade final e atestação DEV existente, incluindo novo módulo crítico; evitar ciclos de assinatura e hash no pipeline.
4. Habilitar `ZVM_LITE_V4_ENABLED` apenas no ambiente de homologação com valores reais e alinhados, sem afetar Render de produção.
5. Validar service worker MV3, sessão WhatsApp de teste, UI, login, renovação, replay, revogação, limite de telefone e logout em Chromium autorizado; manter LITE `LAB_BLOCKED` até isso acontecer.

Sem esses pré-requisitos não há DEV autêntica instalável nem motivo para gerar um CRX efêmero com falsa identidade.
