# Push + Account-Delete worker (apps/api) — deploy runbook

Code is ready (H9 fix shipped 2026-07-01, commit 3c5d127). Deploying `apps/api`
turns on BOTH push notifications (register/send) AND "delete my account" — they
live in the same worker. Do this with a device on hand to test.

## 0. Prereqs (one-time)
```
cd apps/api
npx wrangler kv namespace create DEVICE_TOKENS
# → copy the printed id into wrangler.toml (replace REPLACE_AFTER_wrangler_kv_create_DEVICE_TOKENS)
```

## 1. Set secrets (`npx wrangler secret put <NAME>`)
Values you already hold — set each:
- `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_AUTH_KEY` (the .p8) — from the iOS push work (Apple key T6CVMAU478)
- `APNS_USE_SANDBOX` = `1` for TestFlight/dev, `0` for prod
- `CLERK_ISSUER` = the Clerk JWKS issuer (e.g. https://<slug>.clerk.accounts.dev) — **required**, or register-token always 401s
- `CLERK_SECRET_KEY` — Clerk Backend API key (deletes the Clerk user on account-delete)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — ollie-prod
- `REGISTER_SHARED_SECRET` — server-only secret for /send (cron). NOT shipped in the client anymore.
- ⚠️ `USER_HASH_SALT` — **MUST equal the exact value ai-proxy uses** (H7). A different
  value makes account-delete silently fake-erase the hash-keyed telemetry tables.
  Copy it from ai-proxy's secret, do not generate a new one.
- `SCHEDULED_JOBS_ENABLED` = `1` only if wiring the cron drain now, else leave unset.

## 2. Deploy
```
cd apps/api
npx wrangler deploy
```
(CI only deploys ai-proxy/cron/apns-push/sentry-tunnel — apps/api is deployed manually.)

## 3. Client env
- Set `VITE_PUSH_REGISTER_URL` to the deployed worker's /register-token URL.
- `VITE_PUSH_REGISTER_SECRET` is no longer used by the client (register uses the Clerk JWT).

## 4. Device test
- Sign in on the iPhone build → confirm a row lands keyed by `user:<clerk-sub>` (KV / push_tokens).
- Trigger a /send → push arrives.
- Test "delete account" from settings → verify rows erased for that user (query every user table = 0 rows). Use a throwaway account.

## Notes
- This resolves audit H8 (delete worker was undeployed) + completes H9 (register identity).
- Connects to the existing push branch `feat/ios-push-2026-06-24` (see project_ollie_ios_push memory).
