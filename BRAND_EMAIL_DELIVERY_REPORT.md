# ZVM Server — Brand & Email Delivery

Data: 2026-09-01
Base: Render HTTP hotfix de 2026-09-01

## Alterações

- Logo/favicone do site trocados para o arquivo exato `zvm-logo-icon-light.png` da extensão V260.
- MIME do favicon corrigido de SVG para PNG.
- Marca dos e-mails migrada de `data:image/...` para imagem inline CID no envio real via Resend.
- Prévia administrativa continua usando data URI, evitando regressão no preview em navegador.
- Cabeçalho da marca do e-mail passou a usar tabela de apresentação para maior compatibilidade entre clientes.
- Preheader oculto adicionado aos templates transacionais.
- `EMAIL_REPLY_TO` opcional adicionado para respostas de suporte.
- Tags `source` e `type` adicionadas aos envios para observabilidade no provedor.
- ID retornado pelo Resend passa a ser preservado internamente quando disponível.

## Compatibilidade preservada

Não foram alterados checkout, Cakto, contratos WSM, licenciamento, MongoDB, rotas do Portal ou Meta V4.
O hotfix HTTP do Render (30s request/headers, 65s keep-alive) foi preservado.
