# Tech Lead Code Review — HH4ME

Date: 2026-08-04
Scope: production backend (`backend/*.js`) + `Dockerfile`
Mode: custom review as Tech Lead.

## Verdict: REQUEST CHANGES

The backend is architecturally sound (rate limiting, parameterized queries,
YooKassa re-fetch verification, LLM retry/backoff intent), but two external-facing
security defects are BLOCKER severity and several MAJOR reliability issues
remain. The top fixes are localized, not redesigns.

## BLOCKER

### 1. Prompt injection via unsanitized interpolation (backend/matcher.js)
`backend/matcher.js:189, 246-249, 299-303` — `cvText` (user CV) and `description`
(third-party job listing text) are interpolated raw into LLM user messages. A
crafted CV, or an attacker-controlled job listing, can inject instructions that
steer the role ID, inflate/depress match scores, or exfiltrate data through the
LLM output channel. OWASP LLM Top 10. Mitigation: wrap user data in delimiters
and instruct the model to treat tag contents as untrusted data.

### 2. YooKassa webhook accepts POSTs from any source (backend/server.js:1030)
The webhook responds 200 and processes the event, verifying only by re-fetching
the payment from YooKassa (good integrity control) but with **no source
verification**. It accepts a forged/`POST`ed payload referencing any succeeded
payment. YooKassa's current docs recommend verifying authenticity by status
re-check **and** source-IP allowlist against the documented ranges:
`185.71.76.0/27, 185.71.77.0/27, 77.75.153.0/25, 77.75.156.11, 77.75.156.35,
77.75.154.128/25, 2a02:5180::/32`. The re-fetch blocks payload-only forgery; IP
allowlisting closes the "anyone can POST" gap. (Note: current YooKassa
HTTP-notification docs do NOT document a `SecretSignature` HMAC header; the
recommended checks are status + IP.)

## MAJOR

- **GigaChat TLS verification disabled globally** — `backend/matcher.js:31,96`
  (`new https.Agent({ rejectUnauthorized: false })`, incl. the OAuth call).
  Exposes token creds and CV/PII to MITM. Use a CA bundle or env-gated default.
- **LLM retry only fires on 429** — `backend/matcher.js:127-154`. Non-429 errors
  break after one attempt; non-200 returns `''` immediately. Contradicts the
  intended exponential backoff.
- **`limitConcurrency` closure leak** — `backend/scrapers/helpers.js:72-92`.
  `clean` captures loop var `p` by reference; after `Promise.race` it may delete
  the wrong entry, stalling the Set on long scans.
- **Regex `?`→`$n` SQL conversion** — `backend/db.js:132-143`. Naive
  `replace(/\?/g)` breaks on `?` inside string literals / LIKE patterns.
- **Password reset token reusable in expiry window** — `backend/server.js:246`
  deliberately keeps the token to allow reuse; should be one-time use.

## MINOR

- **Per-request `fs.readFileSync(roles)`** — `backend/server.js:506-507, 605-606,
  295-296`. Blocks the event loop; cache at load.
- **Duplicate welcome email** — `backend/server.js:942-945` (billing/status GET)
  and `:1094-1097` (webhook) both send it; add idempotency.
- **No timeout on YooKassa API calls** — `backend/yookassa.js:36-40`.
- **Unescaped HTML in email templates** — `backend/notifications.js:70-72`.

## NIT

- **`analyzeCv` length mismatch 500/600/700** — `backend/matcher.js:312,325,338`.
- **Cover letter limit advisory-only** — `backend/matcher.js:291` (no hard cap).
- **Hardcoded dev DB URL fallback** — `backend/config.js:6`.
- **JWT error logs raw message** — `backend/auth.js:71-73`.

## Resolution status

- BLOCKER 1 (prompt injection): fixed (delimiter fencing).
- BLOCKER 2 (webhook source verification): fixed (YooKassa IP allowlist).
