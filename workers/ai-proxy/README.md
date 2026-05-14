# ollie · ai-proxy worker

Cloudflare Worker that hides `ANTHROPIC_API_KEY` from the client and proxies
brain-dump requests to `https://api.anthropic.com/v1/messages`.

## Endpoints

```
POST /brain-dump      — preferred path
POST /v1/messages     — legacy alias (current packages/api/anthropic.ts
                        still posts here; kept for backward-compat
                        until that fetch is migrated)
```

Body is forwarded verbatim to Anthropic. The `anthropic-beta` request
header is preserved so prompt caching keeps working.

## Behaviours

- **5-min KV cache** on the request body sha256 (CACHE_KV).
- **10 req/min per user** rate limit (RATE_KV).
  Bucket key: `x-user-id` header if present, else `cf-connecting-ip`.
- Returns `429 {"error":"rate_limited"}` when exceeded.
- Response header `x-ollie-cache: hit|miss`.

## Secrets to set with `wrangler secret put`

```
wrangler secret put ANTHROPIC_API_KEY     # sk-ant-… · NEVER in client env
```

## Bindings

Run once before first deploy:

```
wrangler kv:namespace create CACHE_KV
wrangler kv:namespace create RATE_KV
```

Paste the returned ids into `wrangler.toml`.

## Deploy

```
pnpm install
pnpm deploy
```

Deployed URL goes into the app's `.env.local` as `VITE_AI_WORKER_URL`.
Brain-dump fetch will hit `${VITE_AI_WORKER_URL}/brain-dump`.

## Local dev

```
pnpm dev
```
