# ZVM LITE — R43 CRX3 e R54 servidor (18/11/2026)

**Estado:** branch isolada `feature/zvm-lite-key-v2-isolado-20261118`, PR DRAFT #124, sem merge/deploy no Render. O produto completo continua independente.

## Servidor / R54
- Login LITE V4 próprio; chaves `zv2l-` de 57 caracteres e `liteKeyCode` independente de `keyCode`.
- `src/portal-license-slots.js`: `revokePortalLitePasswordSessions()` usa filtro `{accountEmail, extensionProductId:'zvm_lite', authMethod:'password', revokedAt:null}`; falhas do MongoDB não são silenciadas. Chaves diretas e sessões da ZVM completa não entram no filtro.
- `server.js`: troca ou desvinculação LITE revoga essas sessões; refresh LITE com licença inválida revoga token, mas indisponibilidade de DB (retryable) não apaga credencial.
- `tests/r54-lite-portal-session-revocation.test.js`: testes da consulta ao banco, escopo e lógica real de refresh.
- CI isolada no SHA `83a9ecb6c58fcf1da4bfd08061b874b92c9f488d`: **PASS** em https://github.com/mythos52/zvm/actions/runs/44356726556. CI geral ainda vermelha por teste anterior de `/privacidade?lang=pt-PT`; navegador/site global NÃO homologados.
- **Risco residual:** titularidade de chaves ainda usa pré-consulta seguida de `insertOne/updateOne`; garantia de unicidade em corrida concorrente exige revisão transacional/índices e DB de staging. Não declarado concluído.

## Artefato local / R43
- `ZVM_LITE_R43_FONTE_CRX3_LOCAL_LAB_NAO_INSTALAR.zip`
- **SHA256:** `2c41ae624ee9c77719e39ff0073e00744d1ba2e0159e6143473837008a3c085a`; **696 arquivos / 4.637.878 bytes / ZIP íntegro / nenhuma chave privada**.
- `PREPARAR_ZVM_LITE_DEV_R43.bat` prepara a identidade **no PC do proprietário**, mantendo RSA 3072 e Ed25519 privadas fora da fonte e extensão; Chrome/Chromium empacota CRX3; `tools/lite-crx3-verify.cjs` confere RSA-SHA256, ID Chrome e bytes de cada arquivo arquivado.
- QA local: 19/19 invariantes, 423 JS válidos, 49 imports do service worker, **10/10 testes do protocolo/CRX3**, verificador real `foundation-integrity.js` e prova V4 aprovados, **17/17 DOM Chromium**. QA com chaves temporárias não define identidade oficial.
- **Não é versão comercial instalável:** `installationAllowed=false` na fonte. O CRX é gerado e verificado somente com as chaves estáveis locais do proprietário, e não foi instalado/autenticado com WhatsApp real. Política de extensões do Chromium de laboratório proíbe carga MV3; não houve contorno.
- Prioridade restante: provisionar chaves estáveis no PC, homologar MV3 e login com um servidor LITE **staging**, assegurar revogação/refresh/logout e reinício, testar sem política restritiva; só depois discutir integração/implantação. **Não fazer deploy nem merge automático.**
