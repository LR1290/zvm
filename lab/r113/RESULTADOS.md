# R113 — laboratório sobre a R112

Base integral identificada pelo SHA-256 92a50e88103a79504fc2881d44391c4f2017973c3dd6b7d9158a2154a9f03a69; backend e cadeia de QA no PR #148, 5ebe43729e224a0717fd229eac3378c2c907e0c0. Aplicar theme.patch a uma cópia dessa extensão com patch -p1. A única alteração funcional da extensão está em app/shared/core/theme-system.js. O script prepare-owner.py atualiza o rótulo da candidata e sua metadata de integridade ao assinar. Nenhuma alteração no Modo Fácil, escopos de licença ou motores de envio.

## Causa, medição e limites

O observador do tema acrescentava cada #app substituto à mesma instância sem desconectar os alvos anteriores. Um nó antigo ainda referenciado podia disparar refresh. Além disso, cada notificação reiniciava o timer de 120 ms. Eventos mais frequentes que esse intervalo adiavam o trabalho enquanto durassem. Separar o observador da raiz do app permite desconectar o anterior sem perder html/body. Um único timer pendente usa o estado atual ao vencer.

Em 100 substituições sintéticas com intervalo virtual de 10 ms, a R112 criou 100 timers e entregou um único refresh em 1110 ms. A candidata criou 9 e entregou o primeiro em 120 ms, totalizando 9 refreshes. O mock registrou 103 alvos na R112 e 3 na candidata. Esses números não medem heap, CPU ou latência no WhatsApp. Em Chromium offline usando MutationObserver real, uma alteração de classe no nó antigo gerou 1 callback de refresh na R112 e 0 na candidata; a alteração equivalente no nó atual gerou 1 em ambas.

O inventário CSV cobre os 314 scripts e enumera ocorrências estáticas. Os 13 scripts document_start e 73 document_idle foram preservados. Os três maiores scripts declarados são Disparos (189316 bytes), Fluxos (149992) e Funis (109301). Uma decisão de lazy loading requer trace de inicialização, grafo de consumidores e ensaio de recuperação de automações pendentes.

## Reprodução

Rodar theme-bench.cjs e theme-browser.cjs com argumentos raiz-R112 e raiz-candidata. A segunda suíte usa Playwright, CHROMIUM_PATH opcional e uma página offline. Rodar inventory.py com a raiz da extensão. minify-theme.cjs usa Acorn 8.15.0 e compara a AST antes e depois. O arquivo já compacto ficou com 84859 bytes em ambas as etapas. Baseline R112: 84742 bytes.

PASS: nove hashes da transferência, CRC, verificação independente da assinatura da R112, runtime full 357/357 em VM, rejeição de adulteração, sintaxe 314 scripts candidatos, seis contratos forenses em ambas as árvores, 31 testes de QA do repositório sobre a candidata, 19 de integração cliente/backend reaproveitados do laboratório, 20 de cota e npm run check. Não somar essas suites como cenários distintos. O histórico cita 35 testes; esta rodada identifica cada suíte reexecutada separadamente.
FAIL inicial: testes de campanha buscavam indentação e comentário removidos na minificação. Corrigidos os delimitadores para as declarações das mesmas funções. As asserções foram conservadas. PASS após correção.
PASS: ensaio do kit de assinatura com chaves efêmeras e árvore de teste; rejeição da chave errada para a fonte real. Nenhuma assinatura institucional R113 foi produzida.
BLOCKED: instalação real sob a política administrativa conhecida, conta consentida de WhatsApp e emissão institucional local. NOT_RUN: login e autorização em servidor real, lote WhatsApp, suspensão física, memória de sessão longa, backup/restauração IndexedDB e jornadas completas de UI.
Render QA conferido na região Oregon, autoDeploy=no, último deploy live 497d4704f59a9d0d20541ff639f4b94f0da9cb5e. Atlas do projeto 6affa482ea8023c6275175e2 com M0 ativo, CIDRs 74.220.48.0/24, 74.220.56.0/24 e 0.0.0.0/0. O conector oferece inspeção e criação de entradas; falta operação autenticada de remoção. Validar egress atual do serviço no Dashboard e remover somente a entrada mundial no projeto QA, depois verificar ACL e conectividade. Não foram realizadas escritas, alterações de licenças ou deploys.
