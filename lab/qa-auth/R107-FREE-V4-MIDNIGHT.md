# R107 — reconciliação Free V4 após perda de resposta na virada UTC

**Problema comprovado no contrato:** se uma reserva V4 é gravada no backend, mas o retorno HTTP se perde, o journal local conserva `reservation_pending` com o dia calculado no navegador. Ao virar o dia UTC ou com relógio do notebook adiantado, o cliente pode consultar um período diferente daquele em que o banco contabilizou a reserva. Isso cria recibo pendente que não aparece na consulta ordinária e pode bloquear o operador.

## Correção do servidor (PR #141)

A ação **somente leitura** `reconcile` procura o mesmo `operationId` no período solicitado e nos **3 dias UTC válidos** (dia atual e dois dias anteriores), escopados exclusivamente à identidade autenticada pelo bearer V4. Essa busca não insere, altera ou devolve créditos.

- Se encontrar exatamente um recibo: informa `period` canônico do servidor e seu estado real.
- Se encontrar o mesmo `operationId` em mais de um dia: `operation_period_conflict` (409), sem arbitrar quem ganhou nem autorizar novo envio.
- Se o tipo for diferente: `operation_type_mismatch` (409).
- Ausente / fora da janela: `not_found`, sem afirmar que a mensagem não foi enviada no WhatsApp e **sem reenviar automaticamente**.
- Os caminhos `reserve` e `settle` permanecem atômicos e restritos ao período exato. Não ampliamos o limite de cota nem a janela de settlement.

## Patch da extensão de laboratório

`lab/qa-auth/reconcile-r107.patch` aplica-se **após** R99 → auth-r103.patch → auth-r104.patch → campaign-r104.patch na cópia verificada da fonte R96; não é um ZIP instalável. O cliente tenta uma segunda busca **somente `reconcile`**, sem `period`, apenas quando o servidor rejeita um período futuro/inválido. O período que o servidor confirma substitui o local do journal; quando `not_found`, mantém o período original.

O patch foi aplicado com `patch --dry-run` e `patch -p1` sobre a árvore R99 reconstruída, e o código modificado passou no `node --check`. Foram executados os 16 testes anteriores de integração do kit R99 e quatro novos cenários de recuperação (20/20 PASS) contra o código real modificado; sem WA-JS de rede, WhatsApp ou dados de clientes. O teste reproduzível adicional está em `lab/qa-auth/r107-client-reconcile.test.cjs`, para execução com `ZVM_LAB_SOURCE` apontando ao staging R104/R107 do operador.

## Aceite e pendências

- CI do servidor: regressões `tests/r98-v4-free-quota.test.js`, incluindo as novas contraprovas de madrugada, conflito de período, isolamento por sujeito e ausência de replay.
- Este trabalho está **somente em PR DRAFT**, sem merge e sem deploy. Não modifica a RELEASE do Chrome, nem autoriza ativação Free/PRO.
- Necessário ainda aplicar o patch à árvore R104 completa, verificar hashes/assinatura institucional numa DEV nova, testar MV3 e WhatsApp consentido, simular perda de resposta real e madrugada UTC. O laboratório Chromium disponível não demonstrou carregamento estável do worker MV3: isso permanece BLOQUEADO, não PASS.
- Não republicar a R96 assinada após a mudança. O atestado antigo é inválido para qualquer árvore modificada.

