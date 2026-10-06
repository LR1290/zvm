# ZVM R41 Recovery — Stage 1 Chromium Diagnostic

Date: 2026-10-06
Branch: validation/8.17-r41-recovery-20261006
Scope: compare Build 3 v0.2.8 known-good baseline vs v0.2.9 entitlement-reconcile candidate in the exact same Chromium automation harness.

## Result

STATUS: HARNESS_LIMITATION CONFIRMED / NO V0.2.9-SPECIFIC REGRESSION OBSERVED

- Chromium runtime: 144.0.7559.96 (Debian Chromium).
- Native Chromium pack-extension for v0.2.9: PASS from previous gate.
- Headless remote-debugging comparison:
  - v0.2.8: only about:blank page target; no extension service-worker target.
  - v0.2.9: only about:blank page target; no extension service-worker target.
- Fresh profile Preferences comparison:
  - v0.2.8: only built-in Web Store + PDF Viewer entries.
  - v0.2.9: only built-in Web Store + PDF Viewer entries.
- stderr comparison: only environment DBus/UPower warnings; no manifest/service-worker/extension-load error unique to v0.2.9.
- GUI/Xvfb remote-debugging attempt did not expose a debuggable page target for either version and therefore cannot be used as a runtime acceptance gate in this environment.

## Interpretation

The missing service-worker target is not evidence of a v0.2.9 regression because the exact v0.2.8 baseline behaves identically in the same harness. This environment cannot truthfully qualify real unpacked-extension runtime behavior via this launch path.

## Gate policy

- Do NOT mark real-browser runtime smoke PASS from this harness.
- Keep v0.2.9 as locally-qualified candidate only until a representative browser load is available.
- Continue with static/runtime-contract, ZIP, identity, server R41, and package reproducibility gates separately.
