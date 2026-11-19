# PROMPT MESTRE R67 — ZVM AUTOMAÇÕES LITE
## Reconstrução funcional orientada à ZapVoice, com UI/UX independente da ZVM Automações completa

**Modo de operação:** engenharia sênior, auditoria forense, arquitetura de extensão Chromium MV3, segurança de produto, QA adversarial, design system, acessibilidade, migração de dados e controle de entrega. **Status de entrada: R51 REPROVADA; status do trabalho: somente candidata de laboratório até todos os gates aprovados.**

### 0. MANDATO, IDENTIDADE E FONTE DE VERDADE
Você é responsável pela implementação profissional da **ZVM Automações LITE**, uma extensão Chromium MV3 independente. O proprietário exigiu simultaneamente:

1. **Paridade de categorias e recursos com a ZapVoice** no Dashboard, Sidebar, Itens Rápidos, Ajuda e operação funcional. É comparação de **comportamentos**, não autorização para copiar código, branding, identidade gráfica, protocolos de terceiros ou usar WhatsApp de clientes sem consentimento.
2. **Shell, Sidebar, layout, design, UI e UX próprios da ZVM LITE**, visivelmente distintos da ZVM Automações completa. A extensão completa pode fornecer infraestrutura própria licenciada e auditada, mas **não** seus painéis e estilos como desenho final da LITE.
3. **Aprovação apenas por evidência end-to-end**, segurança e equivalência funcional. Se qualquer gate falhar, **declare a versão REPROVADA**, sem publicar, fazer merge ou mascarar como release.
4. **Não recomeçar de R41/R45**. Tomar a distribuição assinada `ZVM-LITE-DEV-R51-FOCO-SIDEBAR-SEGURANCA-INSTALAR.zip` como baseline congelada; report R66 como diagnóstico. A branch de backend é `feature/zvm-lite-key-v2-isolado-20261118` em `mythos52/zvm`, PR DRAFT #124, **não** uma branch de release da extensão.
5. Benchmark binário funcional: `ZapVoice - Chrome Web Store 3.18.19.0.crx` (45 entradas na Biblioteca). Benchmark técnico de motores próprios, **não visual**: `ZVM_AUTOMACOES_DEV_0.9.287_R65_AI_TOOL_FAILCLOSED_ASSINADA_LAB.zip`. O CRX de ZapVoice 3.18.27 **não foi inspecionado**; nunca afirmar paridade com ele.
6. Artefatos devem derivar de bytes reais. Calcular SHA-256 de entradas, manter traceabilidade de diffs e preservar originais. **NÃO instalar/rodar scripts do CRX ZapVoice** para copiar componentes; usar auditoria estática de interfaces para definir comportamento.
7. **Marca:** ZVM Automações LITE, mascote gato original opcional com toggle, nunca cachorro. A identidade visual deve ter seu próprio sistema de espaçamento, tipografia, ícones, cores, estados, densidade, movimento, grid e acessibilidade. O produto não deve voltar a ser a ZVM completa com módulos ocultos.
8. Sempre distinguir e justificar **infraestrutura compartilhada legítima** (WA-JS/WPP, segurança, persistência, codecs, motor de envios, parsers de backup, validações) de **interface herdada indevida**. Não remover fisicamente dependências até provar ausência de consumidores.

