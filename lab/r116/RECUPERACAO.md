# Recuperação da candidata R116

Worktree encontrado em lab/r116-motores, descendente direto de 486222bcc6906d77c209a37c997b3b3ff6ba4850 (PR #151). A candidata, o patch e as evidências já estavam presentes antes desta retomada. O inventário lista os 359 caminhos com seus hashes. SHA-256 do próprio inventário: 9844d5eb1a4d2eaacfadad37ca28aba7149da64e3c55e84a0c4952d87af55f4b.

## Código recuperado

| Área | Mudança | Evidência |
|---|---|---|
| action-engine.js e send-safety.js | Preservam o envio confirmado antes de erro posterior e em respostas aninhadas. Protegem a identidade da execução concorrente, conferem a conta após a espera de autorização e impedem entrada tardia na ponte após expirar o prazo. | executor.jsonl, concurrency.json, switch.jsonl, timeout-before-bridge.jsonl |
| flows/engine.js e funnels/engine.js | Fluxos reutilizam a decisão de revisão antes do fallback. Funis conservam a evidência de efeito no cancelamento. | controls.txt, recovery.txt, motor-path.jsonl |
| broadcast/panel.js | Disparos conservam a evidência parcial e permitem sair da revisão durante a espera. Retirar a aprovação impede a admissão testada. | admission.jsonl, preflight.json, motor-path.jsonl |
| followup/engine.js e offscreen-options-data.js | Persistem a fila antes da posse e cada desfecho antes da tentativa seguinte. Protegem troca de conta, operações em revisão e histórico de membros. Eventos simultâneos compartilham a leitura de estado. | follow-tick.jsonl, sequence-checkpoint.jsonl, membership-history.jsonl, claim.txt, scope-membership.jsonl, tick-stress.jsonl |
| dashboard/features/followup/runtime.js e panel-followup-domain-core.js | Exibem separadamente operações processadas e envios confirmados. Iniciar uma automação filha gera FollowUpProcessed. O evento FollowUpSent exige confirmação de envio. | child-receipt.jsonl. A contagem visual em perfil instalado permanece NOT_RUN. |

Entradas antigas de Follow-up sem vínculo comprovado com a conta WhatsApp, e entradas potencialmente afetadas pelo truncamento histórico em 200 membros, ficam para revisão. O teste com 250 membros reproduziu 50 novas entradas pendentes indevidas na base e zero na candidata. O patch preserva os registros.

## Como reproduzir

Partir da árvore da extensão correspondente ao PR #151, com os patches anteriores já aplicados. Aplicar motores.patch uma vez a uma cópia com patch -p1 --fuzz=0. Executar reproduzir.sh com a árvore da base e a da candidata, CHROMIUM_PATH apontando para Chromium e Playwright disponível em NODE_PATH. O script confere os hashes antes dos testes. Na recuperação foi usada a cópia já existente; a comparação byte a byte com a árvore de desenvolvimento e a checagem inversa do patch foram realizadas sem modificar as fontes.

motor-path.jsonl contém os quatro percursos desde o adaptador do motor até o journal em IndexedDB real. A ponte WhatsApp e as autoridades externas são simuladas. Após a perda de ACK e reload, cada repetição terminou em revisão com zero chamadas à ponte. session-stores.jsonl exercita o código de sessão real com armazenamento simulado. As respostas tardias deixaram a identidade nova nos três armazenamentos.

O ensaio preservado em soak.jsonl acompanhou uma revisão intermediária do executor por 30 minutos de carga e mais 62 segundos para expirar a retenção. Foram 19.000 chamadas simuladas ao gate. O heap após GC passou de 1.235.952 para 6.590.120 bytes no pico inicial e terminou em 1.429.592 bytes. As amostras registraram 14 listeners e 7 nós. Esse perfil cobre execuções vazias; mídia, serviço MV3 suspenso e WhatsApp real exigem ensaios próprios.

## Estado do aceite

Os resultados são de laboratório. O estado por jornada consta na [matriz A–N](../zvm-audit/COBERTURA.md). Continuam BLOCKED a instalação assinada, o ciclo real do worker e a homologação com conta QA consentida. Permanecem NOT_RUN os controles e tipos de mídia sem medição de latência, além dos percursos completos de importação, backup e CRM. A assinatura da base não cobre a candidata.
