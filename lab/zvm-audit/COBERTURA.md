# Cobertura A–N

PASS vale para o recorte da evidência vinculada. Estado de módulo indica o aceite da jornada inteira. BLOCKED identifica a dependência externa do aceite.

| Módulo | Aceite | cold | warm | uso | concorrência | erro | timeout | cancelamento | retomada | cleanup | rollback | permissões | Limite |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A Bootstrap/MV3 | BLOCKED | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | Instalação autorizada, arranque e suspensão efetiva do worker pendentes. |
| B Integridade/distribuição | BLOCKED | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | ZIP e cadeia conferidos em trees.sha256. Assinatura final e aceite QA pendentes. |
| C Sessão V4/KEY | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | [PASS](authority.txt) | NOT_RUN | [PASS](login.json) | NOT_RUN | [PASS](resume.txt) | [PASS](teardown.jsonl) | NOT_RUN | NOT_RUN | Apenas os recortes locais citados. Login 429/503 e revogação real pendentes. |
| D Backend/Atlas | BLOCKED | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | Testes locais anteriores em ../r115/backend-tests.txt. Atlas segregado requer autorização. |
| E Sidebar, menus, tema | NOT_RUN | NOT_RUN | NOT_RUN | [PASS](tray.jsonl) | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | [PASS](tray.jsonl) | NOT_RUN | NOT_RUN | Tray sem animação e tema com relógio virtual. Pintura, Quick Shelf e todos os botões pendentes. |
| F Biblioteca | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | Fixtures por tipo, previews e respostas rápidas pendentes. |
| G CRM | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | Persistência, navegação e edição concorrente pendentes. |
| H Fluxos/Funis | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | Journal compartilhado testado. Jornadas dos motores individuais pendentes. |
| I Disparos | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | journal.jsonl comprova begin concorrente, ambiguidade após reload e troca de proprietário. Wizard, importação e ACK WhatsApp pendentes. |
| J Follow-up | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | Contrato de cancelamento reexecutado em regression.txt. Fila e restart reais pendentes. |
| K Backup/migração | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | Restauração integral de dados históricos e assets pendente. |
| L Personalização/acessibilidade/i18n | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | Teclado, leitor de tela, idiomas e viewports pendentes. |
| M Diagnóstico/privacidade | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | Revisão de fluxos de dados e diagnóstico completo pendente. |
| N Saída e teardown | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | [PASS](teardown.jsonl) | NOT_RUN | NOT_RUN | Remoção DOM com KEY pendente testada. Suspensão física e atualização da extensão pendentes. |
