# ZVM LITE R56 — autenticação vinculada ao MongoDB e limites atômicos
**Data:** 18/11/2026. **Branch:** `feature/zvm-lite-key-v2-isolado-20261118`, PR #124 DRAFT. **Não houve merge/deploy/publicação/alteração de chaves comerciais.**

## Segurança corrigida
1. **Fresh snapshot por produto.** O módulo `src/lite-license-authority.js` implementa `readLiteLicenseSnapshot(db, code)`. Só aceita `zv2l-` + 52 caracteres base32, usa projeção no documento canônico `store/keys` e **não** retorna licenças do cache legado.
2. **Três caminhos usam a fonte persistida:** `resolveExtensionAccountEntitlement` (login por e-mail), `authorizeExtensionKeySession` (login por chave) e `refreshExtensionSession` (renovação da sessão). Mongo indisponível => `503 temporarily_unavailable`, sem reaproveitar autorização stale.
3. **Reserva de telefone específica da LITE:** `claimLitePhoneSlotAtomic(db,code,phone)` verifica produto/estado/plano/expiração/usos, restringe `updateOne` por esses campos e por limites máximo/global **na própria query**; `upsert:false`. Após a escrita, lê de novo o registro persistido; bloqueio concorrente => `entitlement_revoked`, duplicação legítima => `already_member`, teto atingido => `limit_reached`.
4. **Isolamento:** a ZVM Automações completa mantém `ensureKeyLoadedEx` e `claimPhoneSlotAtomic` próprios. A LITE não aceita `zv2a-` ou chave legada e mantém sua conta/sessões independentes.
5. **Localização pública:** páginas com `<nav class="znav standalone-nav"></nav>` agora recebem um seletor de idioma próprio, sem duplicar menus que já têm grupo de ações; teste do link de Privacidade passou.

## Validação
- CI especializada `ZVM key V2 - isolated checks`, SHA `940ca10e7ed525fecafafbb5dbea036aa8ee6ccb`: **PASS** `https://github.com/mythos52/zvm/actions/runs/44384782954`.
- A suite `tests/r56-lite-authoritative-db.test.js` testa leituras de DB, chave forjada/expirada, reserva concorrente, mudança de limite, cache stale e indisponibilidade de Mongo; foi incluída no workflow especializado.
- CI geral permanece **FAIL** em `tests/r46-system-ui.test.js` por expectativas antigas de composição CSS. A etapa Chromium visual falha na navegação móvel do Portal Cliente (rail com 338px); são falhas que não devem ser marcadas como aprovadas.
- O teste do idioma em `tests/r46-public-i18n.test.js` deixou de ser a primeira falha global após a correção em `i18n.js`.

## Pendências antes da primeira chave REAL
1. Build Chrome LITE com **identidade RSA e assinador Ed25519 estáveis**, sob custódia do proprietário. Os CRX R43–R45 são identidades de laboratório e não servem como build comercial definitiva.
2. Serviço LITE em **homologação** configurado com o mesmo `extensionId`, `buildId`, `sha256`, `keyId`, chave pública e versão; `ZVM_LITE_V4_ENABLED` apenas após checagem. Não alterar o Render comercial sem deploy manual autorizado.
3. Teste de ponta a ponta com Mongo staging, sessão WhatsApp real, login por chave/conta, refresh, bloqueio e logout. Testes Node/VM e auditorias de CRX não são homologação MV3 no Chrome/Opera.
4. Revisar falhas preexistentes da CI geral antes de merge. **Não fingir que a chave anteriormente pré-gerada em conversa está ativa**; emissão real tem de ocorrer via API administrativa persistente.
