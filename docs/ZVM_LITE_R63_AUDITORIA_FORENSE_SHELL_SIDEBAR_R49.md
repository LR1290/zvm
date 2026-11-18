# ZVM Automações LITE — auditoria forense Shell, Sidebar e autorização
**Data de referência:** 18/11/2026  
**Fonte auditada:** `ZVM-LITE-DEV-R49-ZAPVOICE-BARRA-RAPIDA-INSTALAR.zip` (R49, 0.1.49)  
**Resultado:** **REPROVADA — NÃO HOMOLOGAR**  
**Alcance:** auditoria estática, avaliação dinâmica isolada de catálogos e `CommandHost`, e regressões sintéticas Chromium, **sem** iniciar automações nem enviar mensagens reais. Nenhum patch, novo build ou deploy nesta auditoria.

## 1. Proveniência e critérios

- Os 274 arquivos do ZIP R49 foram enumerados, o CRC do ZIP foi verificado e seus bytes foram comparados com a árvore local descompactada (`/mnt/data/zvm_lite_r49_work/ZVM-LITE-DEV-R49`). Não se utilizou uma R45/R48 como fonte principal para esta auditoria.
- Referência comparativa de funcionalidades: distribuição original `ZapVoice - Chrome Web Store 3.18.19.0.crx` preservada na Biblioteca, com 45 arquivos, e `RELATORIO_FORENSE_ZAPVOICE_PARA_ZVM_LITE_20261116.md`. A ZapVoice original não foi executada nem foi transplantado seu código. Não presumir que essa versão tenha paridade com a ZapVoice mais recente.
- Referência de arquitetura da barra: R49 da LITE e fonte recente da ZVM Automações completa; não confundir o escopo dos produtos.
- Os testes oficiais R49 de catálogo e migração passaram, bem como as simulações da barra em compositor flex e grid. O conjunto atual **não inclui** a execução do WhatsApp real com extensão MV3 carregada nem isolamento de comandos fora de produto. Portanto, PASS desses testes é insuficiente para aprovação.

## 2. Bloqueadores

