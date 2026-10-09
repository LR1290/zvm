# ZVM — R46.43 Pré-publicação | Bloqueios de release
Data 2026-10-09. Base `main` R46.38 commit `7b58b35048ea2d107a61893e2de21a5e313028ec`.

## Resultado verificado
- `candidate/r46.42-terms-cakto-review`: candidate `server.js` blob `74622589737d988d2e9e39ab64a917af06dedbb4`, `package.json` blob `bb6759ea0ad7f639f82261e12d3b335ef5a1f01b`, `build-authority.js` idêntico à main `5411ae116d482345434e0fbfcba0fd2b67bf5753`.
- `npm run check` repetido e aprovado no Node 22.16, incluindo CWS/Build 3, Cakto, Termos PT-BR/PT-PT/EN, privacidade e Portal.
- Chromium com HTML HTTP local e CSS inline, desktop e mobile: 16 seções, um H1, sem scroll horizontal, zero exceções JS. Não equivale a E2E HTTPS em staging.
- Cakto R46.41: comparação exata de marcadores de transação remove colisão de prefixo reproduzida. Casos de cobrança reais ainda requerem conciliação.
- A branch `audit/r46.39-stability` ganhou `src/portal-license-owner.js` e `tests/r46-39-portal-license-owner.test.js`, **código de staging não integrado aos handlers do servidor**. Contrato equivalente local: 23 grupos de teste PASS; a versão adicionada ao GitHub deve ser reexecutada após checkout limpo.
- Simulador Mongo de staging 04D: 20 verificações + 25 grupos de proteção; sem Mongo real.
- Scripts de staging e reconciliação Cakto negam execução sem as flags exigidas; nenhum cliente real foi consultado/alterado.
- Audit de dependência **offline**: 0 no cache, não substitui consulta atualizada de CVE.

## Release gates P0/P1 obrigatórios
1. Corrida de vinculação/registro: índice único parcial de `portal_users.keyCode` e fluxo transacional de troca de e-mail (incluindo reencriptação 2FA), Cakto, admin, dados legados. Precisa Mongo staging segregado com contas fictícias e censo somente-leitura.
2. Reconciliar renovações Cakto reais sem escrita no banco e validar webhooks/claims/outbox/entitlements.
3. Executar suíte na engine Node >=24.20, testes HTTP/Chromium E2E em staging (sem autorização de deploy em produção).
4. Completar identificação legal do fornecedor e políticas Cakto; revisão jurídica dos Termos nos três idiomas.
5. Confirmar identidade exata da versão CWS 0.9.0 antes de retirar compatibilidade emergencial e homologar OAuth Drive/People API.

**Decisão técnica: NÃO FAZER MERGE NEM DEPLOY GERAL.** A candidata R46.42 e os patches R46.39 permanecem segregados. Nenhum servidor de produção, licença ou chave foi modificado.
