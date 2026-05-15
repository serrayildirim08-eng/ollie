# Auth — Re-Audit (2026-05-14)

> **Note for Serra:** Documents path TCC-sandboxed. File at `audits/AUDIT_auth.md`. Previous audit 2026-05-11 flagged critical C1 (passphrase sent to Supabase). **Now fully remediated.**

**Status: CRITICAL FIX DEPLOYED — Pattern A now shipping.**

---

## TL;DR (100 words)

Pattern A correctly implemented and tested. Passphrase derives AES-GCM-256 key locally; random 32-byte serverPassword generated at signup + encrypted under derived key; salt + encrypted server password persisted in localStorage + `profiles` table (RLS-gated). Sign-in decrypts locally first (detecting wrong passphrase WITHOUT contacting Supabase), then uses decrypted server password to authenticate. Assertion test verifies passphrase never reaches any Supabase call. All 26 tests (auth 8 + passphrase-on-device 3 + crypto 15) passing. Apple Sign-In NOT STARTED (App Store blocker if other social logins ship). Account deletion LOCAL-ONLY (orphans server row). Magic link rejected by design. Multi-device requires backup import (v2 will use profiles table).

---

## Pattern A — Pass/Fail

| # | Check | Status | Evidence |
|---|---|---|---|
| 1 | Passphrase never sent to Supabase signUp | ✅ FIXED | `index.ts:259` sends only random serverPassword; test `passphrase-on-device.test.ts:124-135` |
| 2 | Passphrase never sent to Supabase signIn | ✅ FIXED | `index.ts:344-357` derives key locally, decrypts server pw locally, then signs in with decrypted value; test `passphrase-on-device.test.ts:137-152` |
| 3 | Wrong passphrase short-circuits before Supabase | ✅ FIXED | AES-GCM decrypt fails locally; no Supabase call; test `passphrase-on-device.test.ts:154-175` |
| 4 | PBKDF2 100k + AES-GCM-256 + 16-byte salt + 12-byte IV | ✅ | `packages/crypto/src/index.ts:25-28, 109-113` |
| 5 | Key non-extractable + in-memory only | ✅ | `extractable: false` (crypto.ts:113); `inMemoryKey` nulled on signOut |

---

## Features

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Email + passphrase signUp/signIn | WORKING | Pattern A fully implemented |
| 2 | Apple Sign-In | NOT STARTED | App Store blocker IF other social logins added |
| 3 | Google Sign-In | NOT STARTED | Out of scope per B2B passphrase-first model |
| 4 | Passwordless / magic link | REJECTED (by design) | Pattern A trade-off; documented `index.ts:36-40` |
| 5 | Account deletion | LOCAL-ONLY | No server endpoint; Supabase row orphaned. **Pre-launch blocker for GDPR.** |
| 6 | Multi-device support | PARTIAL | Profile table uploads salt+enc; signIn doesn't fetch from remote; backup import is interim |
| 7 | Session refresh + logout | WORKING | refresh exposed; no automatic 401 retry middleware |
| 8 | Assertion tests | PASSING | 3 deep-inspection tests; load-bearing |

---

## Storage keys

```
shared.auth.session                          → { user_id, email, access_token, refresh_token, signed_in_at }
shared.auth.salt                             → base64 (latest)
shared.auth.salt_by_email.<email>            → base64 (per-email)
shared.auth.encrypted_server_pw              → JSON { iv, ct } base64
shared.auth.encrypted_server_pw_by_email.<email>
shared.auth.email_for_login                  → email
```

In-memory only: `inMemoryKey: CryptoKey | null`.

---

## Test coverage (26 tests passing)

- **auth.test.ts** (8): signUp/signIn happy paths, validation, server-pw assertion, wrong-passphrase short-circuit, no-device-data
- **passphrase-on-device.test.ts** (3): signUp + signIn passphrase-never-leaks assertions, wrong-passphrase no-Supabase-call
- **crypto.test.ts** (15): AES-GCM round-trips, wrong passphrase, tampered ciphertext/IV, randomness, strength scoring

---

## Pre-launch gaps

| Item | Priority | Effort |
|---|---|---|
| `deleteAccount()` server endpoint | P1 (GDPR) | Half-day |
| Multi-device fetch from profiles | P2 (v2 UX) | 1-2 days |
| Auto token refresh on 401 | P2 | 1 day |
| Apple Sign-In | P1 if social adds | 2-3 days |

---

## Delta from 2026-05-11 audit

**C1 Critical (passphrase → Supabase):** ✅ REMEDIATED  
**C2 Critical (auth not imported by apps):** NOT RE-AUDITED in this scope (auth code itself sound)

Test file renamed `zero-knowledge.test.ts` → `passphrase-on-device.test.ts` per B2B pivot terminology.

---

## Top 3 next steps

1. Implement `deleteAccount()` server endpoint + cascade (GDPR-critical pre-launch)
2. Wire multi-device sign-in fetch from `profiles` table (existing helper `fetchProfileFromSupabase` is unused)
3. Add 401-retry middleware in API client for transparent token refresh

## BLOCKED-EXTERNAL
- Apple Sign-In requires Apple Developer + iOS bundle config (only if other social auth added)

*Re-audit by Claude (Opus 4.7), 2026-05-14.*
