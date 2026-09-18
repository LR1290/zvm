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
