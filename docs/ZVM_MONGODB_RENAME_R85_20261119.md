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


## R86 — validação cruzada e backup externo

- Em 19/11/2026, a cópia sintética REAL entre bancos separados do Atlas (zvm_migration_r86_source para zvm_migration_r86_target) preservou 2 documentos fictícios e um índice secundário. O conector retornou erro de transporte, mas a leitura posterior comprovou a escrita. Ambos os bancos de laboratório foram excluídos e a ausência foi confirmada.
- CI especializado R85+R86: 22 controles da R85 e 17 controles da R86 passaram. O R86 verifica a execução real do módulo com mocks independentes e uma resposta ambígua após $out, sem autorizar sobrescrita.
- O banco oficial zapvoice permanece em uso. Em leitura posterior, a quantidade de objetos variou de 1.228 para 1.223 (por exemplo, índices TTL podem expirar documentos automaticamente): sem congelar writers, não existe garantia de instantâneo consistente.
- Por ser um cluster Atlas FREE, não presumir que há snapshot sob demanda. Backups gratuitos opcionais dependem de disponibilidade do Atlas. Para execução auditável, usar MongoDB Database Tools.

### Backup externo de operação Windows — não executado nesta etapa
1. Instalar MongoDB Database Tools 100.3+ (mongodump e mongorestore no PATH).
2. Em diretório privado fora do repositório, criar arquivo YAML de configuração do MongoDB Database Tools contendo a URI do Atlas. Nunca inserir URI, senha ou licença no GitHub, em logs ou no chat.
3. Escolher unidade criptografada / protegida para o arquivo de backup.
4. Executar no PowerShell em diretório do repositório:

   powershell -NoProfile -ExecutionPolicy Bypass -File tools/zvm-db-backup-readonly.ps1 -MongoConfigYaml "C:\SEGREDOS\mongodb-tools.yml" -BackupDirectory "E:\ZVM-Backups"

5. O script executa mongodump na base zapvoice com BSON e metadados, usa mongorestore --dryRun sem gravar dados e produz archive.gz mais manifesto SHA256. Sem parar writers, o próprio manifesto indica backup preliminar.
6. Para um backup final no corte, rodar somente depois de interromper e conferir TODOS os escritores, com a opção -IConfirmWritersPaused. Essa opção é declaração do operador, não para os serviços.
7. Dry-run não substitui restauração real em banco ou cluster isolado, conferindo contagem e índices antes da troca. Armazenar e transportar o archive de forma criptografada.
8. O backup é proteção extra. Não mudar MONGODB_DB no Render antes da transferência e reconciliação sem divergências.

Código de backup não é executado automaticamente pela CI e não precisa conhecer credenciais. Na CI, só o parser do PowerShell é executado.


## R87 — trava de mudança de banco no boot
- Antes de abrir o acesso à nova base, o próprio servidor verifica se MONGODB_DB=zvm, exige ZVM_DB_CUTOVER_CONFIRMED=zapvoice-to-zvm-verified e confirma, SOMENTE LEITURA, a existência de store, portal_users, payments, extension_sessions, webhook_events e cakto_mail_outbox.
- O guarda verifica presença de pelo menos uma chave antiga oficial (zv-...) ou KEY V2 oficial (zv2a-...), pelo menos uma conta do portal e um pagamento; não registra nem transfere chaves reais ou dados de clientes.
- Se alguma condição falhar, o servidor NÃO assume o banco novo e lança erro de configuração de corte. A opção padrão ainda é zapvoice: nenhum cliente é migrado automaticamente.
- Depois do backup externo protegido e da pausa coordenada de todas as escritas, cópia e comparação da base zvm, o operador deve ajustar MANUALMENTE MONGODB_DB=zvm e ZVM_DB_CUTOVER_CONFIRMED=zapvoice-to-zvm-verified no Render, com deploy MANUAL. Jamais configurar a flag sem realizar e comprovar a migração.
- A flag evita erro humano ao mudar a conexão cedo demais, mas não prova por si só a consistência do backup ou a parada das escritas: isso exige procedimentos operacionais independentes.
