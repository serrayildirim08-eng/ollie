# ollie · plaid-sync worker

Cloudflare Worker that exchanges Plaid public_tokens server-side,
receives Plaid webhooks, and stages encrypted bank-transaction blobs
in Supabase `plaid_inbox` until the client picks them up.

Status: **scaffold deployable; not deployed yet**. Production cutover
checklist lives at `packages/plaid/PRODUCTION_CHECKLIST.md`.

## Endpoints

```
GET  /health    — { ok: true, env: "sandbox" | "production" }
POST /exchange  — body { publicToken, userId } + Authorization: Bearer <supabase-jwt>
POST /webhook   — Plaid webhook receiver. Plaid-Verification header required.
```

The `/exchange` endpoint verifies the supplied Supabase JWT's `sub`
matches the `userId` in the body. The plaintext access_token transits
back to the client ONCE over TLS — the client MUST encrypt it with the
user's `@ollie/crypto` key before persisting.

## Architecture · why the staging table

The worker cannot access the user's encryption key (it's user-derived
and lives only on devices). But Plaid pushes webhooks at any time, even
when the user is offline. We therefore:

1. Server-side encrypt each transaction blob with `PLAID_INBOX_ENCRYPTION_KEY`
   (held only in worker env). This is in-transit-at-rest protection.
2. Insert into `plaid_inbox` via the service-role key.
3. The client polls `plaid_inbox` on next session, decrypts with the
   server key (which the client gets via `/inbox/unwrap` — TODO), then
   re-encrypts with the user's key, writes to `finance_records`, and
   deletes the staging row.

In steady state `plaid_inbox` is empty. Worst case (DB breach during
flight): the row leaks bank transactions in flight, NOT the user's
historical bank-data corpus.

## Secrets to set with `wrangler secret put`

```
wrangler secret put PLAID_CLIENT_ID
wrangler secret put PLAID_SECRET
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE
wrangler secret put PLAID_INBOX_ENCRYPTION_KEY    # base64 of 32 random bytes
```

Generate the inbox key locally with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Bindings

```
wrangler kv:namespace create PLAID_KEY_KV
```

Paste the returned id into `wrangler.toml`.

## Cron is deferred

`wrangler.toml` has a commented-out `[triggers]` block. We rely on
webhooks as the primary path. The cron design needs another pass
(worker can't decrypt the user's access_token to do a server-driven
pull) — likely lives on the client as a background fetch instead.

## Deploy

```
pnpm install
pnpm deploy
```

The deployed URL goes into the Plaid Dashboard webhook field and into
`apps/web/.env.local` as `VITE_PLAID_SYNC_WORKER_URL`.
