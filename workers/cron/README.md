# ollie · cron worker

Daily scheduled worker (03:00 UTC) that drives server-side intelligence
tasks: pattern detection, period prediction, subscription detection,
notification dispatch.

## Schedule

Configured in `wrangler.toml`:

```
[triggers]
crons = ["0 3 * * *"]
```

(Cloudflare cron runs in UTC.)

## Manual trigger

For ops or local testing:

```
curl -X POST https://ollie-cron.<account>.workers.dev/run
```

Returns 202 + `{ "queued": true }`. Tasks run via `waitUntil`, so failures
in one task don't block the others.

## Service binding

The cron calls `ollie-apns-push` via Cloudflare service binding (in-cluster
RPC, no public network hop, no Anthropic / APNs rate limit applied twice).
Deploy `ollie-apns-push` FIRST so this binding resolves.

## Secrets to set with `wrangler secret put`

```
wrangler secret put SUPABASE_URL                # https://<ref>.supabase.co
wrangler secret put SUPABASE_SERVICE_ROLE       # server-only, NEVER in client
```

## Deploy

```
pnpm install
pnpm deploy
```

## Status

All four tasks are **skeleton stubs**. Algorithms still live client-side
in `packages/logic/*`. Port them server-side incrementally once the
encryption/key-delegation story is locked.
