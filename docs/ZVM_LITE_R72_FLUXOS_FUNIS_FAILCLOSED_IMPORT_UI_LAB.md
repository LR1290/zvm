# ZVM Automações LITE — R72 (laboratório): Fluxos, Funis e dados persistidos

**Estado: NÃO APROVADA • NÃO INSTALAR • NÃO ASSINADA.**  
**Origem auditada:** `ZVM_LITE_R71_FONTE_LAB_NAO_INSTALAR.zip`, fonte original localizada e extraída no ambiente da conversa.  
**Objetivo:** corrigir falhas reais dos painéis de Fluxos/Funis e avançar a identidade visual da LITE sem tocar motores de envio e sem copiar a Shell da ZVM completa.

## 1. Causas comprovadas e correções

### P0 — Botão Importar Funil sem evento de abrir arquivo

No `app/dashboard/features/funnels/runtime.js`, o botão `.extuiFunnelImportBtn` é instanciado dentro de `listActions` e só depois entra na toolbar. O código R71 fazia `header.querySelector('.extuiFunnelImportBtn')`, retornando `null`; assim nenhum listener chamava o seletor de arquivo. A R72 usa `listActions.querySelector`, no DOM onde o botão realmente existe. **Prova dinâmica:** Chromium, módulo real R71 → 0 ativações do input de arquivo; módulo real R72 → 1 ativação. Nenhum arquivo importado ou salvo no teste.

### P0 — Falha fechada ao ler definições e filas de Fluxos/Funis

As leituras de lista persistida da R71 admitiam listas inválidas como `[]` em determinados caminhos. Isso apresentava ausência falsa de dados; uma escrita posterior poderia substituir um estado corrompido sem alertar o operador.

A R72 cria `requireFlowList` e `requireFunnelList`, que aceitam ausência legítima de um campo em um registro antigo, mas recusam um campo presente com formato diferente de array ou elementos não-objeto. Quando a leitura falha, as listas e métricas visíveis são retiradas; os botões de criação/importação são desativados; a interface informa que os registros foram preservados e oferece **Tentar novamente**. Após recuperação comprovada da leitura, os controles voltam a ficar disponíveis. A chamada `saveFlows()` agora valida o array antes de passar ao `replaceAll`, sem substituição implícita por `[]`.

**Limites:** trata corrupção estrutural de lista e falha de repositório; não é um sistema de restauração automática de backup e não prova tratamento de todas as variantes históricas do schema. Não altera o conteúdo persistido nem executa uma migração de dados nesta rodada.

### UI/UX — Fluxos/Funis com identidade LITE

Criado `app/dashboard/lite/lite-automations.css`, carregado somente no Dashboard LITE. Possui composição própria para cabeçalho, indicadores, busca, ações, cartões, estados vazios, estados de falha, foco, responsividade e estilos de tema claro/escuro. Filtros limitados a `html[data-zvm-lite-ui="orbital"]`. **Não reimplementa o editor, Canvas ReactFlow, conexões ou algoritmo de Fluxos/Funis**, que exigem validação autêntica de interação com WhatsApp e dados autorizados.

**Resíduo conhecido:** `lite-feature-compat.css` (~993 KB) ainda contém estilos e componentes herdados; o novo CSS é uma camada visual isolada, não um desacoplamento completo do motor ou da Shell PRO. Não remover o CSS de compatibilidade cegamente.

## 2. Testes realizados

| Ensaio | Resultado | Alcance |
|---|---:|---|
| Sintaxe JS/MJS/CJS no runtime | **249/249** | `node --check`; não é boot de MV3 |
| Parsing de CSS | **12/12** | `tinycss2` |
| Recursos referenciados no Manifest V3 | **83/83** | Existência física dos caminhos |
| Recursos HTML do Dashboard | **66** referências válidas | Páginas adicionais: Disparos 32, Popup 9, Offscreen 7 |
| Contratos anteriores de recursos LITE R67 | **25/25** | Features, rotas, bloqueios de produto |
| Envios R71 — segurança de conta/aba | **8 cenários** | Regressão real executada na fonte R72, DOM sintético |
| Agenda R71 — motor | **8 cenários, 0 mutações** | Registros válidos/inválidos, Node VM |
| Agenda R71 — interface | **2 cenários** | Falha fechada e recuperação |
| Defeito da importação | **R71 falha; R72 passa** | Módulos reais em Chromium, sem importação de arquivo |
| Fluxos/Funis — corrupção e recuperação | **4 cenários** | Módulos reais em Chromium, nenhuma mutação |
| UI fluxo/funil responsiva | **10 cenários** | Temas light/dark × 420, 590, 650, 900, 1280 px; sem overflow JS |
| E2E Chrome MV3 + WhatsApp | **NÃO EXECUTADO** | Política do navegador do LAB impede instalação de extensão |

