# SSX 2012 — Auditoria de proveniência e plano de reconciliação

## Escopo e versão de referência
- Branch de laboratório: `ssx/r55-source-provenance-audit` (somente leitura; nenhuma publicação de rankings).
- Base do repositório no início da etapa: `1ef712610361763900f63e1f3f51e3c0c4df0fb1`.
- Snapshot original v36: **8.140.766 bytes**; SHA-256 `d99aa1caaf9e9833ff85f899119043cbddaca66ce9bc9aa5f256990d331e42f0`.
- Gerado pelo teste determinístico `tests/ssx2012-source-inventory.test.cjs`, executado na CI. Não executa scripts da página nem consulta serviços externos.
- **Não afirmar que os líderes atuais estão corretos** até concluir reconciliação externa e validar cobertura por categoria.

## Fontes e autoridade
1. **Google Sheets**: fonte da verdade para provas, regras, categoria, tempos, pontuações, colocação e atualização dos recordes. Planilha identificada no v36: `https://docs.google.com/spreadsheets/d/1SAk84oy05R0UK3JJ_JWJTskSqxj4GpGJkdRqfSmnx2I/htmlview`. O link é referência, não é evidência de leitura atual em 09/11/2026.
2. **Ozmonet/WinonaNET**: fonte prioritária de identidade histórica por **ID de jogador dentro do jogo**, não de recordes recentes: `https://ssx.ozmonet.com/`. O arquivo v36 contém URLs explícitas `/user/<id>`, como `/user/186243498`. Qualquer nome só pode ser substituído quando a relação **ID → nome** tiver confirmação verificável na página/captura de origem.
3. **Evidências de vídeo**: links reais do registro, não autoridade primária de score nem de identidade.
4. Registros sem ID, IDs em conflito ou apelidos homônimos: marcar **pendente de reconciliação**, manter o nome de origem e jamais aplicar correspondência por similaridade textual isolada.
5. Não usar pontuações da Ozmonet para substituir a planilha: o próprio site informa que o arquivo histórico deixou de ser atualizado em 2017/2019 e que o antigo Race It! não separava Board de Wingsuit.

## Achados reproduzidos na Etapa 1
- O código atual da interface usa cinco categorias no explorador de recordes: `board`, `wings`, `trick`, `survive`, `special`. A interface moderna usa catálogo com 73 pistas; o arquivo original também contém provas e desafios extras fora do catálogo.
- O arquivo v36 menciona **Level 9**, **Android**, **No Boost**, **DEV Tracks** e registros de **Developer / Test Tracks**. Exemplos literais encontrados: Happiness, Snowjam, Snowjam NO OOB, StyleMile, TEST ONLINE, TEST RAIL, TEST_1_1, Test Surface, Test Slope.
- A existência de menções no HTML original não comprova que todos os scores dessas categorias estejam completos ou corretos. Necessário comparar linha a linha com a versão atual da planilha.
- Foram identificados **13 links Ozmonet** (domínio principal e 12 perfis únicos, conforme a amostra de URLs extraída do HTML) e **2 links explícitos da planilha Google** no material incorporado, além de links de prova YouTube. Essas contagens referem-se a ocorrências/URLs rastreadas no arquivo, **não** à quantidade de riders ou recordes válidos.

## Etapas independentes e critérios de aprovação

### Etapa 1 — Perícia das fontes (esta PR)
- [x] Verificar hash do arquivo de origem e inventariar os links e identificadores de proveniência.
- [x] Identificar referências às categorias extras.
- [x] Executar testes read-only e segurança na CI.
- [ ] Capturar versão atual autorizada da planilha e perfis Ozmonet para conferência externa. Isso é a entrada obrigatória para a Etapa 2.

### Etapa 2 — Reconciliação Sheets × Ozmonet
- Importar snapshots originais *separadamente*, com data, origem, checksum e esquema.
- Construir chave de recorde: plataforma + modalidade + variante de regra + identificador estável da pista + posição/prova. Não comparar tempos entre pistas.
- Cruzar nomes **somente com ID exato Ozmonet**, gerar tabela de aliases verificáveis e quatro estados: confirmado, divergente, sem ID, sem fonte.
- Produzir relatório de diferenças e cobertura; não reescrever silenciosamente o histórico.

### Etapa 3 — Cobertura de categorias
- Introduzir os eventos de **níveis baixos/Level 9**, **Android**, **DEV/Test Tracks** e variantes `No Boost/No Gear` onde o Sheets confirmar provas e regras.
- Isolar plataformas, variantes e eventos experimentais da classificação de pistas do jogo principal, com etiquetas claras.
- Adicionar testes de quantidade de eventos/variantes por aba do Sheets, navegação mobile/desktop e ausência de dados inventados.

### Etapa 4 — Recalcular líderes e Top 3
- Recalcular primeiro lugar por evento, variante, plataforma, fonte e data do registro.
- Top 3 de riders por **número de eventos distintos efetivamente liderados**, separado por categoria; mostrar menos de três se não houver três perfis verificados.
- Registrar empate, evidências reais, revisão de IDs e score como campos auditáveis.

### Etapa 5 — Publicação consolidada
- Validar todas as modalidades, eventos especiais e URLs de prova em Chromium mobile/desktop.
- Revisar curadoria de nomes e comparar totais com os snapshots fonte, produzir relatório de divergências.
- Integrar versão estável e publicar no Render **somente** após CI verde, preservando o arquivo v36 e funções da ZVM.

## Segurança e integridade
Mudanças somente em branch isolada e testes read-only nesta etapa. Não modificar dados de conta, admin, licenciamento, produção ou anexos do usuário. Nenhum fetch automático para serviços externos na inicialização do site sem contratos explícitos de cache, falha e atualização.