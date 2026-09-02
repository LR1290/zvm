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

A build de recuperação 2026-09-02 mantém esta seção como política para a futura etapa Meta; o `server.js` atual não expõe o subsistema Meta. Quando ele for reintroduzido em build dedicada:

- App Secret e access tokens somente no backend;
- tokens persistidos cifrados;
- webhook validado por assinatura antes do processamento;
- WABA e Phone Number ID validados server-side;
- desconexão/revogação deve invalidar o vínculo local;
- nunca registrar tokens em logs.

## Docker

O container padrão roda como usuário não-root, sem Linux capabilities, com `no-new-privileges` e filesystem somente leitura. Não execute o serviço como root sem necessidade documentada.
