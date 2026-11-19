# ZVM Automações LITE — R70: Disparos, Envios e Agenda

**Estado:** LABORATÓRIO / NÃO INSTALAR / NÃO HOMOLOGADA  
**Data:** 18/11/2026 (America/Sao_Paulo), continuidade da R69  
**Origem:** `ZVM_LITE_R69_FONTE_LAB_NAO_INSTALAR.zip` (árvore de 280 arquivos), sem transplantar código proprietário da ZapVoice.  
**Produto:** ZVM LITE; não alterar a ZVM completa.

## 1. Resultado e fronteiras

Foram corrigidos dois problemas de arquitetura **comprováveis no código**:

1. A página independente `pages/disparos/index.html` ainda importava `app/dashboard/styles/main.css` da edição completa (**1.346.624 bytes**) e `broadcast-compact.css` (**60.002 bytes**). Agora carrega um CSS operacional recortado e uma camada visual Orbital própria. O `main.css` e o `pro-approved-art.css` foram fisicamente eliminados da fonte LAB, pois não havia referências runtime fora do manifesto de integridade **antigo**.
2. A navegação `atividades` era apresentada como **Envios**, mas **não existia** `registerSection('atividades',...)` ou mapeamento dela em `bootstrap/idle-loader.js`. Navegar nessa seção poderia causar `Área ainda não registrada`. A R70 inclui `app/dashboard/lite/sends.js`, renderizador de monitoramento **somente leitura**, e mapeamento explícito no carregador dinâmico.

A R70 **não** executa pausar/cancelar diretamente: esses comandos continuam nos módulos originais, preservando a guarda de licença/conta. Os botões da página Envios apenas navegam para Disparos, Fluxos e Funis. Esta implementação **não alcança** a paridade funcional completa da ZapVoice, que exige verificação dos controles de filas, cancelamento, execução e estados reais.

## 2. Separação visual da página Disparos

Arquivos criados:

- `app/dashboard/lite/lite-broadcast-foundation.css` (**151.897 bytes**) — subset de estilos operacionais extraídos via AST CSS da base existente, mantendo apenas classes de Disparos/Quick Broadcast, primitivas de formulário, tema e regras necessárias sob media query. Nenhum seletor CRM/Follow-up permaneceu nessa folha.
- `app/dashboard/lite/lite-broadcast-ui.css` (**5.362 bytes**) — tokens Orbital claro/escuro e composição própria, painéis, abas, controles, foco, estados de hover e responsividade; sem CSS da Shell completa.
- `pages/disparos/index.html` — importa os dois CSS acima, mantém `broadcast-compact.css` e o mesmo módulo de Disparos. Identidade visual LITE; nenhum script de envio ou autorização alterado.

**Volume CSS de carregamento de Disparos:** R69 **1.406.626 bytes** (1.346.624 + 60.002); R70 **217.261 bytes** (151.897 + 5.362 + 60.002), redução de **84,55%** antes da compressão. Isso é redução de bytes CSS importados, **não medição de tempo de carregamento nem FPS no WhatsApp real**.

Remoções da árvore LAB:

- `app/dashboard/styles/main.css` (1.346.624 bytes) — sem consumidores HTML/JS restantes.
- `app/dashboard/styles/pro-approved-art.css` (2.106 bytes) — não importado pela LITE desde R67.

**Atenção:** `app/security/integrity.json` é deliberadamente o artefato histórico **R51**; ainda contém hashes e referências desses dois arquivos removidos. Por isso a R70 **NÃO É INSTALÁVEL**. Gerar novo manifesto de integridade, descritor Ed25519 e CRX3 de identidade estável apenas após os gates funcionais, sem reutilizar assinatura obsoleta.

## 3. Envios — primeiro contrato real de tela, sem automatização destrutiva

- Criado `app/dashboard/lite/sends.js`.
- `bootstrap/idle-loader.js` recebeu a rota `atividades` com esse novo script.
- Consulta apenas os registros locais pelas APIs existentes do Shell para `ext:bulkQueue` (Disparos), `EXTUI:extappFlowRunningStore` (Fluxos) e `EXTUI:extappFunnelRunningStore` (Funis).
- O módulo reconhece estados ativos, pausados e terminais, mas exibe contadores mínimos; não exibe números de telefone ou o corpo das mensagens.
- Retornos de leitura falhos, malformados ou grandes demais são **fail-closed**, exibindo "Não foi possível verificar" e **nunca** transformando erro de dados em falso zero.
- Atualização sob demanda, sem temporizadores de envio ou timers de reconciliação e com proteção contra resposta tardia após desmontar a página.
- Os botões para os demais módulos invocam somente `shell.showSection()` — nenhum `EXTUI_DATA_MUTATE` foi adicionado à página Envios.

**Limitação explicitada:** os stores e contadores exigem sessão/conta real para validação da autoridade. A visão R70 não substitui execução, cancelamento granular e confirmação operacional de filas da referência ZapVoice. E um status "waiting" genérico exige homologação para distinguir cada motor.

## 4. Agenda — estilo próprio, motor intacto

- `app/dashboard/lite/lite-operations.css` estiliza os elementos já existentes do módulo Agenda e da nova tela Envios, somente sob `html[data-zvm-lite-ui="orbital"]`.
- Agenda mantém `app/dashboard/features/agenda/runtime.js` inalterado, incluindo armazenamento e controles de execução.
- Criação/cancelamento de agendamento, calendário, contato, horário de verão, refresh após recarregar e sincronização de contas **não** foram executados em WhatsApp real nesta rodada.

