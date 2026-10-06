# ZVM Release Recovery — Stage 1 Scope Lock

Date: 2026-10-06
Branch: validation/8.17-r41-recovery-20261006

## Release blockers recovered from the interrupted round

1. Legacy ZVM - Build 3 authenticates as PRO but still renders finite usage limits inherited from the legacy `usage-limit` / `usageLimits` path.
2. Current ZVM DEV 0.8.747 still fails login before the user can validate the license, so the build cannot be accepted for Release.
3. This round is now Release-oriented. No production deploy or CWS publication is performed by Stage 1.

## Exact artifacts recovered

- DEV 0.8.747 signed/Chromium-qualified artifact recovered byte-for-byte from Library.
- Build 3 v0.2.8 request-storm-fix artifact recovered byte-for-byte.
- Build 3 v0.2.9 entitlement-reconcile candidate recovered from the interrupted recovery work.
- Server baseline remains R40 on main; R41 recovery changes are isolated on this branch.

## Stage 1 findings

### DEV 0.8.747 identity
- Manifest key derives Extension ID: ckbffcbmanboelbihfkhiahgafnimcho.
- DEV attestation descriptor Extension ID: ckbffcbmanboelbihfkhiahgafnimcho.
- Build ID: zvm-dev-0.8.747-s5e0904418f33.
- Build fingerprint: 82934cceb15a52feaec2524aa225d7797baca02ac62b264b7ef4d87271141e89.
- Manifest key, attestation Extension ID, Build ID and fingerprint are internally consistent.
- Therefore the current login failure is NOT explained by a malformed DEV manifest.key alone. The next stage must trace the server/session authority decision and Release/CWS identity transition.

### Build 3 v0.2.9 candidate
- Version/version_name: 0.2.9.
- Legacy flags still exist because the old UI depends on them: `usage-limit` and `unlimited-usage`.
- Existing 5-minute /extension/v3/check-status cadence is preserved.
- The check-status loop does not call login() or refreshPremium(), so the removed global /key heartbeat is not reintroduced.
- The candidate reconciles server entitlement into the legacy flags:
  - paid => unlimited-usage=true, usage-limit=false
  - Basic/Free => usage-limit=true
- ZIP SHA-256: e3912584d8d86a27b110dcf8c31f491d8a92d3c11e7007c8e74b6c21b48a15b5.

## Gate

STAGE 1: PASS — scope and evidence locked.
Next: Stage 2 must prove the PRO/Basic/Free usage matrix end-to-end against R41 and Build 3 v0.2.9 without changing production.