As capturas do Chromium são **fixtures DOM que reproduzem a estrutura das linhas reais**, e não capturas de conversa/conta real. Não houve mensagens, exportação, importação de arquivo, duplicação, alteração de licenças ou escrita no banco.

## 3. Comparação R71 → R72 e custódia

**Arquivos modificados (4):**
- `app/dashboard/features/flows/runtime.js`
- `app/dashboard/features/funnels/runtime.js`
- `pages/dashboard/index.html`
- `manifest.json` — identificação `R72 LAB`, versão numérica permanece **0.1.51** porque não houve nova assinatura.

**Novo (1):** `app/dashboard/lite/lite-automations.css`.  
**Removidos:** nenhum.  
**Fonte:** 283 arquivos, 284 entradas ZIP contando o aviso `LEIA_ANTES_NAO_INSTALAR.txt`.

- `ZVM_LITE_R72_FONTE_LAB_NAO_INSTALAR.zip`: **3.415.624 bytes** • SHA-256 `6901db68711d20e760c1d108cba8ba383345b8e64b374016882578416fa0d173`.
- `ZVM_LITE_R72_PATCH_R71_PARA_R72_NAO_INSTALAR.diff`: **19.267 bytes** • SHA-256 `d578d43338f0b3de8f3ca5985b3be3a6578e9805abe2c7db148a2502744d378a`.
- O registro de integridade e a assinatura DEV Ed25519 internos permanecem **os da R51**, intencionalmente desatualizados. Nenhum CRX3 foi gerado, **não instalar ou substituir a extensão no Chrome**.

## 4. Gates do Prompt Mestre R67

- **G0 custódia:** PASS (fonte e hashes auditados).
- **G1 paridade de navegação:** PARCIAL (importação Funis agora tem handler, mas fluxo completo de importação não foi exercitado).
- **G2 paridade funcional ZapVoice:** REPROVADA; faltam operações E2E e inspeção da versão recente da ZapVoice.
- **G3 UI independente:** PARCIAL; nova camada Fluxos/Funis, compat CSS/Canvas antigo ainda existentes.
- **G4 segurança/integridade:** PASS apenas nos casos sintéticos; faltam autoridades, persistência e sessão reais.
- **G5 WhatsApp MV3:** BLOQUEADO NO LAB; não contornar.
- **G6 acessibilidade:** PARCIAL; foco e responsividade sintéticos.
- **G7 assinatura/staging:** NÃO ALTERADO. Última DEV assinada/registrada no staging: R51.
- **G8 publicação:** NÃO LIBERAR.

**Governança:** Render de homologação, MongoDB Atlas, a key LITE, a ZVM completa, PR DRAFT #124 e `main` NÃO foram modificados nesta rodada.

## 5. Próximos bloqueadores

1. Executar teste autorizado da importação Funil do seletor de arquivos à persistência, incluindo arquivo malformado, duplicação, limites e backup, em ambiente descartável com licença de teste.
2. Confirmar criação/edição/reabertura de Fluxos e Funis, drag/drop, Canvas, conexões, pause/cancel e estados de execução no Chrome MV3 autorizado.
3. Migrar por domínio os estilos e componentes restantes de `lite-feature-compat.css`; não remover CSS operacional ou migradores de dados apenas por parecerem legados.
4. Verificar ZapSaver, Gatilhos, Backup e Disparos com base na matriz funcional da ZapVoice e identidade UI própria da LITE.
5. Somente depois dos gates comprovados, produzir nova DEV com identidade RSA estável + manifesto/descritor Ed25519 atualizados, e habilitar essa **mesma** build no staging isolado.