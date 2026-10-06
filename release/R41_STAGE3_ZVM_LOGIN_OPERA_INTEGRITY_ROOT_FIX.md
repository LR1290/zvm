# ZVM Release Recovery — Stage 3 Current ZVM Login / Opera Integrity Root Fix

Date: 2026-10-06
Branch: validation/8.17-r41-recovery-20261006

## Result

STAGE 3: PASS as locally qualified root-fix candidate.
External authenticated Opera acceptance: still required.
Release as a whole: NOT YET FINAL — Stage 4 Release/CWS identity conversion remains.

## User-visible blocker

The current ZVM showed:

"Não foi possível validar esta instalação da extensão."

The message is emitted by the client for EXTENSION_INTEGRITY_* failures.

## Causal chain confirmed

1. `loginKey()` requires `extIntegrityRequire()` before it calls `/extension/v4/session/key`.
2. Render traffic around the observed failure showed no matching V4 key/login request reaching the server.
3. Render had Build Authority active, DEV cohost active, Registry V2 active, and the R40 server healthy.
4. No Render logs contained EXTENSION_ID_NOT_ALLOWED, DEV_BUILD*, BUILD_NOT_ALLOWED, ATTESTATION, SECURITY_CLIENT_INVALID or BUILD_IDENTITY failures in the inspected window.
5. Therefore the observed blocker happens before commercial license validation and before Build Authority receives the login attempt.

## Root cause

DEV 0.8.747 critical integrity verification uses:
- Opera: concurrency = 2
- other Chromium: concurrency 2..4

The integrity verifier reads protected `chrome-extension://` resources in parallel.

A deterministic Opera resource-loader race harness reproduces the failure:
- 0.8.747:
  - configured concurrency: 2
  - concurrent resource collisions: 3
  - result: FAIL
  - error: EXTENSION_INTEGRITY_RESOURCE_MISSING
  - stage: fetch-status
- 0.8.748:
  - configured concurrency: 1
  - concurrent resource collisions: 0
  - result: PASS

## Root fix

Only the Opera critical/full integrity worker concurrency changes:

`EXTUI_INTEGRITY_CONCURRENCY = EXTUI_INTEGRITY_OPERA ? 1 : ...`

Chromium concurrency policy outside Opera remains unchanged.

## Functional delta from 0.8.747

Only four distributed files differ:
- app/background/authority/foundation-integrity.js
- app/security/build-identity.json
- app/security/integrity.json
- manifest.json

The latter three are expected build identity/integrity files.

## Exact 0.8.748 identity

Version/version_name: 0.8.748
Extension ID: ckbffcbmanboelbihfkhiahgafnimcho
Build ID: zvm-dev-0.8.748-s3d9be10c5719
Source tree SHA-256: 3d9be10c57196d0a47cea97f806ed545511eb986b61e717f7b95dc15369cbc2a
Build fingerprint: 42ad27a8933fb61ba35f60c0c758569410810adea22a82707449d3bfbc8f4cd5
Protected files: 333
Artifact files: 334
Signing key ID: dev-2026-01
Signed at: 2026-10-06T14:32:24.000Z
Attestation expires: 2026-10-13T14:32:24.000Z

ZIP SHA-256:
a2171bf04db37f461e780f4abbe7c28770d6f79be133f486738fc0c9a99fb81b

## Gates on exact artifact

- Institutional artifact verifier: PASS
- JS/MJS syntax: 293/293 PASS
- JSON parse: 4/4 PASS
- Normal Opera-simulated integrity: PASS
- Deterministic Opera race reproduction:
  - 0.8.747 FAIL as expected
  - 0.8.748 PASS
- ZIP CRC: PASS
- ZIP deterministic A/B: byte-identical PASS
- ZIP round-trip: 334/334 byte-identical
- Manifest key derives institutional DEV ID exactly: PASS
- protected runtime tamper: REJECTED (SOURCE_TREE_SHA256_MISMATCH)
- advertised fingerprint tamper: REJECTED (BUILD_FINGERPRINT_MISMATCH)
- Ed25519 attestation signature tamper: REJECTED (ATTESTATION_SIGNATURE_INVALID)
- Chromium 144 native --pack-extension: PASS / exit 0

## Unrelated regression-suite note

An older broad CRM regression tool bundled with the recovered canonical build tooling reports pre-existing expectation drift unrelated to this four-file Stage 3 delta. It is not used to qualify this login root fix and must be handled by the later full Release gate rather than silently ignored.

## Render / deployment boundary

Render production was inspected but NOT changed in Stage 3.
No server deploy was necessary because the blocked login does not reach the V4 login/key route.
No production DB mutation.
No CWS publication.
No main merge.

## Next

Stage 4: convert the locally-qualified line from signed DEV semantics to the intended Release/CWS identity and registry contract, then run the full Release gates.
