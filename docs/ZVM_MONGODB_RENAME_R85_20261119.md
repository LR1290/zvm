# ZVM — Migração controlada Atlas zapvoice → zvm (19/11/2026)

## Situação forense confirmada
- Atlas Cluster0: zapvoice possui 20 coleções, 1.228 documentos e 49 índices; 61 chaves de 20 caracteres, 39 contas e 33 pagamentos.
- watidy tinha 5 coleções e 11 documentos; suas 2 chaves e 2 contas já existem em zapvoice. Após a cópia exata dos 11 documentos para zvm_migration_backup_20261119, o banco watidy foi excluído, e a ausência dele foi conferida no Atlas.
- zvm ainda não contém a migração principal; zvm.onrender.com está com autoDeploy desativado e a política de publicação exige ação manual.
- zvm_local, zvm_cloud_pilot e zvm_lite_staging_20261118 são independentes: não alterar.

## Por que não renomear diretamente
MongoDB não oferece uma operação simples e segura de renomeação integral de banco que preserve o fluxo de escrita. Precisamos copiar os BSON e índices, validar a igualdade, alterar a conexão de forma coordenada e só depois retirar a origem. Pagamentos Cakto, sessões e workers podem gravar durante a migração; deve haver uma janela sem escritas.

## Código entregue no PR isolado
- server.js usa o nome real configurado no log de boot, preserva fallback para zapvoice até o corte e rejeita o banco já extinto watidy.
- runtime-config.js bloqueia homologação tanto no banco atual zapvoice quanto no futuro zvm.
- tools/zvm-mongodb-migrate.js tem ações audit e verify somente leitura; copy exige duas variáveis de autorização, recusa alvo não vazio, copia BSON nativo via $out do Mongo, reproduz definições de índices e valida conteúdo e índices.
- Não existe qualquer comando de apagar o banco de origem no migrador. Testes são sintéticos sem acessar licenças reais.

## Procedimento operacional para o corte, ainda NÃO executado
1. Validar o código e CI, revisar integrações das branches ZVM KEY V2 e LITE.
2. Fazer e testar backup EXTERNO de zapvoice (mongodump/restore ou snapshot válido). O banco original será mantido durante a observação, mas não substitui backup externo antes de exclusão definitiva.
3. Pausar todas as escritas na origem, incluindo serviço Render oficial, workers, Cakto e serviços auxiliares eventualmente ligados ao mesmo DB. Confirmar política de retries dos webhooks para evitar eventos perdidos.
4. No ambiente autorizado com URI injetada, sem exibir credenciais:
   Auditoria somente leitura: node tools/zvm-mongodb-migrate.js audit
   Cópia (apenas depois de parar writers):
   ZVM_MONGO_MIGRATION_ACK=zapvoice-to-zvm ZVM_MONGO_WRITERS_PAUSED=writers-stopped node tools/zvm-mongodb-migrate.js copy
   Comparação somente leitura: node tools/zvm-mongodb-migrate.js verify
   Se a cópia falhar ou o alvo já tiver coleções, interromper; não sobrescrever sem auditoria humana.
5. No Render da ZVM oficial, configurar manualmente MONGODB_DB=zvm, disparar deploy manual da revisão homologada e verificar /ready, login antigo V3/V4, portal, pagamentos, Cakto, fila de e-mails, renovações, CRM e sessões.
6. Retomar writers, observar a aplicação. Não deletar zapvoice sem confirmação final, backup externo e reconciliação de possíveis escritas após o corte. Rollback requer parar writers, restaurar MONGODB_DB=zapvoice, deploy manual e conciliação de dados.

## Proteções ativas
- Nenhum deploy/merge/autodeploy nesta etapa.
- Sem alterações no servidor oficial, nem no banco zapvoice.
- Backup temporário de watidy está isolado e documentado; a sua remoção deve ocorrer apenas depois do encerramento da janela de recuperação.
