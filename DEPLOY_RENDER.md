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

Nesta build de recuperação, as variáveis Meta permanecem reservadas, mas o subsistema Meta não foi reconstituído automaticamente. Não considere o Embedded Signup ativo apenas por preencher `META_*`. Quando a etapa Meta for retomada e validada em uma build dedicada, configure:

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

## Hotfix HTTP / Node 24

A configuração HTTP desta release mantém `requestTimeout=30000`, usa `headersTimeout=30000` e `keepAliveTimeout=65000`. Em Node moderno, `headersTimeout` não pode ser maior que `requestTimeout`; a configuração anterior (`66000 > 30000`) abortava o processo com `ERR_OUT_OF_RANGE` antes de `server.listen()`.

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
9. favicon/logo nas páginas e a seção “Sobre mim”;
10. confirme que `/static/assets/zvm-logo-light.png` retorna 404 e que nenhuma página depende dele;
11. Meta Oficial somente depois de uma build dedicada reintroduzir/validar o subsistema e as credenciais/configuração do Meta App estarem prontas.

Não aplique o antigo patch V254 por cima desta versão. Esta recuperação deliberadamente não reintroduz o subsistema Meta; ele deve voltar somente em uma build dedicada, partindo de uma fonte completa e validada.

## E-mail transacional — identidade e respostas

- `EMAIL_FROM`: remetente verificado no Resend.
- `EMAIL_REPLY_TO` (opcional): endereço real de suporte para receber respostas dos clientes.
- A marca ZVM enviada nos e-mails usa imagem inline CID; não depende de `data:` URI no cliente de e-mail.
- Após o deploy, use o laboratório de e-mail do painel administrativo para enviar um teste real ao Gmail e conferir logo, CTA e resposta.
