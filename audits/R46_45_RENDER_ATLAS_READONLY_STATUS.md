# ZVM — R46.45 | Render + MongoDB Atlas: checkpoint somente leitura

Data de inspeção: 2026-10-09. Verificação via conectores oficiais Render e MongoDB Atlas, sem operações de escrita.

## Render — workspace confirmado LR1290 Space

- Serviço de produção: `zvm` (ID `srv-d8co50mq1p3s7390p80g`), URL `https://zvm.onrender.com`, repo `LR1290/zvm`, branch `main`.
- Último deploy: `dep-db4edfu7bikc73efjpq0`, commit `7b58b35048ea2d107a61893e2de21a5e313028ec` (R46.38), status `live`, concluído `2026-10-09T13:07:00Z`.
- `autoDeploy=no`; build command `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`; start `npm start`; health path `/ready`; plano starter; 1 instância.
- Consultas de logs recentes com nível `error` ou status HTTP 500/502/503: zero registros devolvidos nas janelas consultadas. Ausência de logs filtrados **não prova** ausência absoluta de falhas.
- Render confirma que nem R46.42 nem R46.44 foram implantadas.

## Atlas — Project 0, Cluster0, banco zapvoice

Consultas somente de leitura, sem retornar informações pessoais, código de licença ou ID de transação.

- `portal_users`: 34 contas, 24 licenças vinculadas, nenhuma duplicidade canônica identificada no censo feito anteriormente, nenhuma mudança de email pendente.
- `payments`: 23 documentos com `approved=true`.
- `webhook_events`: 23 eventos `processed`, 3 `CAKTO_UNMAPPED_PLAN`; estes 3 criados em 2026-08-17 e com `attempts=1`. Sem conclusão sobre se são testes ou falhas de compras.
- `commercial_tx_claims`: 12 em `completed`.
- `cakto_mail_outbox`: 12 em `sent`.
- Dois índices sobre `portal_users.keyCode`: `keyCode_1` e `portal_keycode_unique_v1`; ferramenta de índices não devolveu metadados suficientes para certificar a opção `unique` ou seu `partialFilterExpression`.

## Gates de próxima rodada

1. Investigar `CAKTO_UNMAPPED_PLAN` apenas por contagens e eventuais IDs de oferta não pessoais, sem escrita, antes de associar a reclamações recentes.
2. Obter prova completa das opções do índice de titularidade e ensaio com Mongo staging segregado (não criar índice em produção sem plano).
3. Comparar renovação comercial com validade das licenças em leitura; não inferir equivalência 1:1 de documentos de pagamentos, claims e e-mails.
4. Homologar R46.44 Node >=24.20.0 e browser real; o build do serviço de produção hoje não executa `npm run check` como parte do build command.
5. Não efetuar merge, deploy, alteração em ambiente, exclusão de bancos nem escrita no Atlas até os gates serem cumpridos.

**Estado:** produção R46.38 continua ativa e preservada. Registro meramente documental na branch de auditoria.
