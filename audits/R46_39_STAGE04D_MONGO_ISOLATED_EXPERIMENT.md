# ZVM — R46.39 / Etapa 04D — MongoDB isolado: experimento transacional

**Checkpoint:** 09/10/2026. **Branch:** `audit/r46.39-stability`. **Produção:** `main` R46.38 (`7b58b35048ea2d107a61893e2de21a5e313028ec`), intocada nesta rodada.

## Escopo

Foi acrescentado um **ensaio experimental independente**, não integrado às rotas do servidor:
- `tools/r46-39-staging-ownership.js` — 20 cenários contra coleção artificial; somente executável em Mongo real após aprovação de staging explícita.
- `tests/r46-39-staging-ownership.test.js` — 25 grupos de testes usando Mongo simulado, sem acesso externo.
- `npm run check` agora executa o **teste com mocks**, além do `node --check`. O ensaio com banco **não roda automaticamente**.
- `npm run audit:r46-39:staging` fica disponível **somente** para execução manual com ambiente de teste segregado.

## Condições de proteção

Para ensaio real são exigidos `--isolated-staging`, `ZVM_R4639_STAGING_APPROVAL=I_CONFIRM_ISOLATED_STAGING_ONLY`, `ZVM_R4639_STAGING_URI` e `ZVM_R4639_STAGING_DB=zvm_r4639_stage_<sufixo aleatório>`. URI remota exige ainda `ZVM_R4639_REMOTE_STAGING_APPROVED=YES`. **Não reutilizar a URI nem usuário do Mongo de produção.** O script cria uma coleção aleatória `zvm_r4639_fixture_<24-hex>`, não toca `portal_users`, `store` ou `payments` e só remove sua própria coleção artificial. Os erros da CLI não exibem mensagens do driver, URI ou credenciais.

A autorização textual **não prova**, por si só, que o banco é realmente isolado: isso deve ser verificado operacionalmente por configuração de workspace, rede e permissões. Nenhuma conexão real ocorreu nesta rodada.

## Cenários do ensaio (20 verificações)

1. Índice único parcial criado na coleção fictícia.
2. Dois registros sem vínculo com string vazia são permitidos.
3. Campo ausente e `null` não disputam titularidade.
4. Primeiro titular recebe a licença artificial.
5. Duplicidade direta é recusada (`11000`).
6. Duas inserções concorrentes resultam em exatamente um vencedor.
7. A requisição concorrente perdedora recebe `11000`.
8. Desvincular e vincular sequencialmente mantém um titular.
9. A disputa concorrente mantém um único titular.
10. Atualização que duplicaria uma licença é recusada.
11. A atualização recusada não altera o titular legítimo.
12. Contas sem vínculo permanecem sem vínculo.
13. Resultado da transferência transacional é registrado, e falha de infraestrutura é recusada.
14. A unicidade se mantém após a tentativa de transação.
15. A transação abortada preserva o titular anterior; se concluída, registra a transferência.
16. Nomes dos indicadores são não sensíveis.
17. O resultado da transação contém apenas código classificatório.
18. Os registros observados pertencem ao conjunto sintético.
19. A contagem esperada de cenários é validada.
20. A coleção fictícia é removida e a ausência dela confirmada.

## Resultados que podem ser afirmados

- **20 verificações sintéticas / PASS** em dois modelos simulados: uma transação retorna `duplicate_key` e outra `committed`.
- **25 grupos de proteção / PASS**, incluindo ausência de configuração, rejeição de banco de produção evidente, formatos de nome, controle de escrita, limpeza e falha explícita quando transações não são suportadas.
- `node --check` da ferramenta e do teste: PASS em Node 22.16.0.
- Execução da CLI sem autorização: corretamente bloqueada antes de abrir conexão.
- O conteúdo dos dois arquivos enviados ao GitHub foi validado por SHA Git idêntico aos arquivos locais testados.
- **Não foram executados:** MongoDB real, Node >=24.20 da produção, Chromium autenticado ou `npm run check` da branch completa neste ambiente.

## Resultado de segurança e próximos gates

A condição P1 de dupla titularidade em `/cliente/registro` e `/cliente/vincular` **permanece aberta**. Os dois resultados simulados de transação são deliberados: não inferir como o MongoDB de produção se comportará. Antes de qualquer correção de runtime, executar o ensaio em staging Mongo isolado com transações reais, censo read-only de duplicidades, ensaio da troca de e-mail, integração Cakto, caso de rollback, teste Node 24+ e Chromium.

**Não fazer deploy, merge, alteração de índice real ou remoção de `ZVM_CWS_COMPAT` a partir deste relatório.** Próxima etapa grande fica reservada para rodada própria; checkpoint limpo.
