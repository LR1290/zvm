# SSX 2012 — Etapa 4: líderes e Top 3 do arquivo histórico

**Fonte**: exportação do Google Sheets incorporada ao arquivo v36, `META.snapshot = 2026-08-22`, SHA-256 do arquivo v36 `d99aa1caaf9e9833ff85f899119043cbddaca66ce9bc9aa5f256990d331e42f0`.

**Escopo**: a seção **Desafios especiais → Líderes e Top 3** é histórica, provisória e separada dos rankings principais. Não reivindica ser a planilha online atual. Não altera nomes, tempos, provas, Top 3 atual, usuário, Ozmonet ou base ZVM.

## Critérios de classificação

1. O filtro identifica **categoria exata** (Level 1/3/6/7/8/9, Android, DEV Tracks, No Boost ou Survive Special), **modo**, **plataforma de origem** e pista. Nunca misturar PS3 e Android. `Survive Special` não informa plataforma; mostrar **não informada**, nunca inventar PS3.
2. Líder de pista = linha que contém **posição 1** explícita no snapshot. Não escolher o primeiro dos 16 resultados nem calcular um vencedor por score bruto entre pistas diferentes.
3. Duas reivindicações distintas de `#1` para a mesma pista/modo/categoria/plataforma produzem **conflito auditável**. A pista fica fora do pódio até revisão das fontes; duas linhas idênticas não contam como dois primeiros lugares.
4. Top 3 = até três **grafias exatas de nomes na planilha** que lideram mais pistas distintas naquele escopo. Em caso de empate de vitórias, ordenação alfabética, sem desempate por tempos de pistas diferentes.
5. **Os apelidos não foram conciliados por ID da Ozmonet.** Mesmo nomes aparentemente parecidos (p. ex., com `O` e `0`) continuam separados sem comprovação. Um pódio não verifica a identidade nem prova que o rider é o proprietário do perfil histórico.
6. Vídeo YouTube apenas para uma URL real presente no registro; ausência de vídeo mostrada sem fabricar prova. Mantidos valores e referências da planilha.
7. A categoria **Survive Special** usa o único código histórico `5`, correspondente ao agrupamento combinado sem Gear/Wings/Rewinds, **não** a três rankings separáveis. Sem dados atuais ou regras específicas, não segmentar indevidamente.

## Resultado da auditoria determinística (snapshot)

O teste `tests/ssx2012-special-source-scan.test.cjs` reconcilia as **2.205 linhas** especiais em 21 escopos categoria × modo × plataforma:

- **386 primeiros lugares** em pistas distintas, após rejeitar reivindicações conflitantes.
- **1 pista com reivindicações divergentes de posição #1**, na categoria Survive Special.
- **0 pistas sem registro de #1** entre os conjuntos presentes.
- Top 3 não excede três nomes por escopo; não há nome ou valor simulado.

Essas contagens são **históricas e não uma certificação atual**; qualquer alteração no snapshot ou código precisa refazer o teste e checar os valores.

## Implementação e testes

- `src/hobbies/ssx/special-leaders-core.js`: núcleo puro e read-only; exportado para Node e navegador; sem acesso a contas ou rede.
- `src/hobbies/ssx/special-categories-v1.js`: filtros, vista de recordes da pista, vista de líderes, pódio, causas de exclusão, referências YouTube, aviso de identidade e filtro interativo do rider por grafia exata.
- `tests/ssx2012-special-leaders.test.cjs`: erros de rank, colisão, duplicação, separação de plataforma/categoria/modo, alias não verificado, integridade das fontes.
- `tests/ssx2012-special-source-scan.test.cjs`: inventário com SHA do original, contagem e verificação dos líderes por todas as categorias.
- `tests/ssx2012-alpine-browser.test.cjs`: Chromium desktop/mobile, navegação, separação entre categoria principal e histórica, #1 único, prova/recordes e acessibilidade.

## Pendente para a Etapa 5

A versão online atual da planilha e os perfis da Ozmonet por **ID in-game** ainda não foram obtidos por captura integral verificável. Até lá, **não renomear riders** nem afirmar que um ranking do arquivo histórico é o ranking atual. Quando disponíveis, a Etapa 5 deverá comparar linha a linha, gerar relatórios de divergência, validar todos os vídeos e atualizar apenas registros confirmados, seguindo CI/Chromium e deploy Render.