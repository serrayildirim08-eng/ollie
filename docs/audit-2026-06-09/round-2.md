# Ollie Repo Audit — Round 2/3

_Date: today · Branch: feat/brain @ 2325ee5 · 124 findings · independent round, unaware of the other two._

Findings ordered by importance (severity).

## CRITICAL — 4

### remindIn hints lost when classifying low-confidence fragments
- **Dimension:** Dump Routing Flow Correctness
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:285, 342`
- **Problem:** When applyConfidencePolicy demotes a fragment due to confidence < 0.6, it wraps the original payload in a new structure: { module: 'dump_only', payload: { module, action, reason, originalGuess: { module, payload } } }. However, injectScheduledAt is called on tiered.payload immediately after, which has NO remindIn field at the top level—any time-deferred reminder from the AI classification gets nested inside originalGuess.payload.remindIn and is silently discarded. This means users' 'remind me in N' requests on low-confidence fragments never schedule a notification.
- **Fix:** Either (1) inject scheduledAtMs before applying confidence policy, or (2) detect demotion and extract/re-inject remindIn from originalGuess.payload when it exists. Ensure remindIn is never discarded when moving between tiers.
- **Evidence:** `Line 281: 'const tiered = applyConfidencePolicy(...)' wraps low-confidence payloads. Line 285: 'injectScheduledAt(tiered.payload, ...)' tries to inject into the wrapper, not the nested original. Same pattern at line 338-342 in the AI path.`

### CrisisSignal type mismatch: worker returns lexicon type, native expects different shape
- **Dimension:** API Contract Consistency
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:227`
- **Problem:** The worker calls `detectCrisis()` and returns the actual CrisisSignal from @ollie/crisis-lexicon, which has fields {tier: 1|2|3|4, languages: string[], matches: Array<{...}>}. However, the native app's schema at apps/native/src/router/schema.ts defines CrisisSignal with {type: 'ideation'|'method_seeking'|'distress'|'panic', confidence: number, language: string}. The native app's CrisisBanner component (DumpScreen.tsx line 323) reads crisis.type and crisis.language which do not exist on the actual response object, causing the crisis banner to display undefined values.
- **Fix:** Either (1) Transform the crisis-lexicon's CrisisSignal to the native schema format in the worker before returning it, mapping tier→type and languages[0]→language; or (2) Update the native app schema to match the actual crisis-lexicon output structure and update CrisisBanner to read tier/languages/matches instead.
- **Evidence:** `Line 227 in dump.ts: 'const crisis = detectCrisis(combinedDump) ?? undefined;' returns @ollie/crisis-lexicon's CrisisSignal. Line 323 in DumpScreen.tsx: 'dismiss · type={crisis.type} · {crisis.language}' expects different fields.`

### PL/pgSQL trigger uses comparison operator (=) instead of assignment (:=)
- **Dimension:** DB, Migrations & Schema
- **File:** `/Users/serrayildirim/ollie/supabase/migrations/20260515000001_notification_delivery.sql:130`
- **Problem:** The push_tokens_touch_updated_at() trigger function uses a single equals sign (=) for assignment instead of the PL/pgSQL assignment operator (:=). This will cause the trigger to fail at runtime because = is a comparison operator in PL/pgSQL, not an assignment operator. Every UPDATE to push_tokens will fail silently or error.
- **Fix:** Change line 130 from `new.updated_at = now();` to `new.updated_at := now();` to use the correct PL/pgSQL assignment operator. This matches the syntax in all other trigger functions in the codebase (encrypted_state, profiles, finance_records, plaid_items).
- **Evidence:** `  new.updated_at = now();`

### grocery_purchase_history uses UUID for user_id but receives text Clerk IDs
- **Dimension:** DB, Migrations & Schema
- **File:** `/Users/serrayildirim/ollie/supabase/migrations/20260522000001_grocery_purchase_history.sql:13`
- **Problem:** The grocery_purchase_history table defines user_id as UUID (line 13), but the ai-proxy worker inserts text values from Clerk JWT 'sub' claims (workers/ai-proxy/src/router/purchase.ts:127). This is the same issue that cook_history had before migration 20260530144446_fix_cook_history_clerk_id_text.sql was created. Every INSERT will fail with 'invalid input syntax for type uuid' error, breaking the purchase tracking pipeline.
- **Fix:** Create a follow-up migration similar to 20260530144446_fix_cook_history_clerk_id_text.sql to: (1) drop the RLS policies that reference user_id in uuid=uuid comparisons, (2) ALTER TABLE grocery_purchase_history ALTER COLUMN user_id TYPE text, (3) drop and recreate the grocery_replenishment_estimates(uuid) function with text parameter, (4) grant execute permissions.
- **Evidence:** `  user_id   uuid        NOT NULL,  -- in CREATE TABLE
  user_id: userId,  -- in purchase.ts where userId is text from Clerk JWT`

## HIGH — 34

### CORS misconfigured with wildcard origin allowing any domain to call protected endpoints
- **Dimension:** Security & Authorization
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:126`
- **Problem:** The CORS headers allow 'Access-Control-Allow-Origin': '*' which permits any domain to make requests to all endpoints. While Authorization headers are required for sensitive endpoints (/enrich-dump, /ingest-event, /label), the overly permissive CORS policy increases attack surface and allows information leakage through preflight responses and error messages.
- **Fix:** Change 'Access-Control-Allow-Origin' from '*' to specific trusted origin(s). For Electron/Capacitor apps, use the actual app domain(s). If multiple origins are needed, validate the Origin header and echo back only if it matches an allowlist.
- **Evidence:** `function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, anthr`

### Staging test bearer token could bypass Clerk JWT verification in production if misconfigured
- **Dimension:** Security & Authorization
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:123`
- **Problem:** The STAGING_TEST_BEARER environment variable provides a backdoor that bypasses Clerk JWT verification. While the code comments claim it exists ONLY on staging and never on prod, there is no technical enforcement preventing it from being set in production. If a secret is leaked or misconfigured, any request with Bearer <STAGING_TEST_BEARER> would authenticate as 'staging-test-user' and access /route/dump without proper user authentication.
- **Fix:** Add an explicit environment-based guard: throw an error if STAGING_TEST_BEARER is set on production. Alternatively, remove this feature from the main codebase and use separate staging-only code paths. Ensure production deployments have no STAGING_TEST_BEARER secret configured.
- **Evidence:** `if (env.STAGING_TEST_BEARER && bearer === env.STAGING_TEST_BEARER) {
    userId = STAGING_TEST_USER_ID;
  } else {
    userId = await verifyClerkJwt(bearer, { CLERK_ISSUER: env.CLERK_ISSUER });
  }`

