# ZVM LITE R58 — assinatura, isolamento e revogação (18/11/2026)

**Estado:** branch feature/zvm-lite-key-v2-isolado-20261118, PR DRAFT #124. Código isolado e sem publicação. Nenhum deploy, nenhuma alteração no MongoDB comercial, nenhuma emissão de chave ativa de cliente e nenhum BAT/PS1.

## Correções entregues

1. **Isolamento do cache da edição completa:** a autenticação `authorizeExtensionKeySession` usa um snapshot MongoDB próprio na LITE e deixa de inserir/atualizar as chaves `zv2l-` no objeto global `keys` da ZVM completa. O entitlement é criado a partir do snapshot local e atualizado após claim/primeiro uso. Testes de regressão `r57-lite-deferred-route` e `r58-lite-signed-api-contract` confirmam a separação.
2. **Teste do protocolo V4 real com assinatura Ed25519:** `tests/r58-lite-signed-api-contract.test.js` extrai a rota `/extension/lite/v4/session/{key,login,refresh,logout}` do `server.js`, valida com `inspectLiteClient` real, assina descritores reais com chave efêmera **de teste** e usa MongoDB 7.0 descartável. Testa origem proibida, assinatura adulterada, chave da edição completa, requisição legítima, repetição de requestId, login por conta, refresh e logout. A emissão/refresh de token na suíte usa substitutos isolados; não equivale a instalar e operar a extensão no Chrome.
3. **Revogação administrativa no bloqueio de uma licença LITE:** ao desligar uma chave pelo admin, `revokeLiteLicenseSessions` invalida sessões da LITE autenticadas por chave e por senha. Não invalida sessões de outras licenças ou da ZVM completa. Se a revogação do DB falhar após a chave já ter sido bloqueada, a API informa `lite_sessions_revocation_pending` em vez de declarar sucesso, e registra erro.
4. **Rota administrativa de recuperação idempotente:** `POST /api/keys/:code/revoke-lite-sessions` sob o prefixo administrativo, exigindo sessão admin, mesma origem, chave LITE existente e **já bloqueada**, permite tentar revogar sessões sem alternar o estado da chave. A rota não reativa chaves e não é pública.
5. **CI e robustez do código:** uma inserção inicial da rota em `server.js` gerou duplicação de conteúdo por substituição textual. O erro foi detectado pelo `node --check` da CI. O arquivo foi restaurado da revisão íntegra `cdc45dcd...` e a rota reaplicada por substituição segura com callback. A falha de fixture Mongo causada pela mistura de documentos de testes adjacentes também foi corrigida.

## Evidências confirmadas
- CI especializada `ZVM key V2 - isolated checks` (R58, SHA `f067d7a7991ea4cb43090e1b961f486b72180b22`): **PASS** — https://github.com/mythos52/zvm/actions/runs/44396255693
- CI com MongoDB real e protocolo assinado, mesmo SHA: **PASS** — https://github.com/mythos52/zvm/actions/runs/44396255499
- CI global de CSS e navegação móvel permanece **FAIL**; não foi alterada para mascarar falhas.

## Restrições para uma versão utilizável
- Não foram configurados/ativados `ZVM_LITE_V4_ENABLED` e identidade pública da **mesma extensão de produção** no Render. A branch não está em `main`.
- Ainda falta identidade RSA/CRX3 + assinatura Ed25519 **estáveis e sob custódia do proprietário**, staging com par de identidades assinado e homologação no Chrome/Opera com WhatsApp real.
- Chave pré-gerada anteriormente em conversa é texto inativo, não consta como emitida no banco comercial.
- A suíte é integração de protocolo, não homologação de browser nem garantia de capacidade funcional das telas WhatsApp.
- Sem deploy automático e sem enviar novos ZIPs/CRXs temporários como se fossem versão comercial.

## Próximo gate
Somente após selecionar/configurar um ambiente **de staging separado**, assinar um pacote de identidade estável, e testar autenticação real de extensão + servidor, decidir liberação pelo painel administrativo. Não mesclar nem publicar sem revisão deliberada.
