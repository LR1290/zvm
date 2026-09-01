# ZVM Server — Render HTTP Hotfix

Data: 2026-09-01
Base: ZVM Server GitHub Ready / No IA / Meta V4 Hardened
Escopo: servidor apenas. A extensão não foi alterada.

## Falha corrigida

O bootstrap HTTP configurava `requestTimeout=30000` e `headersTimeout=66000`. Node rejeita essa combinação porque `headersTimeout` deve ser menor ou igual a `requestTimeout`, lançando `ERR_OUT_OF_RANGE` antes de o servidor começar a escutar a porta do Render.

## Correção

- `requestTimeout`: 30000 ms
- `headersTimeout`: 30000 ms
- `keepAliveTimeout`: 65000 ms
- `maxHeaderSize`: 16 KiB
- removidas as atribuições duplicadas de timeout feitas depois de `http.createServer()`
- valores centralizados em constantes locais no bootstrap para impedir divergência entre opções e propriedades do servidor

Nenhuma rota, webhook, licença, banco, autenticação, WSM, Meta, Cakto, e-mail, portal ou contrato da extensão foi alterado.

## Validações executadas

- `node --check` em todos os arquivos JS: PASS
- `package.json` parse: PASS
- smoke test do construtor `http.createServer()` com os valores finais: PASS
- invariável `headersTimeout <= requestTimeout`: PASS
- busca por configuração antiga `headersTimeout=66000`: ausente
- round-trip do ZIP e verificação SHA-256: PASS

## Observação sobre package-lock

A base recebida não contém `package-lock.json`. O Dockerfile continua compatível e usa `npm install` quando o lockfile não existe. Para máxima reprodutibilidade, gere e versione um lockfile em um ambiente com acesso ao registry usando `npm install`, conforme já documentado em `DEPLOY_RENDER.md`. Isso não é a causa do erro de bootstrap corrigido nesta release.
