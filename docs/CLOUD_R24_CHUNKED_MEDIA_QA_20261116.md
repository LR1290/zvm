# ZVM Cloud R24 — Cofre binário por blocos (QA, sem deploy)
Data: 2026-11-16 • Branch: `feature/cloud-r22-conta-persistente-studio-shell-20261116` • PR #117 (rascunho).

## Problema técnico
A Cloud R23 armazenava mídias de até **1 MiB/arquivo, 6 MiB/conta e 24 itens** embutidas num documento Mongo `cloud_media`. Esse desenho não comporta restauração de vídeos ou mídias grandes da extensão e não fornece retomada de transferência. A Biblioteca agora aceita referências a arquivos verificáveis, mas a restauração integral de assets ainda não existe.

## Arquitetura criada sem desmontar os dados anteriores
- **Nova área independente** no banco `zvm_cloud_pilot`, sem migrar nem apagar `cloud_media`:
  - `cloud_large_media_uploads`: sessões temporárias, uma ativa por conta, com expiração em 24 horas;
  - `cloud_large_media_chunks`: blocos binários de 256 KiB, com hash próprio e TTL para transferências incompletas;
  - `cloud_large_media_files`: metadados definitivos, sem dados binários embutidos.
- IDs dos proprietários derivados de hash de e-mail canônico; nenhum e-mail, chave DEV ou cookie é escrito nas novas coleções.
- **Capacidade controlada de QA:** 32 MiB por arquivo, 128 MiB por conta (considerando cofre antigo + novo) e 60 itens combinados; uma transferência pendente por conta. O objetivo é não surpreender custos do Mongo/Render nesta fase.
- `GET /api/media` retorna o inventário combinado, preservando os itens antigos e a compatibilidade `m_<sha-prefixo>`.
- Endpoints novos (todos atrás de sessão Portal, chave DEV vigente, controle de origem e segregação por conta):
  - `GET /api/media/uploads`: estado de retomada do upload da conta;
  - `POST /api/media/uploads`: iniciar/reaproveitar por hash/nome/tipo/tamanho;
  - `PUT /api/media/uploads/:uploadId/:index`: bloco binário, SHA-256 por bloco;
  - `POST /api/media/uploads/:uploadId/complete`: validar SHA-256 integral e assinatura do arquivo;
  - `DELETE /api/media/uploads/:uploadId`: cancelamento autenticado;
  - `GET/HEAD/DELETE /api/media/:id`: compatível com arquivos antigos e novos.
- Uploads incompletos jamais aparecem como arquivos prontos. Metadados, remoção do prazo de expiração dos blocos e fim da sessão são confirmados na **mesma transação MongoDB**. Exclusão do arquivo e blocos também é transacional. Em caso de erro, o banco reverte a transação; se a resposta HTTP se perder após o commit, a repetição de `complete` retorna o arquivo já salvo.
- **Sem auto-deploy:** o servidor MongoDB de destino ainda deve ser testado para suporte a sessões/transações. Falha de inicialização dos índices fecha a conexão e não desabilita outras verificações de segurança.

## Interface
- Upload binário pelo navegador em blocos de 256 KiB, com `SubtleCrypto SHA-256`, barra de progresso, cancelamento, identificação de transferência pendente e retomada selecionando novamente o mesmo arquivo.
- A sessão de upload fica no servidor; **nenhum token/chave/ID de sessão é guardado no localStorage**.
- Tipos aceitos: PNG/JPEG/WebP, MP3/OGG, MP4 e PDF com validação de assinatura.
- `cloudMediaProgress`, `cloudMediaCancel`, `cloudMediaResumeInfo` foram conectados à interface da Biblioteca; arquivos antigos continuam listados e utilizáveis.
- Não existe envio ao WhatsApp ou execução automática neste módulo.

## QA executado na rodada, além de novos testes Node versionados
- **15/15** comportamentos simulados de armazenamento em memória: criação, retomada, isolamento, blocos fora de ordem, replay idempotente, validação, deduplicação, exclusão.
- **19/19** cenários HTTP simulados do handler Cloud: gate DEV, origem, quota, chunks incorretos, GET protegido, vínculo da Biblioteca, downloads e ausência de /api/send.
- **13/13** simulações do adaptador Mongo com coleções em memória, incluindo transações de finalizar/excluir/cancelar e comprovação de que chunks completados perdem o TTL.
- **3/3** contratos de interface/CSP executados com fontes reais desta branch.
- Arquivos versionados para execução em Node real: `cloud-pilot/test/r24-chunked-media.test.js`, `r24-mongo-atomic.test.js`, `r24-media-ui.test.js`; todos adicionados ao `npm run check`.
- **Ainda não foram executados:** suíte Node completa no runner, conexão MongoDB real, Chromium/Opera autenticado e teste real de resiliência sob armazenamento cheio. GitHub Actions segue com falha de alocação de runner, não deve ser tratado como suíte aprovada.

## Itens ainda necessários para paridade com a extensão
- Backup ZIP de 1 GiB e maior, streaming de manifest/assets e mapeamento íntegro de todas as referências locais.
- Armazenamento adequado para arquivos acima de 32 MiB (avaliar object storage/S3 compatível com cota por cliente e custos) antes de subir limites; **não aplicar arquivo grande a Mongo sem análise de custos**.
- Biblioteca de sequências, reprodução de áudio, grupos/variáveis e equivalência da Quick Shelf.
- Runtime de Fluxos/Funis, Disparos/filas/agendamento 24/7, transportes oficiais Meta com credenciais e consentimento homologados.
- QA real por navegador/dispositivo, falhas de rede, limites de banco, custo, backups e rollback.

**GATE:** não mesclar a PR #117, não publicar Render, não alterar licenças nem dados de clientes e não apresentar R24 como produto completo.
