# ZVM Release Recovery — Stage 6 Production Deploy / Launch Handoff

Date: 2026-10-06

## Production GitHub promotion

- Previous main: bf45515cccf439a76f25768760cff7f912b8d84f
- Promoted main: 772b9b605792192dd4bde73f1fa20bac5c17c56d
- Method: fast-forward with expected-SHA lease
- Branch state before promotion: 19 commits ahead / 0 behind
- Changed paths: 14
- No force push

## Render production deploy

- Service: zvm / srv-d8co50mq1p3s7390p80g
- Branch: main
- Auto deploy: disabled
- Deploy triggered manually via API
- Deploy ID: dep-db2h8060tbcc7398d740
- Commit: 772b9b605792192dd4bde73f1fa20bac5c17c56d
- Build: succeeded
- Deploy: live / succeeded
- Finished: 2026-10-06T15:31:08.990664Z
- Health check path: /ready
- Post-deploy error logs: 0
- Post-deploy server_failed/restart events: 0

## Production boot evidence

- Server build: 2026-10-06-build3-entitlement-reconcile-r41
- MongoDB: connected
- Runtime: production
- Build Authority: active
- DEV bypass: inactive
- DEV cohost: active
- Legacy V3: active
- Legacy Build 3 endpoints active:
  - /extension/v3/key
  - /extension/v3/check-status
  - /extension/v3/usage
  - /extension/v3/get-usage
  - /extension/v3/sync-usage
- Render service transitioned to live using configured /ready health check.

## Registry V2

File registry:
- 11 entries total
- 10 status=active
- 1 status=revoked

Production 0.8.748 exact entry:
- buildId: zvm-production-0.8.748-s3d9be10c5719
- fingerprint: bf889fe0fb00f761d68ca4422f638e06938ddd3de305434742fc793a5ffb9237
- sourceTreeSha256: 3d9be10c57196d0a47cea97f806ed545511eb986b61e717f7b95dc15369cbc2a
- extensionId: bdhnikgcdccjabkmbfcakgjkkgdlmgja
- status: active

Boot reports Registry V2 active=11 while the file has 10 active records. The authority supports environment JSON overlay; this indicates an additional active environment-backed registry record is loaded in production. It does not prevent the production 0.8.748 file entry from being loaded.

## Final browser artifacts

DEV:
- ZVM_AUTOMACOES_DEV_0.8.748_SIGNED_FINAL.zip
- SHA-256 a2171bf04db37f461e780f4abbe7c28770d6f79be133f486738fc0c9a99fb81b

RELEASE:
- ZVM_AUTOMACOES_RELEASE_0.8.748_CWS_FINAL.zip
- SHA-256 14fb327cbcc2b7cedaed9ee7df2510715769afca6ca6e3ba498ed06769813377

Build 3:
- ZVM_BUILD_3_V0210_PLAN_USAGE_RELEASE_CANDIDATE.zip
- SHA-256 9020e35be3a755958d5dc6129e8c71911f060b2a48ffecf6440d60c27e611809

## Request-storm telemetry status

The code fix is complete in Build 3 v0.2.10:
- periodic check-status cadence reduced to 5 minutes
- periodic refreshPremium -> login -> /v3/key heartbeat removed
- v0.2.9/v0.2.10 retain the anti-storm behavior
- R41 server compatibility for all five V3 endpoints is live

The previously observed production baseline was 987 POST /extension/v3/check-status and 97 POST /extension/v3/key in one 15-minute window.

A real post-rollout reduction cannot be asserted until actual Build 3 installations run v0.2.10. Deploying R41 server alone does not change the request cadence of old v0.2.7 clients. No completed v0.2.10 client-production observation window existed during this Stage 6 execution.

## Boundary

- GitHub main: promoted
- Render R41: deployed/live
- MongoDB schema/data: no intentional mutation
- Chrome Web Store: NOT published by Stage 6
- Final external acceptance still required:
  1. real Opera authenticated smoke with DEV 0.8.748
  2. actual CWS installation smoke after RELEASE upload
  3. Build 3 v0.2.10 rollout followed by production traffic comparison
