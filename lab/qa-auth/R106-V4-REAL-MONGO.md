# R106 — continuidade V4 em MongoDB 8 real (laboratório)

**Projeto:** ZVM Automações COMPLETA. **Base:** PR #141 sobre #140, sem ligação com a migração de banco #137.

## Porque essa prova é necessária

O teste R105 exercita as funções reais do servidor, mas injeta um banco em memória. Isso não comprova o comportamento de BSON Date nem o filtro atômico do driver MongoDB quando logout e refresh disputam a mesma sessão.

O job `mongo-session-race-real` da suíte de sessão inicia um container MongoDB 8 descartável em `127.0.0.1:27020`. **Nunca usa Atlas/Render/WhatsApp, conta, licença ou bearer reais.** O teste recusa execuções que não tenham os marcadores exclusivos do CI e usa uma base fictícia `zvm_r106_v4_test`.

## Cenários integrados de aceitação

1. Conta recente é lida; refresh preserva o TTL de inatividade de 7 dias como BSON Date no MongoDB.
2. Conta criada há 29 dias e com `expiresAt` excessivo é limitada ao teto absoluto original de 30 dias.
3. Conta criada há 31 dias é recusada inclusive se o campo de expiração de inatividade ainda aponta para o futuro; nenhum update estende a sessão.
4. `absoluteExpiresAt` inconsistente no futuro não eleva o teto além do `createdAt` original.
5. Datas de expiração/criação inválidas são rejeitadas.
6. Sessões de licenciamento comercial e DEV assinada conservam TTL separado do teto de conta.
7. Intercalação real: refresh lê a sessão válida, uma chamada concorrente revoga a sessão no MongoDB, e a resposta atrasada do refresh recebe `session_revoked` (nunca reativa o usuário).
8. A base temporária é descartada e sua ausência é verificada. O container é removido pelo GitHub Actions mesmo em falha.

O teste utiliza extratos dinâmicos de `server.js`, não uma reimplementação paralela da regra de sessão. Executa sem segredo de produção e sem alteração de dados de clientes.

## Limite de interpretação

Essa suíte é uma prova de CAS/banco e **não substitui** Chrome MV3 instalado com WhatsApp homologado, retorno de Wi-Fi, suspensão real do notebook, assinatura institucional da candidata DEV e testes de envio. Na tentativa local, o Chromium headless não expôs um service worker para a árvore R99 alterada e a tentativa gráfica não forneceu execução conclusiva. **Não declarar MV3 homologado por esse resultado.**

Sem deploy, CWS, merge, alteração de licença ou banco oficial nesta etapa.
