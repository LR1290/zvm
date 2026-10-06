# ZVM 0.8.749 — Privacy + Official Google OAuth Final Qualification

Date: 2026-10-06

## DEV artifact

File: ZVM_AUTOMACOES_DEV_0.8.749_FINAL.zip
Version: 0.8.749
Extension ID: ckbffcbmanboelbihfkhiahgafnimcho
Build ID: zvm-dev-0.8.749-s7879bafe3cda
Source tree SHA-256: 7879bafe3cda147c76c8b76dc164bd2b764fc095de59d7fe9770c17fca654990
Build fingerprint: 014fb1d7820894856b178a7839ae5122f3afe62231a962d7d86cf3f24e5b1326
ZIP SHA-256: 14efbe86f7d77ae105411ef8b422be2b529b752be108dfbe96229bb0d6ad3c4f
Protected files: 333
Artifact files: 334
Signed DEV attestation: Ed25519 / dev-2026-01
Attestation expires: 2026-10-13T17:00:00.000Z
Google Drive: fail-closed in DEV because the CWS OAuth client must not be reused for the DEV Extension ID.

## RELEASE artifact

File: ZVM_AUTOMACOES_RELEASE_0.8.749_CWS_FINAL.zip
Version: 0.8.749
Extension ID target: bdhnikgcdccjabkmbfcakgjkkgdlmgja
Build ID: zvm-production-0.8.749-s7879bafe3cda
Source tree SHA-256: 7879bafe3cda147c76c8b76dc164bd2b764fc095de59d7fe9770c17fca654990
Build fingerprint: 25469c0c715052fd54cbc81a965d9816a56a1cf1eaab5384d2e19b7a64dc83c3
ZIP SHA-256: 327dc9495f5fe8683d7ec014e7408408b4ee2000e5579dc3c46b1de330800465
Protected files: 333
Artifact files: 334

OAuth:
- permission: identity
- client ID: 761881043178-1gibo5ci5op3meqdsp0gsb8cq4gj85h6.apps.googleusercontent.com
- scope: https://www.googleapis.com/auth/drive.file
- client secret embedded: NO
- manifest.key in CWS upload ZIP: NO
- DEV attestation in CWS upload ZIP: NO

## Artifact gates

- DEV institutional verifier: PASS
- RELEASE critical runtime integrity under CWS ID: PASS / 27 critical files
- RELEASE full runtime integrity under CWS ID: PASS / 333/333
- RELEASE Google Drive configuration: available=true
- DEV Google Drive configuration: fail-closed as expected
- JS/MJS syntax: 293/293 DEV and 293/293 RELEASE
- JSON parse: 4/4 DEV and 4/4 RELEASE
- Manifest local references: 183/183
- HTML relative references: 90/90
- first-party release AST minification: 289/289
- secret/private-key scan: PASS
- OAuth client tamper: rejected by fingerprint
- protected JS tamper: rejected
- DEV protected-file tamper: rejected by institutional verifier
- CWS-managed manifest.key + trusted update_url semantic allowance: PASS
- deterministic ZIP A/B: PASS for DEV and RELEASE
- ZIP CRC: PASS
- Chromium native pack: DEV exit 0 / RELEASE exit 0

## Backend / privacy

R43 runtime identity:
2026-10-06-privacy-oauth-release-r43

Registry V2 exact production entry:
- zvm-production-0.8.749-s7879bafe3cda
- fingerprint 25469c0c715052fd54cbc81a965d9816a56a1cf1eaab5384d2e19b7a64dc83c3
- CWS ID bdhnikgcdccjabkmbfcakgjkkgdlmgja
- status active

Privacy policy:
- explicitly no behavioral telemetry
- no advertising tracking
- no browsing-history collection
- local-first CRM/flows/library/notes/preferences
- account/license/security processing disclosed
- third-party integrations disclosed as user-initiated
- operational/security log retention tied to LOG_RETENTION_DAYS (default 90 days)

Combined server regression gate: 39/39 PASS.

## Chrome Web Store privacy form

Because identity is legitimately required for Google Drive backup, the CWS identity justification should be completed rather than removed:

"Usada exclusivamente para autenticar o usuário no Google Drive quando ele ativa o backup no Drive, por meio da API chrome.identity. A ZVM utiliza somente o escopo drive.file para criar, ler, atualizar e excluir arquivos criados ou selecionados pela própria ZVM."

Recommended data declarations remain:
- Personal identification: YES
- Authentication information: YES
- Personal communications: YES
- Location: YES (IP for licensing/security)
- Website content: YES
- Health: NO
- Financial/payment information: NO
- Web history: NO
- User activity: NO
