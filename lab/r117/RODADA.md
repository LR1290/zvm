# R117 de laboratório

Base de extensão com 359 arquivos conferidos contra o inventário R116. Aplicar changes.patch com patch -p1 --fuzz=0 em cópia da base e executar sha256sum -c inventory.sha256 na raiz da candidata. O replay em uma segunda cópia reproduziu os 359 hashes.

| Fonte modificada | Motivo |
|---|---|
| app/background/authority/offscreen-options-data.js | Preservar campos completos em edições da Biblioteca, usar o codec do envelope e vincular leitura e gravação à conta e ao valor original. Na restauração, proteger também o destino do conteúdo. Aplicar a mesma guarda nas preferências de CRM, inclusive enquanto o comando aguarda na fila. |
| app/shared/core/backup-migration-core.js | Interromper a mesclagem de listas em envelopes quando uma mesma lista de origem contém IDs repetidos. A correspondência legítima entre origens continua funcionando. |
| app/dashboard/features/library/items.js | Dividir a construção dos cartões em intervalos com devolução à fila de eventos e abandonar uma renderização substituída. Normalizar a busca uma vez. |

## Reprodução e limites

Com Playwright disponível no NODE_PATH e CHROMIUM_PATH apontando para Chromium, executar node storage.cjs RAIZ e node grid.cjs RAIZ nesta pasta, primeiro com a base e depois com a candidata. A base falha nas asserções reproduzidas. O teste de storage carrega a autoridade completa em Chromium com dados sintéticos, autorização e armazenamento simulados. O teste da grade usa a função real com cartões sintéticos de 12 elementos filhos. Uma versão intermediária com scheduler.yield falhou ao permitir que a busca por timer fosse processada antes do cartão 5000. A versão final passou em três execuções.

A suíte anterior lab/r116/motor-path.cjs usa IndexedDB real e ponte simulada. Os quatro motores exigiram revisão após ACK perdido e recarga. lab/r116/login-sla.cjs exercitou a UI de autenticação sob CPU normal e 4x. Os demais cenários repetidos estão em regression-motores.txt e regression.txt. A instalação MV3, o WhatsApp real, o ciclo integral de backup e a medição de todos os botões continuam pendentes na matriz A–N.
