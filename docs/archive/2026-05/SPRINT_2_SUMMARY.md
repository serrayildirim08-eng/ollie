# Sprint 2 / Group C — Encrypted sync backend

**Status:** all 7 tasks shipped.
**Tests:** 1066 vitest + 21 scanner pretest = 1087 checks · was 1016.
**Typecheck:** clean across all 13 workspace packages.
**Packages added:** `@ollie/crypto`, `@ollie/sync`, `@ollie/backup`, `@ollie/auth`, `@ollie/research-stream`. Plus `supabase/migrations/`, plus `OllieAPI` client in `@ollie/api`.

---

## C1 · `@ollie/crypto` — zero-knowledge primitives (19 tests)

Ports legacy `window.VOID.backup` crypto into a clean package.

```ts
import { deriveKey, encryptData, decryptData, randomSalt, passphraseStrength } from '@ollie/crypto';

const salt = randomSalt();
const key  = await deriveKey('correct-horse-battery-staple', salt);
const enc  = await encryptData(key, { secret: 'data' });   // { iv, ciphertext }
const out  = await decryptData<typeof data>(key, enc);
```

**Locked params:** PBKDF2 SHA-256 100k iters · 16-byte salt · 12-byte IV · AES-GCM-256.

**Adversarial coverage:** wrong passphrase, wrong salt, tampered ciphertext, tampered IV, malformed envelope, empty passphrase, too-short salt all throw cleanly.

**Strength meter:** `passphraseStrength()` returns `{ score, band, notes }`. Used by signup UI.

---

## C2 · Supabase schema + RLS

`supabase/migrations/20260512_000001_encrypted_state.sql`:

```sql
create table public.encrypted_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  module text not null check (length(module) between 1 and 64),
  ciphertext bytea not null,
  iv bytea not null check (octet_length(iv) = 12),
  updated_at timestamptz not null default now(),
  device_id text,
  blob_version smallint not null default 1,
  unique (user_id, module)
);

create index encrypted_state_user_module_updated_idx
  on public.encrypted_state (user_id, module, updated_at desc);

alter table public.encrypted_state enable row level security;
alter table public.encrypted_state force row level security;
-- + 4 policies (select/insert/update/delete) gated by `auth.uid() = user_id`
```

Server-side `updated_at` trigger clamps to ≥ now() — client-clock drift cannot overwrite newer rows with older timestamps.

`anon` role gets **nothing**. `authenticated` gets select/insert/update/delete via RLS. `service_role` (only used by Worker / GDPR-erasure) gets full access.

Down-migration included. README in `supabase/README.md` with verification curl commands.

---

## C3 · `@ollie/sync` — encrypted blob sync (6 tests)

```ts
const sync = createSyncClient({ store, api, userId, authJwt, encryptionKey });
await sync.start();
// — on store change → 300ms debounce → encrypt → upsert to Supabase
// — on boot → pull all rows → decrypt → setModule with LWW
// — on offline → queue persisted to shared._sync_queue (cap 10k)
// — on `online` event → drainOnce
```

**Constitutional:** opt-in. `shared.settings.sync.enabled` defaults false → zero network calls.

**LWW:** each module tracks `shared._sync_local_ts.<module>`. Remote rows with `updated_at ≤ local_ts` are skipped.

**Coalescing:** multiple debounced changes to the same module produce ONE upsert with the latest snapshot. Same for queue drain — if 5 entries are buffered for `cycle`, the last one wins.

**Events:**
- `sync:outbound_flushed` `{ count, ts }`
- `sync:inbound_applied` `{ ts }`
- `sync:auth_expired` `{ ts }` (UI prompts re-login)

---

## C4 · `@ollie/backup` — encrypted JSON export/import (11 tests)

