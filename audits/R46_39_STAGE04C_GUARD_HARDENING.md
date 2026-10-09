# ZVM — R46.39 / Etapa 04C — Pré-voo forense de titularidade

**Data:** 2026-10-09. **Branch exclusiva:** `audit/r46.39-stability`. **Baseline de produção:** `main` R46.38 / `7b58b35048ea2d107a61893e2de21a5e313028ec`.

## Falha adicional confirmada e corrigida no verificador
O pré-voo de índices anterior reconhecia um índice `unique:true` com `$type:'string'` e `$gt:''` mesmo quando `partialFilterExpression` também exigia `email`, `active` ou outra condição externa. Esse índice não garante unicidade global das licenças. O reconhecimento agora só aceita o contrato exato, sem predicados extras nem collation não simples. Qualquer filtro desconhecido falha fechado — não é prova de prontidão.

## Privacidade e censo
- O censo substituiu SHA-256 previsível de códigos por HMAC com chave temporária por execução. O segredo não é registrado ou persistido; o relatório agregado de readiness não apresenta identificadores.
- O pipeline do censo normaliza `trim` + `toLower` para identificar duplicidade entre grafias equivalentes e filtra tipos não string. Formatos legados adicionais ainda precisam ser testados no Mongo real.
- Mantida a política de **somente leitura**, sem dependência de nova coleta de dados de clientes.

## Testes
- Testes do verificador de índice: **20 grupos PASS** (incluindo falso índice parcial com filtro extra, operadores adicionais, collation e forma válida).
- Testes do censo: **PASS**; testes de Portal/dispositivos/2FA com servidor HTTP e Mongo simulado: **10 grupos PASS**.
- `npm run check` no snapshot local: **PASS**, Node v22.16.0.
- **28/28 scripts `tests/*.test.js` presentes no snapshot local passaram**, sem falhas.
- Limitação importante: a fonte local é derivada do ZIP R46.37 com `server.js` candidato verificado por SHA do Git blob; não contém `tests/r46-38-cws-incident.test.js` e outros bytes da fonte remota R46.38. A suíte completa da branch e Node de produção >=24.20.0 **não foram homologados**.
- MongoDB real de staging, transações e Chromium autenticado E2E **não testados nesta rodada**.

## Segurança operacional
Nenhum ajuste da autoridade de titularidade em runtime nesta etapa: a corrida P1 continua sem correção definitiva; criar um índice único na produção agora seria inseguro por causa das duplicatas e do fluxo atual de mudança de e-mail. Não criar ledger ou lock redundante. Nenhuma escrita em Mongo real; nenhuma alteração em clientes, licenças, Cakto, Chrome Web Store, Render ou `main`. A exceção `ZVM_CWS_COMPAT` permanece intocada.

## Próximo checkpoint
Etapa **04D dedicada**: MongoDB de staging isolado, dados 100% artificiais e testes de transação/índice únicos reais antes de escolher a migração atômica de registro, vínculo, troca de e-mail e Cakto. Manter etapa 05 bloqueada até homologação da etapa 04. Não aprovar deploy.
