# ZVM — R46.52 checkpoint de continuidade segura

Data: 2026-10-09 (America/Sao_Paulo). Sem deploy ou gravação de dados reais nesta rodada.

## Estado de produção confirmado

- Render: serviço `zvm` (`srv-d8co50mq1p3s7390p80g`), workspace `LR1290 Space`, `autoDeploy=no`, 1 instância, health `/ready`.
- Commit ativo no Render: `107e89fff87ef5d549a790bfa7f8c75949e88e6d` (R46.40.1). Health externo `/ready` HTTP 200, JSON `ok:true`. Consulta recente de logs `error` no Render retornou 0.
- GitHub `main` contém **somente acréscimos operacionais** em relação ao commit do Render: PR #5 (asset gate e relatórios) e PR #8 (script operador de backup e runbook). Não disparar deploy apenas para esses acréscimos.
- MongoDB Atlas: `Project 0 / Cluster0` (tier Free), banco oficial `zapvoice`. Banco `zvm` ainda não existe com dados; `watidy` e `zvm_local` preservados. Nenhuma migração, indexação ou exclusão.

## Entregas desta rodada

1. **PR #5 merged**: preflight de recursos públicos em `tools/verify-public-assets.js`, teste de regressão e inclusão em `npm run check`. Local Node 22.16.0 `npm run check` passou na equivalência R46.40.1 (36 recursos), mas release Node >=24.20.0 do commit exato ainda não homologado.
2. **PR #8 merged**: `tools/backup-zapvoice-encrypted.sh`, teste Bash artificial e `audits/R46_51_BACKUP_RECOVERY_PLAYBOOK.md`. Testado com `mongodump` fictício, GPG real, descriptografia, SHA256, permissões restritas e falha de dump. **Nenhum backup REAL foi produzido nem restaurado**.
3. Monitoramento condicional de disponibilidade e de possível falha recente de renovações Cakto criado, sem escrita de dados.
4. **Leitura Cakto:** 24 pagamentos aprovados no momento da última consulta, todos com marcador exato de transação no registro de licença. Dois pagamentos `pix_auto` com `renewed=false` não têm pagamento aprovado anterior para a mesma chave; são compatíveis com compras iniciais, e não prova de falha de renovação. Nenhum pagamento foi alterado.

## Bloqueios P0 (não maquiar)

- Backup real criptografado e restauração real isolada para provar recuperabilidade, com destino externo e credenciais de leitura. Ferramentas MongoDB Database Tools/servidor e armazenamento off-site não estão disponíveis neste ambiente do assistente.
- Índice de `portal_users.keyCode` requer metadados completos `unique/partialFilterExpression`; conectores disponíveis devolvem nomes/chaves sem opções. Não publicar R46.44 sem prova e transações reais num Mongo staging separado.
- Cakto: comparação de histórico na API da provedora e prazo estendido para cada pagamento recorrente. O hotfix de marcador exato está no PR #6, não publicado.
- Runtime Node >=24.20.0 (o runtime disponível para testes locais foi 22.16.0) e Browser E2E staging; sem isso não liberar PR #6 ou #7 para Render.
- Segurança: retornar a permissão de clientes IA no Atlas a somente leitura pelo painel da organização quando não houver operação com escrita. Isso não altera a conta usada pela aplicação.

## Disposição de branches

- PR #5: integrado à main (apenas tooling/testes/docs).
- PR #8: integrado à main (apenas scripts manuais de backup, testes e docs).
- PR #6: **rascunho**; exige homologação de Cakto.
- PR #7: **rascunho**; exige staging Mongo real e índice único parcial comprovado.

**Regra permanente:** não modificar banco de produção ou desplugar fluxo de licenças sem backup restaurável, teste staging e rollback.
