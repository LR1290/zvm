# ZVM — R46.46 | Checkpoint P0 de estabilidade (somente leitura)

**Data:** 09/10/2026. **Escopo:** Render, GitHub, MongoDB Atlas, Cakto (coleções locais) e gate pré-deploy. **Política operacional:** nenhuma mutação em dados reais, nenhum deploy, nenhum merge na `main`.

## Resultado do bloco (10 checkpoints)

| # | Gate/ação | Resultado | Evidência / limitação |
| --- | --- | --- | --- |
| 1 | Baseline real de produção | PASS | Render serviço `zvm` / workspace `LR1290 Space`; deploy `live` SHA `107e89fff87ef5d549a790bfa7f8c75949e88e6d` (R46.40.1). |
| 2 | Isolamento de publicação | PASS | `autoDeploy=no`, branch `main`, 1 instância Starter; não houve novo deploy nesta rodada. |
| 3 | Estado do Atlas | PASS leitura | `Project 0`, `Cluster0` Free / MongoDB 8.0.34, banco oficial `zapvoice`; não alterado. |
| 4 | Censo de chave/conta | PASS leitura | `store.keys`: 60 entradas (nem todas equivalem a clientes ativos). Censo anterior: 34 `portal_users`, 24 vínculos válidos, 0 grupos canônicos duplicados; não garante propriedade do índice. |
| 5 | Conciliação pagamento→licença | PASS leitura | 23 pagamentos aprovados; todos os 23 apontam para um registro de licença; 14 `renewed=true`, 9 `renewed=false`. |
| 6 | Situação de renovações | Atenção, não erro confirmado | Entre 14 `renewed=true`: 13 chaves ativas e não vencidas; 1 chave inativa e vencida, cujo pagamento mais recente registrado foi em 2026-09-09. Pode ser histórico normal. Não realizar extensão automática. |
| 7 | Fila e idempotência Cakto | PASS parcial | 23 webhooks `processed`, 3 `CAKTO_UNMAPPED_PLAN` de 17/08/2026; 12 claims `completed`; 12 e-mails `sent`. Não equivale a reconciliação exaustiva da API da Cakto. |
| 8 | Observabilidade operacional | PASS parcial | Atlas 0 alertas `OPEN`; filtro Render de `error` não retornou ocorrências. A série `http_latency` do Render veio vazia; não inferir p95. |
| 9 | Inventário estático atual | PASS estático | No GitHub `main`: 36 recursos referenciados, 36 itens no manifest, nenhum arquivo faltante no Git tree nem referência sem allowlist. |
| 10 | Preflight anti-regressão | Implementado em branch, NÃO homologado E2E | `audit/r46.46-asset-preflight`: ferramenta offline `tools/verify-public-assets.js`, testes sintéticos `tests/r46-46-public-asset-gate.test.js`, e acréscimo ao `npm run check`. Inspeção do parser com servidor real detectou 36/36 sem erros; seis cenários simulados de contrato passaram (arquivo normal, MIME, hash, ausente, não permitido, path inválido). **Suíte Node completa e navegador ainda não executados neste checkpoint**, portanto **não fazer merge/deploy**. |

## Segurança e backups — bloqueios antes de avanço em produção

1. **Backup ainda não comprovado:** não foi produzido snapshot, `mongodump` ou restauração verificável nesta rodada. Plano: cópia criptografada para destino externo independente, armazenamento com retenção mínima e ensaio de restauração em ambiente sem acesso a clientes. Não instalar jobs pagos nem guardar dump no repositório.
2. **Escrita por IA no Atlas:** o usuário havia habilitado `Allow read & write connections` na organização. Recomenda-se retornar para `Allow read-only connections` em Organization Settings > App Connections > AI Clients; isso não altera a conexão da aplicação.
3. **Propriedade de licenças:** índices `keyCode_1` e `portal_keycode_unique_v1` presentes; conector `collection_indexes` não expõe `unique` nem `partialFilterExpression`, então é **impossível atestar** por ele o contrato necessário à R46.44. Validar por `listIndexes()` com conexão de leitura autorizada em ensaio protegido, antes de qualquer migração.
4. **Cakto:** não classificar os 9 `renewed=false` como falha de cobrança; podem ser compras iniciais. O único renovado/inativo é histórico e vencido. Requer auditoria do fluxo comercial na API Cakto e conciliação sem PII; a correção R46.41 continua em branch, não implantada.
5. **Build ID obsoleto:** `server.js` tem `ZVM_BUILD_ID='2026-10-08-r46-16-cakto-queue-recovery'` mesmo com produção R46.40.1. Planejar build ID determinístico do SHA do commit, sem alterar contrato de autenticação da extensão.
6. **Quality gate Render:** o comando de build atual só executa `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`. A suíte `npm run check` não é executada automaticamente. O novo gate fica isolado na branch até passar Node suportado e Chromium.
7. **R46.44:** a candidata ainda exige Mongo de staging isolado, índice exclusivo parcial comprovado e teste real de transferência de e-mail; NÃO DEPLOY.
8. **Estado dos bancos antigos:** `watidy` e `zvm_local` não foram apagados; `zapvoice` e sua configuração no Render continuam iguais.

## Protocolo da próxima rodada

- Executar a suíte da branch `audit/r46.46-asset-preflight` em Node >=24.20.0, coletando saída real; efetuar teste Chromium representativo da página pública.
- Preparar verificação de backup/restauração e plano de rollback sem exportação desnecessária de dados de clientes.
- Validar metadados de índices sem escrita; atualizar a candidata R46.44 apenas depois de baseline e testes de transação reais em staging.
- Avançar no reconciliador Cakto somente em modo `--audit`, sem replays, cobranças ou renovações automáticas.

**Declaração de não impacto:** nenhum deploy Render, nenhuma alteração Atlas, nenhum merge em `main`, nenhuma mudança em clientes, chaves, cookies, pagamentos ou webhooks.
