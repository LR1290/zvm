# ZVM Release Recovery — Stage 5 Final Release Qualification

Date: 2026-10-06
Branch: validation/8.17-r41-recovery-20261006

## Status

STAGE 5: PASS — final transformed RELEASE artifact locally qualified.

DEV remains unchanged. Main, Render, CWS and MongoDB remain unchanged by Stage 5.

## Final DEV

- Version: 0.8.748
- Build ID: zvm-dev-0.8.748-s3d9be10c5719
- Source Tree SHA-256: 3d9be10c57196d0a47cea97f806ed545511eb986b61e717f7b95dc15369cbc2a
- Build Fingerprint: 42ad27a8933fb61ba35f60c0c758569410810adea22a82707449d3bfbc8f4cd5
- ZIP SHA-256: a2171bf04db37f461e780f4abbe7c28770d6f79be133f486738fc0c9a99fb81b
- DEV Extension ID: ckbffcbmanboelbihfkhiahgafnimcho
- Ed25519 DEV attestation: present

## Final RELEASE

- Version: 0.8.748
- Name: ZVM - Automações
- Channel/profile: production/release
- Target CWS Extension ID: bdhnikgcdccjabkmbfcakgjkkgdlmgja
- Build ID: zvm-production-0.8.748-s3d9be10c5719
- Source Tree SHA-256: 3d9be10c57196d0a47cea97f806ed545511eb986b61e717f7b95dc15369cbc2a
- Build Fingerprint: bf889fe0fb00f761d68ca4422f638e06938ddd3de305434742fc793a5ffb9237
- Protected files: 333
- Artifact files: 334
- ZIP SHA-256: 14fb327cbcc2b7cedaed9ee7df2510715769afca6ca6e3ba498ed06769813377
- manifest.key in upload ZIP: absent
- DEV attestation: absent

## Release transformation

Historical deterministic release minifier recovered from V746 source/tooling.

- first-party JS/MJS: 289
- ast-trivia-minify-v1: 289/289
- AST equivalence DEV -> RELEASE: 289/289 PASS
- first-party readable copy-through: 0
- vendor JS/MJS byte-preserved: 4/4
- input bytes: 7,383,038
- output bytes: 6,767,723
- reduction: 615,315 bytes / 8.3342%
- no aggressive control-flow/string-array/self-defending obfuscation added

## Manifest canonicalization root fix during Stage 5

A V746-era integrity generator was initially incompatible with the current 0.8.748 runtime manifest canonicalization because numeric-like object keys were serialized differently.

The issue was caught by runtime integrity as manifest-sha256 failure.

Final fix:
- release minification keeps the recovered historical minifier;
- identity and integrity generation use the CURRENT 0.8.748 zvm-build-core.mjs;
- critical and full runtime integrity both pass with the final fingerprint.

## Gates

- JS/MJS syntax: 293/293 PASS
- JSON: 4/4 PASS
- manifest local refs: 0 missing
- HTML local refs: 90 / 0 missing
- CSS url refs: 19 / 0 missing
- eval: 0
- new Function: 0
- document.write: 0
- debugger: 0
- remote executable imports/scripts: 0
- source maps: 0
- private-key PEM markers: 0
- release private key/pem files: 0
- CWS-ID critical integrity: PASS / 27 critical files
- CWS-ID full integrity: PASS / 333/333
- Opera race final RELEASE: concurrency=1, collisions=0, PASS
- browser-managed manifest.key semantic allowance: PASS
- trusted update_url semantic allowance: PASS
- untrusted update_url: REJECTED
- unknown manifest field: REJECTED
- CSP tamper: REJECTED
- protected JS tamper: REJECTED
- fingerprint tamper: REJECTED
- deterministic ZIP A/B: PASS
- ZIP CRC: PASS
- ZIP round-trip: 334/334 byte-identical
- Chromium 144 --pack-extension: PASS / exit 0

## Current semantic regression gate

11/11 PASS, covering:
- centralized CRM/Disparos avatar service
- Pets 2.2.0 state-owned clips
- Theme v13 authority + migration
- Exportar Contatos idempotence
- CRM Analysis vertical scroll
- no --zvm-* vars
- no legacy design-system IDs
- no Product Studio/section-owned !important
- current explicit host/accessibility override baseline

## Legacy suite triage

Recovered broad lexical suite: 56/76 PASS, 20 FAIL.

The failures were triaged as stale expectations rather than silently ignored:
- old profile-picture cache assertions predate contactAvatarService
- Pets tests expect 2.1.0; current runtime is 2.2.0
- navigation/sidebar counts predate subsequent approved menu changes
- theme tests expect v12; current authority is v13
- Exportar Contatos idempotence exists but old regex expects obsolete formatting
- compact Biblioteca icon expectations predate later UI sizing changes
- old !important budget predates current host/accessibility overrides; stronger structural zeroes still pass

No product code was regressed merely to satisfy stale lexical tests.

## Registry V2

Final staged production entry:
- zvm-production-0.8.748-s3d9be10c5719
- fingerprint bf889fe0fb00f761d68ca4422f638e06938ddd3de305434742fc793a5ffb9237
- sourceTree 3d9be10c57196d0a47cea97f806ed545511eb986b61e717f7b95dc15369cbc2a
- extension ID bdhnikgcdccjabkmbfcakgjkkgdlmgja
- status active

The provisional Stage 4 entry was removed/replaced.

## Build 3 companion

Build 3 v0.2.10 SHA-256:
9020e35be3a755958d5dc6129e8c71911f060b2a48ffecf6440d60c27e611809

Request-storm fix and PRO/Basic/Free usage matrix remain preserved from Stage 2.

## Next

Stage 6: merge final R41/Registry changes to main, deploy Render, verify startup/ready/Build Authority recognition and Build 3 traffic behavior, then deliver the final launch handoff.
