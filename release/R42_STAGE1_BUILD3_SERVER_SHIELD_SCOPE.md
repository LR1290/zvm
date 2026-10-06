# ZVM Build 3 Legacy Freeze — R42 Server-Shield Stage 1

Date: 2026-10-06
Base main: 772b9b605792192dd4bde73f1fa20bac5c17c56d

## Product decision

ZVM - Build 3 / 0.2.7 is now treated as a frozen obsolete legacy client.
No client rollout/update is assumed or required for the server-shield work.

## Exact frozen client recovered

Artifact: ZVM - Build 3(2).zip
SHA-256: 0a5ee8280bbfa71396fdde22dcdff26b8c87b3f1ab9982648891f96a0284dc39
Manifest version/version_name: 0.2.7 / 0.2.7

## Hardcoded request cadence proved from exact client bytes

The legacy service worker contains:
- POST /extension/v3/check-status every 30,000 ms
- refreshPremium() every 300,000 ms
- refreshPremium() ultimately reuses the V3 login/key path

The client does NOT consume:
- Retry-After
- nextCheck / polling interval from response JSON
- a remotely configurable check-status timer

Therefore a server-only change cannot stop the already-installed 0.2.7 client from opening HTTP requests at those hardcoded intervals.

## What CAN be solved server-side

R42 can neutralize backend cost without a client update:

1. Legacy check-status shield
   - bounded in-memory result cache/coalescing by sanitized legacy identity
   - state-signature invalidation so block/expiry/plan/module changes remain visible
   - no Mongo read/write on cache hits
   - no per-request business log writes
   - bounded TTL/LRU and explicit counters

2. Legacy /v3/key relogin-heartbeat shield
   - detect repeated successful same key/phone/origin/IP relogin while state signature is unchanged
   - return authoritative cached auth payload
   - skip claimPhoneSlotAtomic, activation upsert, deviceHistory churn, saveKey and relogin log on shield hits
   - invalidate immediately when key/phone/access state changes

3. Preserve safety
   - first request/miss follows current full path
   - inactive/expired/not-found/phone-removed states never use a stale positive result after signature change
   - V4/CWS/DEV routes untouched
   - Build Authority untouched
   - all five legacy V3 compatibility endpoints remain available

4. Observability
   - shield hit/miss/bypass counters
   - estimated Mongo writes avoided
   - response-cache hit ratio
   - raw HTTP request count kept separate, because server cannot reduce the frozen client's network request frequency

## Current R41 hot-path observation

- /v3/check-status currently parses body, rate-limits, resolves the key and computes entitlement on every request.
- Valid loaded keys are normally served from memory, so Mongo cost is already limited, but HTTP/JSON/rate-limit/traffic bookkeeping is still repeated.
- /v3/key is more expensive: successful relogins can touch activation/device metadata, logging and saveKey persistence.
- HTTP traffic accounting itself is in-memory bucketed and is not the primary database cost.

## Final official artifacts reverified

DEV:
- ZVM_AUTOMACOES_DEV_0.8.748_SIGNED_FINAL.zip
- SHA-256 a2171bf04db37f461e780f4abbe7c28770d6f79be133f486738fc0c9a99fb81b
- ZIP test PASS

RELEASE:
- ZVM_AUTOMACOES_RELEASE_0.8.748_CWS_FINAL.zip
- SHA-256 14fb327cbcc2b7cedaed9ee7df2510715769afca6ca6e3ba498ed06769813377
- ZIP test PASS

Intermediate 0.8.748 artifacts without FINAL in their names are historical checkpoints only and must not be used for testing/publication.

## Next stage

Implement the R42 legacy shield on this branch, with no client changes and no main/Render mutation until focused tests pass.
