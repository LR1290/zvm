# ZVM — R46.44 / Gate consolidado de homologação — NÃO PUBLICAR

Data: 2026-10-09. Projeto: ZVM - Automações. **Produção intocada:** `LR1290/zvm` `main` commit `7b58b35048ea2d107a61893e2de21a5e313028ec` (R46.38). Branch exclusiva: `candidate/r46.44-ownership-integration-staging`, baseada em `candidate/r46.42-terms-cakto-review`.

## Consolidado nesta branch
1. R46.40: página pública `/termos` com 16 seções, idiomas PT-BR/PT-PT/EN, CSS e links no footer institucional. **Pendente revisão jurídica.**
2. R46.41: comparação exata de linhas de identificadores de transação Cakto; elimina a colisão por prefixo reproduzida nos testes.
3. R46.39/R46.44: módulo único `src/portal-license-owner.js` ligado ao registro, vínculo, desvinculação, troca de e-mail do Portal e vínculo do pipeline Cakto. Usa `portal_users.keyCode` como única fonte de verdade; consulta de índice exclusivo parcial válida exigida para vincular licenças; erro fail-closed se a garantia não existe.
4. R46.39: expiração imediata de sessão 2FA, revalidação antes de promoção, remoção por telefone estável e CAS persistido para dispositivos.
5. Testes: unidade de titularidade concorrente; fixture HTTP de sessão/remoção com DB falso; verificador estático de wiring; teste da integração **padrão** da Cakto; pré-voos e ensaio do Mongo com dados sintéticos.
6. Ferramentas `audit:r46-39:ownership-readonly` e `audit:r46-39:isolated-staging`, invocação manual com flags/ambiente explícitos; `npm run check` **não se conecta ao MongoDB real**.

## Resultados comprovados nesta rodada
- Snapshot local equivalente à R46.44: `npm run check` exit=0, Node 22.16.0, incluindo CWS/Build3, Cakto e Termos. Cópia local tem pequenas diferenças editoriais e fixture HTTP adicional; **não declarar checksum integral igual ao arquivo remoto** sem checkout limpo.
- Fixture HTTP com rotas reais e Mongo simulado: 13/13 grupos PASS (registro concorrente, índice ausente, vínculo, desvínculo, transferência e rollback).
- Teste do adaptador padrão Cakto sem mock de `linkPortalUser`: 4/4 grupos PASS (renovação, índice ausente, comprador sem Portal, conflito).
- Ensaio isolado de transações Mongo **simulado**: 25/25 grupos de proteção e 20/20 verificações de cenário PASS.
- Chromium local: página renderizada com HTML/CSS real, mobile/desktop, sem erros JS no teste de renderização. **Navegação HTTP direta: `ERR_BLOCKED_BY_ADMINISTRATOR` no ambiente**, portanto não foi E2E completo.
- MongoDB real de staging e Node >=24.20.0: **não disponíveis** neste ambiente. Sem consulta a licenças/pagamentos reais.

## Bloqueios P1 antes de liberar o servidor
1. Executar censo *read-only* em Mongo para índice legado, contas com `keyCode` duplicado ou não canônico, dados de 2FA e mudanças de e-mail pendentes. Não exibir conteúdo pessoal e não alterar registros.
2. Executar ensaio em Mongo replica set staging **com contas totalmente fictícias**: criar índice único parcial, provar corrida registro/vínculo, confirmar *delete+insert* com mesmo `keyCode` na mesma transação, erros 11000, rollback e transações abortadas. Alguns relatos de Mongo alertam que reatribuição do mesmo valor exclusivo durante transação pode falhar; não inferir comportamento apenas de mocks.
3. Se troca de e-mail transacional falhar no banco real, redesenhar a identidade imutável do usuário ou escolher outro contrato **sem criar segundo dono da licença**. Bloquear migração até solução comprovada; nunca permitir duas contas com chave igual.
4. Homologar Cakto com claims, outbox, replay, renovações reais via consulta *read-only* e com teste explícito de falha após persistência de licença. O hotfix de prefixos corrige apenas uma causa conhecida, não comprova as demais.
5. Executar suíte completa no Node suportado >=24.20, Chromium em staging real e medir performance antes/depois. Confirmar exatamente qual release da CWS 0.9.0 está publicada antes de retirar `ZVM_CWS_COMPAT`.
6. Validar fornecedor (nome/razão social, CPF/CNPJ, contato/endereço), texto de cancelamento/refundos na Cakto, revisão jurídica PT-BR/PT-PT/EN. OAuth Drive/People API continuam em homologação.
7. Somente após todos os gates: revisão diff/segredos, backup/rollback e **autorização expressa** para merge na main e deploy no Render.

## Segurança operacional
**NÃO FAZER MERGE, DEPLOY OU MODIFICAÇÃO DE ÍNDICE NA PRODUÇÃO.** A candidata R46.44 está intencionalmente protegida: sem índice correto, certas operações de vínculo falharão em vez de romper o isolamento; isso impede usá-la como hotfix imediato. Não reaproveitar credenciais do Mongo de produção para testes de escrita.
