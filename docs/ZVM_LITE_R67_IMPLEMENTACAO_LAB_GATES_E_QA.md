# ZVM LITE R67 — Implementação real a partir do Prompt Mestre (Fases A e B)

**Data:** 18/11/2026 (BRT). **Estado:** LAB / NÃO INSTALAR / REPROVADA para entrega comercial.

## Proveniência

- Baseline congelada: `ZVM-LITE-DEV-R51-FOCO-SIDEBAR-SEGURANCA-INSTALAR.zip`, SHA-256 `fee8119b4df10daff64841c212a61684b87e874e6ea9ea3c5d3e34fdfdc8d92b`.
- Árvore fonte extraída da R51 assinada existente na conversa. O ID Chrome original e as credenciais do staging **não** foram alterados nesta rodada.
- Benchmark de funcionalidades: CRX ZapVoice 3.18.19 original. Não copiar código proprietário; comparação de recursos.
- Benchmark de arquitetura compartilhável (não UI): ZVM completa 0.9.287 R65.
- Base da reprovação: auditoria R66, que encontrou 143/271 arquivos idênticos à ZVM completa, Shell e CSS PRO ainda sendo autoridade visual e gatilhos/medias sem rotas corretas.

## Código alterado

Arquivos alterados: **10**; novos: **6**; removidos: **0**.

- `CHANGED` `app/background/authority/lazy-content-loader.js` — 14122 → 14132 bytes
- `CHANGED` `app/dashboard/bootstrap/idle-loader.js` — 9779 → 9874 bytes
- `CHANGED` `app/dashboard/features/library/items.js` — 214046 → 215066 bytes
- `ADDED` `app/dashboard/lite/help.js` — 0 → 2216 bytes
- `CHANGED` `app/dashboard/lite/home-model.js` — 3263 → 5131 bytes
- `CHANGED` `app/dashboard/lite/home.js` — 6520 → 6424 bytes
- `ADDED` `app/dashboard/lite/lite-shell-ui.css` — 0 → 10488 bytes
- `ADDED` `app/dashboard/lite/triggers.js` — 0 → 3451 bytes
- `CHANGED` `app/shared/core/lite-edition.js` — 1459 → 1404 bytes
- `ADDED` `app/shared/core/lite-feature-contract.js` — 0 → 3150 bytes
- `CHANGED` `app/shared/core/section-identity-catalog.js` — 26871 → 27289 bytes
- `CHANGED` `app/sidebar/constants.js` — 7599 → 7606 bytes
- `ADDED` `app/sidebar/lite-style.js` — 0 → 10710 bytes
- `ADDED` `app/sidebar/lite-theme.js` — 0 → 1813 bytes
- `CHANGED` `manifest.json` — 7042 → 7094 bytes
- `CHANGED` `pages/dashboard/index.html` — 11545 → 11723 bytes

## Correções executadas (com critérios)

1. Criado `LiteFeatureContract` imutável; Edition e os oito cartões da Home agora usam a matriz comum. Contrato identifica rotas permitidas e registra Ajuda/Avisos da referência com estado explícito.
2. Corrigido `Mídias`: cartão agrega imagens+vídeos (quando tipos são reconhecidos), destino `/itens-media` é um hub de seleção real para Imagens e Vídeos. Desconhecidos geram contagem indisponível; não estimar.
3. Corrigido `Gatilhos`: deixou de abrir `quick-responses` proibido. Seção própria de leitura indexa gatilhos configurados nos Itens e Funis e acessa a origem. Declara expressamente que gatilhos internos de Fluxos não estão contados; não promete editor avulso nem paridade completa.
4. Adicionada Ajuda local à Shell e Sidebar, com destinos para Biblioteca, Fluxos, Funis, Envios, Agenda, ZapSaver e Backup. Não depende de URL comercial inventada.
5. Novo visual de **Shell LITE**: `lite-shell-ui.css` cria geometria, cores, nav, cartões, estados, tipografia e tratamento responsivo próprios. Removido import de `pro-approved-art.css`; cabeçalho agora declara LITE.
6. Nova identidade visual da **Sidebar WhatsApp**: `lite-style.js` e `lite-theme.js`, que substituem os assets visuais `style.js` e `theme.js` **na lista de carregamento**. Os arquivos antigos foram preservados em baseline para cadeia de custódia e reconstrução assinada; não são carregados pela R67.
7. Migração e preferências: Help entra como elegível no menu padrão da LITE; esquemas personalizados anteriores continuam preservados. Testes de regressão R51 atualizados somente para a nova linha padrão esperada.

