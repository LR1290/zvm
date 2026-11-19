# ZVM Automações LITE — R69 | Biblioteca com UI própria e saneamento CSS | LAB NÃO INSTALAR

**Data:** 18/11/2026 (America/Sao_Paulo)  
**Checkpoint de entrada:** R68 — fonte de laboratório, **não assinada/não instalável**.  
**Resultado:** progresso técnico verificado; **NÃO APROVADA** para instalação, publicação ou declaração de paridade funcional com a ZapVoice.  
**Escopo:** camada visual da Biblioteca, dependências CSS e QA da Shell, sem alterações nos motores de envio nem na licença.

## 1. Proveniência e integridade

- Entrada: `ZVM_LITE_R68_FONTE_LAB_NAO_INSTALAR.zip`, SHA-256 `ad10d14ed05c2c15dd3a6001ddfdbec571dc5a9eacdb38e56b01aafdd2a3c93e`.
- R68 continha **279 arquivos de fonte**. R69 contém **280 arquivos**; 4 modificados, 1 novo, nenhum removido.
- Arquivos alterados:
  - `app/dashboard/lite/lite-feature-compat.css`;
  - `app/dashboard/lite/lite-shell-ui.css`;
  - `pages/dashboard/index.html`;
  - `manifest.json` (identificação **R69 LAB NÃO INSTALAR**; a versão histórica `0.1.51` permanece porque não foi reassinada).
- Novo: `app/dashboard/lite/lite-library.css`, estilos próprios do domínio Biblioteca.
- **Nenhuma chave privada** ou arquivo PEM de segredo incluído no runtime. Nenhum código proprietário da ZapVoice foi transplantado.

## 2. Causas e correções

### 2.1 CSS de recursos excluídos ainda carregado

A R68 usava `lite-feature-compat.css` com **1.078.576 bytes**, incluindo estilos do CRM, Follow-up, IA, Integrações e Respostas Rápidas autônomas da edição completa — módulos vetados pela política da LITE.

Foi executado um saneamento por **AST CSS (`tinycss2`)**: removidos **791 grupos de seletores proibidos**, resultando em **661 regras inteiras eliminadas**, 25 regras com seletor compartilhado parcialmente preservado e 7 alternativas `:is()`/`:where()` filtradas isoladamente. As três regras em que Flow compartilhava `:is()` com CRM foram protegidas para que o visual de Fluxos não fosse eliminado por engano.

- CSS compatibilidade após limpeza: **992.783 bytes** (**85.793 bytes a menos, redução de 7,95%**).
- Nenhum seletor direto conhecido das famílias vetadas permaneceu na folha filtrada.
- **Resíduo justificado:** estes 992 KB não foram descartados porque ainda estilizam recursos permitidos (Envios, Agenda, Fluxos, Funis, Biblioteca, modais). Remoção além deste ponto exige QA funcional de cada módulo; ocultar ou remover indiscriminadamente comprometeria a LITE.
- O `main.css` original da versão completa **continua na árvore** devido ao uso na página separada de Disparos. Não é carregado pela Shell do Dashboard LITE. Deve ser migrado em rodada própria.

### 2.2 Identidade visual da Biblioteca

O novo `lite-library.css` entrega uma composição diferenciada da ZVM completa:

- painéis independentes **Lista / Prévia**, com bordas, superfícies e espaçamentos derivados da paleta Orbital da LITE;
- pesquisa, favoritos, adicionar, seleção do item, estados vazios e foco acessível com estilo próprio;
- visualização lateral em larguras largas, empilhada em telas estreitas;
- correção de cor e fundo para a **prévia textual fallback** em claro/escuro (não altera a renderização nativa específica de mídia/WhatsApp);
- estilos restritos a `html[data-zvm-lite-ui="orbital"]` e à Biblioteca, evitando interferência direta nas demais telas.

**Atenção:** o CSS antigo de mecânica da Biblioteca ainda fornece estilos estruturais para editores e modais. A identidade independente é verificável no teste sintético, mas G3 **ainda não está concluído** para todos os painéis do produto.

### 2.3 Correção encontrada na Shell após verificar a tela

No tema escuro, texto da marca, da busca e do estado WhatsApp herdava cores inadequadas ou pretas no header. A R69 define cores explícitas para o tema escuro e mantém as regras de contraste do claro. Não altera estado de conexão nem autenticação.

## 3. Testes executados

