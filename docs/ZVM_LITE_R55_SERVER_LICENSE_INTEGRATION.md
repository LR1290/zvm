# ZVM LITE R55 — integração e segurança do licenciamento (18/11/2026)

## Escopo e situação
Alterações implementadas na branch isolada `feature/zvm-lite-key-v2-isolado-20261118`, PR DRAFT #124.
**Nenhum merge em main; nenhuma alteração em chaves reais, banco de produção ou deploy no Render.**

### Gerador comercial já implementado (R51–R54)
- Administração exige escolha explícita entre `zvm_automacoes` e `zvm_lite`.
- `zv2l-` + 52 caracteres base32 = 57 caracteres de licença e 256 bits de entropia do `crypto.randomBytes(32)`, gerados **no backend**.
- Novas chaves LITE começam com `active:false`, `provisioningStatus:'awaiting_lite_build_authority'` e `planId:'LITE_DEV'`; não são ativadas por mera geração.
- API de autenticação LITE V4, origem da extensão exclusiva, assinatura Ed25519, identidade de build e prevenção de replay são exigidas para abrir sessões.
- Conta do portal mantém `keyCode` (ZVM completa) e `liteKeyCode` (LITE), independentes.
- A chave digitada em conversa anterior **não é chave ativa**. Para ativar qualquer chave, é preciso persistência administrativa e ambiente LITE autorizado.

### Novas correções R55
1. `src/license-product-v2.js`: um registro marcado `zvm_lite` não pode reaproveitar uma chave antiga ou `zv2a-`. Exige exatamente `zv2l-[a-z2-7]{52}`, além do produto persistido.
2. `src/portal-license-slots.js`: `ensureLitePortalLicenseUniqueIndex(db)` cria índice único parcial `zvm_lite_license_owner_unique_v1` em `portal_users.liteKeyCode`, incluindo somente strings. Não impõe restrição nova em `keyCode` da versão completa; erro de índice impede o vínculo.
3. `server.js`: registro e vínculo LITE exigem a proteção de unicidade no Mongo **antes** de criar/alterar o documento. Colisões Mongo `11000` com `liteKeyCode` são identificadas no formulário, sem mensagem genérica nem aceitação concorrente.
4. `server.js`: refresh de sessão LITE por e-mail/senha compara a chave originalmente autenticada com a chave **atual** da conta. Se houve troca, a sessão anterior é revogada e o usuário deve entrar de novo. Se há indisponibilidade temporária do banco, não destrói a sessão válida. Sessões da versão completa não são modificadas.
5. `tests/r55-lite-unique-key-owner.test.js` + adição à `tests/r54-lite-portal-session-revocation.test.js` cobrem políticas, índice, chamadas reais e erros. Pipeline especializado atualizada.

### Evidências
- GitHub Actions `ZVM key V2 - isolated checks` SHA `d505cba2063eff87b8a7252deea0a73b088e4624`: **PASS**, https://github.com/mythos52/zvm/actions/runs/44381419464
- CI global `Security audit (no deployment)` continua **FAIL** em `tests/r46-public-i18n.test.js` na verificação do href de `/privacidade?lang=pt-PT`; falha não é validada como sucesso nem alterada silenciosamente.
- Teste MV3 no Chromium autorizado/WhatsApp conectado: ainda **pendente**; UI/worker isolados não equivalem a homologação comercial.

### Próximos gates de homologação (sem scripts .bat)
1. Estabilizar identidade exclusiva RSA/Ed25519 da extensão, mantendo a chave privada com o proprietário (a identidade de laboratório R45 é temporária e a assinatura expira em 21/11/2026).
2. Aplicar/migrar código em homologação, com Mongo staging e variável `ZVM_LITE_V4_ENABLED` só após registrar chave pública, ID da extensão, hash e versão da **mesma build**.
3. Homologar no navegador: instalar MV3, autenticar chave ou conta, testar rotação/revogações/replay e comportamento WhatsApp com uma conta de teste.
4. Somente depois de QA e autorização separada, preparar merge/deploy manual do servidor comercial e emitir/ativar primeira licença real no administrativo. Não basta copiar texto de uma chave V2L.
