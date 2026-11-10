# SSX 2012 · Curadoria R72 — regiões e pistas DEV

**Natureza da fonte:** uma cópia arquivada, imutável e com hash, do Google Sheets capturada em **2026-08-22**. A planilha pública `1SAk84oy05R0UK3JJ_JWJTskSqxj4GpGJkdRqfSmnx2I` não pôde ser obtida integralmente de novo neste trabalho. A R72 **não** declara números atuais nem valida riders via Ozmonet.

## Proveniência e limites

- Bundle original v36: SHA-256 do HTML extraído `d99aa1caaf9e9833ff85f899119043cbddaca66ce9bc9aa5f256990d331e42f0`.
- Catálogo completo do arquivo: `TRACKS` com 83 objetos. O catálogo primário montado de `availableTracks()` continua tendo **73 pistas**, em **12 regiões**; não somar DEV aos contadores principais.
- `G` contém 5.887 linhas, `SNG` 137, total histórico Google: **6.024**. O arquivo de categorias especiais tem **2.205 registros**, entre desafios, Android, DEV e níveis.
- Apenas as linhas de `G` com categoria literal `DEV Tracks`, IDs originais das pistas e referência de célula `D...` sustentam o grupo DEV. Não há interpolação, importação de terceiros nem preenchimento artificial de posições #1–#16.
- Ozmonet é um arquivo separado; gamertags não foram renomeadas, reatribuídas nem nacionalidades inferidas.

## Inventário por ID e referência da própria planilha

| ID original | Pista DEV | Posição | Rider no snapshot | Score literal | Célula | Modo | Plataforma |
|---|---|---:|---|---|---|---|---|
| 79 | TEST RAIL | 1 | LR1290 | 00:34.79 | D2 | Board | PS3 |
| 78 | TEST ONLINE | 1 | LR1290 | 00:19.01 | D6 | Board | PS3 |
| 80 | TEST_1_1 | 1 | LR1290 | 01:56.33 | D10 | Board | PS3 |
| 77 | StyleMile | 1 | LR1290 | 57.73 | D18 | Board | PS3 |
| 76 | Snowjam NO OOB | 1 | LR1290 | 01:32.98 | D22 | Board | PS3 |
| 75 | Snowjam | 1 | LR1290 | 01:18.93 | D26 | Board | PS3 |
| 75 | Snowjam | 2 | Jake | 01:21.09 | D27 | Board | PS3 |
| 74 | Happiness | 1 | Jake | 01:31.97 | D30 | Board | PS3 |
| 74 | Happiness | 2 | LR1290 | 01:32.74 | D31 | Board | PS3 |
| 81 | Test Surface | 1 | LR1290 | 32.86 | D34 | Board | PS3 |

**Resultado: oito pistas DEV com registros, dez resultados históricos comprovados**, e não oito tabelas Top 16 completas. O texto literal de scores incomuns (por exemplo `57.73`) deve ser preservado, não transformado especulativamente em milissegundos.

## Política de interface

1. Banners para as 12 regiões do jogo principal, apresentando suas pistas/montanhas no próprio grupo expandido.
2. Ao selecionar uma pista oficial, exibir seu Top 16 **dentro desse mesmo grupo**, sob os botões de pista. A pontuação permanece alimentada pelo DOM canônico do v36, respeitando o filtro de fonte atual.
3. O catálogo DEV fica em um banner independente com indicação de **arquivo histórico**; escolher uma pista DEV mostra apenas as posições realmente disponíveis, sem tocar na seleção e no ranking oficial.
4. Fotografias dos banners são **arte decorativa licenciada para referência de fã**, servidas pelos cinco ativos locais v37 com checksum; não implicam que a imagem seja a exata montanha/pista.
5. Cabeçalho sem overlay sticky, resultados visíveis por scroll natural; modo Board/Wingsuit permanece acessível mesmo que todas as regiões estejam fechadas.
6. As variantes das categorias especiais (Level, Android, DEV, Sem boost, Survive) continuam calculadas separadamente e com seu próprio aviso histórico.

## Critério de aceite

- 73 pistas/12 regiões no contador oficial; 8 pistas/10 resultados DEV na área separada.
- Red Light preserva 16 resultados reais e `01:35.99` no primeiro lugar Board/combined; TEST RAIL preserva `00:34.79` e célula D2. Não ocorre contaminação de ranking.
- Testes e capturas Chromium em desktop (1440/1920/2560/3440) e mobile (320/390/768) comprovam hierarquia, banners, ranking inline, scroll sem sobreposição, bandeiras e responsividade.
- Arquivo v36 inalterado e isolado do serviço de automação ZVM.
