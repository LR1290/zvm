# ZVM Automações LITE — Relatório forense R77

**Data:** 19/11/2026. **Fonte exata:** `ZVM_LITE_R76_FONTE_LAB_NAO_INSTALAR.zip` (R76, não instalar).  
**Estado:** **LAB / NÃO INSTALAR / NÃO APROVADA / SEM DEPLOY**. A R51 continua última DEV assinada autorizada pelo Render de homologação.

## 1. Causa raiz reproduzida

O **service worker real** da R76, em `app/background/authority/storage-mutation-authority.js`, na função `restoreBackupImportSnapshot`, fazia a restauração do journal com `chrome.storage.local.remove` e `.set` e, sem reler os valores, removia mídias temporárias e marcava `state="rolled-back"`. O mecanismo de conclusão eliminava posteriormente o journal. Isso violava a regra de readback implementada na R76 **somente para o commit da importação**, não para seu rollback.

**Prova diferencial usando o código R76 original em Node VM com `chrome.storage` simulado:**

- Se `.set()` ignorava silenciosamente a restauração de `EXTUI:mediaStore`, a R76 mantinha `MUTATED` e **apagava journal, snapshot e job** sem erro.
- Se `.remove()` ignorava silenciosamente a exclusão de `EXTUI:temporaryKey`, a R76 deixava a chave indevida, mas também **apagava journal e job** sem erro.
- Sem falha injetada, a R76 concluía corretamente; o defeito era específico da ausência de confirmação em falhas silenciosas.

## 2. Correção R77 (um arquivo de código alterado)

**Arquivo:** `app/background/authority/storage-mutation-authority.js`.

1. Nova função `verifyBackupImportSnapshotRestored(chunks)`: relê em lotes do mesmo tamanho do snapshot TODAS as chaves restauradas e esperadas como ausentes. Confere a presença e o conteúdo serializado como JSON das primeiras, e a ausência efetiva das segundas. Não expõe valores nos erros/logs.
2. `restoreBackupImportSnapshot` chama essa função **antes da limpeza de mídias** e **antes da transição persistida para `rolled-back`**.
3. Uma divergência lança `BACKUP_IMPORT_ROLLBACK_READBACK_MISMATCH`. O worker conserva manifest, chunks e lock; no boot falhado ele bloqueia novas mutações e não reconhece recuperação concluída. Reiniciar o worker sem a falha permite novo rollback idempotente, com os valores originais recuperados.
4. **Compatibilidade com crashes durante cleanup:** a recuperação de um manifest já terminal `rolled-back` não exige chunks. Esses chunks podem ter sido parcialmente removidos durante uma interrupção entre as operações de limpeza. O estado terminal só é gravado pela R77 **depois** do readback; assim o boot seguinte pode completar a remoção do journal sem se bloquear por chunks já limpos.
5. Nenhuma alteração em dados de usuário, modelos de WhatsApp, mídias, autenticação, formato de backup, UI, licenciamento, manifesto ou pacote comercial.

## 3. Testes (código real do módulo, ambiente simulado)

| Suite | Casos aprovados |
|---|---:|
| Worker real + reboot | 9/9 |
| Backup categorias | 17/17 |
| Backup readback da importação | 11/11 |
| Funis importação/salvamento | 7/7 |

**Total:** **44 cenários aprovados.** Os 9 cenários novos do worker abrangem: rollback regular; gravação silenciosamente ignorada; exclusão silenciosamente ignorada; segundo boot após cada falha; chunk ausente; limpeza reiniciada após crash com chunk já removido; falha ao limpar mídia seguida de retry; bloqueio de aquisição de lease após recovery falhado.

**Limitação honesta:** o ambiente usa o arquivo real do service worker no Node VM com `chrome.storage` simulado e `Map` persistido entre instâncias. **Não é um crash real do Chrome MV3**, não prova durabilidade física do IndexedDB/Chrome e não substitui testes de reinicialização forçada com ZIP e mídias reais no navegador autorizado. Os testes não acessaram contas nem mensagens de clientes.

## 4. Integridade estática e delta R76 → R77

| Controle | Resultado |
|---|---:|
| Scripts JS/MJS/CJS `node --check` | 249/249 válidos |
| CSS sintaticamente analisado | 12/12 |
| Recursos locais do Manifest | 94 existentes |
| Referências HTML locais | 19 existentes |
| Importações locais do service worker | 49 existentes |
| Arquivos de runtime alterados | **1** (`app/background/authority/storage-mutation-authority.js`) |
| Adições/remoções funcionais | **0**; aviso LAB R76 substituído pelo aviso R77 |
| ZIP — CRC | 284/284 entradas OK |
| Manifest/version | **0.1.51** mantido da R51, propositalmente obsoleto |

- **Fonte R77:** `ZVM_LITE_R77_FONTE_LAB_NAO_INSTALAR.zip`, 3421091 bytes, SHA256 `8bfb6cda2a2dcca9986d2587202b6b465564017ba542c7f302fb4288b88afb9b`.
- **Diff R76→R77:** `ZVM_LITE_R77_PATCH_R76_PARA_R77_NAO_INSTALAR.diff`, 7492 bytes, SHA256 `c5f4c3ae42bd9787c2180413d5064b03b0968b471a84053eade0db6cdf6d9bb1`.

## 5. Critérios pendentes para homologação

- Reproduzir importação interrompida em uma extensão MV3 **permitida pelo navegador**, reiniciar service worker/Chrome, e verificar journal persistente, dados e mídias por fingerprint.
- Confirmar comportamento com quota excedida, falha real de armazenamento, backup ZIP com assets reais e alternância de conta autorizada. A confirmação por leitura nesta sessão não substitui teste de durability após encerramento do processo.
- Continuar a paridade funcional com ZapVoice: ZapSaver, Agenda, Envios, Disparos, Fluxos, Funis, Backup e menus, além de Shell/Sidebar independentes da ZVM completa.
- Regenerar assinatura DEV, ID/fingerprint de build e integridade **somente quando os gates estiverem aprovados**. **Não instalar o ZIP LAB** porque os metadados criptográficos ainda são os da R51.

**Governança:** sem merge na `main`, sem deploy Render, sem alteração MongoDB/key, sem modificação na ZVM completa. Branch de documentação `feature/zvm-lite-key-v2-isolado-20261118`, PR DRAFT #124.