## 5. QA e resultados reproduzidos

| Evidência | Resultado | Limite |
|---|---:|---|
| JS sintaxe `node --check` | **249/249** | Não valida worker MV3 |
| Folhas CSS parseadas | **11/11** | Não valida visual em dados reais |
| Referências do manifesto | **83/83** encontradas | Não valida integridade assinada |
| Referências HTML internas | Dashboard **65**, Disparos **32**, Popup **9**, Offscreen **7** | Apenas existência física |
| Contratos R67 | **25/25** | Fixture |
| Segurança barramento Sidebar | **19/19** | Autorização local |
| Modo Fácil/migração | **11/11** | Estado sintético |
| Adapter Sidebar | **11** comandos autorizados | Não envia mensagens |
| R68 catálogo | **14** rotas elegíveis | Apenas roteamento |
| Browser CSS Disparos | dark/light, 1280/900/650/420 px, PASS | DOM simulado |
| Browser CSS Agenda | dark/light, 1280/650/420 px, PASS | DOM simulado |
| Browser Envios | 3 fontes lidas; snapshots válidos, falha de leitura, payload malformado, refresh e navegação; PASS | Dados fictícios, sem sessão |
| Playwright page errors | **0** nos testes acima | DOM sintético |
| CSS `main.css` no runtime | **0 imports diretos** | O registro de integridade R51 ainda é obsoleto |
| CRX3 DEV / login WhatsApp / aprovação usuário | **NÃO TESTADOS** | Gates bloqueantes |

Capturas técnicas locais: `r70_disparos_dark.png`, `r70_disparos_light.png`, `r70_agenda_dark.png`, `r70_agenda_light.png` e `r70_envios_readonly_dark.png`. **São fixtures** — não screenshots do WhatsApp real.

## 6. Comparação com R69

- R69: **280** arquivos reais de fonte.
- R70: **282** arquivos reais de fonte (4 arquivos modificados, 4 adicionados, 2 removidos).
- Modificados: `app/dashboard/bootstrap/idle-loader.js`, `manifest.json` (nome LAB R70, versão numérica 0.1.51 mantida para sinalizar ausência de assinatura), `pages/dashboard/index.html`, `pages/disparos/index.html`.
- Adicionados: `lite-broadcast-foundation.css`, `lite-broadcast-ui.css`, `lite-operations.css`, `sends.js`.
- Removidos: `main.css`, `pro-approved-art.css`.
- **Nenhum arquivo dos motores de Disparos, Fluxos, Funis ou Agenda foi modificado.**

## 7. Artefatos e integridade

- Fonte: `ZVM_LITE_R70_FONTE_LAB_NAO_INSTALAR.zip` — **3.411.125 bytes**, SHA256 `02874a7eb5b9b05a13ef65fee6bd72b9f265be37d88423bad8799e686cb72c5b`.
- Diff: `ZVM_LITE_R70_PATCH_R69_PARA_R70_NAO_INSTALAR.diff` — **176.402 bytes**, SHA256 `b86eab87b0821830ea7ddebe5cd1a8dcc9ecf38ffae373e1b1f80a6222c5b97d`.
- Pacote: **283 entradas ZIP** com CRC válido, incluindo `LEIA_ANTES_NAO_INSTALAR.txt`.
- Nenhuma chave privada PEM/P12/PFX/ENV adicionada, nenhum certificado de assinatura novo, sem deploy ou alteração de licença.

## 8. Gates e continuidade obrigatória

- G0 Custódia: **PASS** — R69 preservada, hashes e diff.
- G1 Presença/rota: **PARCIAL** — Envios agora tem um renderer, porém a paridade total de ZapSaver/Gatilhos/Envios e ferramentas não está demonstrada.
- G2 Comportamento: **FAIL** — faltam E2E de Disparos, Agenda, Fluxos, Funis, Backup e ZapSaver.
- G3 UI/UX independente: **PARCIAL** — Disparos isolou seu CSS principal, Agenda/Envios possuem camada LITE; remain CSS de compatibilidade geral da Shell e componentes estruturais antigos.
- G4 Segurança: **PARCIAL** — as regressões locais passaram; falta verificação dos entrypoints e da licença em sessão real.
- G5 MV3/WhatsApp real: **BLOQUEADO** pela política do Chromium de laboratório; não contornar.
- G6 Acessibilidade: **PARCIAL** — teste de foco e responsividade sintética; leitor de tela/zoom avançado pendente.
- G7 DEV assinada e staging: **NÃO ALTERADO** — R51 continua última build reconhecida pelo serviço de homologação.
- G8 Release: **REPROVADA, NÃO LIBERAR**.

**Próxima etapa:** diagnóstico da autoridade e estado real de Envios; QA de Agenda cancel/refresh em conta consentida; UX independente do editor de Fluxos/Funis; redução do compat CSS geral por domínio; somente depois reemitir assinatura e testar MV3 no Chrome do proprietário.

**Governança:** nenhuma mudança na `main` GitHub, nenhuma mudança no `zvm.onrender.com`, nenhuma modificação no Render homologação ou Mongo Atlas durante R70. PR #124 permanece DRAFT no ramo isolado.