# ZVM Cloud — piloto sob /dev/cloud no mesmo servidor

Endereço escolhido: **https://zvm.onrender.com/dev/cloud/** (o caminho sem barra final redireciona para o mesmo painel). A Cloud utiliza **o mesmo serviço Render Starter**, porta e processo Node da ZVM Desktop/site, no padrão modular de `src/hobbies/ssx/route.js`. Não há outro serviço ou domínio exigido.

## Limites do piloto

- E-mail e senha, sem links por cliente; administrador e uma conta de convidada.
- Frontend responsivo; rascunhos (sem envios) persistidos SOMENTE se a conexão Cloud com MongoDB estiver autorizada.
- WhatsApp Cloud API, fluxos/funis reais, contatos, agendamentos, execuções e webhooks NÃO estão habilitados.
- Sem cadastro público. A administração autoriza, substitui ou revoga a única conta.
- Sem variáveis de ambiente seguras, login permanece **selado**; não reutilizar credenciais do painel principal.

## Instalação em produção

O servidor principal `server.js` importa `serveZVMCloud` de `src/web/cloud/route.js`. O adaptador intercepta somente `/dev/cloud` e `/dev/cloud/*`, retirando o prefixo antes de delegar ao handler. Demais rotas e autenticações continuam atendidas pelos handlers de produção inalterados.

No Render, usar o mesmo serviço `zvm` (`zvm.onrender.com`, plano Starter, branch `main`, `npm start`, health `/ready`). Após merge e validação, realizar deploy manual, pois `autoDeploy=no`.

Não inventar variáveis nem copiar segredos para o Git. Para ativar o piloto, provisionar de forma privada:
- `CLOUD_ADMIN_EMAIL` — e-mail do administrador do piloto;
- `CLOUD_ADMIN_PASSWORD_SCRYPT` — hash salt:hash (scrypt, salt de 16 bytes);
- `CLOUD_MONGODB_URI` — URI de credencial de **baixo privilégio**, permitindo somente `readWrite` no banco `zvm_cloud_pilot`. Pode usar o cluster Atlas existente, mas NÃO use o usuário/admin ou URI da produção.

Sem essas três configurações, a interface aparece em /dev/cloud/, porém todos os logins e persistência permanecem indisponíveis por segurança.

Criar o hash administrador localmente, com a senha fornecida em variável `CLOUD_ADMIN_PASSWORD`:
```sh
node -e "const c=require('node:crypto');const p=process.env.CLOUD_ADMIN_PASSWORD;if(!p||p.length<12)process.exit(1);const s=c.randomBytes(16);console.log(s.toString('hex')+':'+c.scryptSync(p,s,32).toString('hex'))"
```
Não colocar senhas em chat, repositório, capturas ou logs.

## Testes e desenvolvimento

A execução standalone de `cloud-pilot/server.js` é mantida **somente** como harness de testes isolados. O acesso comercial utilizará o servidor principal, sem segundo serviço permanente.

```sh
npm ci --ignore-scripts
npm run check
node --test cloud-pilot/test/pilot.test.js cloud-pilot/test/mount.test.js
```

A integração só deve ser publicada após teste da rota, autenticação, regressão e health `/ready`; nenhuma política comercial ou conta atual pode ser modificada. Revogar convite deve eliminar sessões e rascunhos antigos. Antes de habilitar envios reais: Meta Cloud API oficial, permissão, consentimento, custo, webhooks, idempotência e filas duráveis com executor adequado.
