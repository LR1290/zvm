# SSX 2012 — Etapa 5: pré-certificação e evidências externas

## Estado da integração (2026-11-09)

A Etapa 4 da `main` já renderiza os líderes e o Top 3 **históricos e provisórios** do snapshot de **2026-08-22**; não se trata de ranking atual. O dataset v36 (SHA-256 `d99aa1caaf9e9833ff85f899119043cbddaca66ce9bc9aa5f256990d331e42f0`) permanece intocado.

A auditoria SHA-pinned contabiliza 2.205 linhas especiais, 21 escopos categoria × modo × plataforma, 386 líderes de pista não disputados, uma pista com reivindicações incompatíveis de posição #1 e nenhuma pista sem primeiro lugar nos conjuntos históricos presentes. Esse resultado não equivale a conferir identidade atual por ID.

## Novas garantias, sem mutação de recordes

- Chaves de posição usam tuplas JSON, sem colisão entre valores como `race|one` e `race%7Cone`.
- IDs estáveis de registros repetidos são relatados mesmo entre eventos diferentes; uma fonte ambígua não passa na certificação.
- Cobertura não certifica fontes vazias, pistas presentes sem #1, múltiplos #1, registros inválidos, categorias esperadas ausentes nem expectativas malformadas.
- A certificação de identidade exige todas as linhas com ID conciliado, sem duplicações ou perfis Ozmonet inválidos. Apelidos não são alterados.
- Os testes de inventário agora exigem as contagens exatas do snapshot imutável, evitando que mudança de lógica distorça silenciosamente o pódio.

## Estado das fontes externas e limites da verificação

- A URL oficial do Google Sheets `https://docs.google.com/spreadsheets/d/1SAk84oy05R0UK3JJ_JWJTskSqxj4GpGJkdRqfSmnx2I/htmlview` respondeu para a aba introdutória, mas uma leitura da introdução **não prova** captura íntegra de todas as abas nem a data da última edição.
- Ozmonet `https://ssx.ozmonet.com/` publica estado **READ-ONLY**; seu próprio histórico indica que não atualiza estatísticas desde 2019. Pode servir como evidência histórica de ID, nunca como prova de recordes atuais.
- Nenhuma comparação linha a linha entre a planilha online integral e o arquivo v36 foi certificada nesta fase; não efetuar atualização de scores, identificação ou rankings com base em suposições.


## Gate de cobertura independente — R65

O motor de reconciliação agora **não certifica líderes ou identidades sem manifesto explícito** de cobertura. Uma amostra parcial, mesmo composta exclusivamente por resultados #1 válidos, não pode se autodeclarar completa.

`expected-categories.json` deve ser um array não vazio e fornecido **a partir de inventário independente de todas as abas da fonte**, com exatamente um objeto por categoria × modalidade × plataforma × variante. Cada objeto exige `recordCount` e `tracks` listando `eventId`, `trackId` e `recordCount` de cada pista. Exemplo **sintético, não um recorde real**:

```json
[
  {
    "platform": "xbox360",
    "mode": "board",
    "variant": "standard",
    "recordCount": 1,
    "tracks": [
      { "eventId": "test-event", "trackId": "test-track", "recordCount": 1 }
    ]
  }
]
```

A auditoria rejeita manifesto ausente, categoria duplicada, escopo não listado, pista ausente ou extra, contagem divergente ou pistas repetidas. `coverageManifestMatchesSnapshot` significa apenas **coerência entre dois arquivos fornecidos**, não prova de que a planilha online foi completamente capturada ou de que as informações são atuais. A certificação externa exige aquisição íntegra verificável e revisão independente. Sem isso, o painel continua **histórico/provisório**.

Executar o CLI com apenas dois snapshots continua permitido para **diagnóstico somente leitura**, mas o código de saída de certificação será não-zero enquanto não houver manifesto válido. As mudanças não modificam v36, v37, recordes, ZVM, licenças ou autenticação.

## Checklist de fechamento e publicação

1. Capturar todas as abas atuais, com timestamp UTC, URL/origem, hashes da exportação, IDs verificáveis e evidências; comparar chaves de categoria/pista/modo/plataforma/posição. Não interpretar `htmlview` introdutório como cobertura completa.
2. Capturar perfis Ozmonet **exatamente pelo ID in-game** presente na planilha; não usar similaridade de nomes. Executar `node tools/ssx-reconcile-readonly.cjs snapshots/google-sheets.json snapshots/ozmonet.json snapshots/expected-categories.json`.
3. Revisar diferenças, links YouTube e colisões manualmente. Se uma fonte estiver indisponível ou não for verificável, manter o aviso **histórico/provisório**.
4. Exigir regressões Node e Chromium em desktop/mobile, integridade do v36, isolamento da ZVM e verificação de segurança antes de considerar publicação.
5. Confirmar deploy Render pela referência exata do commit e executar smoke de leitura nas rotas SSX. Merge no GitHub, isoladamente, não comprova deploy.

## Precisão do contador público (Etapa 5)

O número **6.024** é o total de entradas do Google Sheets incorporadas no snapshot de 2026-08-22, não uma consulta de placar em tempo real. A etiqueta originalmente exibida como **“recordes atuais”** foi substituída por **“recordes na captura de 2026-08-22”**, com traduções nos seis idiomas suportados. Nenhuma contagem, resultado, placar, fonte ou arquivo v36 foi alterado. Testes Chromium conferem rótulos em português e inglês após troca de idioma, e teste de contrato exige as seis traduções.
