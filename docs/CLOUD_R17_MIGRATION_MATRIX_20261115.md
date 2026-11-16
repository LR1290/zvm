# ZVM Cloud — matriz de migração R17 e limites de segurança

Fonte examinada: `ZVM_AUTOMACOES_R17_FONTE_COMPLETA_QA_NAO_INSTALAR_20261115.zip` (R17, 0.9.286, não instalável); contratos confirmados em `app/shared/core/storage-schema.js`, `crm-domain-model.js`, `backup-flow-import.js` e `dashboard/features/library/items.js`. A extensão R17 é proprietária do navegador/WA Web; não é executável no Node.

## Módulos disponíveis na Cloud
- **Contatos:** CRUD por conta, telefone normalizado, audiência manual selecionada.
- **CRM:** pipelines, colunas e membros importados preservados como definições; sem atualização do WhatsApp Web.
- **Etiquetas:** CRUD e migração dos dados explícitos da extensão.
- **Biblioteca:** texto salvo e metadados importados, marcação `missing_source` se o conteúdo nativo separado não existe; nenhum anexo é marcado como pronto sem bytes.
- **Respostas rápidas:** rascunhos e definições, sem transmissão.
- **Fluxos e Funis:** definições importadas, rascunhos de etapas e nomes; não há execução de nós, gatilhos, grupos nem WA-JS no servidor.
- **Disparos:** definição de campanhas e seleção manual de destinatários exibindo nome e telefone; **nenhum motor de envio**.
- **Agenda:** planejamento em rascunho, sem jobs executáveis.
- **Configurações:** preferências simples por conta, sem segredos.

## Compatibilidade do importador (somente JSON nesta versão)
| Chave R17 | Conteúdo | Categoria Cloud |
|---|---|---|
| EXTUI:CrmStore | state.crmList | crm; deriva contatos únicos com telefone válido |
| EXTUI:labelStore | state.labelList | labels |
| EXTUI:textMessageStore | state.textMessageList + conteúdo por item ID | library |
| EXTUI:extappQuickResponseStore | state.items | quickReplies |
| EXTUI:extappFlowStore | state.flowList | flows |
| EXTUI:extappFunnelStore | state.funnelList | funnels |
| EXTUI:extappScheduleStore | state.scheduleList | agenda |
| EXTUI:disparosJourneys | state.journeys | campaigns |

O export da extensão pode envolver envelopes Zustand, manifesto `EXTAPP_BACKUP` ou dump de chaves: até três níveis JSON são lidos, conforme o contrato `backup-flow-import.js`. A tela **pré-visualiza antes de gravar**, confirma `SHA-256` do recorte e revisão corrente, registra uma geração atômica única por usuário e rejeita conflito; substituição somente das categorias presentes no backup. Não sobrescrever sem confirmação.

**Limitações de importação:** somente arquivos JSON de até 20 MB lidos localmente; o recorte seguro enviado ao servidor é limitado a 2 MB, com workspace final máximo 1,5 MB. ZIP, .extbackup, arquivos de mídia, assets OPFS/IDB e vínculos `extapp-media:` precisam de pipeline próprio com object storage, manifesto autenticado, verificação de hashes e rollback. Conteúdo local ausente não deve ser inventado. Não importar sessões, licenças, tokens, credenciais, histórico operacional de envio ou configurações secretas.

## Proteções
- Reaproveita o **Portal do Cliente** com 2FA já existente e validação de chave DEV por sessão; sem segunda base de senhas.
- Dados Cloud ficam no MongoDB `zvm_cloud_pilot`, credencial `readWrite` exclusiva, documento de workspace indexado por SHA-256 de e-mail.
- Uma leitura e uma escrita com **CAS de revision**; importa conjunto de módulos com um único documento, não várias gravações parcialmente concluídas.
- Contrato de origem para métodos mutáveis; sem importação automática ao abrir a página.
- Sem importação de objetos JS perigosos, campos de segredos ou referências locais em Base64/Blob/OPFS.
- **Sem endpoints de disparo, webhooks ou ativação de jobs.** Nenhum recibo de preparação equivale à entrega no WhatsApp.

