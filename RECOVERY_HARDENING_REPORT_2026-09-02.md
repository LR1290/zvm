# ZVM Server — Recovery & Hardening Report

**Data:** 2026-09-02  
**Base canônica recebida:** `zvm-main.zip`  
**SHA-256 da base recebida:** `e3a524a7b443159c97ea31989d35b1b407210f44654737485a6d0575628e50bb`  

## Objetivo

Esta release foi construída exclusivamente sobre o ZIP atual do repositório privado enviado em 2026-09-02. O pacote original permanece intocado e funciona como rollback. Nenhum `server.js` antigo foi usado como substituição integral.

O objetivo foi recuperar as correções que haviam regredido, endurecer o servidor sem reintroduzir superfícies antigas e fechar a regressão visual da marca antes de continuar evoluções maiores.

## Recuperação de regressões

- removido novamente o antigo sistema de moderadores e seus caminhos de runtime;
- removidas a antiga IA estática WSM e as rotas `/WSM/ia*`;
- removido o servidor genérico `/static/*`;
- a logo ZVM deixou de depender de `/static/assets/zvm-logo-light.png` e é incorporada ao servidor;
- páginas de autenticação, portal e marca compartilham a mesma fonte de identidade;
- `mailer.js` continua usando a arte incorporada e a envia como anexo inline CID, sem depender do host do site;
- auditoria administrativa própria preservada.

## Hardening aplicado nesta recuperação

- cookies autenticados centralizados com `HttpOnly`, `Secure` e `SameSite=Strict`;
- limite absoluto + janela de sessão para superfícies administrativas;
- senha administrativa derivada em memória com scrypt e comparação em tempo constante;
- CSRF same-origin nas mutações autenticadas por cookie;
- callbacks da extensão restritos ao esquema `chrome-extension://`, com suporte à allowlist `ZVM_EXTENSION_IDS`;
- CORS da Extension API deixa de refletir origens web arbitrárias e aceita somente origens de extensão válidas;
- webhooks server-to-server não recebem CORS permissivo desnecessário;
- IPs vindos de proxy são normalizados e rejeitam valores que não sejam IPs válidos;
- `object-src 'none'`, `frame-ancestors 'none'`, HSTS, nosniff, Referrer-Policy e Permissions-Policy;
- limites HTTP para headers, request timeout, headers timeout, keep-alive, número de headers e requests por socket;
- shutdown gracioso drena HTTP, descarrega gravações debounced e fecha Mongo;
- `uncaughtException`/`unhandledRejection` iniciam shutdown fatal controlado em vez de manter processo possivelmente inconsistente;
- `/status` mantém apenas estado operacional básico e cacheia o ping ao Mongo por 15s para evitar amplificação de carga;
- Extension API V4 e entitlement/capabilities server-authoritative preservados;
- bearer opaco da V4 continua persistido somente por hash;
- Cakto mantém idempotência e processamento persistente;
- CSV/logs mantêm sanitização contra injeção de fórmula e XSS;
- parser Base32/TOTP rejeita entrada malformada.

## Redefinição de senha — melhoria adicional

O portal ZVM já armazenava novos tokens de reset somente como SHA-256. A auditoria encontrou que o namespace WSM ainda persistia o token utilizável diretamente em `password_resets._id`.

A recuperação agora aplica o mesmo modelo aos dois caminhos:

1. o link enviado por e-mail recebe o token aleatório bruto;
2. o Mongo recebe somente `SHA-256(token)`;
3. o consumo pesquisa pelo hash;
4. existe fallback temporário de leitura para tokens legados em claro ainda válidos;
5. nenhum novo token em claro é criado.

Assim, um vazamento apenas de leitura do banco não entrega diretamente um token reutilizável de troca de senha.

## “Sobre mim” — revisão factual e sincera

A apresentação foi reescrita para evitar linguagem de currículo inflado e deixar explícito o caráter independente/autodidata do trabalho. Os cards públicos agora distinguem:

- **ZVM** como projeto atual;
- **SSX 2012 / Quick Track Flow** como a descoberta do menu de desenvolvimento e a primeira forma de acesso no Xbox 360/Xenia, com crédito explícito à continuidade feita por outros modders;
- **SSX 2012 / 60 FPS PS3** como projeto separado de EBOOT;
- **GTA V / REMOVE GEN9 .OIV Menyoo** como uma modificação pequena e específica publicada no GTA5-Mods;
- o perfil público GTA5-Mods como histórico verificável, sem transformar hobby em alegação de especialização geral.

## Meta Oficial — deliberadamente fora desta release

O ZIP canônico recebido não continha o subsistema server-side Meta que existiu em uma consolidação anterior. Embora existam relatórios e snapshots históricos completos em outras versões, esta recuperação **não faz merge parcial de fragmentos Meta**. Isso é intencional para evitar repetir o problema de regressão que motivou esta rodada.

As variáveis `META_*` permanecem apenas reservadas/documentadas. O Embedded Signup não deve ser considerado ativo nesta release. A volta da Meta deve ser uma etapa isolada, partindo de um snapshot completo, com gates próprios de AES-GCM, webhook HMAC, WABA/Phone Number ID, sessão opaca V4 e regressão.

## Dependências / lockfile

As dependências diretas continuam fixadas em `dotenv 17.4.2` e `mongodb 6.21.0`. O ambiente de trabalho não conseguiu consultar o registry em tempo hábil para gerar um `package-lock.json`; nenhum lockfile foi fabricado.

No primeiro ambiente conectado, rode `npm install`, revise `npm audit --omit=dev` e versione o lock. Depois, use `npm ci`.

## Modelo de deploy

- Node alvo: 24.20.0 LTS (linha 24.x);
- Render continua recebendo segredos somente via Environment;
- `.env` real não pertence ao Git;
- Docker roda como usuário não-root, filesystem read-only, `cap_drop: ALL` e `no-new-privileges`;
- `GET /health` é o healthcheck canônico.

## Gates desta release

Os resultados finais são registrados em `RELEASE_GATE_2026-09-02.txt` e `ROUNDTRIP_GATE_2026-09-02.txt`. O checksum interno fica em `CHECKSUMS.sha256`; o ZIP final possui checksum externo separado.

## Limitações honestas

- não foi executado um fluxo real contra o MongoDB de produção;
- não foram enviados webhooks reais de Cakto;
- o Chromium headless do ambiente não ficou estável para screenshot visual final, portanto não é declarado “Chromium visual PASS”;
- a validação de render foi feita por harness de HTML/runtime isolado;
- Meta Oficial permanece propositalmente adiada;
- `npm audit` transitivo fica pendente até existir lockfile/registry acessível.

## Fechamento do checkpoint

- `server.js` final SHA-256: `d5f4a17e57dc3a35ecd3c5f99876d3955622f694c2c1fee29d91972c19034c7d`
- release gate: **40/40 PASS**;
- arquivos de código alterados em relação ao ZIP canônico: somente `server.js`;
- `mailer.js`, `package.json`, Dockerfile e demais arquivos operacionais que não precisavam de mudança funcional foram preservados;
- documentação de segurança/deploy foi atualizada para refletir a recovery atual;
- o ZIP original recebido permanece separado e não é sobrescrito.
