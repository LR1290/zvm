# ZVM Automações COMPLETA — Auditoria recursiva R112

**Origem auditada:** `ZVM_AUTOMACOES_DEV_0.9.305_R111_SEM_MODO_FACIL_OTIMIZADA_ASSINADA_QA.zip` (SHA-256 `ca18fec5c134c134fae2c96c42469dc2f07deb06112219643c101a0a82f1f3c2`).

**Resultado:** candidata DEV R112 assinada com a chave institucional `dev-2026-01` (**chave privada não incluída**). Não é uma RELEASE e não foi homologada no WhatsApp real do proprietário.

## Causas reproduzidas e correções

1. **Storm de eventos e starvation do rail nativo do WhatsApp.** `app/sidebar/native-whatsapp-rail.js::refreshStates` realizava uma consulta imediata depois de cada mudança enquanto outra consulta ainda estava em andamento; ao mesmo tempo, `refreshPending` fazia DESCARTAR os resultados obtidos. Sob eventos contínuos, os botões permaneciam desatualizados. R112 agrupa notificações com intervalo de 250 ms, aplica resultados válidos mesmo que exista nova atualização pendente, executa no máximo um novo refresh ao fim e limpa timers no `stop()`. **Somente consultas de estado** têm limite de resposta de 3,5 segundos (fail-closed), nunca os comandos de envio.

2. **Observador de anexos custoso demais.** `app/sidebar/lifecycle.js::extSidebarOffsetAttachmentPopup` observava `document.body` com `subtree:true, attributes:true, childList:true` durante até 60 segundos, recebendo alterações de todas as conversas. R112 observa **o popup e sua cadeia de ancestrais**, sem observar atributos em toda a subárvore do WhatsApp. Restauração no fechamento/remoção do popup preservada. Consultas de estado da Sidebar também foram limitadas a 3,5 segundos e reportadas em caso de timeout.

3. **Busca desnecessária dentro das próprias mutações da ZVM.** `app/content/core/whatsapp-structure-broker.js::recordFlags` pesquisava todos os descendentes de elementos próprios antes de descobrir que eram mutações da extensão. R112 filtra `isOwned(node)` antes da busca, mas ainda identifica corretamente estruturas nativas do WhatsApp e mudanças de tema.

4. **Varredura dispendiosa de texto para localizar Meta AI.** `app/sidebar/native-whatsapp-rail.js::mutationTouchesMetaAi` acessava `textContent` de subárvores arbitrárias e repetia buscas profundas. R112 privilegia atributos semânticos e restringe a leitura de texto à própria ação/botão ou navegação relevante.

## Testes reproduzidos com Chromium executando scripts reais

| Contrato medido | R111 | R112 | Evidência |
|---|---:|---:|---|
| Chamadas de `commands.state` do rail, durante ~210 eventos | 96 | 16 | `baseline_native.json`, `optimized_native_final.json` |
| Estado dos botões durante a tempestade de eventos | Incorreto até parar | Correto | Idem |
| Callbacks do observador de anexos com ~165 alterações alheias | 165 | 0 | `baseline_popup.json`, `optimized_popup.json` |
| Buscas profundas por mutações próprias da ZVM (480 elementos) | 480 | 0 | `baseline_broker.json`, `optimized_broker.json` |
| Estrutura do WhatsApp, compositor e tema ainda detectados | — | 3/3 | `test_broker_host.py` |
| Fechamento do popup libera observador | PASS | PASS | `benchmark_popup.py` |

*As reduções medem esses caminhos no laboratório; não demonstram melhora equivalente no desempenho global do WhatsApp Web.*

## Segurança, integridade e regressões

- ZIP original R111 verificado sem erro CRC. **359 arquivos** preservados em número; R112 altera **4 arquivos-fonte** + **2 arquivos de metadados de assinatura**. Outros **353 arquivos** permanecem idênticos ao R111.
- `manifest.json`: nome **ZVM Automações**, versão `0.9.305`, ID DEV `ckbffcbmanboelbihfkhiahgafnimcho`, permissões, hosts e `manifest.key` idênticos à R111; apenas `version_name` alterado.
- **35/35 testes Node PASS** (29 testes de integração Free V4/envios + 6 contratos forenses), **314/314 scripts JS/MJS** passaram no parser Node.
- Os 3 módulos modificados passaram pela minificação conservadora com AST TypeScript preservada (sem renomeação de símbolos, sem compressão perigosa).
- Verificador REAL `foundation-integrity.js`, executado sobre o ZIP assinado: **357/357 arquivos protegidos, full, ok=true**.
- Adulteração de um único byte (mantendo comprimento) rejeitada pelo runtime com `EXTENSION_INTEGRITY_FAILED`.
- Patch R111→R112 aplicado com `git apply --check` e `git apply` em cópia isolada e comparado byte a byte com os 4 arquivos finais: **4/4 iguais**.

## Não homologado — limitações objetivas

- O Chromium headless local retornou `ERR_BLOCKED_BY_CLIENT` ao tentar abrir o popup da extensão e não iniciou o service worker MV3. Portanto, **não houve instalação real validada** nesta execução.
- Não foram executados login real, suspender/despertar notebook, Disparos/Funis/Fluxos, ACK do WhatsApp ou testes de stress com dados reais.
- O arquivo da extensão ainda aponta para o backend exclusivo `zvm-completa-qa-r104.onrender.com`. Suas autorizações de build e KEY PRO devem ser testadas no navegador do proprietário.
- **Não gerar RELEASE comercial** até completar a homologação e revisar a cadeia dos PRs sem merge.
- O bootstrap ainda contém **86 scripts de conteúdo** (13 `document_start`, 73 `document_idle`, cerca de 1,77 MB). Mantidos por dependerem do grafo real; eventual divisão adicional requer análise de dependências e regressões específicas.

## Assinatura R112

- Arquivo: `ZVM_AUTOMACOES_DEV_0.9.305_R112_FORENSE_PERFORMANCE_ASSINADA_QA.zip`
- SHA-256: `92a50e88103a79504fc2881d44391c4f2017973c3dd6b7d9158a2154a9f03a69`
- BuildId: `zvm-dev-0.9.305-s092158cfff7c`
- Fingerprint: `0395ac8683eb82dc134c61d4274e0b9e97f62b9103afcdb3bc6dc38e81b2b254`
- Assinada em: `2026-11-20T02:55:52.802Z`; validade: `2026-11-27T02:55:52.760Z`

Nenhum merge/deploy Render/Chrome Web Store, nenhuma alteração em clientes ou bancos ocorreu nesta rodada. A DEV R112 é de homologação e não deve substituir a RELEASE comercial.