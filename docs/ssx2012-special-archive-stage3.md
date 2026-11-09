# SSX 2012 — Etapa 3: categorias especiais do arquivo histórico

## O que está implementado

A navegação adicional **Desafios especiais — arquivo histórico** é anexada somente à página moderna `/hobbies/ssx/ssx2012`. Não existe tela de loading adicional, requisição remota ou alteração no HTML arquivado `/hobbies/ssx/ssx2012-v36`.

Fonte dos registros: literais `G`, `SNG`, `TRACKS` e `META` embutidos no v36 original, previamente verificado por SHA-256. A própria origem informa `snapshot=2026-08-22`. Essa captura **não equivale à planilha atual**.

Navegação independente: categoria, nível (quando aplicável), modalidade e pista. Renderiza todos os resultados da seleção ativa, com posição, nome como aparece na planilha, valor original, plataforma quando informada, referência da célula e link real do YouTube quando disponível. Não cria rankings ou vídeos.

## Contagens verificadas diretamente na origem

| Categoria arquivada | Registros |
| --- | ---: |
| Level 1 | 638 |
| Level 3 | 132 |
| Level 6 | 801 |
| Level 7 | 169 |
| Level 8 | 17 |
| Level 9 | 224 |
| Android | 48 |
| DEV Tracks | 10 |
| No Boost | 29 |
| Survive especial (sem Gear/Wings/Rewinds) | 137 |
| **Total especial** | **2.205** |

A fonte tem `G.length=5.887` e `SNG.length=137` (= **6.024 registros Google na captura**). A categoria `Global Top 16` na matriz `G` tem **3.819** registros e não é duplicada nessa seção.

A matriz `TRACKS` possui 83 entradas, incluindo pistas DEV, enquanto o navegador principal conserva suas 73 pistas. Nenhuma pista DEV é indevidamente adicionada ao Top 3 principal.

**Importante:** as 137 entradas em `SNG` possuem código de modalidade `5` e são tratadas como **um único agrupamento histórico** `Survive sem Gear/Wings/Rewinds`. Não é possível separá-las individualmente em três variantes a partir desses códigos; seria uma classificação inventada.

## Autoridade de dados e integridade

- A aba do arquivo refere-se ao Google Sheets **na captura de agosto de 2026**, e não a uma consulta recente à planilha online.
- Os nomes são mantidos como o Sheets os guardou. A Etapa 2 prepara reconciliação por ID da Ozmonet, mas **nenhuma troca de nome** foi feita nesta fase.
- O valor de score/tempo/distância é renderizado **exatamente como aparece na linha histórica** (incluindo notação científica e formatação com vírgula). Não recalculamos posições.
- Os links de vídeo são exibidos somente se a captura contém HTTPS do YouTube em host permitido.
- A UI adicional não altera o seletor de fonte, modo, pista, busca ou Top 3 da página principal.
- Nenhuma linha de produção atualizada nem publicação sem CI verde.

## Validação

1. `tests/ssx2012-special-source-scan.test.cjs`: reconstitui o arquivo, confere SHA-256, faz parse dos literais JSON sem executar scripts e verifica contagens e exemplos.
2. `tests/ssx2012-alpine-browser.test.cjs`: Chromium verifica a seção montada, cinco grupos e os valores amostrais de Level 9, Android, DEV, No Boost e Survive especial, incluindo prova YouTube real.
3. Teste de isolamento compara o HTML v36 **byte a byte** com a versão moderna após remover exclusivamente os scripts e CSS injetados.
4. Smoke e auditoria do backend ZVM permanecem independentes.

## O que ainda falta (Etapas 4 e 5)

Reobter a planilha Google atual completa e perfis Ozmonet verificáveis, reconciliar IDs e apelidos, conferir diferenças de resultados posteriores à captura de agosto, categorizar variantes extras com regras específicas onde os dados permitirem, recalcular Top 3 por categoria, executar testes de UI/segurança e publicar a versão consolidada. Não apresentar o snapshot histórico como líder de recordes atuais.