### 1. FONTE FORENSE OBRIGATÓRIA
Inspecione e cite, com linha e hash quando aplicável:
- `ZVM_LITE_R66_AUDITORIA_PARIDADE_ZAPVOICE_E_IDENTIDADE_VISUAL.md` e `ZVM_LITE_R51_CHECKPOINT_R65_AUDITORIA_QA.md`.
- Pacotes exatos de R51 assinada; `manifest.json`; scripts de content/service worker; `pages/dashboard/index.html`; `app/dashboard/shell/core.js`; `app/dashboard/lite/home-model.js`, `home.js`, `lite.css`; `app/dashboard/styles/main.css`, `pro-approved-art.css`; `app/sidebar/{style,theme,layout,constants,registry,view,bootstrap,storage,workspace-profile}.js`; `app/shared/core/{section-identity-catalog,lite-edition,lite-authority-policy,storage-authority-policy}.js`; CommandHost e bus; Quick Shelf, adaptador de campo de mensagens, lazy-loader e rotas de painéis.
- Referência ZapVoice original 3.18.19: mapeamento de `send-queue`, `flows-queue`, `scheduled-items`, `zapsaver`, `bulk-messages`, `items`, `settings`, `whatsapp-improvements`, `help`, `news` condicional, conta; Dashboard `/home`, `/messages`, `/audios`, `/medias`, `/documents`, `/flows`, `/funnels`, `/triggers`, `/labels` condicional; temas dark/light/WhatsApp; barra rápida, favoritos e confirmação; CSV/vCard; backup.
- Quais telas são apenas menus do WhatsApp, quais são páginas de Dashboard, quais são filas de execução e quais são biblioteca de definições. **Fluxos ≠ Funis** e **Envios ≠ Disparos**.

### 2. GATES BLOQUEADORES E CLASSIFICAÇÃO
**G0 — Cadeia de custódia:** baseline e hashes reproduzíveis, diretórios limpos, nenhum arquivo de cliente/segredo ou build de edição completa substituído. Sem G0, parar.
**G1 — Paridade de presença/identidade:** matriz auditável ZapVoice→LITE para Sidebar, Dashboard, Biblioteca, barra e Ajustes, sem destinos inativos. Cada entrada precisa de route ID, comando, capabilities, renderer, motor, storage, testes. Apenas flags comprovadas podem ocultar recursos. Sem G1, não assinar.
**G2 — Equivalência de comportamento:** criar, editar, pesquisar, favoritar, executar/confirmar, cancelar, reagendar, importar/exportar, persistir/reabrir. Cada operação deve ser validada em estado vazio, cheio, erro, offline e reabertura. Não assumir equivalência por existência de arquivo.
**G3 — UI/UX independente:** construir Shell e Sidebar com design system ZVM LITE próprio. Não reaproveitar `pro-approved-art.css`, `main.css` PRO como autoridade estética; migrar para CSS LITE orientado por componentes. Não se satisfazer com overlay de cores ou nomes: testar dimensões, hierarquia, navegação, colapso, agrupamentos, cabeçalho, rodapé, motion e captura visual.
**G4 — Segurança:** autorização produto+ação+sessão+capability, validação em TODOS os entrypoints: menus, CommandHost, mensagens runtime, armazenamento e lazy-load. Negar CRM/IA/Follow-up/autoatendimento/Integrações completos sem execução de seus motores; não promover chaves da LITE para produto completo.
**G5 — MV3/WhatsApp autêntico:** perfil Chromium autorizado com extensão realmente instalada, service worker ativo, WhatsApp Web autenticado, DOM real, login V4, sessão refresh/logout, Sidebar e barra operando. Se `ERR_BLOCKED_BY_CLIENT`, não contornar e marcar BLOQUEADO — sem falsificar aprovação.
**G6 — QA visual e acessibilidade:** desktop estreito/largo, zoom 80–200%, teclado e foco visível, leitores de tela, scroll, overflow, redução de movimento, tema Claro/Escuro/WhatsApp, contraste, letras não empilhadas, sem elementos cobrindo cabeçalho/compositor.
**G7 — Licença e estabilidade:** staging isolado Render `zvm-lite-homolog-20261118` e Mongo `zvm_lite_staging_20261118`, build ID/fingerprint correspondentes à distribuição real, assinatura RSA Chrome estável e descritor Ed25519 válido. Sem alterações em `zvm.onrender.com` ou banco `zapvoice`.
**G8 — Entrega:** código DEV assinado somente se G0–G4 ao menos passaram; declarar G5–G7 explicitamente. Não chamar `aprovada` ou `instalável homologada` sem G5. Sem gerar centenas de ZIPs residuais, sem trocar ID Chrome, sem `.bat`, sem arquivos privados no ZIP/GitHub.

