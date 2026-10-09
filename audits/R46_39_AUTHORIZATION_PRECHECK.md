# ZVM - Automações — R46.39 / Etapa 04: pré-gate de isolamento entre contas

Data: 2026-10-09
Base investigada: LR1290/zvm `7b58b35048ea2d107a61893e2de21a5e313028ec`
Branch: `audit/r46.39-stability`
Escopo: inspeção estática + reprodução isolada com identidades `.invalid`.
**Este registro não é um certificado de pentest em produção nem encerra o E2E da etapa 04.**

## Achado A — P1, isolamento comercial: associação concorrente da mesma chave
**Causa:** as rotas de registro e vínculo realizam `findOne({keyCode})` antes de `insertOne` ou `updateOne`; o índice do Mongo em `portal_users.keyCode` não tem `unique:true`.

Evidências em `server.js`:
- linha 364: `createIndex({ keyCode: 1 }, { background: true }).catch(() => {})`
- linhas 9951–9962: check-then-insert em `/cliente/registro`
- linhas 9987–9998: check-then-update em `/cliente/vincular`
- linha 9870: Portal renderiza licença usando `user.keyCode`
- linhas 2029–2040: sessão de extensão deriva entitlement de `user.keyCode`

**Hipótese de impacto:** duas contas distintas podem compartilhar a mesma licença por uma corrida de associação (BOLA indireta / integridade de titularidade). Não há evidência de exploração real. Checagem sequencial funciona; concorrência é a lacuna.

**Fixture não integrada à aplicação:** 3/3 testes locais, reproduzindo a sequência check-then-write em mock sem banco/credenciais/dados reais: controle sequencial, registros concorrentes e vínculos concorrentes. Esta fixture comprova a interleaving insegura, **não substitui teste de integração com Mongo**.

## Achado B — P1 qualidade/consistência: remoção de dispositivo baseada em cache pode sobrescrever estado novo
- `server.js:10023–10030`: remoção busca titular por e-mail de sessão, mas obtém o registro de licença pelo cache `keys[user.keyCode]`, executa mutação e grava via `_writeKeyToDbStrict`.
- `server.js:492–499`: a escrita 'strict' usa `$set data.<code>` sem comparação de versão/estado anterior; 'strict' apenas propaga falha. Admin já dispõe de CAS em `mutateAdminKeyRecordStrict` nas linhas 547+.
- Sob operações concorrentes (admin, worker Cakto ou sessão do portal), há risco de *lost update* ou remoção de posição já alterada. Isto ainda requer prova de E2E, inclusive falha entre mutação na memória e persistência.

## Achado C — P2: visibilidade de falha do índice de ownership
`server.js:364` suprime falha de `createIndex` com `.catch(() => {})`. Este índice, além de não ser único, pode estar ausente sem diagnóstico. A etapa de saúde do Mongo precisa registrar status estruturado, sem PII.

## Controles existentes que NÃO devem ser removidos
- Autenticação com cookie de Portal e exigência Same Origin nos POSTs;
- Leitura atualizada do Mongo para o dashboard da licença (`readPortalKeySnapshot`);
- CAS de alterações administrativas e claims/lock/idempotência Cakto;
- Build 3, aliases legados e `ZVM_CWS_COMPAT` temporário; a identidade publicada na CWS ainda não foi provada.

## Requisitos para concluir formalmente a etapa 04 (staging isolado)
1. Criar duas contas fictícias e licença artificial em Mongo de staging, sem qualquer acesso aos clientes reais.
2. Reproduzir simultaneamente registro e vínculo, verificando o banco e as respostas HTTP. Validar que a aplicação falha fechado para o segundo vínculo.
3. Fazer censo **somente-leitura** dos `keyCode` repetidos antes de qualquer migração de índice; nunca publicar e nunca alterar registros de titulares sem plano de remediação.
4. Introduzir contrato único de associação de propriedade atômica, protegido por índice **único parcial** somente para valores válidos/não nulos após limpeza de conflitos; checar erros 11000 de forma segura. Planejar compatibilidade com troca de e-mail, desvinculação, Cakto e Admin.
5. Revalidar sessão/entitlement ao retirar vínculo, revogar licença ou alterar conta: A não pode ver/alterar dados de B, mesmo com cookies/tokens antigos.
6. Remoção de dispositivo por identificador estável (não índice de lista) e atualização atômica/CAS partindo de estado persistido; testar corrida com renovação Cakto e ação Admin.
7. Garantir 2FA, recuperação de senha, revoke e CSRF, sem regressão nos dois contratos de autenticação (Portal + extensão).
8. Executar todos os testes existentes, teste de concorrência de integração, Chromium autenticado, revisão de logs sem PII e rollback ensaiado **antes** de abrir PR de deploy.

## Estado operacional
Nenhum endpoint real foi atacado, nenhum cliente foi consultado, nenhuma licença foi alterada. `main`/Render/CWS intactos. Etapa 05 (Cakto real com Mongo) **não iniciada**. Este relatório é apenas um checkpoint técnico; correção de código ainda não implementada.
