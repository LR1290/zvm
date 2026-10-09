# R46.39 — Etapa 04: checkpoint técnico (2026-10-09)

**Estado:** correções candidatas em `audit/r46.39-stability`, ainda **não homologadas**. Produção `main` R46.38 (`7b58b35048ea2d107a61893e2de21a5e313028ec`) não modificada. Não fazer merge ou deploy antes dos gates.

## Correções candidatas
- `server.js`: `getPortalUser()` invalida sessões vencidas/malformadas, inclusive pré-2FA; depois da verificação TOTP a sessão pendente é revalidada antes de promovê-la.
- `/cliente/dispositivos/remover`: formulário envia identificador estável `phone`, não `index`. Formulário antigo resulta em HTTP 409, sem excluir dispositivo incorreto. A gravação passa a reutilizar o CAS persistido `mutateAdminKeyRecordStrict`, retornando 409 em conflito com Cakto/Admin.
- Índice `portal_users.keyCode`: falhas de criação deixam de ser ignoradas e são logadas só com o código do erro, sem PII. **O índice permanece não exclusivo**.
- `tools/r46-39-ownership-census.js`: inspeção somente-leitura de duplicidades, com `--audit`, conta de banco com privilégios de leitura e saída limitada a contagem/hash. **Ainda não executada contra banco real**.

## Falha P1 comprovada em simulação HTTP
No servidor real (`handleRequest`) executado localmente com Mongo simulado e duas contas `.invalid`: requisições sequenciais a `/cliente/vincular` recusam a segunda associação; solicitações simultâneas com consultas intercaladas retornam sucesso às duas e criam dois documentos com o mesmo `keyCode`. Demonstra a corrida *check-then-write* sem índice único. Não atesta exposição ou duplicidade em produção.

**Não criar índice exclusivo automaticamente:** `/cliente/email` insere uma nova conta com a mesma chave antes de remover a antiga; Cakto também vincula a chave ao titular. Migração da propriedade deve considerar todas essas rotas, dados legados e rollback, sob Mongo isolado.

## Gates e evidências
- Fonte `server.js` original do ZIP R46.37 tem Git blob **idêntico** ao `main` R46.38: `5f48de83767993dbfc809ad71bf3bde9c35eff4d`. Candidato em branch: `64ce87361a799324fe5a6341240ad4a75d7f0d96`.
- 28 scripts locais de teste R46.37 + R46.39 passaram individualmente, 0 falhas; testes com mocks, Node 22.16.0.
- `tests/r46-39-portal-auth-cas.test.js`: **10/10** grupos HTTP isolados (titulares distintos, dispositivos, CAS, 2FA).
- `tests/r46-39-ownership-census.test.js`: **8/8** checagens com fake Mongo, zero writes reais.
- Chromium: HTTP local renderizou HTML 200; inspeção do DOM por `page.set_content` confirmou 2 identificadores `phone`, 0 índices. Navegação Chromium direta bloqueada pelo ambiente (`ERR_BLOCKED_BY_ADMINISTRATOR`); **não houve E2E Chromium completo**.
- `npm ci --offline` indisponível por falta de `whatwg-url` no cache e Node local 22 (produção exige >=24.20). **`npm run check` completo na versão de produção pendente**.

## Próximo checkpoint
Staging Mongo exclusivamente fictício; census readonly; corrigir associação atômica única para registro/vínculo/mudança de e-mail/Cakto/Admin; índice exclusivo parcial somente após censo/limpeza testados; stress concorrente, Node 24+, Chromium autenticado e rollback. Só depois encerrar a etapa 04 e iniciar a 05.

**Nenhum deploy Render, merge na main, alteração de licenças reais ou desligamento de `ZVM_CWS_COMPAT`.**
