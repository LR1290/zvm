# ZVM — R46.44 | Homologação técnica acumulada | 2026-10-09

**Status: candidata de staging, NÃO PUBLICAR.** Base `main` R46.38 SHA `7b58b35048ea2d107a61893e2de21a5e313028ec`. Branch `candidate/r46.44-ownership-integration-staging` sobre `candidate/r46.42-terms-cakto-review`.

## Implementado na branch de staging
- Termos R46.40 (/termos com 16 seções e 3 idiomas), Cakto R46.41 (comparação exata do identificador de transação), módulo de titularidade `portal_users.keyCode` usado em registro, vinculação, desvinculação, transferência de e-mail e ligação comercial pela Cakto.
- Segurança: sessões de 2FA expiram ao serem verificadas; remoção de dispositivos usa telefone estável e CAS persistido; falhas de índice e troca de e-mail são logadas sem conteúdo sensível.
- Censo de índices e duplicidades, pré-voo read-only e laboratório de Mongo com banco/coleções sintéticos, flags explícitas e sem execução automática.
- Testes automatizados vinculados ao `npm run check` da branch para titularidade, dispositivo/2FA, índice, Cakto e proteção de rotas.

## Testes efetivamente executados no ambiente local
- Snapshot de código equivalente R46.44: `npm run check` **PASS** em Node **22.16.0** e **24.11.1**. A engine declarada na aplicação continua **>=24.20.0 <27**; esse requisito não está cumprido.
- Rotas HTTP reais com Mongo simulado: **13/13** grupos de segurança (disputa de chave por contas, índice ausente, vínculo/desvínculo, transferência e rollback).
- Adaptador Cakto padrão, sem substituição de `linkPortalUser`: **4/4** grupos (renovação, ausência de índice, compra sem Portal e conflito entre contas).
- Laboratório de operações Mongo sintéticas **sem DB real**: **25/25** verificações de proteção e **20/20** verificações de cenário; testes adicionais de módulo em memória previamente aprovados.
- HTTP local: `/`, `/termos`, `/privacidade`, `/planos`, `/faq` e `/googleb72a9c76039b24b4.html` retornaram **200** tanto na R46.42 quanto na candidata R46.44. Corpo HTML/verification byte a byte idêntico nos seis endereços. Medianas de 20 amostras locais na faixa ~1–5 ms, sem evidência de regressão significativa; não equivale a benchmark de produção.
- Chromium conseguiu renderizar o HTML/CSS, mas bloqueia navegação HTTP direta com `ERR_BLOCKED_BY_ADMINISTRATOR`. Nenhum E2E de staging com sessão real foi declarado.
- O snapshot local usado nos ensaios é funcionalmente equivalente à branch, mas não foi provada igualdade binária completa ao `server.js` remoto, de modo que o resultado não substitui checkout e suite na versão do GitHub.

## BLOQUEIOS REAIS de release
1. **P1 titularidade:** a coleção `portal_users` na produção ainda tem índice de `keyCode` não exclusivo. Censo *read-only*, saneamento auditado, implantação segura de índice único parcial e *stress* em Mongo replica set separado permanecem pendentes. Não criar índice em produção sem prova.
2. **Troca de e-mail:** se o Mongo rejeitar liberação/reatribuição do mesmo `keyCode` dentro da mesma transação, é necessário corrigir a arquitetura da identidade sem duplicar titularidade; o mock não estabelece a semântica real. O 2FA é cifrado com AAD dependente do e-mail e deve ser reencriptado.
3. **Cakto:** a colisão de prefixos foi corrigida, mas não substitui conciliação de pedidos PIX/cartão reais, claims, eventos, pagamentos, outbox, reenvios, cancelamentos e validade das licenças, em conta de leitura apenas.
4. **Termos:** faltam identificação jurídica real do fornecedor, endereço institucional e confirmação contratual de cancelamentos e reembolsos; revisão jurídica PT-BR/PT-PT/EN.
5. **Homologação:** Node >=24.20.0; MongoDB real staging; Chromium E2E em URL staging; prova da build CWS 0.9.0 instalada e OAuth Drive/People.
6. **Render:** nenhuma alteração/deploy foi executada. A seleção do workspace requer confirmação explícita pela integração; não selecionar automaticamente.
7. **Publicação:** requer autorização explícita de merge/deploy **após** aprovação dos gates.

## Decisão
**NÃO LIBERAR DEPLOY GERAL.** Branch única de staging organizada e preparada; produção R46.38 intacta. Não chamar a validação por mocks de homologação Mongo ou a versão Node 24.11 de cumprimento da engine exigida.
