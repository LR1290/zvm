# R46.57 — Smoke test público e somente leitura

## Objetivo
Validar depois de cada deploy que `/ready`, páginas públicas e arquivos CSS/JS/imagens referenciados continuam disponíveis. Detecta o incidente R46.40 no qual o CSS da página `/termos` retornou 404 e o HTML perdeu a formatação.

## Execução manual (ambiente externo ao Render)
```bash
npm run smoke:public
# ou em staging:
ZVM_SMOKE_ORIGIN=https://staging.example.org npm run smoke:public
```

- **Não alterar o build command do Render nem criar cron:** executado pelo operador após deploy autorizado.
- Apenas `GET` (com `redirect: manual`, `credentials: omit`), sem sessão, sem API de pagamentos/renovação, sem dados de clientes.
- `/ready` deve responder HTTP 200 + `application/json` + `ok=true`.
- Confere `/`, Termos em PT-BR/PT-PT/EN, Privacidade, FAQ, Planos e arquivo público de verificação Google.
- Examina apenas referências `/assets/` publicadas no HTML; rejeita 404, redirecionamentos inesperados e MIME incompatível.
- Executa as requisições sequencialmente para não pressionar a instância Starter. Cada resposta tem timeout de 8 segundos (configurável somente via função de teste).
- Em erro, registra caminho técnico e classe de falha, nunca cookies, payloads, tokens ou conteúdo de páginas.
- **Limite:** não substitui testes com Chromium, autenticação real, Cakto, Mongo staging nem backup recuperável. Não verifica CSS referenciado por outros CSS; o gate estático `npm run check` cobre a lista oficial de assets.

## Gates de release
1. Rodar `npm ci` e `npm run check` em Node >=24.20.0 e, antes de publicar, testar o candidato em staging.
2. Confirmar backup e rollback para deploys que mudem Mongo, licenciamento ou pagamentos.
3. Fazer deploy manual autorizado no Render.
4. Executar `npm run smoke:public` externamente, verificar logs e o SHA ativo.
5. Não declarar release pronto se houver falhas nos endpoints públicos.
