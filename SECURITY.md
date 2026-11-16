# Política de Segurança — ZVM Server

## Relato responsável

Não publique vulnerabilidades, credenciais, tokens, dumps ou provas de conceito exploráveis em issues públicas. Use um canal privado autorizado pela ZVM.

## Segredos

Nunca devem entrar no Git: `.env` real, credenciais MongoDB, API keys, tokens, segredos de webhook, Meta App Secret, chave de criptografia Meta, TOTP, certificados/chaves privadas ou dumps de produção.

Se uma credencial sair do cofre de produção, trate-a como exposta e faça rotação no provedor correspondente.

## Dependências e supply chain

- versões diretas são fixadas no `package.json`;
- gere/versione `package-lock.json` antes do go-live definitivo;
- com lockfile, prefira `npm ci`;
- execute `npm audit --omit=dev` e revisão de CVEs antes de releases importantes;
- atualizações major devem ser tratadas separadamente de hardening operacional;
- produção deve permanecer em uma linha Node.js LTS suportada e atualizada.

## Superfícies privilegiadas

O administrador é a única superfície privilegiada ZVM. O antigo sistema de moderadores foi removido e não deve ser reintroduzido sem threat model específico.

A antiga aplicação `ia/` e as rotas `/WSM/ia*` também foram removidas.


## Sessões, reset e CORS

- cookies autenticados usam `HttpOnly`, `Secure` e `SameSite=Strict`;
- mutações autenticadas por cookie exigem origem same-origin como defesa adicional contra CSRF;
- tokens de redefinição de senha novos são persistidos somente como SHA-256; o fallback para token cru existe apenas para consumir links legados ainda dentro do prazo e não gera novos registros em claro;
- a Extension API não reflete origens web arbitrárias: CORS aceita somente `chrome-extension://<id>` válido e, quando `ZVM_EXTENSION_IDS` está configurado, somente IDs presentes na allowlist;
- webhooks server-to-server não dependem de CORS do navegador.

## Endpoint público de status

`/status` não revela métricas comerciais e usa cache curto para o ping ao MongoDB, evitando que refreshes públicos sejam convertidos em um ping de banco por requisição. `/health` continua mínimo e independente para o Render.

## Meta / WhatsApp Business Platform

O `server.js` atual já contém o subsistema Meta e recebe `/meta/webhook`. O webhook exige assinatura HMAC-SHA256; a autorização embedded signup requer validações próprias. Assim, as exigências abaixo são controles ativos a preservar, não um recurso meramente futuro:

- App Secret e access tokens somente no backend e nunca impressos nos logs;
- tokens persistidos cifrados e protegidos por autorização e escopo de conta;
- webhook validado por assinatura **antes** de processar o corpo;
- WABA e Phone Number ID validados no servidor;
- desconexão ou revogação deve invalidar o vínculo local;
- testes de regressão para assinatura, replay e autorização por conta antes de alterações.

## Docker

O container padrão roda como usuário não-root, sem Linux capabilities, com `no-new-privileges` e filesystem somente leitura. Não execute o serviço como root sem necessidade documentada.
## Extension authentication rate limiting

Extension key authentication uses isolated rate-limit buckets for legacy auth, V4 key sessions, and V3 key activation. Each surface keeps the independent, route-specific policies defined in RL_CONFIG, not one shared bucket, but activity on one surface cannot pre-block a user's first request on another. Obsolete persisted `ext_key` blocks from the shared-bucket implementation are ignored during boot migration. Rate-limited extension responses include `Retry-After` and `retryAfterSeconds`.

## CSP legada e auditoria de CI (16/11/2026)

- Páginas públicas e login usam CSP sem JavaScript inline.
- O Admin migrou handlers da tabela, comandos da página e botões dinâmicos para JavaScript externo com ação declarativa e `script-src 'self'`; estilos inline ainda precisam de migração visual.
- Analytics e integrações com legado permanecem em migração. Não remover a compatibilidade sem comparar a renderização e os testes funcionais.
- O `npm run check` removeu execuções duplicadas; `npm run check:security` executa regressões de segurança isoladas.
- **GitHub Actions:** em 16/11/2026 os jobs falham antes do primeiro step (0 steps nos retornos da API), inclusive em rotas distintas; o problema de runner/permissões/faturamento requer diagnóstico no GitHub. Não divulgar que o CI passou até existir um run completo verde.
- `npm audit --omit=dev --audit-level=high` permanece obrigatório; o status CVE não é 'limpo' enquanto a auditoria real não tiver terminado.
- O contêiner Docker usa cópias explícitas de arquivos de execução; arquivos `zvm.env`, backup e segredos não fazem parte da imagem.
