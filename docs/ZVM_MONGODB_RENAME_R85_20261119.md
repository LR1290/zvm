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


## R88 — estabilidade da origem e checagem de concorrência

- O migrador agora computa um resumo SHA-256 por coleção, com conteúdo BSON representado de modo canônico, quantidade de documentos e definições completas de índices, **antes de iniciar qualquer escrita no destino**.
- Depois de copiar as coleções e comparar a origem com o destino, repete a leitura integral da origem. Se algo mudou durante o processo (licença, pagamento, sessão, índices ou quantidade de registros), interrompe com `source_changed_during_migration`; **não autoriza o corte**.
- A assinatura não é exposta em logs nem gravada no MongoDB; tem a finalidade de detectar alterações concorrentes, não substituir o backup externo.
- Uma comparação dupla **não torna a migração online segura**: para preservar a consistência transacional entre coleções e eventos da Cakto, todos os writers precisam estar parados durante o corte. Indexes TTL do próprio MongoDB ainda podem expirar documentos, devendo qualquer divergência abortar o corte.
- Testes R88 usam somente dados sintéticos e simulam alterações de chave antiga, pagamento, índice e conjunto de coleções; R86 também simula atualização de ambos os bancos depois da cópia para provar que igualdade simples não basta.


## R89 — backup realmente restaurável e prova vinculada ao archive

Flags de operador, sozinhas, não comprovam que existe backup real. Por isso a ação COPY agora exige, ANTES de abrir qualquer conexão ao Atlas:
- ZVM_MONGO_BACKUP_MANIFEST apontando ao manifesto de backup PowerShell (banco zapvoice, dryRunVerified=true, writersReportedPaused=true, SHA-256 real e tamanho do archive).
- ZVM_MONGO_RESTORE_PROOF apontando ao comprovante de RESTAURAÇÃO REAL em MongoDB local isolado: vincula SHA-256 do mesmo archive, pelo menos 20 coleções, 49 índices, chave oficial, portal e pagamentos presentes, e limpeza do banco local comprovada.
- O arquivo archive.gz ainda existir, com bytes/sha256 idênticos ao manifesto; qualquer divergência aborta antes do cutover.

O programa tools/zvm-mongodb-local-restore.js gera a prova; exige mongorestore e mongod LOCAL, exclusivamente 127.0.0.1 ou localhost. Rejeita URI externa, usuário/senha, conexões com roteamento ou parâmetros inesperados; cria namespace temporário aleatório zvm_restore_r89_* e faz drop SOMENTE dessa base provisória, com validação posterior. Os dados restaurados permanecem temporariamente no disco local: usar disco criptografado (BitLocker) e não compartilhar os arquivos.

### Procedimento Windows, ainda NÃO executado
1. Instalar MongoDB Server local e MongoDB Database Tools, mantendo a instância de testes vinculada apenas ao loopback (127.0.0.1).
2. Depois de suspender e verificar todos os writers de produção, gerar o backup DEFINITIVO com o script PowerShell anterior, incluindo a chave -IConfirmWritersPaused, em disco privado/criptografado.
3. Definir no PowerShell as variáveis ZVM_MONGO_BACKUP_MANIFEST (caminho completo .sha256.json), ZVM_LOCAL_RESTORE_URI=mongodb://127.0.0.1:27017 e ZVM_LOCAL_RESTORE_ACK=restore-archive-local-only; rodar node tools/zvm-mongodb-local-restore.js.
4. O script confere o archive, restaura, valida registros e índices, elimina a base temporária e grava o comprovante .archive.gz.restore-proof.json na mesma pasta. Um arquivo de prova preexistente é motivo para interromper, nunca sobrescrever.
5. Definir ZVM_MONGO_RESTORE_PROOF para esse comprovante; manter manifesto e archive íntegros.
6. Somente com todos os writers pausados, definir ZVM_MONGO_MIGRATION_ACK=zapvoice-to-zvm, ZVM_MONGO_WRITERS_PAUSED=writers-stopped, disponibilizar MONGODB_URI por ambiente privado e executar node tools/zvm-mongodb-migrate.js copy.
7. Executar node tools/zvm-mongodb-migrate.js verify. Fazer corte MANUAL no Render com MONGODB_DB=zvm e ZVM_DB_CUTOVER_CONFIRMED=zapvoice-to-zvm-verified, e validar a ZVM completa; jamais apagar zapvoice prematuramente.

A verificação da restauração local comprova recoverability do archive, NÃO comprova por si só que todos os escritores foram pausados ou que os pagamentos não mudaram depois do backup. Se o backup for anterior ao congelamento, criar novo archive e nova prova. O script não tem processo de deploy, e os testes da CI só usam dados sintéticos.


## R90 — equivalência integral do backup restaurado e a origem

Uma contagem mínima de coleções, índices, chaves, clientes e pagamentos não comprova que um arquivo compactado é a cópia integral atualizada. O procedimento de corte agora tem uma barreira obrigatória:

1. A RESTAURAÇÃO REAL, em MongoDB local temporário, calcula um checksum SHA-256 de TODAS as coleções, seus documentos BSON ordenados e definições de índices, usando o mesmo snapshotDatabase do migrador. Não imprime documentos, chaves nem e-mails.
2. Só depois de confirmar que o banco local temporário foi excluído, o programa registra no comprovante restore-proof.json o campo sourceChecksum, vinculado ao SHA-256 do archive.gz validado.
3. Na ação CLI copy, o migrador confere a prova do archive real ANTES de conectar ao Atlas; então lê toda a fonte zapvoice ANTES de escrever qualquer coleção em zvm e exige que a assinatura atual corresponda ao checksum do backup restaurado.
4. Se um pagamento, licença, usuário, sessão, webhook, documento TTL ou índice mudou desde a captura do backup, rejeita com backup_source_checksum_mismatch SEM TOCAR NO DESTINO. Não aceita backup preliminar anterior à pausa dos writers.
5. A R88 continua conferindo novamente a fonte APÓS a cópia e a verificação BSON do destino precisa continuar idêntica. São três provas independentes: archive restaurado == fonte congelada antes, fonte == destino, fonte antes == fonte depois.
6. Os testes R86 simulam archive restaurado correto, assinatura incorreta e renovação de pagamento posterior à captura do backup. R89 rejeita comprovantes sem assinatura e valida a integração com o restorer.

Esse mecanismo detecta divergências mas NÃO substitui a pausa coordenada dos escritores, a confirmação das permissões da credencial no novo banco e a aprovação manual do deploy. Se o backup e a fonte diferirem, gerar novo backup e nova prova com todos os writers parados. Nunca editar manualmente o checksum.

NOTA: comprovantes locais de R89 sem sourceChecksum ficam intencionalmente inválidos na R90. Gerar novo comprovante com o restorer atualizado.


## R91 — integridade de opções das coleções

O migrador agora inclui também as configurações de cada coleção no hash das fontes e do backup restaurado: validadores, validationAction, validationLevel, collation, opções de coleção capped, clusteredIndex e demais valores listados em listCollections.options. Não inclui UUIDs/metadados transitórios, nem imprime conteúdo de documentos.

Antes de aceitar a comparação fonte/destino, o comparador valida igualdade canônica das opções de TODAS as coleções. Se uma coleção destino tiver validação diferente da origem, falha com collection_options_mismatch:NOME mesmo que todos os documentos e índices sejam exatamente iguais.

A R91 acrescenta testes sintéticos de divergência de validador, collation, nível/ação de validação e opções capped. A R86 injeta diferença de validationAction durante uma cópia e comprova que o corte seria recusado. A R88 passa a detectar mudanças apenas na configuração da coleção, sem qualquer modificação em documentos.

Nota operacional: a restauração local de mongodump precisa preservar as opções de todas as coleções; qualquer diferença entre o backup restaurado e o Atlas faz o comando COPY abortar ANTES da primeira escrita no destino. Nenhum upgrade/reformatação automática de opções deve ser realizado em produção sem investigação.


## R92 — teste integrado real com MongoDB 8 isolado, sem dados dos clientes

A auditoria revelou que um comparador genérico ordenava alfabeticamente as chaves dos índices compostos. MongoDB trata os índices {status:1,createdAt:-1} e {createdAt:-1,status:1} como **diferentes**. Corrigido o indexSignatures para preservar a ordem das colunas em cada índice, mas permitir ordem arbitrária da LISTA de índices.

A suíte sintética de teste agora inclui um container descartável MongoDB 8.x no GitHub Actions, vinculado apenas a 127.0.0.1:27018, sem URI Atlas, sem chaves reais e sem acesso de produção:
- Semeia 20 coleções reais com 49 índices, com uma chave legada ativa, uma wt- histórica inativa, KEY V2 fictícia, conta e pagamento fictícios Decimal128, documento BinData e Date, validador e collation.
- Executa realmente os comandos oficiais mongodump e mongorestore em outro database do container, preservando BSON, índices e opções da coleção; inspeciona hashes integrais e todas as 20/49 estruturas.
- Executa o módulo real copyDatabase com $out entre bancos distintos no mesmo MongoDB e verifica a paridade/estabilidade e o bloqueio contra rerun sobre alvo preenchido.
- Ao fim, apaga apenas os três namespaces de laboratório e destrói o container, mesmo em erro. O script recusará execução fora do ambiente explícito GitHub Actions e sem confirmação de laboratório.
- O job não tem secrets, não usa MONGODB_URI e não cria bancos no Atlas. Se falhar, NÃO interpretar os testes sintéticos R85-R91 como prova de funcionamento real: corrigir causa e repetir o teste integrado até ficar verde.

Não executar a R92 contra Atlas, e nunca autorizar produção somente porque a R92 passou: backup externo real, writers parados, checagem do credenciamento e deploy manual continuam exigidos.
