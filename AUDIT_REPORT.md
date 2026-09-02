> **RELATÓRIO HISTÓRICO / SUPERADO PARA DEPLOY.** O `server.js` que voltou ao GitHub depois deste relatório regrediu para um snapshot V277. Use `RECOVERY_HARDENING_REPORT_2026-09-02.md` como referência canônica da recuperação atual. O conteúdo abaixo é preservado apenas como histórico do que já havia sido projetado/validado.

# ZVM Server — Relatório Final de Consolidação do Repositório

Data: 2026-09-01

## Escopo

Consolidação do projeto de servidor ZVM a partir dos arquivos atuais do repositório e da linha hardened já validada, com o objetivo de entregar uma pasta canônica pronta para GitHub/Render.

## Mudanças estruturais

- `server.js` é o único entrypoint canônico.
- removido integralmente o antigo sistema de moderadores;
- preservada Auditoria Administrativa exclusiva do Admin;
- removida a antiga IA estática do WSM (`ia/`, `IA_BRIDGE_JS`, `/WSM/ia*` e domínio legado associado);
- removida a rota genérica `/static/*`, que deixou de ter consumidores no projeto atual;
- removidos `fs` e `path` do servidor por terem ficado sem uso após a retirada de `ia/` e `/static`;
- marca ZVM incorporada no próprio `server.js` como PNG/Base64;
- favicon deixou de ser SVG textual temporário e passou a usar o ícone real ZVM em PNG/Base64;
- `mailer.js` reconstruído mantendo a mesma API pública, sem depender de `/static/assets/zvm-logo-light.png`;
- e-mails agora têm ícone incorporado + wordmark textual como fallback visual;
- logs de erro do Resend não imprimem mais corpo bruto de resposta;
- valores interpolados nos templates comerciais passaram por escaping/normalização adicional;
- instruções antigas `node ZVMeWSM.js` foram eliminadas.

## Dependências/runtime

### Node

O projeto anterior apontava Node 26.x (linha Current). A consolidação usa Node 24.20.0 LTS como baseline de produção.

### MongoDB

`mongodb` foi fixado em `6.21.0`. A linha 6 foi mantida deliberadamente porque o servidor possui comportamento já adaptado ao driver v6; migrar para v7 seria uma alteração major separada.

O servidor anterior solicitava `zstd` e `zlib`, porém Zstandard exige a dependência explícita `@mongodb-js/zstd`. Para evitar uma dependência nativa não declarada e reduzir supply chain, a conexão foi normalizada para `zlib`, que não exige pacote adicional.

### dotenv

`dotenv` foi adicionado e fixado em `17.4.2`, alinhado ao `require('dotenv')` opcional já existente no servidor e tornando o `.env` local realmente funcional.

### Lockfile

Não foi fabricado um `package-lock.json` sem acesso ao registry. O ambiente desta auditoria não conseguiu concluir `npm install --package-lock-only`. O procedimento correto é gerar o lockfile uma vez em ambiente conectado, revisar e versionar. O Dockerfile detecta o lockfile: usa `npm ci` quando ele existe e `npm install` apenas enquanto ele ainda não foi gerado.

## Docker

O Dockerfile foi recriado para produção com:

- Node 24.20.0 Alpine;
- `NODE_ENV=production`;
- usuário `node` não-root;
- cópia apenas de `server.js`, `mailer.js` e metadados npm;
- scripts de dependência desativados (`--ignore-scripts`) para estas dependências diretas;
- healthcheck `/health`.

O `docker-compose.yml` foi simplificado e endurecido:

- nenhuma variável `MOD_*`;
- `read_only: true`;
- `/tmp` em tmpfs;
- `no-new-privileges`;
- `cap_drop: ALL`;
- healthcheck local.

## Segurança preservada no servidor

A consolidação mantém os controles da linha hardened:

