# ZVM Cloud R25 — Migração seletiva ZIP R17 com mídia vinculada
Data: 2026-11-16 • Fonte: ZIP **ZVM_AUTOMACOES_R17_FONTE_COMPLETA_QA_NAO_INSTALAR_20261115**, verificada localmente. • Branch: `feature/cloud-r22-conta-persistente-studio-shell-20261116` • PR #117.

## Origem dos dados — comportamento efetivamente confirmado
No código da extensão R17 `app/background/authority/backup-authority.js`, o exportador gera:
- `backup.json` como manifesto ZIP;
- `binaryAssets` com `id`, `path`, `mimeType`, `fileName`, `sizeBytes` e `kind`;
- referências `extapp-zip-asset:asset-<id>` em `backup.assets[<item-id>]` e em estruturas auxiliares;
- entradas `assets/<categoria>/<token>__<nome>`.
A versão original permite arquivos maiores do que o cofre Cloud de QA; **não existe compatibilidade irrestrita de tamanho**.

## O que foi implementado nesta rodada
1. **Inventário local do ZIP:** o `backup-zip.js` examina o índice de arquivos ZIP32 sem transferir o arquivo inteiro. O limite de inspeção cresce de 512 MiB para 2.100+ MiB (2.200 MiB). O manifesto permite até 32 MiB, com quantidade de entradas e índice central limitados. ZIP64, criptografia, caminhos inseguros, links especiais, nomes duplicados e formatos desconhecidos continuam recusados.
2. **Autenticidade estrutural do ZIP:** valida presença, unicidade e correspondência das entradas declaradas em `binaryAssets`. Para backups de assetEncoding='external', entradas não declaradas ou referências inexistentes bloqueiam a leitura. Uma mídia somente pode ser extraída por `readAsset` quando há proveniência única e formato permitido.
**Compatibilidade forense adicional:** o exportador R17 pode externalizar `backup.assets[id]` como token direto **ou** como uma string JSON serializada contendo o token em `data` e propriedades aninhadas. O primeiro inventário cobria apenas o token direto. A revisão da R25 introduziu `sourceTokens`, que percorre objetos/strings JSON com limites de profundidade (16), objetos e nós (100 mil no conjunto), sem correspondência parcial nem escolha de origem ambígua. Origem com mais de um dono é rejeitada. Foram executados 8/8 testes isolados do extrator de tokens, incluindo o formato real serializado, duplicação, malformação e campos reservados.

3. **Leitura seletiva:** `readAsset` extrai **apenas** o arquivo escolhido, de até 32 MiB, verifica CRC32/tamanho, expansão limitada e assinatura real PNG/JPEG/WebP/PDF/MP3/OGG/MP4. CRC32 não substitui SHA-256: o uploader e servidor R24 calculam SHA-256 por bloco e do arquivo completo.
4. **Verificação de vínculo independente:** `backup-asset-links.js` é um módulo puro, próprio para teste e sem armazenamento de segredos. Exige que o token conste exatamente no inventário, não exista mais de um token para a mesma origem, e haja exatamente um registro de Biblioteca importado de `EXTUI:audioStore`, `mediaStore`, `documentStore` ou `stickerStore`. O tipo MIME precisa ser compatível e o registro não pode estar vinculado a outra mídia.
5. **Confirmação separada e CAS:** primeiro o usuário aprova a importação JSON (metadados); depois autoriza separadamente a restauração das mídias elegíveis. A interface reutiliza o mesmo uploader binário autenticado de R24, não cria endpoint duplicado, e recarrega revisão CAS antes da associação e novamente depois do envio.
6. **Recuperação não destrutiva:** se a mídia ficar salva no cofre mas a revisão da Biblioteca mudar ou cair a conexão, o arquivo permanece privado para recuperação manual e o relatório identifica o vínculo não confirmado. Nunca apagar automaticamente um arquivo com resultado ambíguo.
7. **Controle de concorrência:** enquanto restaura um ZIP, o painel bloqueia outro import e o upload paralelo, respeita o encerramento de sessão e permite interromper transferências. Nenhuma chave/senha, token do upload ou ZIP é guardado no localStorage.

## Limites REAIS deste checkpoint
- O sistema **inspeciona o índice** de ZIPs grandes, mas NÃO restaura 1 GiB de mídia automaticamente: máximo de 32 MiB **por arquivo**, 128 MiB **por conta**, 60 itens por execução, com a cota aplicada no backend.
- O JSON filtrado para importação permanece limitado a **2 MiB** para evitar upload de bases gigantes e dados sensíveis; o manifesto ZIP pode ter até 32 MiB, mas isso não significa que todos os metadados caibam no importador.
- Assets de Fluxos, Funis, Quick Responses e demais estruturas que não podem ser associados de maneira inequívoca ainda não são restaurados. Formatados e vínculos incompatíveis são preservados como pendentes, sem sucesso falso.
- O ZIP fornecido como base foi o **código da extensão**. Os casos de backup da R17 foram montados a partir do contrato do exportador. Não houve acesso a backup privado de cliente.
- A Cloud continua sem mensageria real, sem transporte alternativo de WhatsApp Web no servidor e sem deploy de R22–R25.

## QA executado nesta rodada
- 7/7 testes de extração ZIP sintética real no mecanismo isolado: inventário, CRC correto/incorreto, signature mismatch, entradas inesperadas, tamanho divergente e origem ausente.
- 6/6 testes de resolução de vínculos e contratos da interface atual, incluindo deduplicação de referência, MIME, registros conflitantes e CAS.
- 13/13 verificações conjuntas de sintaxe/integração DOM/rotas e separação dos módulos.
- Arquivos de teste Node adicionados ao `npm run check`: `r25-r17-zip-assets.test.js` e `r25-asset-links.test.js`. Esses testes versionados **ainda dependem do runner Node real**; o GitHub Actions seguiu sem alocar runner nos jobs anteriores.

## Bloqueadores de liberação e auditoria profissional
1. Executar a suíte Node completa e o browser Chromium/Opera real, incluindo arquivo ZIP com data descriptor de R17, mudança de conta, interrupção de rede e falha na conclusão.
2. Homologar transações e limites no MongoDB **real** (não apenas FakeCollection). Confirmar custo projetado de armazenamento, egress e quotas; avaliar S3/object storage para mídia acima de 32 MiB.
3. **Concorrência transacional entre Biblioteca e exclusão de mídia:** em R24, a checagem de vínculo e a exclusão de grandes mídias são transações separadas. Sob gravações simultâneas pode ocorrer corrida; antes da publicação exige guarda atômica envolvendo as operações na mesma conta ou estado de deleção com CAS. Não considerar o isolamento por conta suficiente para resolver a corrida.
4. Restauração plena dos assets de Fluxos/Funis, Quick Shelf, CRM completo e Disparos/filas/Meta oficial, com consentimento e testes de ponta a ponta.
5. Revisão de integração/CI, testes móveis, acessibilidade e rollback. **Nenhum deploy parcial**.

**Estado:** R25 é checkpoint de laboratório, não um produto Cloud equivalente à extensão; PR #117 continua DRAFT, `main` e Render inalterados.
