# ZVM Automações LITE — checkpoint R64 / extensão DEV R50

**Data:** 18/11/2026 (UTC)  
**Status:** candidata DEV assinada para homologação; **NÃO APROVADA para uso comercial**.  
**Referência de entrada:** auditoria forense R63 sobre a R49, em `/mnt/data/ZVM_LITE_R49_AUDITORIA_FORENSE_SHELL_SIDEBAR_20261118.md`.  
**Escopo:** correção das fronteiras de produto/CommandHost, retirada de motores excluídos do boot, alinhamento Shell/Sidebar/Modo Fácil. Sem merge na main, sem deploy ZVM completa.

## Causa e correções

1. **P0: CommandHost herdava handlers proibidos da ZVM completa.** Alterado `app/content/features/workspace/panel-registry-core.js`: `has`, `list`, `state` e `execute` agora validam antes do plano a regra explícita `__extLiteAuthorityPolicy.allowCommand`. `execute` revalida depois da resposta assíncrona do plano. Comando negado retorna `LITE_COMMAND_DENIED`; a ausência do `PlanGate` não autoriza a execução.
2. **P0: motores excluídos iniciavam no WhatsApp mesmo sem UI.** Retirados do manifesto e fisicamente do runtime distribuído: `app/content/features/automation/auto-service.js`, `app/content/features/automation/auto-label-inbox.js`, `app/content/features/followup/engine.js`. Os arquivos de origem foram preservados fora do runtime para auditoria e possível compatibilidade de backups. Grupos lazy `workspace-domain-followup` e `workspace-domain-quick-response` foram incluídos na negação. Nenhuma regra legada desses motores foi executada.
3. **P1: política de armazenamento contraditória.** Em `app/shared/core/lite-authority-policy.js`, os escopos mutáveis passaram a ter allowlist própria. Os escopos `followup`, `auto_service` e `auto_label_inbox` são negados. `activity` continua negado no endpoint *genérico* `EXTUI_DATA_MUTATE`, uma vez que a fila de Envios usa um caminho específico e não deve aceitar mutações arbitrárias deste endpoint. O fluxo real de escrita da fila requer teste E2E distinto; não declarar que a escrita de Envios foi homologada.
4. **P1: Integrações aparecia no menu Sistema.** `app/content/features/workspace/panel-system-menus-core.js` filtra opções por `Edition.allowsSection`. `app/content/features/workspace/panel-command-orchestrator-core.js` não registra comandos bloqueados nem os executa.
5. **P1: Modo Fácil e presets legados.** `app/sidebar/workspace-profile.js` e `app/sidebar/view.js` derivam trays e categorias do catálogo LITE e migram estados de modelos legados para modelos autorizados, sem reintroduzir CRM, Follow-up e Respostas Rápidas. O schema 38 da preferência de Sidebar permanece com migração compatível.
6. **P2: rótulos/branding.** `section-identity-catalog.js` é fonte para rótulos de Shell e Sidebar: `atividades → Envios`, `salvar → ZapSaver`; nos painéis Fluxos/Funis `eyebrow` agora menciona `ZVM AUTOMAÇÕES LITE`, e o configurador do menu nomeia ZapSaver.
7. **P2: listas de configuração e de navegação.** As 13 seções da Shell **não são necessariamente todas configuráveis**. A grade configurável de 7 entradas refere-se apenas à seleção de atalhos do usuário, não ao mapa completo de destinos. A documentação separa esses contratos. A refatoração completa das listas auxiliares em uma única geração de metadados permanece para rodada própria; não é seguro apagar listas de migração que sustentam o backup legado.

## Pacote DEV R50 — assinatura final

- Pasta de runtime assinada com 271 arquivos (da R49 de 274, retirados exatamente três motores).
- Chromium CRX3 assinado com a identidade RSA estável da LITE: `ongildapieobgiamfjgnnnpelbeamfbk`, mesma R46–R49.
- Manifesto v0.1.50, buildId **`zvm-lite-dev-0.1.50-se68a05a3b1a6`**, fingerprint **`d019b229fb0ac0732933cf985af00145175e689ae337f8ca6d20df13e26e1192`**.
- Descritor DEV Ed25519 assinado válido até **2026-11-24T23:14:11.731Z**. Expirado esse prazo, uma nova build assinada e atualização de staging serão necessárias; sem bypass.
- ZIP unpacked: `ZVM-LITE-DEV-R50-SHELL-SIDEBAR-SEGURANCA-INSTALAR.zip`, **3.423.440 bytes**, SHA256 **`4a198d38d84c2e18e90df408d9a54403f725783b4531ad6bf359a3ea27bc298d`**.
- CRX3: `ZVM-LITE-DEV-R50-SHELL-SIDEBAR-SEGURANCA-ASSINADA.crx`, **3.430.283 bytes**, SHA256 **`9d1d66f67d8bce9f946940cf4cb7d72855dfd2d624bc0421d272866e80dfc5c2`**.
- Chaves privadas RSA/Ed25519 **nunca** incluídas no ZIP, CRX3, relatório ou GitHub; não migrar segredos do cofre do proprietário para o backend.

