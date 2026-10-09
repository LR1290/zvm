# ZVM - Automações | Consolidação de estabilidade e plano de recuperação | 2026-10-09

**Não é prova de backup**. Este documento registra somente verificações de leitura e planos para execução em ambiente autorizado. Não contém dados pessoais, IDs de transação, e-mails, licenças, segredos nem dumps.

## Estado real da produção

- GitHub `main` / Render `zvm.onrender.com`: SHA `107e89fff87ef5d549a790bfa7f8c75949e88e6d`, versão R46.40.1. Render `autoDeploy=no`, 1 instância Starter, health `/ready`.
- Reversão conhecida no Render: versão R46.40.1 atual. Deployes anteriores R46.40 e R46.38 são referências históricas; rollback não altera dados já gravados e não substitui backup.
- Atlas: Project 0 / Cluster0 MongoDB 8.0.34 / tier Free / `zapvoice`. Não renomear, migrar ou excluir bancos nesta rodada.
- Censo das 20 coleções em leitura, no instante da consulta:
  `settings` 1; `password_resets` 0; `security_alerts` 1; `meta_signup_flows` 0; `admin_audit_logs` 124; `rate_blocks` 1; `cakto_mail_outbox` 13; `meta_connections` 0; `extension_security_replay` 9; `payments` 24; `queue_counters` 1; `worker_locks` 2; `commercial_tx_claims` 13; `extension_sessions` 15; `meta_webhook_events` 0; `mod_logs` 289; `portal_users` 35; `user_events` 485; `store` 2; `webhook_events` 27. Total 1.042 documentos; contagens mudam naturalmente durante o funcionamento.

## Backup P0: dependências e gates reais

1. Definir destino de backup independente do Render e do mesmo cluster Atlas, com criptografia autenticada, restrição de acesso, retenção documentada e chave não salva no repositório.
2. Preferir ferramenta oficial `mongodump` para backup consistente do banco `zapvoice` inteiro, incluindo todas as 20 coleções, com saída criptografada antes de armazenamento externo. Nunca imprimir connection string ou conteúdo de cliente em logs. Nunca anexar dumps ao GitHub ou arquivos públicos da extensão.
3. Confirmar permissões mínimas de leitura e limites da tier Free, política de snapshots do Atlas e capacidade do destino externo. Este checkpoint **não gerou nem guardou qualquer dump de cliente**.
4. Criar **outro banco/ambiente isolado** para ensaio de `mongorestore`; comparar contagem de documentos por coleção e propriedades de índices (incluindo `unique`, `partialFilterExpression`, TTL) e testar restauração funcional com dados protegidos.
5. Medir RPO/RTO em exercício real; validar que não sobrescreve coleções de produção e que dados sensíveis de restauração não permanecem em ambientes de homologação.
6. Só depois agendar rotinas automáticas, com monitoramento de falhas, criptografia, expiração e testes recorrentes de restauração; evitar novos serviços pagos sem aprovação de custo.

## Cakto e licenciamento

- Leituras anteriores: 23 pagamentos aprovados, 14 `renewed=true`, 9 `renewed=false`; 23/23 chaves encontradas. 13 renovações ligadas a chaves ativas não vencidas; 1 histórico de setembro ligado a chave inativa vencida. Não afirmar falha ou extensão indevida com base apenas nesses contadores; compras iniciais normalmente podem ter `renewed=false`.
- Na leitura subsequente, `payments` passou para 24 e `portal_users` para 35; **não usar censo antigo como verdade em tempo real**.
- `hotfix/r46.49-cakto-exact-marker-current-main` foi preparado com comparação de marcadores exatos; PR em rascunho #6, testes locais Node 22 e suites offline passaram. Falta Node 24.20+, E2E da Cakto por transações sintéticas em staging e provas reais de reconciliação antes de deploy.
- `candidate/r46.47-ownership-terms-synchronized` atualiza na candidata R46.44 o conteúdo público de Termos e CSS da R46.40.1. Ainda **NÃO PUBLICAR**: transação de mudança de e-mail, unicidade parcial de `portal_users.keyCode` e operação real Mongo continuam sem prova. O backend atual deve permanecer R46.40.1 até homologação completa.
- Não disparar webhook replay, alterar datas de validade, criar índices, desativar keys ou mudar titulares sem contrato de rollback e aprovação específica para mutação.

## Testes de publicação e qualidade

- `audit/r46.46-asset-preflight` inclui um gate offline de recursos públicos: mapeamento de arquivos referenciados, allowlist, SHA-256, MIME `text/javascript` e `application/javascript`, path seguro e fingerprint no nome.
- Baseline GitHub exato da R46.40.1: 36/36 refs/manifest/assets, nenhum faltando.
- Testes locais no snapshot exato dos arquivos principais (SHA blob `server.js=843fd962990d551166f01f84ff9920667247e1f6`) em **Node 22.16.0**: `npm run check` PASS com gate adicional; 8/8 cenários sintéticos PASS. O snapshot não incluía o teste R46.38, então não declarar o checkout remoto integral testado.
- Chromium com HTML/CSS renderizado em memória, **sem HTTP de staging**, 3 idiomas × 390px/1440px: 6/6 casos com 16 seções, TOC visível, resumo e sem overflow. Bloqueio de política no Chromium impediu navegação normal HTTP/file; isso não prova E2E remoto.
- Para merge/deploy: checkout integral do commit PR, Node **>=24.20.0**, `npm ci`, `npm run check`, teste real HTTP/CSP/assets/Portal CWS e plano de reversão. Render build atual apenas executa `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`. Não alterar build command de produção antes de homologar.
- Corrigir oportunamente `ZVM_BUILD_ID` hardcoded; ainda há teste Cakto legada que assume o identificador antigo, portanto alterar em branch própria, com contrato e regressões.

## Monitoramento

- Monitoramento condicional horário de `/ready` e `/health` configurado. Somente emitir alerta de falha confirmada; nenhuma automação pode modificar o servidor.
- Atlas 0 alertas abertos na consulta; Render `error` sem registros nos filtros consultados; métricas `http_latency` ausentes — não inferir p95.

## Segurança operacional

- O Atlas esteve autorizado para AI clients `read & write` por ação do usuário. Recomenda-se retornar para `read-only` em `Organization Settings > App Connections > AI Clients`. Isso não muda permissões do servidor ZVM.
- O nome do banco principal permanece `zapvoice` por compatibilidade. Não remover `watidy`, `zvm_local`, `admin` ou `local` nesta rodada.
- **Zero escritas MongoDB** e **zero novos deploys em produção** realizados nesta etapa.

## Condições estritas para encerrar completamente os P0

- Backup criptografado e restauração exercitada em ambiente isolado com contagem e índices equivalentes.
- Validação de índice e transação de titularidade em MongoDB real isolado (sem dados de cliente).
- Reconciliação Cakto via histórico de API em modo somente leitura e testes de renovação realista no staging.
- Suite e navegador em runtime oficialmente suportado, rollback testado.
- Somente então um deploy manual isolado com revisão dos indicadores e, caso necessário, rollback rápido.