| Teste | Resultado observado | Limite |
|---|---|---|
| Sintaxe Node.js | **248/248** arquivos JS/MJS/CJS válidos | Não prova boot MV3 |
| CSS | Arquivos CSS parseados; **0 seletores diretos** das famílias bloqueadas no compat | Pode existir CSS legado não classificado |
| Estilos de recursos permitidos | Preservados 244 seletores de Biblioteca, 141 Agenda, 964 Disparos, 583 Funis, 1.140 editor de Fluxos e 179 suporte compartilhado, incluindo reescrita dos `:is()` mistos | Comparação de seletores, não E2E |
| Manifesto | **83** entradas JS/CSS referenciadas existentes | Sintaxe, não instalação |
| Dashboard | **64** recursos locais do HTML presentes | Não simula sessão |
| R67 contratos | **25/25** asserções passaram | Componentes isolados |
| Autoridade de comandos | **19** asserções negativas/positivas passaram | Gate local, não rede real |
| Registro de comandos | **11** comandos permitidos; nenhum CRM/IA/Follow-up | Não testa todos os entrypoints |
| Migração/Modo Fácil | **11** asserções passaram | Storage sintético |
| Shell nav R68 | 14 rotas do catálogo real; 4 grupos no DOM; Chromium sem page errors | DOM sintético |
| Biblioteca R69 | Chrom(e/ium) com layouts largo/estreito, tema claro/escuro em **420, 650, 750, 900, 1050, 1280 e 1420 px**; sem overflow nem page errors | Dados e DOM sintéticos |
| Contraste texto busca e prévia | Claro: **11,58:1** e **12,10:1**; escuro: **11,27:1** e **12,34:1** | Computed styles de fixture; não leitores de tela |
| Pacote LAB | **281 entradas ZIP**, CRC íntegro, sem arquivos privados identificados | Sem assinatura DEV |

**QA visual:** `r69_library_dark.png`, `r69_library_light.png`, `qa_r69_shell_dark.png`, `qa_r69_shell_light.png`, `qa_r69_shell_compact.png` são capturas do DOM sintético no Chromium. **Não representam WhatsApp Web autenticado**, nem garantem a montagem com todos os dados reais.

## 4. Artefatos e hashes

- **Fonte LAB:** `ZVM_LITE_R69_FONTE_LAB_NAO_INSTALAR.zip` — **3.584.487 bytes**, SHA-256 `6674ab168997b55364a03fb6a5101e032c6a3d2db0b6146b09343a868665bd24`.
- **Diff R68→R69:** `ZVM_LITE_R69_PATCH_R68_PARA_R69_NAO_INSTALAR.diff` — **155.007 bytes**, SHA-256 `5cfff3cd502ad6f88182f2bc2385cbe8b6ca1f707c095fce83ed52ce5bd8b726`.
- **Status de assinatura:** deliberadamente **não assinado**. Descritor V4/manifesto da linha R51 não foi substituído por declaração não comprovada. O ZIP contém `LEIA_ANTES_NAO_INSTALAR.txt`.

## 5. Gates R67 e trabalho restante

| Gate | Status R69 | Evidência/pendência |
|---|---|---|
| G0 — Custódia | **PASS** | R68 preservada, hashes e diff |
| G1 — Paridade de presença | **FAIL** | Falta validar comportamento total ZapSaver/Envios/Agenda/Gatilhos/Backup etc. |
| G2 — Paridade comportamental | **FAIL** | Sem sessão E2E, persistência real e ações completas |
| G3 — UI/UX própria | **PARCIAL** | Shell + Biblioteca visual independentes; compat CSS 992 KB e demais painéis legados |
| G4 — Segurança | **PARCIAL** | Regressões herdadas PASS; entrypoints restantes não auditados nesta rodada |
| G5 — MV3/WhatsApp real | **BLOQUEADO** | Ambiente de laboratório impede instalação MV3 (`ERR_BLOCKED_BY_CLIENT`); não contornar |
| G6 — Acessibilidade/zoom | **PARCIAL** | Contraste/responsividade sintéticos; zoom 200%, leitor de tela e teclado real pendentes |
| G7 — Staging/assinatura | **NÃO ALTERADO** | Render LITE segue aceitando a última R51 assinada; chave e Mongo preservados |
| G8 — Entrega comercial | **NÃO LIBERAR** | Nenhuma release candidata nesta etapa |

## 6. Próxima etapa priorizada

1. Retirar a dependência de `main.css` **da página separada de Disparos**, migrando primeiro seus estilos estruturais para CSS próprio LITE sob QA visual e operacional da página.
2. Reduzir o compat CSS por domínio real (Agenda/Envios e depois Fluxos/Funis), **sem remover estilos compartilhados que são necessários**.
3. Testar funcionalidades reais: Biblioteca CRUD e tipos, Favoritos, agendamento, confirmação, cancelar, backup, ZapSaver (CSV/VCF/filtros), Fluxos/Funis/Gatilhos, flags por plano e encerramento seguro.
4. Somente após G0–G4 aprovados, gerar DEV assinada preservando ID Chrome `ongildapieobgiamfjgnnnpelbeamfbk`; validar com WhatsApp autenticado no Chrome/Opera permitido antes de uso comercial.

**Governança:** nenhum merge na `main`, nenhum deploy ao `zvm.onrender.com`, nenhuma modificação de clientes/licenças na produção, nenhuma alteração do staging nesta rodada. A R51 continua a última assinatura reconhecida; a R69 é *fonte de laboratório*, não substitui a R51 para instalação.