# ZVM Cloud R21 — CRM funcional em branch de QA, sem publicação
Data: 2026-11-16
Base: Cloud R20 (PR #113, branch feature/cloud-r17-paridade-fonte-20261116)
Fonte histórica de referência: extensão R17 / manifest 0.9.286, conforme inventário R20.
Serviço de produção: zvm.onrender.com, Cloud em /dev/cloud (R19); deploy manual preservado.

## O que foi efetivamente implementado
- R20 permanece em QA: navegação baseada na extensão, menu lateral, 13 superfícies, busca Ctrl+K, painel com contadores reais.
- R21 introduz **quadro CRM funcional**: colunas/etapas, cartões importados, criação e renomeação de etapas, remoção de etapa vazia, associação de contato previamente salvo, movimentação de cartão e desvinculação sem apagar contato.
- Colunas e cartões R17 preservados, inclusive IDs e campos adicionais de registros legados em movimentações; colunas sem ID original continuam acessíveis por índice protegido com CAS.
- Endpoint `POST /api/crm/board` autentica sessão do Portal, verifica concessão DEV, impõe Origin, filtra por e-mail da conta, aplica CAS de revisão global e valida workspace inteiro antes de gravar.
- Proteção contra referências órfãs: não é possível excluir contato da Cloud vinculado a cartão `source:cloud`, inclusive por importação `replace`.
- UI acessível e responsiva, com botões e formulários reais; nunca se apresenta como CRM sincronizado ao WhatsApp.
- Rotas estáticas locais e CSP existente mantidos; nenhum CDN nem handler inline.

## QA efetuado nesta rodada
- 10 cenários de execução isolada da lógica CRM em V8, com mock de UUID/normalizador e clonagem compatível: 10 passaram.
- 16 verificações estáticas sobre arquivos reais baixados via GitHub, incluindo sintaxe JS, gate DEV, endpoints, CAS, HTML/CSS, isolamento de chamadas e presença na suíte: 16 passaram.
- Testes Node novos em `cloud-pilot/test/r21-crm-board.test.js` (10 casos incluindo HTTP/contas/Origem/CAS) e `cloud-pilot/test/r21-crm-ui.test.js` (4 casos de contrato) adicionados ao `npm run check`. **Ainda não foi possível rodar esses testes Node do repositório nesta sessão**; a integração HTTP, Chromium, Render e WhatsApp real NÃO estão homologados.
- Nenhum merge em main, nenhum deploy Render, nenhuma alteração no Banco de produção, nenhuma ativação de disparo.

## Limites explícitos
- A edição geral dos registros CRM permanece no editor de módulos herdado da R17. O quadro R21 cobre colunas/cartões e suas associações, não todos os recursos PRO da extensão.
- Contact snapshots importados não são convertidos silenciosamente em contatos remotos. Só contactos existentes na conta podem ser vinculados a novos cartões.
- Não há sincronização WhatsApp Web nem envio pela Meta Cloud API; nenhum job 24/7 ou scheduler foi ativado.
- Importador de mídias grandes/OPFS e `.extbackup` criptografado, motores de Disparos, Fluxos/Funis, opções de CRM avançado, Quick Shelf e IA ainda precisam de portabilidade e E2E.
- Esta branch ficou atrás da main por commits de correção do Admin; reconciliar **sem descartar** as correções R47.13/R47.14 antes de promover.
- A paridade visual e funcional com toda a extensão não foi declarada concluída.

## Gates obrigatórios antes de merge/deploy
1. Rodar `npm run check` e regressões da Cloud e do Portal, corrigindo falhas de suíte;
2. Executar Chromium real nos tamanhos desktop/celular e autenticar Portal + 2FA + chave DEV, verificando todas as superfícies;
3. Inventariar os módulos faltantes da R17 e implementar comportamentos reais (não placeholders);
4. Homologar backup export/import com mídias e vínculos, sem perda de dados, com rollback;
5. Implementar qualquer envio somente na WhatsApp Business Platform autorizada, com opt-in, idempotência, tratamento de custos e aprovação;
6. Revisão de privacidade, custos, métricas, recuperação, reset de sessão e concorrência;
7. Aprovação final do proprietário para merge manual e deploy manual no mesmo serviço `zvm.onrender.com`.

**Status: R21 CRM implementado, candidato em QA. NÃO PUBLICAR.**
