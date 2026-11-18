# ZVM LITE R44 — correção do formulário e diagnóstico de boot

**Data:** 2026-11-18. **Escopo:** candidata local isolada, sem merge nem deploy.

## Causa e evidência
- R43 instalada pelo usuário mostrou a tela **“A ZVM não concluiu a inicialização”** com código genérico `LICENSE_ERROR`.
- Na R43, `app/content/security/session/auth-ui.js` ainda truncava/formatava para o antigo formato `ZV-XXXXX-XXXXX-XXXXX`, apesar de a LITE exigir `zv2l-[a-z2-7]{52}` (57 caracteres).
- O worker tinha fallback `LICENSE_ERROR` para erros sem `err.code`; o boot-kernel classifica códigos desconhecidos como `BOOT`. A causa exata do erro original não pode ser reconstruída só com a imagem; não declarar completamente resolvida.
- A R43 foi assinada com identidade efêmera e configuração de servidor **`ZVM_LITE_V4_ENABLED=false`**. Assinatura local não constitui autorização do backend.

## R44 entregue para avaliação local
- CRX3 assinado `/mnt/data/ZVM-LITE-DEV-R44.crx`; SHA256 `8fb4060c87fc38baba6ddaa347ed6ab399a261f3c27972a9e5779a082933df28`.
- ZIP *somente runtime* `/mnt/data/ZVM-LITE-DEV-R44-EXTENSAO-INSTALACAO-MANUAL.zip`; SHA256 `ae21893d0ad16550de452c80852ae540667e21d356f511a5639655415257abb6`.
- Identidade **nova** de teste `cbakneegebcafoknokjopfjfeppmlbij`, versão `0.1.44`, fingerprint `4b3855ef91293d8446fa29b0863f8f3acf64f307bc28a858d929a1e45444f1fc`. Chaves privadas não distribuídas.
- Modificações no runtime: entrada de licença `zv2l-` sem truncar; máximo de 57 caracteres, rejeição de `zv2a-` e chave antiga; erros sem código enviados como `LICENSE_WORKER_UNCLASSIFIED` com diagnóstico local no worker; fallback não interpretado automaticamente como falha BOOT.
- 273 arquivos, nenhum .BAT, .PS1, PEM, KEY ou código de desenvolvimento no runtime.
- QA: 244/244 JavaScript syntax; 17 checks formulário; DOM Chromium passou para login, formato da chave e apresentação de falha com zero pageerrors; verificador `foundation-integrity.js` real critical+full: PASS, 271 protegidos; `lite-v4-client`: geração de prova assinada PASS; CRX3 RSA assinaturas e ZIP interno: PASS.
- Não houve homologação de extensão MV3 em navegador autorizado; não foi testado com WhatsApp ou backend de staging.
- **Bloqueios reais:** backend LITE não habilitado/configurado; identidade de teste não reconhecida no Render; sem chave LITE comercial ativada; assinatura DEV temporária expira 21/11/2026. Esta build não é liberação comercial.
- Antes de validar UI no WhatsApp, desativar temporariamente outras versões da ZVM para evitar injeções concorrentes, mantendo dados. Não desinstalar/limpar a sessão WhatsApp.
- Permanecem PR #124 DRAFT, main e Render produção sem alterações.