## Testes que efetivamente foram executados

- `node --check` para todos os JS/MJS/CJS da árvore de laboratório: **247 arquivos**, zero erros.
- `r67_contract.test.cjs`: **25 verificações**, incluindo mídia mista, tipo desconhecido, gatilhos ausentes, ações proibidas e rotas/menus.
- Testes herdados do R51 adaptados para carregar o contrato: CommandBus **19 asserções**, adaptador de comandos **11 autorizados**, persistência e Modo Fácil **11 asserções**.
- `r67_trigger_browser.py`: Chromium headless com DOM sintético — renderer de gatilhos, badge ativo e navegação até origem, sem pageerrors.
- `r67_visual_contract.py`: Chromium headless com DOM sintético autorizado — Shell dark/light e 900/1420 px, nav/overflow; Sidebar em Shadow DOM com 64/174 px e labels; sem pageerrors.
- **NÃO se testou a extensão instalada em Chromium MV3/WhatsApp autêntico.** Não houve mensagens reais, acesso a clientes ou teste de envio.

## Gate técnico — estado honesto

| Gate | Estado | Motivo |
|---|---|---|
| G0 Cadeia de custódia | PASS | R51 preservada, hashes e diff verificáveis |
| G1 Paridade de recursos | FAIL | Ajuda e duas rotas corrigidas, mas Avisos/fluxos/funis/ZapSaver/Disparos ainda sem E2E completo |
| G2 Comportamento integral | FAIL | Apenas home/media/gatilhos/ajuda e testes negativos selecionados executados |
| G3 UI/UX independente | PARCIAL | Novos CSS/tema/markup visuais, mas `main.css` e `shell/core.js` PRO ainda fornecem componentes estruturais; reconstrução autônoma integral pendente |
| G4 Segurança | PARCIAL | Testes herdados passam; auditoria de todos os entrypoints real ainda não concluída |
| G5 MV3/WhatsApp real | BLOQUEADO | Ambiente de laboratório não demonstra instalação MV3 autenticada |
| G6 Acessibilidade/responsividade | PARCIAL | DOM sintético dark/light, 900/1420, 64/174; faltam teclado/screen reader completos |
| G7 Licença/staging | NÃO ALTERADO | Servidor continua reconhecendo a R51; pacote LAB deliberadamente não assinado e **não pode** autenticar como nova build |
| G8 Entrega | NÃO LIBERAR | Não houve assinatura, ZIP instalável, deploy, merge ou nova key nesta rodada |

## Bloqueio de integridade deliberado

`manifest.json`, `app/security/integrity.json` e `app/security/build-identity.json` retêm a identidade assinada da **R51** como baseline forense. Não foram regenerados/assinados para R52. Uma cópia editada **NÃO DEVE SER CARREGADA NO CHROME**, pois o gate de integridade deverá recusá-la. A assinatura e o fingerprint do servidor só podem mudar depois da conclusão de G1–G4, nova assinatura com as chaves do proprietário, QA MV3 e autorização de homologação.

## Próxima unidade de trabalho, sem saltar fases

- Decompor `app/dashboard/styles/main.css` e `app/dashboard/shell/core.js` em Shell específica da LITE, mantendo pontes de runtime essenciais e eliminando interfaces PRO realmente mortas.
- Homologar paridade de Gatilhos (editor, estados, execução), ZapSaver completo (CSV/vCard/filtros), Envios/Agenda e todas as rotas com dados sintéticos e Chrome real.
- Completar Avisos sob flag verificável e suporte contextual; evitar introduzir recurso não demonstrado na referência.
- Corrigir todas as inconsistências de armazenamento/políticas, testes adversariais e QA de navegador real.

## Artefatos auditáveis

- `ZVM_LITE_PROMPT_MESTRE_R67_RECONSTRUCAO_PARIDADE_E_IDENTIDADE.md`: contrato mestre.
- `ZVM_LITE_R67_PATCH_IMPLEMENTACAO_FASES_A_B_NAO_INSTALAR.diff`: mudanças de código da R51→fonte LAB.
- Testes em `/mnt/data/zvm_lite_r67_work/tests`, com capturas sintéticas em `/mnt/data/zvm_lite_r67_work/qa_*.png` (não equivalem a WhatsApp real).
- A distribuição assinada R51 permanece intacta e a branch/PR do backend permanece sem merge.