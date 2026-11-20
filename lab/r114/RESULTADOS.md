# R114 | Candidata de laboratório

Base R113 em 1bcdc881. Em uma cópia da árvore R113, aplicar rail.patch e auth.patch com patch -p1 e conferir sha256sum -c SHA256-candidata.txt. A assinatura da base não cobre as alterações.

app/sidebar/native-whatsapp-rail.js aplicava todos os estados somente após a última resposta. A candidata inicia os botões desabilitados e aplica cada resposta confirmada ao respectivo botão, conferindo a geração e o vínculo ao host. O limite de 3500 ms do comando individual e o agrupamento de pedidos de atualização continuam ativos.

app/content/security/session/auth-ui.js bloqueava a troca de formulário durante a autenticação e dependia de botões desabilitados para evitar submissões repetidas. Agora ambos os formulários compartilham a exclusão de submissões. A navegação continua disponível. A resposta de erro de uma apresentação anterior não modifica a apresentação atual. A confirmação positiva continua seguindo o fluxo original de recarga da sessão.

PASS no Chromium 156 offline com DOM real e autoridade simulada. browser.jsonl guarda cinco pares de medições, incluindo a recusa da resposta de uma geração anterior. login.json registra duas operações sequenciais e uma única chamada no período com 10000 tentativas adicionais de submissão. O primeiro ensaio de login falhou porque a fixture omitia as expressões de validação da chave. Incluídas as duas constantes do próprio produto, o ensaio passou. Para repetir, disponibilize playwright no NODE_PATH, indique o executável em CHROMIUM_PATH e execute node rail-browser.cjs R113 R114 e node login-browser.cjs R114.

contracts.log registra 56 testes aprovados e zero falhas. Ainda faltam jornadas completas no WhatsApp, medições de sessão longa, confirmação do servidor QA para esta candidata e assinatura institucional local. A medição por comando não estabelece limite global de latência para a extensão.
