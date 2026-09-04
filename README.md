# ZVM Server

Backend oficial da ZVM para licenciamento, portal do cliente, integrações, Analytics, serviços da extensão e compatibilidade necessária do namespace WSM.

> **Projeto proprietário.** Este repositório não é software open source. Consulte `LICENSE`.

## Estado atual

Esta consolidação remove definitivamente duas superfícies antigas que não fazem mais parte do produto:

- sistema de moderadores;
- pasta/rotas da antiga IA estática do WSM (`ia/`, `/WSM/ia`, `/WSM/ia-bridge.js`).

O acesso privilegiado ZVM fica restrito ao administrador. A rastreabilidade de ações sensíveis permanece em auditoria administrativa própria.

A marca ZVM também deixou de depender de arquivos em `/static`: site, páginas de autenticação e favicon usam a arte incorporada no próprio servidor; os e-mails usam a mesma arte incorporada e, no envio, a convertem para anexo inline CID com wordmark textual de fallback.

## Requisitos

- Node.js **24.20.0 LTS** ou patch mais novo da mesma linha 24.x;
- MongoDB / Atlas;
- npm;
- variáveis de ambiente configuradas no Render ou no ambiente local.

## Instalação local

Na primeira instalação, enquanto o repositório ainda não tiver `package-lock.json`:

```bash
cp .env.example .env
npm install
npm start
```

Depois do primeiro `npm install`, revise e versione o `package-lock.json`. A partir daí, use:

```bash
npm ci
npm start
```

Validação rápida:

```bash
npm run check
```

## Docker

```bash
docker compose up --build
```

O container roda como usuário não-root, com filesystem somente leitura, capacidades Linux removidas e healthcheck em `GET /health`.

## Render

O entrypoint canônico é:

```text
server.js
```

O endpoint de saúde é:

```text
GET /health
```

Se usar o Dockerfile deste repositório, a imagem fixa Node 24.20.0 LTS. Nunca faça commit do `.env` real; use o painel **Environment** do Render.

Consulte `DEPLOY_RENDER.md` antes de substituir a produção.

## Dependências diretas

- `mongodb` 6.21.0 — mantida a linha 6 para evitar uma migração major desnecessária no mesmo deploy;
- `dotenv` 17.4.2 — usado apenas para desenvolvimento/execução com arquivo `.env`; no Render as variáveis continuam vindo do ambiente.

As versões são fixas, sem `^`/`~`, para reduzir drift. O `package-lock.json` continua obrigatório para fechar a árvore transitiva de forma reproduzível.

## Variáveis de ambiente

Use `.env.example` como referência. Principais grupos:

- núcleo: `MONGODB_URI`, `MONGODB_DB`, `ADMIN_USER`, `ADMIN_PASS`, `APP_SECRET`, `TOTP_SECRET`;
- Analytics: `ANALYTICS_PASS`, `ANALYTICS_TOTP_SECRET`;
- comercial: `CAKTO_WEBHOOK_SECRET`, `SALE_WEBHOOK_SECRET`, `PARTNER_API_TOKEN` e IDs Cakto;
- e-mail: `RESEND_API_KEY`, `EMAIL_FROM` e, opcionalmente, `EMAIL_REPLY_TO` para respostas de suporte;
- extensão: `EXTENSION_URL`, `EXTENSION_VERSION`, `EXTENSION_CHANGELOG`, `ZVM_EXTENSION_IDS`;
- Meta Oficial (reservado para a etapa Meta): `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `META_TOKEN_ENCRYPTION_KEY`, `META_WEBHOOK_VERIFY_TOKEN`;
- WSM legado: somente as `WSM_*` ainda necessárias ao namespace `/WSM`.

Não existem mais variáveis `MOD_*` no projeto consolidado.

## Meta Oficial

As variáveis `META_*` permanecem reservadas para a integração server-side. O `server.js` canônico recuperado em 2026-09-02 não continha o subsistema Meta descrito pelo relatório histórico anterior; por segurança, esta recuperação não reconstrói rotas/criptografia Meta a partir de fragmentos. Quando essa etapa for retomada, segredos/tokens deverão permanecer exclusivamente no backend e a integração deve continuar *fail-closed*.

## Segurança

- sessões opacas da Extension API V4 com bearer armazenado somente por hash;
- entitlement/capabilities decididos pelo servidor;
- allowlist de callback da extensão via `ZVM_EXTENSION_IDS`;
- CSRF same-origin nas mutações autenticadas por cookie;
- rate limiting, limites de payload/URL e alertas de segurança;
- sanitização de logs/CSV;
- tokens de redefinição de senha ZVM e WSM persistidos somente por SHA-256, com compatibilidade temporária para links legados ainda válidos;
- CORS da Extension API limitado a origens `chrome-extension://` válidas (e à allowlist quando `ZVM_EXTENSION_IDS` estiver configurado);
- `/status` com cache curto do ping ao Mongo para evitar amplificação de carga;
- Cakto com idempotência;
- reserva de configuração Meta mantida para uma etapa server-side isolada;
- admin como única superfície privilegiada ZVM;
- nenhuma rota estática genérica necessária para a marca;
- container não-root e filesystem somente leitura.

Veja `SECURITY.md` e `RECOVERY_HARDENING_REPORT_2026-09-02.md`. `AUDIT_REPORT.md` é mantido apenas como histórico de uma consolidação anterior.

## Arquivos

```text
server.js             servidor principal
mailer.js             e-mails transacionais via Resend
package.json          dependências e scripts
Dockerfile            imagem de produção
docker-compose.yml    execução local/servidor Docker
.env.example          nomes de configuração sem segredos
README.md              documentação do projeto
LICENSE                licença proprietária
SECURITY.md            política de segurança
DEPLOY_RENDER.md       roteiro de implantação
RECOVERY_HARDENING_REPORT_2026-09-02.md  fechamento técnico canônico
AUDIT_REPORT.md        histórico da consolidação anterior
```

## Licença

Copyright © 2026 ZVM. Todos os direitos reservados. Consulte `LICENSE`.

## Build Authority durante desenvolvimento

A validação de fingerprint de build é **fail-closed em produção**. Para o ciclo de desenvolvimento interno, o ambiente do Render pode definir `ZVM_BUILD_ENFORCE=false` para evitar cadastrar cada build intermediária.

Antes de uma release pública / Chrome Web Store, restaure `ZVM_BUILD_ENFORCE=true`, mantenha `ZVM_DEV_BUILD_ALLOW=false` e registre somente o fingerprint da build oficial em `zvm-official-builds.json`.