### 3. MATRIZ CANÔNICA DE RECURSOS (ZAPVOICE 3.18.19)
Implementar uma fonte de verdade tipada/validável, com `id`, `label`, `group`, `surface`, `route`, `command`, `renderer`, `capability`, `storage`, `allowedProduct`, `enabledByFlag`, `qaState`, `icon`, `sortOrder`.
- **Sidebar WhatsApp:** Envios/fila e cancelamento; Fluxos/instâncias; Agenda/lista e cancelamento; ZapSaver (CSV/vCard, prefixos, limite, arquivados); Disparos (campanha/status/cancelamento); Itens/Biblioteca e favoritos; Ajustes; Aprimorar; Ajuda; Avisos somente se flag comprovada; acesso à conta/Painel. Controlar recolhido/expandido, scroll e bandeja.
- **Dashboard:** Início, Mensagens, Áudios, Mídias (imagens+vídeos), Documentos, Fluxos, Funis, Gatilhos, Etiquetas apenas se efetivamente habilitada, backups. O Dashboard também expõe entrada para configurações e ajuda. Configuração não deve virar navegação redundante sem necessidade.
- **Barra abaixo de “Digite uma mensagem”:** acesso a itens existentes + favoritos, busca/categorias, prévias e ações sem envio automático; opções ocultar, somente favoritos, confirmar envio. Detectar o compositor real em layouts flex/grid e mudanças de DOM sem duplicação.
- **Funis:** sequência ordenada, pausa, envio, cancelamento e visualização de execução. **Fluxos:** ramificações e espera de resposta, instâncias por chat e transições. **Gatilhos:** associação a biblioteca/funil/fluxo, habilitar/desabilitar, estado consistente; NÃO encaminhar “Gatilhos” para a seção proibida `quick-responses`.
- **Temas:** claro, escuro, acompanhar WhatsApp; estado persistente, sem trocar a aparência do WhatsApp, apenas a superfície da LITE.
- **Backup:** importar/exportar dados ZVM LITE com assets, validar erros e compatibilidade de backups legados sem importar módulos proibidos da ZVM completa.
- **ZapSaver:** não reduzir à opção genérica “Salvar contatos”. O nome, origem e contrato funcional precisam ser coerentes em todas as superfícies; respeitar consentimento, privacidade e políticas.
- **Respostas Rápidas da ZVM completa:** não é item de navegação independente comprovado na ZapVoice benchmark; não adicionar como módulo autônomo da LITE.

### 4. CORREÇÕES PROVADAS NA AUDITORIA R66 (PRIORIDADE P0/P1)
- P0: `app/dashboard/lite/home-model.js` registra Gatilhos com destino `quick-responses`, vetado por `Edition`. Remover esse destino. Só expor cartão clicável quando houver renderer legítimo, com contagem sem inventar; caso contrário, status “Pendente” visível e G1 reprovado.
- P1: cartão “Imagens” diverge de “Mídias”; agregar imagens+vídeos com semântica de armazenamento real e rota permitida (`itens-media` ou equivalente que permita escolher ambos); não contar arquivos indefinidos como zero.
- P1: Home/Modo Fácil guarda resíduos `["Respostas rápidas", "quick-responses"]`; substituir por entradas realmente autorizadas pela matriz.
- P0: `pages/dashboard/index.html` usa `pro-approved-art.css` e estilos/markup PRO; criar estrutura de shell LITE própria. Não apagar IDs que handlers ainda usam sem adaptar handlers e testes.
- P0: `app/sidebar/{style,theme,layout}.js` idênticos à ZVM completa. Criar tema e gramática visual da LITE com componentes independentes; verificar comportamento de leitura/colapso; preservar CSS e os dados das versões anteriores apenas como migração se necessários.
- P1: divergências entre `allowedRoot`, Shell, Sidebar, CommandHost, Quick Shelf, atalhos e `storage-authority-policy`: cada seção/ação permitida em TODOS os caminhos legítimos ou bloqueada em TODOS os caminhos excluídos.
- P1: rótulos “Atividades”×“Envios” e “Salvar contatos”×“ZapSaver” devem refletir uma única definição; sem duplicar caminhos.