## Pendências reais para hospedagem integral
1. Habilitar e homologar Meta WhatsApp Business Platform (provisionamento empresarial, webhooks assinados, consentimento de contato, templates aprovados e preço por mensagem).
2. Criar execução oficial de mensagens em fila durável com idempotência por conta/contato, limites de envio, auditoria e estados de resultados verificados.
3. Migrar mídias pelo cofre com armazenamento de objetos, integridade SHA-256 e capacidade de recuperar conteúdos das antigas exportações ZIP criptografadas sem expor chaves.
4. Validar o mapeamento e simuladores completos de cada versão de Fluxos/Funis, CRM, Biblioteca, grupos e todos os modos de envio; alguns módulos ligados ao WhatsApp Web **não têm equivalente na API oficial**.
5. Teste real com contas empresariais autorizadas, consentimento, LGPD, auditoria de custo e rollback antes de permitir uso comercial.

A versão deve ser identificada como **Cloud DEV — workspace de rascunhos e importação parcial compatível R17**. Não anunciar que executa a extensão integral, WhatsApp Web na nuvem, ou automações com celular desligado.


## R18 — ZIP + cofre privado de anexos

A ZVM Cloud passa a ler **ZIP localmente**: diretório central validado, entradas com caminho seguro, manifesto único `backup.json` ou único JSON, expansão limitada e CRC32 verificado. Nunca sobe o ZIP completo. Aceita compressão ZIP armazenada/DEFLATE se `DecompressionStream('deflate-raw')` estiver disponível. ZIP multipart, ZIP64, criptografado, links simbólicos, caminhos fora do arquivo, checksums incorretos ou manifesto ambíguo são rejeitados. O ZIP pode incluir mídia, mas **mídias do ZIP ainda não são importadas automaticamente**; a prévia informa quantas entradas adicionais existem.

O **Cofre Cloud** guarda pequenos arquivos diretamente no MongoDB isolado, por conta, com verificação de formato por assinatura, SHA-256, CAS e limite: **1 MB/arquivo, 6 MB/conta e 24 itens**. Aceita somente PNG, JPEG, WEBP, PDF, MP3, OGG e MP4 compatíveis com assinatura. Arquivos são servidos como anexo, com autenticação por sessão e chave DEV revalidada. A Biblioteca permite vincular um ID do cofre e impede uso de ID de outra conta. Arquivos maiores exigirão object storage externo para não comprometer o Atlas. Esta funcionalidade **não significa migração de arquivos OPFS/IDB ou envio de anexos no WhatsApp**.

## R18 — infraestrutura de conexão oficial Meta

O endpoint `/dev/cloud/meta/webhook` implementa handshake de verificação, assinatura `X-Hub-Signature-256`, limite de corpo de 256 KB e vínculo do evento ao número empresarial configurado. Só grava no MongoDB isolado metadados operacionais mínimos, sem corpo de conversa ou telefone do cliente; eventos idempotentes com TTL de sete dias. Continua **desligado** até configurar as variáveis `CLOUD_META_WEBHOOK_ENABLED=1`, `CLOUD_META_VERIFY_TOKEN`, `CLOUD_META_APP_SECRET`, `CLOUD_META_OWNER_EMAIL` e `CLOUD_META_PHONE_NUMBER_ID` pelo Render. Não cadastrar credenciais neste GitHub ou no navegador.

A rota protegida `/dev/cloud/api/meta/status` informa apenas prontidão técnica para o usuário autorizado. **Não existe endpoint de envio**, fila ou Webhook que execute Fluxos/Funis. Para concluir disparos reais, é necessária a conta WhatsApp Business do titular, número aprovado, acesso e credenciais oficiais, opt-in com evidência, templates aprovados e mecanismo financeiro/idempotente de execução. A integração não pode funcionar com um número pessoal WhatsApp Web copiado da extensão.

## Testes R18

`node --test cloud-pilot/test/backup-media.test.js cloud-pilot/test/media-endpoints.test.js cloud-pilot/test/meta-webhook.test.js`

Somados a `npm run check`, testes sintéticos sem mensagens reais, revisão visual no Chromium e checagens de regressão do site. Não publicar se QA falhar.
