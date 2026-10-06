# ZVM Release Recovery — Stage 3 Current-ZVM Login / Opera Integrity

Date: 2026-10-06
Branch: validation/8.17-r41-recovery-20261006

## Result

STAGE 3 ROOT CAUSE: CLOSED IN CODE / SIGNED DEV 0.8.748 GENERATED
Real authenticated Opera + WhatsApp acceptance: PENDING OWNER BROWSER RETEST
Release as a whole: NOT YET FINAL — Release-profile conversion/gates remain later stages.

## Incident evidence

- Real Opera/WhatsApp showed: "Não foi possível validar esta instalação da extensão" before license validation.
- Production Render R40 traffic around the incident showed V4 refresh traffic but no /extension/v4/session/key or /extension/v4/session/login request from the attempted login.
- Therefore the failure occurred locally before server license authentication.
- Exact DEV 0.8.747 ZIP independently passed source-tree, fingerprint and Ed25519 attestation verification.
- manifest.key derives the institutional DEV ID ckbffcbmanboelbihfkhiahgafnimcho.
- DEV attestation descriptor is bound to the same ID.
- Owner-only dev-2026-01 private key derives the exact expected public key; signing-key mismatch was ruled out.

## Historical regression recovered

V817 / 0.8.612 documented the same real-Opera symptom and intentionally serialized Opera protected-resource verification to ONE worker to avoid concurrent chrome-extension:// read races.

DEV 0.8.747 had regressed that invariant:
- EXTUI_INTEGRITY_OPERA ? 2 workers

Dynamic Opera-simulated harness on exact signed bytes:
- 0.8.747: configuredConcurrency=2, observed maxConcurrentFetches=2
- 0.8.748: configuredConcurrency=1, observed maxConcurrentFetches=1

The current root fix restores the V817 security invariant without relaxing:
- raw byte length;
- SHA-256;
- canonical manifest validation;
- browser-icon allowlist/validation;
- sourceTreeSha256;
- build fingerprint;
- Extension ID;
- Ed25519 DEV attestation;
- server Build Authority or license gates.

## 0.8.748 change budget

Changed versus exact signed DEV 0.8.747: 4 files; added 0; removed 0.

Runtime change:
- app/background/authority/foundation-integrity.js
  - Opera integrity concurrency: 2 -> 1

Expected generated identity changes:
- manifest.json
- app/security/build-identity.json
- app/security/integrity.json

## Signed DEV 0.8.748 identity

- Version/version_name: 0.8.748
- Extension ID: ckbffcbmanboelbihfkhiahgafnimcho
- Build ID: zvm-dev-0.8.748-s3d9be10c5719
- Source Tree SHA-256: 3d9be10c57196d0a47cea97f806ed545511eb986b61e717f7b95dc15369cbc2a
- Build Fingerprint: 42ad27a8933fb61ba35f60c0c758569410810adea22a82707449d3bfbc8f4cd5
- Protected files: 333
- Artifact files: 334
- Signing key ID: dev-2026-01
- Signed at: 2026-10-06T14:32:24.000Z
- Expires at: 2026-10-13T14:32:24.000Z

## Gates

- Historical institutional build-core reproduced exact 0.8.747 source hash/fingerprint/file list before use: PASS
- Institutional artifact verifier on 0.8.748: PASS
- JS/MJS syntax: 293/293 PASS
- JSON parse: 4/4 PASS
- Opera concurrency regression harness: PASS
- Critical integrity under Opera simulation: 27/27 PASS
- Protected runtime tamper: REJECTED — SOURCE_TREE_SHA256_MISMATCH
- Fingerprint tamper: REJECTED — BUILD_FINGERPRINT_MISMATCH
- Ed25519 signature tamper: REJECTED — ATTESTATION_SIGNATURE_INVALID
- Deterministic ZIP A/B: PASS
- ZIP CRC: PASS
- ZIP round-trip: 334/334 byte-identical
- Verifier on exact ZIP extraction: PASS
- Chromium native --pack-extension: PASS
- Temporary CRX/PEM: removed after qualification

## Artifact

ZVM_AUTOMACOES_DEV_0.8.748_OPERA_LOGIN_INTEGRITY_ROOT_FIX_SIGNED.zip
SHA-256: a2171bf04db37f461e780f4abbe7c28770d6f79be133f486738fc0c9a99fb81b
Bytes: 3976760

## Browser qualification boundary

The available Chromium runtime is managed with unpacked extension loading disabled by administrator policy, so real runtime login cannot truthfully be marked PASS in this environment. Native pack passes, and the exact historical Opera race regression is reproduced/fixed dynamically outside Chromium.

## Deployment

- Production Render remains R40; no deploy was performed because the failing login never reached the backend and a server deploy would not address this root cause.
- main remains untouched.
- CWS remains untouched.
