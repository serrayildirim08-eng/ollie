# Ollie Repo Audit — Round 1/3

_Date: today · Branch: feat/brain @ 2325ee5 · 125 findings · independent round, unaware of the other two._

Findings ordered by importance (severity).

## CRITICAL — 7

### IDOR: Telemetry endpoints accept unvalidated user_hash without ownership verification
- **Dimension:** Security & Authorization
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:315-342`
- **Problem:** The /enrich-dump, /ingest-event, and /label endpoints verify the JWT and extract the authenticated user_id (line 324), but do NOT pass this user_id to the handlers. The handlers then accept client-supplied user_hash/user_id values without validating them match the JWT owner. This allows an attacker with valid JWT to submit telemetry events (enrich-dump, ingest-event) on behalf of OTHER users by spoofing their user_hash.
- **Fix:** Pass the verified userId to each handler and validate that the client-supplied user_hash (or row.user_id for ingest-event) matches the JWT owner. Example: (1) Export user_id from verifyJwt path; (2) Pass it to handleEnrichDump/handleIngestEvent; (3) In handlers, verify body.user_hash === verified_userId before queuing/inserting.
- **Evidence:** `const userId = await verifyJwt(authHeader.slice('Bearer '.length), env);
if (!userId) return withCors(json({ error: 'invalid_jwt' }, 401));
// userId verified here ↑ but NEVER passed to handlers
if (url.pathname === '/enrich-dump') {
  retu`

### IDOR: ingest-event accepts arbitrary user_id in body.row without verification
- **Dimension:** Security & Authorization
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/telemetry.ts:168-224`
- **Problem:** handleIngestEvent() accepts a generic body.row object and forwards it directly to Supabase via REST INSERT. The row payload includes a user_id field (set by the client) with no verification that it matches the authenticated JWT owner. An attacker can forge retention_events, session_events, module_events, or crisis_events for any other user.
- **Fix:** Add userId parameter to handleIngestEvent signature. Validate that body.row.user_id === userId before INSERT. For tables where the column is named something else, adjust the check accordingly.
- **Evidence:** `export async function handleIngestEvent(req: Request, env: IngestEnv): Promise<Response> {
  let body: IngestEventRequest;
  // ...
  // No userId from JWT is available here (not passed by index.ts)
  const url = '${env.SUPABASE_URL.replace`

### IDOR: enrich-dump accepts unvalidated user_hash, queues to shared KV without ownership scope
- **Dimension:** Security & Authorization
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/telemetry.ts:91-159`
- **Problem:** handleEnrichDump() queues a brain-dump entry with a client-supplied body.user_hash field. No verification checks that this hash matches the JWT owner. While the cron drain does receive the queued entry, an attacker can poison the enrichment queue with dumps spoofed as belonging to other users. The entry is queued in a shared KV namespace (q:enrich:*) and processed in batch by the cron worker, which then writes to raw_dumps and enriched_signals with the attacker-controlled user_hash.
- **Fix:** Pass verified userId to handleEnrichDump. Hash the JWT userId server-side and compare it with body.user_hash. Reject if they don't match. Alternatively, compute the correct user_hash server-side from the verified userId and the VITE_USER_HASH_SALT (if available on the server), then ignore the client-supplied value.
- **Evidence:** `export async function handleEnrichDump(req: Request, env: EnrichEnv): Promise<Response> {
  // No userId from JWT is available (not passed by index.ts)
  // ...
  const entry: QueuedDump = {
    id,
    payload: {
      user_hash: body.user`

### Gemini API key exposed in query string
- **Dimension:** Input Validation
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vision.ts:55`
- **Problem:** The Gemini API key is passed as a URL query parameter, which gets logged in HTTP request logs, Cloudflare access logs, and potentially cached by proxies. This violates API key handling best practices and exposes the secret in plaintext across infrastructure.
- **Fix:** Move the API key to the Authorization header or request body instead of the URL. Change to `Authorization: Bearer ${geminiKey}` header or POST the key in the body.
- **Evidence:** `const url = '${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${geminiKey}';`

### Silent data loss: Promise.all without error boundaries in flush-notifications
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:223`
- **Problem:** Promise.all([tokens.map(t => pushOne(...))]) collects delivery results, but if ANY promise in the mapped array rejects (e.g., network error in pushOne before the try/catch wraps the response), it throws and halts processing of remaining tokens. The array is built inside Promise.all's argument, so a thrown error aborts the entire batch. This violates the documented guarantee that 'one bad job never starves the rest of the batch'.
- **Fix:** Use Promise.allSettled instead of Promise.all, or wrap each pushOne call in a catch that returns a failed result object. Currently, a network error on token[5] silently stops processing tokens[6..n].
- **Evidence:** `    const results = await Promise.all(
      tokens.map((t) => pushOne(env, t.device_token, job.user_id, apnsPayload)),
    );`

### Silent data loss: remindIn field dropped when low-confidence fragments are demoted to dump_only
- **Dimension:** Dump Routing Flow Correctness
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:281-285 and 338-342`
- **Problem:** When a classified fragment has both a remindIn hint (time-deferred reminder) AND confidence < 0.60, the applyConfidencePolicy function demotes it to dump_only and wraps the original payload inside an `originalGuess` object. However, injectScheduledAt (called immediately after) still looks for `payload.remindIn` at the top level of the demoted payload, not inside the nested originalGuess. This causes the scheduled reminder to be silently lost from the client response without any log warning. The classifier system prompt explicitly states 'never dump_only when remindIn present' (dump-classify.ts line 100), but the confidence policy thresholding overrides this rule without awareness of the remindIn field.
- **Fix:** Before calling injectScheduledAt on a demoted payload (module='dump_only'), check if remindIn exists in originalGuess.payload and extract it to the top level. Alternatively, modify applyConfidencePolicy to preserve top-level remindIn fields even when demoting, or modify injectScheduledAt to handle the nested originalGuess structure. Also add explicit logging when remindIn is silently lost due to demotion.
- **Evidence:** `Line 281: 'const tiered = applyConfidencePolicy(cacheRow.module, cacheRow.payload, cacheRow.confidence);' demotes payload to '{ module: 'dump_only', action: 'archive_only', reason: 'low_confidence', originalGuess: { module, payload } }'. Li`

### CrisisSignal schema mismatch - field names and types
- **Dimension:** API Contract Consistency
- **File:** `/Users/serrayildirim/ollie/apps/native/src/router/schema.ts:72-77`
- **Problem:** The native client defines CrisisSignal with type: 'ideation'|'method_seeking'|'distress'|'panic', confidence: number, and language: string. But the worker sends the actual CrisisSignal from @ollie/crisis-lexicon which has tier: 1|2|3|4, languages: array, and matches: array. The native code tries to access crisis.type and crisis.language (lines 298 in DumpScreen.tsx) which don't exist on the actual response, resulting in undefined values displayed to the user.
- **Fix:** Align schemas: either (A) have the native client import CrisisSignal from @ollie/crisis-lexicon and update DumpScreen.tsx to use tier/languages/matches, or (B) have the worker transform the crisis-lexicon CrisisSignal to the expected format before sending (map tier to type, single language to languages array, confidence field needs new source). Option A preferred as crisis-lexicon is source-of-truth.
- **Evidence:** `Native schema expects: { detected: true; type: 'ideation'|'method_seeking'|'distress'|'panic'; confidence: number; language: 'en'|'es'|'tr' }. Actual worker response: { detected: true; tier: 1|2|3|4; languages: string[]; matches: Array<{lan`

## HIGH — 30

### Auth bypass: verifyJwt() returns early on Clerk failure without checking Supabase fallback result
- **Dimension:** Security & Authorization
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:364-400`
- **Problem:** The verifyJwt function has a dual-mode flow: try Clerk first, fall back to Supabase. However, the Supabase fallback returns early (line 384) without checking SUPABASE_URL/SUPABASE_ANON_KEY exist. If Clerk is configured but fails to verify (e.g., network error, wrong issuer), and if Supabase credentials are missing, the function returns null instead of raising an error. This could mask configuration issues and allow undefined behavior. More critically, if the Supabase fallback's fetch() silently fails (network timeout), it returns null but the caller treats null as 'invalid JWT' rather than 'error'.
- **Fix:** Add explicit error logging before returning null in the Supabase fallback. Distinguish between 'token invalid' (return null) and 'service error' (throw or log). Optionally: require both env vars upfront if Clerk is absent. Add a separate metric/log line when the fallback path executes, so operators can monitor the migration window and spot config drift.
- **Evidence:** `if (env.CLERK_ISSUER) {
  const clerkUserId = await verifyClerkJwt(jwt, env);
  if (clerkUserId) return clerkUserId;
  // Fall through to Supabase if Clerk rejects
}
if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;  // Silent m`

### Auth gate bypass: T0_JWT_ENFORCED flag inverted in feed-me handler
- **Dimension:** Security & Authorization
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:140-161`
- **Problem:** The feed-me handler enforces JWT when T0_JWT_ENFORCED !== '0'. The logic is: if NOT disabled, require JWT. However, when T0_JWT_ENFORCED is '0' (dev mode), it falls back to x-user-id header with no ownership check against the path parameter. The condition at line 150 checks `verified !== pathUserId`, but if T0_JWT_ENFORCED is '0', verified is undefined, so the comparison never executes. In dev mode, line 154 reads x-user-id and line 158 checks it against pathUserId — this is correct. The actual implementation is safe, but the logic is confusing and could be misunderstood during refactoring. The intention is: 'fail CLOSED unless T0_JWT_ENFORCED is explicitly 0', which is a good default but is fragile.
- **Fix:** Code is functionally correct (fail CLOSED is the default). Improve clarity by inverting the sense: `if (env.T0_JWT_ENFORCED === '0')` to highlight that dev mode is the special case, not the default. Add a loud comment: 'DEV MODE: disable JWT and rely on x-user-id header (spoofable).' Document the gate's lifecycle (when will it flip to '1'?) and add a TODO for cleanup.
- **Evidence:** `// ── Auth + ownership ── fail CLOSED unless T0_JWT_ENFORCED === '0' (dev).
if (env.T0_JWT_ENFORCED !== '0') {
  const verified = await verifyClerkJwt(auth.slice('Bearer '.length), env);
  if (!verified) return json({ error: 'invalid_jwt' }`

### Unsafe parseFloat on environment variables without validation
- **Dimension:** Input Validation
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/label.ts:137-140`
- **Problem:** parseFloat is called on KV-retrieved values and environment variables without bounds checking. If a corrupted value or intentionally malicious string is stored in KV (via prior request injection), parseFloat returns NaN or Infinity, causing silent cost-cap bypass or incorrect calculations.
- **Fix:** Validate that parseFloat results are finite numbers and within expected ranges. Use Number.isFinite() and bounds checks: `const used = usedRaw ? Math.max(0, parseFloat(usedRaw) || 0) : 0;`
- **Evidence:** `const used = usedRaw ? parseFloat(usedRaw) || 0 : 0;
const budget = env.DAILY_LABEL_BUDGET_USD
    ? parseFloat(env.DAILY_LABEL_BUDGET_USD)
    : DEFAULT_BUDGET_USD;`

### Missing bounds validation on body.row object size in /ingest-event
- **Dimension:** Input Validation
- **File:** `/Users/serrayildirim/ollie/workers/ai-postgres/src/telemetry.ts:182-208`
- **Problem:** The /ingest-event endpoint accepts arbitrary `body.row` objects and forwards them directly to Supabase REST via JSON.stringify(body.row) without size limits. An attacker can send a multi-megabyte object, consuming worker memory and potentially causing OOM crashes or DoS.
- **Fix:** Add a maximum size check for the row object. Estimate the JSON size with JSON.stringify(body.row).length and reject if over a threshold (e.g., 64KB): `const rowStr = JSON.stringify(body.row); if (rowStr.length > 65536) return json({ error: 'row_too_large' }, 400);`
- **Evidence:** `if (!body.row || typeof body.row !== 'object' || Array.isArray(body.row)) {
    return json({ error: 'invalid_row' }, 400);
}
...body: JSON.stringify(body.row),`

### UUID generation logic duplicated across 16+ module repositories
- **Dimension:** Reinvented Wheels & Duplication
- **File:** `apps/native/src/modules/goals/repo.ts:81-85`
- **Problem:** This exact function is defined identically (with different prefixes) in 16 module repositories: goals, sleep, pets, cycle, body, habits, admin, grocery, finance, work, medication, mood, and archive. Each module reimplements the same crypto.randomUUID fallback logic instead of using a shared utility.
- **Fix:** Extract to a shared @ollie/crypto or @ollie/id utility function. Create export function newId(prefix: string): string in a dedicated module, or add to @ollie/crypto. Update all 16 repository files to import and use it.
- **Evidence:** `function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'gl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}';
}`

### UUID generation duplicated in 4 separate packages without a central export
- **Dimension:** Reinvented Wheels & Duplication
- **File:** `packages/research-stream/src/index.ts:338-349`
- **Problem:** Full UUID v4 generation with RFC4122 fallback is implemented here. Similar but longer implementations exist in packages/orchestrator/braindump-dispatch.ts (line 312-316), packages/worker-http/src/index.ts (line 68-72), and workers/ai-proxy/src/telemetry.ts (line 125). The package already exports @ollie/crypto but doesn't export UUID generation.
- **Fix:** Export a generateUuid() function from @ollie/crypto/src/index.ts and use it in all four locations. Consolidate both the simple version (with Math.random fallback) and RFC4122 full version into one exported utility.
- **Evidence:** `function randomUuid(): string {
  const g: any = globalThis;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID() as string;
  // Fallback (Node 20 has randomUUID; this is just for completeness)
  const bytes = new Uint8Array(16);
  g.c`

### Unsafe as unknown as T cast in api client
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/api/src/client.ts:194`
- **Problem:** When parseJson is false, response text is cast to T via double cast (as unknown as T) without validation, allowing any type. This bypasses type safety when callers expect structured data but receive plain text.
- **Fix:** Add runtime validation or return the text as string, letting callers handle parsing. Alternatively, constrain T to be validateable.
- **Evidence:** `const data = (await res.text()) as unknown as T;`

### Unsafe type cast of module handlers in registry
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/stubs.ts:95-108`
- **Problem:** Each module handler is cast as unknown as ModuleHandler<Module> to fit into a homogeneous record. This discards specific type information and allows passing incompatible handlers without compile-time detection.
- **Fix:** Use a discriminated union or generic factory pattern to preserve handler types. Alternatively, ensure all handlers return the same shape at the type level.
- **Evidence:** `grocery: groceryHandler as unknown as ModuleHandler<Module>,
  pets: petsHandler as unknown as ModuleHandler<Module>,`

### Unhandled promise rejection in braindump-dispatch grocery routing
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:847`
- **Problem:** The async IIFE on line 767-847 calls callGroceryRoute() and handles routing, but the entire IIFE is fired via `void (async () => { ... })()` without a .catch() at the end. If an unhandled error occurs inside the IIFE (e.g., in the event.emit calls or error handling logic), it will be an unhandled promise rejection. The grocery routing is fire-and-forget, but errors should be caught and logged.
- **Fix:** Add .catch() to the IIFE: `void (async () => { ... })().catch(err => { onError?.(err, ...) })`.
- **Evidence:** `    void (async () => {
      const result = await callGroceryRoute(data, id, opts.authToken, logContext);
      const now2 = Date.now();
      try {
        events.emit('grocery:routed', {...});
      } catch { /* non-fatal */ }
    })();`

### Swallowed error: empty catch in Vectorize cache lookup
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:266-269`
- **Problem:** cacheLookup is called via Promise.all().map() with a catch that returns null: `.catch((err) => { console.error(...); return null; })`. While this is intentional (miss-through), the console.error is the only observability. If Vectorize is down or the embedding lookup fails, every fragment becomes a cache miss, inflating AI call costs. No alert mechanism exists for persistent Vectorize failures.
- **Fix:** Add Sentry instrumentation or count persistent Vectorize failures. A 100% miss rate after a Vectorize outage should surface an alert, not silently inflate costs. Consider fail-open: if Vectorize fails for a user, route the fragments normally (no cache), but count the failure for operational awareness.
- **Evidence:** `      cacheLookup(env.VECTORIZE_INDEX, uid, embedding).catch((err) => {
        console.error('[route/dump] vectorize lookup failed, miss-through', err);
        return null as Awaited<ReturnType<typeof cacheLookup>>;
      }),`

### dispatchAction function is 467 lines long with 10+ module branches
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:692-1157`
- **Problem:** The dispatchAction function is extremely large (467 lines) with 10+ sequential module-specific branches (if module === 'grocery', if module === 'cycle', if module === 'finance', etc.). This violates single-responsibility and makes the function hard to test, modify, and reason about. The branching should be extracted into a dispatch table or separate handler functions per module.
- **Fix:** Refactor dispatchAction into: (1) a dispatch table mapping module → handler function, or (2) separate handler functions (dispatchGrocery, dispatchCycle, dispatchFinance, etc.) that are called from a smaller router function. This will reduce cognitive load, improve testability, and make it easier to modify individual modules without affecting others.
- **Evidence:** `Lines 721-850 (grocery branch with nested async logic), 851-895 (grocery log branch), 900-1157 (9 more branches for cycle, finance, work, goals, body, astrology, pets, admin, habits, health). Each branch has inline store mutations with iden`

### applyGroceryMutations function has 247 lines of repetitive mutation code with high nesting
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:400-647`
- **Problem:** The applyGroceryMutations function spans 247 lines and contains 4 near-identical case branches (add, remove, check, move_to_pantry) with heavy code duplication. Each case has similar patterns: snapshot updates, error handling, mutation tracking callbacks. The 'add' case branches into pantry/shopping sub-branches, and 'remove' does the same, leading to 4 nested if-else chains with duplicated logic.
- **Fix:** Extract common patterns into helper functions: (1) createMutationSnapshot() for capturing pre-state, (2) applyMutationCallback() for invoking onGroceryMutation with error handling, (3) createMutationReverse() for building undo payloads. This will reduce the function to ~120 lines and eliminate duplication across branches.
- **Evidence:** `Lines 410-462 (add:pantry with 14 lines of snapshot/callback code), 441-461 (add:shopping repeating same pattern), 465-534 (remove with 69 lines of duplicated pantry/shopping logic), 537-576 (check case duplicating pantry/shopping pattern a`

### grocery.config.ts is 1,820 lines — a data dump file masquerading as config
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/modules/grocery.config.ts:218-1820`
- **Problem:** The SHELF_LIFE_DETAIL object in grocery.config.ts contains ~600 food items, each with 3-5 properties, occupying ~1,600 lines. This is pure data (shelving metadata) that belongs in a JSON or CSV file, not a TypeScript module. It makes the config file unmaintainable (hard to search, edit, or review), inflates bundle size, and mixes domain logic with data.
- **Fix:** Move SHELF_LIFE_DETAIL to a separate data file: `shelf-life.json` or `shelf-life.data.ts` in a `/data` subdirectory. Keep only the schema types and config shape in `grocery.config.ts`. Import the data at runtime. This also allows rapid updates to shelf-life data without code review of the orchestrator.
- **Evidence:** `Lines 218-1819 define 600+ items with repetitive shape: 'apple: { days: 30, category: 'produce', note: 'USDA fridge 4-6wk' },' repeated for every fruit, vegetable, meat, grain, dairy product, etc. The file is 94% data, 6% schema definition.`

### Critical empty interface with unused eslint-disable rule
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/shelf-life.ts:34-35`
- **Problem:** An empty interface declaration is flagged as an error by @typescript-eslint/no-empty-object-type. The eslint-disable comment references a different rule (@typescript-eslint/no-empty-interface) that has been removed from ESLint, creating an unused directive warning. The interface itself violates the no-empty-object-type rule and should either be fixed or the correct disable comment should be used.
- **Fix:** Replace with either: (1) Replace the interface with `export type ShelfLifeEnv = Record<string, never>;` (2) Or add a valid eslint-disable comment for @typescript-eslint/no-empty-object-type rule if the empty interface is intentional
- **Evidence:** `// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ShelfLifeEnv {}`

### Inconsistent tsconfig strictness: missing noUnusedLocals and noUnusedParameters
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/packages/logic/tsconfig.json`
- **Problem:** Only apps/native enables noUnusedLocals and noUnusedParameters (line 19-20 of native/tsconfig.json). All 18 packages inherit from tsconfig.base.json which does not set these flags. This creates inconsistent type-checking rigor across the monorepo—packages silently allow unused local variables while the native app catches them. Should be enabled globally in tsconfig.base.json to enforce consistency.
- **Fix:** Add "noUnusedLocals": true and "noUnusedParameters": true to tsconfig.base.json (compilerOptions section) to ensure consistent strictness across all packages
- **Evidence:** `apps/native/tsconfig.json has: "noUnusedLocals": true, "noUnusedParameters": true
But tsconfig.base.json and all packages lack these settings`

### Package does not extend base tsconfig and lacks required compiler options
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/packages/crisis-lexicon/tsconfig.json`
- **Problem:** crisis-lexicon does not extend tsconfig.base.json. It duplicates base settings but is missing critical options: forceConsistentCasingInFileNames, resolveJsonModule, and jsx. This creates a maintenance burden and inconsistency—any future changes to base.json won't apply here, and the package has weaker checks than others.
- **Fix:** Change crisis-lexicon/tsconfig.json to extend base: "extends": "../../tsconfig.base.json" and remove duplicate settings that are now inherited
- **Evidence:** `crisis-lexicon/tsconfig.json does not have extends field and lacks: "forceConsistentCasingInFileNames": true, "resolveJsonModule": true, "jsx": "react-jsx"`

### Confidence policy doesn't enforce system prompt constraint about remindIn
- **Dimension:** Dump Routing Flow Correctness
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-classify.ts:100`
- **Problem:** The system prompt at line 100 instructs the classifier: 'Never a separate reminder fragment, never dump_only when remindIn present.' However, the confidence policy in dump-schema.ts applyConfidencePolicy() has no knowledge of this constraint and will demote ANY low-confidence classification to dump_only, including those with remindIn. The rule in the prompt is unenforceable and can be silently violated by the confidence thresholding mechanism.
- **Fix:** Either (1) modify applyConfidencePolicy to recognize remindIn fields and preserve the original classification when present, or (2) update the system prompt to clarify that remindIn can be demoted if confidence < 0.60, and document this trade-off in the routing pipeline documentation.
- **Evidence:** `dump-classify.ts line 100 says 'never dump_only when remindIn present' but dump.ts lines 281 and 338 apply applyConfidencePolicy without checking for remindIn presence, allowing demotion regardless.`

### Incorrect summary truncation logic in rule-based extraction
- **Dimension:** Algorithms Correctness & Efficiency
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/journal/extract.ts:140-145`
- **Problem:** The summary generation finds sentence breaks at indices like 10, 15, 20 (representing positions in the trimmed text). Then it uses Math.min(80, ...indices) which returns the SMALLEST index, not the first one under 80 chars. This truncates summaries much earlier than intended, losing content. The intention is to find the first sentence break within the first 80 characters, not the earliest break overall.
- **Fix:** Use Math.max (which returns the largest value) to find the latest sentence break before position 80, or filter for breaks < 80 and take the maximum: `const breaks = [80, ...(['. ', '? ', '! ', '\n'].map(s => { const idx = trimmed.indexOf(s); return idx > 0 && idx < 80 ? idx : -1; }).filter(x => x >= 0))]; const firstBreak = Math.max(...breaks);`
- **Evidence:** `const firstBreak = Math.min(80, ...(['. ', '? ', '! ', '\n'].map(s => { const idx = trimmed.indexOf(s); return idx > 0 && idx < 80 ? idx : 80; })));`

### Store key schema mismatch: sleep.debt field name
- **Dimension:** State & Store Consistency
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/sleep.ts:379-381`
- **Problem:** The sleep orchestrator reads `sleep.debt` expecting a `debt_hours` field, but the bridge (and the computeSleepDebt logic function) write `{totalDeficitHours, nightsCounted}`. This causes debtHrs to always be 0, silently breaking the pacing-breach detector that depends on this value to emit the `sleep:pacing_breach_detected` event.
- **Fix:** Change line 379 to read `totalDeficitHours` instead of `debt_hours`. Either: (1) read `debt?.totalDeficitHours ?? 0`, or (2) update the type annotation to match reality and access the correct field. Verify the pacing_breach detection threshold logic (line 382: `if (debtHrs >= 4 ...`) is correct for the new value range.
- **Evidence:** `Line 300: 'const debt = computeSleepDebt(records, target, 14, now)' returns '{totalDeficitHours: number, nightsCounted: number}' per @ollie/logic/sleep types. Line 301: 'setKey('debt', debt)' writes the object as-is. Lines 379-381: 'const d`

### enriched_signals lacks unique constraint on dump_id, allowing duplicate signal rows
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/supabase/migrations/20260514000002_enriched_signals.sql:13-28`
- **Problem:** enriched_signals table has no unique constraint on dump_id. If processOne() crashes after insertRawDump() succeeds but before insertEnrichedSignal() completes and KV entry is deleted, the retry will call insertEnrichedSignal() again, creating a duplicate row. The comment at drain.ts:28-32 acknowledges this but claims 'in practice' it won't happen because the enriched write 'either fully succeeded last time...or fully failed'. However, this assumes insertEnrichedSignal() either fully succeeds or throws before writing anything. Partial failures (network timeout mid-write, Postgres connection drop during INSERT) are not covered.
- **Fix:** Add a UNIQUE constraint on (dump_id) to enriched_signals to guarantee at-most-one enrichment per dump. Alternatively, change insertEnrichedSignal() to use an UPSERT with on_conflict=dump_id, similar to raw_dumps.
- **Evidence:** `CREATE TABLE enriched_signals (id UUID PRIMARY KEY, dump_id UUID NOT NULL REFERENCES raw_dumps(id), ...) — no unique index on dump_id. Compare to raw_dumps.sql which has dump.id as the primary key and is UPSERTed in drain.ts:308.`

### Missing FORCE ROW LEVEL SECURITY on service-role-only tables
- **Dimension:** DB, Migrations & Schema
- **File:** `/Users/serrayildirim/ollie/supabase/migrations/20260602103016_partner_bilateral_sync.sql:47-49`
- **Problem:** Partner sync tables (partner_codes, partner_pairs, partner_snapshots) enable RLS but do not FORCE it. Without FORCE RLS, the table owner can bypass RLS and read all rows. This creates a privilege escalation vulnerability where the migration user account (typically postgres or a deployment role) could access sensitive data without row-level filtering.
- **Fix:** Add `ALTER TABLE <table> FORCE ROW LEVEL SECURITY;` immediately after each ENABLE RLS statement to prevent table owner bypass. Consistent with the pattern used in earlier migrations (e.g., 20260512000001_encrypted_state.sql).
- **Evidence:** `ALTER TABLE partner_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_snapshots ENABLE ROW LEVEL SECURITY;`

### Missing FORCE ROW LEVEL SECURITY on grocery_purchase_history
- **Dimension:** DB, Migrations & Schema
- **File:** `/Users/serrayildirim/ollie/supabase/migrations/20260522000001_grocery_purchase_history.sql:31`
- **Problem:** grocery_purchase_history enables RLS but does not force it. The table owner could bypass RLS policies and access all user grocery data. This is inconsistent with the established security pattern and creates an unnecessary privilege escalation surface.
- **Fix:** Add `ALTER TABLE grocery_purchase_history FORCE ROW LEVEL SECURITY;` after the ENABLE RLS statement to match the security posture of other user-scoped tables.
- **Evidence:** `ALTER TABLE grocery_purchase_history ENABLE ROW LEVEL SECURITY;

-- Users see only their own rows.
CREATE POLICY grocery_purchase_history_self_select`

### Missing FORCE ROW LEVEL SECURITY on cook_history
- **Dimension:** DB, Migrations & Schema
- **File:** `/Users/serrayildirim/ollie/supabase/migrations/20260522000002_cook_history.sql:26`
- **Problem:** cook_history enables RLS but does not force it. Although the table is effectively service-role-only via the SECURITY DEFINER feed_me_cook_signals RPC, the lack of FORCE RLS still creates a theoretical privilege escalation path for the table owner to read user cooking history data.
- **Fix:** Add `ALTER TABLE cook_history FORCE ROW LEVEL SECURITY;` immediately after the ENABLE RLS statement to close the owner-bypass window.
- **Evidence:** `ALTER TABLE cook_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY cook_history_self_select
  ON cook_history FOR SELECT TO authenticated
  USING (auth.uid() = user_id);`

### Missing FORCE ROW LEVEL SECURITY on routing_cache
- **Dimension:** DB, Migrations & Schema
- **File:** `/Users/serrayildirim/ollie/supabase/migrations/20260521000001_routing_cache.sql:70`
- **Problem:** routing_cache enables RLS but does not force it. The table holds module routing classifications and embeddings that should be service_role-only. Without forcing RLS, the table owner could bypass the RLS policy and enumerate the entire cache.
- **Fix:** Add `ALTER TABLE routing_cache FORCE ROW LEVEL SECURITY;` after the enable statement to prevent owner bypass and enforce consistent defense-in-depth security.
- **Evidence:** `alter table public.routing_cache enable row level security;

-- Only the service_role (CF worker) may read or write. No anon/user access.
create policy "service_role full access"`

### Serial per-row /label calls in research orchestrator flush
- **Dimension:** Performance & Cost
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/research.ts:158-187`
- **Problem:** The research orchestrator flushes a batch of up to 60 scrubbable writes in a serial loop, awaiting labelClient.postLabel() for each write independently. When 10 rows are buffered, this performs 10 sequential HTTP round-trips instead of batching them. Each request round-trip to /label (POST to ai-proxy) incurs ~100-300ms latency; a 10-row batch costs 1-3 seconds of artificial delay instead of a single parallel flush.
- **Fix:** Batch the labelClient.postLabel() calls using Promise.all(). Send all scrubbed texts to a bulk endpoint if available, or at minimum parallelize the current endpoint: `const results = await Promise.all(drain.map(write => labelClient.postLabel({...})))`. This drops latency from O(N) round-trips to O(1) for the flush cycle.
- **Evidence:** `for (const write of drain) { ... const resp = await labelClient.postLabel({ ... }) ... }`

### Hardcoded English action descriptions in brain copy prompt
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/brain/copy.ts:102-104`
- **Problem:** ACTION_DESCRIPTION constant is hardcoded English: 'you can offer to add the item back onto the shopping list'. This English instruction is embedded in the system prompt sent to LLMs generating copy in Spanish/Turkish. It will confuse non-English models and violate the i18n requirement that AI-generated copy should guide the LLM in the target language.
- **Fix:** Translate ACTION_DESCRIPTION: const ACTION_DESCRIPTION: Record<CopyActionKind, Record<AppLang, string>> = { add_to_grocery_list: { en: 'you can offer to add the item back onto the shopping list', es: 'puede ofrecer volver a agregar el artículo a la lista de compras', tr: 'öğeyi alışveriş listesine geri eklemeyi sunabilirsiniz' } }; Update buildCopyPrompt to use ACTION_DESCRIPTION[facts.action][lang]
- **Evidence:** `const ACTION_DESCRIPTION: Record<CopyActionKind, string> = { add_to_grocery_list: 'you can offer to add the item back onto the shopping list', };`

### Nine critical router modules untested
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/`
- **Problem:** Nine modules core to the brain-dump routing pipeline lack unit tests: segmentation.ts (pass-1 sentence splitting + conjunction re-splitting), segmentation-llm.ts (pass-2 LLM-driven fragmentation), lang-detect.ts (per-fragment language detection), dump-classify.ts (Layer 1 classifier wrapper), json-cascade.ts (provider fallback orchestration), transcribe.ts (Groq Whisper endpoint), cook-history.ts, partner.ts, and helper functions. These modules handle critical pipeline stages — segmentation determines fragment boundaries, language detection drives multilingual routing, json-cascade prevents silent data loss on provider failures (per dogfood B3 regression), and transcribe handles audio input. No tests means regressions in these areas are invisible until production.
- **Fix:** Write unit tests for all nine modules. Priority order: (1) segmentation + segmentation-llm (determine fragment boundaries and trigger pass-2); (2) json-cascade (error paths for provider cascade failure); (3) lang-detect (correctness on mixed-language fragments); (4) dump-classify (prompt output parsing, confidence handling); (5) transcribe (audio parsing, mime-type mapping, edge cases like empty/oversized audio); (6) cook-history, partner (coverage depends on their callsites). For json-cascade specifically, test: all provider failures in sequence, parse() rejection advancing the cascade, last provider's error bubbling up, and happy-path fallthrough to each provider.
- **Evidence:** `find /Users/serrayildirim/ollie/workers/ai-proxy/src/router -name '*.ts' | (18 modules total) vs find /Users/serrayildirim/ollie/workers/ai-proxy/tests -name '*.test.ts' | (only 28 test files, many not paired 1:1). Missing: cook-history.tes`

### dump.test.ts smoke test only — missing error path coverage for Voyage, Groq, and rate-limiting
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/tests/dump.test.ts`
- **Problem:** The main /route/dump handler test is a single happy-path smoke test ("süt aldım" → grocery). The test file (262 lines) covers: text routing, remindIn injection, missing auth, missing CLERK_ISSUER, missing text, and malformed remindIn. It does NOT test critical error paths that ship to production: Voyage embedding failures (504, 429, malformed response), Groq classification cascade failures and 429 rate-limit handling, vision image processing errors, pass-2 segmentation failures with cascade fallthrough. These errors are handled in dump.ts (lines 260, 322, 332 show `upstreamError` calls) but have no test coverage. A regression in error response formatting, status codes, or the cascade logic would ship undetected.
- **Fix:** Add tests for: (1) Voyage 503/429 → returns 502 with error=voyage_embed_failed; (2) Groq 429 → returns 429 with error=rate_limited (not 502); (3) Groq 503 → tries Gemini fallback; (4) both Groq AND Gemini fail with 429 → returns 429 (not 502); (5) vision extraction throws → returns 502 error=vision_failed; (6) pass-2 cascade all providers fail → graceful fallback to pass-1 fragment; (7) Vectorize cache upsert failure → logs but does not block response.
- **Evidence:** `dump.test.ts lines 136-232: only happy paths (401, 503 for missing CLERK_ISSUER, 400 for missing text). dump.ts lines 177, 260, 322-332 show error handling for vision_failed, voyage_embed_failed, groq_classify_failed, and rate_limited. grep`

### json-cascade.ts provider fallback logic untested
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/json-cascade.ts`
- **Problem:** The jsonCascade() function (lines 55-122) implements a 4-provider fallback chain critical to preventing silent data loss. When Groq's JSON-mode validation fails (json_validate_failed 400) or any provider throws, the cascade advances to the next provider. The function is called by pass2Split() (segmentation-llm.ts) and classifyFragment() (dump-classify.ts) — both are untested. Per the code comment (lines 20-21), a pre-cascade Groq json_validate_failed caused a dump to collapse to a single fragment (dogfood B3, 2026-06-05). The cascade logic has zero unit tests. A regression where: (a) a parse() exception doesn't advance to the next provider, (b) lastErr is not properly threaded, or (c) the final provider's error doesn't bubble up, would silently degrade routing quality.
- **Fix:** Write integration tests for jsonCascade with realistic provider chains. Test: (1) Groq succeeds → returns groq result; (2) Groq throws, Gemini succeeds → returns gemini result; (3) Groq parse() rejects, Cloudflare succeeds → returns cf result; (4) all providers throw → last error bubbles up (not first); (5) parse() rejection doesn't eat the error context; (6) empty/truncated response from a provider triggers fallthrough. Provide realistic test fixtures (fragmented JSON, edge-case inputs) that trigger parse() rejection on one provider but pass on another.
- **Evidence:** `json-cascade.ts lines 108-122 show the retry loop: for each provider, try run() and parse(); if parse() throws, advance. No unit test file exists. The cascade is critical per dogfood B3 comment but untested.`

### Deprecated Clerk package - migrate to @clerk/react
- **Dimension:** Dependency Health
- **File:** `/Users/serrayildirim/ollie/apps/native/package.json:15`
- **Problem:** @clerk/clerk-react@5.61.3 is deprecated and no longer supported. The package registry explicitly marks it as deprecated with a migration notice. This is a direct dependency in the native app and blocks upgrade path to future Clerk versions.
- **Fix:** Update apps/native/package.json to use @clerk/react instead of @clerk/clerk-react, and follow the upgrade guide at https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3 to ensure API compatibility.
- **Evidence:** `@clerk/clerk-react@5.61.3' deprecated: 'This package is no longer supported. Please use @clerk/react instead.'`

## MEDIUM — 55

### Missing rate-limit enforcement on open shelf-life endpoints
- **Dimension:** Security & Authorization
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:258-303`
- **Problem:** The /shelf-life/all and /shelf-life/lookup/:item endpoints are unauthenticated and public. They apply per-caller rate-limiting via resolveUserIdForRateLimit() (line 263, 285), which returns the caller's IP or 'anon' if ID cannot be determined. However, if resolveUserIdForRateLimit returns null, the rate-limit check is skipped entirely (lines 264-274). An attacker can omit x-user-id header and spoof x-forwarded-for (if trust model allows), causing every request to be rate-limited separately as 'anon', but if the caller's IP is missing or varies per request, the bucket key changes and the limit never accumulates.
- **Fix:** Ensure resolveUserIdForRateLimit always returns a non-null value (e.g., fall back to 'anon' or a per-request uuid). Alternatively, rate-limit ALL requests to shelf-life endpoints regardless of whether user_id is available, using a fixed 'shelf-life-public' bucket for unauthenticated callers. This prevents a single attacker from burning the cache by spoofing different IPs.
- **Evidence:** `const slUser = await resolveUserIdForRateLimit(req, env);
if (slUser) {  // ← Only checks rate-limit if slUser is non-null
  const allowed = await checkRate(
    env.TELEM_RATE_LIMITER,
    env.RATE_KV,
    'rl:shelflife-all:${slUser}',
   `

### CORS Allow-Origin '*' exposes all endpoints to cross-origin spoofing
- **Dimension:** Security & Authorization
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:124-131`
- **Problem:** The worker sets 'Access-Control-Allow-Origin': '*' for all CORS preflight responses. While this is necessary for browser-based clients (Electron, web), it means any website can make requests to the worker and receive responses. Combined with the IDOR vulnerabilities in the telemetry endpoints, a malicious webpage can craft Authorization headers and user_hash values to exfiltrate or poison telemetry on behalf of any user with an active session (session tokens stolen via XSS). The Authorization header blocks simple requests, but preflight is answered.
- **Fix:** Restrict CORS origin to trusted domains (e.g., ollie.app, *.ollie.app). Alternatively, remove the broad '*' and rely on credentials mode (credentials: 'include') on the client side, which enforces same-site checks. If dynamic origins are needed (dev / staging), fetch the allowed list from env and validate req.headers.get('origin') against it. Document the trust model (who can call this worker?).
- **Evidence:** `function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',  // ← Allows any origin
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authori`

### Auth enforcement flag T0_JWT_ENFORCED defaults to enforcing JWT when unset (fail-closed is good, but brittle)
- **Dimension:** Security & Authorization
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:217-230`
- **Problem:** The /route/:module handler checks `if (env.T0_JWT_ENFORCED !== '0')` to enforce JWT. This means the default (when the env var is unset) is to enforce auth. While fail-closed is a good security posture, the implicit default is fragile: if the env var is accidentally omitted from wrangler.toml or during a deploy, auth will be enforced silently. The codebase has at least 4 gates using this pattern (/route/dump, /route/:module, /feed-me/:user, /purchase). A safer approach is explicit: require T0_JWT_ENFORCED='1' to enable (not disable).
- **Fix:** Acceptable as-is if the pattern is consistently applied across all gates (which it appears to be). Add explicit documentation in the Env type comments for each flag, stating: 'Defaults to ENABLED (JWT required). Set to "0" only in local dev.' Consider adding a startup log: 'T0_JWT_ENFORCED=[value]' so operators can verify the setting on deploy.
- **Evidence:** `// Auth gate — fail CLOSED by default. We validate the Bearer token
// against the Clerk JWKS unless T0_JWT_ENFORCED is explicitly set to
// '0' (local dev only). A missing/unset flag therefore enforces auth,
// so a misdeploy can never lea`

### Unsafe parseInt on legacy KV rate-limit counter
- **Dimension:** Input Validation
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:467`
- **Problem:** parseInt(raw, 10) returns NaN when the KV value is corrupted or non-numeric, which then converts to 0 via `|| 0`. This causes the rate-limit counter to reset on corrupted data, allowing bypass. The same pattern appears in invites.ts.
- **Fix:** Validate the parseInt result is a finite integer: `const parsed = parseInt(raw, 10); const count = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;`
- **Evidence:** `const count = raw ? parseInt(raw, 10) || 0 : 0;
if (count >= max) return false;`

### Unvalidated body.text in /route/:module lacks length bounds
- **Dimension:** Input Validation
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:246-249`
- **Problem:** The route handler accepts body.text as a string but does not validate its length. An attacker can send a multi-megabyte string, consuming worker memory and forcing expensive embedding/classify operations. No maximum text length is enforced.
- **Fix:** Add explicit length validation after parsing: `if (typeof body.text !== 'string' || body.text.length > 100000) return json({ error: 'text_too_long' }, 400);`
- **Evidence:** `let body: { text: string; dumpId?: string; context?: unknown };
try {
    body = (await req.json()) as { text: string; dumpId?: string; context?: unknown };
} catch {`

### Path parameter module name not validated against module registry
- **Dimension:** Input Validation
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:366-370`
- **Problem:** The /route/:module path parameter is extracted via regex and passed directly to handleRoute without pre-validation. While handleRoute checks the module against MODULE_CONFIGS, the module string could be arbitrarily long. An attacker can send paths like /route/aaaa...aaaa (64KB+) that gets parsed and logged.
- **Fix:** Add length validation on the extracted module name before calling handleRoute: `if (module.length > 64) return withCors(json({ error: 'invalid_module' }, 400));`
- **Evidence:** `const routeMatch = url.pathname.match(/^/route\/([a-z_-]+)$/);
if (routeMatch) {
  const module = routeMatch[1];
  return withCors(await handleRoute(req, env, module));`

### startOfDay() reimplemented in 3 separate locations
- **Dimension:** Reinvented Wheels & Duplication
- **File:** `packages/logic/src/medication/index.ts:115-119`
- **Problem:** Identical logic exists in packages/notifications/src/budget.ts (line 47-51 as startOfLocalDay) and apps/native/src/modules/brain/capacity.ts (line 106-110 as startOfDayMs). Each package reimplements this common date-utility function independently.
- **Fix:** Export startOfDay() from @ollie/logic/src/util/index.ts (which already exports dayKey and other time utilities). Update the other two locations to import it instead of redefining.
- **Evidence:** `function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}`

### newRequestId() in @ollie/worker-http duplicates UUID fallback logic
- **Dimension:** Reinvented Wheels & Duplication
- **File:** `packages/worker-http/src/index.ts:65-73`
- **Problem:** This is a specialized UUID-with-prefix wrapper (like the 16 module repositories) but exported at package level. It duplicates the same fallback pattern seen in all the module newId() functions rather than reusing a shared utility.
- **Fix:** Once @ollie/crypto exports a shared UUID utility, refactor newRequestId() to use it: export function newRequestId(): string { return `req_${generateUuid()}`.split('-')[0]; } or similar delegating approach.
- **Evidence:** `export function newRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* fall through */ }
  return 'req_${Date.now().toStrin`

### Redundant non-null assertions in goals phase functions
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/goals/velocity.ts:98`
- **Problem:** Code checks Array.isArray(history?.goals) but then uses double non-null assertions history!.goals! which are redundant given the guard. This pattern repeats across goal detectors (phase1, phase2, phase3, velocity) and obscures intent.
- **Fix:** Remove the redundant assertions after Array.isArray guard: const goals = history?.goals ?? [];. The type guard already narrows.
- **Evidence:** `const goals = Array.isArray(history?.goals) ? history!.goals! : [];`

### Unvalidated as unknown casts for Capacitor globals
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/notifications/src/backends/capacitor.ts:73`
- **Problem:** globalThis is cast as unknown to CapacitorGlobal without validation that Capacitor is actually present. The cast hides runtime availability from static analysis.
- **Fix:** Define the cast inline as needed: (globalThis as any).Capacitor, or wrap in a type-safe check function that returns T | null.
- **Evidence:** `const g = globalThis as unknown as CapacitorGlobal;`

### Implicit any type for globalThis crypto in research-stream
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/research-stream/src/index.ts:145, 340`
- **Problem:** globalThis is typed as 'any' to access navigator.onLine and crypto.randomUUID without type errors. This defeats type safety for global environment assumptions.
- **Fix:** Define a proper interface for the subset of globalThis you need: type MinimalGlobal = { navigator?: { onLine?: boolean }; crypto?: { randomUUID?: () => string } }; const g = globalThis as unknown as MinimalGlobal;
- **Evidence:** `const g: any = globalThis;`

### Unsafe Record<string, unknown> cast in sleep merge logic
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/sleep/parse.ts:161`
- **Problem:** Typed SleepRecord is cast to Record<string, unknown> to allow dynamic key assignment, losing all type information. Any key can be written without validation.
- **Fix:** Use a narrowly-typed helper: function setIfDefined<T extends Record<string, any>>(obj: T, key: keyof T, value: any) { if (value !== undefined && value !== null) obj[key] = value; }
- **Evidence:** `const outAny = out as unknown as Record<string, unknown>;`

### Unsafe cast in finance record merge for dynamic key assignment
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/finance/merge.ts:41`
- **Problem:** Typed FinanceRecord is cast to Record<string, unknown> to merge partial updates. Like sleep/parse, this loses type safety for the merge operation.
- **Fix:** Use Object.assign or a type-safe merge helper that validates keys against FinanceRecord schema.
- **Evidence:** `(out as unknown as Record<string, unknown>)[k] = v;`

### Fire-and-forget without error boundary: research orchestrator flush timer
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/research.ts:193`
- **Problem:** The setInterval callback wraps flush() in a void Promise.resolve().catch((err) => onError(...)), but if onError itself throws, it will be an unhandled rejection. Additionally, if flush() resolves but a side effect in onCorpusAppended() throws (called from inside flush at line 179), that error may not be caught.
- **Fix:** Wrap the entire callback: `flushTimer = setInterval(() => { try { void flush().catch(...); } catch(e) { console.error(...) } }, batchIntervalMs);` or ensure onError never throws.
- **Evidence:** `    flushTimer = setInterval(() => {
      void flush().catch((err) => onError(err, { table: 'brain_dump_log', row_id: '<flush>' }));
    }, batchIntervalMs);`

### Silent retry exhaustion: sync scheduler does not signal operator when giving up
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/packages/sync/src/retry.ts:121-127`
- **Problem:** When scheduleRetry() hits maxAttempts, it returns false and logs a warning, but the queue is left intact. A downstream operator never receives a 'failed to drain after max retries' alert. If the server is down for >8.5 min (with default backoff), the queue silently stops being retried, leaving unsynchronized state.
- **Fix:** Add an onExhausted callback to BackoffSchedulerOptions; call it when max retries are reached. Route to Sentry/metrics so operators know sync is stuck.
- **Evidence:** `  function scheduleRetry(): boolean {
    if (attempt >= maxAttempts) {
      console.warn('[sync] retry cap (${maxAttempts}) reached — backing off until next reset');
      return false;
    }`

### Potential silent error in partner bilateral sync: snapshot publish not awaited
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/partner/repo.ts:112, 130, 168`
- **Problem:** Three async function calls to putPartnerSnapshot() and unpairPartner() use .catch(() => {}) to suppress errors. While intentional (best-effort), if the snapshot write fails, the local state on THIS device diverges from the partner's view (the snapshot sent vs. what was actually stored). No retry mechanism exists, and no log entry persists to surface the mismatch later.
- **Fix:** Log each suppressed error with dumpId/userId context to allow offline debugging. Consider a 'sync pending' flag on the local state if the snapshot write fails, so a later successful sync or boot retries.
- **Evidence:** `    await putPartnerSnapshot(this.buildMySnapshot(next), { bearer }).catch(() => {});
    if (bearer) await unpairPartner({ bearer }).catch(() => {});
    await putPartnerSnapshot(this.buildMySnapshot(state), { bearer }).catch(() => {});`

### Error info loss: minimal logging on Supabase updateJob failures
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:471-476`
- **Problem:** updateJob() logs failures but never throws, so a failed PATCH to mark a job 'sent' is silently lost. The job remains 'pending' in the database, but the local in-memory stats report it as sent. A crash between the PATCH failure and the next tick will retry the job, potentially delivering a notification twice.
- **Fix:** Return a boolean from updateJob() indicating success; if false, reject the applyRetry so the job is not marked as processed (forcing a retry on the next tick).
- **Evidence:** `  } catch (err) {
    console.error('[flush] updateJob threw', id, String(err));
  }
  // No re-throw, no retry signal to the caller`

### No timeout on critical Supabase queries in flush-notifications
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:365, 405, 440, 465`
- **Problem:** fetch() calls to Supabase have no explicit timeout. If Supabase hangs, the cron worker will hang until the Workers runtime timeout (~30s), blocking other scheduled jobs. A hung countSentToday() query on a slow Supabase instance will timeout, return COUNT_UNAVAILABLE, and fail CLOSED on every job (correct behavior), but the worker never recovers.
- **Fix:** Add an AbortController timeout to every fetch: `const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5000); try { const resp = await fetch(..., {signal: controller.signal}); } finally { clearTimeout(timer); }`
- **Evidence:** `    const resp = await fetch(url, {      headers: { ...supabaseHeaders(env), prefer: 'count=exact' },
    });`

### Unused promise creation in research orchestrator init
- **Dimension:** Async & Concurrency
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/research.ts:218-223`
- **Problem:** The code creates a Promise.resolve().then() chain but the callback only checks `if (now() > 0)` without doing anything. According to the comment, this was intended to 'nudge a recompute' but the real flush waits for the interval. The promise is created but never actually triggers any work, suggesting dead code or incomplete logic. This can lead to confusion about initialization behavior and test reliability.
- **Fix:** Either remove this dead code if it's no longer needed, or implement the intended recompute nudge by calling `void flush().catch(...)` inside the then() block to actually trigger initialization. If it's meant as a placeholder for tests, add a TODO comment and consider moving this logic to a test-only configuration path.
- **Evidence:** `void Promise.resolve().then(() => {
  if (now() > 0) {
    /* placeholder so 'now' stays meaningful for tests; real flush
       waits for the interval */
  }
});`

### Missing error handling on KV delete in drain function
- **Dimension:** Async & Concurrency
- **File:** `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:145-146`
- **Problem:** After successfully processing an entry (await processOne), the code deletes both the queue entry and the retry counter with two separate await statements, but neither delete result is checked. If the first delete succeeds and the second fails, the system loses the ability to track retries. If the first delete fails entirely, subsequent retries will attempt to reprocess the same dump, potentially causing duplicate enrichment. There's no validation that both deletes succeeded before marking the entry as processed (succeeded++).
- **Fix:** Wrap both deletes in try-catch or combine them into a single atomic operation. Consider using Promise.all() to delete both keys in parallel and verify both succeed before incrementing succeeded counter: `await Promise.all([env.CACHE_KV.delete(entry.name), env.CACHE_KV.delete(...)]);` and add error handling in case one delete fails.
- **Evidence:** `try {
  await processOne(env, parsed);
  await env.CACHE_KV.delete(entry.name);
  await env.CACHE_KV.delete('${RETRY_PREFIX}${parsed.id}');
  succeeded++;
} catch (err) { ... }`

### Inline type declarations in store.update calls add 4-8 extra lines per mutation
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:413-423, 442-452, 468-479, 502-512, 540-554, etc.`
- **Problem:** Every store mutation is preceded by a 3-8 line inline type declaration: `store.update<Array<{ id: string; name: string; ... }>>(`. These types should be declared once at module scope instead of repeated 30+ times throughout the file. This bloats the file and makes schema changes painful.
- **Fix:** Define type aliases at module scope for each store slice: `type GroceryItem = { id: string; name: string; canonical?: string; ts: number; checked: boolean }; type PantryItem = { id: string; name: string; canonical?: string; ts: number; boughtTs: number };` Then use `store.update<GroceryItem[]>('grocery', 'items', ...)` instead of inline full types. This reduces repetition and improves maintainability.
- **Evidence:** `Lines 413-423 define full type inline for pantry add; 442-452 repeat nearly identical shape for shopping; 468-479, 502-512, 540-554 repeat with minor variations. Same pattern continues in dispatchAction for every module branch (lines 732, 7`

### MUTATION_RE regex spans 3 lines and mixes 10+ languages without comments per language
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:98-99`
- **Problem:** The MUTATION_RE regex is a 3-line whopper mixing EN, TR, and ES mutation verbs without grouping by language. It's hard to audit which verbs belong to which language, hard to extend one language without accidentally affecting another, and the regex string itself is 450+ characters on a few lines.
- **Fix:** Refactor to named sub-patterns: Create separate regex objects or arrays for each language (MUTATION_VERBS_EN, MUTATION_VERBS_TR, MUTATION_VERBS_ES), build them as `(EN_verbs)|(TR_verbs)|(ES_verbs)`, and add a comment above each language block explaining which verbs apply. Example: `const EN_VERBS = 'remove|delete|scratch|...' // etc` Alternatively, extract to a config object and build the regex with comments.
- **Evidence:** `Lines 98-99: 'const MUTATION_RE = /\b(remove|delete|scratch|...truncated for readability...|se echó a perder)\b/i;' spans 450+ characters with no per-language markers.`

### Inline closure definitions in dispatchAction grocery path obscure async flow
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:758-847, 875-892`
- **Problem:** The dispatchAction function defines two identical async IIFE closures (void (async () => { ... })()) for grocery routing at lines 758-847 and 875-892. These closures call callGroceryRoute, handle results, apply mutations, and emit events. The logic is inline and hard to test in isolation, and the double definition is duplicated code.
- **Fix:** Extract the async grocery routing logic into a helper function: `async function routeGroceryAsync(data: string, id: string, ...) { ... }` and call it from both places. This also makes the logic testable separately and reduces dispatchAction's cognitive load.
- **Evidence:** `Lines 758-847 (first async grocery handler for 'add' action), 875-892 (second async grocery handler for 'log' action). Both follow similar pattern: await callGroceryRoute, emit grocery:routed event, handle fallback. Second is shorter but fo`

### emitResearchRow is called 11+ times inline instead of being part of a wrapper
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:366-383, then used at 737, 858, 937, 947, 983, 995, 1004, 1018, 1055, 1088, 1118, 1136`
- **Problem:** Each module branch in dispatchAction calls `emitResearchRow()` separately with similar arguments (row ID, data, ts, locale). This is boilerplate that could be consolidated. The function itself (lines 366-383) is only 17 lines and is used as-is, making each call explicit rather than implicit in a wrapper.
- **Fix:** Create a wrapper: `function emitIfScrubbable(table: ScrubbableTable, rowId: string, text: string, ts: number, getLocale: () => DispatchLocale) { ... emitResearchRow(table, rowId, text, ts, getLocale()); }` and call it from each module branch instead of calling emitResearchRow directly. This makes intent clearer (we only emit for scrubbable tables, not all).
- **Evidence:** `emitResearchRow is called at lines 737, 858, 937, 947, 983, 995, 1004, 1018, 1055, 1088, 1118, 1136. Each call passes nearly identical signature: (table, id, data, ts, getLocale()).`

### Unused variable in test destructuring
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/tests/cadence-scanner.test.ts:235`
- **Problem:** Variable 'calls' is destructured from makeBackend() but never used in the test function. This violates the @typescript-eslint/no-unused-vars rule and should be prefixed with underscore if intentionally unused or removed if truly unnecessary.
- **Fix:** Either prefix with underscore to indicate intentional non-use (const { backend, _calls } = makeBackend();) or remove if unused
- **Evidence:** `const { backend, calls } = makeBackend();`

### Unused variable in test helper function
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/tests/route.test.ts:45`
- **Problem:** Function 'makeVoyageOk' is defined but never called within the test file. This violates the @typescript-eslint/no-unused-vars rule and should be either removed or prefixed with underscore if intentionally kept as documentation.
- **Fix:** Either remove the unused function or prefix with underscore (function _makeVoyageOk()) if it's meant to be kept as example code
- **Evidence:** `function makeVoyageOk(): FetchMockFn {`

### Unused eslint-disable directives for no-console
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/apps/native/src/lib/formatRelativeTime.ts:135`
- **Problem:** ESLint directive disables no-console rule, but no-console is not configured in eslint.config.mjs, making the directive unused. The codebase doesn't enforce a no-console rule, so the directive is unnecessary noise.
- **Fix:** Remove the eslint-disable comment since no-console is not an active rule in the config
- **Evidence:** `// eslint-disable-next-line no-console
console.warn(`

### Missing test coverage for remindIn interaction with confidence policy
- **Dimension:** Dump Routing Flow Correctness
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/tests`
- **Problem:** No test cases exist that verify the behavior of remindIn fields when they appear in low-confidence fragments that trigger the demotion policy (confidence < 0.60). The remindIn.test.ts tests the injection logic in isolation, and dump-coverage.test.ts has low-confidence test cases, but there is no integration test combining both scenarios. This allowed the silent data loss bug to go undetected.
- **Fix:** Add integration tests in dump.test.ts that verify: (1) remindIn fields are preserved when confidence >= 0.60, (2) remindIn behavior when confidence < 0.60 (should either be preserved, or dropped with explicit logging), (3) cache hits with remindIn fields at various confidence levels.
- **Evidence:** `grep -r 'remindIn' tests/ shows only isolated unit tests for remindIn injection and low_confidence demotion fixtures, but no test that combines them: no test case with 'remind me to X in N' text at low confidence.`

### Inaccurate logging: remindIn dropped status not logged for demoted fragments
- **Dimension:** Dump Routing Flow Correctness
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:285-290 and 342-347`
- **Problem:** When injectScheduledAt returns `{status: 'dropped'}` due to a malformed or out-of-range remindIn, the code logs a warning. However, when remindIn is missing entirely at the top level (because it's buried in originalGuess after demotion), injectScheduledAt returns `{status: 'absent'}` without logging. This creates a false sense of correctness - the code logs remindIn drops for explicit errors but not for structural loss due to demotion.
- **Fix:** After applyConfidencePolicy demotes a fragment to dump_only, check if the original payload contained remindIn and log a warning if so, since it will be lost in the demoted response.
- **Evidence:** `Lines 285-290 only log when reminderStatus.status === 'dropped', not when it === 'absent' due to structural unavailability. The same pattern at lines 342-347. No warning is logged in the critical data loss scenario.`

### O(n²) deduplication algorithm in brain selection
- **Dimension:** Algorithms Correctness & Efficiency
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/brain/select.ts:335`
- **Problem:** The candidate deduplication uses `.filter()` with `.findIndex()` to detect duplicates. For each element, findIndex scans the entire array again, creating O(n²) complexity. With large candidate lists, this becomes inefficient.
- **Fix:** Use a Set to track seen IDs in O(n) time instead: `const seen = new Set(); const deduped = candidates.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; })`
- **Evidence:** `.filter((c, i, arr) => arr.findIndex((o) => o.id === c.id) === i)`

### Store key written by bridge but not consumed by orchestrator: burhan.state
- **Dimension:** State & Store Consistency
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/burhan.ts:68-69`
- **Problem:** The burhan orchestrator reads and writes `burhan.state` and `burhan.lastAddedAt` from the store, but there is no corresponding `burhan` bridge in apps/native. Unlike other modules, burhan is event-driven (listening to cross-module events), not SQLite-mirrored. However, this means on native app startup, the store keys will be empty/null on first access until the orchestrator's init() runs and populates them. This is asymmetric with other modules that pre-populate via bridges, risking a brief window where watchers see stale/empty burhan state.
- **Fix:** Either: (1) Create apps/native/src/modules/burhan/bridge.ts that reads burhan state from SQLite (if burhan events are persisted there), or (2) explicitly document that burhan is append-only, event-driven-only, and accept the empty-on-boot behavior. If (2), add a defensive check in consuming code to handle null state gracefully, or seed an empty state in init().
- **Evidence:** `In orchestrator: line 68-69 reads 'getState()' which calls 'store.get('burhan', 'state', ...)'. No corresponding entry in apps/native/src/bridge/index.ts SYNCS list (the burhan sync function doesn't exist). Line 79 in orchestrator sets 'sto`

### potential race: watcher tick before post-dispatch sync completes
- **Dimension:** State & Store Consistency
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/dispatch.ts:95-109`
- **Problem:** The dispatch path fires runAllSyncs and recomputeBrain as non-blocking promises (fire-and-forget). While this keeps the UI responsive, a watcher may tick (subscribe callback fires) after a SQLite write but before the corresponding bridge sync lands, causing the watcher to operate on stale store data for one tick. The comment at line 92-94 acknowledges this trade-off, but the risk remains: intermediate states are observable if a dump writes to work.focus_log and the habits watcher (which reads work.focus_log) ticks before the work bridge runs.
- **Fix:** This is a documented design trade-off. Mitigation: (1) ensure modules are resilient to stale/empty inputs (they already have defensive `?? []` defaults), or (2) if a particular module's pattern detection is sensitive to timing, subscribe to the event-loop tick AFTER the sync completes rather than on direct store changes. Alternatively, measure real-world impact: if watchers never see intermediate states in practice, this is acceptable.
- **Evidence:** `Line 95-96: 'void Promise.all([runAllSyncs(store), ...])' does not await; execution returns immediately. Line 89: 'Non-blocking: fire-and-forget so the dump ack/UI never waits on the mirror.' Between dump completion and sync landing, subscr`

### RoutingSummary includes extra field pass2Triggered
- **Dimension:** API Contract Consistency
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:410-416`
- **Problem:** The worker's RoutingSummary includes pass2Triggered field (line 415) but the native client schema (apps/native/src/router/schema.ts lines 99-104) doesn't define this field. While extra fields in JSON responses don't cause runtime errors in JavaScript, this indicates schema drift and suggests the client schema may be stale.
- **Fix:** Add pass2Triggered?: number to native RoutingSummary type, or remove it from worker output if it's not needed by the client. Check if the UI should display pass2Triggered to users; if not, consider removing server-side to reduce payload.
- **Evidence:** `Worker dump.ts line 415: pass2Triggered in summary object. Native schema RoutingSummary: { moduleCount, cacheHitRate, aiCalls, durationMs } - no pass2Triggered field.`

### Fragment.needsConfirm is required but typed as optional
- **Dimension:** API Contract Consistency
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:48-49`
- **Problem:** The worker schema defines needsConfirm: boolean (required), but the native client schema (apps/native/src/router/schema.ts line 91) defines it as needsConfirm?: boolean (optional). The worker always populates this field (via applyConfidencePolicy in all code paths), so the mismatch is that the server sends required data but the client expects it to be optional. This is currently harmless but represents a contract inconsistency.
- **Fix:** Update native schema Fragment type to make needsConfirm required (not optional), or add documentation explaining why it's optional in the client but always present in responses. This aligns the type system with actual runtime behavior.
- **Evidence:** `Worker schema: Fragment { ...needsConfirm: boolean (line 49, required) }. All fragments receive needsConfirm via applyConfidencePolicy (line 72: confidence >=0.8 → false, >=0.6 → true, <0.6 → false for demoted). Native schema: Fragment { ..`

### scheduled_jobs unique dedupe constraint only applies to pending status, allowing collision after job fires
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/supabase/migrations/20260513000001_scheduled_jobs.sql:47-49`
- **Problem:** The unique index scheduled_jobs_dedupe_uniq includes WHERE status='pending'. This means once a job moves to 'fired' or 'failed', the constraint no longer applies. If a user reschedules a notification with the same dedupe_key after the first one was fired, the constraint allows it. While this is intentional (allowing re-scheduling), the server-schedule.ts:72 upsert call via the API client does NOT explicitly specify on_conflict handling, relying entirely on the constraint. If dedupe_key is NULL or if the constraint is not checked during the upsert, duplicate rows can accumulate.
- **Fix:** Document that dedupe_key uniqueness is per-user-per-pending-job and intentional re-schedules after firing are allowed. Verify the API upsert call explicitly handles on_conflict or ensures the constraint is enforced during upsert (test with a POST to scheduled_jobs with a duplicate dedupe_key while status='pending').
- **Evidence:** `Constraint definition: 'CREATE UNIQUE INDEX scheduled_jobs_dedupe_uniq ON scheduled_jobs (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND status='pending''. Upsert at server-schedule.ts:72 uses api.supabase.rest.upsert() which sets 'p`

### APNs delivery retry lacks idempotency for multi-device push — second device may get duplicate if first fails
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:223-241`
- **Problem:** When a scheduled_job has multiple device tokens, the drain calls pushOne() for each token in parallel (Promise.all at line 223). If delivery to token-1 succeeds but delivery to token-2 fails, and the entire batch is retried, the KV/queue redelivers the job and token-1 gets pushed again. There is no per-token tracking of delivery within a single job row. The job status flips to 'sent' only if anyOk=true (line 229), but no per-device idempotency key prevents duplicate pushes to token-1.
- **Fix:** Add a per-token idempotency mechanism: either (a) store a delivered_tokens set in the job payload, update it after each successful push, and skip already-delivered tokens on retry, or (b) generate a stable apns-id (idempotency key) per job per device and send it to APNs to prevent duplicate alerts even if Ollie delivers twice.
- **Evidence:** `flux-notifications.ts:223-226: 'const results = await Promise.all(tokens.map(...pushOne()))' — no per-token state tracking. If Promise.all returns [ok, fail] and the job is retried, pushOne(token-1) is called again without knowing it alread`

### Cloudflare Queues consumer binding commented out; KV-prefix fallback has no dedup on enriched_signals
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/workers/cron/wrangler.toml:58-63`
- **Problem:** The Cloudflare Queues consumer is commented out (wrangler.toml:58-63 in cron, ai-proxy:72-74). Until provisioned, the drain uses the legacy KV-prefix queue (q:enrich:*). On retry, if insertEnrichedSignal() fails, the KV entry is left intact and re-processed on the next 5-min cron tick. The retry counter (q:enrich:retry:*) caps at 12 retries and moves to DLQ, but insertEnrichedSignal() is still a plain INSERT with no dedup. Once Queues IS provisioned, message.ack() and message.retry() are idempotent to the Queue itself, but handleEnrichQueueBatch (drain.ts:181) still calls the unprotected insertEnrichedSignal().
- **Fix:** Before uncommenting the Queues consumer binding, add a unique constraint on enriched_signals(dump_id) or use an UPSERT in insertEnrichedSignal(). Test both the KV-prefix path and the Queues path for idempotency by simulating a crash after insertRawDump succeeds.
- **Evidence:** `drain.ts:181-195: handleEnrichQueueBatch calls processOne() which calls insertEnrichedSignal() without dedup. wrangler.toml:58-63 is commented: '# [[queues.consumers]]' with a note 'COMMENTED OUT, see DEPLOY_TODO'.`

### Missing rollback migrations for 10 recent schema changes
- **Dimension:** DB, Migrations & Schema
- **File:** `/Users/serrayildirim/ollie/supabase/rollbacks/`
- **Problem:** Ten forward migrations lack corresponding .down.sql rollback scripts: grant_service_role, grant_research_tables, invites_channel, invite_funnel_views, seed_alpha_invites, routing_cache, grocery_purchase_history, cook_history, fix_cook_history_clerk_id_text, and partner_bilateral_sync. While some are idempotent (GRANTs, SEEDs, views), the lack of documented rollbacks creates operational risk and makes disaster recovery unclear.
- **Fix:** Create .down.sql rollback scripts for all ten missing migrations. For table-based migrations, include DROP TABLE IF EXISTS statements; for ALTER TABLE, include ROLLBACK changes; for GRANTs, include REVOKE statements; for SEEDs, include DELETE statements with WHERE clauses.
- **Evidence:** `ls /Users/serrayildirim/ollie/supabase/rollbacks/ | wc -l → 20 total, but ls /Users/serrayildirim/ollie/supabase/migrations/ | grep '20260' | wc -l → 30 total migrations`

### cook_history RLS policies incorrectly dropped during type migration
- **Dimension:** DB, Migrations & Schema
- **File:** `/Users/serrayildirim/ollie/supabase/migrations/20260530144446_fix_cook_history_clerk_id_text.sql:15-17`
- **Problem:** The fix migration (20260530144446) drops cook_history_self_select and cook_history_self_update policies because they reference auth.uid() = user_id where user_id was uuid. The policies are dropped but NOT recreated with the new text type, leaving cook_history with RLS enabled but no authenticated-user SELECT or UPDATE path (only service_write INSERT). The comment correctly explains this is intentional (all access via SECURITY DEFINER RPC), but the lack of an authenticated read policy leaves the table with asymmetric access: anon/authenticated cannot read directly, only via the RPC.
- **Fix:** This is actually correct-by-design (RPC is the read path), but document the intentional policy drop in the migration comment to clarify that the lack of SELECT/UPDATE policies is not an oversight. Or add explicit policies denying authenticated/anon SELECT to make intent crystal clear.
- **Evidence:** `DROP POLICY IF EXISTS cook_history_self_select ON cook_history;
DROP POLICY IF EXISTS cook_history_self_update ON cook_history;
-- (no recreate of these policies)
GRANT EXECUTE ON FUNCTION feed_me_cook_signals(text, text, text) TO service_r`

### Blocking vision extraction on 429 with hardcoded 1-second sleep
- **Dimension:** Performance & Cost
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vision.ts:76-83`
- **Problem:** The vision extraction handler implements a simple retry on Gemini 429 (rate limit) by sleeping 1 second, then immediately retrying once. No exponential backoff, no jitter, and the sleep blocks the worker during a rate-limited condition. A stampede of concurrent image dumps (all hitting the rate limit simultaneously) will all sleep and retry at the same second, likely hitting the limit again.
- **Fix:** Adopt an exponential backoff pattern (e.g., base 100ms, jitter ±25%) if retrying within the handler. Better: propagate the 429 to the caller (/route/dump) so the entire request returns soft rate-limit (429) immediately instead of blocking the worker for 1s. Let the frontend surface 'going too fast' without a worker timeout.
- **Evidence:** `if (res.status === 429) { await new Promise((r) => setTimeout(r, 1000)); res = await fetch(...); }`

### Serial per-fragment pass-2 segmentation in dump route on cache misses
- **Dimension:** Performance & Cost
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:198-218`
- **Problem:** When pass-1 segmentation flags fragments for pass-2 LLM splitting (Decision A: word count > 7 or weakly punctuated), the handler iterates in a for-loop and awaits pass2Split() for each flagged fragment individually. A 3-fragment dump where all need pass-2 blocking triggers 3 sequential AI calls to Groq/Gemini. Although the code later batches classification (Line 318: classifyBatch calls a single Groq request), pass-2 is still per-fragment serial.
- **Fix:** Batch the pass-2 calls: collect all fragments needing pass-2, send them in one jsonCascade call with a multi-fragment prompt, and merge results back. Current pass-2 trigger is ~30% of dumps; batching could drop from 3 calls to 1 on typical multi-fragment dumps. The pass-2 system prompt can be extended to handle N inputs: 'You are given N fragments below...Respond with { "fragments": [[...], [...], ...] } in the SAME order.'
- **Evidence:** `for (const frag of pass1.fragments) { if (frag.needsPass2) { const split = await pass2Split(frag.text, {...}); ... } }`

### Hardcoded English aria-label in PatternCards dismiss button
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/patterns/PatternCards.tsx:138`
- **Problem:** The dismiss button aria-label 'Dismiss noticing' is hardcoded in English. This accessibility text should be localized to the app language (EN/ES/TR) for screen reader users in Spanish and Turkish.
- **Fix:** Create a translation map for aria-labels. Import useAppLang and dynamically set the aria-label based on the current app language: {en: 'Dismiss noticing', es: 'Descartar noticia', tr: 'Bildirimi Kapat'}
- **Evidence:** `aria-label="Dismiss noticing"`

### Hardcoded English aria-labels in NeedsConfirmCard
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:60, 95, 113`
- **Problem:** Three hardcoded English aria-labels: 'From your photo', 'Keep this routing', 'Undo this routing'. These accessibility strings are not localized to app language, breaking i18n for ES/TR users.
- **Fix:** Accept lang prop and translate aria-labels: {en: 'Keep this routing', es: 'Mantener este enrutamiento', tr: 'Bu yönlendirmeyi tut'} etc.
- **Evidence:** `aria-label="From your photo" / aria-label="Keep this routing" / aria-label="Undo this routing"`

### Hardcoded English text 'not sure · confirm?' in NeedsConfirmCard
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:78`
- **Problem:** The kicker text 'not sure · confirm?' is hardcoded English with no translation support. This is visible UI copy that should ship in user's app language.
- **Fix:** Create a translation map and thread lang prop from parent. Map: {en: 'not sure · confirm?', es: 'no seguro · ¿confirmar?', tr: 'emin değilim · onaylasın mı?'}
- **Evidence:** `not sure · confirm?`

### Hardcoded English UI strings in NotifyPrimeLine defaults
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/notify/NotifyPrimeLine.tsx:49, 127, 135`
- **Problem:** Default notification prompt and button labels are hardcoded English: 'allow ollie to send quiet reminders?', 'allow', 'not now'. These should be localized to app language.
- **Fix:** Accept lang prop and create translation map. For default: {en: 'allow ollie to send quiet reminders?', es: '¿permitir que ollie envíe recordatorios silenciosos?', tr: 'ollie sessiz hatırlatıcılar göndermesine izin ver?'}
- **Evidence:** `label = 'allow ollie to send quiet reminders?' / 'allow' / 'not now'`

### Hardcoded English aria-labels and text in MicButton and PhotoIntake
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:206, 210, 216, 217, 239`
- **Problem:** Multiple hardcoded English strings: aria-labels 'Stop recording', 'Record a voice note', title 'speak your dump', UI text 'listening… just pause when you're done', 'transcribing…'. None are localized.
- **Fix:** Create a translation object and thread lang prop. Map all strings: {en: {stopRec: 'Stop recording', recNote: 'Record a voice note', ...}, es: {...}, tr: {...}}
- **Evidence:** `aria-label="Stop recording" / aria-label={recording ? 'Stop recording' : 'Record a voice note'} / title={busy ? 'transcribing…' : 'speak your dump'}`

### Hardcoded English aria-labels and placeholder text in PhotoIntake
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/PhotoIntake.tsx:273, 274, 317, 376, 433, 438`
- **Problem:** PhotoIntake has hardcoded English aria-labels ('Attach a photo', 'Remove photo', 'Attached PDF', 'Remove PDF') and UI text ('reading…'). These are not localized to app language.
- **Fix:** Thread lang prop and create translation map for all PhotoIntake strings including aria-labels and status messages.
- **Evidence:** `aria-label="Attach a photo" / aria-label="Remove photo" / 'reading…'`

### Hardcoded English strings in TodayNoticings UI
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/brain/TodayNoticings.tsx:147, 179, 186`
- **Problem:** Three hardcoded English UI strings: 'worth a glance' (kicker), 'not now' (postpone button), 'dismiss' (dismiss button). These are visible to users and should ship in app language.
- **Fix:** Thread lang prop from useAppLang. Create translation map: {en: {kicker: 'worth a glance', postpone: 'not now', dismiss: 'dismiss'}, es: {...}, tr: {...}}
- **Evidence:** `"worth a glance" / "not now" / "dismiss"`

### Hardcoded English buttons in TodoScreen decision variant
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/todo/TodoScreen.tsx:505, 514, 523`
- **Problem:** TodoScreen decision-variant buttons are hardcoded English: 'cancel', 'keep', 'decide later'. These action buttons should be localized to app language per trilingual requirement.
- **Fix:** Import useAppLang and create translation map for decision buttons. Thread lang throughout DECISION_VARIANT rendering.
- **Evidence:** `>cancel<, >keep<, >decide later<`

### Hardcoded English buttons in module checkboxes and modals
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/goals/GoalsBox.tsx:372`
- **Problem:** GoalsBox has hardcoded English aria-label 'okay, keep it' on accept button. Similar aria-labels exist in other modules (work, admin) with 'mark done'/'mark undone'. These accessibility strings are not localized.
- **Fix:** Create a centralized i18n module for common UI strings (actions, confirmations, status changes) and thread lang throughout all module components.
- **Evidence:** `aria-label="okay, keep it"`

### Handler tests heavily mock repositories — asserting on mock calls instead of behavior
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/grocery/handler.test.ts`
- **Problem:** The grocery handler test (88 lines, 2 test cases) mocks all repository functions (pantry.add, pantry.remove, transactions.remove, etc.) and asserts via vi.mocked(pantry.remove).toHaveBeenCalledWith(). This pattern tests that the handler called the mocked repo functions with the right arguments, but does NOT test that the repo actually performed the intended action. A regression where pantry.remove() is called but accidentally removes the wrong row, or where the id passed is undefined, would pass the test. The mock-assertion style also makes refactoring (e.g., consolidating remove calls) brittle — tests break even if behavior is correct. Similarly, all module handlers (work, body, cycle, finance, etc.) follow the same pattern: mock -> apply -> assert on mocks. This gives false confidence.
- **Fix:** Shift from mock-assertion to behavior-driven testing. Either: (1) use an in-memory SQLite store (like tests do in logic/ package) and assert the final DB state, or (2) keep mocks but assert on the return value or side effects (e.g., assert result.undo is a function, call it, then assert state changed). For the grocery example: after pantry.remove('pantry-id'), verify that a fresh query of the store shows no row with that id. This catches bugs where the wrong ID is passed or the remove is skipped.
- **Evidence:** `handler.test.ts lines 50-64: await groceryHandler.apply(fragment); expect(vi.mocked(pantry.remove)).toHaveBeenCalledWith('pantry-id'). Only asserts the mock was called with the id, not that the row was removed. No verification of the actual`

### dump-coverage.live.test.ts requires manual environment setup and is skipped in CI
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/tests/dump-coverage.live.test.ts`
- **Problem:** The live regression suite for the Layer 1 classifier (dump-coverage.live.test.ts, lines 71-100) uses describe.skipIf(!LIVE) to skip unless DUMP_COVERAGE_LIVE=1 is set. It runs ~580 Groq API calls on 140+ fixtures, costs $3-5, takes 10-30 minutes wall-clock, and requires manual GROQ_API_KEY setup. It is never run in CI — the skipIf gate means CI only runs the mock version (dump-coverage.test.ts), which has perfect mock-based confidence (100%) but no real-world data. This creates a gap: classifier regressions (prompt quality, model output parsing, edge cases) only surface in dogfood or production, not in CI. The LIVE suite should be integrated into the CI pipeline or a nightly scheduled job, not a manual-only optional test.
- **Fix:** Integrate the LIVE classifier test into CI as either: (1) a scheduled daily/nightly job (lower cost, catch regressions daily), (2) a pre-release gated job that runs before shipping to alpha, or (3) a cron task on ollie-ai-proxy-staging that samples fixtures and alerts on regressions. Record baseline pass rates (target 95%+ per the file) and create a dashboard so regressions are visible. Update the test skip condition from environment variable to something that works in CI (e.g., GITHUB_EVENT_NAME === 'schedule'). Document the baseline confidence thresholds and what <80% / 80-94% / 95%+ mean for each module-action pair.
- **Evidence:** `dump-coverage.live.test.ts lines 32, 71: const LIVE = process.env.DUMP_COVERAGE_LIVE === '1'; describe.skipIf(!LIVE)(). The test runs with ci check manually: 'DUMP_COVERAGE_LIVE=1 GROQ_API_KEY=... pnpm test -- dump-coverage.live' but this i`

### seedtime logic in sync/retry untested for concurrent cancellation
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/packages/sync/tests/retry.test.ts`
- **Problem:** The retry scheduler uses vi.useFakeTimers() / vi.useRealTimers() to test retry intervals (beforeEach/afterEach pattern). Tests verify that cancelAll() drops timers and that retries back off exponentially. However, the interaction between concurrent retry attempts, cancellation, and timer cleanup is not fully exercised. Specifically: (1) what happens if a timer fires while cancelAll() is mid-execution, (2) whether a cancelled promise is properly garbage-collected or leaks, (3) timer resolution on slow runtimes. These edge cases rarely surface in unit tests but do in production under high load.
- **Fix:** Add stress tests using fake timers: (1) create 100+ concurrent retry schedulers, cancel 50 mid-flight, verify none leak; (2) fire timers during cancelAll() execution, verify no double-execution; (3) verify that cancelled timers are not in the internal queue after cancelAll(). Use Node's setImmediate() to interleave timer fires and cancellations. Consider a weak-reference test to detect leaks (if possible in the test environment).
- **Evidence:** `retry.test.ts uses vi.useFakeTimers() in beforeEach (line 26) and vi.useRealTimers() in afterEach. Tests cover: normal retry backoff, cancelAll() clears timers. Tests do NOT cover: concurrent timer fires + cancellation, garbage collection o`

### TypeScript version drift across workspace - both 5.8.3 and 5.9.3 installed
- **Dimension:** Dependency Health
- **File:** `/Users/serrayildirim/ollie/apps/native/package.json:42`
- **Problem:** The workspace declares conflicting TypeScript versions: root package.json specifies ^5.6.0 while apps/native specifies ~5.8.3. The lock file shows both typescript@5.8.3 and typescript@5.9.3 are installed, creating two copies of TypeScript in node_modules. This bloats the install and can cause subtle type checking inconsistencies between the native app and workspace packages.
- **Fix:** Unify TypeScript version across the workspace. Either update the root to ^5.8.0 or higher, or update apps/native to align with root's ^5.6.0. Prefer a single workspace-wide version like ^5.8.3 in root package.json with all packages inheriting it via workspace references.
- **Evidence:** `Root package.json line 25: typescript ^5.6.0 vs apps/native line 42: typescript ~5.8.3; lock file resolves to both typescript@5.8.3 and typescript@5.9.3`

### React version drift - store peerDependencies allow but native declares incompatible major version
- **Dimension:** Dependency Health
- **File:** `/Users/serrayildirim/ollie/packages/store/package.json:21-22`
- **Problem:** The @ollie/store package declares React 18 as a devDependency (^18.3.1) while apps/native declares React 19 (^19.1.0). Although store's peerDependencies allow >=18, the devDependency for testing is locked to 18. This means store development/testing happens against React 18, but consuming code runs React 19. Both versions are installed in node_modules, which can cause subtle type mismatches and double-loading issues.
- **Fix:** Either: (1) Update store's devDependency to ^19.1.0 to match the consumer, or (2) update native to use React 18. Since native already uses 19, prefer option 1: update packages/store/package.json devDependency to react ^19.1.0 and corresponding @types/react to ^19.1.x to ensure consistent testing against the version consumers actually use.
- **Evidence:** `packages/store/package.json line 22: react ^18.3.1 (devDependency), apps/native line 32: react ^19.1.0 (dependency); lock file installs both react@18.3.1 and react@19.2.6`

## LOW — 33

### Sentry DSN contains organization/project IDs in environment variable
- **Dimension:** Secrets & Token Exposure
- **File:** `/Users/serrayildirim/ollie/.env.local:8`
- **Problem:** The VITE_SENTRY_DSN env var contains the full Sentry DSN including organization and project IDs, which are technically public information derived from the DSN. However, this is acceptable per Sentry's documentation - Sentry DSNs are intentionally public and include only the public key. The actual secret (if any) would be in the auth token portion which is not shown here.
- **Fix:** No action required - Sentry DSNs are designed to be public and this is the correct way to configure Sentry.
- **Evidence:** `VITE_SENTRY_DSN=https://[REDACTED_SENTRY_DSN]@o4511388392292352.ingest.us.sentry.io/4511388465889281`

### Unvalidated excludeDishes array in /feed-me has missing max-length check
- **Dimension:** Input Validation
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:458-466`
- **Problem:** The excludeDishes array is validated for item length (≤100) but the array size itself is not capped. An attacker can send an excludeDishes array with 10,000+ items, each passing the trim().length check, consuming memory and slowing the Gemini prompt building.
- **Fix:** Add a max array size check: `if (b.excludeDishes.length > 100) return { error: 'exclude_dishes_too_large' };` before the loop, or cap the loop: `for (let i = 0; i < Math.min(b.excludeDishes.length, 100); i++)`
- **Evidence:** `const excludeDishes: string[] = [];
if (b.excludeDishes !== undefined) {
  if (!Array.isArray(b.excludeDishes)) return { error: 'invalid_exclude_dishes' };
  for (const d of b.excludeDishes) {
    if (typeof d !== 'string') return { error: `

### startOfWeek() and endOfWeek() not exported; only used in body-weekly
- **Dimension:** Reinvented Wheels & Duplication
- **File:** `packages/orchestrator/src/body-weekly.ts:69-78`
- **Problem:** These are private functions in body-weekly.ts. While not currently duplicated elsewhere, they represent commonly needed date-math utilities that should be consolidated in @ollie/logic/src/util for future reuse.
- **Fix:** Consider exporting startOfWeek() and endOfWeek() from @ollie/logic/src/util/index.ts alongside the existing dayKey, nextDayKey, and daysBetweenKeys utilities for consistency and discoverability.
- **Evidence:** `function startOfWeek(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // back to Sunday
  return d.getTime();
}

function endOfWeek(weekStart: number): number {
  return weekSt`

### sleep() function defined in both @ollie/api and @ollie/research-stream independently
- **Dimension:** Reinvented Wheels & Duplication
- **File:** `packages/api/src/client.ts:379-381`
- **Problem:** This trivial utility is defined in packages/api/src/client.ts (line 379-381) for internal use in the retry loop. It's also implicitly needed in @ollie/research-stream (which manually uses setTimeout in scheduleFlush). While micro, this is a common pattern repeated across the codebase.
- **Fix:** Optional: export sleep() as a tiny public utility from @ollie/logic/src/util or create a new @ollie/promise or @ollie/async module. Low priority given the trivial implementation, but consistency aids discoverability.
- **Evidence:** `function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}`

### isoTodayWork() duplicates dayKey() formatting logic
- **Dimension:** Reinvented Wheels & Duplication
- **File:** `apps/native/src/modules/work/repo.ts:84-90`
- **Problem:** This reinvents dayKey() from @ollie/logic/src/util/index.ts, which already does exactly this: formatting a timestamp as YYYY-MM-DD in local time. The work module should import and use dayKey instead.
- **Fix:** Replace the isoTodayWork() function with: export function isoTodayWork(): string { return dayKey(Date.now()); } after importing dayKey from @ollie/logic.
- **Evidence:** `function isoTodayWork(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return '${y}-${m}-${day}';
}`

### Test files colocated with source code in apps/native
- **Dimension:** File & Module Structure
- **File:** `/Users/serrayildirim/ollie/apps/native/src`
- **Problem:** Test files (.test.ts) are placed alongside source code within the src/ directory, whereas all packages (orchestrator, logic, crypto, etc.) follow the standard convention of using a separate tests/ directory. This inconsistency makes it harder to distinguish production code from test code at a glance.
- **Fix:** Migrate all .test.ts files from apps/native/src to a dedicated tests/ directory at the app root (or within each module folder) to match the package structure convention. This will also reduce the src/ directory's complexity for Vite builds.
- **Evidence:** `/Users/serrayildirim/ollie/apps/native/src/notify/serverReminder.test.ts, /Users/serrayildirim/ollie/apps/native/src/modules/brain/copy.test.ts, etc. (43 test files in src/)`

### Unsafe type cast for theme token serialization
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/apps/native/src/theme/tokens.ts:370-382`
- **Problem:** Theme palette, fonts, and other design tokens are cast as unknown as Record<string, string|number> without validating their actual structure. Mismatched schema silently succeeds.
- **Fix:** Validate token shape at runtime or use a type-safe theme builder. Ensure palette, fonts, etc. conform to expected Record structure before serializing.
- **Evidence:** `writeGroup('color', t.palette as unknown as Record<string, string>);`

### as any type parameter in crypto globalThis access
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/crypto/src/index.ts:86`
- **Problem:** crypto.getRandomValues parameter type is (a: any) => any, allowing any input/output without validation. If getRandomValues is called with a non-ArrayBufferView, it will fail at runtime.
- **Fix:** Type the function signature properly: crypto?: { getRandomValues?: (a: ArrayBufferView) => ArrayBufferView }; and ensure the return cast is valid.
- **Evidence:** `crypto?: { getRandomValues?: (a: any) => any };`

### Redundant chain of casts in orchest grocery item route
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/grocery.ts:201`
- **Problem:** Array.map() result is cast as unknown as ShoppingItem[] without validating the shape of constructed objects. If the builder creates an incompatible shape, type safety is lost.
- **Fix:** Use a factory function that returns ShoppingItem[], or construct an array of type ShoppingItem[] and let TypeScript verify shape at compile time.
- **Evidence:** `})) as unknown as ShoppingItem[];`

### Exception during event validation drops emit silently
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/packages/events/src/index.ts:35-40`
- **Problem:** If validatePayload() throws (unexpected, but possible in a malformed shape), the emit() will throw and stop event delivery. The payload validation is supposed to warn + return false, but if it throws instead, the emit() error propagates to the caller. A downstream handler expecting a non-fatal emit may crash the whole dispatch.
- **Fix:** Wrap validatePayload in a try/catch: `let result; try { result = validatePayload(name, payload); } catch (err) { console.error('validation threw', err); return; }`
- **Evidence:** `  const result = validatePayload(name, payload);
  if (!result.ok) {
    console.warn(...);
    return;
  }`

### Unnecessary Promise.resolve().then() wrapper in brain recompute
- **Dimension:** Async & Concurrency
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/brain/index.ts:54`
- **Problem:** The code wraps `recomputeCapacity()` in an unnecessary `Promise.resolve().then(...)` chain when it's already an async function. This adds an extra microtask that serves no purpose and can make the promise chain harder to reason about. The error handling is duplicated with a .catch() on the inner function.
- **Fix:** Simplify to `recomputeCapacity(store, now).catch((err) => { console.error(...); })` to remove the unnecessary wrapper and improve code clarity. The Promise.all() will still properly handle both promises in the array.
- **Evidence:** `Promise.resolve().then(() => recomputeCapacity(store, now)).catch((err) => {
  console.error('[brain] capacity recompute failed (non-fatal):', err);
}),`

### Duplicate cacheWrite functions across router modules
- **Dimension:** Async & Concurrency
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router:route.ts:438, feed-me.ts:779`
- **Problem:** The same `cacheWrite` function is defined identically in both route.ts and feed-me.ts. This duplication violates DRY principles and creates maintenance burden — if the cache schema or endpoint changes, both copies must be updated. The functions write to the exact same Supabase table with identical signatures and behavior.
- **Fix:** Extract the cacheWrite function to a shared module (e.g. `workers/ai-proxy/src/shared/cache.ts`) that both route.ts and feed-me.ts can import. Update both imports to use the shared version. This reduces code duplication and ensures consistent behavior across the router.
- **Evidence:** `// route.ts:438-465 and feed-me.ts:779-806 contain identical implementations
async function cacheWrite(
  module: string,
  text: string,
  embedding: number[],
  classification: unknown,
  language: string,
  env: <Router|FeedMe>Env,
): Pr`

### Magic number 30 * 60_000 for work meeting duration lacks named constant
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:935`
- **Problem:** Work meetings are created with end_at = ts + 30 * 60_000 (30 minutes) as a hardcoded literal. This magic number should be extracted to a named constant at the top of the file so the intent (default meeting duration) is clear and the value is reusable.
- **Fix:** Add a module-level constant: `const DEFAULT_WORK_MEETING_DURATION_MS = 30 * 60 * 1000;` (or `const DEFAULT_WORK_MEETING_MINUTES = 30;` and compute MS inline). Replace line 935 with `end_at: ts + DEFAULT_WORK_MEETING_DURATION_MS`.
- **Evidence:** `Line 935: 'end_at: ts + 30 * 60_000'. The literal has no explanation and its purpose (default meeting length) is inferred from context.`

### dispatchAction has stale comment contradicting current structure
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:24-25`
- **Problem:** The jsdoc at lines 24-25 says 'Audit-task 1 (2026-05-14): work + goals routes populate work.tasks / work.meetings / goals.items[] with proper schema so the W-* / G-* pattern detectors see the data.' This is marked as a future audit task, but the code at lines 929-947 (work meetings) and 954-961 (goals) already implements the schema. The comment should either be removed or updated to reflect the current state.
- **Fix:** Remove or update the audit-task comment. If the schema is now complete, delete lines 24-25. If there's remaining work, update the comment to specify what's incomplete and link to an issue tracker.
- **Evidence:** `Lines 24-25 mention an audit task dated 2026-05-14. Lines 929-947 show meetings being written with correct schema (id, title, start_at, end_at). Lines 954-961 show goals with correct schema (id, title, created_at, status). The comment is st`

### test-only flag comment uses date that appears unrelated to feature readiness
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/grocery/GroceryBox.tsx:17`
- **Problem:** The GroceryBox component docstring mentions 'DEV-only "insert test milk" button stays' at line 17, but there's no explanation of when it should be removed. The intent is clear (testing aid), but no issue number or date target is provided for cleanup.
- **Fix:** Either remove the DEV-only button, or add a TODO with a date/issue: `// TODO(2026-Q3): remove DEV-only test button before production` or similar. If it's intentional for long-term debugging, move the flag to an environment variable (process.env.GROCERY_DEV_MODE).
- **Evidence:** `Line 17: '- DEV-only "insert test milk" button stays' with no removal criteria or timeline.`

### Multiple unused eslint-disable directives for no-console
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/apps/native/src/store.ts:80, 134, 142`
- **Problem:** Three eslint-disable-next-line directives for 'no-console' rule, but no-console is not configured in eslint.config.mjs. These are noise that should be removed.
- **Fix:** Remove all three unused eslint-disable comments from this file since no-console is not enforced
- **Evidence:** `// eslint-disable-next-line no-console
console.log(`

### Case inconsistency in moduleResolution setting across configs
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/packages/crisis-lexicon/tsconfig.json:5`
- **Problem:** moduleResolution uses lowercase 'bundler' instead of 'Bundler' used in tsconfig.base.json and most other configs. While TypeScript accepts both (case-insensitive), idiomatic convention is to match the base config. Creates unnecessary inconsistency.
- **Fix:** Standardize to "Bundler" (capital B) across all tsconfig.json files to match tsconfig.base.json
- **Evidence:** `crisis-lexicon/tsconfig.json line 5: "moduleResolution": "bundler"
tsconfig.base.json line 4: "moduleResolution": "Bundler"
apps/native/tsconfig.json line 10: "moduleResolution": "bundler"`

### Cloudflare worker packages missing forceConsistentCasingInFileNames
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/packages/apns-jwt/tsconfig.json`
- **Problem:** apns-jwt, worker-http, and sentry-tunnel worker packages do not inherit from base and are missing forceConsistentCasingInFileNames option that is set in tsconfig.base.json. This is a best practice for cross-platform compatibility.
- **Fix:** Add "forceConsistentCasingInFileNames": true to apns-jwt/tsconfig.json and worker-http/tsconfig.json compilerOptions, or have them extend base if possible
- **Evidence:** `apns-jwt/tsconfig.json and worker-http/tsconfig.json lack "forceConsistentCasingInFileNames": true`

### Potential precision loss in createdAt tiebreak sort
- **Dimension:** Algorithms Correctness & Efficiency
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/brain/select.ts:342-345`
- **Problem:** When createdAt is missing, the code uses Number.POSITIVE_INFINITY as a default. The intent is to sort older items first (lower timestamps first). However, when both createdAt values are missing, both candidates get POSITIVE_INFINITY, making them equal on this criterion. This is not incorrect but relies on the final fallback (id.localeCompare), which may not provide intuitive ordering when multiple items lack createdAt.
- **Fix:** Consider adding a comment explaining that missing createdAt values are treated as 'least recently created' (or use a different sentinel value). Alternatively, ensure createdAt is always populated by the gatherer.
- **Evidence:** `const ca = a.createdAt ?? Number.POSITIVE_INFINITY; const cb = b.createdAt ?? Number.POSITIVE_INFINITY; if (ca !== cb) return ca - cb;`

### DAY_MS constant duplication across modules
- **Dimension:** Algorithms Correctness & Efficiency
- **File:** `/Users/serrayildirim/ollie/packages/cadence/src/index.ts, /Users/serrayildirim/ollie/packages/cadence/src/recurring.ts, /Users/serrayildirim/ollie/packages/brain/src/brain/harm.ts:154, 78, 23`
- **Problem:** The constant DAY_MS (24 * 60 * 60 * 1000 or 86_400_000) is defined separately in multiple modules instead of being imported from @ollie/logic/util, which provides a single source of truth. This creates maintenance burden and risk of drift if one copy is updated incorrectly.
- **Fix:** Import DAY_MS from @ollie/logic/util in all three modules: `import { DAY_MS } from '@ollie/logic/util';`
- **Evidence:** `cadence/src/index.ts:154 'const DAY_MS = 24 * 60 * 60 * 1000;' vs cadence/src/recurring.ts:78 'const DAY_MS = 24 * 60 * 60 * 1000;' vs harm.ts:23 'const DAY_MS = 86_400_000;'`

### Median calculation does not guard against empty input
- **Dimension:** Algorithms Correctness & Efficiency
- **File:** `/Users/serrayildirim/ollie/packages/cadence/src/recurring.ts:174`
- **Problem:** The medianAmountOf function assumes the values array is non-empty after filtering. If no amounts are supplied or all are null, values.length === 0, but the function attempts to access sorted[mid - 1] and sorted[mid], which could theoretically fail if the guard `if (values.length === 0) return null;` is somehow bypassed.
- **Fix:** The code is actually safe due to the guard, but add a comment to document this: `// Guard above ensures values.length > 0`
- **Evidence:** `if (values.length === 0) return null; values.sort((a, b) => a - b); const mid = Math.floor(values.length / 2); ... return values[mid - 1]! + values[mid]! / 2;`

### Watcher subscribes to keys that are only written by sibling orchestrators, not bridges
- **Dimension:** State & Store Consistency
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/body-signals.ts:138-146`
- **Problem:** The `shared.signals` key is read by tests but has no bridge-based initialization on native. It is only populated by `runBodySignalsPass()`, which is called from the body orchestrator's recompute. On cold start, `shared.signals` will be empty until the body watcher fires. This is not a bug (the watcher eventually populates it), but it means readers must defensively handle null/empty for the first tick.
- **Fix:** No action required if all consumers already have defensive defaults. If any consumer expects signals to exist on boot, seed `shared.signals = []` in a bridge initialization or in the store setup, not just in the orchestrator.
- **Evidence:** `Line 138: 'const prev = store.get<unknown[]>('shared', 'signals', []) ?? []' reads with a default. No bridge writes this key. Only body-signals.ts and body.ts (via runBodySignalsPass) populate it.`

### Daily notification budget count query fails CLOSED but enriched_signals could still duplicate on retry
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:189-196`
- **Problem:** Audit #13 correctly implements fail-closed behavior for the daily budget count query (lines 189-196): if countSentToday fails, the job is retried rather than delivered against an unknown budget. However, this creates a retry loop. If enriched_signals is susceptible to duplicates (per the high-severity finding above), and the cron drain retries enriching a dump, the duplicate enriched_signals row will skew the signal counts for analytics. Low severity because the budget gate is sound, but compounds the enriched_signals duplicate issue.
- **Fix:** Resolve the enriched_signals duplicate constraint issue first. Then verify that retry loops do not accumulate analytics errors.
- **Evidence:** `flush-notifications.ts:193: 'return COUNT_UNAVAILABLE' when count query fails. COUNT_UNAVAILABLE = Number.MAX_SAFE_INTEGER (line 380), guaranteeing the job stays pending. No per-row idempotency for enriched_signals.`

### Potential NULL constraint inconsistency on finance_records.deleted_at
- **Dimension:** DB, Migrations & Schema
- **File:** `/Users/serrayildirim/ollie/supabase/migrations/20260514000008_finance_records.sql:65`
- **Problem:** finance_records.deleted_at is nullable (used for soft-delete tombstones), but there is no CHECK constraint or trigger to validate that once deleted_at is set, it is never unset. A malformed client or corrupted record could theoretically set deleted_at and then NULL it again, breaking the immutable-tombstone semantic.
- **Fix:** Add a CHECK constraint: `CHECK (deleted_at IS NULL OR deleted_at <= now())` to prevent future-dated deletes, and document the soft-delete semantic. Alternatively, use a trigger to prevent unsetting deleted_at once it is set.
- **Evidence:** `  deleted_at   timestamptz,  -- no NOT NULL, no CHECK constraint`

### Per-write Vectorize metadata JSON.stringify on every upsert (cache write)
- **Dimension:** Performance & Cost
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vectorize.ts:151`
- **Problem:** Every cache upsert (after a classification cache miss) and every cache hit bump JSON.stringify the entire payload object. The payload can contain nested objects (hints, reminders, schedule metadata). For a high-volume user with many repeating fragments, this serialization happens per-fragment on every dump. Not a bottleneck on latency (serialization is fast), but unnecessary CPU cost.
- **Fix:** Store payload as pre-stringified JSON from the upstream classifier, or cache the stringified form alongside the classification result. The dump-classify.ts handler already returns payload as an object; have it also return `payloadStr: string` so the cache layer does not re-stringify.
- **Evidence:** `payload: JSON.stringify(params.payload), ... metadata: { ... payload: JSON.stringify(row.payload), ... }`

### Unnecessary repeated groqChat import in feed-me.ts (minor)
- **Dimension:** Performance & Cost
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:30`
- **Problem:** feed-me.ts imports groqChat but the code visible (lines 1-150) does not show any direct groqChat calls. The module uses geminiJson / cloudflareJson / openRouterJson for function calling, not groqChat. This is likely a dead import, indicating the handler may have been refactored away from Groq for recipe generation.
- **Fix:** Verify that groqChat is not used elsewhere in feed-me.ts (past line 150). If unused, remove the import and the GroqMessage type import to reduce bundle bloat.
- **Evidence:** `import { groqChat, type GroqMessage } from '../groq';`

### Research intake batch flush (60s) may delay opt-out consent check
- **Dimension:** Performance & Cost
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/research.ts:134-150`
- **Problem:** The research orchestrator buffers writes for 60 seconds (batchIntervalMs = 60_000) and only checks hasResearchConsent() during flush. If a user opts out, they must wait until the next flush interval (max 60s) before the pipeline stops sending data to /label. In the interim, writes continue to accumulate in the pending buffer.
- **Fix:** Check consent on intake, not just on flush (line 126: onIntake). If !consent, drop the write immediately rather than buffering. The downstream flush can still be called lazily, but never send opted-out data: `if (!isScrubbableTable(...) || !await hasResearchConsent(...)) return;` (async, so make onIntake async or spawn a fire-and-forget consent check).
- **Evidence:** `batchIntervalMs = 60_000; async function flush() { optedIn = await hasResearchConsent(userId); }`

### Turkish crisis lexicon has incomplete tier coverage
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/packages/crisis-lexicon/data/lexicon.tr.json`
- **Problem:** Turkish lexicon tier coverage is imbalanced compared to English: Tier 1 has 4 entries vs English's 5, Tier 4 has 6 vs English's 8. Missing patterns may reduce detection sensitivity for Turkish-language users during crisis situations.
- **Fix:** Add missing Turkish translations for low-tier and high-tier patterns to match English lexicon coverage. Consult with Turkish-speaking clinical advisors to ensure culturally-appropriate patterns.
- **Evidence:** `TR tier 1: 4 entries, EN tier 1: 5 | TR tier 4: 6 entries, EN tier 4: 8 | Missing: 'tonight is the night', 'saying goodbye' variant patterns`

### Spanish crisis lexicon missing tier-4 pattern coverage
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/packages/crisis-lexicon/data/lexicon.es.json`
- **Problem:** Spanish tier 4 (imminent) has 7 entries vs English's 8. Missing the 'tied the noose' pattern which is a high-severity method-indicating signal. This gap could reduce detection of imminent-risk signals in Spanish.
- **Fix:** Add the missing Spanish translation of 'tied the noose' pattern to complete tier-4 coverage and match English detection sensitivity for method-seeking signals.
- **Evidence:** `Spanish tier 4 count: 7 | English tier 4 count: 8 | Missing pattern: 'tied the noose' (Spanish: 'me amarré la soga' or similar)`

### Utility functions in segmentation/lang-detect lack edge-case coverage
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/segmentation.ts`
- **Problem:** The pass1Segment() function (lines 53-82) and helper functions (sentenceSplit, countWords) lack unit tests. Untested edge cases: (1) segmentation with RTL text (Arabic, Hebrew) mixed with LTR, (2) words with hyphens/apostrophes in countWords(), (3) fallback regex in sentenceSplit() when Intl.Segmenter is unavailable, (4) consecutive conjunctions (e.g., 'and and'), (5) conjunction at sentence boundary (split logic). Similarly, lang-detect.ts calculates scores based on stopword matches + diacritics; untested: (1) all-diacritics text (e.g., 'Çok şirin'), (2) mixed-language stopword collisions (e.g., 'a' is both EN and ES), (3) empty or single-word input.
- **Fix:** Add unit tests for segmentation and lang-detect. Test data: multilingual fixtures (EN/ES/TR), mixed-script text, edge punctuation, single-word fragments, all-caps input, emoji. For segmentation: verify pass1Segment() correctly splits on conjunctions and detects needsPass2 threshold (>7 words or >4 + no conj + no terminal punct). For lang-detect: verify MIXED_THRESHOLD logic and that unknown language returns 'unknown' not null.
- **Evidence:** `No segmentation.test.ts or lang-detect.test.ts files exist. Functions defined in segmentation.ts lines 89-103 and lang-detect.ts lines 19-45 (stopword definitions + scoring logic) are live code with zero test coverage.`

### Dump-coverage mock regression suite does not capture real prompt failures
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/tests/dump-coverage.test.ts`
- **Problem:** The mock-based dump-coverage.test.ts (702 lines) runs fixture text through dump-fixtures.ts expecting classification, but the mock (lines 57-96) hardcodes the expected classification. If a fixture's prompt-tuning changes or the classifier prompt regresses, the mock will still return the old expected output, and the test passes. This is a confidence illusion — the test asserts the classifier code handles the response shape correctly, not that the classifier produces correct output. The comment (lines 20-39) acknowledges this: 'The classifier code itself is exercised end-to-end ... only the network is mocked.' But a real prompt regression (e.g., Groq starts outputting {module: 'dump_only'} for a fixture that should be {module: 'grocery'}) would not fail this test.
- **Fix:** Maintain a separate canonical fixtures file that includes BOTH the fixture text AND the Groq ground-truth classification (updated quarterly when the live suite runs). In dump-coverage.test.ts, assert that the mock returns match the canonical ground-truth. When a prompt changes, update the canonical file via live suite results, not manually. Or integrate the live suite into nightly CI so regressions surface before a prompt change ships.
- **Evidence:** `dump-coverage.test.ts lines 66-93: const fixture = DUMP_FIXTURES.find(...); return { message: { content: JSON.stringify({ module: fixture.expected.module, ... }) } }. The mock always returns fixture.expected, never a regression. No way to d`

### Unused devDependency: @types/zxcvbn
- **Dimension:** Dependency Health
- **File:** `/Users/serrayildirim/ollie/packages/crypto/package.json:17`
- **Problem:** The @types/zxcvbn package is declared as a devDependency but never imported. The code dynamically imports zxcvbn via await import('zxcvbn'), and modern versions of zxcvbn (4.4.2 in this case) ship with built-in TypeScript definitions. The @types/zxcvbn package is redundant and wastes disk space.
- **Fix:** Remove '@types/zxcvbn' from packages/crypto/package.json devDependencies. The zxcvbn package (v4.4.2) includes its own type definitions, making the @types package unnecessary. Run pnpm install to clean up.
- **Evidence:** `packages/crypto/package.json line 17: '@types/zxcvbn': '^4.4.5' declared but never referenced in src/index.ts. Code shows: const { default: zxcvbn } = await import('zxcvbn') with no type annotation, relying on zxcvbn's own types.`

### Loose Tauri plugin version constraints - missing patch versions
- **Dimension:** Dependency Health
- **File:** `/Users/serrayildirim/ollie/apps/native/package.json:27-28`
- **Problem:** Two Tauri plugins use loose caret ranges (^2) without patch versions specified, while other plugins pin to specific patches. This can cause unexpected minor version bumps during reinstalls. @tauri-apps/plugin-notification and @tauri-apps/plugin-opener use ^2 while plugin-sql and plugin-store specify full versions (^2.4.0 and ^2.4.3).
- **Fix:** Pin all Tauri plugin versions to specific minor.patch like the others. Update plugin-notification to ^2.3.3 and plugin-opener to ^2.5.4 (current installed versions) for reproducible builds and easier troubleshooting of version-related issues.
- **Evidence:** `apps/native/package.json: plugin-notification ^2 (line 28) and plugin-opener ^2 (line 29) vs plugin-sql ^2.4.0 (line 30) and plugin-store ^2.4.3 (line 31)`

