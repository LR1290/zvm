# ZVM Automações LITE — R75 (LAB): proteção de escopo do Backup

**Data:** 19/11/2026. **Base:** R74 LAB, preservando a R51 como última DEV assinada de homologação.  
**Estado:** NÃO HOMOLOGADA · NÃO INSTALAR · NÃO PUBLICAR.  
**Escopo desta rodada:** restringir as categorias/lojas que um Backup da LITE pode ler, exportar e restaurar; simular restauração de configurações e abertura após reinicialização; preservar as correções de Fluxos/Funis R74.

## 1. Defeitos confirmados na R74

**P0 — categorias da edição completa expostas no Backup LITE.** `app/shared/core/backup-migration-core.js` mantinha a lista completa de categorias (CRM, IA, Follow-up, Webhooks, Autoatendimento, Respostas Rápidas etc.). `app/dashboard/core/backup-migration.js` instanciava o serviço sem um contrato de categorias do produto. A autoridade de exportação do background, em `app/background/authority/backup-authority.js`, mantinha sua própria lista paralela. Assim, esconder itens na Shell não impedia que backups e configurações antigas os selecionassem.

**P0 — seleção de importação vazia podia desviar do filtro.** O código `Array.isArray(options.categories)&&options.categories.length?filterBackup(...):backup` permitia continuar com o backup completo se uma operação não especificasse categorias. A R75 exige uma seleção autorizada pela política LITE também nesse caminho, inclusive na inspeção/prévia.

**P1 — estados PRO misturados com categorias compatíveis.** `experience` continha conquistas/easter eggs e `agenda` continha calendário da edição completa. Mesmo que a UI ocultasse os recursos, os registros poderiam continuar a ser copiados. A R75 veda as lojas `EXTUI:extappAchievements`, `EXTUI:extappEasterEggs` e `EXTUI:meetCalendarStore`, mantendo Favoritos, modelos e Agenda LITE.

**P1 — os metadados de categorias podiam ser modificados em runtime.** A cópia `categories.<id>.keys` exposta pelo serviço era um array mutável; o novo catálogo LITE expõe arrays de chaves congelados. A função `keysForCategories` passou a consultar só o catálogo filtrado, e não mais o catálogo bruto.

## 2. Correções R75

1. **Política única:** `app/shared/core/lite-authority-policy.js` declara `backupCategories`, `allowBackupCategory`, `backupDeniedStores` e `allowBackupStoreKey`, com negação por padrão.
2. **Dashboard:** `app/dashboard/core/backup-migration.js` exige a política carregada antes de criar o serviço. Transmite allowlist de categorias e denylist de lojas à migração.
3. **Motor de Backup:** `app/shared/core/backup-migration-core.js` publica apenas categorias da LITE, filtra as chaves de cada categoria, rejeita escolhas explícitas proibidas, evita exportação por `options.keys` que contorne a seleção, filtra importação sem categorias, recusa fontes sem dados compatíveis e mantém o isolamento em `inspectImport` e `importData`. A importação de formatos antigos **não apaga nem altera o arquivo original**, e apenas categorias compatíveis podem prosseguir.
4. **Autoridade do service worker:** `app/background/authority/backup-authority.js` recusa categorias proibidas e consulta a política compartilhada tanto na exportação manual quanto nas configurações/migração de backup automático.
5. **Apresentação própria:** a categoria antiga “Experiência extensão” aparece como **“Favoritos e modelos”** na interface de Backup da LITE; o metadado `createdBy` das cópias criadas pelo serviço de migração passa a identificar “ZVM - Automações LITE”.

**Categorias LITE permitidas:** Fluxos, Funis, Biblioteca, Agenda, Disparos, Personalização, Ajustes, Contatos e Notas, Favoritos e modelos, Lixeira; Etiquetas e Assinaturas permanecem apenas em rotas legadas de compatibilidade onde aplicáveis. **Categorias negadas:** CRM, IA, Follow-up, Respostas Rápidas autônomas, Integrações, Webhooks, Autoatendimento, Clientes, Encomendas, Transcrições, Central de Atividades e outros recursos PRO.

**Código residual justificado:** os *mapas históricos* de categorias da extensão completa permanecem internamente no parser de compatibilidade. Eles não são exportados na API de categorias LITE e não podem ser escolhidos para leitura/gravação através do serviço/autoridade corrigidos. Remoção física requer confirmar todos os formatos legados de importação antes de eliminar os mapeamentos, para não perder a capacidade de identificar dados compatíveis.

