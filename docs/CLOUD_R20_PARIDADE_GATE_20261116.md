# ZVM Cloud — Gate de paridade integral R20 (QA, NÃO PUBLICAR)
Data: 2026-11-16

## Contrato de produto e origem auditada
- **Fonte canônica da extensão:** `ZVM_AUTOMACOES_R17_FONTE_COMPLETA_QA_NAO_INSTALAR_20261115.zip`, manifest V3 `0.9.286`, 1.051 entradas (inclui histórico Git e testes). SHA-256 do ZIP: `5cd8c106a265ccf15520931113bd52c73f47c29c5626e12084d2d34a8a2cbd9c`.
- Fontes comparadas: `pages/dashboard/index.html`; `app/dashboard/styles/main.css`; `app/sidebar/*`; `app/shared/core/storage-schema.js`; `app/shared/core/backup-flow-import.js`; `app/dashboard/features/library/items.js`; `app/dashboard/features/flows/runtime.js`; `app/dashboard/features/funnels/runtime.js`; `app/dashboard/core/automation-whatsapp-bridge.js`.
- Regra do proprietário: não publicar ZVM Cloud no endereço /dev/cloud nem alterar `main`/Render por entregas parciais. Só integrar após completar a migração e homologar funções, dados, mídias, acesso, UI e segurança.

## O que já existe na Cloud publicada antes desta branch
- Login com a conta do Portal (incluindo 2FA) e verificação de chave DEV vinculada; dados separados por conta no MongoDB; escrita com CAS revision.
- CRUD de contatos, CRM, etiquetas, Biblioteca textual, respostas rápidas, Fluxos, Funis, Disparos e Agenda em definições/rascunhos; importação JSON/ZIP com prévia e lista de limitações.
- Cofre privado de mídias de até 1 MB/unidade e 6 MB/conta, sem importação integral de mídias de backups da extensão.
- Diagnóstico de webhook da Meta; **não** existe transmissão real pelo WhatsApp nem execução agendada em servidor.

## Trabalho efetuado nesta branch, sem deploy
- Interface baseada na *estrutura* da extensão R17: escuro `#0a0b0a`, superfícies `#101211`, bordas `#232623`, realce `#00c85a`; navegação lateral no desktop e horizontal responsiva no celular.
- Agrupamento funcional: Painel; Disparos/Fluxos/Funis; CRM/Etiquetas/Contatos; Biblioteca/Respostas/Agenda; Importação/WhatsApp oficial/Configurações.
- Atalho Ctrl+K, busca de módulos, indicadores de **quantidades reais** via `/api/workspace`, atalhos aos módulos e apresentação compacta das colunas CRM.
- Busca local por nome/telefone/resumo dentro de cada módulo. As alterações são de interface; não inventam dados nem ativam envios.
- Novos arquivos `cloud-pilot/public/cloud-ui.js`, `cloud-ui.css`; rotas estáticas controladas, sem CDN, sem `!important` e mantendo o gate DEV existente.
- Testes contratuais `cloud-pilot/test/r20-shell.test.js` adicionados ao comando `npm run check`.

## Matriz de paridade a concluir

| Componente da extensão R17 | Estado Cloud | Gate para produção |
|---|---|---|
| Login/DEV e segregação de contas | implementação existente | revalidar testes e sessões reais |
| Painel e navegação Shell | interface R20 em QA | comparação visual desktop/celular, interações e acessibilidade |
| Sidebar WhatsApp Web | **não migrada** | separar funções universais das dependentes de DOM/WA Web |
| Contatos/seleção de audiência | CRUD existente | importação completa, duplicados, vínculos, identidade e opt-in |
| CRM/etiquetas e etapas | definições parciais | regras e operações completas, sincronização com canal oficial |
| Biblioteca e Respostas Rápidas | texto e anexos pequenos | migrar todos os tipos, sequências, referências e vínculos íntegros |
| Backup JSON/ZIP e .extbackup | parcial | leitor autenticado, cofres IDB/OPFS, hashes, atomicidade, mídia grande e recuperação |
| Disparos e campanhas | **sem motor de envio** | transporte oficial autorizado, filas, controles, limitação e custos |
| Fluxos e Funis | **sem execução** | interpretar nós, agendamento, transições, grupos e eventos compatíveis |
| Agenda/automação 24/7 | **sem scheduler** | tarefas duráveis por conta, pause/resume, idempotência e observabilidade |
| Meta Business Platform | webhook preparado, envio não habilitado | número autorizado, mensagens-modelo aprovadas, opt-in, tarifação e testes end-to-end |
| Laboratório/IA/Integrações/Quick Shelf e recursos auxiliares | **não migrados integralmente** | inventário por arquivo, contratos e testes de paridade |
| Licenciamento, privacidade e recuperação | gate DEV existente | auditoria de produção, consentimento, retenção, exportação e rollback |

## Critério de liberação (todos necessários)
1. Inventário de 100% dos módulos da fonte com matriz `implementado / suportado com diferença / não suportado`, sem apresentar placeholders como recurso pronto.
2. Migração reversível de backup com preservação de IDs, vínculos e mídias, sem marcação falsa de integridade.
3. Comportamento funcional de CRUD/CRM/Biblioteca/Fluxos/Funis/Disparos verificado em testes com dados reais, sem enviar a terceiros em QA.
4. Implementar envio somente por provedor licenciado e regras de consentimento; o WPPConnect/WA-JS no navegador não pode ser simplesmente hospedado no Node do Render.
5. Rodar `npm run check`, testes de integração por conta e Chromium com larguras móvel/desktop, inclusive login e chave DEV.
6. Avaliar custos do serviço Render, banco de dados, armazenamento de objetos e mensagens pagas antes de operação 24/7.
7. Aprovação explícita da candidata final; só depois planejar merge/deploy; nenhuma migração destrutiva de produção.

**Status desta revisão:** fase de interface/contratos em branch isolada. **NÃO PUBLICAR, NÃO INSTALAR, NÃO ATIVAR DISPAROS.**
