# R46.51 — procedimento de backup criptografado da ZVM

**Estado:** preparado e testado com dados fictícios; **nenhum backup real de clientes foi executado**, nem restauração real comprovada. **NÃO efetuar migração, exclusão do `zapvoice`, escrita corretiva de índices ou publicação da R46.44 enquanto estes gates estiverem abertos.**

## Contexto e limites

- O ambiente de produção usa `zapvoice` no Atlas Cluster0 (tier Free). O nome do banco é intencionalmente mantido até migração controlada.
- A ferramenta `tools/backup-zapvoice-encrypted.sh` lê esse banco via `mongodump --config` e envia o conteúdo diretamente por pipe ao GPG com AES-256. Não grava dump em claro no disco e **não escreve no MongoDB**.
- Exige MongoDB Database Tools >=100.3 com suporte a `--config`, GPG, `gzip`, `sha256sum`, Bash e destino persistente fora do diretório de código/temporários.
- **Não rodar de dentro do Render web-service**, onde o armazenamento local não deve ser considerado backup persistente; prefira operador/host independente, com destino criptografado e off-site.
- **Não adicionar URI, chave GPG, passphrase, dump, IDs de clientes ou credenciais ao GitHub, logs, comentários ou ChatGPT.**
- Não ativa nenhuma rotina agendada ou serviço pago.

## Preparação pelo operador

1. Providenciar usuário MongoDB estritamente de leitura para o banco `zapvoice` e limitar rede/IP do operador. Não usar o usuário de escrita do servidor.
2. Criar um arquivo YAML protegido (`chmod 600`) com `uri: "mongodb+srv://..."`; armazená-lo fora do repositório. Usar arquivos com permissão 0600 para configuração e passphrase GPG.
3. Providenciar um diretório externo de backup persistente, com controle de acesso, cópia off-site e política explícita de retenção.
4. Executar inicialmente:

   ```bash
   export ZVM_BACKUP_CONFIG_FILE=/secure/mongodump.yaml
   export ZVM_BACKUP_PASSPHRASE_FILE=/secure/zvm-backup-passphrase
   export ZVM_BACKUP_DIR=/external/backups
   bash tools/backup-zapvoice-encrypted.sh --preflight
   ```

5. Após confirmar ferramentas, permissão de leitura, espaço e janela de carga baixa, executar manualmente `--backup`. O script verifica a descriptografia e o checksum do gzip, mas **isso não equivale a restauração validada**.
6. Confirmar existência do arquivo criptografado `.gpg` e respectivo `.sha256`; não publicar o arquivo no repositório.

## Restauração obrigatória em ambiente isolado

- Destino: cluster de homologação isolado **sem clientes, sem webhooks Cakto e sem integração com a extensão real**. Preferir outro projeto/cluster; não usar o mesmo banco de produção.
- A conexão `--config` de `mongorestore` deve ser exclusivamente do staging. Recusar executar caso a URI aponte para Cluster0 de produção.
- Conferir o checksum antes de descriptografar e, com ferramenta MongoDB Database Tools compatível, restaurar para o banco **`zvm_restore_check`**:

  ```bash
  sha256sum -c zvm-zapvoice-YYYYMMDDTHHMMSSZ.archive.gz.gpg.sha256
  gpg --batch --pinentry-mode loopback --passphrase-file /secure/zvm-backup-passphrase \
      --decrypt zvm-zapvoice-YYYYMMDDTHHMMSSZ.archive.gz.gpg |
    mongorestore --config=/secure/staging-mongorestore.yaml \
      --archive --gzip --nsInclude='zapvoice.*' \
      --nsFrom='zapvoice.*' --nsTo='zvm_restore_check.*'
  ```

- Validar contagem e índice de **todas as coleções**, especialmente `store`, `portal_users`, `payments`, `webhook_events`, `commercial_tx_claims`, `cakto_mail_outbox`; conferir 2FA, vínculos e fluxo de licenças com fixtures não pessoais em staging.
- Comparar contagens com um censo read-only de origem, registrar o horário do dump e divergências esperadas pelo tráfego em curso.
- `mongodump` em banco ativo pode representar dados de instantes diferentes enquanto ocorrem escritas. Um backup de leitura em operação **não promete consistência transacional pontual nem interrupção zero durante migração**. Para troca definitiva, planejar última sincronização/barreira de escrita e rollback.

## Critérios de aceite

- [ ] Backup REAL do `zapvoice` produzido fora do Render, criptografado e com hash conferido.
- [ ] Recuperação REAL em Mongo isolado concluída.
- [ ] Contagens, índices únicos/parciais e registros críticos conferidos sem exibir dados pessoais.
- [ ] RPO/RTO e responsável pela recuperação definidos.
- [ ] Rotação/retenção/off-site aprovados.
- [ ] Teste repetido após alterações críticas.

**Proibido:** usar `mongorestore --drop` contra produção; criar banco `zvm` de produção automaticamente; apagar `watidy`, `zvm_local` ou `zapvoice` como parte destes scripts.

Documentação de CLI: https://www.mongodb.com/docs/database-tools/mongodump/ e https://www.mongodb.com/docs/database-tools/mongorestore/
