# ZVM Automações LITE — R73: integridade da importação e vínculos de Fluxos

**Data de referência:** 18/11/2026, Brasil.  
**Estado:** **LABORATÓRIO / NÃO APROVADA / NÃO INSTALAR / NÃO ASSINADA**.  
**Fonte:** R72 LAB (`ZVM_LITE_R72_FONTE_LAB_NAO_INSTALAR.zip`, SHA-256 `6901db68711d20e760c1d108cba8ba383345b8e64b374016882578416fa0d173`).

## 1. Problemas confirmados na R72 e tratamento na R73

### P0 — Importador truncava dados válidos sem aviso

No `app/dashboard/features/funnels/runtime.js`, a função `importPortableFunnel` enviava o arquivo diretamente para `funnelsCore.serializeDefinition()`. Esse serializador limita `macroStages` a 40 e `automations` de cada macroetapa a 20 usando `.slice()`. A consequência era importação com **perda silenciosa de dados**. Reproduzido em Node VM executando o código **real da R72**: um Funil de 41 macroetapas foi aberto com apenas 40.

**Correção:** validação anterior à normalização. Arquivos são recusados antes de abrir o editor quando ultrapassam os limites efetivos, trazem estrutura inválida, tipo de passo desconhecido, esquema desconhecido ou unidade/quantidade de intervalo incompatível. Após serializar, a contagem de passos, macroetapas e automações é conferida novamente para impedir qualquer truncamento incidental.

- Limites testados: **128 passos**, **40 macroetapas**, **20 automações por macroetapa** e **2 MB** de JSON.
- Aceita `.zfunnel` e `.json`; JSON legado com definição direta permanece aceito quando reconhecível. Envelopes precisam declarar `ZVM_FUNNEL_PORTABLE_V1`. Outras versões são recusadas até existir migração explícita.
- Valida tamanho informado pelo arquivo e tamanho efetivo em UTF-8, sem confiar exclusivamente no atributo `File.size`.
- Unidades e tipos de ação desconhecidos deixam de ser convertidos silenciosamente para valores potencialmente perigosos.
- Importação é de **revisão**: gera uma cópia com novo ID e `favorite=false`, desliga o `universalTrigger` pela rotina canônica e desativa cada automação de macroetapa, preservando seus detalhes e exigindo aprovação manual no editor.
- Passos de IA legados permanecem visíveis para revisão/backup, mas não passam no `preflight()` da LITE; nenhuma IA foi reativada.
- A importação não faz escrita automática; o usuário precisa revisar e salvar.

### P1 — Referências corrompidas apareciam como lista vazia

O mesmo runtime apresentava `flowList` inválido como `[]` em `loadFunnelFlowReferences`. Isso podia simular a exclusão de vínculos e ocultar informações relevantes sobre automações de Funil.

**Correção:** a ausência legítima de uma lista continua sendo considerada vazia; uma lista presente com formato inválido, ID vazio ou IDs duplicados é rejeitada com `LITE_FUNNEL_FLOW_REFERENCES_CORRUPT`.

O editor e o acompanhamento de execuções exibem um erro visível com botão **Tentar novamente**, sem gravar, iniciar, pausar ou cancelar operações nesse estado. O código elimina o falso “nenhum Fluxo” quando a leitura está danificada.

## 2. Evidências e regressões executadas

| Ensaio | Resultado | Limite do teste |
|---|---|---|
| Reproduzir truncamento no runtime R72 | Reproduzido: 41 → 40 macroetapas | Node VM com serializador real |
| Contratos importação R73 | **22 aprovados** | Node VM; abertura positiva do editor com stub e sem escrita |
| Upload de arquivo no seletor | 3 verificações positivas | Chromium 144, DOM sintético |
| Referências de Fluxos: falha e recuperação | 4 verificações positivas | Chromium 144, runtime real com repositório simulado; zero mutações |
| Regressões runtime Fluxos/Funis R72 | **6** | Chromium com DOM controlado |
| Regressões Envios R71 | **8** | Chromium com repositório simulado |
| Regressões Agenda | Falha e recuperação aprovadas | Chromium sintético |
| Responsividade Fluxos/Funis | **10** combinações de tema e largura | Chromium sintético |
| Contratos básicos R67 | **25/25** | Node VM |
| JS/MJS/CJS | **249/249**, `node --check` | Não comprova boot de extensão MV3 |
| CSS | **12/12**, `tinycss2` | Parsing; não confirma fidelidade visual completa |
| Referências no manifesto | **83/83** | Arquivos locais existentes |
| Referências HTML | **114**, sem caminhos ausentes | Dashboard 66, Disparos 32, Popup 9, Offscreen 7 |
| Chrome MV3 + WhatsApp Web real | **NÃO EXECUTADO** | Ambiente de testes bloqueia extensão; não contornar |

**Atenção:** a abertura positiva de um Funil importado foi verificada no runtime isolado por uma substituição controlada do renderizador do editor; o teste Chromium fez o upload real de arquivos inválidos e verificou bloqueios, sem concluir uma importação real até persistência. Não afirmar E2E de importação ou equivalência à ZapVoice.

## 3. Comparação e integridade R72 → R73

- Arquivo de código alterado: `app/dashboard/features/funnels/runtime.js`.
- Arquivo de aviso adicionado: `LEIA_R73_LAB_NAO_INSTALAR.txt`.
- Nenhum arquivo removido. **284 arquivos na fonte**, ZIP com **285 entradas** incluindo aviso de topo.
- `ZVM_LITE_R73_FONTE_LAB_NAO_INSTALAR.zip`: **3.417.884 bytes**, SHA-256 `cf2f179ed9e0ff50368c85ac8f620723d42dbc927e57913ee1474afb26d6ee9d`.
- `ZVM_LITE_R73_PATCH_R72_PARA_R73_NAO_INSTALAR.diff`: **12.569 bytes**, SHA-256 `ab7ef61b693b2793d1dc713edce8b3b67f14ad3733e95057c2ebb4cc9190b0d1`.
- ZIP CRC: todas as entradas verificadas.
- Integridade e descritor V4 herdados da R51 permanecem **históricos e inválidos para a fonte R73**. Manifesto conserva `0.1.51`, sem assinatura R73. **Não instalar como extensão.**

## 4. Gates de aprovação e pendências

- **Paridade com ZapVoice 3.18.19:** ainda não comprovada em operações reais; 3.18.19 é a referência binária inspecionada, não garantia de paridade com versões posteriores.
- **UI/UX LITE independente:** parcial. Fluxos/Funis têm CSS próprio de interface, porém o editor de nós e aproximadamente 993 KB de CSS de compatibilidade permanecem herdados.
- **Importação de Funis:** integridade estrutural validada; faltam dependências de Biblioteca, reabertura após salvar, erros de escrita e cancelamento real, além do fluxo de arquivos compatíveis com backup.
- **Fluxos/Funis:** faltam E2E de edição, duplicação, histórico, pausas, conexões, retomada e vínculos válidos em WhatsApp Web autenticado.
- **Gates de assinatura/licenciamento:** não houve assinatura ou atualização no Render. Última DEV registrada no staging: **R51**, mantida sem alteração.
- **Segurança:** nenhum envio de mensagens, contato real, importação gravada, deleção de dados, mudança no MongoDB, no serviço comercial ou na `main`.

**Decisão:** a R73 permanece LABORATÓRIO / NÃO HOMOLOGADA. Só produzir nova DEV instalável quando integridade, identidade, código, testes MV3 e paridade funcional forem comprovados.