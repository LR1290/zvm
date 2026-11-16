# ZVM Cloud DEV — login do Portal do Cliente + chave DEV

## Endereço e hospedagem
Cloud utiliza o MESMO serviço Render do site oficial, em https://zvm.onrender.com/dev/cloud/.
Qualquer pessoa com conta válida pode fazer login por e-mail/senha na rota oficial POST /cliente/login.
2FA do Portal é respeitado; o retorno é por redirecionamento local validado /dev/cloud/.
Não existe banco de senhas paralelo, administrador Cloud especial ou link individual.

## Autorização DEV, obrigatória após o login
1. Após autenticar no Portal do Cliente, Cloud solicita a CHAVE DE LICENÇA DEV.
2. A chave precisa estar VINCULADA à mesma conta no portal, estar ativa/não expirada, e com Acesso DEV habilitado pelo administrador.
3. O servidor valida o vínculo e o estado atual da licença na autoridade persistida do servidor principal, sem confiar no frontend ou cache legado.
4. Apenas SHA256 da chave e SHA256 da sessão Portal são gravados na base Cloud, para um grant máximo de oito horas.
5. Toda API privada revalida a licença DEV; desabilitar DEV, expirar a chave, trocar sessão ou sair do Portal revoga efetivamente o acesso.
6. Cadastro e vínculo continuam nos fluxos oficiais /cliente/registro e /cliente/vincular.
7. Não é criado um código compartilhado universal nem autorizadas chaves normais.

## Banco e isolamento
Variável CLOUD_MONGODB_URI permanece no serviço principal.
Banco exclusivo zvm_cloud_pilot: cloud_dev_grants e drafts (uma entrada por e-mail da conta autenticada).
O usuário de conexão Cloud não tem permissão de leitura/escrita no banco de licenças zapvoice.
Antigo login paralelo /dev/cloud/api/login e cadastro /dev/cloud/api/admin/guest são aposentados (404).

## Sem execução de mensagens
O laboratório permanece sem API oficial WhatsApp, sem disparos, sem agendamentos reais e sem filas 24/7.

## Comandos de QA
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
npm run check
node --test cloud-pilot/test/pilot.test.js cloud-pilot/test/mount.test.js

Após deploy, confirmar sem autenticação: GET /dev/cloud/api/session retorna loggedIn:false, devAuthorized:false, sending:false.
Não publicar senhas, chaves ou credenciais em GitHub, respostas ou logs.

## R17 — novos espaços de trabalho no servidor (somente DEV)

O painel possui editores reais de **Contatos, CRM, Etiquetas, Biblioteca, Respostas rápidas, Disparos, Fluxos, Funis, Agenda e Configurações**. Dados são persistidos na coleção `cloud_workspaces` em um documento CAS por conta com revisão monotônica. O servidor retorna 409 para divergência de revisão, sem substituição silenciosa.

A importação de backup JSON da R17 tem análise e confirmação em duas etapas, digest SHA-256, limites de tamanho, filtro local de dados e segredos antes do upload, e rollback natural por atomicidade do documento por conta. ZIP/.extbackup, mídias e cofre IDB/OPFS continuam bloqueados. Ao importar Fluxos/Funis/Disparos, seleções nativas de contatos são invalidadas e exigem revisão da audiência na Cloud.

O frontend em `cloud-pilot/public/workspace.js` renderiza os módulos somente após a chave DEV e não usa a extensão nem bibliotecas de WhatsApp Web. Não há endpoints de envio, scheduler ativo, execução de nós ou webhooks.

A matriz de compatibilidade e pendências está em `docs/CLOUD_R17_MIGRATION_MATRIX_20261115.md`. Gate de QA: `node --test cloud-pilot/test/pilot.test.js cloud-pilot/test/mount.test.js cloud-pilot/test/workspace.test.js` + `npm run check`, além de homologação mobile visual.
