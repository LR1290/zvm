# R111 — ZVM Automações: remoção do Modo Fácil e estabilização da Sidebar

**Escopo:** correção exclusivamente da **extensão COMPLETA**. Base imutável: R110 SHA-256 `e9b02bb22f6336f08bfc77953d6de38cf129f94260e338575ec9dfc331ddd9bb`. O código de extensão da R110/R111 é distribuído como ZIP de laboratório assinado, **não** está no checkout do servidor. O patch auditável R110→R111 está no pacote `ZVM_R111_AUDITORIA_E_PATCH_SEM_SEGREDOS.zip`.

## Mudança da árvore da extensão (seis arquivos de fonte)

- `app/sidebar/view.js`: remove `Modo Fácil`, launcher, categorias, busca, criação da bandeja redundante e eventos associados; preserva menus `automations` e `customize` e atalhos originais.
- `app/sidebar/workspace-profile.js`: remove `sidebarTrays.easy`, sem modificar modelos nem regras de acesso.
- `app/sidebar/style.js`: remove todos os seletores `.extappRailEasy*` e muda `grid-template-rows` de **4** para **3** (header, viewport e footer).
- `app/sidebar/lifecycle.js`: coalescência do refresh de comandos com limite de 250ms, sem invalidar a execução atual quando há eventos em sequência. Cache de assinaturas de estado visual, invalidado quando o menu ou workspace é alterado e no unmount.
- `app/shared/core/ui-language.js`: remove 6 traduções órfãs da bandeja retirada.
- `manifest.json`: mantém chave pública e o mesmo ID DEV, versão 0.9.305, host_permissions e content_scripts; altera somente `version_name` para R111.
- Metadados de `integrity.json` e `build-identity.json` **regenerados e assinados** com chave Ed25519 institucional, sem armazenar a chave privada.

## QA efetivamente realizado no laboratório

- Arquivos totais: **359**; arquivos protegidos: **357**.
- Node: **29/29** testes de integração PASS e **314/314** arquivos JS/MJS válidos.
- Runtime: `extIntegrityVerify(true, "full")` → **357/357 PASS** e fingerprint correspondente; adulteração sintética rejeitada.
- Chromium real, página de prova com dependências simuladas: launcher ausente, 3 linhas no grid, itens normais presentes, bandejas Automações e Atalhos funcionando, sem erro JS.
- Stress sintético de 1,5 s com um evento a cada 12 ms, latência de 25 ms por consulta (6 comandos visíveis):
  - R110: **108 chamadas** a `commands.state`
  - R111: **36 chamadas** (redução de **66,7%**).
- Medição não significa que o WhatsApp inteiro ficou 66,7% mais rápido; exige instalação e telemetria local (sem PII) para avaliar a alegação de lentidão geral.

## Artefato DEV assinado — NÃO homologado em WhatsApp real

- `ZVM_AUTOMACOES_DEV_0.9.305_R111_SEM_MODO_FACIL_OTIMIZADA_ASSINADA_QA.zip`
- SHA-256: `ca18fec5c134c134fae2c96c42469dc2f07deb06112219643c101a0a82f1f3c2`
- Build ID: `zvm-dev-0.9.305-s676bf5c76fec`
- Ext ID: `ckbffcbmanboelbihfkhiahgafnimcho`
- Assinatura: `dev-2026-01`; validade até 2026-11-27T02:32:26.146Z.
- Não alterar RELEASE comercial ou produção. A QA KEY separada vence independentemente.
- **Preservar backups de IndexedDB e pasta antes de atualizar de R110 para R111.**

Sem merge, sem deploy Render, sem CWS.
