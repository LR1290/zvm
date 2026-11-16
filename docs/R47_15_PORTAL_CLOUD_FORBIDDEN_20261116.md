# R47.15 — Incidente Forbidden /cliente/login e ZVM Cloud
**16/11/2026 — hotfix do Portal do Cliente (com proteção CSRF preservada).**

## Evidência
Captura fornecida: Opera/Chromium exibindo documento em branco com `Forbidden` em `/cliente/login`. No servidor anterior, POST `/cliente/login` rejeitava `requireSameOriginPost(req)` com `sendHtml(res, 'Forbidden', 403)`, antes de verificar email/senha. A requisição GET `/cliente/login` faz redirect a `/cliente`, portanto esse sintoma aponta para o POST de formulário, mas captura sozinha não confirma cabeçalhos exatos do navegador.

## Causa corrigida no código
- Navegadores móveis/privativos podem omitir `Origin`/`Referer` e declarar `Sec-Fetch-Site: same-site` para um POST legítimo. O guard anterior rejeitava a requisição, mesmo quando a origem era de fato a própria ZVM.
- `requireSameOriginPost` agora aceita `same-site` **somente com prova explícita de host/scheme idênticos** via Origin/Referer, recusando conflito entre eles.
- Quando os metadados faltam, o Portal aceita somente um formulário das 12 rotas permitidas com token aleatório 256 bits coincidente com cookie HttpOnly, Secure, SameSite=Strict, Path=/cliente. Outros POSTs, APIs, Admin, Analytics, webhooks e extensão não ganham exceção.
- Formulários HTML do Portal são carimbados no `sendAuthHtml`, preservando os cookies já existentes; corpo POST é processado uma vez e reutilizado.
- Cloud `/dev/cloud/` obtém um token no `GET /cliente/form-token` somente quando o usuário confirma o login; o POST é nativo e direcionado ao Portal oficial.
- Rejeições de formulário recebem mensagem recuperável em vez da página branca genérica, sem revelar email, senha, TOTP ou cookie. O redirect local válido permanece preservado.

## Verificações executadas
- 23 verificações isoladas da implementação atual: sintaxe de server, módulo CSRF, frontend Cloud e testes; guard same-origin/same-site; cabeçalhos ausentes; cross-site; conflito origin/referer; token incorreto; cookie incorreto; escopo de rotas; integração frontend.
- Teste Node `tests/r47-15-portal-cloud-csrf.test.js` incluído no `npm run check` (execução integral depende de runner disponível).
- Não modificar regras de licença, banco de usuários, credenciais ou desativar Origin/CSRF.
- Compatibilidade com a versão de interface Cloud R20 (PR #113) permanece separada e não compõe este hotfix.

## Gates de produção
1. Verificar commit deployado no serviço Render `zvm` (autodeploy desligado).
2. Validar `GET /ready`, `GET /cliente`, `GET /cliente/login`, `GET /dev/cloud/` e `GET /cliente/form-token`.
3. Homologar no Opera/Chromium real: login Portal, registro, recuperação de senha, fluxo Cloud com redirecionamento, 2FA se habilitado; testes nunca devem executar contas reais sem autorização.
4. Se houver regressão, reverter para SHA anterior no Render e restaurar a branch de produção de forma controlada.

**Não confundir ausência de runners do GitHub Actions com QA integral aprovado.**
