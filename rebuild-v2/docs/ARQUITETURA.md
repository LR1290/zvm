# ZVM Automações — Núcleo V2 | Contrato de arquitetura

Estado: laboratório independente. Nenhuma homologação comercial.

## Princípios obrigatórios
1. Código escrito do zero: proibido copiar JavaScript, CSS, HTML, assets e bibliotecas vendorizadas do produto anterior.
2. A versão anterior serve somente como **especificação comportamental**; toda implementação deve ser nova e testável.
3. Dependências: zero dependências de runtime no núcleo. Eventuais dependências novas só após auditoria.
4. Worker MV3 é descartável: nenhuma sessão ou fila depende de variáveis globais duráveis.
5. A interface não pode inferir êxito se receber erro ou não receber resposta.
6. Campos e comandos sob contratos explícitos, validação de entrada e resposta por requestId.
7. Sem leitura de conteúdo de conversas, coleta de contatos, telemetria, injeção de páginas ou envio de mensagens neste núcleo.
8. Sem integração com o servidor de produção antes de acordar e testar um contrato de autenticação dedicado.
9. Proteções e licenças comerciais nunca são contornadas. Nenhuma licença é ativada silenciosamente.
10. Não trocar ID da extensão produtiva nem publicar uma variante laboratório como release.

## Componentes
- `core/protocol.js`: tipos de mensagens e validação transportável.
- `core/preferences.js`: preferências versionadas, sem segredos.
- `background/worker.js`: adaptador Chrome MV3, sem polling e sem estado durável em memória.
- `content/presence.js`: ping read-only do WhatsApp Web, sem acesso a dados pessoais.
- `panel/`: interface local com estados explícitos de erro.

## Decisões futuras bloqueadas até homologação
- Autenticação real com servidor ZVM e políticas de sessão persistente.
- Identidade de extensão e assinatura oficial da linha DEV.
- Envio/recebimento, CRM, Fluxos, Funis, Disparos e WPPConnect.
- Migração de preferências, backups ou ativos legados.

Todas essas partes necessitam de contratos específicos e testes integrados no Chrome com WhatsApp Web.

## Disponibilidade e limites de comunicação
`core/deadline.js` impõe limite explícito de 4 s ao canal do service worker e 2,5 s à detecção da guia. O vencimento de prazo retorna erro visível e **não** autoriza execução, não cria sessão fictícia e não dispara tentativas automáticas. Isso evita UI eternamente pendente e mantém falhas observáveis.