```ts
const envelope = await exportBackup(store, passphrase, { exportedBy: 'ollie/v0.0.1' });
// envelope = { version:1, app:'ollie', created_at, salt, iv, ciphertext, metadata }
download(envelopeToFileBytes(envelope), defaultFilename(envelope));

// later, different browser
const result = await importBackup(store, fileText, passphrase);
// → { ok: true, applied_modules: [...] } OR
//   { ok: false, code: 'wrong-passphrase' | 'corrupt-envelope' | 'unsupported-version' | 'not-an-ollie-backup' }
```

**Round-trip verified** with strings, Uint8Array, ArrayBuffer inputs.

**Adversarial:** wrong passphrase, tampered ciphertext, non-ollie envelope, newer version, corrupt JSON — each returns a typed error code, never throws.

**Merge mode** preserves existing keys not in the backup (for selective restore).

**`snapshotPreMigration(store, key)`** for the migration-runner pre-flight (key passed directly so PBKDF2 doesn't block the hot path).

---

## C5 · `@ollie/auth` — account model + auth flow (9 tests)

```ts
const auth = createAuthClient({ store, api });
await auth.signUp({
  email: 'serra@…',
  passphrase: '16+ chars',
  passphraseConfirm: '…',
  acknowledged_unrecoverable: true,   // explicit "i'll lose my data" checkbox
});
// → in-memory CryptoKey set, salt persisted, Supabase auth session in shared.auth.session

await auth.signOut();   // drops in-memory key, clears session, KEEPS salt
const r = await auth.signIn({ email, passphrase });
// → re-derives the same key from the persisted salt
// → falls back to fetching salt from Supabase profiles row when device-roaming
```

**Constitutional:**
- Default passphrase length: 16+ chars (enforced).
- Mismatched confirm rejected.
- Explicit `acknowledged_unrecoverable` checkbox required.
- **No password reset path for the passphrase** (lose it = lose data, by design).
- Server-side Supabase auth uses the passphrase as the auth password — Supabase only stores bcrypt(passphrase) + its own salt. The encryption key derivation uses a SEPARATE salt + PBKDF2-SHA-256. Server bcrypt hash and client encryption key are mathematically independent.
- Sign-out drops the in-memory CryptoKey reference. Garbage collection eats it.

**Result codes:**
- signUp: `weak-passphrase` / `mismatch` / `no-consent` / `http` / `network`
- signIn: `wrong-passphrase` / `wrong-email` / `missing-salt` / `http` / `network`

**Events:** `auth:signed_up` · `auth:signed_in` · `auth:signed_out` · `auth:decryption_failed`.

---

## C6 · `@ollie/api` centralized fetch (14 new tests, 23 total)

```ts
const api = createOllieAPI({
  anthropicProxy: '…workers.dev/anthropic',
  supabaseUrl: 'https://ykxzfzkfsolwgmheiwpx.supabase.co',
  supabaseAnonKey: '…',
});

await api.supabase.rest.upsert('encrypted_state', rows, { authJwt });
await api.supabase.auth.signInWithPassword(email, password);
await api.anthropic.route({ messages: […] });
```

**Discriminated result envelope** `OllieApiResult<T>` — never throws on bad responses:

```ts
type OllieApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: { code: 'network'|'timeout'|'http'|'parse'|'aborted'|'unauthorized'; status?; message; body? } };
```

**Built-in:**
- Timeout via `Promise.race` (independent of fetch honoring AbortSignal — works even with fakes).
- Retry: GETs get 2 retries on network/timeout/5xx by default; non-GETs never retry by default.
- Auth header injection from `authJwt`.
- Body auto-JSON-stringify with content-type if not already string/FormData/Uint8Array.
- Supabase REST helpers (`get`, `upsert`, `delete`) — `upsert` sets the `Prefer: resolution=merge-duplicates,return=representation` header automatically.
- Supabase Auth helpers (`signUp`, `signInWithPassword`, `refresh`, `signOut`).
- Anthropic proxy hook.

---

## C7 · `@ollie/research-stream` foundation (12 tests)

**Revised per your note:** foundation only — opt-in toggle, flexible JSON event capture, random_uuid (no PII), GDPR endpoints. Rigid schema (week/amount_bucket/merchant/k-anonymity bucketing) **deferred** until B2B product design (Sprint 6+).

```ts
const research = createResearchStream({ store, api, endpointUrl: 'https://research-api/.../events' });
research.start();

// User opts in via settings toggle:
research.grantConsent();

// Modules emit free-form events:
research.track('finance.transaction_logged', { amount_band: 'med', category: 'food' });

// GDPR:
const all = research.exportContributions();        // local view
await research.deleteContributions();              // local + remote DELETE
research.withdrawConsent();                        // future track() = no-op
```

**Constitutional guarantees:**
- Default consent: **OFF**.
- `track()` is a no-op until consent granted — verified by test.
- `device_id` is a per-device UUID v4. **NOT** the user_id, not joinable to any account. Wiped on `withdrawConsent()`.
- No package access to `@ollie/auth` or `@ollie/crypto` — the research-stream cannot see the email or the encryption key.
- ts rounded to nearest minute to reduce fingerprinting.
- Queue cap 5k. Withdraw clears queue + device_id.
- Endpoint URL is configured externally so the production Supabase project never sees research traffic.

---

## Per-package totals

| Package | Tests | Notes |
|---|---|---|
| events | 11 | +6 new event entries (sync, auth, research) |
| store | 19 | unchanged |
| crypto | 19 | **NEW** |
| logic | 808 | unchanged |
| api | 23 | +14 client tests |
| notifications | 11 | unchanged |
| backup | 11 | **NEW** |
| orchestrator | 87 | unchanged |
| router | 17 | unchanged |
| research-stream | 12 | **NEW** |
| auth | 9 | **NEW** |
| sync | 6 | **NEW** |
| apps/web | 33 | unchanged |
| **vitest total** | **1066** | **+71** vs sprint 2.5 |
| scanner pretest | 21 | unchanged |

---

## What's wired vs what needs Serra's hands-on step

**Code-complete, typechecks, tests pass:**
- All five new packages
- Supabase SQL migration file
- Cross-module integration paths (sync uses crypto + api + store + events; auth uses crypto + api + store + events; backup uses crypto + store)
- LWW reconciliation, offline queue, opt-in gates, GDPR endpoints, dedupe

**Needs your hands-on step:**
1. Run the SQL migration against the `ykxzfzkfsolwgmheiwpx` Supabase project:
   ```sh
   pnpm dlx supabase link --project-ref ykxzfzkfsolwgmheiwpx
   pnpm dlx supabase db push
   ```
   OR paste the SQL into the dashboard SQL editor.
2. Create a `profiles` table in Supabase for the salt-roaming path (or add a `salt` column to whatever profile table you use). The auth client expects `profiles.id` = user uuid and `profiles.salt` = base64 string. RLS should mirror encrypted_state.
3. (Optional) Provision the research API endpoint — a separate Supabase project or a different worker. The packages don't need it to typecheck/test; production will when you flip the opt-in toggle for real users.
4. Wire the UI:
   - Settings → sync toggle (`shared.settings.sync.enabled`)
   - Settings → "export backup" / "import backup" buttons
   - Settings → research opt-in (`shared.consent.spending_research`)
   - Signup / login screens (Auth flow exists; UI not wired this sprint — deferred to Sprint 4 / Group E quick-capture work)

---

## What ships next (Sprint 4 / Group E)

Per your original briefing the next sprint covers medication UI, quick-capture, real audio licensing, cross-protective chains. After this sprint Ollie has:
- Paid-tier multidevice sync (Mac + Web ready; iOS waits for the .p8)
- Encrypted .ollie.backup.json portable backup
- Email + passphrase account flow, zero-knowledge
- B2B research data foundation (opt-in, anonymous, GDPR-compliant)
