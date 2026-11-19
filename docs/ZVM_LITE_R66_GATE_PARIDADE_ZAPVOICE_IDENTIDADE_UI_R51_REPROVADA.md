# ZVM Automações LITE — R66 | Auditoria de aceitação: ZapVoice × Shell/Sidebar × Identidade própria

**Data:** 18/11/2026 (BRT).  
**Status:** **FALHA — R51 REPROVADA; NÃO HOMOLOGAR, NÃO PUBLICAR.**  
**Entradas examinadas:** distribuição ZapVoice Chrome Web Store `3.18.19.0.crx` (original na Biblioteca, 45 entradas), `ZVM-LITE-DEV-R51-FOCO-SIDEBAR-SEGURANCA-INSTALAR.zip` (271 entradas), `ZVM_AUTOMACOES_DEV_0.9.287_R65_AI_TOOL_FAILCLOSED_ASSINADA_LAB.zip` (359 entradas) da ZVM completa, relatório R65 da LITE. São referências reais, não apenas o nome das pastas.

## Contrato de aceite imposto pelo proprietário

1. A **equivalência funcional** entre a Sidebar/Shell da LITE e os recursos da ZapVoice é obrigatória. Recursos devem ser coerentes entre Dashboard, Sidebar, Biblioteca, filas, ações e autorização. Diferenças de disponibilidade por plano devem ser identificadas e não simuladas.
2. **Layout, design, UI e UX da ZVM LITE devem ser próprios**, diferentes da ZVM Automações completa. Não basta ocultar recursos PRO nem aplicar tema CSS de outro nome sobre a mesma Shell.
3. Falha em qualquer requisito = **tarefa reprovada**, independente de sintaxe, ZIP, RSA ou resultados de DOM sintético.

## Prova de insuficiente separação visual e estrutural

Comparação **byte a byte e por linhas** entre 271 arquivos da LITE R51 e o pacote contemporâneo da ZVM completa:
- **143 arquivos idênticos byte a byte** (≈52,8% do conjunto da LITE); 101 arquivos com caminho em comum porém alterados; 27 específicos da LITE.
- `app/sidebar/style.js`: **idêntico 100%** ao da completa.
- `app/sidebar/layout.js`: **idêntico 100%**.
- `app/sidebar/theme.js`: **idêntico 100%**.
- `app/sidebar/command-host-adapter.js`: **idêntico 100%**.
- `app/dashboard/shell/core.js`: **≈98,5% de similaridade de linhas** (difflib, autojunk=false; 3.060 linhas LITE versus 3.076 completa).
- `app/dashboard/styles/main.css`: **≈95,8% de similaridade de linhas**, além de carregar o `app/dashboard/lite/lite.css` sobre essa base.
- `app/content/styles/content.css`: **≈98,5% de similaridade de linhas**.
- `app/dashboard/styles/pro-approved-art.css` é **idêntico 100%** e continua referenciado no `pages/dashboard/index.html` da LITE.
- `app/shared/ui/design-system-runtime.js`: ≈99,6% de similaridade de linhas.
- O HTML da LITE ainda usa os ids e componentes de Shell `extappTopbar`, `extappSidebar`, `extappSidebarNav`, `extappContentArea` e, no header, escreve `ZVM` + `AUTOMAÇÕES`, sem identidade LITE no cabeçalho.

**Interpretação:** compartilhar motores de envio, bibliotecas e verificações de segurança pode ser legítimo; compartilhar integralmente os estilos de Sidebar e o desenho da Shell **contraria a exigência expressa de UI/UX própria**. Similaridade de código não estabelece igualdade visual pixel a pixel, mas **comprova que não houve reconstrução autônoma do layout e do design**.

## Matriz funcional da referência 3.18.19 × R51

