# ZVM — R46.42 | Checkpoint de consolidação de servidor

Data: 2026-10-09. Baseline imutável: `main` R46.38 (`7b58b35048ea2d107a61893e2de21a5e313028ec`).

## Artefatos que passaram nos testes locais

- Termos R46.40: `feature/r46.40-termos-servico`. `/termos` PT-BR/PT-PT/EN, 16 seções, CSS mínimo e footer canônico.
- Cakto R46.41: `hotfix/r46.41-cakto-exact-tx-marker`. `server.js` Git blob `af79b55528b3068d6f3e89ba7da08095182940bf`. Identificadores de transação eram comparados por substring: prefixos coincidentes podiam suprimir renovação real ou recuperar licença errada. Comparação exata por linha agora é aplicada em 3 pontos; testes específicos e `npm run check` passaram no Node 22.
- Candidata combinada: `candidate/r46.42-terms-cakto-review`. `server.js` blob `74622589737d988d2e9e39ab64a917af06dedbb4`, `package.json` blob `bb6759ea0ad7f639f82261e12d3b335ef5a1f01b`. Suite `npm run check` local aprovada. **Não integrar a branch audit/r46.39-stability automaticamente.**
- R46.38 Build Authority de base: `5411ae116d482345434e0fbfcba0fd2b67bf5753` validado byte a byte na homologação; `ZVM_CWS_COMPAT` e Build 3 preservados.

## Pendências não encerradas

1. **P1 de autorização R46.39:** corrida entre contas ao vincular a mesma licença. Falta Mongo staging real, censo read-only, refatoração transacional/índice que preserve troca de e-mail e Cakto, rollback e testes E2E.
2. **Cakto produção:** a reprodução local da colisão é real, mas não prova que seja causa única das renovações que não estenderam licenças. Falta conciliação read-only de webhooks, claims, pagamentos e datas no banco real; não editar licenças sem trilha auditável.
3. **Termos:** identificação civil/empresarial completa, vigência, validação de reembolso/cancelamento e revisão jurídica PT-BR/PT-PT/EN.
4. **Homologação:** Node >=24.20, Mongo replica set segregado, Chromium via URL em staging real, performance/rotas públicas, avaliação da CWS real.
5. **OAuth:** inscrição da URL /termos em Branding depende de aprovação jurídica e publicação HTTPS expressamente autorizada.

## Segurança operacional

Nenhum merge, deploy Render, alteração em cliente, senha, chave real, índice Mongo real, Google OAuth ou publicação na Chrome Web Store foi executado. Não declarar servidor integralmente homologado. Qualquer release depende de decisão expressa do responsável, com rollback.

**Relatório para usuário:** `ZVM_R46_42_RELATORIO_CONSOLIDACAO.md` (artefato de conversa).