## 3. Evidências de QA

| Teste | Resultado | Alcance |
|---|---:|---|
| Contratos direcionados de Backup LITE | **17/17 PASS** | Node VM executando código R75 real |
| Exportação apenas das categorias permitidas | PASS | Inclui tentativas de contorno via chave/array |
| Importação direta de CRM / Follow-up / backup só PRO | Rejeitada | Sem gravações |
| Configurações legadas com categorias PRO | Filtradas | Não reativam recursos excluídos |
| Backup compatível: configurações restauradas e relidas após novo runtime | PASS | Armazenamento persistente simulado, `atomicImport:false` no teste |
| JSON de armazenamento inválido | Rejeitado | Sem mutações |
| Mesma política na autoridade de background | PASS | Funções reais avaliadas isoladamente |
| Regressão do serializador Funis R74 | **7/7 PASS** | Node VM |
| Importar → revisar → salvar → reabrir Funil | PASS | Chromium, DOM sintético, repositório simulado |
| Bloqueio após remoção de item ou falha da Biblioteca | PASS | Chromium sintético, nenhum erro de página |
| Sintaxe JS | **249/249** | `node --check` |
| Parsing CSS | **12/12** | `tinycss2` |
| Referências do manifesto | **94** existentes | Arquivos locais |
| Referências HTML | **19** existentes | Arquivos locais |
| Imports do service worker | **49** existentes | Ordem da política anterior à autoridade do Backup confirmada |
| ZIP de fonte | **284** entradas, CRC íntegro | Não assinado |

**Importante:** a prova de roundtrip é de **configurações compatíveis em armazenamento simulado**, não de um ZIP real com áudio/vídeo ou de um ciclo de reinício do Chrome. O caminho positivo de transação durável `atomicImport:true`, arquivos de mídia reais, Backup ZIP/JSON/criptografado, rollback após crash e validação MV3/WhatsApp autenticado continuam pendentes. Não foi enviado nenhum contato, disparo, arquivo de cliente ou dado real.

## 4. Escopo exato de alterações

Quatro arquivos de código modificados:
- `app/background/authority/backup-authority.js`
- `app/dashboard/core/backup-migration.js`
- `app/shared/core/backup-migration-core.js`
- `app/shared/core/lite-authority-policy.js`

Nenhuma alteração em motores de Fluxos, Funis, Agenda, WhatsApp, WA-JS, Disparos ou licenciamento. O arquivo `LEIA_R74_LAB_NAO_INSTALAR.txt` foi substituído por `LEIA_R75_LAB_NAO_INSTALAR.txt`.

### Artefatos

- **ZIP** `ZVM_LITE_R75_FONTE_LAB_NAO_INSTALAR.zip` — 3.419.420 bytes, SHA-256 `c04b8011ac601cdd1a00427524ab884ee0f403849621cb62f5e1e7137ed8ba00`.
- **Diff** `ZVM_LITE_R75_PATCH_R74_PARA_R75_NAO_INSTALAR.diff` — 35.076 bytes, SHA-256 `fa501693950e1d5647ce8f3923864cc6406327b1bf4bc7fbc11368ff29335682`.
- **Relatório:** este documento.

## 5. Gates e próximos trabalhos

- G0 integridade da fonte LAB: **PASS**.
- G1/G2 paridade ZapVoice: **NÃO COMPROVADA**.
- G3/G4 independência UI/UX: **PARCIAL**.
- G5 MV3/WhatsApp real: **NÃO EXECUTADO**.
- G6 regressões de código relevantes: **PASS EM SIMULAÇÃO**.
- G7 Render/Mongo/key/produção: **SEM ALTERAÇÕES**.
- G8 release: **REPROVADA**.

**A versão empacotada ainda declara `manifest.version=0.1.51` com registro de integridade e assinatura V4 antigos. Não carregar no Chrome.** A última DEV assinada reconhecida pelo Render de homologação permanece a R51. A branch `feature/zvm-lite-key-v2-isolado-20261118` continua isolada, com PR #124 em draft, sem merge.

**Próximas etapas:** homologar ZIP com assets reais e restaurar→reiniciar→reabrir em extensão MV3 autorizada; provar rollback durável e isolamento por conta, testar compatibilidade com backups ZapVoice existentes e continuar auditando o visual independente e os motores de recurso da LITE. Não aprovar nem publicar sem esses gates.