| Área | ZapVoice 3.18.19 (CRX/relatório forense) | Estado auditável R51 | Gate |
|---|---|---|---|
| Biblioteca / Itens | Textos, áudios, mídias, documentos, fluxos, funis, favoritos | Tipos presentes; não há homologação E2E real | PARCIAL |
| Barra rápida sob compositor | Acesso rápido a itens e favoritos, ocultar/favoritos | Recuperada nas R49–R51; testes DOM sintético, sem aprovação real do usuário | PENDENTE |
| Envios | Tela/filas de execução e cancelamento | `atividades` incluída; `activity` continua entre escopos negados na política; outros caminhos podem operar | INCONSISTENTE |
| Fluxos | Definições e instâncias com respostas condicionais | Editores/motores herdados da completa, disponibilidade e semântica reais não comprovadas | PENDENTE |
| Funis | Sequências de itens com pausas e controle de envios | Incluído no Dashboard/Biblioteca; E2E não demonstrado | PENDENTE |
| Agenda | Fila de agendamentos, busca e cancelamento | Exposta pela LITE; persistência/execução real não homologadas | PENDENTE |
| Disparos | Campanhas em massa, controle de destinatários, fila e cancelamento | Telas/motores presentes, sem paridade operacional demonstrada | PENDENTE |
| ZapSaver | CSV/vCard, prefixos, filtros de arquivamento, limites, permissões | `salvar` / exportação genérica, paridade completa não demonstrada | PENDENTE |
| Gatilhos | Catálogo e tela próprios no Dashboard da ZapVoice | Cartão `Gatilhos` em `app/dashboard/lite/home-model.js` aponta para `quick-responses`, mas `app/shared/core/lite-edition.js` **não permite essa seção**; botão gera ação bloqueada | **FALHA CONFIRMADA** |
| Temas | WhatsApp/Claro/Escuro, configuração persistida | Código de temas presente mas `app/sidebar/theme.js` é byte idêntico ao da completa; equivalência de configuração não homologada | PENDENTE |
| Ajustes, Aprimorar, Ajuda, Avisos | Itens de Sidebar (Avisos condicionado a flag) | `allowedRoot` inclui Ajustes/Aprimorar, mas **não** inclui `help`/`news` e não há equivalência auditada para elas | **DIVERGÊNCIA** |
| Dashboard | 8 cartões: Mensagens, Áudios, Mídias, Documentos, Fluxos, Funis, Gatilhos, Etiquetas | Home tem 8 cartões, mas **troca Mídias por Imagens**; Gatilhos aponta para seção proibida; Etiquetas não tem contador próprio | **DIVERGÊNCIA** |
| Conta, suporte e backup | Painel, ajuda e importação/exportação de dados no CRX | LITE tem auth e backup; navegação/autorização de suporte não demonstrada em paridade | PENDENTE |

**Nota de escopo:** a distribuição `3.18.19` é a referência binária verificada. A Chrome Web Store pública consultada em 18/11/2026 também mostra `3.18.19`; índices terceiros indicam `3.18.27`, sem binário confiável dessa última em posse nesta auditoria. Não afirmar paridade com `3.18.27`.

## Outros resíduos de produto da R51

- `app/sidebar/constants.js` preserva grande conjunto de listas `legacyDefaultPinnedV2` até V35 e nomes de seções PRO; parte pode ser necessária a migrações **mas não deve ditar o layout atual**. Não apagar até mapear migrações e estados persistidos.
- `app/dashboard/lite/home.js` ainda contém `['Respostas rápidas','quick-responses']` no array estático de atalhos; no fluxo normal é filtrado pela Edition, mas o resíduo editorial evidencia catálogo divergente.
- `app/dashboard/lite/home-model.js` gera cartão de Gatilhos não funcional, sem rota própria de Gatilhos autorizada pela Edition.
- `pages/dashboard/index.html` referencia `pro-approved-art.css` e o shell visual da versão completa.
- Os testes relatados no R65 (242 scripts, 231 checagens, Chromium sintético) validam estabilidade de código/políticas selecionadas, **não** paridade de funcionalidades nem identidade visual nem uso real de WhatsApp.

## Decisão executiva

**R51 = REPROVADA**. Nenhuma R52 publicada, nenhum código corrigido neste checkpoint, nenhum deploy no Render, nenhum merge, nenhuma alteração em licenças/bancos. O staging e a key existente podem permanecer como infraestrutura de testes, mas não são prova de produto homologado.

### Regra para uma futura candidata

Uma nova edição deverá definir a **matriz canônica da ZapVoice por produto e plano** (Dashboard, Sidebar e barra), criar uma **Shell/Sidebar de identidade ZVM LITE própria**, migrar os componentes autorizados sem carregar visual PRO, preservar apenas motores compartilhados justificados, corrigir gatilhos/mídias e executar testes de navegação, armazenamento, permissões e fluxo real no Chrome/WhatsApp com dados consentidos. A candidata só será qualificada quando os **dois** gates — paridade funcional e independência UI/UX — forem verificados de forma independente.

## Proveniência de dados

Auditoria de bytes do CRX original ZapVoice, ZIP R51, ZIP DEV R65 completo, inspeção de manifestos, `app/sidebar/{constants,style,layout,theme,command-host-adapter}.js`, `app/shared/core/{lite-edition,lite-authority-policy}.js`, `app/dashboard/lite/{home-model,home,lite.css}`, `pages/dashboard/index.html`, `app/dashboard/shell/core.js`, `app/dashboard/styles/{main,pro-approved-art}.css` e relatório R65. Fontes externas públicas: ficha da ZapVoice na Chrome Web Store e catálogo de planos do domínio oficial.