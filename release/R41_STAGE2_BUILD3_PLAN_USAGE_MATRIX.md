# ZVM Release Recovery — Stage 2 Build 3 Plan / Usage Matrix

Date: 2026-10-06
Branch: validation/8.17-r41-recovery-20261006

## Result

STAGE 2: PASS
Release as a whole: NOT READY — Stage 3 current-ZVM login blocker remains open.

## Root causes closed in Build 3

1. A stale persisted usage store could continue rendering finite limits (for example 0/20) even after the account had been recognized as PRO.
2. Legacy login classified every non-Free account as premium for feature flags, which could temporarily make Basic unlimited.
3. v0.2.9 corrected entitlement periodically through the existing 5-minute check-status loop, but did not harden the immediate-login path or the dashboard against stale finite max values.

## Build 3 v0.2.10 corrections

- Single paid predicate at login:
  paid = isPremium === true && isBasicPlan !== true && isFreePlan !== true.
- Same predicate retained in the existing 5-minute /extension/v3/check-status reconciliation.
- PRO:
  - unlimited-usage=true
  - usage-limit=false
  - auth isPremium=true
- Basic / Free:
  - unlimited-usage=false
  - usage-limit=true
- Dashboard item cards ignore stale finite max values when auth authority says PRO.
- Dashboard top limits banner rewrites stale paid max values to -1 before deciding whether to render.
- No new timer, endpoint, login heartbeat or refreshPremium heartbeat was added.

## Server R41 matrix

Server blob on recovery branch:
efe1ee20fbed587f16dcf1ef4aa34b4bfd29d3e3

Contract checks: 21/21 PASS.

- FREE auth: isPremium=false / isFreePlan=true.
- Paid auth: isPremium=!isBasicPlan / isFreePlan=false.
- sanitizeKeyRecord removes legacy usageLimits for non-Basic records and rewrites finite paid max values to -1.
- buildUsagePayload returns unlimitedUsagePayload for non-Basic paid keys.
- /v3/usage paid path: unlimited.
- /v3/get-usage paid path: authoritative unlimited payload.
- /v3/sync-usage paid path: unlimited, even when client sends stale finite extensionLimits.
- Basic path continues through normalizeProUsage and retains finite policy.

## Exact client matrix

Client/source checks: 24/24 PASS.
JavaScript syntax: 20/20 PASS.
Relative JS imports: 45/45 PASS.

PRO with deliberately stale max=20:
- paid=true
- unlimited-usage=true
- usage-limit=false
- dashboard card: "0" (not "0 / 20")
- limits banner: hidden
- effective banner max: -1

Basic with max=20:
- paid=false
- unlimited-usage=false
- usage-limit=true
- dashboard card: "0 / 20"
- limits banner: visible

Free with max=20:
- paid=false
- unlimited-usage=false
- usage-limit=true
- dashboard card: "0 / 20"
- limits banner: visible

## Candidate artifact

File: ZVM_BUILD_3_V0210_PLAN_USAGE_RELEASE_CANDIDATE.zip
Version/version_name: 0.2.10
Files: 44
ZIP bytes: 1515777
SHA-256: 9020e35be3a755958d5dc6129e8c71911f060b2a48ffecf6440d60c27e611809
Deterministic ZIP A/B: PASS
ZIP CRC: PASS
ZIP round-trip: 44/44 byte-identical

Delta from v0.2.8: exactly 4 distributed files:
- manifest.json
- static/js/chunk-CnWibQya.js
- static/js/chunk-Dly0ZN-1.js
- static/js/chunk-qHlJTaHn.js

Delta from v0.2.9: exactly 3 distributed files:
- manifest.json
- static/js/chunk-CnWibQya.js
- static/js/chunk-Dly0ZN-1.js

## Deployment boundary

No Render deploy.
No main merge.
No Chrome Web Store publication.
No production database mutation.

Next stage: trace and close the current ZVM login failure from manifest/integrity/attestation through Build Authority and /v4/session/*.
