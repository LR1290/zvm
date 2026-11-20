# Plano de execução e aceite

Conferidos o mandato integral (mandato.sha256) e o [comentário do PR 150](https://github.com/mythos52/zvm/pull/150#issuecomment-7030484256). A reconstrução partiu do ZIP DEV 0.9.305 com SHA-256 92a50e88103a79504fc2881d44391c4f2017973c3dd6b7d9158a2154a9f03a69. Cada patch foi aplicado uma vez, com fuzz zero, e cada árvore intermediária foi comparada byte a byte à cópia correspondente. Ordem dos patches: lab/r113/theme.patch, lab/r114/rail.patch, lab/r114/auth.patch, lab/r115/session.patch e lab/zvm-audit/recovery.patch. trees.sha256 usa SHA-256 sobre linhas “hash  caminho” terminadas por LF, ordenadas por caminho. inventario.csv inclui todos os 359 arquivos. Os indicadores de efeito e consumidores literais orientam a investigação. O grafo do PR 151 ainda não resolve todas as mensagens, importações dinâmicas e migrações.

| Prioridade | Causa, impacto e prova | Critério seguinte |
|---|---|---|
| P0 motor de envio | Falha síncrona de indexedDB.open deixava a promessa rejeitada em cache. Mesmo com o banco disponível, a próxima operação legítima falhava até fechar a conexão ou reiniciar. recovery.patch limpa exclusivamente a tentativa rejeitada. journal.jsonl registra a falha da R115 e a recuperação da candidata. | Exercitar motores completos, ACK tardio, pausa e cancelamento durante despacho. |
| P1 sessão/teardown | A espera indefinida por KEY retinha no window o listener da árvore removida. O prazo de recuperação agora remove o listener e evita atualizar DOM desconectado. teardown.jsonl contém antes/depois. | Validar instalação real, suspensão e reentrada, troca de contas e resposta positiva fora de ordem com worker real. |
| P1 DOM | Retenção antiga do tema e espera coletiva da barra foram corrigidas em PRs anteriores. Stress progressivo de tema e bandeja cobriu 1/10/100/1000/10000. | Capturar pintura, animações, CPU limitada, traces e heap em sessão prolongada. Medir cada controle em rede rápida/3G/offline. |
| P2 resíduos | Zero arquivos excluídos. Ausência de referência literal não comprova desuso. | Resolver consumidores dinâmicos e dados legados antes de propor remoção, com rollback verificável. |

## Reprodução e orçamento

Na pasta deste documento, com Node, Chromium e Playwright disponíveis, definir CHROMIUM_PATH para o executável de laboratório e NODE_PATH para a dependência. Executar:

~~~sh
node journal.cjs "$R115" "$CANDIDATA"
node login-teardown.cjs "$R115" 1
node login-teardown.cjs "$CANDIDATA" 0
node theme-stress.cjs "$R112" "$R113" "$R114" "$CANDIDATA"
node tray-stress.cjs "$R112" "$R113" "$R114" "$CANDIDATA"
node ../r115/login-timeout.cjs "$CANDIDATA"
node ../r115/key-resume.cjs "$CANDIDATA"
node ../r115/authority-order.cjs "$R114" "$CANDIDATA"
~~~

Orçamento por controle: feedback até 100 ms, painel local até 300 ms, navegação ideal até 500 ms, recuperação da UI até 1000 ms. tray.jsonl mede tempo síncrono de solicitar e fechar a bandeja com animação desativada. Os percentis empíricos incluem a granularidade do relógio do navegador. O teste não mede apresentação de frame nem rede. theme-stress.jsonl mede trabalho com relógio virtual. journal.jsonl usa o módulo inteiro e IndexedDB real num contexto Chromium isolado com origem interceptada, sem servidor real. Reload preserva o banco e descarta o contexto JS. A primeira montagem da suíte de regressão falhou por ausência da dependência de cota da fixture. Reposta a ligação para o módulo existente, 56 testes passaram.

## Critérios restantes

Aceite de componente requer os cenários da matriz, contratos de consumidores e ausência de falhas abertas no escopo medido. Registrar violações do SLA como FAIL. O aceite global exige todos os P0/P1 resolvidos e evidências reais das jornadas essenciais. Próximos lotes: motores e ACK; rede e ciclo de vida de sessão; Biblioteca/CRM/backup com fixtures históricas; perfil longo e acessibilidade; QA autorizado. Regra ampla de Atlas registrada no mandato: validar egress e obter autorização específica antes de qualquer mudança. Candidata LAB sem assinatura institucional.
