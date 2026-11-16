# ZVM Cloud R28 — downloads íntegros sob exclusões concorrentes
**Checkpoint:** 2026-11-16. **Branch:** `feature/cloud-r22-conta-persistente-studio-shell-20261116` · **PR:** #117 (DRAFT) · **Status:** QA, sem deploy.

## Incidente arquitetural da R27

Na rota `GET/HEAD /api/media/:id` para arquivos grandes, o servidor verificava SHA-256 lendo o MongoDB uma primeira vez e **abria uma segunda leitura dos mesmos blocos após responder HTTP 200**. Uma exclusão simultânea ou queda de bloco entre as leituras podia causar um download truncado, ainda anunciado com `Content-Length` original. A checagem prévia era correta, mas **não protegia os bytes realmente enviados**.

## Correção implementada

- `cloud-pilot/verified-media-download.js`: leitura única de blocos, com cópia defensiva, validação de quantidade/tamanho exatos de cada bloco, SHA-256 integral, assinatura MIME autorizada e máximo rígido de 32 MiB por arquivo. O arquivo completo é materializado em memória como **snapshot independente do MongoDB** antes de emitir cabeçalhos.
- Uma exclusão concluída **antes** do início da leitura retorna 404. Se a exclusão ocorrer **durante** a cópia e provocar blocos ausentes/alterados, o download retorna 503 **sem ter emitido HTTP 200**. Se a exclusão acontecer **depois** que o snapshot íntegro foi obtido, o download continua com os bytes já verificados.
- `createDownloadGate` controla a memória da instância Node: **no máximo dois downloads grandes simultâneos por processo e um por conta**, com chave de proprietário derivada de hash. Um excesso retorna HTTP **429** com `Retry-After: 2`. As vagas são liberadas em `finish`, `close` ou erro (liberação idempotente), não imediatamente após `res.end`, que apenas agenda o envio.
- `HEAD` recebe o mesmo critério de integridade (sem enviar corpo binário). Credenciais da conta Portal, chave DEV, segregação de arquivos, cabeçalhos `no-store`/`nosniff`/`same-origin` e política de origens permanecem aplicados.
- `cloud-pilot/large-media-domain.js`: exporta `isSupportedMime` para evitar duplicação de política de MIME; mantido o bloqueio a conteúdo não autorizado.
- O painel `workspace.js` informa ao usuário quando um download está ocupado (429), quando o servidor bloqueou arquivo inconsistente (503) ou quando o objeto já não existe (404). Não mostra conteúdo inválido como sucesso.
- Removidos `validateLargeDownload` e a segunda leitura/reenvio, assim como import de `events.once` que deixou de ser usado: sem código morto residual.

## Testes e evidência

1. **Node.js 22.16.0 real:** executados **7/7 testes** do módulo `verified-media-download.js` em ambiente local com dependências de mídia simuladas: bytes imutáveis, corrupção, truncamento, bloco extra, tamanho adulterado, cancelamento e limite/liberação de vagas. **Verificou-se identidade binária do módulo local com o Git blob da PR**, hash SHA-1 de objeto Git `75b4a641bc5b78f722361c52b081c1b6d1e848ee`.
2. **V8 isolado usando `server.js` e `verified-media-download.js` da branch:** **7/7 cenários** de API: GET íntegro, HEAD íntegro, isolamento de contas, exclusão no meio da cópia retornando 503 sem 200, objeto removido retornando 404, concorrência retornando 429 e vaga liberada após resposta.
3. **Testes Node versionados (ainda pendentes de execução completa no runner):** `cloud-pilot/test/r28-download-snapshot.test.js`, com testes unitários do snapshot e cenários HTTP de exclusão concorrente/HEAD/controle de resposta. Adicionado ao `npm run check`. Contratos antigos de interface também foram atualizados para exigir exatamente uma leitura validada.
4. A execução dos testes em Node local **não equivale** à homologação completa da aplicação em processo Node + MongoDB/Replica Set + Chromium. O GitHub Actions continuou sem executar as etapas por falta de runner nos checkpoints anteriores.

## Limites operacionais e implantação

- Cada download de até 32 MiB pode usar aproximadamente o dobro de memória temporária ao acumular blocos e construir o snapshot. O teto de dois downloads grandes por processo evita saturação descontrolada, mas precisa de stress com o tamanho de RAM real do Render.
- O snapshot é temporário e restrito à requisição; não há cache global, armazenamento persistente novo nem transferência externa.
- A cota lógica R27 de 128 MiB/conta permanece independente da cota de downloads ativos e dos custos reais de tráfego/índices MongoDB.
- **Gates pendentes:** MongoDB real com exclusão enquanto cursor está aberto; Node HTTP completo no runner; Chromium/Opera/celular autenticados; carga com respostas lentas e cancelamento; migração de backups grandes e paridade funcional da extensão.
- **Sem publicação:** não mesclar a PR #117, não atualizar `main`, Render, dados de clientes ou licenças. O desenvolvimento funcional de Fluxos/Funis/Disparos e Meta autorizada continua separado deste módulo de transferência.