## QA sobre arquivos *finais assinados*, não somente árvore de laboratório

- Node VM `r50_security_qa.cjs`: **231 checks PASS**, comandos PRO negados com plano pago simulado, bloqueio prévio ao gate, preservação de Biblioteca/Fluxos, matrizes de Edition, mutações e lazy groups.
- `r49_contract_qa.js`: **25+ checks PASS**; `r49_sidebar_migration_qa.js`: **PASS**.
- Chromium 144 DOM sintético: `r50_chromium_shell_sidebar.py`: **8 contratos PASS** com **zero page errors**; Sidebar com Envios, Fluxos, Agenda, ZapSaver, Disparos, Biblioteca; tray automations e filtro Modo Fácil sem módulos PRO.
- Chromium 144 DOM sintético `r49_browser_qa.py` e `r49_browser_saved_item_qa.py`: **PASS** nos estados flex/grid, sem licença, preferência desligada, e item salvo com favorito posicionado abaixo do compositor.
- **242/242** JS/MJS/CJS sintaticamente válidos via `node --check`.
- **95 referências** de manifesto a arquivos existentes, **49/49** entradas do service worker existentes.
- Verificador CRX3 independente conferiu RSA-SHA256, ID Chrome, conteúdo exato dos 271 arquivos; ZIP manual passou CRC e comparação byte-a-byte.
- Sem arquivo `.pem/.key/.p12/.zvmvault`, sem assinatura de chave privada embutida em runtime.

## Limites e pendências não ocultadas

- **MV3 + WhatsApp autenticado real:** não homologados neste ambiente. Os testes Chromium desta rodada são DOM sintético, não instalação real. Testar no Chrome/Opera do proprietário com licença LITE e conta consentida, inclusive troca de chats, painéis, Sidebar, backup/restore, filas, cancelamentos e estabilidade do WhatsApp.
- **Escopo funcional completo ZapVoice:** não homologado (funis profundos, gatilhos, Envios/Agenda reais, Exportação ZapSaver, temas, backup e configurações). O usuário já reprovou a paridade da LITE; R50 não muda o status.
- **Compatibilidade de backup:** metadados legados de Follow-up/autoatendimento/CRM permanecem nas rotinas de migração e nos ícones/dados auxiliares para leitura segura. Os motores reais foram removidos da distribuição. **Não apagar esses metadados cegamente** sem simular importação/restauração.
- **Alguns painéis ocultos ainda têm código fonte residual compartilhado com a Shell**, mas a autoridade LITE nega seu uso. Para remoção física futura, provar que o `panel-...` não é dependência de inicialização genérica (preservar fail-closed).
- **Rótulo legado de startup do servidor:** log ainda diz `zapvoice.store`, embora variável runtime e banco reais estejam em `zvm_lite_staging_20261118` com permissão do usuário restrita a este banco; débito cosmético de observabilidade a resolver sem alterar produção.
- **Proibição de publicação:** não fazer merge da PR #124, deploy em `zvm.onrender.com`, nem alterar licenças de clientes da edição completa. A autorização do usuário cobriu apenas o staging isolado.

## Infraestrutura

- GitHub: `mythos52/zvm`, branch `feature/zvm-lite-key-v2-isolado-20261118`, PR #124 DRAFT. Este relatório é checkpoint, não integração do código da extensão na árvore do servidor.
- Render staging: `srv-dbv1sf8u01pc73cig79g`, URL https://zvm-lite-homolog-20261118.onrender.com, autoDeploy OFF. Ajustar somente os valores `ZVM_LITE_DEV_BUILD_ID`, `ZVM_LITE_DEV_BUILD_SHA256` e `ZVM_LITE_DEV_VERSION` conforme esta build final.
- MongoDB Atlas: `zvm_lite_staging_20261118` isolado. A chave DEV `zv2l-...` anteriormente cadastrada permanece a mesma, sujeita à autenticação de build V4 e à homologação de navegador.