# ZVM Privacy Minimization 0.8.749 — Stage 1

Date: 2026-10-06

## Goal

Reduce Chrome Web Store disclosure/permission surface by changing the product itself instead of writing broader justifications.

## Policy direction

ZVM does not use behavioral analytics as a product purpose.

Current privacy disclosure now states:
- no behavioral telemetry/analytics for UI usage
- no advertising tracking
- no browsing-history collection
- no WhatsApp message content in server operational/security logs
- account/license/security processing only where needed
- third-party integrations only when explicitly enabled by the user
- local-first storage for CRM, flows, library, notes and preferences
- explicit Limited Use statement for Google/Chrome Web Store policy

The public policy wording was updated in server.js on this branch.

## 0.8.749 manifest candidate — Stage 1 CORRECTED AFTER LIBRARY RECOVERY

The official Google OAuth configuration already existed and was recovered from the user's Library.

RELEASE/CWS profile:
- version -> 0.8.749
- KEEP named permission: identity
- KEEP Google Drive access only for the explicit Backup-to-Drive feature
- add oauth2.client_id: 761881043178-1gibo5ci5op3meqdsp0gsb8cq4gj85h6.apps.googleusercontent.com
- add oauth2.scopes: https://www.googleapis.com/auth/drive.file
- OAuth client is bound to CWS Extension/Item ID bdhnikgcdccjabkmbfcakgjkkgdlmgja
- no client_secret is embedded in the extension

DEV profile:
- DEV Extension ID remains ckbffcbmanboelbihfkhiahgafnimcho
- MUST NOT reuse the CWS OAuth client
- Google Drive stays fail-closed in DEV until a DEV-specific Chrome Extension OAuth client exists

Remaining named permissions:
- storage
- unlimitedStorage
- power
- alarms
- downloads
- scripting
- offscreen

Remaining required host permissions at this checkpoint:
- https://web.whatsapp.com/*
- https://zvm.onrender.com/*
- https://api.openai.com/*
- https://generativelanguage.googleapis.com/*
- https://api.x.ai/*
- https://graph.facebook.com/*
- https://viacep.com.br/*
- https://servicodados.ibge.gov.br/*

Existing optional host scope remains:
- https://*/*

## Why identity stays in RELEASE

The recovered Google Cloud configuration proves that the RELEASE/CWS item already has a real Chrome Extension OAuth client for Google Drive.

Recovered evidence:
- project: zvm-automacoes
- OAuth client type: Chrome Extension
- OAuth client name: ZVM - Automacoes BETA
- bound CWS Item/Extension ID: bdhnikgcdccjabkmbfcakgjkkgdlmgja
- scope: https://www.googleapis.com/auth/drive.file
- client ID: 761881043178-1gibo5ci5op3meqdsp0gsb8cq4gj85h6.apps.googleusercontent.com
- no client secret is required/embedded

The actual defect was pipeline drift: later CWS artifacts kept the identity permission and Drive code but omitted the oauth2 manifest block. Stage 2 must repair that packaging path rather than remove identity.

## CWS disclosure categories still expected after Stage 1

Keep:
- Personal identification
- Authentication information
- Personal communications
- Location (server handles IP for licensing/security)
- Website content

Do not declare:
- Health
- Financial/payment information
- Web history
- User activity

This is based on actual handling, not an attempt to minimize declarations artificially.

## Next

Stage 2 will move provider/API hosts that are truly optional behind runtime permission requests, while preserving required WhatsApp/ZVM access and not breaking configured integrations.
