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

## Meta / WhatsApp Business Platform

- App Secret e access tokens somente no backend;
- tokens persistidos cifrados;
- webhook validado por assinatura antes do processamento;
- WABA e Phone Number ID validados server-side;
- desconexão/revogação deve invalidar o vínculo local;
- nunca registrar tokens em logs.

## Docker

O container padrão roda como usuário não-root, sem Linux capabilities, com `no-new-privileges` e filesystem somente leitura. Não execute o serviço como root sem necessidade documentada.
