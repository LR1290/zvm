# Deploy no Render — ZVM Server consolidado

## Antes do deploy

1. Faça backup do repositório atual e das configurações do Render.
2. Substitua os arquivos do repositório pelos arquivos deste pacote.
3. Apague a pasta `ia/` do GitHub; ela não é mais utilizada.
4. Remova do Render todas as variáveis `MOD_*`.
5. Não restaure a rota `/static` apenas para a logo; a marca está incorporada.
6. Rotacione os segredos de produção que já foram compartilhados fora do cofre original.
7. Configure `ZVM_EXTENSION_IDS` com o ID oficial da extensão antes do go-live.

## package-lock.json

Este pacote não fabrica um lockfile sem consultar o registry. Na primeira execução com acesso à internet:

```bash
npm install
npm audit --omit=dev
```

Revise o resultado e faça commit do `package-lock.json`. Depois disso, `Dockerfile` passa automaticamente a usar `npm ci`.

## Meta Oficial

Pode ser implantado sem ativar a Meta. Para habilitar o Embedded Signup, configure posteriormente:

```text
META_APP_ID
META_APP_SECRET
META_CONFIG_ID
META_TOKEN_ENCRYPTION_KEY
META_WEBHOOK_VERIFY_TOKEN
```

Opcionais:

```text
META_GRAPH_VERSION
META_AUTO_REGISTER_PHONE=1
META_WEBHOOK_RETENTION_DAYS=30
```

## Pós-deploy

Valide nesta ordem:

1. `GET /health`;
2. página principal, FAQ, Privacidade e Planos;
3. Portal do Cliente: login, cadastro, reset de senha e 2FA;
4. Admin e Analytics;
5. namespace `/WSM` se ainda utilizado;
6. login da extensão e Extension API V4;
7. webhook Cakto em dry-run antes de uma venda real;
8. envio de e-mail de teste pelo Laboratório;
9. favicon/logo nas páginas;
10. Meta Oficial somente depois das credenciais e configuração do Meta App estarem prontas.

Não aplique o antigo patch V254 por cima desta versão: a integração já está incorporada ao `server.js` consolidado.