### 5. ARQUITETURA A IMPLEMENTAR
- **Módulo `LiteFeatureContract`:** dados imutáveis, normalização de IDs, schemas validados, assertividade de renderer/comando, definição única do que é público, condicional, dashboard-only e sidebar-only; todos os projetores consomem isso. Mutações e permissões continuam verificadas pelo servidor quando exigidas.
- **`LiteShell`:** construir layout LITE com topbar compacta, conteúdo principal espaçoso, navegação hierárquica orientada ao fluxo de trabalho, cartão de conta claro e linguagem limpa. IDs de ponte para handlers existentes podem continuar, **não** as classes de visual PRO como autoridade de aparência.
- **`LiteWhatsAppRail`:** estilo e componentes da Sidebar independentes, sem ocupar desnecessariamente o WhatsApp. Ícones com labels acessíveis, estados “ativa”, “em execução”, “sem licença”, “erro”, “loading”; bandejas com contraste e scroll. Não criar overlay ao recolher.
- **`LiteQuickShelf`:** módulo de biblioteca/atalhos leve, obedecendo apenas capability, favoritos e intenção explícita; sem reutilizar assistente IA/edição de texto. Não tocar na mensagem que a pessoa digita sem ação explícita.
- **`LiteThemeTokens`:** cores próprias com tema WhatsApp como opção, não paleta PRO emprestada. Definir tokens para superfícies, destaque, tipografia, elevação, bordas, espaçamento, efeitos focus/hover/reduced-motion.
- **Handlers de acessibilidade:** preservar a hierarquia semântica, aria-label, foco ao abrir/fechar, Enter/Esc, retorno do foco após modal.
- **Resíduos legados:** inventariar cada arquivo não importado; se ainda for dependência real, documentar exatamente qual caminho o usa; se provadamente morto, remover com teste, não por “limpeza cega”.

### 6. TESTES FORENSES QUE DEVEM FALHAR QUANDO HOUVER REGRESSÃO
1. Tabela de paridade por ID; garantir destinos roteáveis e renderer registrado; proibir `quick-responses`, `crm`, `ai-connect`, `followup`, `auto-service`, `integracoes` na superfície LITE.
2. Contrato `Gatilhos` não pode depender de `quick-responses`. Se for “não disponível”, não tornar card clicável, nem mostrar contagem inventada.
3. `Mídias` deve incluir imagens e vídeos com casos de MIME/type/extension, formatos desconhecidos e itens malformados sem travar a Home.
4. Snapshot de navegação: Sidebar, Shell, Dashboard, Modo Fácil, popup, CommandHost e mutação. A mesma seção não pode ter nomes conflitantes.
5. Command bus com conta paga maliciosa, comando injetado, modal escondido, mensagens runtime e lazy-load: todos os casos proibidos devem falhar antes do handler; permitidos devem executar sem regressões.
6. Omitir intencionalmente uma dependência crítica em laboratório deve gerar erro de integridade, não falhar silenciosamente.
7. Migração da R46/R49/R51: salvar/recuperar ordem, favoritos, tema, colapso, assistentes desativados, gatinho, pastas e dados; nunca apagar dados em massa.
8. Sidebar expandir→recolher→ocultar→abrir, reload, escala 80–200%, grid/flex no WhatsApp, ausência de overlay e scroll.
9. Barra de itens com dados vazios e populados, favoritos, prévia, confirmação, cancelamento, opt-out, troca de conversa, DOM removido/recriado sem duplicar handlers.
10. Fluxos, Funis, Agenda, Envios e Disparos: operações locais/sintéticas primeiro; depois E2E autorizado sem destinatários não consentidos.
11. CSP e MV3: todos os scripts/arquivos existem, nenhum `eval`/inline script, service worker não usa APIs indisponíveis, CORS/origin correto, nenhuma chamada a produção quando em staging.
12. Paridade visual independente: hash/comparação de estilos críticos, inspeção de árvore sem `pro-approved-art.css`, screenshots do Dashboard + Sidebar da LITE e da ZVM completa, diferenças mensuráveis de componentes/layout. Não usar somente pixel diff como substituto da avaliação funcional.
13. Performance: mount/unmount sem eventos duplicados, memory leak em 100 ciclos, listeners/observers liberados, sem travar WhatsApp. Logs claros, sem silenciar erros.
14. Segurança de segredos: verificar ausência de PEM, credenciais, password e tokens de sessão em ZIPs, Git e logs; fingerprint e SHA da build exatamente iguais aos parâmetros permitidos no backend.
15. Documentar testes não realizados, bloqueios de sandbox, data da evidência, severidade e reprodutibilidade. **Não fabricar PASS.**

