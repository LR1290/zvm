# Portões objetivos de qualidade

## Portão A — núcleo mínimo (escopo deste pacote)
- [ ] MV3 instalável em Chrome sem erros no service worker: verificar na máquina alvo.
- [x] Manifesto e código sem dependências de runtime do legado.
- [x] Comandos estritamente tipados por protocolo e requestId.
- [x] Preferências com esquema versionado e falhas explícitas.
- [x] Módulo de presença WhatsApp read-only, sem coleta.
- [x] Testes automatizados de contrato e persistência.
- [ ] Persistência observada após fechar/reabrir Chrome: depende de teste real.
- [ ] Service worker reinicia e volta a atender: depende de teste real.
- [ ] Presença detectada no WhatsApp Web real: depende de teste real.

## Portão B — autenticação comercial (não implementado)
- [ ] Contrato servidor/cliente especificado e validado em staging.
- [ ] Autenticação e revogação fail-closed.
- [ ] F5, reinício de Chrome, logout, offline/online e troca de conta.
- [ ] Não consumir nova vinculação de licença sem intenção explícita.

## Portão C — operações (não implementado)
- [ ] Pipeline de comandos transacionais e cancelamento.
- [ ] Controle de duplicidade/idempotência e limites do WhatsApp.
- [ ] Superfícies de CRM, Fluxos, Funis e Disparos independentes com QA end-to-end.

Nenhum portão seguinte autoriza reclassificar o anterior como aprovado sem evidência real.
