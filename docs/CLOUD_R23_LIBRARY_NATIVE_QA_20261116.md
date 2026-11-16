# ZVM Cloud — R23 Biblioteca nativa (QA, não publicar)
**Data:** 2026-11-16. **Origem verificada:** `ZVM_AUTOMACOES_R17_FONTE_COMPLETA_QA_NAO_INSTALAR_20261115.zip` (instalação da extensão `0.9.286`); arquivo `app/dashboard/features/library/items.js`, `app/shared/core/signature-store.js`, `app/shared/core/storage-schema.js`.

## Diagnóstico e correção forense
A implementação anterior de `planLegacy()` considerava apenas a lista `EXTUI:textMessageStore` e fazia `modules.library = ...` dentro do laço. Se fossem lidos vários armazenamentos da Biblioteca, o último substituiria silenciosamente o conteúdo da categoria anterior. A interface de `workspace.js` também expunha o editor textual genérico e prometia categorias que não eram representadas pela importação.

R23 passa a importar as **nove** fontes nativas identificadas no código R17:

| Armazenamento R17 | Campo da lista | Categoria Cloud |
|---|---|---|
| `EXTUI:textMessageStore` | `textMessageList` | mensagem |
| `EXTUI:audioStore` | `audioList` | áudio |
| `EXTUI:mediaStore` | `mediaList` | imagem/vídeo quando identificável, ou mídia |
| `EXTUI:stickerStore` | `stickerList` | figurinha |
| `EXTUI:documentStore` | `documentList` | documento |
| `EXTUI:pixStore` | `pixList` | PIX |
| `EXTUI:interactiveListStore` | `interactiveListList` | lista interativa |
| `EXTUI:contactCardStore` | `contactList` | cartão de contato |
| `EXTUI:signaturesStore` | `list` ou lista plana | assinatura |

- `planLegacy()` agrega todas as categorias antes de validar o conjunto. IDs são preservados; se **duas fontes diferentes** compartilharem o mesmo ID, usa-se um ID derivado determinístico e conserva-se `sourceId` para não sobrescrever.
- O payload textual auxiliar `data[id]` é usado apenas quando adequado; se o mesmo ID também existir em áudio/mídia, o texto da mensagem não é copiado para o outro item.
- Preserva favoritos, visibilidade do menu rápido e o payload revisável de listas/contatos quando seguro. Dados privados ou blobs embutidos não são convertidos em envios disponíveis.
- Categorias que exigem mídia ficam em `missing_source` até que o usuário **envie explicitamente** um arquivo original ao cofre. Listas/contatos/PIX com dados estruturados permanecem em `needs_review` até a validação completa do formato.
- `checkLibraryRecords` aplica no backend as regras de categoria, tipo de mídia (MIME), vínculo à mídia realmente existente, campos booleanos e impossibilidade de marcar registros incompletos como `ready`.
- O importador continua com modo prévia/digest, limites de complexidade, controle de revisão (CAS), isolamento por conta e bloqueio de conteúdos binários não reconhecidos.
- Não foram aumentadas as cotas do piloto (1 MB por arquivo, 6 MB por conta), porque isso requer arquitetura de armazenamento de objetos e teste de custos. **A Biblioteca ainda não equivale a uma restauração integral de mídias grandes da extensão.**

## Interface específica
`cloud-library.js` e `cloud-library.css` substituem o formulário genérico do módulo. O usuário vê:
- Navegação por categorias, pesquisa e filtro de favoritos.
- Cards em **duas colunas** no desktop (uma no celular), visualização de texto e anexos verificados.
- Novo item, edição, duplicação, favorito e exclusão por conta (cada ação recarrega revisão antes de salvar; respostas 409 não sobrescrevem dados).
- Prévia **abaixo do campo** de mensagem/legenda e associação a arquivo existente do cofre, sem enviar para WhatsApp.
- Estado de conteúdo ausente e de estrutura ainda não suportada mostrados claramente.
- O cofre atual permanece privado, com upload/download/exclusão validados; exclusão de um item não apaga o arquivo original.

## QA executado nesta rodada
- 23/23 verificações isoladas de código real: sintaxe, importador R17 multcategoria, assinatura em lista simples, colisão de ID, mídias pendentes, tipos, integridade e montagem.
- 12/12 cenários de requisição HTTP simulada: gate DEV, nova sessão, isolamento por conta, gravação/409, ausência de arquivo, prévia/importação/commit e revogação.
- 8/8 comportamentos DOM simulados: carregar endpoints privados, 12 filtros, 2 cartões, ações, editor, prévia abaixo do campo e limpeza ao bloquear sessão.
- Testes Node adicionais incluídos em `cloud-pilot/test/r23-native-library.test.js` e comando padrão `npm run check`.
- **Limitação de homologação:** estes resultados são execuções isoladas no runtime de desenvolvimento; a suíte completa `npm run check`, teste de renderização Chromium e contas reais ainda precisam passar em ambiente de QA. Não tratar como aprovação de RELEASE.

## Restrição permanente deste checkpoint
- Branch: `feature/cloud-r22-conta-persistente-studio-shell-20261116`, PR #117 (rascunho).
- **Sem merge, sem Render deploy, sem nova conta/serviço, sem alteração de licenças ou MongoDB de produção.**
- A Cloud completa depende ainda de upload de mídia grande, backups com todos os assets, editores e motores de Fluxos/Funis, Disparos com transporte oficial e autorização/consentimento, automação 24/7 e UX restante. Só publicar quando houver paridade/homologação.
