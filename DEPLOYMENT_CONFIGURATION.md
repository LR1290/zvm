# ZVM — Configuração de deployment

Este arquivo registra configuração operacional **não secreta** necessária para reproduzir o ambiente do servidor ZVM. Segredos reais (senhas, tokens, chaves privadas e `APP_SECRET`) permanecem exclusivamente no ambiente seguro do provedor e nunca devem ser versionados neste pacote.

## Allowlist oficial de extensões

Em 2026-09-17, o inventário confirmado de IDs Chrome que precisam coexistir em produção é:

| Perfil | Chrome Extension ID | Situação |
| --- | --- | --- |
| BETA | `bdhnikgcdccjabkmbfcakgjkkgdlmgja` | Atual |
| DEV | `ckbffcbmanboelbihfkhiahgafnimcho` | Atual |
| Legado atual | `kchicphaoknflbgajcngndanjekhpdok` | Compatibilidade V3 |
| Legado anterior | `kchicphaoknflbgajcngndanjekhpdek` | Compatibilidade V3 |

Valor correspondente:

```env
ZVM_EXTENSION_IDS=bdhnikgcdccjabkmbfcakgjkkgdlmgja,ckbffcbmanboelbihfkhiahgafnimcho,kchicphaoknflbgajcngndanjekhpdok,kchicphaoknflbgajcngndanjekhpdek
```

## Por que esta lista deve ser preservada

O runtime R32 usa `ZVM_EXTENSION_IDS` como allowlist de origem para clientes `chrome-extension://...` e também como parte dos controles de identidade do Build Authority. Um ID legítimo ausente pode receber `Access-Control-Allow-Origin: null` nas rotas `/extension/*`, fazendo o navegador interromper o preflight CORS antes do `POST` real.

Os IDs legados acima são mantidos somente para compatibilidade com clientes V3 ainda suportados. Sua presença na allowlist **não** concede automaticamente autorização de Registry V2, fingerprint, build ID, canal ou perfil. Esses controles continuam independentes.

## Regra de manutenção

Ao alterar `ZVM_EXTENSION_IDS`:

1. Preserve todos os IDs oficiais que ainda precisam funcionar.
2. Nunca troque a lista inteira por apenas um novo ID sem inventário prévio.
3. Não use `*` como substituto da allowlist.
4. Revise `zvm-build-registry-v2.json` separadamente para builds V2; CORS/allowlist e Registry V2 não são a mesma autorização.
5. Remova um ID legado somente após confirmar que nenhum cliente suportado ainda depende dele.

## Estado do código neste checkpoint

A documentação deste pacote registra a configuração aplicada no ambiente de produção. O código do servidor R32, os registries e os artefatos DEV/BETA permanecem inalterados em relação ao checkpoint `ZVM_GITHUB_RENDER_R32_V744_BETA_REGISTRY_READY`.

## Compatibilidade ZVM Build 3 descompactada — R33

A `ZVM - Build 3` enviada para validação tem `manifest_version: 3`, versão `0.2.7`, usa somente os endpoints legados `POST /extension/v3/key` e `POST /extension/v3/check-status`, e **não contém `manifest.key`**. Como ela é instalada via **Carregar sem compactação**, o `chrome.runtime.id` pode variar entre instalações e não pode ser representado por uma allowlist finita de IDs.

O R33 preserva o Build Authority e Registry V2 sem relaxamento e adiciona uma exceção CORS estritamente localizada:

- requer `ZVM_LEGACY_V3_ALLOW=true`;
- `ZVM_LEGACY_V3_UNPACKED_ORIGINS_ALLOW=true` por padrão, podendo ser desativada explicitamente;
- aceita apenas Origins sintaticamente válidas `chrome-extension://<32 chars a-p>`;
- somente nos paths exatos `/extension/v3/key` e `/extension/v3/check-status`;
- nunca se aplica a `/extension/v4/*`, DEV/BETA/PRODUCTION, Registry V2, Build Authority, admin, analytics, Meta ou demais rotas;
- autenticação por chave, limites comerciais, rate limit, expiração/bloqueio e demais controles dos endpoints V3 permanecem inalterados.

Essa exceção existe para restaurar clientes Build 3 existentes **sem exigir reinstalação nem nova build da extensão**. Remova-a somente após migração explícita dessa base instalada.

## Refresh de artefatos DEV/BETA — V746 / 0.8.541

Este pacote mantém o **mesmo runtime R33** da correção de compatibilidade da Build 3, mas atualiza os artefatos de referência em `release-assets/` para a linha V746:

- `ZVM_AUTOMACOES_V746_DEV_BROWSER_TEST_SIGNED.zip` — DEV V746 assinada institucionalmente, carregável por unpacked; Google Drive OAuth real ainda pendente e por isso `oauth2` permanece omitido.
- `ZVM_AUTOMACOES_V746_BETA_BROWSER_TEST_OAUTH_PENDING.zip` — BETA V746 minificada/integridade qualificada para validação local; **não** promover à Chrome Web Store enquanto os Client IDs OAuth reais não existirem.
- os ZIPs V744 anteriores foram movidos para `release-assets/rollback-v744/` como âncoras de rollback/referência.

Importante: o **Registry V2 ativo de BETA permanece V744 / 0.8.539**. Isso é deliberado: a V746 BETA ainda não está OAuth-qualified nem deve ser registrada/publicada prematuramente. O acesso da Build 3 corrigido pelo R33 independe desses ZIPs de release; a correção efetiva é server-side em `server.js` + `extension-origin-policy.js`.


## R34 — remoção da segunda chave de configuração da compatibilidade Build 3

Para reduzir o risco operacional no hotfix, a compatibilidade da Build 3 passa a depender **somente** do `ZVM_LEGACY_V3_ALLOW`, que já existe no servidor e está ativo no ambiente atual. A variável adicional `ZVM_LEGACY_V3_UNPACKED_ORIGINS_ALLOW` foi removida do runtime e do `.env.example`, evitando que uma configuração nova/ausente/divergente impeça a restauração dos clientes.

Enquanto `ZVM_LEGACY_V3_ALLOW=true`, Origins `chrome-extension://<id válido>` fora da allowlist são refletidas **somente** em `/extension/v3/key` e `/extension/v3/check-status`. Todo `/extension/v4/*` e demais rotas continuam estritos.
