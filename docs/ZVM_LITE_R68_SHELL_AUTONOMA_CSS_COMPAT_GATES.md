# ZVM LITE — R68 (LAB / NÃO INSTALAR)

Data: 18/11/2026. Fonte: R67 LAB, derivada de R51 assinada. R51 permanece a última DEV assinada em homologação; R68 NÃO é instalável nem assinada. Status: REPROVADA por falta de paridade e E2E.

## Implementação

- Novo renderer `app/dashboard/lite/lite-shell-nav.js`: quatro grupos exclusivos LITE, rótulos Envios/ZapSaver, acessibilidade, menu compactável, persistência local específica, guarda de edição/projeção; mantém contrato de eventos `navItem[data-section]`.
- `app/dashboard/shell/core.js` delega a renderização ao componente LITE; 195.375 -> 183.215 bytes. Continua contendo infraestrutura compartilhada, não declarar desacoplamento total.
- Dashboard não importa `app/dashboard/styles/main.css` da edição completa. Novo `app/dashboard/lite/lite-feature-compat.css` (1.078.576 bytes) derivado via parser CSS; 1.895 ocorrências de seletores diretos da Shell/navigation filtradas. CSS próprio de topbar, rail, diálogo/busca e acesso passa a morar em `app/dashboard/lite/lite-shell-ui.css`.
- `app/dashboard/styles/main.css` ainda requerido por `pages/disparos/index.html`: não remover até a migração do recurso; não é carregado pelo Dashboard LITE.
- Corrigido tema claro no cabeçalho. Contraste de texto da busca 6,57:1 em Chromium sintético. O CSS de compatibilidade e o Shell core restantes continuam legados: G3 PARCIAL.
- Fontes R67 e R51 preservadas. R68 alterou 4 arquivos, adicionou 2 e removeu 0.

## Testes reproduzidos

- 248/248 JS/MJS/CJS sintaticamente válidos.
- 65/65 referências locais no HTML Dashboard; 83/83 referências principais do manifest.
- R67 contract 25/25; R51 command bus 19, adapter 11, profile/migração 11 asserções aprovadas.
- Projeção canônica real do Shell LITE: 14 rotas, sem CRM/IA/Follow-up/Respostas Rápidas.
- Chromium sintético: menus, grupos, foco, compactação, persistência mockada, temas dark/light, 1200/900/650 px sem overflow, nenhum pageerror.
- Compat CSS: zero seletores diretos de Shell/nav em AST recursiva.
- Nenhum teste MV3 autêntico: política de Chromium no laboratório bloqueia instalação. Não contornar.

## Artefatos locais da conversa (não carregar)

- `ZVM_LITE_R68_FONTE_LAB_NAO_INSTALAR.zip` — 3.603.836 bytes — SHA256 `ad10d14ed05c2c15dd3a6001ddfdbec571dc5a9eacdb38e56b01aafdd2a3c93e` — 280 entradas CRC OK.
- `ZVM_LITE_R68_PATCH_R67_PARA_R68_NAO_INSTALAR.diff` — SHA256 `9c865d6898250c88bbdfe99019b815d6d7bca85d35e4498c60d17579a7dafd2b`.
- `ZVM_LITE_R68_RELATORIO_QA_NAO_HOMOLOGADA.md` — SHA256 `ec4cba1ecdef65a835afb4b67c4cb2d455c4c4e6e9959830cfbca5a904e45a03`.

## Gates do Prompt Mestre R67

G0 PASS; G1 FAIL; G2 FAIL; G3 PARCIAL; G4 PARCIAL; G5 BLOQUEADO; G6 PARCIAL; G7 NÃO ALTERADO; G8 NÃO LIBERAR.

Servidor Render `zvm-lite-homolog-20261118`, banco Atlas LITE e `zvm.onrender.com` não alterados. PR #124 permanece DRAFT, sem merge. Não atualizar autoridade V4 para R68 sem assinatura DEV e E2E.

Pendência: CSS remanescente de componentes por módulo, separação das superfícies reais de Fluxos/Funis, Envios/Agenda, ZapSaver, Gatilhos, Backup, e testes no Chrome do proprietário.
