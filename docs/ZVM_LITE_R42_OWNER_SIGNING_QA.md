# ZVM LITE R42 — pipeline de assinatura offline (somente homologação)

**18/11/2026.** PR #124 segue DRAFT e `main`/Render sem alterações.

## Estado do servidor/chaves

- API isolada: `/extension/lite/v4/session/{key,login,refresh,logout}`.
- Assinatura Ed25519, Origin específico da identidade Chrome LITE e replay de requestId obrigatórios para autenticação.
- Licenças 256-bit `zv2l-` de 57 caracteres, sem reutilização `keyCode` da ZVM completa.
- Conta portal: `keyCode` para a completa, `liteKeyCode` para a LITE; botões de desvinculação independentes; painel próprio.
- Admin: seleção de produto, chave LITE emitida inicialmente inativa; ativação condicionada à autoridade de build configurada.
- CI especializado de licenciamento: `https://github.com/mythos52/zvm/actions/runs/44345500794` = PASS. CI geral antiga ainda vermelha nos testes independentes de i18n/Privacidade e UX móvel.

## Artefato de engenharia R42

`ZVM_LITE_R42_FONTE_E_ASSINADOR_LOCAL_LAB.zip`

SHA-256 `c581e8cc2c07606b38e7a2ae589126f939f1f3a7752a4a9f158411e4e10e7499`

693 arquivos / 4.630.252 bytes / ZIP íntegro / 0 chaves privadas.

O artefato **não** é uma versão instalável homologada e não contém assinatura de distribuição oficial. Inclui `PREPARAR_ZVM_LITE_DEV_R42.bat` e `tools/lite-owner-dev-build.cjs`; estes geram, apenas na máquina do proprietário, identidade RSA 3072, signer Ed25519, `app/security/build-identity.json`, `integrity.json`, `lite-v4-signed-build.json` e `manifest.key`. A chave privada fica fora do projeto/ZIP, protegida com ACL NTFS pelo inicializador Windows. Não há deploy automático nem ativação do servidor.

## Validações R42

- `qa/lite/audit_r42_static.py`: 17 invariantes, 422 JS, 49 imports de worker — PASS.
- `qa/lite/test_lite_r42_signed_pipeline.cjs`: 2/2 testes PASS, assinaturas reais Ed25519 com chaves **efêmeras de QA**, proteção de segredos e prova de adulteração.
- Verificador real `foundation-integrity.js` em VM JavaScript: verificações **critical e full PASS** para runtime DEV sintético de 271 arquivos (12.153.308 bytes protegidos).
- Preparação real de `clientSecurity/signedBuild` pelo módulo `lite-v4-client.js`: PASS com assinatura QA.
- Dashboard: 17/17 verificações Chromium DOM PASS. **Não equivale a carregar service worker MV3.**
- Chromium MV3 real: permanece **BLOQUEADO por política administrativa**, sem tentativa de bypass. Não houve autenticação real no WhatsApp ou no servidor.

## Pendências não declaradas concluídas

1. Proprietário deve provisionar a identidade estável em seu PC (o gerador está entregue, mas não foi executado no PC dele).
2. Homologação da instalação em Chrome/Opera permitido, com WhatsApp de teste, incluindo token V4, login, refresh, revogação e logout.
3. Configurar servidor LITE de **homologação** com chave pública, ID Chrome e hash aprovados; sem tornar a LITE ativa no Render comercial.
4. Assinatura CRX3 com a mesma identidade RSA, auditoria final e autorização explícita de publicação.

Nenhum segredo RSA/Ed25519, endpoint comercial ou licença real foi alterado. **Não mesclar/implantar automaticamente.**