### 7. PLANO DE EXECUÇÃO (NÃO PULAR ETAPAS)
**Fase A — Baseline e contrato:** congelar R51, reler R66, extrair matriz de ZapVoice 3.18.19 e estabelecer `LiteFeatureContract`, corrigir `Gatilhos`/`Mídias` e rotas; testes unitários e contract-tests.
**Fase B — Reengenharia visual:** implementar estrutura real LITE (HTML, CSS, componentes), Sidebar LITE independente, temas e tokens. Remover autoridade visual PRO só após passar testes da Shell e navegação.
**Fase C — Módulos:** integrar e homologar um a um Biblioteca, Itens Rápidos, Envios, Fluxos, Funis, Agenda, Gatilhos, Disparos, ZapSaver, Temas, Backup, Ajustes, Aprimorar, Ajuda/Avisos; se um não funciona, gate vermelho, não ocultar arbitrariamente.
**Fase D — Segurança & QA:** regressões negativas, casos de erro, persistência, acessibilidade, stress, WA-JS mais atual compatível e integração MV3 real.
**Fase E — Distribuição:** assinar **uma** DEV coerente com ID Chrome persistente e descritor Ed25519, só depois de testar local; atualizar Render staging somente quando compilada e fingerprint confirmado; não fazer merge/deploy na produção comercial.

### 8. FORMATO DE RELATÓRIO DE CADA RODADA
Fornecer, em PT-BR: (a) checkpoint anterior + SHA-256 da fonte; (b) objetivos e restrições; (c) evidências linha/arquivo para cada falha; (d) alterações mínimas com racional; (e) testes automatizados com **contagens reais** e logs; (f) comparação ZapVoice por recurso; (g) comparação da identidade visual LITE versus ZVM completa; (h) resíduos preservados com motivo; (i) bloqueios, riscos e rollback; (j) estado de aprovação com gates G0–G8 e última versão reconhecida no servidor; (k) artefatos somente quando coerentes. Nunca reportar “pronto” por simples compilações.

### 9. CRITÉRIOS DE PARADA
- Falha na política de sandbox: **não** contornar; documentar bloqueio.
- Sem credenciais ou cofre disponível: **não** gerar identidade nova do Chrome para “resolver”; continuar com fonte em LAB sem assinatura e sem atualizar staging.
- Falta de evidência da ZapVoice mais recente: congelar benchmark 3.18.19 e declarar limitação; não inventar recursos.
- Erro que exija dados reais de cliente: usar apenas dados sintéticos ou cliente expressamente autorizado; sem mensagens automáticas em massa durante QA.
- Falha em G1 ou G3: **não gerar release nem chamar LITE de equivalente**.
- Nunca misturar o backend comercial, `/main`, Cakto, Meta Oficial ou clientes existentes com a homologação LITE sem autorização específica.

### 10. INSTRUÇÃO DE TRABALHO IMEDIATA
Execute Fase A em cima da **R51 assinada como baseline**, começando pelos erros comprovados Gatilhos→`quick-responses` e Mídias→Imagens; construa a primeira fatia do catálogo único, prove destinos e políticas e implemente um layout visual LITE autônomo incremental na Fase B. **Não espere aprovação para investigar, codificar e testar**; apenas não afirme homologação que não ocorreu. Registre checkpoints no branch isolado, mas não publique qualquer versão final sem comprovação dos dois requisitos do proprietário.

**Pergunta de aceite final:** “Se eu abrir a Sidebar e o Dashboard da LITE, encontrarei os mesmos conjuntos de funcionalidades documentados da ZapVoice 3.18.19, sem uma UI/UX copiada da ZVM completa, com todos os comandos e destinos funcionando e os testes reais concluídos?” Se a resposta honesta não for **sim para todos**, o status é **REPROVADA**.