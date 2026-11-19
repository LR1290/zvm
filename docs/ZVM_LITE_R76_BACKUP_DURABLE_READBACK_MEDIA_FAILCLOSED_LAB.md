# ZVM Automações LITE — Relatório forense R76

**Data:** 19/11/2026. **Base:** R75 LAB (ZIP SHA256 `c04b8011ac601cdd1a00427524ab884ee0f403849621cb62f5e1e7137ed8ba00`).  
**Status:** FONTE DE LABORATÓRIO — NÃO INSTALAR, NÃO APROVADA, NÃO PUBLICAR.  
**Governança:** branch isolada `feature/zvm-lite-key-v2-isolado-20261118`, PR DRAFT #124; sem merge, deploy, chave nova ou alteração de produção.

## 1. Problemas reproduzidos na R75

**P0 — confirmação sem comprovação de escrita:** o caminho `atomicImport:true` chamava `EXTUI_BACKUP_IMPORT_TX_COMMIT` logo após `ExtensionStorage.setMany/removeMany`, sem comparar o conteúdo realmente relido. Um adaptador que aceitasse uma operação parcial sem exceção poderia fazer o journal marcar `committed` e o usuário receber falso sucesso, tornando impossível usar rollback de falha após essa confirmação.

**P1 — perda silenciosa de itens em cópias incompletas:** uma lista de Biblioteca com referência ausente ou conteúdo MIME incompatível era filtrada em `dropMissingRefs` e a importação continuava com aviso. A R76 aplica preservação estrita de dados **somente na edição LITE**: se uma referência não puder ser verificada no backup ou no cofre local válido, a inspeção e a importação são recusadas antes das escritas. Não elimina dados da cópia original.

## 2. Correções implementadas

- `app/shared/core/backup-migration-core.js`: nova `verifyBackupImportReadback(expectedWritten,expectedAbsent,expectedScope)`. Monta a expectativa de todos os stores e assets gravados, incluindo resultado das mesclagens, chaves excluídas por `replace` e refs órfãs removidas. Reler em lotes com **verificação de escopo de conta** antes/depois de cada lote. Diferenças geram `BACKUP_IMPORT_READBACK_MISMATCH` antes de emitir `TX_COMMIT`, acionando `EXTUI_BACKUP_IMPORT_TX_ROLLBACK` com snapshot durável já preparado.
- O verificador não grava informações sensíveis nem conteúdo em logs; falhas reportam código genérico. Usa comparação estrutural por serialização JSON para valores já normalizados e preserva o mecanismo de rollback do worker existente.
- A LITE agora recusa `LITE_BACKUP_ASSETS_INCOMPLETE` em `inspectImport`/`importData` quando os itens referenciam conteúdos ausentes ou inválidos. A versão completa continua com seu comportamento anterior; nenhum código dela foi alterado.
- API interna passa a se identificar como `6.3.1-lite-readback-r76`; `manifest.version=0.1.51` intencionalmente inalterado, com assinatura/fingerprint **obsoletos**, pois é uma fonte de laboratório.

## 3. Ensaios com o código R76 real e autoridade simulada

**11 cenários novos aprovados (Node VM):**

1. Mesclar configuração, confirmar leitura antes do commit, abrir em uma nova instância de runtime com a mesma base simulada.
2. Ignorar silenciosamente uma escrita: divergência detectada; commit recusado e rollback restaura bytes anteriores.
3. Alterar silenciosamente os bytes da escrita: divergência detectada e rollback.
4. Ignorar silenciosamente uma exclusão no modo `replace`: chave remanescente detectada e rollback.
5. Simular exceção de escrita: rollback anterior preservado.
6. Trocar a identidade da conta entre escrita e verificação: operação abortada, rollback, zero commits.
7. Restaurar imagem PNG real (bytes Base64 válidos em Data URL) com item da Biblioteca e reabrir em novo runtime simulado.
8. Omitir silenciosamente a gravação do asset PNG: rollback de item e asset, sem commit.
9. Referência de imagem sem conteúdo: inspeção e importação recusadas sem mutar base.
10. Imagem declarada como PNG cujo corpo contém dados de PDF: recusada antes da escrita.
11. Tentar restaurar CRM excluído: categoria negada antes de qualquer gravação.

**Regressões existentes sobre a R76:** 17 testes do escopo Backup LITE + 7 do editor Funis/importar→salvar→reabrir, todos aprovados.

**Escopo dos testes:** fake de `chrome.runtime.sendMessage` e do journal com snapshot de um Map persistente entre instâncias, executando o *backup-migration-core real*. **Não é prova de crash recovery do service worker do Chrome, nem da persistência IndexedDB real, nem de extração de ZIP com assets**, nem da correção da implementação real do worker sob interrupção de energia. Não foram usados dados de clientes ou mensagens reais.

## 4. Auditoria estática do pacote

| Controle | Resultado |
|---|---:|
| Sintaxe JS/MJS/CJS | 249/249 PASS |
| CSS parseado | 12/12 PASS |
| Referências locais do Manifest | 94 presentes |
| Referências HTML | 19 presentes |
| Importações service worker | 49 presentes |
| Diferenças de runtime R75→R76 | **1 arquivo**: `app/shared/core/backup-migration-core.js` |
| Adições/remissões | somente substituição do aviso LAB R75 por R76 |
| ZIP CRC | 284 entradas sem erros |

**Fonte:** `ZVM_LITE_R76_FONTE_LAB_NAO_INSTALAR.zip` • 3420075 bytes • SHA-256 `5f79d2dd337dac6b56e2fb8b947128d899e80e3e0c205f04a0fe66f2dcc14a0e`.  
**Patch:** `ZVM_LITE_R76_PATCH_R75_PARA_R76_NAO_INSTALAR.diff` • 11936 bytes • SHA-256 `812bd4549ad36b4f94f777ee621f9c3db5db9719049acd08e6d20b6f55afc911`.

## 5. Limites e critérios pendentes

1. O readback garante que o repositório devolve os valores pretendidos **na mesma sessão de leitura**, mas não substitui uma prova de `fsync`/IndexedDB durability após encerramento forçado do Chrome.
2. A validação dos primeiros bytes de arquivos PNG/áudio/vídeo não é uma verificação integral de conteúdo audiovisual nem um hash de payload completo; ZIP com mídias reais e arquivos legados precisam passar por parser próprio e teste no MV3 autorizado.
3. Uma cópia parcialmente danificada deve agora ser corrigida/recuperada, não restaurada com dados descartados silenciosamente. UX de recuperação seletiva futura exige consentimento explícito e separação de dados intactos.
4. Ainda faltam ensaios reais de conta WhatsApp, Execuções/Envios/Agenda, Backup em disco e seu journal após reinício/crash, comparação funcional com ZapVoice, UI própria da Shell e Sidebar.
5. A R51 é a última DEV assinada reconhecida pelo servidor Render de homologação. **Não atualizar Render para esta fonte sem assinatura própria e teste real**.

## 6. Gate de release

- Integridade da fonte e testes locais: **PASS**.
- Garantia end-to-end de rollback durável Chrome: **PENDENTE**.
- Homologação WhatsApp MV3 real: **PENDENTE**.
- Paridade com ZapVoice e UI independente: **NÃO COMPROVADA**.
- Aprovação para instalar/publicar: **REPROVADA**.

Não houve merge, deploy, modificação em Atlas, Render ou no serviço comercial `zvm.onrender.com`.