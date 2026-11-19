# ZVM — Configuração e atualização de produção

**Referência operacional:** 19/11/2026. Este documento registra somente informações não secretas; valide o estado atual no Render antes de qualquer intervenção.

## Fonte de verdade e serviço

- GitHub: `mythos52/zvm`, branch `main`.
- Render: serviço `zvm` (`srv-d8co50mq1p3s7390p80g`), URL `https://zvm.onrender.com`.
- Deploy: **manual** (`autoDeploy=no`). Não ativar deploy automático sem autorização explícita.
- Health check: `GET /ready`.
- Banco de produção: MongoDB Atlas; nunca copiar dados de clientes para ambientes de testes.
- Backend: `server.js`; Build Authority: `build-authority.js`; Registry V2: `zvm-build-registry-v2.json`.

O hotfix comercial 0.9.289 foi aplicado em 19/11/2026 com a entrada `zvm-production-0.9.289-s5e4a7ae127ec`, fingerprint `f30db0821366e6770b1a1c09f0e171b290dd036b4aef80997a66b55966e7df33`. O deploy confirmou 26 builds ativas no runtime. A contagem pode incluir entradas adicionais do ambiente; **não** presumir que corresponda exatamente ao número de entradas no JSON versionado.

## Identidades e política

| Identidade | Extension ID | Uso |
| --- | --- | --- |
| Chrome Web Store comercial | `bdhnikgcdccjabkmbfcakgjkkgdlmgja` | Aplicativo de clientes |
| DEV | `ckbffcbmanboelbihfkhiahgafnimcho` | Laboratório e desenvolvimento |
| V3 histórico 1 | `kchicphaoknflbgajcngndanjekhpdok` | Compatibilidade, verificar usuários existentes |
| V3 histórico 2 | `kchicphaoknflbgajcngndanjekhpdek` | Compatibilidade, verificar usuários existentes |

Os dois últimos IDs estão registrados na documentação histórica; **não** representam uma leitura atual das variáveis do Render. Não substituir `ZVM_EXTENSION_IDS` por uma lista menor sem inventário de instalações ativas. A allowlist da origem e a autorização por fingerprint são mecanismos independentes.

O Registry V2 é **autoridade de build**, não cadastro de clientes: versões antigas ativas devem continuar registradas até que seja comprovado que não atendem usuários. Entradas `revoked` não podem ser reativadas automaticamente. `ZVM_BUILD_ENFORCE` deve permanecer ativo em produção, com validação de licenciamento, sessão e dispositivos. Não migrar regras DEV para a identidade da loja.

`ZVM_BUILD_REGISTRY_V2_EXTRA_JSON` permite entradas adicionais controladas por ambiente. **Antes de incorporar um build ao arquivo versionado**, verificar se o mesmo `buildId` já está na configuração extra: uma duplicação ativa pode rejeitar a inicialização. Se existir entrada duplicada, reconciliar cuidadosamente com a fonte de configuração vigente em uma intervenção isolada. Não exibir valores de variáveis secretas em logs, commits ou respostas.

A compatibilidade com instalações V3 descompactadas depende de `ZVM_LEGACY_V3_ALLOW`, limitada aos endpoints `/extension/v3/key` e `/extension/v3/check-status`. Não a remover como simples limpeza de código.

## Procedimento para nova RELEASE

1. Confirmar a versão **efetivamente publicada** na Chrome Web Store e a identidade comercial exata no pacote.
2. Calcular Build ID, SourceTree SHA-256 e fingerprint diretamente do ZIP final. Não usar assinaturas DEV.
3. Inserir **somente a entrada faltante** no Registry V2, sem alterar builds anteriores; revisar a entrada extra do Render para evitar duplicações.
4. Executar testes de Build Authority, sessão V4, atualização de sessão, bloqueio/revogação e integridade do pacote; resolver falhas críticas do CI antes de uma divulgação planejada.
5. Validar alteração em branch isolada e PR. Obter autorização para o merge/deploy comercial.
6. Implantar **manualmente** no Render e observar o deploy até ficar `live`; confirmar o log de inicialização, conexão MongoDB, contagem de builds e `/ready`.
7. Validar login e renovação com uma conta de homologação e uma extensão com o ID da Chrome Web Store; verificar versões anteriores com dados não sensíveis.
8. Só então distribuir a atualização. Nunca orientar clientes a reinstalar a extensão ou apagar armazenamento local como procedimento habitual.

## Higiene do repositório

Pacotes assinados DEV, ZIPs de submissão CWS, CRX/PEM, relatórios individuais de builds antigas e checksums congelados **não pertencem à árvore ativa do backend**. A limpeza de novembro de 2026 retirou os artefatos V740–V746 e validadores históricos dependentes dos seus ZIPs; o histórico permanece no Git para auditoria.

Preserve módulos operacionais e dados de referência realmente usados. Um arquivo aparentemente legado só deve ser excluído após verificar chamadas, testes, compatibilidade e dependências de clientes. A política de CI impede regressão da pasta de ZIPs de extensão antiga.
