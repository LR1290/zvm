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

## 0.8.749 manifest candidate — Stage 1

From qualified DEV 0.8.748:
- version -> 0.8.749
- removed named permission: identity
- removed required host: https://www.googleapis.com/*
- oauth2 remains absent
- Google Drive remains unavailable in this line until official OAuth is configured

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

## Why identity is removed

The 0.8.748 code contains a Google Drive authority that requires:
- chrome.identity
- manifest.oauth2.client_id
- drive.file scope

But 0.8.748 has no oauth2 block. The feature therefore reports OAuth not configured and cannot legitimately justify identity in this build.

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