| ID | Severidade | Evidência da R49 | Consequência/risco | Correção requerida |
|---|---|---|---|---|
| F-01 | **P0 — arquitetura de produto** | `manifest.json:136-147` carrega `auto-service.js`, `auto-label-inbox.js` e `followup/engine.js`; seus próprios inicializadores chamam `start()` ou registram `__extBootPhases.when(3,start)` | Mecanismos excluídos da UI continuam registrando listeners/timers e podem processar regras legadas presentes no storage. **Não houve envio real constatado**. | Decidir explicitamente qual automação pertence à LITE; só inicializar os módulos permitidos. Não confiar em CSS/menu oculto como desativação. Manter proteção contra ações residuais e migração segura de dados. |
| F-02 | **P0 — fronteira de autorização** | `app/content/features/workspace/panel-registry-core.js:76-99` executa handler quando `planGate.requireCommand(id)` é true, sem consultar Edition/política LITE; `panel-command-orchestrator-core.js:84-104` registra comandos `crm.open`, `quick-response.open`, `followup.open`, `shell.integrations.open` | Reprodução isolada confirmou que `crm.open` **chega ao handler** com plano pago, mesmo com `Edition.allowsSection('crm') === false` e a política LITE negando `crm.open`. Não prova CRM utilizável no navegador, mas demonstra passagem indevida na camada de comandos. | Comandos registrados e executados devem obedecer `produto + seção/ação + capacidade + sessão`, com bloqueio fail-closed. Testar todos os comandos excluídos. |
| F-03 | **P1 — política contraditória** | `app/shared/core/lite-authority-policy.js:4-26` permite mutações `followup`, `auto_service`, `auto_label_inbox`, mas Edition exclui interfaces; `activity` aparece em escopos negados enquanto `atividades` é uma seção aprovada | Contrato LITE incoerente. A persistência de Envios usa também repositório de armazenamento próprio, de modo que **não está comprovado** que esta contradição quebre suas gravações; precisa de teste direto de mutação. | Alinhar escopos à matriz funcional real, sem bloquear o histórico de Envios; testar a autoridade dos dois caminhos (mensageria e armazenamento). |
| F-04 | **P1 — botão sem destino** | `app/content/features/workspace/panel-system-menus-core.js:119-120` cria `Integrações` sem filtro da Edition, chamando `extOpenSystemDestination('integracoes')`; Edition exclui `integracoes` | Interface oferece ação proibida pela própria edição; abre erro ou tela não suportada | Remover da Shell LITE e impedir que o roteador/CommandHost a exponha. |
| F-05 | **P1 — menu e filtro incompletos** | `app/sidebar/view.js:108-120` usa categorias hardcoded de CRM, Respostas Rápidas, FollowUp, `activity`; omite `agenda` de todas as categorias; `workspace-profile.js:15-19` gera tray automations sem itens | Modo Fácil esconde funções permitidas conforme filtro, enquanto mostra categorias herdadas e o submenu de automações fica vazio | Derivar categorias e trays da mesma matriz de capacidades LITE usada pela Shell, sem listas paralelas hardcoded. |
| F-06 | **P1 — presets legados** | `app/sidebar/workspace-profile.js:26-39` mantém modelos de CRM, pedidos, entregas, FollowUp, quick-response, integrações e webhooks da edição completa | Estados de personalização podem conter combinações que a LITE não oferece | Mapear presets apenas para módulos LITE, migrar modelos já salvos e preservar preferências válidas. |
| F-07 | **P2 — linguagem visual inconsistente** | `app/shared/core/section-identity-catalog.js:171-180` chama `atividades` de `Envios` e `salvar` de `ZapSaver` na Sidebar; o catálogo da Shell usa `Atividades` e `Salvar contatos` (`:82`, `:245`), além de agrupamentos genéricos | Usuário vê nomes, ícones e posições divergentes para mesma ação | Definir nome, ícone, rota e agrupamento canônicos por recurso e projetá-los em todas as superfícies. |
| F-08 | **P2 — resíduos de apresentação** | `app/sidebar/view.js:188` ainda usa `aria-label="ZVM - Automações"`; fontes de `panel-flows-domain-core.js` e `panel-funnels-domain-core.js` mostram `ZVM AUTOMAÇÕES`; `plan-gate.js:16-18` oferece upsell Pro com CRM/IA/Integrações | Identidade LITE incoerente, inclusive acessibilidade e mensagem de licenciamento | Substituir textos após catalogar todo o produto; não criar string de branding duplicada. |
| F-09 | **P2 — configuradores desconectados** | `app/content/features/workspace/data/navigation.js:47-58` tem 7 entradas explícitas no menu configurável, mas a projeção Shell contém 13 seções; existem listas independentes de navegação | Manutenção e personalização podem divergir; **não foi verificado** que toda seção da Shell deva necessariamente ser configurável | Formalizar política do que é fixo/configurável; teste de paridade entre menus/rota/pins e `MENU_CONFIG_ITEMS`. |

## 3. Provas dinâmicas realizadas

**3.1 Catálogo real da edição.** Em VM Node foram carregados, na ordem, `section-palette.js`, `lite-edition.js`, `lite-authority-policy.js`, `section-identity-catalog.js`, `storage-keys.js`, `sidebar/constants.js`, `sidebar/registry.js` e `sidebar/workspace-profile.js`.

- 13 seções raiz permitidas; 6 pins padrão na Sidebar (`activity`, `flow`, `agenda`, `export`, `broadcast`, `items`); `sidebarTrays.automations = []`.
- `Edition.allowsSection('followup') = false`, mas `denyLazyGroup('workspace-domain-followup') = false` e `denyScope('followup') = false`.
- `Edition.allowsSection('atividades') = true`, mas `denyScope('activity') = true`.
- `Edition.allowsSection('integracoes') = false`, mas a opção de Sistema é criada incondicionalmente.
- A negação para CRM em alguns loaders existe, porém o `CommandHost` não impõe o mesmo limite na sua própria camada.

**3.2 Regressões entregues com a R49.** Executadas:
- `node tests/r49_contract_qa.js` → PASS (25+ asserções);
- `node tests/r49_sidebar_migration_qa.js` → PASS (migração schema 38);
- `python tests/r49_browser_qa.py` → PASS em compositor sintético flex e grid, com barra vazia, licença não autorizada e preferência desativada;
- `python tests/r49_browser_saved_item_qa.py` → PASS com item salvo e favorito; sem erros de página nas situações simuladas.

