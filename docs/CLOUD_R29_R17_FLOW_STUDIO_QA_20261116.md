# ZVM Cloud R29 — Editor visual de Fluxos compatível com a estrutura R17
**Checkpoint:** 16/11/2026 • **Branch:** `feature/cloud-r22-conta-persistente-studio-shell-20261116` • **PR:** #117 (DRAFT) • **Produção:** não modificada.

## Origem comprovada na extensão R17

A fonte `ZVM_AUTOMACOES_R17_FONTE_COMPLETA_QA_NAO_INSTALAR_20261115.zip` foi inspecionada:
- `app/dashboard/features/flows/runtime.js`: `flow.id`, `name`, `description`, `color`, `isActive`, `startNodeId`, `trigger`, `nodes`, `nodeGroups`; nó inicial `start` com `position`, `data`, `nextNodeIds` e saídas especiais; tipos de nó `sendText`, `end`, `condition`, `userInput`, `delay`, `randomizer`, e tipos de mídias/CRM.
- `app/dashboard/features/flows/templates-core.js`: exemplos reais de `sendText.data.text`, `nextNodeIds`, `end.data.label`, ramificações e agrupamentos.
- `app/shared/core/flow-portability.js`: grafo com caminhos `nextNodeIds`, `nextNodeIdOnExpiration`, `nextNodeIdOnDifferentAnswer`, `nextNodeIdOnConditionFalse`, pesos e `nodeGroups`, com remapeamento de identificadores.

**Decisão:** implementar edição inicial **restrita e sem perdas** no formato de dados da R17, sem reutilizar o runtime Chrome/WA-JS no servidor e sem alterar nós avançados cujo significado completo ainda não foi homologado.

## Implementação R29

1. `flow-graph-core.js` (compartilhado): catálogo de tipos, leitura de conexões diretas, ramificações e fanout e diagnóstico de integridade/alcançabilidade. A tela e o servidor chamam a mesma implementação — nenhuma segunda regra divergente de fluxo.
2. `flow-graph-domain.js` (Node, sem transporte WhatsApp): criação de rascunho com nó inicial, edição de nome/descrição/cor, gatilho manual/palavra-chave, adição de `sendText` e `end`, edição de `data.text`, posicionamento de nós, conexão/desconexão de saídas simples e exclusão controlada. Rejeita IDs inexistentes, ligação cíclica, auto-conexão, coordenadas inválidas, alteração de saídas avançadas, exclusão de nó com referências de entrada ou pertencente a grupo. Nó avançado importado pode ser reposicionado, mas seus dados/saídas permanecem intactos.
3. `POST /api/workspace/flows/graph`: conta real do Portal + chave DEV vinculada + origem permitida + revision CAS da Cloud. Atualiza somente o Fluxo selecionado dentro do array, preservando outros registros e campos desconhecidos. `checkWhole` e `checkAudience` continuam aplicados; `store.writeWorkspace` aplica a proteção transacional R26 antes de confirmar. Não há ações de envio, agendamento nem ativação.
4. Rota genérica anterior `PUT /api/workspace/flows` recebe `405 use_flow_graph_editor` para evitar substituição integral sem as regras do editor. Backup/importação continuam por `/api/import/preview` e `/api/import/commit`, com preservação dos registros originais.
5. `public/cloud-flow-studio.js/.css`: editor funcional com navegação à esquerda, canvas SVG de conexões, cards selecionáveis, inspector de propriedades à direita e layout móvel responsivo. Controles reais para criar, adicionar, editar, vincular, desvincular e organizar etapas; prévia da mensagem **abaixo** do campo de texto; atalhos de direção por botões para organizar nós sem depender de arrastar; cores e contraste alinhados à identidade ZVM.
6. Segurança de UI: `textContent`/DOM seguro (sem `innerHTML` em dados de terceiros), CSP e assets locais; `zvm-cloud-locked` zera a UI; respostas HTTP atrasadas só são aceitas dentro da mesma época autenticada, impedindo que Fluxos retornem após logout.
7. Importações malformadas ou tipos de nó não homologados permanecem visíveis e sinalizados; botão de adição fica desativado quando `nodes` não é uma lista. Não há auto-conversão destrutiva nem criação de conteúdo sintético para “parecer pronto”.
8. A tela substitui o **placeholder genérico** `cloud-list-flows`; os dados de contagem seguem integrados ao dashboard via evento `zvm-cloud-flow-changed` e `workspace.js`.

## QA realizado neste checkpoint

- **11/11 verificações V8 isoladas no domínio R29** com fonte exata da branch: schema inicial, títulos, mensagens, conexões, conflitos, ciclo, alteração de posição, preservação integral de nó avançado, metadados de gatilho e limites.
- **8/8 simulações de API autenticada usando o `server.js` real da PR** com persistência CAS simulada: criação, atualização, conta B vazia, revisão antiga 409, conexões, bloqueio entre contas e ausência de envios.
- **4/4 testes comportamentais do DOM simulado**: boot, criação/edição/conexão, limpeza ao bloquear sessão, resposta atrasada pós-logout e Fluxo antigo estruturalmente inválido.
- Sintaxe JS dos arquivos alterados validada por compilação V8.
- Suítes versionadas no `npm run check`: `cloud-pilot/test/r29-flow-graph.test.js` e `r29-flow-ui-behavior.test.js`, além de `node --check` para core/domain/UI.

**Limitação da evidência:** os cenários acima foram exercitados em V8 com partes simuladas do Node, DOM e store. O runner GitHub Actions das versões anteriores falhava com zero etapas e sem runner. `npm run check` **não** foi executado integralmente no repositório, tampouco Chromium com Portal/MongoDB reais. A PR continua QA.

## Faltam para paridade real e liberação

- Undo/Redo persistente, seleção múltipla, agrupamento/desagrupamento, arrastar com teclado/touch, Fit View, auto-organização e inspetor de todas as saídas/condições avançadas no padrão da extensão R17.
- Regras de fanout, aleatorização, condições, espera de resposta, biblioteca de mídia, gatilhos completos, validação de dependências e simulação de jornada com dados reais.
- Motores de Fluxos/Funis/Disparos no servidor com filas, autorização, status, consentimento, transporte Meta oficial homologado, observabilidade e idempotência. O browser WA-JS da extensão não é automaticamente transportável ao Render.
- Auditoria de custos, Mongo real com transações, erros de autenticação/403 intermitentes, stress, restauração ZIP de arquivos grandes, QA Chromium/Opera e celular real.
- **GATE: não mesclar a PR #117, não atualizar Render nem dados/licenças de clientes até a paridade completa estar homologada.**