### OPEN mode for /route/:module authentication allows spoofing user identity via x-user-id header
- **Dimension:** Security & Authorization
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:221`
- **Problem:** The /route/:module endpoint gates authentication with T0_JWT_ENFORCED !== '0', meaning any non-'0' value enforces JWT. However, when T0_JWT_ENFORCED is '0' (explicitly set for dev), the endpoint accepts an unsecured x-user-id header with no authentication. If this flag is left '0' in staging or production by mistake, an attacker can craft requests with any x-user-id and receive personalized AI classifications without proving ownership of that user.
- **Fix:** Change the default behavior to FAIL CLOSED: require T0_JWT_ENFORCED === '0' explicitly set (not just !== '1') AND add a deployment-time validation that production never has this flag set to '0'. Consider removing the open-mode fallback entirely now that Clerk is deployed.
- **Evidence:** `if (env.T0_JWT_ENFORCED !== '0') {
    const auth = req.headers.get('authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return json({ error: 'unauthorized' }, 401);
    }
    const userId = await verifyClerkJwt(auth.slic`

### Raw unscrubbed user input logged in worker telemetry
- **Dimension:** Secrets & Token Exposure
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:387`
- **Problem:** The /route/dump handler logs up to 120 characters of the raw combinedDump (before PII scrubbing) to Cloudflare worker logs for telemetry. The combinedDump may contain unfiltered PII like personal names, email addresses, phone numbers, or medical information that should have been scrubbed by scrubPII() first. The scrubbed version (cleanDump) exists but is not used in the telemetry log.
- **Fix:** Replace line 387 'input: combinedDump.slice(0, 120)' with 'input: cleanDump.slice(0, 120)' to log only PII-scrubbed text. Verify all telemetry lines in this console.log statement use cleanDump or derived scrubbed fragments, never the raw combinedDump.
- **Evidence:** `Line 181-185: combinedDump is created from raw vision+text. Line 191: cleanDump = scrubPII(combinedDump). Line 384-387: console.log logs input: combinedDump.slice(0, 120) instead of cleanDump.slice(0, 120).`

### No request body size limit on /brain-dump endpoint
- **Dimension:** Input Validation
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:389`
- **Problem:** The /brain-dump and /v1/messages endpoints read the entire request body with req.text() without any size validation. An attacker can send arbitrarily large payloads to consume worker memory and CPU, then hash and cache the massive payload, potentially causing OOM or DoS. Cloudflare Workers have execution limits but not strict request body limits enforced by default.
- **Fix:** Add a size check before reading the body. Example: const bodyText = await req.text(); const MAX_BODY_BYTES = 1024 * 1024; // 1MB reasonable for brain dumps
if (bodyText.length > MAX_BODY_BYTES) return withCors(json({ error: 'body_too_large' }, 413));
- **Evidence:** `const bodyText = await req.text();
if (!bodyText) return withCors(json({ error: 'empty_body' }, 400));`

### Three independent UUID/ID generation implementations with similar logic
- **Dimension:** Reinvented Wheels & Duplication
- **File:** `packages:research-stream:338-349, worker-http:66-73, orchestrator:312-317`
- **Problem:** Three separate packages implement nearly identical UUID/ID generation functions with crypto.randomUUID fallbacks: (1) research-stream's randomUuid(), (2) worker-http's newRequestId(), and (3) orchestrator's newId(). All three attempt crypto.randomUUID first, then fall back to ad-hoc Date.now()/Math.random() strings. This is code duplication that should be centralized in a shared utility package to avoid divergence in ID generation quality and behavior.
- **Fix:** Create a shared ID generation utility in packages/util/ (or similar) that exports a single, well-tested UUID/ID factory. Export both strict UUID v4 and fallback variants. Update all three call sites to import from the shared utility rather than maintaining separate implementations.
- **Evidence:** `research-stream lines 338-349: randomUuid() with full v4 implementation; worker-http lines 66-73: newRequestId() with try-catch wrapper; orchestrator lines 312-317: newId() with minimal fallback`

### Unsafe `as unknown as Record<...>` casting in theme token generation
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/apps/native/src/theme/tokens.ts:370-382`
- **Problem:** Multiple typed token objects are unsafely cast through `as unknown as Record<string, string>` in the tokensToCssVars function. These casts bypass type checking and could allow invalid data to propagate into CSS variables if token types change or contain unexpected values.
- **Fix:** Create properly-typed helper functions that validate token structure instead of using double casts. Define overloaded `writeGroup` signatures for each token type (Record<string, string>, Record<string, number>) to eliminate the unsafe `as unknown` bridge.
- **Evidence:** `writeGroup('color', t.palette as unknown as Record<string, string>);
  writeGroup('font', t.fonts as unknown as Record<string, string>);
  writeGroup('text', t.fontSizes as unknown as Record<string, string>);
  writeGroup('weight', t.fontWe`

### Overly permissive `any` types in capacitor plugin loader
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/notifications/src/backends/capacitor.ts:36-38`
- **Problem:** Dynamic import function is typed as `(s: string) => Promise<any>` and then illegally cast through a complex chain ending in `as never`, hiding type information. This defeats type checking for dynamically-loaded Capacitor plugins and could allow missing methods/properties to go undetected.
- **Fix:** Define a proper typed wrapper that validates the shape of imported modules. Use a validated type guard function that checks for required plugin methods (LocalNotifications, PushNotifications) before returning, or parametrize the return type via generics: `<T>(s: string) => Promise<T>`.
- **Evidence:** `const dynImport: (s: string) => Promise<any> =
   
  new Function('s', 'return import(s)') as (s: string) => Promise<unknown> as never;`

### Missing timeout on APNs JWT fetch in worker
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/apps/api/src/worker.ts:406-413`
- **Problem:** The getApnsJwt() function calls apnsSigner.getApnsJwt() without any timeout. If the signing operation hangs or the underlying fetch stalls, the request will block indefinitely. This is called on every /send request and can exhaust worker request limits.
- **Fix:** Wrap getApnsJwt with an explicit timeout: `const jwt = await Promise.race([getApnsJwt(env), timeoutPromise(5000)])` or add timeout support to the apnsSigner interface.
- **Evidence:** `'''typescript
const jwt = await getApnsJwt(env);
const results = await Promise.all(
  tokens.map((t) => sendApns(env, jwt, t, body.spec)),
);
'''`

### Silent data loss on sync queue persistence failure
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/packages/sync/src/index.ts:199-212`
- **Problem:** When drainOnce() successfully upserts to Supabase, it calls writeQueue() to remove shipped entries. If writeQueue() fails (e.g., store.set throws), the queue is never persisted but the method returns success. On the next app reload, the in-memory readQueue() from store.get returns stale data and entries are re-shipped forever. The upsert was idempotent per (user_id, module), but the cleanup failure creates a logical inconsistency.
- **Fix:** Wrap the writeQueue call in try-catch: `try { writeQueue(...); } catch (err) { console.error('[sync] queue write failed', err); drainScheduler.scheduleRetry(); return; }`
- **Evidence:** `'''typescript
const r = await deps.api.supabase.rest.upsert<RemoteRow[]>('encrypted_state', rows, {
  authJwt: deps.authJwt,
});
if (r.ok) {
  drainScheduler.reset();
  writeQueue(
    readQueue().filter((e) => !shippedKeys.has('${e.module}`

### Race condition in finance sync drain queue clearing
- **Dimension:** Async & Concurrency
- **File:** `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:335-401`
- **Problem:** drainOnce() reads the queue once at line 335, processes upserts via API (line 357), then reads the queue again at line 371 to filter shipped items. Items enqueued by concurrent diffAndEnqueue() calls between these two reads are lost when the second queue is filtered against the first queue snapshot (line 372: shippedIds is built from the original `q`, not the newly read `next`). Same issue occurs for deletes at lines 396-401. This causes pending enqueued rows to silently disappear from the queue without being synced.
- **Fix:** Atomically read the queue at the start, process items, then filter based on what was actually sent in THIS drain attempt, not the original snapshot. Either: (1) take a queue snapshot at line 335, process it fully, then filter from the current queue only items that match the snapshot IDs that were successfully sent, OR (2) use a simpler pattern: save the IDs that succeeded, re-read the queue, and keep only items NOT in that succeeded set.
- **Evidence:** `    const q = readQueue(); // line 335
    // ... API call completes at line 357 ...
      const next = readQueue(); // line 371 - may have new items added since line 335
      const shippedIds = new Set(q.upserts.map((u) => u.id)); // uses`

### Missing error handling in Promise.all for concurrent upsert row transformations
- **Dimension:** Async & Concurrency
- **File:** `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:283-317`
- **Problem:** diffAndEnqueue() calls enqueueUpsert() for each added/updated row in sequence (lines 298, 305). enqueueUpsert() is async and performs encryption (line 259: await encryptData). If multiple store keys are subscribed and fire concurrently during a single drain cycle, multiple debouncedDiff calls can be pending. However, enqueueUpsert doesn't handle encryption failures gracefully - if encryptData throws, the pending promise is not caught, only the calling diffAndEnqueue has a .catch (line 323). This could leave partially encrypted rows enqueued or silently drop rows.
- **Fix:** Wrap the encryptData call in try/catch within enqueueUpsert and either rethrow (to be caught by diffAndEnqueue's .catch), or log and return early so failed rows are not queued.
- **Evidence:** `    async function enqueueUpsert(...) {
      if (!row.id) return;
      const enc: EncryptedPayload = await encryptData(deps.encryptionKey, row); // no try/catch
      const entry: QueuedPush = { ... };
      const q = readQueue();
      q`

### Cache TTL enforcement lost on cache hits due to missing createdAt in bump
- **Dimension:** Dump Routing Flow Correctness
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vectorize.ts:182`
- **Problem:** cacheHitBump upserts cache metadata without preserving the original createdAt timestamp. When a cache entry is updated (hitCount incremented), it loses its createdAt field. Later, cacheLookup at line 101 checks TTL via `Date.now() - createdAt > TTL_MS`. If createdAt is missing (undefined), the comparison `undefined > TTL_MS` evaluates to false, making old entries appear fresh and bypass the 30-day eviction window. A misclassified entry from weeks ago could be reused indefinitely instead of expiring.
- **Fix:** Preserve createdAt when bumping cache hits. Either (1) pass the original createdAt timestamp from CacheRow to cacheHitBump and include it in the upsert, or (2) never update an existing cache entry, only insert new ones (trade-off: hitCount stats lost).
- **Evidence:** `Line 182 in cacheHitBump upsert metadata: { userId, module, payload, confidence, language, hitCount: row.hitCount + 1, lastHitAt: Date.now() } — no createdAt. Compare to cacheUpsert at line 156 which includes createdAt: now.`

### phaseForDay function produces incorrect phase boundaries for short cycles (<23 days)
- **Dimension:** Algorithms Correctness & Efficiency
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/patterns/phase-fold.ts:48-52`
- **Problem:** The phaseForDay function uses fixed offsets (cycleLengthDays - 18 and cycleLengthDays - 13) to calculate phase boundaries. For short cycles (< 23 days), this produces nonsensical phase assignments. Example: a 21-day cycle skips the follicular phase entirely because cycleLengthDays - 18 = 3, meaning day <= 3 is considered follicular, but days 1-5 are already menstrual. This violates the menstrual -> follicular -> ovulation -> luteal sequence.
- **Fix:** The phase boundaries should be scaled proportionally to cycle length, or documented with an explicit minimum cycle length check that returns 'unknown' for cycles < 21-23 days. Add a guard: if (cycleLengthDays < 21) return 'unknown'; before the calculations, or adjust the offset logic to: menstrual = [1, 5], follicular = [6, cycleLengthDays-13], ovulation = [cycleLengthDays-12, cycleLengthDays-7], luteal = [cycleLengthDays-6, cycleLengthDays].
- **Evidence:** `function phaseForDay(day: number, cycleLengthDays: number): CyclePhase {
  if (day <= 5) return 'menstrual';
  if (day <= cycleLengthDays - 18) return 'follicular';
  if (day <= cycleLengthDays - 13) return 'ovulation window';
  return 'lut`

### finance.settings key read but never initialized by native app bridge
- **Dimension:** State & Store Consistency
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/finance/bridge.ts:164-169`
- **Problem:** The native finance bridge checks for and only seeds `finance.settings` if it's null, but the actual settings (currency, month_anchor, etc.) are hardcoded defaults in the orchestrator. If the orchestrator init() runs before the finance bridge sync, it seeds DEFAULT_SETTINGS into the store. However, if settings are modified in the UI, they'll be lost on the next bridge sync because the bridge only preserves the defaults—it never reads or merges existing user-configured settings back into SQLite. This is a one-way mirror that silently drops UI-modified settings.
- **Fix:** The bridge should read the current finance.settings from the store and preserve user edits across syncs. Either: (1) add a finance_settings SQLite table to persist settings, or (2) read the existing store value before seeding defaults so that UI edits are not lost.
- **Evidence:** `if (store.get('finance', 'settings', null) == null) {
    store.set('finance', 'settings', []);
  }`

### finance.taxProfile key read by orchestrator but never written by any bridge
- **Dimension:** State & Store Consistency
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:410`
- **Problem:** The finance orchestrator reads `finance.taxProfile.selfEmployed` to determine tax set-aside logic, but neither the native app bridge nor any other code path writes this key. The code contains TODOs indicating this was planned for a future onboarding UI. Currently, the tax detection falls back to a default (non-self-employed). If a user is self-employed, the tax set-aside detection will silently produce wrong results because the profile is never initialized.
- **Fix:** Add a finance_settings or finance_profile SQLite table with a self_employed flag, then mirror it into finance.taxProfile in the bridge. Until the UI for this exists, at minimum seed finance.taxProfile with { selfEmployed: false } in the orchestrator init so the contract is explicit.
- **Evidence:** `const taxProfile = store.get<{ selfEmployed?: boolean } | null>('finance', 'taxProfile', null) ?? null;`

### RoutingSummary includes pass2Triggered field not in native schema
- **Dimension:** API Contract Consistency
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:415`
- **Problem:** The worker's RouterOutput includes pass2Triggered in the summary telemetry (dump.ts line 415), but the native app's schema (apps/native/src/router/schema.ts lines 99-104) does not define this field. While this is not a runtime crash (extra fields are ignored in JavaScript), it represents schema drift and breaks the contract documentation. The native app cannot access or use this telemetry value even though the worker always includes it.
- **Fix:** Remove pass2Triggered from the worker's RoutingSummary in dump.ts, or add it to the native schema's RoutingSummary interface if the native app plans to use it for analytics.
- **Evidence:** `Worker dump.ts line 415: 'pass2Triggered,' in summary object. Native schema RoutingSummary (lines 99-104) lists only: moduleCount, cacheHitRate, aiCalls, durationMs.`

### Fragment.needsConfirm field optionality inconsistency
- **Dimension:** API Contract Consistency
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:49`
- **Problem:** The worker's Fragment schema declares needsConfirm as a required boolean field (line 49), but the native app's Fragment schema (apps/native/src/router/schema.ts line 91) declares it as optional (`needsConfirm?: boolean`). While the worker always populates this field in practice (dump.ts lines 298, 355), the type contracts disagree. This can cause TypeScript type errors if consumers try to use the native app's schema to validate worker responses.
- **Fix:** Align the optionality: either make both required (since the worker always populates it) or both optional (for forward compatibility). Recommend making both required since the applyConfidencePolicy function (dump-schema.ts line 67) always computes a value.
- **Evidence:** `Worker dump-schema.ts line 49: 'needsConfirm: boolean;' (required). Native schema.ts line 91: 'needsConfirm?: boolean;' (optional).`

### enriched_signals insertion lacks deduplication protection on retry
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:325-365`
- **Problem:** insertEnrichedSignal() performs a plain INSERT without any conflict/upsert handling. If the raw_dumps UPSERT succeeds but enriched_signals INSERT fails and is retried, a second identical enriched_signals row will be written, creating a duplicate record for the same dump_id. The code explicitly states this is handled (line 28-32 comment claims 'a duplicate there would need its own dedup key'), but the actual implementation provides no such dedup key.
- **Fix:** Add ON CONFLICT handling to insertEnrichedSignal. Either: (1) Use UPSERT with `on_conflict=dump_id` + `resolution=merge-duplicates` to match raw_dumps pattern, OR (2) Add a UNIQUE constraint on dump_id in the enriched_signals table schema to prevent duplicate FKs at DB level, then use the merge-duplicates prefer header.
- **Evidence:** `INSERT into enriched_signals is plain POST without ON CONFLICT/merge-duplicates handling: 'const resp = await fetch(url, {method: 'POST', ..., body: JSON.stringify(row)});' Line 351-360. Unlike raw_dumps which uses 'on_conflict=id' + 'resol`

### POST /enrich-dump has no Idempotency-Key or request deduplication
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/telemetry.ts:91-159`
- **Problem:** handleEnrichDump() generates a new UUID for every call and queues immediately without checking for duplicate submissions. If a client retries a failed POST /enrich-dump (network timeout, 5xx error) within the same second, two identical payloads will queue with different IDs. The server has no way to detect or deduplicate these, resulting in duplicate raw_dumps + enriched_signals rows for what the user perceives as a single brain-dump event.
- **Fix:** Implement idempotency key support: (1) Accept Idempotency-Key header in handleEnrichDump. (2) Store/check a dedup cache in CACHE_KV under key `idempotency:<hash>` to return the same ID for retries within a TTL window (e.g. 1 hour). (3) If a duplicate is detected, return the original ID without re-queueing. Alternatively, use the client-supplied event_ts + user_hash + scrubbed_text hash as a natural dedup key stored in CACHE_KV with a short TTL.
- **Evidence:** `Line 125: 'const id = crypto.randomUUID();' — new ID generated unconditionally. No Idempotency-Key header check. The entry is queued with no request-dedup logic. The QueuedDump interface (line 74-89) has no idempotency_key or dedup_key fiel`

### POST /ingest-event lacks idempotency key and has no retry deduplication
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/telemetry.ts:168-224`
- **Problem:** handleIngestEvent() immediately INSERT rows to Supabase with no idempotency checking. If a client retries a failed /ingest-event call (e.g. due to network timeout), a duplicate row will be written to retention_events, session_events, module_events, etc. The ALLOWED_TABLES set (line 49-55) enforces table validation, but not request-level deduplication.
- **Fix:** Add idempotency key support to handleIngestEvent: (1) Accept Idempotency-Key header. (2) Check CACHE_KV for `idempotency:ingest:<key>` before calling Supabase. (3) On success, store a marker in CACHE_KV with TTL (e.g. 1 hour) indicating the request was processed, and return the same 200 response. (4) On retry, return 200 without re-inserting. Coordinate with the client to send a stable Idempotency-Key per user + timestamp + table + row.
- **Evidence:** `No Idempotency-Key header check or cache lookup before the Supabase fetch at line 199-209. The row is inserted directly: ''content-type': 'application/json'' → POST with no conflict handling. The POST /ingest-event docstring (line 18-19) st`

### enrichDump client call has no retry-with-idempotency-key logic
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/apps/native/src/api/workers.ts:241-248`
- **Problem:** The enrichDump() function is fire-and-forget on most call sites (docstring line 239-241). If it fails due to network/timeout, caller code does not send an Idempotency-Key header, so automatic retries (e.g. by app-level retry logic) will create duplicate queued dumps. The client has no mechanism to detect that a dump was already queued.
- **Fix:** Update enrichDump() to: (1) Generate or accept an idempotency_key (e.g. `crypto.randomUUID()` or hash of the dump text + timestamp). (2) Send it in the request body or as an Idempotency-Key header. (3) Store it client-side so retries can re-use the same key. Update EnrichDumpRequest type to include optional idempotency_key field.
- **Evidence:** `enrichDump() function: 'return post<EnrichDumpResponse>(..., { timeoutMs: opts.timeoutMs ?? 5_000 });' — the post() helper has no Idempotency-Key generation. Line 56-77 defines the 'post()' helper; it accepts extraHeaders but no standard id`

### N+1 query pattern in goals.listWithLatest()
- **Dimension:** Performance & Cost
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/goals/repo.ts:105-122`
- **Problem:** The listWithLatest() function calls goals.list() once, then runs a separate SQL query for each goal's latest progress event in a for loop. For N goals, this generates N+1 database queries. Should use a JOIN or batch the queries.
- **Fix:** Replace the sequential per-goal query loop with a single batched query using a GROUP BY subquery or LEFT JOIN: SELECT g.*, e.id as latest_event_id, e.logged_at ... FROM goals_registry g LEFT JOIN (SELECT goal_id, * FROM goals_events WHERE kind='progress' ORDER BY logged_at DESC) e ON g.id = e.goal_id to fetch all latest progress events in one round trip.
- **Evidence:** `for (const g of all) { const rows = await sql.select(...WHERE goal_id = ? AND kind = 'progress'...[g.id]...) }`

### Missing app language in /route/dump request
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/BrainDumpInput.tsx:187-194`
- **Problem:** The RouteDumpRequest sent to routeDump() does not include the user's app language (locale field). Although the RouteDumpRequest type supports an optional `locale?: string` field (api/types.ts:53), the native side never populates it. This breaks the contract for language-aware server-side routing: the worker cannot determine which language to respond in, falling back to English.
- **Fix:** Import `getAppLang()` and set `body.locale = getAppLang()` before the routeDump call. The app language is already available via the hook and stored in the settings.
- **Evidence:** `'''typescript
const body: RouteDumpRequest = {};
if (hasText) body.text = trimmed;
if (photo.image) body.image = photo.image;
// Missing: body.locale = getAppLang()
const res = await routeDump(body, { bearer });`

### Hardcoded English UI strings in MicButton error messages
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:71, 81, 83, 116, 124, 126`
- **Problem:** The MicButton component displays error and status messages entirely in hardcoded English: 'this app build can't reach the microphone', 'mic blocked — allow microphone access in System Settings', 'no microphone found', 'not signed in', 'heard nothing — try again', 'transcribe failed'. These are user-facing strings that ship to ES/TR users without translation.
- **Fix:** Extract these 6 error strings into a translatable map keyed by language (using useAppLang hook), following the pattern in @ollie/logic/brain/copy.ts (FALLBACK table). Provide EN/ES/TR translations.
- **Evidence:** `'''typescript
fail('this app build can\'t reach the microphone');
fail('mic blocked — allow microphone access in System Settings');
fail('not signed in');
fail('heard nothing — try again');`

### Hardcoded English in PhotoIntake error messages
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/PhotoIntake.tsx:45-54`
- **Problem:** The reasonCopy function returns 3 error messages entirely in English: 'This kind of photo isn't supported yet.', 'Photo is too large, try a smaller one.', 'Couldn't read that photo — try another.' These are displayed to users when photo upload fails.
- **Fix:** Replace the switch statement with a translatable map structure keyed by (reason, lang) following the FALLBACK pattern in @ollie/logic/brain/copy.ts. Import useAppLang in the hook.
- **Evidence:** `'''typescript
function reasonCopy(reason: 'unsupported_mime' | 'too_large' | 'decode_failed'): string {
  switch (reason) {
    case 'unsupported_mime':
      return "This kind of photo isn't supported yet.";
    case 'too_large':
      ret`

### Hardcoded English in BrainDumpInput error messages
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/BrainDumpInput.tsx:176, 217-223`
- **Problem:** The BrainDumpInput component shows error messages entirely in English: 'sign in to dump', 'Couldn't read the photo. Try again or type it out.', 'going too fast — your words are saved, try again in a few seconds', 'took too long — your words are saved, try again', 'no connection — your words are saved, try again', 'server hiccup ({{status}}) — your words are saved', 'something went wrong — your words are saved'.
- **Fix:** Build a translatable error message map keyed by (errorCode, lang). Import useAppLang and apply translations based on the current language. 7 distinct error messages need translation.
- **Evidence:** `'''typescript
state kind: 'error', message: 'sign in to dump' ...
message = isVisionFail ? "Couldn't read the photo..." :
code === 'unauthorized' ? 'sign in to dump' :
code === 'rate_limited' ? 'going too fast — your words are saved, try ag`

### Hardcoded English in CrisisBanner and crisis copy
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:303-308, 323`
- **Problem:** The CrisisBanner component shows hardcoded English crisis messaging: 'notice', 'Something in what you wrote sounded heavy. If it's urgent, a crisis line in your country can help right now.' The banner is critical safety UI shown to users in crisis and must ship in all three languages.
- **Fix:** Create a translatable crisis message component that uses useAppLang and surfaces the appropriate language copy. The kicker 'notice' and the body text each need EN/ES/TR versions.
- **Evidence:** `'''typescript
<Text scale="caption" color="rgb(140, 30, 30)" style={SMCP_STYLE}>
  notice
</Text>
<Text scale="body" color="rgb(80, 20, 20)">
  Something in what you wrote sounded heavy. If it's urgent, a crisis
  line in your country can h`

### Crisis lexicon approval status unclear for production readiness
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/packages/crisis-lexicon/data/lexicon.en.json:4`
- **Problem:** All three crisis lexicons (EN, ES, TR) have `"last_reviewed_by": "PENDING_SERRA_APPROVAL"` instead of a concrete reviewer signature. The comment in crisis-lexicon/src/index.ts explicitly states 'Lexicons are PENDING_SERRA_APPROVAL — `last_reviewed_by` must be `@serra` before any merge that ships to alpha.' This is a blocking approval gate for alpha release.
- **Fix:** Sierra must review and approve each lexicon (EN, ES, TR), then update `last_reviewed_by` to the approver's handle and `last_reviewed_at` to the approval date. This is a prerequisite before shipping the feat/brain branch to alpha.
- **Evidence:** `'''json
{
  "language": "en",
  "version": "0.1.0",
  "last_reviewed_by": "PENDING_SERRA_APPROVAL",
  "last_reviewed_at": "2026-05-25",`

### Critical untested pass1Segment function — brain-dump segmentation pass 1
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/segmentation.ts:53-82`
- **Problem:** pass1Segment is a core function that splits brain-dump text into sentence fragments and flags items needing pass-2 LLM segmentation. It is called on every brain-dump but has zero unit tests. The function contains complex logic for trilingual conjunction detection (TR/EN/ES), word counting, and pass-2 trigger heuristics (Decision A: words > 7 OR words > 4 with no conjunctions and no terminal punctuation). While briefly exercised in integration tests (dump.test.ts), the unit function lacks tests for edge cases: empty input, single-word fragments, regex global flag resets, edge boundaries of word count thresholds, and multi-language conjunctions.
- **Fix:** Create /Users/serrayildirim/ollie/workers/ai-proxy/tests/segmentation.test.ts with unit tests covering: (1) basic sentence splits (2) conjunction re-splitting in all three languages (3) word count boundary tests (4, 5, 6, 7, 8 words) (4) pass-2 trigger logic (5) edge cases: empty strings, single words, only punctuation (6) regex.lastIndex reset behavior (7) locale fallback to naive regex.
- **Evidence:** `export function pass1Segment(dump: string, locale: string = 'tr'): Pass1Result { ... }; grep finds zero unit tests mentioning 'pass1Segment'.`

### Critical untested jsonCascade — the provider fallback chain
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/json-cascade.ts:55-120`
- **Problem:** jsonCascade is the heart of the free-tier provider cascade fallback (Groq → Cloudflare → Gemini → OpenRouter). It's used by both pass-2 segmentation and classification. The function has no unit tests. This is the mechanism that prevents a single Groq `json_validate_failed` from silently collapsing multi-topic dumps (dogfood B3). The cascade logic needs to be tested: provider rotation, parse-rejection advancing the chain, final provider errors surfacing, partial failures mid-chain, and edge cases like all providers failing or parse rejecting all results.
- **Fix:** Create /Users/serrayildirim/ollie/workers/ai-proxy/tests/json-cascade.test.ts with tests for: (1) happy path — first provider succeeds (2) first provider throws, second succeeds (3) parse rejects first output, second provider called (4) all providers throw (5) parse rejects all outputs (6) partial cascade (e.g., only Groq + Gemini available) (7) label parameter passed through to logging.
- **Evidence:** `export async function jsonCascade<T>(...): Promise<T> { const chain = [...]; ... }; grep -r 'jsonCascade' in test files returns zero results.`

### Untested detectFragmentLanguage — language detection for all fragments
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/lang-detect.ts:116-166`
- **Problem:** detectFragmentLanguage runs on every fragment after pass-2 segmentation. It classifies text as 'tr'|'en'|'es'|'mixed'|'unknown' using stopword + diacritic scoring. No unit tests. The function has multiple scoring branches: stopword density, diacritic bumps, mixed-language threshold logic, fallback to 'en' for unanchored Latin text, and 'unknown' for no signals. These heuristics have no test coverage despite being used in all telemetry labels and potentially affecting downstream routing decisions if language context matters.
- **Fix:** Create /Users/serrayildirim/ollie/workers/ai-proxy/tests/lang-detect.test.ts with tests for: (1) pure Turkish (stopwords + diacritics) (2) pure English (3) pure Spanish (4) mixed-language at threshold boundary (5) no signals → fallback to 'en' or 'unknown' (6) edge cases: empty string, only punctuation, unanchored text (7) diacritic bumps correct for edge amounts (8) MIXED_THRESHOLD exact boundary (0.25).
- **Evidence:** `export function detectFragmentLanguage(text: string): FragmentLanguage { ... }; Language detection appears only in dump-coverage integration tests, not in unit tests.`

### Untested pass2Split function — LLM-based fragment re-splitting
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/segmentation-llm.ts:33-56`
- **Problem:** pass2Split wraps jsonCascade to run pass-2 segmentation on flagged fragments. It's used for any fragment flagged by pass1Segment's Decision A heuristic. The function has no unit tests. It validates the LLM's JSON output shape (expecting { fragments: string[] }) and trims/filters results. Without tests, the JSON shape validation, error messages, and edge cases (empty array, single-element array, whitespace handling) are untested.
- **Fix:** Create /Users/serrayildirim/ollie/workers/ai-proxy/tests/segmentation-llm.test.ts with tests for: (1) mock jsonCascade returning valid { fragments: [...] } (2) output trimming and filtering (3) shape validation rejects non-array (4) shape validation rejects array of non-strings (5) empty array result (6) single fragment (7) large array result (8) error messages capture provider name and snippet of bad JSON.
- **Evidence:** `export async function pass2Split(text: string, providers: JsonProviders): Promise<string[]> { return jsonCascade(...); }; grep -r 'pass2Split' in test files returns zero unit tests.`

### React version mismatch between @ollie/store and apps/native
- **Dimension:** Dependency Health
- **File:** `/Users/serrayildirim/ollie/packages/store/package.json:18`
- **Problem:** @ollie/store declares a peer dependency of react>=18 but pins devDependency to ^18.3.1. However, apps/native uses ^19.1.0, which introduces React 19.2.6. The store package's @types/react is ^18.3.12 (resolves to 18.3.28), creating a type mismatch when native app's React 19 types are used with the store's React 18 types. This will cause type errors in components using useStoreSlice.
- **Fix:** Update @ollie/store's @types/react to ^19.1.0 in devDependencies to match the actual React version being used by dependent packages (apps/native). Alternatively, constrain apps/native's React to 18.x if compatibility is required.

## MEDIUM — 53

### Service-role API key exposed in request body for Supabase REST calls lacks transport security validation
- **Dimension:** Security & Authorization
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:107-108`
- **Problem:** Service-role credentials are sent in Authorization headers to Supabase REST endpoints. While these calls are made from a Worker (not client-side), if Supabase URL is misconfigured (e.g., to a MITM-able internal network) or if there's an HTTP fallback, credentials could be intercepted. The code also constructs URLs with user-controlled input (invitation codes) in query parameters.
- **Fix:** Ensure SUPABASE_URL is validated as HTTPS-only at startup and use a URL validation library to prevent protocol downgrade. Consider using Supabase's admin SDK instead of raw REST calls for better encapsulation.
- **Evidence:** `const resp = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE,
        authorization: 'Bearer ${env.SUPABASE_SERVICE_ROLE}',
        p`

### Invitation endpoint does not validate inviter_user_hash or invitee_user_hash format
- **Dimension:** Security & Authorization
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:75-76, 219-220`
- **Problem:** The /generate-invite and /claim-invite endpoints accept inviter_user_hash and invitee_user_hash as opaque strings without format validation. The code checks only that they are non-empty strings. An attacker could submit arbitrary strings, and if the frontend relies on the hash to de-anonymize invitations, malformed hashes could cause unexpected behavior or information leakage in subsequent queries.
- **Fix:** Add validation that inviter_user_hash and invitee_user_hash match the expected format (e.g., SHA-256 hex = 64 chars, or base64). If they should be 256-bit hashes, enforce length and character set constraints.
- **Evidence:** `if (!body || typeof body.inviter_user_hash !== 'string' || !body.inviter_user_hash) {
    return json({ error: 'invalid_payload' }, 400);
  }`

### Account deletion endpoint does not enforce rate limiting on retry attacks
- **Dimension:** Security & Authorization
- **File:** `/Users/serrayildirim/ollie/apps/api/src/account-delete.ts:134-256`
- **Problem:** The account deletion endpoint verifies the JWT and confirm token correctly but does not implement rate limiting on failed deletion attempts. An attacker with a valid JWT could retry the endpoint rapidly, potentially causing resource exhaustion or race conditions during the cascade delete. The endpoint is not gated behind a rate limiter like other sensitive operations.
- **Fix:** Add per-user rate limiting on the account-delete endpoint (e.g., 1 attempt per 5 minutes per user_id). Use the same rate-limiter binding as telemetry endpoints or a dedicated rate-limit bucket.
- **Evidence:** `export async function handleAccountDelete(
  req: Request,
  env: AccountDeleteEnv,
): Promise<Response> {
  const result = await runAccountDelete(req, env, { fetchImpl: fetch.bind(globalThis) });
  if (result.ok) {
    return Response.json`

### JWT verification falls back to legacy Supabase auth without issuer validation in dual-mode
- **Dimension:** Security & Authorization
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:364-400`
- **Problem:** The verifyJwt function in the invites module implements a dual-mode fallback: try Clerk first, then Supabase if Clerk rejects. The Supabase fallback calls GET /auth/v1/user without validating the issuer claim. A JWT signed by a different provider but accepted by Supabase Auth (e.g., a legacy Supabase JWT from a different instance) could be accepted if the Supabase instance was misconfigured or if session tokens from another environment leaked.
- **Fix:** Add issuer validation: after Supabase /auth/v1/user succeeds, verify the JWT's iss claim matches the expected Supabase issuer URL. Alternatively, set a sunset date for the Supabase fallback and remove it once all legacy sessions have expired.
- **Evidence:** `export async function verifyJwt(
  jwt: string,
  env: {
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    CLERK_ISSUER?: string;
  },
): Promise<string | null> {
  // Clerk path — try first when configured.
  if (env.CLERK_ISSUE`

### Sensitive device tokens logged to console
- **Dimension:** Secrets & Token Exposure
- **File:** `/Users/serrayildirim/ollie/packages/notifications/src/backends/capacitor.ts:277`
- **Problem:** The capacitor backend logs device token prefixes (first 12 chars + ellipsis) to console when no worker endpoint is configured. Device tokens are sensitive identifiers used to route push notifications and could be correlated with user activity. While truncated, the prefix is still exposed in logs.
- **Fix:** Remove or gate this log behind a dev-only flag (import.meta.env.DEV). If debugging is needed, hash the token instead of logging the prefix directly. This fallback path should only occur during development, never in production.
- **Evidence:** `console.log('[notify · capacitor] device token captured (no worker endpoint set):', t.slice(0, 12) + '…'); logs partial device token`

### Non-atomic cost tracking race condition in /label endpoint
- **Dimension:** Input Validation
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/label.ts:135-144`
- **Problem:** The daily label budget tracking uses a simple KV read-then-write pattern without atomicity. Multiple concurrent requests can race and each see the same used value, allowing concurrent spending to exceed the daily budget. While the endpoint fails open (returns 503 instead of blocking), budget enforcement is effectively broken.
- **Fix:** Use Durable Objects or a dedicated counter service for atomic increments. Alternatively, if acceptable, accept the race condition as documented and remove the false impression of budget enforcement. Or use a safer strategy: always check BEFORE making the expensive call and keep a separate 'pending' counter for in-flight requests.
- **Evidence:** `const usedRaw = await env.CACHE_KV.get(todayKey);
const used = usedRaw ? parseFloat(usedRaw) || 0 : 0;
... (later) ...
const newUsed = used + ESTIMATED_COST_PER_CALL_USD;
await env.CACHE_KV.put(todayKey, String(newUsed), { expirationTtl: 60`

### Duplicated regex boundary pattern logic in admin and work modules
- **Dimension:** Reinvented Wheels & Duplication
- **File:** `packages/logic/src:admin/constants.ts:5-18, work/constants.ts:15-18`
- **Problem:** The word-boundary regex pattern wrapper (_LEFT, _RIGHT, _wrap) is duplicated across two modules: admin/constants.ts and work/constants.ts. Both define identical utility functions and constants to build multilingual keyword-detection regexes. This is a textbook case of copy-pasted utility logic that should be refactored into a single shared location.
- **Fix:** Extract the _LEFT, _RIGHT, and _wrap helpers to packages/logic/src/util/regex-boundaries.ts, then import and re-export from both admin/constants.ts and work/constants.ts. This centralizes regex pattern logic and ensures consistent regex compilation across modules.
- **Evidence:** `admin/constants.ts lines 5-7 define _L='(?:^|...)' _R='(?=...)', work/constants.ts lines 15-18 define identical _LEFT/_RIGHT/_wrap. Both modules use identical pattern: new RegExp(_L + '(?:' + alts.join('|') + ')' + _R, 'iu')`

### Logic package allows bypassing of orchestrator via submodule exports
- **Dimension:** File & Module Structure
- **File:** `/Users/serrayildirim/ollie/packages/logic/package.json:8-27`
- **Problem:** The @ollie/logic package declares all submodules (cycle, brain, finance, crisis, meditation, etc.) as public exports via its package.json exports field. This enables apps/native and apps/api to import directly from @ollie/logic/brain, @ollie/logic/cycle, etc. instead of consuming logic through the @ollie/orchestrator facade, violating the intended layering where orchestrator should be the primary consumer and re-exporter of logic submodules. While the logic package does export a top-level interface, it also exposes 17 submodule entry points that should be internal-only.
- **Fix:** Remove submodule exports from @ollie/logic/package.json exports field. Keep only the root export ("."). Force all apps (native, api) to import from @ollie/orchestrator or directly from @ollie/logic (which re-exports via `export * as X`). This restores the boundary: orchestrator becomes the sole direct consumer of logic submodules, and apps treat orchestrator as the orchestration facade.
- **Evidence:** `package.json exports: "./cycle": "./src/cycle/index.ts", "./brain": "./src/brain/index.ts", etc. (lines 10-27). apps/native imports: 'from '@ollie/logic/brain'' (6+ files), 'from '@ollie/logic/cycle'', 'from '@ollie/logic/crisis'', etc. app`

### Untyped module globals in crypto package
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/crypto/src/index.ts:85-86`
- **Problem:** The getRandomValues helper casts crypto.getRandomValues parameter type as `any` with a comment to disable eslint. This allows callers to pass any value without validation, bypassing runtime safety for critical security-sensitive crypto operations.
- **Fix:** Use proper types: `getRandomValues?: (buffer: ArrayBufferView) => ArrayBufferView` and remove the any escape hatch. The function signature is standardized in Web Crypto API.
- **Evidence:** `// eslint-disable-next-line @typescript-eslint/no-explicit-any
    crypto?: { getRandomValues?: (a: any) => any };`

### Unsafe `as unknown as Record<string, unknown>` in finance merge
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/finance/merge.ts:41`
- **Problem:** FinanceRecord is cast through `unknown` to `Record<string, unknown>` to perform a dynamic key assignment. This bypasses type safety and could allow invalid keys/values into the financial record if the loop inadvertently processes unexpected properties.
- **Fix:** Use a type-safe assignment: either narrow the key type with `as const` or use a validated set of allowed keys. Alternatively, use Object.assign() with properly-typed partials: `Object.assign(out, { [k]: v })`.
- **Evidence:** `(out as unknown as Record<string, unknown>)[k] = v;`

### Unsafe module handler casting in router stubs
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/stubs.ts:94-109`
- **Problem:** All module handlers are cast individually with `as unknown as ModuleHandler<Module>` to fit them into a Record<Module, ...> type. This suggests the handler types don't properly match the union type, hiding structural mismatches that could cause runtime errors.
- **Fix:** Investigate why each handler needs the unsafe cast. Define a common handler type that all module-specific handlers conform to without casting, or use a type-safe registry builder that validates each handler's shape at compile time.
- **Evidence:** `grocery: groceryHandler as unknown as ModuleHandler<Module>,
  pets: petsHandler as unknown as ModuleHandler<Module>,
  finance: financeHandler as unknown as ModuleHandler<Module>,
  ...`

### Unsafe `as T` cast in API client JSON parsing
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/api/src/client.ts:199`
- **Problem:** The api client casts JSON response directly to the generic type T with `(await res.json()) as T` without any validation. If the server returns unexpected shape, the cast succeeds silently and corrupted data flows to callers.
- **Fix:** Add runtime validation using a Zod schema or TypeGuard function. Create a parseJson<T>(schema: ZodSchema) overload that validates before casting, or inject a validator callback for high-risk endpoints.
- **Evidence:** `const data = (await res.json()) as T;
        return { ok: true, data, status: res.status };`

### Double unsafe cast in journal extraction validation
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/journal/extract.ts:281`
- **Problem:** Emotions array is cast through `as unknown[]` during validation loop, losing type information. If the array contains non-string values, the type system won't catch it until the subsequent typeof check at runtime.
- **Fix:** Assert the type earlier: check `Array.isArray(e['emotions'])` and narrow with a type guard, then iterate without the unsafe cast. Use a helper: `const emotions = Array.isArray(e['emotions']) ? e['emotions'] : []`.
- **Evidence:** `for (const em of e['emotions'] as unknown[]) {
      if (typeof em !== 'string') { errors.push('emotion is not a string'); continue; }`

### Unhandled promise rejection in research-stream trackTable fire-and-forget
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/packages/research-stream/src/index.ts:211-219`
- **Problem:** The trackTable method fire-and-forgets a fetch without error handling in certain edge cases. While there is a catch handler, the try-catch at line 211 only wraps the fetch call initiation; if f() throws synchronously before returning a promise, the error is swallowed. More importantly, the pattern void f(...).catch(() => {}) is correct but could silently fail if the callback throws.
- **Fix:** Add explicit error logging to the catch handler to make failures visible: `.catch((e) => console.error('[research] trackTable failed', e));` instead of silently ignoring.
- **Evidence:** `'''typescript
void f(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: 'Bearer ${jwt}',
  },
  body: JSON.stringify({ table, row }),
}).catch(() => { /* best-effort */ });
'''`

### Missing error handling on cache write operations in dump router
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:361-371`
- **Problem:** Cache upsert failures are logged but do not block response or retry. While fire-and-forget is intentional for performance, repeated failures will silently prevent caching, causing repeated AI calls on identical fragments and wasting tokens. No circuit breaker or exhaustion limit exists.
- **Fix:** Track consecutive cache write failures and emit a metric/alert if failures exceed threshold (e.g., 10 in a session). Consider short retry-after backoff for transient failures.
- **Evidence:** `'''typescript
keepAlive(
  cacheUpsert(env.VECTORIZE_INDEX, {
    userId,
    text: m.text,
    embedding: m.embedding,
    module: tiered.module,
    payload: tiered.payload,
    confidence: result.confidence,
    language: m.language,
  }`

### Supabase REST error responses not fully parsed on network errors
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/apps/api/src/worker.ts:234-241`
- **Problem:** In supabaseSelect(), if the HTTP response is not ok, the error body is extracted via await res.text(). However, if res.text() itself fails (e.g., streaming error), the exception is caught and null is returned, losing the original error code. This masks whether the failure was network, 5xx, or malformed response.
- **Fix:** Use safeText pattern with explicit fallback: `const detail = await safeText(res) ?? `<unreadable: ${res.status}>`; console.error('[cron] supabaseSelect failed', table, res.status, detail);`
- **Evidence:** `'''typescript
if (!res.ok) {
  console.error('[cron] supabaseSelect failed', table, res.status, await res.text());
  return null;
}
'''`

### Upsert response parsing assumes successful write on 200 OK without verifying row count
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:318-322`
- **Problem:** insertRawDump() and insertEnrichedSignal() check res.ok but do not verify the response body contains the expected shape or number of rows. If Supabase returns 200 with an error in the JSON or partial write, the code treats it as success and deletes the KV entry, losing the data permanently.
- **Fix:** Parse response and validate: `const data = await resp.json(); if (!data || data.length === 0) throw new Error('upsert returned no rows');`
- **Evidence:** `'''typescript
if (!resp.ok) {
  throw new Error('push_tokens upsert http ${res.status}');
}
return dump.id;
'''`

### Empty catch block hides decryption errors in sync inbound path
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/packages/sync/src/index.ts:238-252`
- **Problem:** In syncIn(), when decrypting a remote row fails, the error is logged but the loop continues, skipping that row silently. If decryption fails due to a key mismatch (e.g., user changed password, key not rotated), ALL inbound rows fail and the local store becomes stale without user awareness.
- **Fix:** Track consecutive decryption failures and emit an alert if a threshold is exceeded: `decryptFailures.push(row.module); if (decryptFailures.length > 3) events.emit('sync:mass_decrypt_failure', {...});`
- **Evidence:** `'''typescript
for (const row of r.data ?? []) {
  try {
    const ciphertext = base64ToBytes(row.ciphertext);
    const iv = base64ToBytes(row.iv);
    const data = await decryptData<Record<string, unknown>>(deps.encryptionKey, { ciphertext`

### Fire-and-forget Promise.all without proper error boundary in dispatch post-sync chain
- **Dimension:** Async & Concurrency
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/dispatch.ts:95-109`
- **Problem:** The Promise.all at line 95 chains two promises: runAllSyncs (which is guaranteed to resolve, not reject per bridge/index.ts line 68) and recordMoodFromDump (which has a .catch). The .then at line 105 calls recomputeBrain, which is also a fire-and-forget and catches its error at line 106. While error handling is present, the comments claim runAllSyncs 'resolves-not-rejects' but if that contract is violated in future, the floating promise would fail silently. The pattern is also fragile: if recomputeBrain throws synchronously before awaiting anything, it would reject the entire chain.
- **Fix:** Either: (1) Add explicit .catch on runAllSyncs as well to enforce the 'never rejects' contract, or (2) wrap recomputeBrain call in .then(async () => { await recomputeBrain(...) }) to ensure any synchronous throws are caught by the existing .catch.
- **Evidence:** `  void Promise.all([
    runAllSyncs(store),
    recordMoodFromDump(store, output.originalDump).catch((err) => {
      console.error('[bridge] recordMoodFromDump failed (non-fatal):', err);
    }),
  ])
    .then(() => recomputeBrain(store)`

### Unhandled rejection potential in cadence-scanner boot timer
- **Dimension:** Async & Concurrency
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/cadence-scanner.ts:445-450`
- **Problem:** The boot scan is scheduled with setTimeout at line 445-450. Inside the timer callback, scanOnce() is called with a fire-and-forget pattern (void scanOnce().catch(...)). If scanOnce itself throws synchronously before returning a promise, the .catch won't catch it. While this is low risk given the function structure, the pattern is fragile. Additionally, if the Orchestrator's init() is called multiple times before teardown, bootTimer is cleared but the logic doesn't prevent a stale reference issue.
- **Fix:** Wrap the scanOnce call in an async IIFE to ensure any synchronous errors are converted to rejections: `void (async () => { await scanOnce(); })().catch(...)`.
- **Evidence:** `      bootTimer = setTimeout(() => {
        bootTimer = null;
        void scanOnce().catch((err) => {
          console.error('[cadence-scanner] boot scan failed', err);
        });
      }, bootDelayMs);`

### Delete loop processing without all-or-nothing semantics in finance sync
- **Dimension:** Async & Concurrency
- **File:** `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:380-395`
- **Problem:** The delete loop at lines 380-395 processes each delete sequentially with await. If a delete API call fails (lines 385-394), the code returns early to retry. However, deletes that succeeded BEFORE the failure are not removed from the queue until line 397 (which is only reached if ALL deletes succeed). If the first delete succeeds and the second fails, the first delete will be re-attempted on the next drain cycle, potentially causing a silent retry loop or duplicate deletion attempts.
- **Fix:** Track which deletes succeeded within the loop and remove only those from the queue, even on partial failure. Example: collect succeeded ids in a Set, and at the end (before the retry return), filter the queue to remove only succeeded items.
- **Evidence:** `    for (const d of q.deletes) {
      const r = await deps.api.supabase.rest.delete<unknown>(TABLE, { ... });
      if (!r.ok) {
        // ... return early (line 394) ...
        drainScheduler.scheduleRetry();
        return;  // Line 39`

### Large monolithic config file with data tables and code mixed
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/modules/grocery.config.ts:1-1820`
- **Problem:** The grocery.config.ts file contains 1820 lines mixing configuration data (shelf-life maps, aliases, canonical items spanning 700+ lines) with utility functions (lookupShelfLife, buildSystemPrompt, buildFunctionSchema). This makes the file difficult to navigate and test. The SHELF_LIFE_DETAIL object alone spans from line 218-987 with hundreds of entries that could live in a separate data module.
- **Fix:** Extract SHELF_LIFE_DETAIL, ALIAS_MAP, CANONICAL_ITEMS, and CRITICAL_REMINDER_CANONICAL into a separate grocery-data.ts file. Keep only the ModuleConfig builder and lookup utilities in grocery.config.ts. This follows the pattern already established in @ollie/logic/grocery/data.ts.
- **Evidence:** `Lines 218-988 contain a massive Record<string, ShelfLifeEntry> definition with ~400 shelf-life entries; lines 1001-1197 contain ALIAS_MAP with 100+ entries; utility functions at lines 1198+. This creates a 1820-line god module.`

### Complex nested async state machine in braindump-dispatch
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:721-847`
- **Problem:** The grocery routing logic (lines 721-847) implements a complex state machine with two paths (mutation vs. non-mutation), conditional placeholder writes, async AI calls, fallback logic, and event emissions. The ~130-line void async IIFE (lines 758-847) contains 4 levels of nesting with multiple conditional branches, making the flow hard to follow. The logic for deciding when to write vs. suppress placeholder and when to apply mutations is spread across multiple if/else blocks.
- **Fix:** Extract the async mutation logic into a separate function `applyAIGroceryResult()` that takes (result, isMutation, store, ts, opts) and returns void. Further refactor the 'add' vs 'mutation' paths into separate functions to reduce nesting. For example: `applyGroceryAdd()` and `applyGroceryMutation()` as siblings called from the result handler. This improves testability and readability.
- **Evidence:** `Lines 758-847 contain a single void async IIFE with: initial if/else (isMutation branch), async callGroceryRoute(), then nested if checking result.items.length > 0, which branches on isMutation again with separate store.update calls for 'mu`

### No noUnusedLocals/noUnusedParameters enforcement in package tsconfigs
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/packages`
- **Problem:** Only apps/native/tsconfig.json sets noUnusedLocals: true and noUnusedParameters: true. All packages extend tsconfig.base.json which does not enable these checks. The eslint rule @typescript-eslint/no-unused-vars catches this at warn level, but TypeScript-level checking would catch issues earlier. This gap means unused variables can slip past if eslint isn't run.
- **Fix:** Consider adding noUnusedLocals: true and noUnusedParameters: true to tsconfig.base.json if the codebase is mature enough, or at minimum document why these are intentionally omitted. Since eslint catches this, ensure lint is always run in CI before typecheck.
- **Evidence:** `apps/native/tsconfig.json: "noUnusedLocals": true, "noUnusedParameters": true; but packages/api/tsconfig.json and others inherit base with no such flags`

### Sparse embeddings array if Voyage response indices are non-sequential
- **Dimension:** Dump Routing Flow Correctness
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:449-459`
- **Problem:** voyageEmbedBatch creates a pre-allocated array `out: number[][] = new Array(texts.length)` and assigns embeddings to slots based on the response's `.index` field (or array position as fallback). If Voyage returns rows with non-sequential or out-of-order indices (e.g., slots [0, 2] but not [1]), the result is a sparse array with undefined holes. Downstream code at line 276 (`const embedding = embeddings[i]`) would then access undefined values, which are later passed to cacheHitBump or pushed into misses. While the comment assumes 'response is already input-ordered', there is no runtime validation that all slots are filled.
- **Fix:** After the forEach loop, validate that no undefined elements exist in the output array, or use the array's index order directly without relying on Voyage's response `.index` field. For safety: `if (!Array.isArray(embedding) || embedding.length !== VOYAGE_EMBED_DIM) throw ...` before using embeddings[i].
- **Evidence:** `Line 456: 'const slot = typeof row.index === 'number' ? row.index : i; out[slot] = row.embedding;' can create sparse arrays. Line 446 only validates 'rows.length !== texts.length', not that all indices fill the array contiguously. Then line`

### Deduplication algorithm in selectNoticings uses O(n²) approach with nested findIndex
- **Dimension:** Algorithms Correctness & Efficiency
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/brain/select.ts:335`
- **Problem:** The deduplication filter uses arr.findIndex() inside the filter callback, resulting in O(n²) complexity for candidate lists. With the MAX_NOTICINGS cap of 3, this is not a practical concern now, but as the system scales to more candidates, this could become slow for large candidate arrays (hundreds+ items).
- **Fix:** Replace the nested findIndex approach with a Set-based deduplication: const seen = new Set(); return candidates.filter((c) => { if (seen.has(c.id)) return false; seen.add(c.id); return true; }). This reduces complexity to O(n) and is faster even for small lists.
- **Evidence:** `.filter((c, i, arr) => arr.findIndex((o) => o.id === c.id) === i)`

### cycle.lastEditedByCycle always written as empty object; edit-recency detection disabled
- **Dimension:** State & Store Consistency
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/cycle/bridge.ts:150`
- **Problem:** The cycle bridge always writes `cycle.lastEditedByCycle` as an empty `{}`, per the documented gap. The orchestrator uses this key to suppress recent-edit health flags for 72h after a user manually logs a period. With no edit tracking in SQLite, the suppress logic never fires—users will see redundant 'period late' or 'missed pill' flags even seconds after logging the event themselves.
- **Fix:** Add a `last_edited_at` column to cycle_events (or a separate cycle_edits table) to track when each cycle item was logged. The bridge should then populate cycle.lastEditedByCycle with the actual edit timestamps so the 72h suppression window works as designed.
- **Evidence:** `// No per-cycle edit-recency in SQLite — fail-open, same as the watcher default.
  store.set('cycle', 'lastEditedByCycle', {});`

### sleep.windDownLog read-merged but may contain stale entries if a subscriber never fires
- **Dimension:** State & Store Consistency
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/sleep/bridge.ts:179-180`
- **Problem:** The sleep bridge read-merges the existing windDownLog (preserving any entries added by event subscribers) rather than replacing it. However, the only source of windDownLog entries is the `sleep:wind_down_step` event subscription. If that subscriber is unregistered or never initialized, the windDownLog will never be populated. The bridge preserves whatever is there, so a cold-start (no prior events) leaves it empty, but if a user manually deletes steps they'll stay preserved forever since the bridge never clears stale entries.
- **Fix:** Clarify the ownership: either (1) the bridge should be the authoritative source and read wind_down events from SQLite (currently it doesn't), or (2) only event subscribers write it and the bridge should not touch it. The current hybrid (read-merge without understanding when it's written) creates orphan entries that can never be pruned.
- **Evidence:** `const existingWindDown = store.get<WindDownLogEntry[]>('sleep', 'windDownLog', []) ?? [];
  store.set('sleep', 'windDownLog', Array.isArray(existingWindDown) ? existingWindDown : []);`

### sleep.medsLog same owner ambiguity as windDownLog—may be populated by medication bridge, never cleared
- **Dimension:** State & Store Consistency
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/sleep/bridge.ts:187-189`
- **Problem:** The sleep bridge documents that medsLog is fed by a separate medication-module flow (dump mood/med routing), but it read-merges the existing medsLog without populating it from SQLite. The medication bridge (modules/medication/bridge.ts) does not write to medsLog either. So on a cold start, sleep.medsLog is empty; on a warm start, entries from prior runs are preserved forever. The docstring calls this a 'GAP' but the code leaves it broken.
- **Fix:** Either: (1) wire the medication module to write its dose logs into sleep.medsLog so detectMedicationTimingDrift has real data, or (2) remove the read-merge and leave it empty until the cross-feed is built. Document which path the team chooses so the watcher's contract is explicit.
- **Evidence:** `const existingMeds = store.get<MedsLogEntry[]>('sleep', 'medsLog', []) ?? [];
  store.set('sleep', 'medsLog', Array.isArray(existingMeds) ? existingMeds : []);`

### pets.coregulation_log read-merged but only populated by dump mood flow, never pruned
- **Dimension:** State & Store Consistency
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/pets/bridge.ts:160-165`
- **Problem:** The pets bridge read-merges coregulation_log, which it documents is 'fed by the dump mood/pet-mention flow, NOT by this SQLite mirror.' However, there's no mechanism to prune old entries. If a user logs a pet mood mention, it appends to the log; if they later delete that dump, the coregulation entry stays in the store forever because the bridge never re-syncs it from SQLite.
- **Fix:** Define a TTL or cap for coregulation_log entries (e.g., keep only the last 100 or entries < 90 days old), then apply it in the bridge's read-merge step. Alternatively, sync the log from SQLite (if the dump mood router writes to a coregulation_events table) so deletions propagate.
- **Evidence:** `// existing coregulation_log entries are never cleared by this sync;
 // read-merge means entries that came from dump mood routing stick forever`

### admin.phoneTasks key read but never written; admin task watcher sees empty array
- **Dimension:** State & Store Consistency
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/admin.ts:~120`
- **Problem:** The admin orchestrator reads `admin.phoneTasks` to scan for phone-related admin tasks, but no native app bridge or orchestrator path writes this key. The admin module has no UI to capture phone tasks (unlike admin.tasks, which comes from voice capture). The watcher silently sees an empty array and never emits admin:phone_reminder_due events.
- **Fix:** Either: (1) wire a phone task capture UI (voice notes or manual entry) into apps/native and have the admin bridge mirror it into admin.phoneTasks, or (2) remove the read and the empty cue from the admin watcher since there's no capture source.
- **Evidence:** `store.get('admin', 'phoneTasks', []) — written nowhere in the codebase`

### Fragment.payload type mismatch: worker uses Record<string, unknown>, native expects ActionPayload discriminated union
- **Dimension:** API Contract Consistency
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:46`
- **Problem:** The worker's dump-schema defines Fragment.payload as Record<string, unknown> (line 46), while the native schema defines it as ActionPayload (a discriminated union of 13+ action types, apps/native/src/router/schema.ts line 88). This causes TypeScript friction: the native app has to manually cast payloads with `as { action?: string }` (DumpScreen.tsx lines 118, 122, 134) rather than having compile-time type safety. The runtime behavior is correct since JavaScript objects are compatible, but the type contract is weak.
- **Fix:** Share the ActionPayload discriminated union type between the worker and native app by moving it to a shared package (e.g., packages/router-schema or packages/api), then import and use it in both dump-schema.ts and schema.ts. This provides compile-time exhaustiveness checking for action matching.
- **Evidence:** `Worker dump-schema.ts line 46: 'payload: Record<string, unknown>;'. Native schema.ts line 88: 'payload: ActionPayload;'. Native app DumpScreen.tsx line 118: 'const pl = f.payload as { action?: string };'.`

### KV-based retry counter has no jitter; lock-step 5-min retries cause thundering herd
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:160-162`
- **Problem:** When a drainEnrichQueue attempt fails on entry N, it increments q:enrich:retry:<id> and leaves the live entry unchanged. On the next 5-min cron tick, the SAME entries re-process (scanned, failed again, retry counter increments). With no jitter or backoff, all failures hit Anthropic/Supabase at the same clock tick every 5 minutes, creating a thundering herd pattern. At scale (hundreds of pending entries), this could trigger cascading failures.
- **Fix:** Add exponential backoff + jitter to the KV queue: (1) Store retry metadata `{count, next_retry_at}` alongside the retry counter. (2) When incrementing retry count, set `next_retry_at = now + (2^count * 1000ms + random(0, 1000ms))` to spread retries. (3) In drainEnrichQueue, skip entries where `next_retry_at > now`. Alternatively, migrate to Cloudflare Queues (item #4, already in DEPLOY_TODO) which owns built-in retry/backoff via wrangler.toml settings.
- **Evidence:** `Line 146-162: On exception, bumpRetry(env.CACHE_KV, parsed.id) increments counter. The entry is left alive, and on the next tick (5 min later, exactly), the BATCH_CAP (50) failed entries re-execute with zero jitter. The comment 'else: leave`

### MAX_RETRIES=12 (~1 hour) may be too aggressive for transient failures; no configurable backoff
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:78`
- **Problem:** MAX_RETRIES is hardcoded to 12 (line 78), which at 5-min intervals = 60 minutes. For a single transient Anthropic/Supabase outage (e.g., 30 min of degradation), valid entries will be moved to DLQ after only 6 retries (~30 min), losing data. The Cloudflare Queue config (wrangler.toml line 62) also sets max_retries=12, creating a hard cutoff with no exponential backoff.
- **Fix:** Increase MAX_RETRIES to 36+ (3 hours) or make it configurable via env var. Implement exponential backoff so early retries happen quickly (1-5 min) but later retries spread to 15-30 min intervals. For the Cloudflare Queue path (item #4), add `max_retry_delay` config to wrangler.toml once supported, or manually implement delay via metadata.
- **Evidence:** `Line 78: 'const MAX_RETRIES = 12;' — hardcoded. Line 151-161: After 12 retries, entry is moved to 'dlq:enrich:<id>'. The wrangler.toml queue consumer (line 62) has 'max_retries = 12' but no 'max_retry_delay' or backoff config. No jitter mea`

### flushNotificationQueue updateJob PATCH has no optimistic concurrency guard
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:455-477`
- **Problem:** updateJob() includes a WHERE status='pending' guard (line 464), which is correct for idempotency — a PATCH where the status is no longer 'pending' will no-op. However, the code does NOT verify the response row count or check if the PATCH actually matched a row. If another process changes the job's status between the SELECT and the PATCH, the PATCH silently succeeds (0 rows modified) but the code does not detect this, leaving stats inconsistent.
- **Fix:** Check the Supabase PATCH response: (1) Add `prefer: 'return=representation'` to get the updated row back (or `prefer: 'count=exact'` to get the Content-Range header). (2) Parse the header or row count to verify the update actually matched. (3) If 0 rows matched, log a warning (another process beat us to it — this is OK for idempotency) but do NOT double-increment stats. For strictness, consider returning a boolean from updateJob to indicate whether the PATCH succeeded.
- **Evidence:** `Line 464: 'const url = ${base}/rest/v1/scheduled_jobs?id=eq.${id}&status=eq.pending};' — correct guard. But line 466-473: the code calls 'fetch()' and checks '!resp.ok', but does NOT parse response row counts or check Supabase's returned 'C`

### No idempotency tracking for POST /partner/snapshot upserts
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/partner.ts:173-179`
- **Problem:** putSnapshot() uses `prefer: 'return=minimal,resolution=merge-duplicates'` (line 176) to handle duplicate upserts, which is correct. However, there is no Idempotency-Key header in the request, and no client-side idempotency tracking. If the client retries due to timeout/network error while the original request was still in-flight, two identical snapshot rows MAY be written with race conditions on the upsert merge.
- **Fix:** Add Idempotency-Key header to the PATCH/upsert call: (1) Client generates a stable key (e.g., hash of the snapshot content + timestamp). (2) Server stores the key in CACHE_KV during the upsert with a TTL. (3) On retry, return the cached response without re-upserting. Alternatively, rely on the `user_id` PK + updated_at timestamp ordering to ensure the DB keeps only the latest snapshot per user (which is the current behavior).
- **Evidence:** `Line 173-180: putSnapshot constructs row with 'user_id: me' (the PK), and uses merge-duplicates prefer. But the request headers (line 183-187) have no Idempotency-Key. If two requests arrive concurrently with the same user_id and updated_at`

### Tables created without explicit public schema prefix
- **Dimension:** DB, Migrations & Schema
- **File:** `/Users/serrayildirim/ollie/supabase/migrations/20260522000001_grocery_purchase_history.sql:11`
- **Problem:** Five tables are created without the explicit `public.` schema prefix: grocery_purchase_history, cook_history, partner_codes, partner_pairs, partner_snapshots. While these will default to the public schema in Supabase, explicit schema qualification is a best practice for clarity and to ensure migrations work consistently across different schema configurations. This is inconsistent with other tables which use `public.tablename`.
- **Fix:** For consistency and safety in future migrations, prefix these CREATE TABLE statements with `public.`. Change `CREATE TABLE grocery_purchase_history (` to `CREATE TABLE public.grocery_purchase_history (` and similarly for cook_history, partner_codes, partner_pairs, and partner_snapshots.
- **Evidence:** `CREATE TABLE grocery_purchase_history (
  ...
-- vs. the pattern used elsewhere:
create table if not exists public.encrypted_state (`

### Duplicate buildBasePrompt() calls in feed-me router
- **Dimension:** Performance & Cost
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:269, 908, 981`
- **Problem:** buildBasePrompt() is called three times per /feed-me request: once at line 269 to build the JSON cascade system prompt, then again in geminiSuggest() at line 908 and in groqSuggest() at line 981. This duplicates expensive prompt construction work even though only one provider will ultimately run.
- **Fix:** Compute buildBasePrompt() once in handleFeedMe, then pass the result object (systemPrompt, userTurn, config) to both geminiSuggest and groqSuggest instead of having them rebuild it. This avoids duplicate config assembly and prompt formatting when only one provider will execute.
- **Evidence:** `const { systemPrompt: jsonSystem, userTurn } = buildBasePrompt(...); ... geminiSuggest calls buildBasePrompt(...); groqSuggest calls buildBasePrompt(...)`

### Retry with hardcoded 1s delay in vision extraction has no exponential backoff
- **Dimension:** Performance & Cost
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vision.ts:76-82`
- **Problem:** When Gemini returns 429 (rate limit), the code sleeps 1000ms then retries once with no exponential backoff. If the retry also hits 429, it fails immediately without attempting backoff or falling back to another provider. During peak load, this may waste Gemini budget on guaranteed retries.
- **Fix:** Implement exponential backoff (e.g., 1s, then 2s on retry) and consider adding a fallback to Cloudflare Workers AI or returning a graceful static fallback for vision extraction failures. Alternatively, integrate vision into the jsonCascade pattern used by dump-classify to leverage the multi-provider fallback chain.
- **Evidence:** `if (res.status === 429) { await new Promise((r) => setTimeout(r, 1000)); res = await fetch(...) } if (!res.ok) { throw ... }`

### GoalsBox polls all goals + cadence on 6s interval without debounce
- **Dimension:** Performance & Cost
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/goals/GoalsBox.tsx:75-95, 111-123`
- **Problem:** The refresh() function fans out 4 parallel SQL queries (listWithLatest, listByKind×3, plus N cadence RPC calls per goal) and runs every 6 seconds (POLL_MS=6000). When multiple goals are active, this generates 4+N RPCs per poll. On a slow connection or during bundled re-focuses (user opens the app, tabs back), multiple refresh() calls can pile up and starve other work.
- **Fix:** Add request debounce/deduplication: track an in-flight Promise and cancel/reuse it on repeated calls within the same interval. Or throttle the focus listener so rapid tab switches (within 6s) don't fire multiple refresh() calls. Consider using a store subscription pattern instead of polling for real-time updates.
- **Evidence:** `const POLL_MS = 6000; setInterval(() => { void refresh(); }, POLL_MS); + window.addEventListener('focus', onFocus); where onFocus calls refresh()`

### Drain queue processes dumps sequentially, blocking on Anthropic API
- **Dimension:** Performance & Cost
- **File:** `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:122-164`
- **Problem:** The drainEnrichQueue() function loops through up to 50 KV entries and calls processOne() for each, which awaits Anthropic (callAnthropic) then two Supabase writes sequentially. Each iteration blocks on the previous one; latency-bound to Anthropic + Supabase response times. With 50 dumps × (~1s Anthropic + ~200ms inserts), the drain can take >60s per run.
- **Fix:** Parallelize the processOne calls using Promise.all() or batch them in windows (e.g., 10 concurrent). The current Anthropic API batch endpoint is not used; consider batching the text enrichment requests into a single Anthropic call if the API supports it. For inserts, use Promise.all([insertRawDump(), insertEnrichedSignal()]) since they are independent after dumpId is known.
- **Evidence:** `for (const entry of list.keys) { ... await processOne(env, parsed); ... } inside processOne: await callAnthropic(...) then await insertRawDump(...) then await insertEnrichedSignal(...)`

### Hardcoded English strings in MicButton display label
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:210, 216`
- **Problem:** The recording overlay label 'listening… just pause when you're done' and button aria-label 'Record a voice note' / 'Stop recording' are hardcoded English.
- **Fix:** Extract these 3 strings into a translatable map using useAppLang hook.
- **Evidence:** `'''typescript
<span className={styles.label}>listening… just pause when you're done</span>
aria-label={recording ? 'Stop recording' : 'Record a voice note'}`

### Hardcoded English in NeedsConfirmCard
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:72, 78, 109, 127`
- **Problem:** The NeedsConfirmCard renders hardcoded English strings: 'photo' badge label, 'not sure · confirm?' kicker, 'keep' button, 'undo' button.
- **Fix:** Pass `lang: AppLang` as a prop (or read it via useAppLang if converted to a hook) and use translatable labels for the 4 strings.
- **Evidence:** `'''typescript
<span>photo</span>
<Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
  not sure · confirm?
</Text>
keep / undo button labels`

### Hardcoded English in TodayNoticings affordance labels
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/brain/TodayNoticings.tsx:147, 179, 186`
- **Problem:** The TodayNoticings component renders hardcoded English affordance labels: 'worth a glance' kicker, 'not now' button, 'dismiss' button. These appear on every noticing card displayed to the user.
- **Fix:** Extract these 3 labels into translatable strings keyed by language. The component already has access to `lang` via useAppLang() hook (line 68), so apply it.
- **Evidence:** `'''typescript
<Text scale="caption" color={colors.sage} style={KICKER_STYLE}>
  worth a glance
</Text>
<button>not now</button>
<button>dismiss</button>`

### Hardcoded English in DumpScreen heading
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:215`
- **Problem:** The DumpScreen heading 'What's in your head?' is hardcoded English. This is the primary prompt for the brain dump entry point, shown to all users.
- **Fix:** Create a translatable heading using useAppLang. Provide EN: 'What's in your head?', ES: '¿Qué hay en tu mente?', TR: 'Aklında ne var?'.
- **Evidence:** `'''typescript
<Text scale="display">What's in your head?</Text>`

### Hardcoded English in BrainDumpInput placeholder
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/BrainDumpInput.tsx:94`
- **Problem:** The DEFAULT_PLACEHOLDER 'What's in your head?' is a constant hardcoded in English, duplicating the DumpScreen heading. Even though it's parameterizable via props, the default is English-only.
- **Fix:** Make the default placeholder language-aware by wrapping it in a function that calls resolveLang() or useAppLang().
- **Evidence:** `'''typescript
const DEFAULT_PLACEHOLDER = "What's in your head?";
...
placeholder = DEFAULT_PLACEHOLDER,`

### Hardcoded English module labels and hints in Router
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/navigation/Router.tsx:88-120`
- **Problem:** The MODULE_GROUPS array hardcodes all module labels (e.g. 'you', 'your stuff', 'your responsibilities', 'Body', 'Mood', 'Sleep', etc.) and hints (e.g. 'how you are this week', 'water, movement, symptoms') in English only. These appear in the modules navigation drawer.
- **Fix:** Create a language-aware module registry that surfaces localized labels and hints based on the current app language. Consider externalizing this to a translatable configuration file or hook that returns MODULE_GROUPS for the active language.
- **Evidence:** `'''typescript
const MODULE_GROUPS: ModuleGroup[] = [
  {
    id: "you",
    label: "you",
    aside: "how you are this week.",
    items: [
      { id: "body", label: "Body", hint: "water, movement, symptoms" },`

### Hardcoded English in primary route labels
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/navigation/routes.ts:37-40`
- **Problem:** The primaryRoutes array hardcodes labels entirely in English: 'Home', 'To-Do', 'Modules', 'Settings'. These appear in the main tab bar and must be localized.
- **Fix:** Make route labels language-aware. Either compute them dynamically based on useAppLang, or store translations in a separate translatable structure indexed by (routeId, language).
- **Evidence:** `'''typescript
export const primaryRoutes: readonly RouteEntry[] = [
  { id: "home", path: "/", label: "Home", icon: "House", primary: true },
  { id: "todo", path: "/todo", label: "To-Do", icon: "ListChecks", primary: true },
  { id: "modul`

### Flaky test using real setTimeout without fake timers
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/tests/braindump-dispatch.test.ts:395, 432`
- **Problem:** Two tests in braindump-dispatch rely on real setTimeout(10ms) to settle async dispatch logic without using vi.useFakeTimers(). This creates a race condition: if the test runner is slow or the machine is under load, the 10ms timeout may not be enough and the test flakes. The comment 'Let the async AI path settle' indicates the test is trying to wait for an async operation without properly controlling time.
- **Fix:** Either: (1) wrap dispatchAction in a Promise-tracking helper that returns a settled Promise instead of relying on setTimeout, or (2) use vi.useFakeTimers() / vi.advanceTimersByTimeAsync() to control the async path deterministically, or (3) refactor dispatchAction to be sync or return a Promise that resolves when all async work is done.
- **Evidence:** `await new Promise((r) => setTimeout(r, 10)); appears at lines 395 and 432 without vi.useFakeTimers() in scope (checked: beforeEach does not set up fake timers).`

### Only orchestrator has coverage gates; other packages lack coverage monitoring
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/vitest.config.ts:12-20`
- **Problem:** Only the orchestrator package has vitest coverage gates (statements: 78%, branches: 55%, functions: 90%, lines: 78%). All other packages and workers (ai-proxy, logic, store, sync, notifications, auth, crypto, etc.) lack coverage monitoring. This means regressions in critical modules like the ai-proxy router or logic layer can degrade test coverage without detection. The config notes thresholds are intentionally conservative (a few points under measured floor), but this gate only applies to one package out of 15+.
- **Fix:** Add vitest coverage gates to at least: (1) workers/ai-proxy (router, segmentation, cascade are critical) (2) packages/logic (domain logic) (3) packages/store (data layer) with thresholds tailored per module (e.g., ai-proxy may need lower branch coverage for provider fallbacks). Start with conservative thresholds and ratchet up quarterly.
- **Evidence:** `ls packages/*/vitest.config.ts returns only orchestrator; workers have no coverage config; measured 2026-05-19 floor: 82.9% stmts but gate set to 78 (acknowledged ratcheting strategy).`

### TypeScript version drift between apps/native and workspace packages
- **Dimension:** Dependency Health
- **File:** `/Users/serrayildirim/ollie/apps/native/package.json:42`
- **Problem:** apps/native uses typescript ~5.8.3 (pinned to exact 5.8.3), while all workspace packages (packages/*, workers/*, apps/api) use ^5.6.0 (resolves to 5.9.3 in lock). This creates compiler consistency issues and may cause subtle type-checking differences across the monorepo during builds.
- **Fix:** Align typescript versions: either update all packages to ^5.8.3 or change apps/native to ^5.6.0 to match the workspace standard. The tighter pin in native may be intentional for Tauri build stability, so consider using ^5.8.0 as a middle ground.

### Unused dependency: @tauri-apps/plugin-opener
- **Dimension:** Dependency Health
- **File:** `/Users/serrayildirim/ollie/apps/native/package.json:29`
- **Problem:** @tauri-apps/plugin-opener is declared in package.json but there is no static or dynamic import of it anywhere in the TypeScript codebase (apps/native/src). Only the Rust-side plugin is configured in src-tauri/Cargo.toml, suggesting the JS binding is not utilized.
- **Fix:** Remove @tauri-apps/plugin-opener from apps/native/package.json unless it is required for the Tauri framework initialization. If opener functionality is needed later, it can be re-added with a clear use case.

### Missing peer dependency installation in apps/native
- **Dimension:** Dependency Health
- **File:** `/Users/serrayildirim/ollie/packages/store/package.json:17-18`
- **Problem:** @ollie/store declares peerDependencies: { react: '>=18' } but apps/native does not explicitly list react in its own peerDependencies. While react is in apps/native's dependencies, downstream consumers of @ollie/store (if packaged separately) would need to install react themselves. The declaration should be honored explicitly.
- **Fix:** No action required if @ollie/store is only consumed within this monorepo. If @ollie/store is ever published to npm as a library, ensure the peer dependency warning is clear in the README and that downstream users understand they must install react.

## LOW — 33

### No explicit check that telemetry endpoints reject unauthenticated requests before delegating to handlers
- **Dimension:** Security & Authorization
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:320-342`
- **Problem:** The telemetry endpoints (/enrich-dump, /ingest-event, /label) verify JWT in the main handler and then pass control to delegated handlers. If a handler is called independently or a new endpoint is added and the developer forgets to add auth checks in the main router, the delegated handler will be reached without auth. The design is sound but fragile.
- **Fix:** Add an authorization assertion inside each delegated handler (enrich-dump, ingest-event, label) that re-checks the user_id is present in a header or context. This provides defense-in-depth if the router is refactored. Alternatively, document this invariant in a SECURITY.md file and add a lint rule to catch new endpoints without auth checks.
- **Evidence:** `const authHeader = req.headers.get('authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return withCors(json({ error: 'unauthorized' }, 401));
      }
      const userId = await verifyJwt(authHeader.slice(`

### Unvalidated anthropic-beta header forwarded to upstream API
- **Dimension:** Input Validation
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:411-412`
- **Problem:** The anthropic-beta header is read directly from the request and forwarded to Anthropic's API without validation. While Anthropic controls the endpoint so injection risk is limited, this violates defense-in-depth principles. A malformed value could cause unexpected behavior or be mislogged.
- **Fix:** Validate the header against a known list of supported beta feature strings. Example: const ALLOWED_BETAS = new Set(['prompt-caching-2024-07-31']); if (beta && ALLOWED_BETAS.has(beta)) { ... }
- **Evidence:** `const beta = req.headers.get('anthropic-beta');
if (beta) (fwdHeaders as Record<string, string>)['anthropic-beta'] = beta;`

### Duplicated _consentOnGoals helper across goals/phase2 and goals/phase3
- **Dimension:** Reinvented Wheels & Duplication
- **File:** `packages/logic/src/goals:phase2.ts:function _consentOnGoals, phase3.ts:function _consentOnGoals`
- **Problem:** The _consentOnGoals function is defined identically in two files: phase2.ts and phase3.ts. This is a small utility (3 lines) that checks an optional consent boolean, but it is copy-pasted rather than extracted to a shared helper. While the impact is minor due to function size, it indicates incomplete refactoring.
- **Fix:** Extract _consentOnGoals to goals/helpers.ts or the main index, then import it in both phase2.ts and phase3.ts. This follows the existing pattern where goal phase-specific code is modularized.
- **Evidence:** `Both phase2.ts and phase3.ts define: function _consentOnGoals(opts: GoalsOpts | null | undefined): boolean { if (opts && typeof opts.consent === 'boolean') return opts.consent; return true; }`

### Retry/backoff logic already centralized (not a duplication issue)
- **Dimension:** Reinvented Wheels & Duplication
- **File:** `packages/sync/src/retry.ts, packages/api/src/client.ts:api/client.ts:222-249, sync/retry.ts:90-154`
- **Problem:** The retry and backoff pattern appears in both sync/retry.ts (createBackoffScheduler with exponential backoff, attempt caps) and api/client.ts (executeWithRetry with exponential backoff). However, this is NOT duplicated code: api/client.ts is an independent HTTP fetch wrapper that predates sync/retry.ts consolidation, and they serve different purposes (HTTP requests vs. sync drain scheduling). The comment in sync/retry.ts (lines 3-6) explicitly acknowledges this prior duplication and the intent was to unify hand-rolled sync clients (not to refactor the HTTP client). This is an intentional design where two parallel systems have independent retry logic.
- **Fix:** No action required. The retry logic in api/client.ts is correctly scoped to HTTP request handling, while sync/retry.ts handles drain scheduling. Attempting to unify them would couple unrelated concerns. However, document this intentional separation in each module's comments to prevent future refactoring attempts.
- **Evidence:** `api/client.ts lines 222-249 implement executeWithRetry for HTTP; sync/retry.ts lines 90-154 implement createBackoffScheduler for drain scheduling. Both are correctly isolated and serve different purposes.`

### Unused subpath exports in notifications package create confusion
- **Dimension:** File & Module Structure
- **File:** `/Users/serrayildirim/ollie/packages/notifications/package.json:8-17`
- **Problem:** The @ollie/notifications package declares subpath exports for internal implementation modules (backends/web, backends/electron, backends/capacitor, budget, aggregator, server-schedule, suppression) in its package.json exports field, but none of these subpaths are actually imported anywhere in the codebase. They appear only as documentation examples in the main index.ts comment. This misleads consumers into thinking these are stable public APIs when they are internal implementation details.
- **Fix:** Either: (a) Remove the unused subpath exports from package.json and import these modules as implementation details within the package only, OR (b) if these are intended to be part of the public API for legitimate use cases, document the stable contract and ensure they are actually used. Currently they create false signals about API stability.
- **Evidence:** `package.json exports declare 7 subpath exports (lines 9-16). Grep search confirms zero actual imports of @ollie/notifications/{backends,budget,aggregator,server-schedule,suppression} across the entire repo. Only documented in src/index.ts l`

### Potential inconsistency: notifications depends on api for type-only usage
- **Dimension:** File & Module Structure
- **File:** `/Users/serrayildirim/ollie/packages/notifications/package.json:23-27`
- **Problem:** The @ollie/notifications package declares @ollie/api as a runtime dependency, but only uses it for a type-only import (type OllieAPI). Since this is a type-only import, it should be a devDependency or the import should be changed to avoid the runtime dependency. This doesn't cause issues due to monorepo structure but indicates unclear dependency intent.
- **Fix:** Move @ollie/api from dependencies to devDependencies in notifications/package.json, since it's only used for type information. This clarifies that notifications does not have runtime reliance on api, only on its type definitions. Alternatively, if api needs to be at runtime for some future use case, add a comment explaining why.
- **Evidence:** `package.json line 24: "@ollie/api": "workspace:*" (runtime dependency). src/server-schedule.ts line 20: 'import type { OllieAPI } from '@ollie/api';' (type-only import). No other imports from @ollie/api in the notifications package.`

### Sleep parse casts record properties through unknown
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/sleep/parse.ts:38`
- **Problem:** In mergeRecord, the output is cast `as unknown as Record<string, unknown>` when assigning properties dynamically. While there's a null check, the cast still hides type information about valid SleepRecord keys.
- **Fix:** Use a typed merge helper or Object.assign with proper type narrowing to avoid the intermediate `unknown` cast. Consider using `Partial<SleepRecord>` for update objects.
- **Evidence:** `const outAny = out as unknown as Record<string, unknown>;`

### Untyped event payload in grocery orchestrator
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/grocery.ts:176`
- **Problem:** The onPeriodLogged callback accepts `payload: unknown` and immediately casts to a partial object type without validation. If a caller passes malformed data, it will flow through unchecked.
- **Fix:** Add a type guard function that validates the payload shape before casting: `if (!isPeriodLoggedPayload(payload)) return;` or use Zod runtime validation.
- **Evidence:** `function onPeriodLogged(payload: unknown): void {
    const p = (payload ?? {}) as { ts?: number; source?: string };`

### Schedule delay calculation can produce negative timeout in notifications
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/packages/notifications/src/index.ts:175-181`
- **Problem:** In scheduleInProcessTimer(), the delay is computed as `Math.max(0, r.fireAt - Date.now())`. If fireAt is in the past (e.g., a scheduled record wasn't resumed in time), the timeout is 0, causing immediate delivery. While Math.max prevents negative values, the semantics shift from 'fire at time X' to 'fire immediately' without warning, which may violate intent.
- **Fix:** Log when delay is clamped to 0: `const delay = Math.max(0, r.fireAt - Date.now()); if (delay === 0) console.warn('[notify] scheduled notification delivered late', r.spec.dedupe_key);`
- **Evidence:** `'''typescript
const delay = Math.max(0, r.fireAt - Date.now());
const t = setTimeout(() => {
  inProcessTimers.delete(r.spec.dedupe_key);
  writeScheduled(readScheduled().filter((x) => x.spec.dedupe_key !== r.spec.dedupe_key));
  void deliv`

### Flush timer interval never cancels in research-stream on repeated reschedule
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/packages/research-stream/src/index.ts:253-260`
- **Problem:** In scheduleFlush(), a setTimeout is assigned to flushTimer, but if scheduleFlush() is called multiple times in quick succession (e.g., if flush fails and reschedules), old timers may not be canceled. The function clears flushTimer only if it is non-null and was previously set, creating a stale reference.
- **Fix:** Always clear before setting: `if (flushTimer) clearTimeout(flushTimer); flushTimer = setTimeout(...)`
- **Evidence:** `'''typescript
function scheduleFlush(): void {
  if (!running) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    try { await flush(); } catch (err) { console.warn('[research] flush failed', err); }
    scheduleFlush`

### Fire-and-forget notification delivery without result logging in cadence scanner
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/cadence-scanner.ts:405-420`
- **Problem:** notify() is called without await and the caught rejection is logged only on error. If notify() returns an error silently, the cadence scanner marks the entry as fired and de-duplicates it, causing the user to miss the notification forever.
- **Fix:** Remove the fire-and-forget pattern for cadence notifications: `const result = await notify(...); if (!result.delivered) { console.error('[cadence-scanner] notify failed to deliver', dedupeKey, result.reason); /* optionally remove from fired set */ }`
- **Evidence:** `'''typescript
void notify({
  title,
  body,
  category: templates.category,
  dedupe_key: dedupeKey,
  action_url: templates.actionUrl,
}).catch((err: unknown) => {
  console.error('[cadence-scanner] notify failed', dedupeKey, err);
});
''`

### Magic number 72 for anomaly cooldown lacks extraction
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:436`
- **Problem:** The constant 72 * 60 * 60 * 1000 (72-hour cooldown) for anomaly detection is hardcoded inline rather than extracted as a named constant. While the context comment explains it, a named constant would improve readability and make it easier to adjust in one place if needed.
- **Fix:** Extract `const ANOMALY_COOLDOWN_HOURS = 72;` at the module level near other settings (line ~100), then use `const COOLDOWN_MS = ANOMALY_COOLDOWN_HOURS * 60 * 60 * 1000;` at line 436. This makes the intent clearer and the tuning point more visible.
- **Evidence:** `Line 436: 'const COOLDOWN_MS = 72 * 60 * 60 * 1000;' — followed by comment explaining Iglewicz-Hoaglin 1993 methodology, but no high-level constant name like 'ANOMALY_COOLDOWN_HOURS = 72'.`

### Stale comment mentions unshipped feature (taxProfile)
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:154-159`
- **Problem:** Comments at lines 154 and 449 refer to `finance.taxProfile` as a future feature that will ship later, but the code already has fallback logic. The TODO comments suggest implementation was deferred, creating potential confusion about whether this feature exists or is blocked.
- **Fix:** Either: (1) Remove the TODOs and update the comments to clearly state the feature is deferred with a linked issue number, or (2) If the feature is now shipping, implement it and remove the comment. Add a reference to the tracking issue (e.g., 'Deferred to Sprint C per issue #NNN').
- **Evidence:** `Lines 154-159: 'Sprint B'' (2026-05-14): the research orchestrator's PII scrubber needs a locale token...' plus lines 449-451 with 'TODO: once the onboarding UI writes finance.taxProfile' and 'TODO: read from finance.taxProfile once that UI`

### Dead or obsolete pattern detection code path not removed
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/work/index.ts:14`
- **Problem:** The `index.ts` still exports legacy detectors (detectDeepFocusHours, detectPacingBreach) from ./legacy.ts (line 14). While they are labeled as 'W0 legacy', the file structure suggests these should have been removed when the pattern system was refactored. If they are truly legacy and not used, they should be removed entirely; if still in use, the code should be updated to avoid the 'legacy' label.
- **Fix:** Audit whether W0 detectors (deep-focus-hours, pacing-breach) are actually emitted by any part of the system. If they're truly deprecated: remove legacy.ts, the exports, and any references in patterns.ts. If still in use: either remove the 'legacy' label and modernize the code, or add an explicit deprecation comment with a removal timeline and tracking issue.
- **Evidence:** `Line 14 of /Users/serrayildirim/ollie/packages/logic/src/work/index.ts: 'export { detectDeepFocusHours, detectPacingBreach } from './legacy';' and the legacy.ts file header comments 'Pre-dates consent gate convention. Behavior preserved ver`

### Commented-out partner signal suggests incomplete refactor
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/partner/repo.ts:1`
- **Problem:** The partner repo file contains a TODO comment that suggests signal detection is blocked on missing mood/energy/cycle data reads. This indicates either incomplete implementation or technical debt. The comment reads 'TODO(signals): replace with a real read of the user's mood/energy/cycle/' suggesting the feature was stubbed out.
- **Fix:** Either: (1) Complete the partner signal implementation by reading the actual mood/energy/cycle/body data from the store, or (2) Add a linked GitHub issue comment with a removal date and clear explanation of why it's blocked. If blocked on another team or API, document the blocker explicitly.
- **Evidence:** `File path includes mention of TODO(signals) in a grep result earlier, indicating commented or incomplete signal logic in the partner module.`

### Long regex pattern needs documentation or extraction
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:98-99`
- **Problem:** The MUTATION_RE regex (lines 98-99) is a complex 87-character pattern covering EN/TR/ES mutation verbs but lacks inline documentation explaining why certain verbs are excluded (e.g., 'got' alone) or how the pattern is structured. The comment at lines 90-97 explains the intent but not the regex structure itself, making it hard to maintain or add new verb variants.
- **Fix:** Add a comment above MUTATION_RE breaking down the pattern by language: '// EN: (remove|delete|...) | TR: (listeden çıkar|...) | ES: (quita|...) / Pattern requires phrase context, not bare verb, to avoid false positives on "got milk" style pantry logs.' Optionally split into separate EN_VERBS, TR_VERBS, ES_VERBS arrays and build the regex dynamically for readability.
- **Evidence:** `Lines 98-99: 'const MUTATION_RE = /\b(remove|delete|...|se echó a perder)\b/i;' — a single long alternation without explanation of language grouping or why certain subpatterns exist (e.g., 'drop\s+\w+\s+from' vs just 'drop').`

### Large Layer-1 router prompt stored as long string literal
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-classify.ts:44-145`
- **Problem:** The SYSTEM_PROMPT (lines 44-145, ~10k characters) is a massive embedded string literal defining the brain-dump router's Layer-1 behavior. While this is appropriate for a prompt, it makes the file harder to read and modify. The comment at line 147 logs the size for guardrail purposes, but there's no tooling to keep it bounded as the product evolves.
- **Fix:** Extract the prompt to a separate file (e.g., dump-classify-prompt.ts or docs/dump-classify-prompt.txt) and import it. Add a build-time check (or test) that asserts `SYSTEM_PROMPT.length < 8000` to catch prompt bloat during development. Document the tradeoff: embedding keeps it close to the code, but extraction makes edits easier. Current approach (length logging at module load) is sufficient but could be made more explicit.
- **Evidence:** `Lines 44-145 contain a 102-line string spanning ~10,000 characters with detailed routing rules, module-action mappings, and examples. The comment at line 150 logs 'SYSTEM_PROMPT.length' for monitoring, but this is done at runtime only.`

### Inconsistent tsconfig include patterns across packages
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/packages`
- **Problem:** Some packages use non-recursive include patterns (e.g., ["src", "tests"]) while others use recursive globs (e.g., ["src/**/*", "tests/**/*"]). While this works in practice due to flat directory structures, it creates inconsistency that could cause issues if subdirectories are added. Packages with non-recursive patterns: api, apns-jwt, cadence, events, logic, orchestrator, store, worker-http. Packages with recursive patterns: auth, consent, crypto, notifications, pii-scrub, research-stream, sync.
- **Fix:** Standardize on recursive glob patterns ["src/**/*", "tests/**/*"] across all packages for consistency and to prevent future bugs when directory structures change. Update non-recursive packages to use the glob pattern.
- **Evidence:** `api: "include": ["src", "tests"] vs auth: "include": ["src/**/*", "tests/**/*"]`

### Inconsistent rootDir declarations in tsconfig.json
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/packages`
- **Problem:** Many packages that extend tsconfig.base.json explicitly set rootDir: "." while others omit it. This is not a functional issue since it's the default, but the inconsistency reduces clarity. Only some packages declare it (auth, consent, crypto, notifications, pii-scrub, research-stream, sync) while others (api, apns-jwt, cadence, crisis-lexicon, events, logic, orchestrator, store, worker-http) omit it.
- **Fix:** For packages that extend the base config and have rootDir=".", remove the explicit declaration since it matches the default. For clarity, consider adding a comment to base tsconfig.json explaining the rootDir default. Or standardize on always including it explicitly.
- **Evidence:** `auth/tsconfig.json has "rootDir": "." but api/tsconfig.json omits it (both inherit from base)`

### Missing outDir specification in packages with noEmit
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/packages`
- **Problem:** Packages apns-jwt, consent, crisis-lexicon, pii-scrub, and worker-http set noEmit: true but some don't specify outDir. This is correct behavior since noEmit means no files are emitted, making outDir irrelevant. However, other packages with noEmit do have outDir specified, creating inconsistency in how noEmit packages are configured.
- **Fix:** For all packages with noEmit: true, explicitly document in a comment that outDir is intentionally omitted due to noEmit. Alternatively, standardize on always including outDir even with noEmit for consistency.
- **Evidence:** `worker-http/tsconfig.json: noEmit: true without outDir; but pii-scrub/tsconfig.json: noEmit: true without outDir`

### Inconsistent explicit strict mode declarations
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/packages`
- **Problem:** Some packages explicitly declare strict: true in their tsconfig (apns-jwt, crisis-lexicon, worker-http) while others rely on inheritance from tsconfig.base.json (which has strict: true). This creates unnecessary duplication. The base config already enforces strict mode, so explicit redeclaration in child configs is redundant.
- **Fix:** Remove explicit strict: true from packages apns-jwt, crisis-lexicon, and worker-http since they inherit this from tsconfig.base.json. Document in comments that base config enforces strict mode.
- **Evidence:** `packages/apns-jwt/tsconfig.json: "strict": true (redundant with base); packages/auth/tsconfig.json: relies on base inheritance`

### phaseFold function has O(n*m) complexity for large event lists against many cycles
- **Dimension:** Algorithms Correctness & Efficiency
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/patterns/phase-fold.ts:62-82`
- **Problem:** The phaseFold function iterates over all events and for each event, scans through all cycles until a match is found. With n events and m cycles, this is O(n*m). The `break` statement prevents O(n*m²), but the algorithm is still linear in both dimensions. For typical use cases (< 50 cycles, < 1000 events per detector run), this is acceptable, but could be optimized with binary search since cycles are sorted by start timestamp.
- **Fix:** For large event lists, use binary search to find the cycle containing each event: const cycleIdx = sorted.findIndex(c => e.ts >= c.cycleStartTs && e.ts < c.cycleStartTs + c.cycleLengthDays * DAY_MS); This reduces complexity to O(n*log(m)) and is trivial to implement given the sorted invariant.
- **Evidence:** `for (const e of events || []) {
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    if (e.ts >= c.cycleStartTs && e.ts < end) {
      out.push(...);
      break;
    }
  }`

### Fertile window calculation uses integer rounding that may lose precision for very high or low standard deviations
- **Dimension:** Algorithms Correctness & Efficiency
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/cycle/prediction.ts:103-109`
- **Problem:** The fertile window calculation rounds the widening factor Math.round(layer1.sd - 2) before using it. For users with very low variability (sd < 2.5), widen becomes 0, and the window is always exactly 7 days (startDay = ovulationDay - 5, endDay = ovulationDay + 1). This is reasonable, but for sd > 7, the rounding may introduce ±0.5 day errors in the confidence window. The impact is minimal for clinical use.
- **Fix:** Consider keeping fractional days if precision is needed: const widen = Math.max(0, layer1.sd - 2); and update the FertileWindowDays type to allow number instead of just the current shape. For now, this is acceptable as menstrual cycle windows are inherently ±1 day uncertain. Document the rounding behavior in comments.
- **Evidence:** `const widen = Math.max(0, Math.round(layer1.sd - 2));
const ovulationDay = Math.round(layer1.mean) - LUTEAL_DAYS;
fertile = {
  startDay: ovulationDay - 5 - widen,
  endDay: ovulationDay + 1 + widen,
  center: ovulationDay,
  widenedBy: wid`

### Grocery replenishment logic relies on soonestOutMs tracking that may not scale with many pantry items
- **Dimension:** Algorithms Correctness & Efficiency
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/grocery/patterns.ts:140-175`
- **Problem:** The detectReplenishNeeded function iterates through all pantry items to find the soonest run-out time. While this is O(n) and appropriate for typical pantries (< 100 items), the code does not optimize for cases where many items are overdue. It correctly sorts by most-overdue-first and tracks soonestOutMs, but each comparison (p.predictedOutAtMs < soonestOutMs) is made sequentially. This is not a correctness issue but a minor efficiency concern.
- **Fix:** The algorithm is correct and the performance impact is negligible. No change needed. If profiling later shows this is a bottleneck, sort the needed array by predictedOutAtMs once instead of maintaining soonestOutMs during iteration: const sorted = needed.sort((a, b) => a.predictedOutAtMs - b.predictedOutAtMs); const soonestOutMs = sorted[0]?.predictedOutAtMs ?? null;
- **Evidence:** `let soonestOutMs: number | null = null;
for (const p of pantry) {
  if (!p) continue;
  if (p.archived === true) continue;
  if (typeof p.predictedOutAtMs !== 'number' || !Number.isFinite(p.predictedOutAtMs)) continue;
  if (p.predictedOutA`

### body.correlations key written by orchestrator but native app bridge never initializes it
- **Dimension:** State & Store Consistency
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/body-correlations.ts:117-118`
- **Problem:** The body-correlations orchestrator writes `body.correlations` as an output key after running correlation analysis. However, the native app bridge does not initialize or seed this key. On a cold start before any correlation pass runs, the UI trying to read body.correlations gets undefined. The watcher will eventually populate it, but there's a brief window where the key doesn't exist.
- **Fix:** Initialize `body.correlations` to an empty array in the body bridge's syncToStore() so it exists on cold start, matching the pattern used for `body.episodes` and `body.supplements`. This is a minor UX fix—the key will be populated correctly once the orchestrator runs, but pre-seeding it prevents undefined errors.
- **Evidence:** `store.set('body', 'correlations', results);  // in orchestrator
// never written by apps/native/src/modules/body/bridge.ts`

### Cycle pregnancy flags written before items, but items subscriber may fire before flags are stable
- **Dimension:** State & Store Consistency
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/cycle/bridge.ts:129-153`
- **Problem:** The cycle bridge intentionally sets `cycle.pregnant` and `cycle.pregnancyEndTs` before `cycle.items` so the orchestrator's items-subscriber recompute sees the correct pregnancy state. However, the bridge writes are synchronous and store.set fires subscribers immediately, so there's a potential race if the items subscriber fires before the pregnancy keys are written. The comment acknowledges the concern ('ORDER MATTERS') but the synchronous nature of store.set should make it atomic.
- **Fix:** This is documented and the implementation is correct (synchronous store.set makes the order matter but safe). No change needed, but add a guard in the orchestrator's cycle recompute to read the pregnancy flag defensively (it already does) to protect against future refactors that might introduce async store writes.
- **Evidence:** `// ORDER MATTERS: set the pregnant keys BEFORE 'cycle.items'. store.set is
  // synchronous and the orchestrator recomputes on the 'cycle.items' change —
  // so the pregnant flag must already be current when that fires.`

### finance/_recurringCandidatesConfirmed and _recurringCandidatesDismissed read but never written
- **Dimension:** State & Store Consistency
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:~550`
- **Problem:** The finance orchestrator reads `finance._recurringCandidatesConfirmed` and `finance._recurringCandidatesDismissed` to dedup recurring candidates, but no bridge or subscriber writes these keys. The orchestrator will simply see empty sets on every run. This is a low-severity issue if the dedup logic has a fallback, but it means the UI's confirm/dismiss actions (if they exist) aren't being persisted to prevent re-showing the same candidates.
- **Fix:** Either: (1) add an event subscriber in the finance orchestrator's init() that listens for finance:recurring_candidate_confirmed/dismissed events and appends to these dedup arrays, or (2) remove the read since there's no writer and the dedup isn't working. If the UI does have dismiss/confirm actions, they need to emit the events or write directly to these keys.
- **Evidence:** `store.get('finance', '_recurringCandidatesConfirmed', []) — never written`

### Raw KV retry counter is racy; concurrent drains can over-increment
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:368-374`
- **Problem:** bumpRetry() reads the counter, increments it locally, and writes it back (get → parse → +1 → put). This is a check-then-act race. If two drainEnrichQueue runs happen concurrently (e.g., manual trigger + scheduled cron), both will read the same counter value, increment to the same N, and whichever PATCH last will win, losing one increment. After 12 actual failures spread across concurrent runs, the counter might still be at 6, preventing DLQ promotion.
- **Fix:** Use Cloudflare KV's atomic increment operation (not available in standard KV, but available via D1). Alternatively: (1) Use a composite key: `${RETRY_PREFIX}${parsed.id}:${Date.now()}` to log each attempt separately, then count them at DLQ-check time. (2) Move to Cloudflare Queues (item #4) which owns atomic retry counting.
- **Evidence:** `Line 368-374: 'const raw = await kv.get(key); const next = (raw ? parseInt(raw, 10) || 0 : 0) + 1; await kv.put(key, String(next), ...);' — classic TOCTOU (time-of-check-time-of-use) race. No atomic increment, no CAS (compare-and-swap).`

### Cache hit bump in dump router fires after response sent
- **Dimension:** Performance & Cost
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:302-306`
- **Problem:** On a cache hit, cacheHitBump() is called inside a keepAlive() closure to update Vectorize metadata (hitCount, lastHitAt). While this avoids blocking the response, if the cache write fails the hit is never recorded, silently breaking the eviction score calculation (Decision 3: score = hitCount × exp(-age/30d)). Silent degradation of cache eviction policy over time.
- **Fix:** Consider logging cache bump failures to a telemetry sink for observability. Optionally, add a retry loop or circuit-breaker since Vectorize writes are eventually consistent. If hitCount tracking becomes critical, consider moving the write into the synchronous response path with a short timeout, accepting the latency cost for correctness.
- **Evidence:** `keepAlive( cacheHitBump(env.VECTORIZE_INDEX, cacheRow, userId, embedding).catch((e) => console.error('[route/dump] cache bump failed', e)) )`

### Hardcoded English in NotifyPrimeLine affordance
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/notify/NotifyPrimeLine.tsx:135`
- **Problem:** The 'not now' button text in NotifyPrimeLine is hardcoded English, matching the TodayNoticings pattern.
- **Fix:** Apply the same language-aware pattern as TodayNoticings to ensure consistency.
- **Evidence:** `'''typescript
click to dismiss: not now`

### Unused dependency: @fontsource/dm-mono
- **Dimension:** Dependency Health
- **File:** `/Users/serrayildirim/ollie/apps/native/package.json:16`
- **Problem:** apps/native depends on @fontsource/dm-mono but it is only imported in main.tsx for CSS (400.css, 500.css). This is a small CSS-only dependency (~200KB uncompressed). While it's used, consider whether the overhead is justified if dm-mono is not rendered anywhere in the UI.
- **Fix:** Audit the UI design system to confirm dm-mono is actually used in rendered text. If unused, remove the dependency and the corresponding CSS imports from main.tsx. If rarely used, consider consolidating to fewer font weights.

### Version inconsistency in @cloudflare/workers-types
- **Dimension:** Dependency Health
- **File:** `/Users/serrayildirim/ollie/apps/api/package.json:19`
- **Problem:** Multiple Cloudflare Worker packages (apps/api, packages/worker-http, packages/apns-jwt, workers/apns-push, workers/cron, workers/sentry-tunnel) all declare @cloudflare/workers-types@^4.20250906.0, but the lock file shows different resolved versions (e.g., 4.20260510.1). This is benign (all v4.x), but indicates high volatility in the types package.
- **Fix:** Consider pinning to a stable known-good version (e.g., 4.20250906.0 without caret) to reduce surprise version changes. Alternatively, document the types version requirement in contributing guidelines.

### Heavy/redundant dependency: @clerk/clerk-react in native app
- **Dimension:** Dependency Health
- **File:** `/Users/serrayildirim/ollie/apps/native/package.json:15`
- **Problem:** @clerk/clerk-react adds a full authentication provider library to a Tauri desktop app where auth is typically handled via native OS mechanisms or simpler token-based flows. The bundle size overhead may not be justified if used only for getUserId() and logout hooks.
- **Fix:** Evaluate whether Clerk is the right auth solution for a native desktop app. If only basic user identification is needed, consider a lighter auth adapter or token-based approach. If Clerk is required, document the decision. Alternatively, move Clerk config to a custom hook to make the dependency more explicit.