**Limite das provas:** os testes de barra não renderizam o WhatsApp Web real nem cobrem motores residuais, políticas de mutação, interação integral da Shell e comandos proibidos. A aprovação desses testes não implica aprovação da ferramenta.

## 4. Matriz de escopo a congelar antes de refatorar

A referência ZapVoice original 3.18.19 evidenciou Sidebar de **Envios, Fluxos, Agenda, ZapSaver, Disparos, Itens, Ajustes, Aprimorar, Ajuda** e **Avisos** condicionado a flag. O Dashboard contém Biblioteca por tipo, Fluxos, Funis, Gatilhos e Etiquetas condicionadas. Os seguintes critérios recomendados não são autorização para copiar código alheio:

| Área | Decisão de arquitetura a validar | Situação R49 |
|---|---|---|
| Barra sob o compositor | Itens, prévias, favoritos, abrir Biblioteca e enviar/agendar com confirmação quando configurada | Testada apenas em DOM sintético |
| Envios + Agenda | Listar, pausar/cancelar e restaurar execução própria da ZVM | UI/autoridade ainda sem E2E; conflito do escopo `activity` a esclarecer |
| Fluxos e Funis | Catálogos e execuções distintos, sem fluxos CRM/IA extras | Textos legados presentes; execução não homologada |
| ZapSaver | Exportação controlada com escopo e permissões explícitos | Nome/rota conflitam; função real não homologada |
| Etiquetas/Aprimorar | Exibição condicionada a suporte da conta/flags e menus coerentes | Agrupamento e disponibilidade inconsistentes |
| Autoatendimento, FollowUp, CRM, IA, quick-response independente | **Não presumir inclusão por herança do código completo** | Superfícies ocultas, mas motores/handlers ainda carregados |
| Configurações/Temas/Backup | Recursos próprios LITE, com importação compatível e escopo limitado | Contratos precisam de testes com dados de laboratório |

## 5. Roteiro de remediação, em ordem de risco

1. **Congelar uma matriz canônica de capacidades por produto** (`zvm_lite`) e decidir o destino de `auto_label_inbox` com o proprietário; não reutilizar automaticamente os recursos PRO. Centralizar nomes, ícones, seção, comando, escopo de armazenamento, lazy group e plano.
2. **Fechar o gate do `CommandHost` e do roteador**, com rejeição de ações fora da LITE, mesmo se a licença for paga e a UI estiver oculta. Testes negativos por comando e por lazy group, incluindo clientes tentando invocar API diretamente.
3. **Impedir boot/ações residuais** dos motores fora do catálogo, tanto pelo manifesto quanto no runtime; preservar compatibilidade de backups, sem executar regras antigas. Não remover arquivos às cegas sem checar importações/execuções ainda legítimas.
4. **Recompor Shell, Sidebar e Modo Fácil** usando projeção única; corrigir menu Sistema, trays vazios, filtros e presets, persistência de configuração e nomes canônicos.
5. **Validar armazenamento real** de Envios, Agenda, Biblioteca, ZapSaver, favoritos, filtros, restore de Sidebar e operações de cancelamento, inclusive sem licença/rede e após reiniciar.
6. **Homologar no Chrome/Opera autorizado com WhatsApp Web real**, confirmar popups, Shell, sidebar, barra rápida, troca de chats, vários layouts, login key V4 e refresh, sem uso de dados ou destinos não consentidos.
7. Só após correção e testes, produzir nova DEV assinada com o mesmo ID Chrome e atualizar **somente staging**, mantendo `main`, clientes comerciais e produção sem modificações até aprovação expressa.

## 6. Status de governança

- **R49 permanece NÃO APROVADA**, sem nova build gerada por esta auditoria.
- **Não** houve commit de código da extensão, merge, atualização do Render, escrita no MongoDB, emissão de licença, envio de mensagens ou alteração na ZVM Automações completa durante a auditoria.
- Não afirmar falha de armazenamento de Envios nem execução indevida real de CRM/FollowUp sem teste end-to-end; a evidência comprova **contratos contraditórios e chamadas potenciais**, que são suficientes para bloquear homologação.
- Checkpoint: auditoria de fonte R49 e referência ZapVoice 3.18.19. Próxima rodada deverá ser correção específica dos bloqueadores **P0**, não uma sucessão de revisões visuais sem arquitetura estabilizada.