# SSX 2012 — R78: auditoria forense de nomes e pontuações

**Estado:** revisão do snapshot local imutável de 22/08/2026, com auditoria integral por checksum e apresentação de scores sem alteração da fonte. **Não é certificação da planilha online atual nem dos IDs de jogadores.**

## A origem do problema relatado pela comunidade

Um revisor observou grafias de riders divergentes e campos numéricos de Race It!, Trick It! e Survive It! com representações diferentes. A solicitação de padronização é válida, mas **formatação textual e correção factual são operações distintas**. Não se deve unir jogadores por nome semelhante nem substituir tempos da planilha por RiderNet/WinonaNET: o WinonaNET está em modo somente leitura desde 2019, e a API iOS utilizada deixou de operar em 2017.

Fonte de recordes: planilha Sheets identificada no v36, `1SAk84oy05R0UK3JJ_JWJTskSqxj4GpGJkdRqfSmnx2I`. Fonte de identidade histórica por ID: `https://ssx.ozmonet.com/`. A planilha **atual não foi capturada integralmente** nesta execução; a auditoria abaixo se restringe ao pacote fixado pelo checksum.

## Cobertura e resultados reproduzidos

| Indicador do snapshot v36 | Resultado |
|---|---:|
| Data da captura incorporada | 2026-08-22 |
| SHA-256 do HTML original | `d99aa1caaf9e9833ff85f899119043cbddaca66ce9bc9aa5f256990d331e42f0` |
| Linhas históricas examinadas | **6.024** |
| Escopos categoria × modalidade × plataforma presentes | **25** |
| Grafias exatamente distintas nos dados | **555** (não representa 555 pessoas) |
| Grupos de diferenças de caixa/espaços | **47** |
| Grupos adicionais aproximados de pontuação/acento | **22** |
| Valores com formato sintaticamente reconhecível | **5.261** |
| Valores cuja apresentação envolve inferência de separador | **706** |
| Valores de distância sem unidade registrada | **22** |
| Valores que exigem revisão manual por falta de padrão seguro | **35** |

**Atenção:** os grupos de 47 e 22 não são necessariamente disjuntos. Não somá-los como "69 usuários duplicados". Um mesmo nome pode ser um homônimo ou grafia histórica de outra conta. Cada caso requer **ID in-game idêntico, URL de perfil correspondente e revisão humana**.

Exemplos de *candidatos* (não aliases certificados): `Amazingteune/amazingteune`, `Jake/jake`, `Umbroch/umbroch`, `ssx wizard/ssx-wizard/ssx_wizard`, `sideshow_bob_666/sideshow_bob_666_`. Nenhum foi rebatizado.

### Separação de qualidade

**5.261** significa apenas que o texto segue uma gramática reconhecida pelo formatador, **não** que o tempo ou a identidade foi validado na planilha atual.

**706** casos recebem `review-inferred-separators`. A interface oferece padronização visual, mas o atributo `data-ssx-original-score` e o tooltip mantêm o valor exato para conferência. Exemplos:

- Race It! `01.53.66` → `01:53.66` (interpretação marcada).
- Race It! `44.73` → `00:44.73` (interpretação marcada).
- Trick It! `4.460432E7` → `44,604,320` (número inteiro exato, gramática identificável).
- Survive It! `225 229,45m` → `225,229.45 m` (interpretação marcada).
- Survive It! `206.889.98m` → `206,889.98 m` (interpretação marcada).
- Survive especial `10,787,35m` → `10,787.35 m` (interpretação marcada).
- `01:56.XX` não é completado nem substituído por supostos centésimos.

**22** registros apresentam uma distância sem unidade explícita, como `665405.94`: a UI pode inserir agrupamento de milhar, mas **não acrescenta "m"** por conta própria.

## Garantias da implementação

- Exibição em Top 16, líderes por pista, arquivo DEV e categorias especiais.
- Ranks, nome de rider, pontuação **original**, posicionamento, origem da linha, vídeo, bandeira e dataset v36 permanecem intactos.
- Uma nota no Top 16 esclarece que as identidades refletem a fonte selecionada e ainda dependem de verificação por ID.
- O consolidado dos nomes é **somente um inventário de candidatos para revisão**, nunca um mapa de fusão automático.
- O formatador não altera valores usados para comparar/ordenar os resultados ou calcular os Top 3 históricos.
- Não existe rede externa executada no carregamento; auditoria e relatórios são operações Node locais e leitura imutável.

## Reprodução

```bash
node --test tests/ssx2012-score-integrity.test.cjs
node tools/ssx-audit-display-readonly.cjs > ssx-r78-source-audit.json
node --test tests/ssx2012-alpine-browser.test.cjs
```

O CI publica o JSON da auditoria junto às capturas Chromium no artefato do workflow. O relatório contém apenas candidatos e valores da fonte histórica, sem aprovar qualquer correspondência por similaridade.

## Pendência de certificação externa

1. Obter exportação integral **da planilha vigente**, todas as abas, com timestamp, URL e hashes.
2. Confrontar por plataforma, categoria, modalidade, variante, pista, posição e endereço de evidência; preservar formato bruto para distinguir erro de digitação de representação regional.
3. Capturar perfis Ozmonet somente quando houver ID in-game verificável. Uma mesma grafia em duas linhas, ou grafias semelhantes, **não** autoriza fusão.
4. Revisar manualmente todos os casos com `review-*`, confirmar a regra de arredondamento/unidade e proibir transformação que introduza novo valor numérico.
5. Gerar mapa de aliases **aprovado** separado da fonte; só então considerar exibição de nomes consolidados, mantendo versões históricas e trilha de auditoria.
