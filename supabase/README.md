# ollie · Supabase migrations

Project: `ykxzfzkfsolwgmheiwpx` · East US

## Apply

Either:
- Supabase Dashboard → SQL Editor → paste each `*.sql` migration (forward only)
- OR Supabase CLI:
  ```sh
  pnpm dlx supabase link --project-ref ykxzfzkfsolwgmheiwpx
  pnpm dlx supabase db push
  ```

## Verify RLS

```sh
# As user A (good)
curl -X POST "$SUPABASE_URL/rest/v1/encrypted_state" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $USER_A_JWT" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=representation" \
  -d '{"user_id":"<user_a_uuid>","module":"cycle","ciphertext":"\\x00","iv":"\\x000000000000000000000000"}'
# → 201, returns row

# As user A trying to read user B's row (forbidden)
curl -X GET "$SUPABASE_URL/rest/v1/encrypted_state?user_id=eq.<user_b_uuid>" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $USER_A_JWT"
# → 200, returns [] (RLS filters it out)
```

## What's stored

| column | type | notes |
|---|---|---|
| id | uuid | client-generated v4 — stable for offline writes |
| user_id | uuid | references auth.users(id), ON DELETE CASCADE |
| module | text | 1–64 chars; one row per (user_id, module) |
| ciphertext | bytea | AES-GCM-256, includes 16-byte auth tag |
| iv | bytea | 12 bytes, random per encryption |
| updated_at | timestamptz | LWW key; server clamps to ≥ now() |
| device_id | text | optional diagnostic |
| blob_version | smallint | plaintext schema version |
