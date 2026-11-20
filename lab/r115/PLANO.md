# Auditoria global | continuidade da R114

Base 4256874a2b39af21cfffa5d98f127170a273e65a, PR #150. Comentário integral consultado em https://github.com/mythos52/zvm/pull/150#issuecomment-7030484256. Texto integral do mandato pendente de disponibilização.

1. **Inventário e dependências (P1)**. inventory.csv contém caminho, bytes e SHA-256 para cada arquivo da extensão candidata. dependency-edges.csv permite buscar tanto os consumidores quanto os arquivos referenciados. A extração é lexical, inclui literais de metadados e não resolve todas as chamadas JavaScript ou recursos dinâmicos. Completar o grafo com os namespaces compartilhados, RPC e registros lazy antes de eliminar qualquer dependência.
2. **Autenticação (P0)**. Exercitar conta e KEY com integridade atrasada, conta sem resposta, troca de formulário e falhas tardias. Aceite integral requer ainda provar, com armazenamento real e reinício do worker, que uma resposta antiga jamais reativa a sessão e que timeout não concede autoridade. A interface libera nova tentativa manual após 750 ms de espera. O timer não revoga sessões no servidor.
3. **Campanhas e cotas (P0)**. Regressões de reserva e confirmação no laboratório. Aceite exige concorrência em processos independentes, troca de conta, reinício, pausa e cancelamento com ACK tardio e zero reenvios de efeito incerto.
4. **Desempenho e cobertura (P1)**. Medir R112/R113/R114/R115 com o mesmo executável e carga. Executar 1/10/100/1000/10000 eventos quando aplicável, medir p50/p95/p99/máximo por jornada, heap, listeners, observers e RPC em sessão longa e após teardown. O comparativo atual cobre um botão independente com outro comando atrasado em 1300 ms. Cinco amostras por revisão só permitem uma comparação descritiva.
5. **Compatibilidade e resíduos (P2)**. Validar cada candidato a remoção contra o grafo, carga dinâmica, migração e dados históricos. Nenhum arquivo removido nesta rodada.
6. **Homologação (P0)**. Validar instalação MV3 assinada no Chrome autorizado, emissão e revogação QA, usuários Free/PRO, WhatsApp consentido e Atlas segregado. Registrar artefato assinado, hash, revisão, logs e resultado de cada jornada. Estado global em aberto.

## Matriz de jornadas

A tabela classifica o critério global de cada linha. Os PASS parciais são identificados pela evidência. Para todas as linhas ficam NOT_RUN as combinações de start, uso, concorrência, erro, timeout, cancelamento, retomada e limpeza que a coluna de evidência não identifica.

| Jornada | Estado global | Evidência obtida / próximo aceite |
|---|---|---|
| Bootstrap, worker, offscreen e integridade MV3 | BLOCKED | Inventário estático completo da extensão. Instalação em Chrome autorizado e suspensão real pendentes. |
| Sessão V4 conta/KEY, Free/PRO, revogação | BLOCKED | PASS de ordenação no worker (authority-results.txt), timeout e nova tentativa no DOM (login-result.json), regressões de logout em regression.txt. Falta ciclo real com armazenamento e servidor QA. |
| Backend e Atlas | BLOCKED | Testes locais de recuperação e cotas em backend-tests.txt. Falta concorrência multiprocessos em Atlas exclusivo autorizado. |
| Sidebar e rail | NOT_RUN | PASS do cenário independente com estado lento e resposta obsoleta, em rail-comparison.jsonl. Falta jornada completa de navegação. |
| Quick Shelf e atalhos | NOT_RUN | Montagem, uso, conflito de atalhos e teardown pendentes. |
| Temas | NOT_RUN | Ensaio histórico no PR #149. Falta soak com troca de host e temas. |
| Biblioteca, mensagens, áudio, documentos e agenda | NOT_RUN | Regressões da guarda e cota em regression.txt. Falta jornada de cada tipo. |
| CRM | NOT_RUN | Falta cadastro, edição concorrente, reconexão e persistência. |
| Fluxos e Funis | NOT_RUN | Faltam retomada de nó, cancelamento e efeito incerto por motor. |
| Disparos | NOT_RUN | Regressões locais de timeout e envio protegido. Falta reinício real durante campanha. |
| Follow-up | NOT_RUN | Faltam vencimento offline, retomada e troca de conta. |
| Backup, migração e restauração | NOT_RUN | Faltam fixtures históricas e interrupção durante escrita. |
| Diagnóstico, privacidade e teardown | NOT_RUN | Faltam ciclo de montagem repetida, contagem de listeners/observers e perfil de heap. |
| WhatsApp real | BLOCKED | Requer instalação validada e conta de QA consentida. |

## Reprodução

Aplicar session.patch com patch -p1 a uma cópia R114. Executar inventory.py com a raiz absoluta da candidata. Executar authority-order.cjs com as raízes R114 e R115. Para login-timeout.cjs passar a raiz R115. Para compare-rail.cjs passar as quatro raízes em ordem cronológica. Os dois ensaios DOM utilizam Playwright com CHROMIUM_PATH apontando para Chromium. As 56 regressões anteriores foram reexecutadas e não entram na contagem de testes novos.
