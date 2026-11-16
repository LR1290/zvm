# ZVM Cloud R26 — Garantia transacional entre Biblioteca e mídias

Data: 2026-11-16 • Branch `feature/cloud-r22-conta-persistente-studio-shell-20261116` • PR #117 (DRAFT).

## Falha confirmada na R25

A rota anterior de `DELETE /api/media/:id` lia o workspace, verificava vínculos de Biblioteca e somente depois excluía o arquivo do cofre. A rota `PUT /api/workspace/library` verificava a existência do arquivo antes de gravar uma revisão. Como a verificação e a escrita não eram atômicas, dois requests concorrentes podiam produzir **registro pronto apontando para anexo eliminado**, mesmo que cada request isoladamente parecesse correto. Essa é uma falha de integridade, não apenas visual.

## Correção R26 na origem

1. **Fronteira única por conta** em `store.js`: todos os `writeWorkspace` (incluindo importação, edições de Biblioteca e CRM) e `removeMediaIfUnlinked` participam da mesma proteção de integridade. O identificador é derivado de hash da conta; nenhum e-mail/senha/chave/WhatsApp é incluído no registro de controle.
2. **Memory QA:** um encadeamento de promessas por conta serializa as operações. O lock é liberado no `finally` mesmo quando a gravação falha, sem bloquear contas diferentes.
3. **MongoDB:** nova coleção isolada `cloud_media_integrity_fences`, com documento `_id` por conta. Cada operação grava a geração desse mesmo documento dentro de `withTransaction` com `readConcern: snapshot` e `writeConcern: majority`. Colisões de escrita forçam retry transacional ou retornam conflito seguro.
4. **Atualização do workspace:** dentro da transação e após escrever o fence, o servidor confirma a revisão atual e valida TODOS os `mediaId` da Biblioteca contra mídias legadas e `cloud_large_media_files` em estado `ready`, também lidos com a mesma sessão. Só então grava a revisão.
5. **Exclusão:** dentro da mesma transação, verifica vínculos, revisão do cofre, existência do objeto e remove metadados+blocos quando for um arquivo grande. Arquivos pequenos recebem CAS transacional do documento legado. Não há mais intervalo entre verificar vínculos e excluir o arquivo.
6. **HTTP:** a rota `DELETE /api/media/:id` chama `removeMediaIfUnlinked` (sem a sequência insegura anterior) e responde 409 para arquivo vinculado/revisão conflitante, 404 quando ausente e 503 somente se a transação não puder ser executada. Validações da Biblioteca feitas dentro da transação retornam 422, não um erro genérico de servidor.
7. **Recuperação visual:** `cloud-library.js` agora apresenta mídia ausente como pendente mesmo quando um registro antigo continua armazenando `mediaId` e `contentStatus=ready`. Isso permite revisar eventuais inconsistências anteriores sem exibi-las como conteúdo utilizável.

## QA de laboratório

A suíte `cloud-pilot/test/r26-media-integrity.test.js` está incluída no `npm run check` e cobre **12 cenários**:
- Corrida nos dois sentidos (vincular antes da exclusão / excluir antes do vínculo) no cofre legado.
- Corrida no cofre de grandes arquivos com SHA-256, validação de metadados e vínculo.
- Revisão desatualizada, isolamento entre contas e concorrência de oito gravações.
- MongoDB injetado em QA: transações, geração de fence, leitura dentro da sessão, duas instâncias de servidor compartilhando a base, reversão de falha injetada e limpeza consistente de anexos.
- Fluxos legítimos de desvinculação seguida de exclusão, na memória e no Mongo simulado.
- Verificação adicional: **3/3** contratos de interface R24 após atualização para a nova rota de exclusão.

**Execução efetuada:** 12/12 cenários isolados do código versionado passaram usando runtime JavaScript e simulador de MongoDB. Isso não equivale à execução com driver/replica set real.

## GATES OBRIGATÓRIOS antes de publicação

- Executar `npm run check` com Node real e ambiente de testes MongoDB com replica set, transações e write conflicts; não simular que o runner do GitHub Actions passou.
- Testar Chromium/Opera autenticado no desktop e no celular, inclusive logout/relogin, navegação da Biblioteca, upload e exclusão durante importação ZIP.
- Validar quotas e reservas sob uploads paralelos de arquivos pequenos/grandes; o controle R26 preserva vínculos, mas NÃO resolve sozinho a reserva atômica da cota combinada.
- Planejar recuperação de objetos órfãos historicamente criados antes da R26, com relatório de leitura antes de qualquer ação destrutiva.
- Para futuras referências de Fluxos, Funis e Disparos, estender a validação referencial aos campos efetivamente usados pelos motores, mantendo envio desativado enquanto não homologado.
- A transação agora é requisito para gravação no Mongo; se o serviço não oferecer suporte, **falhar fechado**, não retornar a exclusão insegura.
- **Não fazer merge, deploy, atualização de licenças, envio ou migração destrutiva.** A PR #117 permanece DRAFT.

## Resíduos e governança

A antiga verificação prévia de anexos na rota de Biblioteca permanece intencionalmente como **validação antecipada para feedback rápido**; a validação dentro de `writeWorkspace` é a garantia efetiva e obrigatória. Não existem duas rotas de exclusão ativas: a rota HTTP usa apenas `removeMediaIfUnlinked`. O método interno `large.remove` permanece para os testes e a camada de armazenamento, não para excluir sem proteção a partir da API pública.
