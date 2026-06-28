# Ollie Defensive Red-Team Security Audit — 2026-06-28

Branch: `redesign/olive-neumorphic` · Method: 14 parallel domain reviewers + adversarial verification of every P0/P1 (44 agents). Read-only. No code changed.

Counts (raw → after refutation): 5 P0 → **1 true live P0 + 1 deploy-gated P0**, 25 P1 → ~14 real (several latent), 3 P1 refuted as false alarms.

---

## 1. Overall Verdict
**Not safe for dogfood yet — but close.** One real live privacy problem (local plaintext + a privacy policy that promises encryption that doesn't exist), one deployment gap (account-deletion code is correct but not deployed anywhere), and a cluster of "fix-before-you-deploy" infra/consent issues. Most scary-sounding findings are in code that **isn't running in production yet** (account-delete + push workers are undeployed) — so this is a "fix before you flip the switch" list, not an "actively bleeding" list.

## 2. Plain English
Ollie's locked doors are mostly solid: nobody can read another user's data through the AI proxy, auth is properly checked, and the database is user-scoped. The two real holes:
1. **The diary is written in pencil, but the label says "vault."** Cycle/medication/mood/finance notes are stored as plain text on the device, while the published privacy policy says they're encrypted with a passphrase. Anyone with access to the device's files (a thief with your unlocked Mac, a backup, a forensic tool) can read them. The bigger problem is the **false promise** — that's a trust/legal issue regardless of how hard the file is to reach.
2. **The "delete my account" button currently deletes nothing in production.** The deletion code was rewritten correctly today, but it lives in a worker (`apps/api`) that isn't deployed. So if a dogfood user asks to be deleted, you can't honor it yet.

## 3. Top realistic abuse paths (ranked)
1. Someone with device/file access reads plaintext health/cycle/medication notes (P0 trust).
2. A staging test run silently corrupts **production** cache + drains prod rate limits + poisons routing vectors (shared CF namespaces).
3. A logged-in user spams `/brain-copy` (no rate limit) and burns Groq money.
4. Sensitive dump text + photos go to Groq/Gemini with no consent gate / no privacy-policy disclosure.
5. If you rotate `USER_HASH_SALT` (your launch token-rotation plan!), account deletion silently deletes 0 rows and reports success.

---

## 20. Attack Scenario Matrix (verified)

| ID | Attacker | Severity (verified) | Status | Evidence | Smallest fix | Blocks |
|----|----------|--------------------|--------|----------|--------------|--------|
| local-plaintext + false-promise | Device/file access | **P0** | confirmed | `apps/native/src/store.ts:61` uses `browserAdapter` = raw `localStorage` (`packages/store/src/adapter.ts:35-61`); `encryptedKv` exists but unused; `marketing/privacy.md:14,97` claims AES-GCM-256 | Either wire `encryptedKv` for sensitive modules, OR correct privacy.md to match reality | dogfood |
| account-delete-undeployed | User requesting erasure | **P0 (deploy-gated)** | confirmed | `apps/api/src/account-delete.ts` covers all 22 tables + Clerk text ids (correct), but `apps/api` worker is **not deployed** (`DEPLOY_TODO.md`) | Deploy the worker + wire a delete entry point; add a deletion-completeness test | dogfood/alpha |
| staging-shares-prod-KV/Vectorize/RateLimit | Anyone running staging | **P1** | confirmed | `workers/ai-proxy/wrangler.toml` staging (l.128-152) reuses prod namespace IDs + `ollie-routing-cache` index | Give staging its own KV/Vectorize/rate-limiter IDs | alpha |
| brain-copy-no-ratelimit | Logged-in user | **P1** | confirmed | `index.ts:394` calls `handleBrainCopy` with no `checkRate()` (contrast l.406-418, 478) | Add `checkRate()` to `/brain-copy` | alpha |
| dump-fragments-to-AI-no-consent | — (privacy) | **P1** | confirmed | `router/dump.ts:410-413` `classifyBatch()` no `hasResearchConsent` gate | Gate AI call on consent OR disclose in policy + default-on notice | alpha |
| images-to-gemini-no-consent | — (privacy) | **P1** | confirmed | `router/dump.ts:241` → `vision.ts:55` POSTs base64 image to Gemini; Gemini not in privacy.md | Add Gemini to privacy.md + consent gate | alpha |
| salt-rotation-silent-delete-fail | Ops (you, at launch) | **P1** | confirmed | `account-delete.ts:310-318` checks salt SET not CORRECT; `:542-574` returns `ok:true,count:0` on 0 matches | Store salt version per user; verify row count or fail loud | alpha |
| workers-deploy-no-test-gate | Regression author | **P1** | confirmed | `deploy-workers.yml` has no `needs:`/`workflow_run` on `ci.yml` — deploys even if tests fail | Gate deploy on CI success | dogfood |
| sync-broken-per-device-salt | Multi-device user | **P1** (data loss, not leak) | confirmed | `packages/auth/src/index.ts:150-163` random per-device salt; `encrypted_state` has no salt column → Device B can't decrypt A | Derive key from passphrase + a synced/account salt, not device-local random | dogfood (sync is must-have) |
| adhd-tag-enum-unvalidated | AI hallucination | **P1** | confirmed | `label.ts:270` only `typeof tag` check, no membership vs 18 values | Validate against enum like the other label fields | beta |
| push-register/send-untrusted-userid | Holder of shared secret | **P1 (latent, undeployed)** | confirmed | `apps/api/src/worker.ts:303-413` accepts `user_id` from body, service_role upsert/dispatch, no ownership check | Derive user_id from verified JWT, not body | (before push deploy) |
| profile-recovery-anon-enumeration | Stranger | **P1 (latent, unused)** | confirmed | `20260519000001_*.sql:93-111` `profile_recovery_lookup` GRANT to anon, no rate limit, returns salt+enc_pw | REVOKE from anon; move behind rate-limited worker | beta |
| profiles-RLS-broken-auth-uid | Auth'd user | **P1 (latent, legacy 0-row)** | confirmed | `20260512000002_profiles.sql:107-126` policies use `auth.uid()` = NULL under Clerk | Drop/repoint legacy table or fix policy to `auth.jwt()->>'sub'` | beta |
| invite-funnel-security-definer | — | **P1 (currently safe)** | confirmed | `20260519000003_*.sql` views default SECURITY DEFINER; fix migration `...0004` marked DRAFT not applied | Apply the security_invoker fix migration | beta |
| identity-migration-applied? | — | **P2 / needs-runtime** | suspected-applied | `...0002_identity_clerk_text.sql:69` "APPLIED BY SERRA"; account-delete rewritten today assumes TEXT ids | Run `SELECT pg_typeof(user_id) FROM encrypted_state LIMIT 1;` to confirm | verify |
| module-enum-bypass | AI hallucination | **P2** | confirmed | `dump-classify.ts:257,288` returns `parsed.module` unvalidated | Validate vs `MODULES` before write | — |
| dump_inbox/grocery_pantry RLS not FORCED | — | **P2** | confirmed | `20260611000001_*.sql:32,55` enable not force; fixed in `...0618000001` | Ensure fix migration applied | — |
| grocery_purchase_history auth.uid cast | — | **P2 (latent)** | confirmed | `20260615000001_*.sql:30` `auth.uid()::text` = NULL under Clerk | Repoint to `auth.jwt()->>'sub'` | — |
| csp-null / devtools / iOS-ATS | Needs prior XSS / device | **P2** | confirmed | `tauri.conf.json:24 csp:null`; `Cargo.toml:21 devtools`; `Info.plist:27-30 ATS` | Set a CSP; gate devtools on debug; tighten ATS | — |
| sync-applyModule-no-validation | Full device+key compromise | **P2** | confirmed | `sync/src/index.ts:340` applies any `row.module` | Validate vs module enum | — |

### Refuted / false alarms
- **Crisis lexicon "PENDING_SERRA_APPROVAL" blocks alpha** → REFUTED (P4). Crisis-line/hotline routing was removed (commit 90349c1); the approval gate was tied to hotline referral. Not a blocker. (A minor real bit remains: no CI check on the field — low priority.)
- **finance record_type unvalidated** → REFUTED (P2). `kind` is never used to set `record_type`; mapping is hardcoded to `'transaction'`.
- **store has no schema validation** → REFUTED (P3). Not a security issue without the in-memory key; AES-GCM auth rejects tampered ciphertext. Robustness polish only.

---

## What is actually fine (don't worry about these)
- **AI proxy auth & cross-user isolation.** Clerk JWT verified with `jose` (signature + exp + issuer). `x-user-id` is dev-only and refused in production. Rate limits keyed on verified JWT `sub`, not spoofable headers. No IDOR via crafted `user_hash` (server-derived). Supabase fallback verifies via `/auth/v1/user`, not local decode.
- **Sync transit/at-rest encryption to Supabase.** `encrypted_state` is AES-GCM ciphertext; KEK held by worker, never in DB. RLS bypass yields ciphertext only.
- **CORS** restricted to localhost + tauri origins.
- **Most RLS** is FORCEd and service_role-scoped on the live paths.

## Fix order (why this order)
1. **Decide the privacy-promise question** (encrypt locally vs. correct the policy) — everything else is mechanical; this is the one judgment call.
2. **Separate staging from prod** in `wrangler.toml` — cheap, prevents a test from nuking prod. Do before any further staging deploys.
3. **Add `checkRate()` to `/brain-copy`** + **CI-gate `deploy-workers.yml`** — small, stops cost-burn + bad deploys.
4. **Before deploying account-delete/push workers:** fix `user_id`-from-body in push worker, fix salt-version check in delete worker, REVOKE the anon recovery RPC. (Latent today; must be fixed the moment you deploy them.)
5. **Sync key derivation** (per-device salt) — needed for multi-device to actually work; design fix, schedule deliberately.
6. P2 cleanup (enum validation, CSP, RLS auth.uid repoints) — batch later.

## Verification plan
- **Local plaintext:** on a Mac, inspect the WKWebView localStorage file for `cycle`/`medication` keys in cleartext (confirms P0).
- **Identity migration:** `SELECT pg_typeof(user_id) FROM encrypted_state LIMIT 1;` (must be `text`).
- **Staging isolation:** after split, confirm distinct namespace IDs; run a staging write, verify prod cache untouched.
- **Deletion:** outsider account → create data across modules → delete → query every table for that user_id = 0 rows (add as a test).
- **brain-copy:** hammer the endpoint, confirm 429 after limit.
- **Consent:** with consent off, confirm no outbound call to Groq/Gemini (or confirm policy discloses it).

## The one decision that blocks the rest
**The local-storage privacy promise.** Two clean options:
- **A — Make it true:** wire the already-built `encryptedKv` behind sensitive modules (cycle/medication/mood/finance/dump) + clear local storage on logout/delete. Real work, honors the promise.
- **B — Make the promise true-as-stated:** correct `marketing/privacy.md` to say device data is stored locally and protected by your device lock (not app-level encryption) for v1, and defer at-rest encryption. Fast, honest, unblocks dogfood today.

Everything else has an obvious smallest-fix; this is the only product/trust judgment call.