- Extension API V4 com sessões opacas;
- bearer de extensão persistido somente por hash;
- entitlement/capabilities server-authoritative;
- allowlist de callback via `ZVM_EXTENSION_IDS`;
- CSRF same-origin em mutações autenticadas por cookie;
- rate limits e alertas de segurança;
- proteção de tamanho de payload/URL;
- sanitização de logs e CSV/formula injection;
- Cakto com idempotência;
- Meta Oficial com AES-256-GCM + AAD;
- validação server-side de WABA/Phone Number ID;
- `subscribed_apps`, registro de número e webhook assinado;
- token Meta fora da extensão;
- rotas históricas de moderação continuam apenas como 404 explícito de aposentadoria.

## Gates executados

### Sintaxe

- `node --check server.js`: PASS
- `node --check mailer.js`: PASS
- `package.json` parse: PASS
- `docker-compose.yml` parse YAML: PASS

### Gate estrutural

20/20 PASS:

- `MODS`: ausente;
- `modSessions`: ausente;
- `IA_BRIDGE_JS`: ausente;
- `ia.wascript.com.br`: ausente;
- `/WSM/ia`: ausente do runtime;
- `require('fs')`: ausente;
- `require('path')`: ausente;
- `/static` file server: ausente;
- logo estática antiga no servidor: ausente;
- logo estática antiga no mailer: ausente;
- favicon PNG/Base64 real: presente;
- MIME do favicon: PNG;
- marca incorporada no servidor: presente;
- marca incorporada no mailer: presente;
- Meta Oficial: presente;
- Extension API V4: presente;
- auditoria administrativa: presente;
- `eval()`: 0;
- `new Function`: 0;
- `child_process`: 0.

### Runtime isolado

Com `mongodb` substituído somente por stub de import (nenhuma operação de banco):

- carga do módulo: PASS;
- render de marca/login/FAQ com arte incorporada: PASS;
- exports Meta + Extension V4: PASS;
- Meta AES-256-GCM round-trip: PASS;
- AAD incorreto falha: PASS;
- assinatura HMAC de webhook válida/inválida: PASS;
- callback `chrome-extension://` allowlisted: PASS;
- callback web arbitrário bloqueado: PASS.

### Mailer

- API pública compatível: PASS;
- reset de senha: PASS;
- entrega/renovação de licença: PASS;
- aviso de expiração: PASS;
- 3/3 templates contêm marca incorporada;
- 0/3 templates dependem de `/static/assets/...`.

### Limitações da validação local

- Docker não está disponível no ambiente, portanto não foi executado `docker compose config` nem build real da imagem; o YAML foi parseado com sucesso.
- `npm audit` transitivo não pode ser fechado sem `package-lock.json`/registry acessível.
- As versões diretas escolhidas (`mongodb 6.21.0` e `dotenv 17.4.2`) não apresentam vulnerabilidades diretas conhecidas nas bases públicas consultadas nesta data; isso não substitui SCA da árvore transitiva após o lockfile existir.

## Arquivos adicionados ao repositório

- `README.md`
- `LICENSE` proprietária
- `SECURITY.md`
- `.gitignore`
- `.dockerignore`
- `.env.example`
- `DEPLOY_RENDER.md`
- `AUDIT_REPORT.md`
- `CHECKSUMS.sha256`

## Resultado

A pasta `ia/` não deve ser enviada novamente ao GitHub. O projeto consolidado não depende dela nem de uma pasta `static/` para a marca. O próximo passo operacional é substituir a árvore do repositório por este pacote, gerar/versionar o `package-lock.json` em ambiente conectado, rotacionar segredos de produção previamente expostos e seguir o roteiro de `DEPLOY_RENDER.md`.

## Correção adicional — sessão opaca V4 por chave / Meta

Antes do empacotamento full-stack foi detectada uma incompatibilidade entre emissão e renovação da sessão V4 por licença: `/extension/v4/session/key` gravava `authMethod: 'key'`, enquanto `refreshExtensionSession()` reconhece a sessão por chave como `license_key`. Isso faria uma sessão recém-emitida por chave falhar no refresh e impediria o proprietário Meta de ser resolvido por Bearer.

A emissão foi normalizada para `authMethod: 'license_key'`, mantendo a semântica já usada pelo refresh. Um harness isolado confirmou emissão, refresh, capability `integrations.manage` e persistência apenas do hash SHA-256 do bearer no armazenamento simulado.
