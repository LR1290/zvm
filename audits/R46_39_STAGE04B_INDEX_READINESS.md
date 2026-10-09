# ZVM - Automações — R46.39 Etapa 04B | Pré-voo de migração de titularidade

Data: 2026-10-09 | Escopo: auditoria sem alteração de dados comerciais

## Estado e proteção de produção
- Produção preservada: `main` SHA `7b58b35048ea2d107a61893e2de21a5e313028ec` / R46.38.
- Candidatos e ferramentas somente na branch `audit/r46.39-stability`; nenhum merge, deploy, alteração de licença ou escrita no banco.
- `ZVM_CWS_COMPAT`, API legada Build 3 e integrações de pagamento mantidos intocados.

## Novo artefato técnico
`tools/r46-39-ownership-readiness.js` compõe o censo somente-leitura existente e analisa índices, quantidade agregada de vínculos e trocas de e-mail em andamento. Saída sem endereço de e-mail, nome, número de telefone ou código de licença, inclusive nos erros. Execução CLI deliberadamente bloqueada sem `--audit`, variáveis de ambiente separadas e conta Mongo com permissões efetivamente *read-only*.

O relatório indica como bloqueios: duplicatas, limite de 50 grupos no censo, troca de e-mail em andamento e ausência de um índice de unicidade parcial que cubra somente `keyCode` não vazio do tipo string. O campo `safeToDeploy` é **sempre false**: pré-voo não certifica migração nem segurança transacional.

## Evidência técnica relevante para a correção definitiva
1. `/cliente/registro` faz `findOne(keyCode)` seguido de `insertOne` sem exclusividade no banco.
2. `/cliente/vincular` faz `findOne(keyCode)` seguido de `updateOne`, permitindo concorrência entre contas.
3. `/cliente/email` insere conta de destino com a mesma `keyCode` antes de excluir a origem. Assim, impor índice único sem refatorar a migração quebra esse fluxo.
4. `_processCommercialSaleUnlocked` usa `linkPortalUser` para associar a compra pelo e-mail, fazendo `updateOne` sem controle global da titularidade. Precisa participar do mesmo contrato de exclusividade; não tocar na fila/claims Cakto até essa migração estar ensaiada.
5. Os fluxos Admin/Portal/Extensão devem concordar com uma autoridade de licença: sessões antigas, revogação, mudança de e-mail e renovação são critérios de aceite.

## Conclusão sobre estratégia Mongo
MongoDB oferece filtro parcial com `$gt`, `$type` e `$and`, e um índice único parcial aplica a restrição somente aos documentos contemplados por esse filtro. Índice único simples em `keyCode` bloquearia contas sem licença (`null`/campo ausente). A criação é impossível se houver duplicatas que violem a restrição. Não executar `collMod`, `dropIndex`, `createIndex` exclusivo ou deduplicação em produção nesta rodada.

Consultar documentação oficial:
- https://www.mongodb.com/docs/manual/core/index-partial/
- https://www.mongodb.com/docs/manual/core/index-unique/

**Em staging real**, testar `unique` parcial com filtro para `keyCode` string não vazia e analisar compatibilidade com índice legado e com a sequência de alteração de e-mail. Não presumir que alterar a ordem de `insertOne`/`deleteOne` na mesma transação resolve a exclusividade sem testar no Mongo real.

## Testes reexecutados nesta rodada
- Node 22.16.0 local: 28 arquivos `tests/*.test.js` passaram, 0 falhas. Compatibilidade com Node de produção >=24.20.0 permanece pendente.
- `tests/r46-39-ownership-readiness.test.js`: 14 grupos aprovados (legado não único, duplicidades, truncamento, troca de e-mail em andamento, filtro parcial válido/inválido, ausência de escrita, erro de banco).
- `tests/r46-39-portal-auth-cas.test.js`: 10 grupos aprovados; `tests/r46-39-ownership-census.test.js`: 8 grupos aprovados.
- Não houve Mongo real nem browser E2E nesta rodada (nenhum componente visual foi modificado).

## Checkpoint seguro
Não continuar com substituição do esquema de titularidade sem ambiente isolado que suporte transações Mongo. Etapa 04 **continua aberta**, etapa 05 de reconciliação Cakto **não iniciada**. Não liberar branch como Release.
