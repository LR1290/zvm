# ZVM Release Recovery — Stage 4 DEV + RELEASE Identity Split

Date: 2026-10-06
Branch: validation/8.17-r41-recovery-20261006

## Result

STAGE 4: PASS for identity separation and authorization staging.

Important: the RELEASE artifact generated in this stage is an identity-qualified production candidate, NOT the final CWS artifact yet. It still carries the readable DEV code body. Stage 5 must apply/qualify the release transformation/minification policy before the final production fingerprint is frozen and deployed.

## DEV preserved

File: ZVM_AUTOMACOES_DEV_0.8.748_SIGNED_FINAL.zip
Version: 0.8.748
Channel/profile: dev/dev
Extension ID: ckbffcbmanboelbihfkhiahgafnimcho
Build ID: zvm-dev-0.8.748-s3d9be10c5719
Source tree SHA-256: 3d9be10c57196d0a47cea97f806ed545511eb986b61e717f7b95dc15369cbc2a
Build fingerprint: 42ad27a8933fb61ba35f60c0c758569410810adea22a82707449d3bfbc8f4cd5
ZIP SHA-256: a2171bf04db37f461e780f4abbe7c28770d6f79be133f486738fc0c9a99fb81b
DEV attestation: present / Ed25519 / dev-2026-01
Manifest key: present and derives the institutional DEV ID.

## RELEASE production identity candidate

File: ZVM_AUTOMACOES_RELEASE_0.8.748_CWS.zip
Version: 0.8.748
Manifest name: ZVM - Automações
Channel/profile: production/release
Target CWS item ID: bdhnikgcdccjabkmbfcakgjkkgdlmgja
Build ID: zvm-production-0.8.748-s19ed39fbb148
Source tree SHA-256: 19ed39fbb148cf134c706a499c89d8429b53ce8faf42cc7212ee71c97d09346c
Build fingerprint: 3e01bbedce52b323bffb0f08b3385371a899285b8576427c322a64bfc96ef72b
ZIP SHA-256: 4cdbb5c28003ef7da5e7e54e52a6be349f80c7391c0f3e483a5a52951bb0a7ee
Manifest key: intentionally absent from the upload ZIP.
DEV attestation: absent by contract.

## Pair invariants

DEV vs RELEASE functional code diff:
- manifest.json
- app/security/build-identity.json
- app/security/integrity.json

Unexpected functional-code differences: 0.

This proves that the Opera login root fix and all other runtime code are identical between the two candidates; only packaging/security identity differs.

## RELEASE local gates

- Runtime identity production/release: PASS
- CWS runtime-ID simulation using bdhnikgcdccjabkmbfcakgjkkgdlmgja: PASS
- Critical integrity: PASS
- Full integrity: 333/333 protected files PASS
- devAttestation absent: PASS
- manifest.key absent: PASS
- ZIP entries: 334
- ZIP CRC: PASS
- deterministic ZIP A/B: byte-identical PASS
- Chromium native --pack-extension: PASS
- Build Authority source supports production/release Registry V2 entries: PASS

## Registry V2 staging

The recovery branch currently contains a staged active production entry for the identity candidate:
- zvm-production-0.8.748-s19ed39fbb148
- fingerprint 3e01bbedce52b323bffb0f08b3385371a899285b8576427c322a64bfc96ef72b
- CWS ID bdhnikgcdccjabkmbfcakgjkkgdlmgja

This entry is NOT deployed because the branch has not been merged to main and Render has not been redeployed.

Stage 5 MUST replace this candidate entry if release transformation changes source/fingerprint before any merge/deploy.

## Release transformation boundary

The recovered 0.8.748 data contains no persisted transformed CWS artifact. Historical CWS/BETA policy used release transformation/minification. Therefore Stage 4 does not falsely label the readable production-identity candidate as final CWS release.

## Deployment boundary

- main: unchanged
- Render production: unchanged
- CWS: unchanged
- MongoDB: unchanged

Next: Stage 5 applies/qualifies the release transformation policy, freezes the final production fingerprint, replaces the staged Registry V2 identity if necessary, and runs the full Release gates.
