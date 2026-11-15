# ZVM Cloud — piloto privado de e-mail e senha (R2)

## Estado e escopo
Projeto separado do servidor principal `zvm.onrender.com`. O acesso é por **URL comum + e-mail e senha**, não por links únicos. Existem dois papéis: administrador e **uma** conta de cliente para o piloto. Não existe cadastro público, disparo de mensagens, agendamento real, importação de contatos, integração WhatsApp ou alteração de licenças da extensão.

A aplicação oferece painel responsivo, login, gestão de conta autorizada e rascunho de mensagem de teste **salvo no MongoDB**, quando configurado. O banco é fixado no código como `zvm_cloud_pilot`, separado do `zapvoice` de produção. A conta de conexão deve ter exclusivamente `readWrite` em `zvm_cloud_pilot`. Não reutilizar a credencial de produção do MongoDB nem a senha de cliente.

## Segurança do provisionamento
Sem `CLOUD_MONGODB_URI`, `CLOUD_ADMIN_EMAIL` e `CLOUD_ADMIN_PASSWORD_SCRYPT` válidos, o login fica **selado**; não há fallback para conta aberta. Defina credenciais pelo painel seguro de variáveis de ambiente do Render.

O administrador acessa o mesmo formulário da convidada e verá a aba Administração. Ali, cria/atualiza somente uma conta, usando e-mail e senha de pelo menos 12 caracteres. A senha é armazenada como scrypt com salt aleatório; a interface não a expõe após o cadastro. Trocar de e-mail revoga sessões anteriores e elimina o rascunho antigo. Revogar remove a conta, suas sessões e seu rascunho.

Para gerar **somente** o hash da senha do administrador localmente (não no GitHub):
```
node -e "const c=require('node:crypto');const p=process.env.CLOUD_ADMIN_PASSWORD;if(!p||p.length<12)process.exit(1);const s=c.randomBytes(16);console.log(s.toString('hex')+':'+c.scryptSync(p,s,32).toString('hex'))"
```
A senha em texto puro deve ser fornecida pela variável de ambiente local `CLOUD_ADMIN_PASSWORD`. Guarde o hash como `CLOUD_ADMIN_PASSWORD_SCRYPT` no Render. Não envie a senha na conversa.

## Deploy
Repositório: `LR1290/zvm`
Branch: `pilot/zvm-cloud-single-user-20261115`
Serviço de testes: `zvm-cloud-piloto-privado`
Build:
```
npm ci --omit=dev --ignore-scripts --no-audit --no-fund && node --check cloud-pilot/server.js && node --check cloud-pilot/store.js && node --check cloud-pilot/public/app.js && node --test cloud-pilot/test/pilot.test.js
```
Start:
```
node cloud-pilot/server.js
```
Variáveis: `CLOUD_MONGODB_URI`, `CLOUD_ADMIN_EMAIL`, `CLOUD_ADMIN_PASSWORD_SCRYPT`.
Não configure variáveis com senhas ou URIs no repositório.

## Limitações
Render Free pode suspender o serviço; sessões autenticadas são persistidas no banco e têm duração de oito horas. O MongoDB Atlas gratuito tem limites de armazenamento e conexões. Rascunhos não constituem campanhas reais e os botões de envio não existem. Ainda não há integração Meta nem fila de mensagens 24/7.

O repositório, site principal, licenciamento e dados da ZVM Desktop permanecem inalterados.

## Testes
`node --test cloud-pilot/test/pilot.test.js` valida: conta única, login e origem, isolamento admin/convidada, rascunhos persistidos no store, revogação, selo quando infraestrutura indisponível e inexistência de endpoint de disparo.
