# SSX 2012 — Etapa 2: reconciliação Google Sheets × Ozmonet

**Estado:** motor de auditoria offline implementado e testado; nenhuma alteração em recordes, nomes ou UI publicada.

## Regra de autoridade

- **Google Sheets** determina exclusivamente recorde, tempo/pontuação, posição, modalidade, variante, evento, plataforma e provas.
- **Ozmonet/WinonaNET** é a fonte histórica de identidade por **ID numérico in-game**, atestado por perfil de URL /user/ID. Seu arquivo é somente leitura e desatualizado para placares recentes. Um nome histórico não é necessariamente nome atual.
- Nome da planilha divergente do nome Ozmonet com **ID exato** é um candidato para revisão, nunca renomeação automática.
- Ausência de ID, URL de perfil sem correspondência, IDs com múltiplos nomes ou registros sem regra de evento: **bloqueio**, não fazer aproximação por texto.

## Fontes identificadas no arquivo original

Planilha: https://docs.google.com/spreadsheets/d/1SAk84oy05R0UK3JJ_JWJTskSqxj4GpGJkdRqfSmnx2I/htmlview

Arquivo histórico de perfis: https://ssx.ozmonet.com/

Nesta etapa a ferramenta de navegação não conseguiu obter uma **cópia integral atual** da planilha ou dos perfis Ozmonet. Os arquivos v36 guardados no repositório **não** serão apresentados como se fossem capturas atuais dessas duas fontes. O código recebe snapshots verificados separadamente quando eles estiverem disponíveis.

## JSON de entrada (contrato da próxima captura)

Google Sheets (o exemplo abaixo é apenas de esquema e **não é recorde verificado**):

```json
{
  "kind": "google_sheets",
  "capturedAt": "2026-11-09T18:00:00.000Z",
  "sourceUrl": "https://docs.google.com/spreadsheets/d/1SAk84oy05R0UK3JJ_JWJTskSqxj4GpGJkdRqfSmnx2I/edit",
  "records": [{
    "recordId": "id-estavel-da-linha",
    "eventId": "evento",
    "trackId": "pista",
    "platform": "xbox360",
    "mode": "board",
    "variant": "standard",
    "position": 1,
    "value": "MM:SS.ss",
    "riderName": "NOME_DA_PLANILHA",
    "playerId": null,
    "proofUrl": "https://youtu.be/VIDEO_REAL"
  }]
}
```

Ozmonet (novamente, valores demonstrativos sem afirmar associação real):

```json
{
  "kind": "ozmonet",
  "capturedAt": "2026-11-09T18:00:00.000Z",
  "sourceUrl": "https://ssx.ozmonet.com/",
  "players": [{
    "playerId": "12345",
    "gamertag": "NOME_CONFIRMADO_NO_PERFIL",
    "profileUrl": "https://ssx.ozmonet.com/user/12345"
  }]
}
```

## Comandos locais sem rede e sem alterações

```bash
node --test tests/ssx2012-reconciliation.test.cjs
node tools/ssx-reconcile-readonly.cjs   ./snapshots/google-sheets.json   ./snapshots/ozmonet.json > audit.json
```

O CLI só lê os arquivos de entrada e imprime um JSON integrado com auditoria de identidades **e** cobertura por plataforma, modalidade e variante. O redirecionamento para arquivo é opcional, feito pelo operador. Nenhuma requisição de rede, escrita ou atualização de nomes no site.

### Manifesto opcional das categorias esperadas

Para acusar ausências de Android, níveis baixos, pistas de teste e variantes especiais, forneça um terceiro arquivo JSON: uma lista **explícita e conferida pelo curador** com os pares plataforma/modo/variante esperados (a ferramenta não inventa as abas que faltam no snapshot).

```json
[
  {"platform":"xbox360","mode":"board","variant":"standard"},
  {"platform":"xbox360","mode":"wings","variant":"standard"},
  {"platform":"android","mode":"android","variant":"standard"},
  {"platform":"xbox360","mode":"level9","variant":"standard"},
  {"platform":"xbox360","mode":"dev","variant":"test"},
  {"platform":"xbox360","mode":"board","variant":"no_gear"}
]
```

A lista acima é **exemplo de contrato**, não inventário verificado da planilha. Valores exatos devem ser confrontados com cada aba e seu regulamento.

```bash
node --test tests/ssx2012-reconciliation.test.cjs tests/ssx2012-coverage-audit.test.cjs
node tools/ssx-reconcile-readonly.cjs \
  ./snapshots/google-sheets.json \
  ./snapshots/ozmonet.json \
  ./snapshots/expected-categories.json > audit.json
```

O relatório inclui: quantidade por categoria, eventos únicos, pistas únicas, primeiros lugares distintos, registros com prova, IDs confirmados, IDs divergentes, registros inválidos, colisões e **categorias esperadas ausentes**. Sem um manifesto explícito, a ferramenta não considera a ausência de categorias prova de que elas não existem.

Saída: contagens por status, hashes SHA-256 das capturas normalizadas, IDs confirmados, nomes divergentes, colisões de posição em eventos, IDs vinculados a múltiplos apelidos, evidências inválidas e relatório de cobertura por categoria. A revisão humana é obrigatória antes de aplicar qualquer modificação.

**Critérios de separação:** chave de evento = plataforma + modalidade + variante + evento + pista + posição. Não somar categorias como Android, Level 9, DEV/Test, No Boost, No Gear, No Wings e No Rewinds a uma classificação Board padrão sem conferir regras individuais.

**Próxima etapa:** exportar a versão vigente da planilha e capturar perfis Ozmonet com IDs; reconciliar cobertura por aba/categoria; produzir relatório de divergências; só depois construir atualização da interface e recalcular Top 3, com novos testes Chromium e uma publicação consolidada no Render.
