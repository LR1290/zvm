# ZVM Cloud R27 — Reserva transacional de capacidade e recuperação de uploads
**Data:** 2026-11-16. **Ambiente:** QA isolado, sem merge/deploy. **Branch:** `feature/cloud-r22-conta-persistente-studio-shell-20261116`, PR #117 (draft).

## Falha de origem demonstrada na auditoria

Na R26, a API de mídia grande verificava o total de arquivos existentes antes de iniciar a transferência; a API legada de arquivos pequenos conferia a cota em outra sequência de leitura/gravação. Embora a exclusão de mídias e os vínculos da Biblioteca já participassem de um fence transacional, **iniciar upload grande e gravar mídia pequena não participavam da mesma proteção de capacidade**. Logo, chamadas simultâneas poderiam aceitar dados além da cota combinada. Outro risco: uma transferência vencida deixava blocos temporários no Mongo até o TTL posterior.

## Invariante R27

Para cada conta autenticada, a cota é avaliada a partir dos dados persistidos:
```
ocupação_comprometida = soma(mídias_legadas) + soma(mídias_grandes_READY)
ocupação_reservada = tamanho_de_uma_transferência_PENDENTE_ou_FINALIZING
limite = 128 MiB por conta e 60 arquivos incluindo reserva pendente
```
Uma operação que faria `ocupação_comprometida + ocupação_reservada` exceder o limite é rejeitada. Arquivos legados mantêm suas restrições próprias (1 MiB/arquivo, 6 MiB no cofre legado e 24 itens), sem ampliar indevidamente o armazenamento em documentos. O uploader em blocos continua limitado a 32 MiB/arquivo e 256 KiB/bloco.

## Alterações implementadas

1. **`media-quota.js`:** cálculo puro, validação defensiva de contagens/tamanhos inteiros e recusa explícita de transações que excedem bytes ou itens. Nenhum contador de cobrança informado pelo cliente participa da decisão. Removido helper redundante não utilizado.
2. **Início de upload grande:** `store.beginMediaUpload` faz verificação de duplicidade, reserva e criação de sessão com o mesmo fence por conta da Biblioteca. MongoDB executa as leituras e `insertOne` da sessão na mesma transação snapshot/majority; uma única sessão ativa por conta continua assegurada pelo índice exclusivo. Em memória, o mutex por conta garante a mesma ordem. Resumos de upload existentes podem ser retomados de forma idempotente.
3. **Upload legado pequeno:** novo `store.addLegacyMedia` executa CAS, deduplicação, limite próprio do legado, reserva pendente e gravação sob o fence. A rota HTTP antiga que usava pré-verificações separadas foi removida. `writeMedia` também passa pelo fence e verifica cotas, incluindo fluxos internos de teste/migração.
4. **Finalização grande:** depois de validar SHA-256 de cada bloco e do arquivo, o Mongo atualiza o mesmo fence e verifica novamente os arquivos comprometidos e a reserva dentro da transação que publica o arquivo, preserva blocos e exclui a sessão. Esse segundo controle impede que uma conciliação/alteração externa torne READY um arquivo acima da cota. Falhas por cota deixam a sessão pendente cancelável, nunca um anexo parcialmente pronto. Conflitos transacionais conhecidos retornam erro de nova tentativa (HTTP 409), não conteúdo incorreto.
5. **Cancelamento/expiração:** cancelamentos continuam transacionais no Mongo e serializados no modo em memória. Ao observar uma sessão expirada, o servidor só exclui a sessão se o status/ID ainda coincidirem, e então descarta os blocos correspondentes. O TTL dos blocos permanece como proteção caso o processo caia antes da limpeza.
6. **UI / API:** `GET /api/media` apresenta `usedBytes`, `reservedBytes`, `availableBytes` e contagem de itens, sem revelar dados de outra conta. A interface informa espaço ocupado, reservado em transferência e livre. Não há aumento de limite, serviço adicional ou envio ao WhatsApp.
7. **Governança:** `cloud-pilot/test/helpers/fake-mongo.js` concentra o simulador Mongo reutilizado pelas suítes R26/R27; classes duplicadas da R26 foram removidas. O teste de contrato da interface R24 foi atualizado para exigir os novos métodos seguros. Todo arquivo adicional foi incluído no `npm run check`.

## Testes realmente executados

- **9/9 testes isolados R27 sobre código de armazenamento atual**, com Mongo simulado e módulo real: fronteiras exatas, reserva entre small/large, duas instâncias simultâneas, uma transferência ativa por conta, deduplicação, finalização após mudança externa, expiração e recuperação, transação abortada e casos em memória. O décimo teste, de servidor HTTP real em Node, está versionado, mas não foi executado em Node nesta rodada.
- **9/9 requisições simuladas contra o handler HTTP real**: autorização DEV, reserva, exposição de quota, isolamento entre contas, conclusão incompleta, cancelamento e recuperação de espaço.
- **12/12 testes isolados de regressão R26** utilizando o helper de Mongo compartilhado após remoção do código duplicado.
- **3/3 contratos de interface R24** com fontes atuais.
- Arquivos Node: `cloud-pilot/test/r27-media-quota.test.js` (10 testes), `cloud-pilot/test/helpers/fake-mongo.js`. Comandos de sintaxe e nova suíte incluídos no pipeline de verificações.

**Limitação da evidência:** as execuções acima usam V8 isolado com dependências simuladas e não constituem homologação em processo Node/Mongo/Chromium reais. GitHub Actions continua encerrando seus três jobs sem runner e sem executar etapas; não atribuir PASSED ao CI.

## Riscos/limites pendentes antes de publicação

- Executar `npm run check` no ambiente Node real com dependências bloqueadas, além de testes contra um MongoDB de homologação com replica set e transações/TTL/índices reais.
- Testar quedas de rede em cada transição de upload, transferências paralelas por dispositivos, expiração/cleanup e ausência de vazamento entre contas.
- Verificar limites e custos de armazenamento físico e tráfego, incluindo eventual resíduo de chunks após falhas de energia até o TTL; a cota lógica da conta não equivale ao tamanho efetivo do banco/índices/replicação.
- Garantir leitura consistente de arquivos durante downloads simultâneos à exclusão e implementar migração segura de armazenamento de objetos antes de permitir backups de grande volume.
- Homologar Chromium/Opera, celular, Biblioteca, ZIP e fluxo completo de login antes do deploy.
- Continuar os motores de Fluxos/Funis/Disparos e integração Meta autorizada; **R27 não é paridade completa com a extensão**.

**Regra de publicação:** nenhuma atualização de `main`, Render, Mongo de clientes ou licença; não mesclar PR #117 até cumprir os gates.
