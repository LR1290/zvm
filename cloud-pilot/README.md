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

## R18 — backup ZIP + anexos reais no Cofre Cloud

O navegador lê arquivos JSON e ZIP com verificação de CRC32, limites e paths seguros. Somente o manifesto JSON filtrado por categorias é enviado à API. Anexos ZIP não são restaurados silenciosamente; `.extbackup` criptografado deve ser aberto primeiro pela extensão original, sem fornecer senha ao site.

O cofre privado usa MongoDB `cloud_media` separado por conta, com `revision` CAS; aceita 1MB por arquivo, total 6MB por usuário, 24 arquivos e tipos verificados por assinatura (PNG/JPEG/WEBP/PDF/MP3/OGG/MP4). Download exige sessão do Portal + chave DEV ativa. Não habilitar uploads maiores no MongoDB gratuito; antes disso criar armazenamento de objetos com quotas, antifraude, integridade e rollback.

## Meta oficial — preparação sem envios

`GET/POST /dev/cloud/meta/webhook` é a fronteira de entrada de webhooks da WhatsApp Business Platform. Segurança: token verificador, HMAC `X-Hub-Signature-256`, limite de tamanho, identificação do número, deduplicação por hash e registro de metadados sem texto/contatos. TTL de sete dias. Desligado se qualquer configuração não existir. Diagnóstico privado em `GET /dev/cloud/api/meta/status`.

Variáveis de ambiente opcionais no Render (não enviar por chat):
```
CLOUD_META_WEBHOOK_ENABLED=1
CLOUD_META_VERIFY_TOKEN=<token longo escolhido pelo administrador>
CLOUD_META_APP_SECRET=<segredo real da app Meta>
CLOUD_META_OWNER_EMAIL=<e-mail autorizado no portal ZVM>
CLOUD_META_PHONE_NUMBER_ID=<identificador numérico do telefone empresarial>
```

Mesmo com esses valores, **o envio de mensagens permanece desativado**: não há API de disparo, nem execução de Fluxos/Funis, nem consentimento/templating homologados. A implementação de envio será uma etapa separada após registrar conta e número Meta elegíveis, receber autorização para mensagens reais e verificar custos. Nunca usar WPPConnect no Render como substituto da API oficial nem simular status 'entregue'.

QA: `node --test cloud-pilot/test/backup-media.test.js cloud-pilot/test/media-endpoints.test.js cloud-pilot/test/meta-webhook.test.js` e `npm run check`.
